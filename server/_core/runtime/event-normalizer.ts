import type { RuntimeEvent, RuntimeFinishReason } from "./types";

type JsonObject = Record<string, unknown>;

const VALID_FINISH_REASONS = new Set<RuntimeFinishReason>([
  "stop",
  "length",
  "tool_calls",
  "function_call",
]);

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const s = stringValue(value);
  return s && s.length > 0 ? s : undefined;
}

function contentString(value: unknown): string | undefined {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return undefined;
  const joined = value
    .map((part) => isObject(part) ? stringValue(part.text) || "" : "")
    .join("");
  return joined.length > 0 ? joined : undefined;
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function sessionMatches(payload: JsonObject, expectedSessionKey?: string | null): boolean {
  if (!expectedSessionKey) return true;
  const sessionKey = stringValue(payload.sessionKey);
  return !sessionKey || sessionKey === expectedSessionKey;
}

function messageSessionMatches(msg: JsonObject, payload: JsonObject, expectedSessionKey?: string | null): boolean {
  if (!expectedSessionKey) return true;
  const sessionKey = stringValue(payload.sessionKey) || stringValue(msg.sessionKey);
  return !sessionKey || sessionKey === expectedSessionKey;
}

function isWsSessionTerminalEvent(event: string | undefined): boolean {
  if (!event) return false;
  const normalized = event.toLowerCase();
  return normalized === "sessions.stream.end"
    || normalized === "sessions.done"
    || normalized === "session.done"
    || normalized === "stream.end"
    || normalized === "run.completed"
    || normalized === "chat.completed";
}

function isTerminalDonePayload(msg: JsonObject, payload: JsonObject): boolean {
  return msg.done === true || payload.done === true;
}

function normalizeErrorMessage(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (isObject(value)) {
    const message = stringValue(value.message);
    if (message && message.trim()) return message;
  }
  return "Runtime error";
}

function normalizeFinishReason(value: unknown): RuntimeFinishReason | null {
  if (typeof value !== "string") return null;
  return VALID_FINISH_REASONS.has(value as RuntimeFinishReason)
    ? (value as RuntimeFinishReason)
    : null;
}

function single(event: RuntimeEvent | null): RuntimeEvent[] {
  return event ? [event] : [];
}

export type WsNormalizeResult =
  | { kind: "events"; events: RuntimeEvent[] }
  | { kind: "noop"; reason: string }
  | { kind: "ignored"; reason: string }
  | { kind: "unmatched"; reason: string };

function events(events: RuntimeEvent[]): WsNormalizeResult {
  return { kind: "events", events };
}

function noop(reason: string): WsNormalizeResult {
  return { kind: "noop", reason };
}

function ignored(reason: string): WsNormalizeResult {
  return { kind: "ignored", reason };
}

function unmatched(reason: string): WsNormalizeResult {
  return { kind: "unmatched", reason };
}

// Normalize OpenClaw native WS/control-ui events into the stable Lingxia
// runtime event model. Transport-level observations stay outside this layer.
export function normalizeWsEvent(msg: unknown, expectedSessionKey?: string | null): WsNormalizeResult {
  if (!isObject(msg)) return ignored("non_object");

  const type = stringValue(msg.type);
  const event = stringValue(msg.event);
  if (event === "health" || event === "tick" || event === "heartbeat") return ignored("heartbeat");
  const payload = objectValue(msg.payload);

  // OpenClaw has shipped multiple WS terminal shapes over time. Treat only
  // session/chat/run-level terminal events as conversation completion; tool
  // completion remains a tool lifecycle event and must not finish the chat.
  if (
    (isWsSessionTerminalEvent(event) || isTerminalDonePayload(msg, payload))
    && messageSessionMatches(msg, payload, expectedSessionKey)
  ) {
    return events([{ type: "lifecycle_end" }]);
  }

  if (type === "res" && msg.ok === false) {
    // Control-plane RPC failures are OpenClaw-side failures. They are not
    // transport inferences, so callers may handle them through RuntimeEvent.
    return events([{ type: "error", message: normalizeErrorMessage(msg.error) }]);
  }

  if (type !== "event") return ignored("non_event");

  if (!sessionMatches(payload, expectedSessionKey)) return ignored("session_mismatch");

  if (event === "chat") {
    // chat.delta carries a cumulative message snapshot for OpenClaw control UI.
    // Lingxia consumes streaming text from agent/assistant events instead, so
    // treating chat.delta as a RuntimeEvent would risk duplicate appends.
    if (payload.state === "delta") return noop("chat_delta_snapshot");
    return payload.state === "final" ? events([{ type: "chat_final" }]) : unmatched("unknown_chat_state");
  }

  if (event !== "agent") return ignored("non_runtime_event");

  const stream = stringValue(payload.stream);
  const data = objectValue(payload.data);
  const phase = stringValue(data.phase);

  if (stream === "assistant") {
    const content = nonEmptyString(data.delta);
    return content ? events([{ type: "delta", content }]) : noop("assistant_empty_delta");
  }

  if (stream === "thinking") {
    const content = nonEmptyString(data.delta);
    return content ? events([{ type: "thinking", content }]) : noop("thinking_empty_delta");
  }

  if (stream === "tool") {
    if (phase === "start") {
      return events([{
        type: "tool_call",
        phase: "start",
        toolCallId: stringValue(data.toolCallId),
        name: stringValue(data.name),
        args: data.args,
      }]);
    }
    if (phase === "result") {
      return events([{
        type: "tool_call",
        phase: "result",
        toolCallId: stringValue(data.toolCallId),
        result: data.result,
        isError: Boolean(data.isError),
      }]);
    }
    if (phase === "update") return noop("tool_update");
    return unmatched("unknown_tool_phase");
  }

  if (stream === "command_output" && (phase === "delta" || phase === "end")) {
    return events([{
      type: "command_output",
      phase,
      toolCallId: stringValue(data.toolCallId),
      output: stringValue(data.output),
    }]);
  }
  if (stream === "command_output") return unmatched("unknown_command_output_phase");

  if (stream === "item") {
    if (phase === "update") {
      const progressText = nonEmptyString(data.progressText);
      return progressText ? events([{ type: "item_status", progressText }]) : noop("item_update_without_progress");
    }
    if (phase === "start" || phase === "end") return noop(`item_${phase}`);
    return unmatched("unknown_item_phase");
  }

  if (stream === "lifecycle" && phase === "end") {
    return events([{ type: "lifecycle_end" }]);
  }
  if (stream === "lifecycle" && phase === "start") return noop("lifecycle_start");

  return unmatched("unknown_agent_stream");
}

// Normalize one OpenAI-compatible SSE data line from OpenClaw. Pass either the
// full "data: ..." line or the raw data payload. JSON parse failures are noise.
export function normalizeHttpSseLine(rawDataLine: string, eventName = ""): RuntimeEvent[] {
  const trimmed = rawDataLine.trim();
  const dataLine = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!dataLine) return [];
  if (dataLine === "[DONE]") return [{ type: "stream_done" }];

  let chunk: unknown;
  try {
    chunk = JSON.parse(dataLine);
  } catch {
    return [];
  }
  if (!isObject(chunk)) return [];

  if (eventName === "tool_call") {
    return [{
      type: "tool_call",
      phase: "start",
      toolCallId: stringValue(chunk.toolCallId) || stringValue(chunk.id),
      name: stringValue(chunk.name),
      args: chunk.args,
    }];
  }

  if (eventName === "tool_result") {
    return [{
      type: "tool_call",
      phase: "result",
      toolCallId: stringValue(chunk.toolCallId) || stringValue(chunk.id),
      result: chunk.result,
      isError: Boolean(chunk.isError),
    }];
  }

  if (chunk.error != null) {
    return [{ type: "error", message: normalizeErrorMessage(chunk.error) }];
  }

  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const firstChoice = objectValue(choices[0]);
  const delta = objectValue(firstChoice.delta);
  const events: RuntimeEvent[] = [];

  const content = contentString(delta.content);
  if (content) events.push({ type: "delta", content });

  const reasoning = nonEmptyString(delta.reasoning_content);
  if (reasoning) events.push({ type: "thinking", content: reasoning });

  const finishReason = normalizeFinishReason(firstChoice.finish_reason);
  if (finishReason) events.push({ type: "finish_reason", reason: finishReason });

  return events;
}
