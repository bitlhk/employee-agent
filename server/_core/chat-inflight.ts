type ChatTransportName = "ws" | "http";

export type ChatRunCompleteReason =
  | "lifecycle_end"
  | "chat_final"
  | "finish_reason"
  | "stream_done"
  | "platform_handled"
  | "gateway_error"
  | "gateway_close"
  | "http_done"
  | "http_error"
  | "http_abnormal"
  | "length_limit"
  | "manual";

export type ChatRunRecord = {
  sessionKey: string;
  clientRunId: string;
  runId: string;
  transport: ChatTransportName;
  startedAt: number;
  lastEventAt: number;
  messagePreview?: string;
};

export type MarkChatRunStartedResult =
  | { status: "started"; run: ChatRunRecord }
  | { status: "in_flight"; run: ChatRunRecord };

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const runs = new Map<string, ChatRunRecord>();
let now = () => Date.now();

export function isChatSendDedupEnabled(): boolean {
  const value = String(process.env.CHAT_SEND_DEDUP ?? "on").toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export function normalizeClientRunId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 128);
}

export function makeChatRunKey(sessionKey: string, clientRunId: string): string {
  return `${sessionKey}:${clientRunId}`;
}

export function makeChatSessionRunKey(sessionKey: string): string {
  return sessionKey;
}

function ttlMs(): number {
  const parsed = Number(process.env.CHAT_SEND_DEDUP_TTL_MS || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

function sweepExpired() {
  const cutoff = now() - ttlMs();
  for (const [key, run] of runs) {
    if (run.lastEventAt < cutoff) {
      runs.delete(key);
      console.warn("[CHAT-DEDUP] expired in-flight run", {
        sessionKey: run.sessionKey,
        clientRunId: run.clientRunId,
        runId: run.runId,
      });
    }
  }
}

export function markChatRunStarted(args: {
  sessionKey: string;
  clientRunId?: string;
  transport: ChatTransportName;
  message?: string;
}): MarkChatRunStartedResult | null {
  if (!isChatSendDedupEnabled() || !args.clientRunId) return null;
  sweepExpired();

  const key = makeChatSessionRunKey(args.sessionKey);
  const existing = runs.get(key);
  if (existing) {
    existing.lastEventAt = now();
    console.warn("[CHAT-DEDUP] hit existing in-flight run", {
      sessionKey: args.sessionKey,
      clientRunId: args.clientRunId,
      transport: args.transport,
      existingTransport: existing.transport,
      runId: existing.runId,
    });
    return { status: "in_flight", run: existing };
  }

  const ts = now();
  const run: ChatRunRecord = {
    sessionKey: args.sessionKey,
    clientRunId: args.clientRunId,
    runId: `lingxia:${args.clientRunId}:${ts}`,
    transport: args.transport,
    startedAt: ts,
    lastEventAt: ts,
    messagePreview: args.message ? args.message.slice(0, 160) : undefined,
  };
  runs.set(key, run);
  return { status: "started", run };
}

export function getChatRun(sessionKey: string, clientRunId?: string): ChatRunRecord | undefined {
  if (!clientRunId) return undefined;
  sweepExpired();
  return runs.get(makeChatSessionRunKey(sessionKey));
}

export function touchChatRun(sessionKey: string, clientRunId?: string, reason?: string): void {
  if (!clientRunId) return;
  const run = runs.get(makeChatSessionRunKey(sessionKey));
  if (!run) return;
  run.lastEventAt = now();
  if (reason) {
    console.log("[CHAT-DEDUP] touch", { sessionKey, clientRunId, runId: run.runId, reason });
  }
}

export function markChatRunComplete(
  sessionKey: string,
  clientRunId: string | undefined,
  reason: ChatRunCompleteReason,
): void {
  if (!clientRunId) return;
  const key = makeChatSessionRunKey(sessionKey);
  const run = runs.get(key);
  if (!run) return;
  runs.delete(key);
  console.log("[CHAT-DEDUP] complete", { sessionKey, clientRunId, runId: run.runId, reason });
}

export function __resetChatInflightForTests(): void {
  runs.clear();
  now = () => Date.now();
}

export function __setChatInflightNowForTests(fn: () => number): void {
  now = fn;
}
