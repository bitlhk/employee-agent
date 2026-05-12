export type OpenClawRuntimeId = string;
export type OpenClawSessionKey = string;
export type OpenClawSessionId = string;

// RuntimeEvent represents facts emitted by OpenClaw itself. Lingxia transport
// inferences such as upstream EOF, client_close, or recovered/truncated states
// intentionally stay in the transport layer rather than this union.
// The "error" variant is limited to OpenClaw-side failures, including runtime
// errors and RPC failures surfaced by OpenClaw. Transport failures stay outside.
export type RuntimeFinishReason = "stop" | "length" | "tool_calls" | "function_call";

export type RuntimeEvent =
  | { type: "delta"; content: string }
  | { type: "thinking"; content: string }
  | {
      type: "tool_call";
      phase: "start" | "result";
      toolCallId?: string;
      name?: string;
      args?: unknown;
      result?: unknown;
      isError?: boolean;
    }
  | {
      type: "command_output";
      phase: "delta" | "end";
      toolCallId?: string;
      output?: string;
    }
  | { type: "item_status"; progressText: string }
  | { type: "lifecycle_end" }
  | { type: "chat_final" }
  | { type: "stream_done" }
  | { type: "finish_reason"; reason: RuntimeFinishReason }
  | { type: "error"; message: string };

export interface OpenClawSessionIndexEntry {
  sessionId?: string;
  [key: string]: unknown;
}

export type OpenClawSessionIndex = Record<string, OpenClawSessionIndexEntry>;

export interface OpenClawTraceArtifactData {
  capturedAt?: string | number;
  finalStatus?: string;
  assistantTexts?: unknown[];
  [key: string]: unknown;
}

export interface OpenClawTraceArtifactEvent {
  type: "trace.artifacts";
  data?: OpenClawTraceArtifactData;
  [key: string]: unknown;
}

export type OpenClawArtifactLookup =
  | {
      status: "found";
      sessionKey: OpenClawSessionKey;
      sessionId: OpenClawSessionId;
      artifact: OpenClawTraceArtifactEvent;
      capturedAtMs: number;
    }
  | {
      status: "pending";
      reason:
        | "sessions_json_missing"
        | "sessions_json_unreadable"
        | "no_session_yet"
        | "trajectory_missing"
        | "no_artifacts_yet";
      sessionKey: OpenClawSessionKey;
      sessionId?: OpenClawSessionId;
    };
