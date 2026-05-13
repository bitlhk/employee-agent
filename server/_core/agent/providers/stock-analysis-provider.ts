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

export class StockAnalysisProvider implements ProviderAdapter {
  constructor(
    private readonly provider: AgentProvider,
    private readonly fetchImpl: AgentProviderFetch = fetch,
  ) {}

  async dispatch(input: ProviderDispatchInput) {
    if (input.resolved?.metadata?.adapterProtocol !== "stock-analysis-v1-agent-stream") {
      return {
        ok: true as const,
        value: payloadToRunResult({
          provider: this.provider,
          definition: input.definition,
          context: input.context,
          payload: {},
          status: "failed",
          error: {
            code: "unsupported_adapter_protocol",
            detail: "StockAnalysisProvider requires stock-analysis-v1-agent-stream binding",
          },
          resolved: input.resolved,
        }),
      };
    }

    const endpoint = resolveEndpoint(this.provider, input.definition, input.resolved);
    if (!endpoint) {
      return {
        ok: false as const,
        error: { kind: "dispatch_failed" as const, detail: "Stock Analysis endpoint is not configured" },
      };
    }

    try {
      const response = await fetchWithTimeout(this.fetchImpl, endpointWithPath(endpoint, "/api/v1/agent/chat/stream"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(this.provider, input.definition, input.resolved),
        },
        body: JSON.stringify({
          message: input.prompt,
          session_id: input.context.clusterRunId || `agent_cluster_user_${input.context.userId}_${input.definition.id}`,
          context: {
            adoptId: input.context.adoptId,
            userId: input.context.userId,
            spaceId: input.context.spaceId,
            agentId: input.definition.id,
          },
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

      if (payload.error) {
        return {
          ok: true as const,
          value: payloadToRunResult({
            provider: this.provider,
            definition: input.definition,
            context: input.context,
            payload,
            status: "failed",
            error: { code: "run_failed", detail: String(payload.error) },
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
}
