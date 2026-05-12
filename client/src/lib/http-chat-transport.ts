import type { ChatEvent } from "@shared/runtime/chat-event";
import { parseSseBlockToChatEvents } from "./chat-event-parser";
import type {
  ChatEventHandler,
  ChatSendPayload,
  ChatTransport,
  ChatTransportSnapshot,
  ChatTransportState,
} from "./chat-transport";
import { ChatTransportError } from "./chat-transport";

export class HttpChatTransport implements ChatTransport {
  readonly kind = "http" as const;
  private readonly apiBase: string;
  private readonly handlers = new Set<ChatEventHandler>();
  private state: ChatTransportState = "idle";
  private lastEventAt: number | undefined;
  private error: string | undefined;
  private abortController: AbortController | null = null;

  constructor(apiBase = "") {
    this.apiBase = apiBase;
  }

  getSnapshot(): ChatTransportSnapshot {
    return {
      kind: this.kind,
      state: this.state,
      lastEventAt: this.lastEventAt,
      error: this.error,
    };
  }

  subscribe(handler: ChatEventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async send(payload: ChatSendPayload, signal?: AbortSignal): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, this.abortController.signal]) : this.abortController.signal;

    this.setState("streaming");
    this.error = undefined;

    try {
      const response = await fetch(`${this.apiBase}/api/claw/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
        signal: combinedSignal,
      });

      if (!response.ok) {
        throw new ChatTransportError(this.kind, `HTTP chat failed (${response.status})`);
      }
      if (!response.body) {
        throw new ChatTransportError(this.kind, "HTTP chat response body is empty");
      }

      await this.readSse(response.body.getReader());
      if (this.state !== "closed") this.setState("idle");
    } catch (error) {
      if (combinedSignal.aborted) {
        this.setState("closed");
        return;
      }
      const message = error instanceof Error ? error.message : "HTTP chat transport failed";
      this.error = message;
      this.setState("error");
      this.emit({ type: "transport.error", transport: "http", message });
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  close(reason?: string): void {
    this.abortController?.abort(reason);
    this.abortController = null;
    this.setState("closed");
    this.emit({ type: "transport.disconnected", transport: "http", reason });
  }

  private async readSse(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        this.emitMany(parseSseBlockToChatEvents(block));
      }
    }

    if (buffer.trim()) {
      this.emitMany(parseSseBlockToChatEvents(buffer));
    }
  }

  private emitMany(events: ChatEvent[]) {
    for (const event of events) this.emit(event);
  }

  private emit(event: ChatEvent) {
    this.lastEventAt = Date.now();
    for (const handler of this.handlers) handler(event);
  }

  private setState(state: ChatTransportState) {
    this.state = state;
  }
}

