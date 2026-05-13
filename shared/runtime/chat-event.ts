import type { ChatRuntimeEvent } from "./types";

export type ChatTransportEvent =
  | { type: "transport.connected"; transport?: "http" | "ws"; sessionKey?: string; agentId?: string }
  | { type: "transport.disconnected"; transport?: "http" | "ws"; reason?: string }
  | {
      type: "transport.in_flight";
      transport?: "http" | "ws";
      sessionKey?: string;
      clientRunId?: string;
      runId?: string;
      startedAt?: number;
      lastEventAt?: number;
      reason?: string;
    }
  | { type: "transport.stream_end"; transport?: "http" | "ws" }
  | { type: "transport.done"; transport?: "http" | "ws" }
  | {
      type: "transport.truncated";
      messageId?: string;
      transport?: "http" | "ws";
      adoptId?: string;
      sessionKey?: string;
      streamEndMs?: number;
      startedAt?: number;
      chatCompletionId?: string;
      endReason?: string;
      reason?: string;
    }
  | { type: "transport.recovered"; messageId: string; text: string; capturedAt?: string | number }
  | { type: "transport.recovery_failed"; messageId: string; reason?: string }
  | { type: "transport.length_limit"; transport?: "http" | "ws" }
  | { type: "transport.error"; transport?: "http" | "ws"; message: string };

export type AgentDispatchTask = {
  id: string;
  agentId?: string;
  name?: string;
  prompt?: string;
};

export type WorkspaceFileEvent = {
  name: string;
  size?: number;
  path?: string;
};

export type ChatBusinessEvent =
  | { type: "agent.dispatch"; agents: AgentDispatchTask[] }
  | {
      type: "agent.tool_update";
      taskId?: string;
      toolName?: string;
      toolStatus?: string;
      durationMs?: number;
    }
  | { type: "agent.complete"; taskId?: string; result?: string; durationMs?: number }
  | { type: "workspace.files"; adoptId?: string; files: WorkspaceFileEvent[] }
  | { type: "perf"; data: Record<string, unknown> };

export type ChatEvent = ChatRuntimeEvent | ChatTransportEvent | ChatBusinessEvent;
