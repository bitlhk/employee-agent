import { describe, expect, it } from "vitest";
import { SecretHandle } from "../../../../shared/lib/secret-handle";
import { HermesProvider } from "../providers/hermes-provider";
import { definition, provider } from "./provider-fixtures";

const context = { adoptId: "lgc-test", userId: 1, agentId: "agent-1" };

describe("HermesProvider", () => {
  it("converts SSE success into an agent envelope", async () => {
    const fetchImpl = async () => new Response('data: {"delta":"hello "}\n\ndata: {"delta":"world"}\n\ndata: [DONE]\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition(),
      provider: provider(),
      prompt: "hello",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("hello world");
      expect(result.value.agentDefinitionId).toBe("agent-1");
    }
  });

  it("converts 5xx into a failed envelope", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "backend exploded" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition(),
      provider: provider(),
      prompt: "hello",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("http_502");
    }
  });

  it("converts timeout into a failed envelope", async () => {
    const fetchImpl = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

    const result = await new HermesProvider(provider({ timeoutMs: 1 }), fetchImpl as any).dispatch({
      definition: definition({ timeoutMs: 1 }),
      provider: provider({ timeoutMs: 1 }),
      prompt: "hello",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("timeout");
    }
  });

  it("strips provider-returned token-like metadata", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      output: "safe",
      metadata: { apiToken: "leak", nested: { authorization: "bad", ok: "yes" } },
    }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition(),
      provider: provider(),
      prompt: "hello",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain("leak");
      expect(serialized).not.toContain("authorization");
      expect(serialized).toContain("safe");
    }
  });

  it("uses SecretHandle auth only in the request header", async () => {
    let authHeader = "";
    let body = "";
    const fetchImpl = async (_url: string, init: RequestInit) => {
      authHeader = String((init.headers as Record<string, string>).authorization || "");
      body = String(init.body || "");
      return new Response(JSON.stringify({ output: "safe" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await new HermesProvider(provider({ authType: "bearer-token" }), fetchImpl as any).dispatch({
      definition: definition(),
      provider: provider({ authType: "bearer-token" }),
      prompt: "hello",
      context,
      resolved: { endpoint: "http://provider.test/run", auth: SecretHandle.of("header-token") },
    });

    expect(authHeader).toBe("Bearer header-token");
    expect(body).not.toContain("header-token");
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.value)).not.toContain("header-token");
  });

  it("uses the Hermes v1 runs protocol when the legacy resolver marks the binding", async () => {
    const calls: Array<{ url: string; method?: string; headers: Record<string, string>; body?: string }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: String(init.body || ""),
      });
      if (url.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/runs/run-1/events")) {
        return new Response('data: {"delta":"财富"}\n\ndata: {"delta":"顾问"}\n\ndata: [DONE]\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await new HermesProvider(provider({ authType: "bearer-token" }), fetchImpl as any).dispatch({
      definition: definition({ id: "task-my-wealth", profileRef: "task-my-wealth" }),
      provider: provider({ authType: "bearer-token" }),
      prompt: "说明能力",
      context: { ...context, clusterRunId: "cluster-run-1" },
      resolved: {
        endpoint: "http://127.0.0.1:8642",
        auth: SecretHandle.of("hermes-token"),
        remoteAgentId: "hermes-agent",
        localAgentId: "task-my-wealth",
        metadata: { adapterProtocol: "hermes-v1-runs" },
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://127.0.0.1:8642/v1/runs");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.authorization).toBe("Bearer hermes-token");
    expect(calls[0].headers["x-hermes-user-id"]).toBe("lingxia_user_1");
    expect(calls[0].body).toContain('"session_id":"cluster-run-1"');
    expect(calls[0].body).toContain('"remoteAgentId":"hermes-agent"');
    expect(calls[0].body).not.toContain("hermes-token");
    expect(calls[1].url).toBe("http://127.0.0.1:8642/v1/runs/run-1/events");
    expect(calls[1].method).toBe("GET");
    expect(calls[1].headers.authorization).toBe("Bearer hermes-token");
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("财富顾问");
      expect(JSON.stringify(result.value)).not.toContain("hermes-token");
    }
  });

  it("does not duplicate OpenAI Responses-style delta/done/completed text", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-openai-events" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response([
        'data: {"type":"response.created","response":{"status":"in_progress","output":[]}}',
        "",
        'data: {"type":"response.output_text.delta","delta":"财富"}',
        "",
        'data: {"type":"response.output_text.delta","delta":"顾问"}',
        "",
        'data: {"type":"response.output_text.done","text":"财富顾问"}',
        "",
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"财富顾问"}]}]}}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition({ id: "task-my-wealth" }),
      provider: provider(),
      prompt: "说明能力",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8642",
        auth: null,
        metadata: { adapterProtocol: "hermes-v1-runs" },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("财富顾问");
    }
  });

  it("does not duplicate Hermes message.delta and run.completed output", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-hermes-events" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response([
        'data: {"event":"message.delta","delta":"财富"}',
        "",
        'data: {"event":"message.delta","delta":"顾问"}',
        "",
        'data: {"event":"run.completed","output":"财富顾问"}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition({ id: "task-my-wealth" }),
      provider: provider(),
      prompt: "说明能力",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8642",
        auth: null,
        metadata: { adapterProtocol: "hermes-v1-runs" },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("财富顾问");
    }
  });

  it("treats Hermes run.completed error=true as non-terminal when output exists", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-completed-bool-error" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response([
        'data: {"event":"message.delta","delta":"wealth "}',
        "",
        'data: {"event":"message.delta","delta":"advisor"}',
        "",
        'data: {"event":"run.completed","output":"wealth advisor","error":true}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition({ id: "task-my-wealth" }),
      provider: provider(),
      prompt: "describe capabilities",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8642",
        auth: null,
        metadata: { adapterProtocol: "hermes-v1-runs" },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("wealth advisor");
      expect(result.value.error).toBeUndefined();
    }
  });

  it("surfaces Hermes v1 run.failed events as failed envelopes", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-failed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response('data: {"event":"run.failed","error":"refresh token consumed"}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new HermesProvider(provider(), fetchImpl as any).dispatch({
      definition: definition({ id: "task-my-wealth" }),
      provider: provider(),
      prompt: "说明能力",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8642",
        auth: null,
        metadata: { adapterProtocol: "hermes-v1-runs" },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("run_failed");
      expect(result.value.error?.detail).toContain("refresh token consumed");
    }
  });
});
