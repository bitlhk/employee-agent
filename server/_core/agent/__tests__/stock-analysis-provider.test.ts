import { describe, expect, it } from "vitest";
import { StockAnalysisProvider } from "../providers/stock-analysis-provider";
import { definition, provider } from "./provider-fixtures";

const context = { adoptId: "lgc-test", userId: 1, agentId: "task-stock", clusterRunId: "cluster-run-1" };

describe("StockAnalysisProvider", () => {
  it("posts to the stock analysis stream endpoint and maps done content", async () => {
    let seenUrl = "";
    let body: any = null;
    const fetchImpl = async (url: string, init: RequestInit) => {
      seenUrl = url;
      body = JSON.parse(String(init.body));
      return new Response([
        'data: {"type":"thinking","message":"分析思考中"}',
        "",
        'data: {"type":"tool_start","tool":"quote","display_name":"行情查询"}',
        "",
        'data: {"type":"tool_done","tool":"quote","display_name":"行情查询"}',
        "",
        'data: {"type":"done","success":true,"content":"股票分析完成","session_id":"cluster-run-1"}',
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new StockAnalysisProvider(provider({ runtimeFamily: "lingxia-local" }), fetchImpl as any).dispatch({
      definition: definition({ id: "task-stock", profileRef: "task-stock" }),
      provider: provider({ runtimeFamily: "lingxia-local" }),
      prompt: "分析招商银行",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8188",
        auth: null,
        metadata: { adapterProtocol: "stock-analysis-v1-agent-stream" },
      },
    });

    expect(seenUrl).toBe("http://127.0.0.1:8188/api/v1/agent/chat/stream");
    expect(body.message).toBe("分析招商银行");
    expect(body.session_id).toBe("cluster-run-1");
    expect(body.context.agentId).toBe("task-stock");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("股票分析完成");
      expect(result.value.metadata?.resolverMetadata).toEqual({ adapterProtocol: "stock-analysis-v1-agent-stream" });
    }
  });

  it("maps stock analysis error events to failed envelopes", async () => {
    const fetchImpl = async () => new Response(
      'data: {"type":"error","message":"股票代码无效"}\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

    const result = await new StockAnalysisProvider(provider({ runtimeFamily: "lingxia-local" }), fetchImpl as any).dispatch({
      definition: definition({ id: "task-stock", profileRef: "task-stock" }),
      provider: provider({ runtimeFamily: "lingxia-local" }),
      prompt: "分析 BAD",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8188",
        auth: null,
        metadata: { adapterProtocol: "stock-analysis-v1-agent-stream" },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("run_failed");
      expect(result.value.error?.detail).toContain("股票代码无效");
    }
  });

  it("converts timeout into failed envelope", async () => {
    const fetchImpl = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

    const result = await new StockAnalysisProvider(provider({ runtimeFamily: "lingxia-local", timeoutMs: 1 }), fetchImpl as any).dispatch({
      definition: definition({ id: "task-stock", timeoutMs: 1 }),
      provider: provider({ runtimeFamily: "lingxia-local", timeoutMs: 1 }),
      prompt: "分析招商银行",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8188",
        auth: null,
        metadata: { adapterProtocol: "stock-analysis-v1-agent-stream" },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("timeout");
    }
  });

  it("rejects non-stock lingxia-local bindings without calling the endpoint", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response("{}");
    };

    const result = await new StockAnalysisProvider(provider({ runtimeFamily: "lingxia-local" }), fetchImpl as any).dispatch({
      definition: definition({ id: "task-trace", profileRef: "task-trace" }),
      provider: provider({ runtimeFamily: "lingxia-local" }),
      prompt: "trace",
      context,
      resolved: {
        endpoint: "http://127.0.0.1:8080",
        auth: null,
        metadata: { adapterProtocol: "http-json" },
      },
    });

    expect(called).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("unsupported_adapter_protocol");
    }
  });
});
