import type { ChatEvent } from "@shared/runtime/chat-event";
import type { ToolCallEntry } from "@/components/ChatMessage";

export type LingxiaChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timeLabel: string;
  status?: string;
  usage?: { input: number; output: number };
  model?: string;
  contextWindow?: number;
  contextPercent?: number;
  toolCalls?: ToolCallEntry[];
  recovering?: boolean;
  recovered?: boolean;
  recoveryFailed?: boolean;
  partialText?: string;
};

export type ChatStateReduceOptions = {
  nowMs?: number;
  targetMessageId?: string;
  adoptId?: string;
};

const LENGTH_LIMIT_WARNING = "\n\n_⚠️ 已达模型长度上限，输出可能不完整_";

function now(options: ChatStateReduceOptions): number {
  return options.nowMs ?? Date.now();
}

function findTargetAssistantIndex(messages: LingxiaChatMessage[], targetMessageId?: string): number {
  if (targetMessageId) {
    const idx = messages.findIndex((msg) => msg.id === targetMessageId && msg.role === "assistant");
    return idx;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

function resolveTargetMessageId(event: ChatEvent, options: ChatStateReduceOptions): string | undefined {
  if ("messageId" in event && typeof event.messageId === "string" && event.messageId) {
    return event.messageId;
  }
  return options.targetMessageId;
}

function updateAssistant(
  messages: LingxiaChatMessage[],
  targetMessageId: string | undefined,
  updater: (message: LingxiaChatMessage) => LingxiaChatMessage,
): LingxiaChatMessage[] {
  const idx = findTargetAssistantIndex(messages, targetMessageId);
  if (idx < 0) return messages;
  const next = [...messages];
  next[idx] = updater(next[idx]);
  return next;
}

function markThinkingDone(message: LingxiaChatMessage, nowMs: number): LingxiaChatMessage {
  const toolCalls = message.toolCalls;
  if (!toolCalls?.some((tc) => tc.name === "thinking" && tc.status === "running")) return message;
  return {
    ...message,
    toolCalls: toolCalls.map((tc) => (
      tc.name === "thinking" && tc.status === "running"
        ? { ...tc, status: "done", durationMs: nowMs - tc.ts }
        : tc
    )),
  };
}

function appendThinking(message: LingxiaChatMessage, content: string, nowMs: number): LingxiaChatMessage {
  const toolCalls = message.toolCalls ?? [];
  const runningIdx = toolCalls.findIndex((tc) => tc.name === "thinking" && tc.status === "running");
  if (runningIdx >= 0) {
    const nextToolCalls = [...toolCalls];
    const current = nextToolCalls[runningIdx];
    nextToolCalls[runningIdx] = {
      ...current,
      result: `${current.result ?? ""}${content}`,
    };
    return { ...message, toolCalls: nextToolCalls };
  }

  return {
    ...message,
    toolCalls: [
      ...toolCalls,
      {
        id: `thinking-${nowMs}`,
        name: "thinking",
        arguments: "{}",
        result: content,
        status: "running",
        ts: nowMs,
        executor: "gateway",
        _gateway: true,
      },
    ],
  };
}

function applyToolStart(message: LingxiaChatMessage, event: Extract<ChatEvent, { type: "tool_call" }>, nowMs: number): LingxiaChatMessage {
  return {
    ...message,
    toolCalls: [
      ...(message.toolCalls ?? []),
      {
        id: event.toolCallId || `tool-${nowMs}`,
        name: event.name || "unknown",
        arguments: event.args || "{}",
        status: "running",
        ts: nowMs,
        executor: event.gateway ? "gateway" : undefined,
        _gateway: event.gateway,
      },
    ],
  };
}

function applyToolResult(message: LingxiaChatMessage, event: Extract<ChatEvent, { type: "tool_call" }>, nowMs: number): LingxiaChatMessage {
  const toolCalls = message.toolCalls ?? [];
  if (toolCalls.length === 0) return message;
  const idx = toolCalls.findIndex((tc) => tc.id === event.toolCallId);
  if (idx < 0) return message;

  const nextToolCalls = [...toolCalls];
  const current = nextToolCalls[idx];
  nextToolCalls[idx] = {
    ...current,
    result: event.result ?? current.result,
    status: event.isError ? "error" : "done",
    durationMs: nowMs - current.ts,
    executor: event.executor as ToolCallEntry["executor"],
    truncated: event.truncated,
    outputFiles: event.outputFiles as ToolCallEntry["outputFiles"],
    adoptId: event.adoptId,
  };

  return { ...message, toolCalls: nextToolCalls };
}

function attachWorkspaceFiles(message: LingxiaChatMessage, event: Extract<ChatEvent, { type: "workspace.files" }>, nowMs: number, adoptId?: string): LingxiaChatMessage {
  if (event.files.length === 0) return message;
  const toolCall: ToolCallEntry = {
    id: `ws-files-${nowMs}`,
    name: "[产出文件]",
    arguments: "{}",
    result: event.files.map((file) => file.name).join(", "),
    status: "done",
    ts: nowMs,
    executor: "native",
    outputFiles: event.files.map((file) => ({ name: file.name, size: file.size ?? 0 })),
    adoptId: event.adoptId ?? adoptId,
  };
  return {
    ...message,
    toolCalls: [...(message.toolCalls ?? []), toolCall],
  };
}

/**
 * Pure ChatEvent -> message-state reducer.
 *
 * Intentionally excludes user actions such as pushing the user's own message,
 * clearing history, deleting messages, localStorage writes, fetch polling, and
 * command_output buffering. Those are owned by the future useChat hook.
 */
export function reduceLingxiaChatState(
  messages: LingxiaChatMessage[],
  event: ChatEvent,
  options: ChatStateReduceOptions = {},
): LingxiaChatMessage[] {
  const nowMs = now(options);
  const targetMessageId = resolveTargetMessageId(event, options);

  switch (event.type) {
    case "delta":
      return updateAssistant(messages, targetMessageId, (message) => {
        const done = markThinkingDone(message, nowMs);
        return { ...done, text: `${done.text}${event.content}` };
      });

    case "thinking":
      return updateAssistant(messages, targetMessageId, (message) => appendThinking(message, event.content, nowMs));

    case "tool_call":
      return updateAssistant(messages, targetMessageId, (message) => (
        event.phase === "start"
          ? applyToolStart(message, event, nowMs)
          : applyToolResult(message, event, nowMs)
      ));

    case "workspace.files":
      return updateAssistant(messages, targetMessageId, (message) => attachWorkspaceFiles(message, event, nowMs, options.adoptId));

    case "item_status":
      return updateAssistant(messages, targetMessageId, (message) => ({
        ...message,
        status: event.text || event.label || message.status,
      }));

    case "finish_reason":
      if (event.reason !== "stop") return messages;
      return updateAssistant(messages, targetMessageId, (message) => markThinkingDone(message, nowMs));

    case "transport.truncated":
      return updateAssistant(messages, targetMessageId, (message) => ({
        ...message,
        recovering: true,
        recovered: false,
        recoveryFailed: false,
        partialText: message.text,
      }));

    case "transport.recovered":
      return updateAssistant(messages, targetMessageId, (message) => ({
        ...message,
        text: event.text,
        recovering: false,
        recovered: true,
        recoveryFailed: false,
        partialText: undefined,
      }));

    case "transport.recovery_failed":
      return updateAssistant(messages, targetMessageId, (message) => ({
        ...message,
        recovering: false,
        recovered: false,
        recoveryFailed: true,
        text: message.text.includes("内容恢复失败")
          ? message.text
          : `${message.text}\n\n_⚠️ 内容恢复失败${event.reason ? `：${event.reason}` : ""}_`,
      }));

    case "transport.length_limit":
      return updateAssistant(messages, targetMessageId, (message) => ({
        ...message,
        text: message.text.includes(LENGTH_LIMIT_WARNING) ? message.text : `${message.text}${LENGTH_LIMIT_WARNING}`,
      }));

    case "transport.error":
    case "error":
      return updateAssistant(messages, targetMessageId, (message) => ({
        ...message,
        text: message.text || `（${event.message || "连接异常"}）`,
      }));

    default:
      return messages;
  }
}
