import type { ChatEvent } from "@shared/runtime/chat-event";

export type ChatTransportKind = "http" | "ws";

export type ChatTransportState =
  | "idle"
  | "connecting"
  | "connected"
  | "streaming"
  | "reconnecting"
  | "closed"
  | "error";

export type ChatSendPayload = {
  adoptId: string;
  message: string;
  channel?: string;
  conversationId?: string;
  userMessageId?: string;
  clientRunId?: string;
  memoryEnabled?: boolean;
  contextTurns?: number;
  skillContext?: unknown;
};

export type ChatTransportContext = {
  userId?: number;
  adoptId?: string;
  agentId?: string;
  channel?: string;
  conversationId?: string;
  sessionKey?: string;
};

export type ChatTransportSnapshot = {
  kind: ChatTransportKind;
  state: ChatTransportState;
  context?: ChatTransportContext;
  lastEventAt?: number;
  error?: string;
};

export type ChatEventHandler = (event: ChatEvent) => void;
export type ChatTransportUnsubscribe = () => void;

export type ChatTransport = {
  readonly kind: ChatTransportKind;
  getSnapshot(): ChatTransportSnapshot;
  subscribe(handler: ChatEventHandler): ChatTransportUnsubscribe;
  send(payload: ChatSendPayload, signal?: AbortSignal): Promise<void>;
  close(reason?: string): void;
};

export class ChatTransportError extends Error {
  readonly transport: ChatTransportKind;
  readonly cause?: unknown;

  constructor(transport: ChatTransportKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ChatTransportError";
    this.transport = transport;
    this.cause = cause;
  }
}
