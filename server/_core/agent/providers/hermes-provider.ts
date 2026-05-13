import type { AgentProvider } from "../../../../shared/types/agent";
import type { AgentProviderFetch, ProviderAdapter, ProviderDispatchInput } from "./types";
import {
  buildAuthHeaders,
  endpointWithPath,
  fetchWithTimeout,
  payloadToRunResult,
  readProviderPayload,
  resolveEndpoint,
} from "./http-utils";

export class HermesProvider implements ProviderAdapter {
  constructor(
    private readonly provider: AgentProvider,
    private readonly fetchImpl: AgentProviderFetch = fetch,
  ) {}

  async dispatch(input: ProviderDispatchInput) {
    const endpoint = resolveEndpoint(this.provider, input.definition, input.resolved);
    if (!endpoint) {
      return {
        ok: false as const,
        error: { kind: "dispatch_failed" as const, detail: "Hermes endpoint is not configured" },
      };
    }

    if (input.resolved?.metadata?.adapterProtocol === "hermes-v1-runs") {
      return this.dispatchViaV1Runs(endpoint, input);
    }

    try {
      const response = await fetchWithTimeout(this.fetchImpl, endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(this.provider, input.definition, input.resolved),
        },
        body: JSON.stringify({
          message: input.prompt,
          input: input.prompt,
          agentId: input.resolved?.remoteAgentId || input.definition.id,
          remoteAgentId: input.resolved?.remoteAgentId,
          profileRef: input.definition.profileRef,
          systemPrompt: input.resolved?.systemPrompt,
          context: input.context,
        }),
      }, input.definition.timeoutMs || this.provider.timeoutMs || 300_000);

      const payload = await readProviderPayload(response, input.onEvent);
      if (!response.ok) {
        return {
          ok: true as const,
          value: payloadToRunResult({
            provider: this.provider,
            definition: input.definition,
            context: input.context,
            payload,
            status: "failed",
            error: { code: `http_${response.status}`, detail: String(payload.error || payload.message || response.statusText) },
            resolved: input.resolved,
          }),
        };
      }

      return {
        ok: true as const,
        value: payloadToRunResult({
          provider: this.provider,
          definition: input.definition,
          context: input.context,
          payload,
          resolved: input.resolved,
        }),
      };
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      return {
        ok: true as const,
        value: payloadToRunResult({
          provider: this.provider,
          definition: input.definition,
          context: input.context,
          payload: {},
          status: "failed",
          error: { code: isTimeout ? "timeout" : "dispatch_error", detail: error?.message || String(error) },
          resolved: input.resolved,
        }),
      };
    }
  }

  private async dispatchViaV1Runs(endpoint: string, input: ProviderDispatchInput) {
    try {
      const headers = {
        "content-type": "application/json",
        ...buildAuthHeaders(this.provider, input.definition, input.resolved),
        "x-hermes-user-id": `lingxia_user_${input.context.userId}`,
      };
      const createRunResponse = await fetchWithTimeout(this.fetchImpl, endpointWithPath(endpoint, "/v1/runs"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: input.prompt,
          instructions: input.resolved?.systemPrompt,
          session_id: input.context.clusterRunId || `agent_cluster_user_${input.context.userId}`,
          remoteAgentId: input.resolved?.remoteAgentId,
          agentId: input.definition.id,
        }),
      }, Math.min(input.definition.timeoutMs || this.provider.timeoutMs || 300_000, 30_000));

      const createPayload = await readProviderPayload(createRunResponse, input.onEvent);
      const runId = String(createPayload.run_id || createPayload.runId || "");
      if (!createRunResponse.ok || !runId) {
        return {
          ok: true as const,
          value: payloadToRunResult({
            provider: this.provider,
            definition: input.definition,
            context: input.context,
            payload: createPayload,
            status: "failed",
            error: {
              code: createRunResponse.ok ? "run_id_missing" : `http_${createRunResponse.status}`,
              detail: String(createPayload.error || createPayload.message || createRunResponse.statusText || "Hermes run failed"),
            },
            resolved: input.resolved,
          }),
        };
      }

      const eventsResponse = await fetchWithTimeout(this.fetchImpl, endpointWithPath(endpoint, `/v1/runs/${encodeURIComponent(runId)}/events`), {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          ...buildAuthHeaders(this.provider, input.definition, input.resolved),
        },
      }, input.definition.timeoutMs || this.provider.timeoutMs || 300_000);

      const eventsPayload = await readProviderPayload(eventsResponse, input.onEvent);
      if (!eventsResponse.ok) {
        return {
          ok: true as const,
          value: payloadToRunResult({
            provider: this.provider,
            definition: input.definition,
            context: input.context,
            payload: eventsPayload,
            status: "failed",
            error: { code: `http_${eventsResponse.status}`, detail: String(eventsPayload.error || eventsPayload.message || eventsResponse.statusText) },
            resolved: input.resolved,
          }),
        };
      }
      if (eventsPayload.error) {
        return {
          ok: true as const,
          value: payloadToRunResult({
            provider: this.provider,
            definition: input.definition,
            context: input.context,
            payload: eventsPayload,
            status: "failed",
            error: { code: "run_failed", detail: String(eventsPayload.error) },
            resolved: input.resolved,
          }),
        };
      }

      return {
        ok: true as const,
        value: payloadToRunResult({
          provider: this.provider,
          definition: input.definition,
          context: input.context,
          payload: eventsPayload,
          resolved: input.resolved,
        }),
      };
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      return {
        ok: true as const,
        value: payloadToRunResult({
          provider: this.provider,
          definition: input.definition,
          context: input.context,
          payload: {},
          status: "failed",
          error: { code: isTimeout ? "timeout" : "dispatch_error", detail: error?.message || String(error) },
          resolved: input.resolved,
        }),
      };
    }
  }
}
