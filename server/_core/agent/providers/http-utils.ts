import type {
  AgentArtifact,
  AgentCallContext,
  AgentDefinition,
  AgentProvider,
  AgentResult,
  AgentRunResult,
} from "../../../../shared/types/agent";
import { SecretHandle } from "../../../../shared/lib/secret-handle";
import type { AgentProviderFetch, ProviderResolvedBinding, ProviderStreamEvent } from "./types";

const SECRET_KEY_RE = /api[_-]?token|token|secret|password|authorization|auth|baseEndpointRef/i;

export function resolveRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return process.env[ref] || ref;
}

export function redactSecrets(value: unknown): unknown {
  if (value instanceof SecretHandle) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) continue;
    out[key] = redactSecrets(item);
  }
  return out;
}

export function sanitizeRunResult(result: AgentRunResult): AgentRunResult {
  return {
    ...result,
    metadata: result.metadata ? redactSecrets(result.metadata) as Record<string, unknown> : undefined,
    artifacts: result.artifacts.map((artifact) => ({
      ...artifact,
      metadata: artifact.metadata ? redactSecrets(artifact.metadata) as Record<string, unknown> : undefined,
    })),
  };
}

export function resolveEndpoint(provider: AgentProvider, definition: AgentDefinition, resolved?: ProviderResolvedBinding): string | undefined {
  return resolved?.endpoint || resolveRef(definition.endpointRef) || resolveRef(provider.baseEndpointRef);
}

export function resolveAuthHandle(provider: AgentProvider, definition: AgentDefinition, resolved?: ProviderResolvedBinding): SecretHandle | null {
  if (provider.authType === "none") return null;
  if (resolved && Object.prototype.hasOwnProperty.call(resolved, "auth")) {
    return resolved.auth || null;
  }
  const authRef = definition.authRef || provider.authRef;
  return SecretHandle.of(resolveRef(authRef));
}

export function buildAuthHeaders(provider: AgentProvider, definition: AgentDefinition, resolved?: ProviderResolvedBinding): Record<string, string> {
  const auth = resolveAuthHandle(provider, definition, resolved);
  if (!auth) return {};
  return auth.use((token) => ({ authorization: `Bearer ${token}` }));
}

export async function fetchWithTimeout(
  fetchImpl: AgentProviderFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function readProviderPayload(
  response: Response,
  onEvent?: (event: ProviderStreamEvent) => void,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream") && response.body) {
    return readProviderEventStream(response.body, onEvent);
  }
  const raw = await response.text();
  if (!raw.trim()) return {};

  if (contentType.includes("text/event-stream") || raw.includes("\ndata:")) {
    const chunks: string[] = [];
    const legacyChunks: string[] = [];
    const eventTypes: string[] = [];
    let error: string | undefined;
    let fallbackOutput = "";
    let sawResponsesApiEvent = false;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const eventType = String(parsed.event || parsed.type || "");
        if (eventType) eventTypes.push(eventType);
        if (eventType.startsWith("response.")) sawResponsesApiEvent = true;
        if (parsed.__status) {
          emitProviderEvent(onEvent, {
            type: "progress",
            message: String(parsed.__status),
            rawType: eventType || "openai_chat_status",
          });
        }
        if (eventType === "run.failed" || eventType === "response.failed") {
          error = stringifyProviderError(parsed.error || parsed.message || "Provider run failed");
          emitProviderEvent(onEvent, { type: "error", message: error, rawType: eventType });
        } else if (parsed.error && parsed.error !== true) {
          error = stringifyProviderError(parsed.error);
          emitProviderEvent(onEvent, { type: "error", message: error, rawType: eventType });
        }
        if (eventType === "error") {
          error = stringifyProviderError(parsed.error || parsed.message || "Provider run failed");
          emitProviderEvent(onEvent, { type: "error", message: error, rawType: eventType });
          continue;
        }
        if (eventType === "thinking" || eventType === "generating" || eventType === "tool_start" || eventType === "tool_done") {
          const message = providerProgressMessage(parsed, eventType);
          if (message) emitProviderEvent(onEvent, { type: "progress", message, rawType: eventType });
          continue;
        }
        if (eventType === "response.failed" && parsed.response?.error) {
          error = stringifyProviderError(parsed.response.error.message || parsed.response.error.detail || error || "Provider run failed");
          emitProviderEvent(onEvent, { type: "error", message: error, rawType: eventType });
        }

        // OpenAI Responses-style streams carry incremental text in
        // response.output_text.delta and repeat the full text later in
        // output_text.done / response.completed. Only append deltas; keep the
        // terminal full text as a fallback for runtimes that do not stream.
        if (eventType === "response.output_text.delta") {
          const delta = parsed.delta ?? "";
          if (delta) {
            const text = String(delta);
            chunks.push(text);
            emitProviderEvent(onEvent, { type: "text_delta", text, rawType: eventType });
          }
          continue;
        }
        if (eventType === "response.output_text.done") {
          if (parsed.text && !fallbackOutput) fallbackOutput = String(parsed.text);
          continue;
        }
        if (eventType === "response.completed" || eventType === "response.failed") {
          const text = extractResponsesOutputText(parsed.response);
          if (text && !fallbackOutput) fallbackOutput = text;
          continue;
        }
        if (eventType === "message.delta") {
          const delta = parsed.delta ?? "";
          if (delta) {
            const text = String(delta);
            legacyChunks.push(text);
            emitProviderEvent(onEvent, { type: "text_delta", text, rawType: eventType });
          }
          continue;
        }
        if (eventType === "run.completed") {
          const output = parsed.output ?? "";
          if (output && !fallbackOutput) fallbackOutput = String(output);
          continue;
        }
        if (eventType === "run.failed") {
          error = stringifyProviderError(parsed.error || parsed.message || error || "Provider run failed");
          continue;
        }

        if (!sawResponsesApiEvent) {
          const content = parsed.output
            || parsed.text
            || parsed.message
            || parsed.content
            || parsed.delta
            || parsed.choices?.[0]?.delta?.content
            || "";
          if (content) {
            const text = String(content);
            legacyChunks.push(text);
            emitProviderEvent(onEvent, { type: "text_delta", text, rawType: eventType || "content" });
            const files = extractProviderFileHints(text);
            if (files.length) emitProviderEvent(onEvent, { type: "artifact_hint", files, rawType: eventType || "content" });
          }
        }
      } catch {
        if (data) {
          legacyChunks.push(data);
          emitProviderEvent(onEvent, { type: "text_delta", text: data, rawType: "raw_sse" });
        }
      }
    }
    return { output: chunks.join("") || fallbackOutput || legacyChunks.join(""), error, eventTypes };
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { output: raw };
  }
}

type ProviderPayloadState = {
  chunks: string[];
  legacyChunks: string[];
  eventTypes: string[];
  error?: string;
  fallbackOutput: string;
  sawResponsesApiEvent: boolean;
};

async function readProviderEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent?: (event: ProviderStreamEvent) => void,
): Promise<Record<string, unknown>> {
  const state: ProviderPayloadState = {
    chunks: [],
    legacyChunks: [],
    eventTypes: [],
    fallbackOutput: "",
    sawResponsesApiEvent: false,
  };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      processProviderSseBlock(block, state, onEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) processProviderSseBlock(buffer, state, onEvent);
  return {
    output: state.chunks.join("") || state.fallbackOutput || state.legacyChunks.join(""),
    error: state.error,
    eventTypes: state.eventTypes,
  };
}

function processProviderSseBlock(
  block: string,
  state: ProviderPayloadState,
  onEvent?: (event: ProviderStreamEvent) => void,
) {
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    processProviderSseData(data, state, onEvent);
  }
}

function processProviderSseData(
  data: string,
  state: ProviderPayloadState,
  onEvent?: (event: ProviderStreamEvent) => void,
) {
  try {
    const parsed = JSON.parse(data);
    const eventType = String(parsed.event || parsed.type || "");
    if (eventType) state.eventTypes.push(eventType);
    if (eventType.startsWith("response.")) state.sawResponsesApiEvent = true;
    if (parsed.__status) {
      emitProviderEvent(onEvent, {
        type: "progress",
        message: String(parsed.__status),
        rawType: eventType || "openai_chat_status",
      });
    }
    if (eventType === "run.failed" || eventType === "response.failed") {
      state.error = stringifyProviderError(parsed.error || parsed.message || "Provider run failed");
      emitProviderEvent(onEvent, { type: "error", message: state.error, rawType: eventType });
    } else if (parsed.error && parsed.error !== true) {
      state.error = stringifyProviderError(parsed.error);
      emitProviderEvent(onEvent, { type: "error", message: state.error, rawType: eventType });
    }
    if (eventType === "error") {
      state.error = stringifyProviderError(parsed.error || parsed.message || "Provider run failed");
      emitProviderEvent(onEvent, { type: "error", message: state.error, rawType: eventType });
      return;
    }
    if (eventType === "thinking" || eventType === "generating" || eventType === "tool_start" || eventType === "tool_done") {
      const message = providerProgressMessage(parsed, eventType);
      if (message) emitProviderEvent(onEvent, { type: "progress", message, rawType: eventType });
      return;
    }
    if (eventType === "response.failed" && parsed.response?.error) {
      state.error = stringifyProviderError(parsed.response.error.message || parsed.response.error.detail || state.error || "Provider run failed");
      emitProviderEvent(onEvent, { type: "error", message: state.error, rawType: eventType });
    }

    if (eventType === "response.output_text.delta") {
      const delta = parsed.delta ?? "";
      if (delta) {
        const text = String(delta);
        state.chunks.push(text);
        emitProviderEvent(onEvent, { type: "text_delta", text, rawType: eventType });
      }
      return;
    }
    if (eventType === "response.output_text.done") {
      if (parsed.text && !state.fallbackOutput) state.fallbackOutput = String(parsed.text);
      return;
    }
    if (eventType === "response.completed" || eventType === "response.failed") {
      const text = extractResponsesOutputText(parsed.response);
      if (text && !state.fallbackOutput) state.fallbackOutput = text;
      return;
    }
    if (eventType === "message.delta") {
      const delta = parsed.delta ?? "";
      if (delta) {
        const text = String(delta);
        state.legacyChunks.push(text);
        emitProviderEvent(onEvent, { type: "text_delta", text, rawType: eventType });
      }
      return;
    }
    if (eventType === "run.completed") {
      const output = parsed.output ?? "";
      if (output && !state.fallbackOutput) state.fallbackOutput = String(output);
      return;
    }
    if (eventType === "run.failed") {
      state.error = stringifyProviderError(parsed.error || parsed.message || state.error || "Provider run failed");
      return;
    }

    if (!state.sawResponsesApiEvent) {
      const content = parsed.output
        || parsed.text
        || parsed.message
        || parsed.content
        || parsed.delta
        || parsed.choices?.[0]?.delta?.content
        || "";
      if (content) {
        const text = String(content);
        state.legacyChunks.push(text);
        emitProviderEvent(onEvent, { type: "text_delta", text, rawType: eventType || "content" });
        const files = extractProviderFileHints(text);
        if (files.length) emitProviderEvent(onEvent, { type: "artifact_hint", files, rawType: eventType || "content" });
      }
    }
  } catch {
    if (data) {
      state.legacyChunks.push(data);
      emitProviderEvent(onEvent, { type: "text_delta", text: data, rawType: "raw_sse" });
    }
  }
}

function emitProviderEvent(onEvent: ((event: ProviderStreamEvent) => void) | undefined, event: ProviderStreamEvent) {
  if (!onEvent) return;
  try {
    onEvent(event);
  } catch (error: any) {
    console.warn("[ProviderEvent] listener failed:", error?.message || String(error));
  }
}

function providerProgressMessage(parsed: Record<string, unknown>, eventType: string): string {
  const explicit = parsed.message || parsed.status || parsed.display_name || parsed.name || parsed.tool;
  if (explicit) return String(explicit);
  if (eventType === "thinking") return "正在制定分析路径...";
  if (eventType === "generating") return "正在生成最终结果...";
  if (eventType === "tool_start") return "正在调用工具...";
  if (eventType === "tool_done") return "工具调用完成";
  return "";
}

function extractProviderFileHints(text: string): unknown[] {
  const matches = [...text.matchAll(/<!--\s*__files:\s*([\s\S]*?)\s*-->/g)];
  const files: unknown[] = [];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) files.push(...parsed);
    } catch {
      // Ignore malformed provider hints; artifact discovery still runs later.
    }
  }
  return files;
}

function stringifyProviderError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const detail = obj.detail || obj.message || obj.error;
    if (detail) return String(detail);
    try {
      return JSON.stringify(obj);
    } catch {
      return "Provider run failed";
    }
  }
  if (value === true) return "Provider run failed";
  return String(value || "Provider run failed");
}

function extractResponsesOutputText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const output = (response as Record<string, unknown>).output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (obj.type !== "message" || !Array.isArray(obj.content)) continue;
    for (const content of obj.content) {
      if (!content || typeof content !== "object") continue;
      const contentObj = content as Record<string, unknown>;
      const text = contentObj.text || contentObj.output_text;
      if (text) parts.push(String(text));
    }
  }
  return parts.join("");
}

export function endpointWithPath(endpoint: string, pathname: string): string {
  const url = new URL(endpoint);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function coerceArtifacts(raw: unknown): AgentArtifact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const name = String(obj.name || obj.fileName || `artifact-${index + 1}`);
      const type = String(obj.type || "file") as AgentArtifact["type"];
      const downloadUrl = String(obj.downloadUrl || obj.url || `/api/admin/agent-cluster-lab/artifacts/${encodeURIComponent(name)}`);
      const artifact: AgentArtifact = {
        id: String(obj.id || `artifact-${index + 1}`),
        type,
        name,
        mimeType: obj.mimeType ? String(obj.mimeType) : undefined,
        language: obj.language ? String(obj.language) : undefined,
        previewUrl: obj.previewUrl ? String(obj.previewUrl) : undefined,
        downloadUrl,
        metadata: redactSecrets(obj) as Record<string, unknown>,
      };
      if (artifact.type === "code" && !artifact.language) artifact.language = "text";
      return artifact;
    })
    .filter(Boolean) as AgentArtifact[];
}

export function payloadToRunResult(input: {
  provider: AgentProvider;
  definition: AgentDefinition;
  context: AgentCallContext;
  payload: Record<string, unknown>;
  status?: "success" | "failed";
  error?: { code: string; detail: string };
  resolved?: ProviderResolvedBinding;
}): AgentRunResult {
  const output = String(input.payload.output || input.payload.text || input.payload.message || input.payload.result || "");
  const status = input.status || (input.error ? "failed" : "success");
  return sanitizeRunResult({
    id: `${input.definition.id}-${Date.now()}`,
    envelopeVersion: "v1",
    agentDefinitionId: input.definition.id,
    clusterRunId: input.context.clusterRunId,
    status,
    summary: output ? output.slice(0, 500) : undefined,
    output,
    artifacts: coerceArtifacts(input.payload.artifacts),
    metadata: {
      providerKey: input.provider.providerKey,
      runtimeFamily: input.provider.runtimeFamily,
      transportKind: input.provider.transport?.kind || "direct",
      remoteAgentId: input.resolved?.remoteAgentId,
      localAgentId: input.resolved?.localAgentId || input.definition.profileRef,
      providerStatus: input.payload.status,
      providerMetadata: input.payload.metadata,
      resolverMetadata: input.resolved?.metadata,
    },
    error: input.error,
    producedAt: new Date().toISOString(),
  });
}
