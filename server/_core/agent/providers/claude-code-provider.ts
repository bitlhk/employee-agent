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

export class ClaudeCodeProvider implements ProviderAdapter {
  constructor(
    private readonly provider: AgentProvider,
    private readonly fetchImpl: AgentProviderFetch = fetch,
  ) {}

  async dispatch(input: ProviderDispatchInput) {
    const endpoint = resolveEndpoint(this.provider, input.definition, input.resolved);
    if (!endpoint) {
      return {
        ok: false as const,
        error: { kind: "dispatch_failed" as const, detail: "Claude Code endpoint is not configured" },
      };
    }

    if (input.resolved?.metadata?.adapterProtocol === "openai-chat-completions") {
      return this.dispatchViaChatCompletions(endpoint, input);
    }

    try {
      const response = await fetchWithTimeout(this.fetchImpl, endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(this.provider, input.definition, input.resolved),
        },
        body: JSON.stringify({
          prompt: input.prompt,
          message: input.prompt,
          agentId: input.definition.id,
          localAgentId: input.resolved?.localAgentId || input.definition.profileRef,
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

  private async dispatchViaChatCompletions(endpoint: string, input: ProviderDispatchInput) {
    try {
      const messages = [
        ...(this.systemMessages(input)),
        { role: "user", content: input.prompt },
      ];
      const response = await fetchWithTimeout(this.fetchImpl, endpointWithPath(endpoint, "/v1/chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(this.provider, input.definition, input.resolved),
          "x-openclaw-scopes": "operator.write",
          "x-openclaw-session-key": input.context.clusterRunId || `agent_cluster_user_${input.context.userId}`,
        },
        body: JSON.stringify({
          model: `openclaw/${input.resolved?.remoteAgentId || input.resolved?.localAgentId || input.definition.profileRef || input.definition.id}`,
          stream: true,
          messages,
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

  private systemMessages(input: ProviderDispatchInput) {
    const systemPrompt = input.resolved?.systemPrompt || "";
    return systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  }
}
