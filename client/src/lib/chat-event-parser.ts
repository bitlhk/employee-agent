import type { ChatEvent } from "@shared/runtime/chat-event";
import type { ChatRuntimeFinishReason } from "@shared/runtime/types";

type JsonRecord = Record<string, unknown>;

const FINISH_REASONS = new Set<ChatRuntimeFinishReason>([
  "stop",
  "length",
  "tool_calls",
  "function_call",
]);

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeError(value: unknown): string {
  if (typeof value === "string" && value) return value;
  if (isRecord(value)) {
    const message = asString(value.message) ?? asString(value.error);
    if (message) return message;
  }
  return "Runtime error";
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item)) return typeof item.text === "string" ? item.text : "";
        return "";
      })
      .join("");
  }
  return value == null ? "" : String(value);
}

function firstChoice(payload: JsonRecord): JsonRecord | undefined {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  return isRecord(first) ? first : undefined;
}

function normalizeFinishReason(value: unknown): ChatRuntimeFinishReason | undefined {
  return typeof value === "string" && FINISH_REASONS.has(value as ChatRuntimeFinishReason)
    ? (value as ChatRuntimeFinishReason)
    : undefined;
}

function normalizeToolStart(payload: JsonRecord): ChatEvent {
  return {
    type: "tool_call",
    phase: "start",
    toolCallId: String(payload.id ?? payload.tool_call_id ?? ""),
    name: asString(payload.name),
    args: typeof payload.arguments === "string" ? payload.arguments : JSON.stringify(payload.arguments ?? {}),
    gateway: Boolean(payload._gateway),
  };
}

function normalizeToolResult(payload: JsonRecord): ChatEvent {
  return {
    type: "tool_call",
    phase: "result",
    toolCallId: String(payload.tool_call_id ?? payload.id ?? ""),
    result: String(payload.result ?? ""),
    isError: Boolean(payload.is_error),
    executor: asString(payload.executor),
    truncated: Boolean(payload.truncated),
    outputFiles: payload.outputFiles,
    adoptId: asString(payload.adoptId),
    gateway: Boolean(payload._gateway),
  };
}

export type ChatWireParseOptions = {
  expectedSessionKey?: string;
};

export function parseWirePayloadToChatEvents(
  payload: unknown,
  eventName = "",
  options: ChatWireParseOptions = {},
): ChatEvent[] {
  if (!isRecord(payload)) return [];
  const payloadSessionKey = asString(payload.sessionKey);
  if (options.expectedSessionKey && payloadSessionKey && payloadSessionKey !== options.expectedSessionKey) {
    return [];
  }

  const wireEvent = asString(payload._event) ?? eventName;
  if (payload.type === "connected") {
    return [{
      type: "transport.connected",
      transport: "ws",
      sessionKey: asString(payload.sessionKey),
      agentId: asString(payload.agentId),
    }];
  }

  if (payload.__stream_end) return [{ type: "transport.stream_end" }];
  if (payload.__done) return [{ type: "transport.done" }];
  if (payload.__in_flight) {
    return [{
      type: "transport.in_flight",
      transport: payload.transport === "ws" ? "ws" : payload.transport === "http" ? "http" : undefined,
      sessionKey: asString(payload.sessionKey),
      clientRunId: asString(payload.clientRunId),
      runId: asString(payload.runId),
      startedAt: asNumber(payload.startedAt),
      lastEventAt: asNumber(payload.lastEventAt),
      reason: asString(payload.reason),
    }];
  }
  if (payload.__stream_end_length) return [{ type: "transport.length_limit" }];
  if (payload.__stream_truncated) {
    return [{
      type: "transport.truncated",
      messageId: asString(payload.messageId),
      adoptId: asString(payload.adoptId),
      sessionKey: asString(payload.sessionKey),
      streamEndMs: asNumber(payload.streamEndMs),
      startedAt: asNumber(payload.startedAt),
      chatCompletionId: asString(payload.chatCompletionId),
      endReason: asString(payload.endReason),
      reason: asString(payload.reason),
    }];
  }
  if (payload.__stream_error) {
    return [{ type: "transport.error", message: normalizeError(payload.error) }];
  }

  if (wireEvent === "tool_call") return [normalizeToolStart(payload)];
  if (wireEvent === "tool_result") return [normalizeToolResult(payload)];
  if (wireEvent === "workspace_files") {
    const files = Array.isArray(payload.files) ? payload.files.filter(isRecord).map((file) => ({
      name: String(file.name ?? ""),
      size: asNumber(file.size),
      path: asString(file.path),
    })) : [];
    return [{ type: "workspace.files", adoptId: asString(payload.adoptId), files }];
  }
  if (wireEvent === "agent_dispatch") {
    const agents = Array.isArray(payload.agents) ? payload.agents.filter(isRecord).map((agent) => ({
      id: String(agent.id ?? ""),
      agentId: asString(agent.agentId),
      name: asString(agent.name),
      prompt: asString(agent.prompt),
    })) : [];
    return [{ type: "agent.dispatch", agents }];
  }
  if (wireEvent === "agent_tool_update") {
    return [{
      type: "agent.tool_update",
      taskId: asString(payload.taskId),
      toolName: asString(payload.toolName),
      toolStatus: asString(payload.toolStatus),
      durationMs: asNumber(payload.durationMs),
    }];
  }
  if (wireEvent === "agent_complete") {
    return [{
      type: "agent.complete",
      taskId: asString(payload.taskId),
      result: asString(payload.result),
      durationMs: asNumber(payload.durationMs),
    }];
  }
  if (wireEvent === "agent_status" || payload.__status) {
    return [{
      type: "item_status",
      kind: asString(payload.kind),
      tool: asString(payload.tool),
      step: asNumber(payload.step),
      total: asNumber(payload.total),
      label: asString(payload.label),
      elapsedMs: asNumber(payload.elapsedMs),
      text: asString(payload.__status),
    }];
  }
  if (payload.__perf && isRecord(payload.__perf)) {
    return [{ type: "perf", data: payload.__perf }];
  }

  if (payload.error != null && !payload.choices) {
    return [{ type: "transport.error", message: normalizeError(payload.error) }];
  }

  const choice = firstChoice(payload);
  if (!choice) return [];

  const events: ChatEvent[] = [];
  const delta = isRecord(choice.delta) ? choice.delta : undefined;
  const reasoning = delta ? asString(delta.reasoning_content) : undefined;
  if (reasoning) events.push({ type: "thinking", content: reasoning });

  const content = delta ? extractTextContent(delta.content) : "";
  if (content) events.push({ type: "delta", content });

  const finishReason = normalizeFinishReason(choice.finish_reason);
  if (finishReason) events.push({ type: "finish_reason", reason: finishReason });

  return events;
}

export function parseSseBlockToChatEvents(block: string, options: ChatWireParseOptions = {}): ChatEvent[] {
  let eventName = "";
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return [];
  const data = dataLines.join("\n");
  if (data === "[DONE]") return [{ type: "transport.done", transport: "http" }];

  try {
    return parseWirePayloadToChatEvents(JSON.parse(data), eventName, options).map((event) => {
      if (!event.type.startsWith("transport.")) return event;
      return { ...event, transport: "transport" in event ? event.transport ?? "http" : "http" } as ChatEvent;
    });
  } catch {
    return [];
  }
}
