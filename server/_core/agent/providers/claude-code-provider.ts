import type { AgentArtifact, AgentProvider } from "../../../../shared/types/agent";
import type { AgentProviderFetch, ProviderAdapter, ProviderDispatchInput } from "./types";
import { buildTenantContext, type TenantContext } from "../../tenant-isolation";
import {
  buildAuthHeaders,
  endpointWithPath,
  fetchWithTimeout,
  payloadToRunResult,
  readProviderPayload,
  resolveEndpoint,
} from "./http-utils";

const REMOTE_FILE_SERVICE_PORT = 19798;
const DEFAULT_FILE_SERVICE_TOKEN = "public-skill-demo-2026";

type ClaudeCodeProviderOptions = {
  buildTenantContext?: (userId: number, agentId: string) => TenantContext;
  fileServiceToken?: string;
  now?: () => number;
};

export class ClaudeCodeProvider implements ProviderAdapter {
  constructor(
    private readonly provider: AgentProvider,
    private readonly fetchImpl: AgentProviderFetch = fetch,
    private readonly options: ClaudeCodeProviderOptions = {},
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
      const startedAtSec = Math.floor((this.options.now?.() || Date.now()) / 1000);
      const tenantContext = this.resolveTenantContext(input);
      const messages = [
        ...(this.systemMessages(input, tenantContext)),
        { role: "user", content: input.prompt },
      ];
      const response = await fetchWithTimeout(this.fetchImpl, endpointWithPath(endpoint, "/v1/chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(this.provider, input.definition, input.resolved),
          "x-openclaw-scopes": "operator.write",
          "x-openclaw-session-key": tenantContext?.sessionKey || input.context.clusterRunId || `agent_cluster_user_${input.context.userId}`,
          ...(tenantContext ? {
            "x-tenant-token": tenantContext.tenantToken,
            "x-tenant-workspace": tenantContext.workspace,
          } : {}),
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
      const payloadWithArtifacts = await this.attachRemoteArtifacts(endpoint, input, tenantContext, payload, startedAtSec);
      return {
        ok: true as const,
        value: payloadToRunResult({
          provider: this.provider,
          definition: input.definition,
          context: input.context,
          payload: payloadWithArtifacts,
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

  private systemMessages(input: ProviderDispatchInput, tenantContext: TenantContext | null) {
    const systemPrompt = [
      input.resolved?.systemPrompt || "",
      tenantContext && this.fileServiceSource(input.definition.id)
        ? [
          "",
          `【本次 tenant token (16 hex)】${tenantContext.tenantShort}`,
          "这是 ppt-insight / 文件生成 Skill 内部保存产物时必须使用的 16 位 hex 字面量。",
          "如果本次任务要求生成 PPT / 演示文稿 / 汇报材料，必须调用对应 Skill 生成文件，不要只输出文字。",
        ].join("\n")
        : "",
    ].filter(Boolean).join("\n");
    return systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  }

  private resolveTenantContext(input: ProviderDispatchInput): TenantContext | null {
    if (!this.fileServiceSource(input.definition.id)) return null;
    const build = this.options.buildTenantContext || buildTenantContext;
    return build(input.context.userId, input.definition.id);
  }

  private fileServiceSource(agentId: string): "task-ppt" | "task-code" | null {
    if (agentId === "task-ppt") return "task-ppt";
    if (agentId === "task-code" || agentId === "task-slides") return "task-code";
    return null;
  }

  private getRemoteFileServiceUrl(endpoint: string): string | null {
    try {
      const url = new URL(endpoint);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return null;
      return `${url.protocol}//${url.hostname}:${REMOTE_FILE_SERVICE_PORT}`;
    } catch {
      return null;
    }
  }

  private async attachRemoteArtifacts(
    endpoint: string,
    input: ProviderDispatchInput,
    tenantContext: TenantContext | null,
    payload: Record<string, unknown>,
    startedAtSec: number,
  ): Promise<Record<string, unknown>> {
    const source = this.fileServiceSource(input.definition.id);
    const fsUrl = this.getRemoteFileServiceUrl(endpoint);
    if (!source || !tenantContext || !fsUrl) return payload;
    try {
      const response = await fetchWithTimeout(this.fetchImpl, `${fsUrl}/files?tenant=${encodeURIComponent(tenantContext.tenantShort)}&source=${encodeURIComponent(source)}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.options.fileServiceToken || process.env.FILE_SERVICE_TOKEN || DEFAULT_FILE_SERVICE_TOKEN}`,
        },
      }, 5_000);
      if (!response.ok) return payload;
      const data = await response.json().catch(() => ({})) as { files?: Array<Record<string, unknown>> };
      const artifacts = this.remoteFilesToArtifacts(input.definition.id, data.files || [], startedAtSec);
      if (!artifacts.length) return payload;
      return {
        ...payload,
        artifacts: [...(Array.isArray(payload.artifacts) ? payload.artifacts : []), ...artifacts],
      };
    } catch (error: any) {
      console.warn("[ClaudeCodeProvider] remote artifact scan failed:", error?.message || String(error));
      return payload;
    }
  }

  private remoteFilesToArtifacts(agentId: string, files: Array<Record<string, unknown>>, startedAtSec: number): AgentArtifact[] {
    const recent = files
      .map((file) => ({
        name: String(file.name || ""),
        size: Number(file.size || 0),
        mtime: Number(file.mtime || 0),
      }))
      .filter((file) => file.name && (!file.mtime || file.mtime >= startedAtSec - 5));

    const previewByBase = new Map<string, { name: string; size: number; mtime: number }>();
    const previewByStem = new Map<string, { name: string; size: number; mtime: number }>();
    for (const file of recent) {
      const previewBase = this.previewBaseFor(file.name);
      if (previewBase) {
        previewByBase.set(previewBase, file);
        previewByStem.set(this.stripTrailingTimestamp(previewBase), file);
      }
    }

    const artifacts: AgentArtifact[] = [];
    const seen = new Set<string>();
    for (const file of recent) {
      if (/\.pptx$/i.test(file.name)) {
        if (this.isSecondaryPptFile(file.name)) {
          seen.add(file.name);
          continue;
        }
        const base = file.name.replace(/\.pptx$/i, "");
        const preview = previewByBase.get(base) || previewByStem.get(this.stripTrailingTimestamp(base));
        artifacts.push({
          id: `${agentId}-${base}-pptx`,
          type: "pptx",
          name: file.name,
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          downloadUrl: this.businessDownloadUrl(agentId, file.name),
          previewUrl: preview ? this.businessPreviewUrl(agentId, preview.name) : undefined,
          metadata: {
            size: file.size,
            mtime: file.mtime || undefined,
            source: "remote-file-service",
            previewFile: preview?.name,
          },
        });
        seen.add(file.name);
        if (preview) seen.add(preview.name);
      }
    }

    for (const file of recent) {
      if (seen.has(file.name)) continue;
      if (this.isInternalSupportFile(file.name)) {
        continue;
      }
      if (/\.html$/i.test(file.name)) {
        artifacts.push({
          id: `${agentId}-${file.name}-html`,
          type: "html",
          name: file.name,
          mimeType: "text/html",
          downloadUrl: this.businessPreviewUrl(agentId, file.name),
          previewUrl: this.businessPreviewUrl(agentId, file.name),
          metadata: {
            size: file.size,
            mtime: file.mtime || undefined,
            source: "remote-file-service",
          },
        });
        continue;
      }
      artifacts.push({
        id: `${agentId}-${file.name}-file`,
        type: "file",
        name: file.name,
        downloadUrl: this.businessDownloadUrl(agentId, file.name),
        metadata: {
          size: file.size,
          mtime: file.mtime || undefined,
          source: "remote-file-service",
        },
      });
    }
    return artifacts;
  }

  private previewBaseFor(fileName: string) {
    const timestamped = fileName.match(/^(.+)-preview-(\d+)\.html$/i);
    if (timestamped) return `${timestamped[1]}-${timestamped[2]}`;
    const simple = fileName.match(/^(.+)-preview\.html$/i);
    return simple ? simple[1] : null;
  }

  private stripTrailingTimestamp(fileName: string) {
    return fileName.replace(/-\d{10,}$/i, "");
  }

  private isSecondaryPptFile(fileName: string) {
    return /-print(?:-\d+)?\.pptx$/i.test(fileName);
  }

  private isInternalSupportFile(fileName: string) {
    return /^(content|research)[_-].*\.(json|md)$/i.test(fileName);
  }

  private businessDownloadUrl(agentId: string, fileName: string) {
    return `/api/claw/business-files/download?agentId=${encodeURIComponent(agentId)}&file=${encodeURIComponent(fileName)}`;
  }

  private businessPreviewUrl(agentId: string, fileName: string) {
    return `/api/claw/remote-file?agentId=${encodeURIComponent(agentId)}&file=${encodeURIComponent(fileName)}&preview=1`;
  }
}
