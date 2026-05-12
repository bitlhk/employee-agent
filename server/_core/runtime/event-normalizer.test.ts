import { describe, expect, it } from "vitest";
import { normalizeHttpSseLine, normalizeWsEvent } from "./event-normalizer";

function wsEvents(msg: unknown, sessionKey = "agent:a:main") {
  const result = normalizeWsEvent(msg, sessionKey);
  return result.kind === "events" ? result.events : [];
}

describe("runtime event normalizer", () => {
  it("ignores HTTP chunks with error:null", () => {
    const events = normalizeHttpSseLine(JSON.stringify({
      error: null,
      choices: [{ delta: {}, finish_reason: "stop" }],
    }));

    expect(events).toEqual([{ type: "finish_reason", reason: "stop" }]);
  });

  it("emits both delta and finish_reason from a combined HTTP chunk", () => {
    const events = normalizeHttpSseLine(`data: ${JSON.stringify({
      choices: [{ delta: { content: "pong" }, finish_reason: "stop" }],
    })}`);

    expect(events).toEqual([
      { type: "delta", content: "pong" },
      { type: "finish_reason", reason: "stop" },
    ]);
  });

  it("normalizes array-form HTTP content deltas", () => {
    const events = normalizeHttpSseLine(JSON.stringify({
      choices: [{ delta: { content: [{ type: "text", text: "po" }, { type: "text", text: "ng" }] } }],
    }));

    expect(events).toEqual([{ type: "delta", content: "pong" }]);
  });

  it("filters WS events for other session keys", () => {
    const events = wsEvents({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "assistant",
        data: { delta: "hidden" },
      },
    }, "agent:b:main");

    expect(events).toEqual([]);
  });

  it("normalizes representative WS runtime events", () => {
    expect(normalizeWsEvent({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "lifecycle",
        data: { phase: "start" },
      },
    }, "agent:a:main")).toEqual({ kind: "noop", reason: "lifecycle_start" });

    expect(normalizeWsEvent({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "item",
        data: { phase: "start" },
      },
    }, "agent:a:main")).toEqual({ kind: "noop", reason: "item_start" });

    expect(normalizeWsEvent({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "item",
        data: { phase: "end" },
      },
    }, "agent:a:main")).toEqual({ kind: "noop", reason: "item_end" });

    expect(wsEvents({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "lifecycle",
        data: { phase: "end" },
      },
    })).toEqual([{ type: "lifecycle_end" }]);

    expect(wsEvents({
      type: "event",
      event: "chat",
      payload: {
        sessionKey: "agent:a:main",
        state: "final",
      },
    })).toEqual([{ type: "chat_final" }]);

    expect(normalizeWsEvent({
      type: "event",
      event: "chat",
      payload: {
        sessionKey: "agent:a:main",
        state: "delta",
        message: { content: [{ type: "text", text: "pong" }] },
      },
    }, "agent:a:main")).toEqual({ kind: "noop", reason: "chat_delta_snapshot" });
  });

  it("classifies known WS update no-ops without unmatched warnings", () => {
    expect(normalizeWsEvent({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "tool",
        data: { phase: "update" },
      },
    }, "agent:a:main")).toEqual({ kind: "noop", reason: "tool_update" });

    expect(normalizeWsEvent({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "item",
        data: { phase: "update" },
      },
    }, "agent:a:main")).toEqual({ kind: "noop", reason: "item_update_without_progress" });

    expect(wsEvents({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "item",
        data: { phase: "update", progressText: "working" },
      },
    })).toEqual([{ type: "item_status", progressText: "working" }]);
  });

  it("normalizes OpenClaw session terminal WS events", () => {
    for (const event of ["sessions.stream.end", "sessions.done", "session.done", "stream.end", "run.completed", "chat.completed"]) {
      expect(wsEvents({
        type: "event",
        event,
        payload: { sessionKey: "agent:a:main" },
      })).toEqual([{ type: "lifecycle_end" }]);
    }

    expect(wsEvents({
      type: "event",
      event: "sessions.status",
      payload: { sessionKey: "agent:a:main", done: true },
    })).toEqual([{ type: "lifecycle_end" }]);

    expect(wsEvents({
      event: "sessions.done",
      sessionKey: "agent:a:main",
    })).toEqual([{ type: "lifecycle_end" }]);
  });

  it("does not treat tool completion as chat completion", () => {
    expect(normalizeWsEvent({
      type: "event",
      event: "tool.completed",
      payload: { sessionKey: "agent:a:main" },
    }, "agent:a:main")).toEqual({ kind: "ignored", reason: "non_runtime_event" });

    expect(normalizeWsEvent({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:a:main",
        stream: "tool",
        data: { phase: "result", toolCallId: "tc_1", result: "ok" },
      },
    }, "agent:a:main")).toEqual({
      kind: "events",
      events: [{
        type: "tool_call",
        phase: "result",
        toolCallId: "tc_1",
        result: "ok",
        isError: false,
      }],
    });
  });
});
