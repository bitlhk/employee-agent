import { describe, expect, it } from "vitest";
import { SecretHandle } from "../../../../shared/lib/secret-handle";
import { ClaudeCodeProvider } from "../providers/claude-code-provider";
import { definition, provider } from "./provider-fixtures";

const context = { adoptId: "lgc-test", userId: 1, agentId: "agent-1" };

describe("ClaudeCodeProvider", () => {
  it("passes localAgentId and converts success into an envelope", async () => {
    let body: any = null;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ output: "done" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await new ClaudeCodeProvider(provider({ runtimeFamily: "claude-code" }), fetchImpl as any).dispatch({
      definition: definition({ profileRef: "task-ppt" }),
      provider: provider({ runtimeFamily: "claude-code" }),
      prompt: "make ppt",
      context,
    });

    expect(body.localAgentId).toBe("task-ppt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.output).toBe("done");
  });

  it("converts 5xx into failed envelope", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ message: "bad" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    const result = await new ClaudeCodeProvider(provider({ runtimeFamily: "claude-code" }), fetchImpl as any).dispatch({
      definition: definition(),
      provider: provider({ runtimeFamily: "claude-code" }),
      prompt: "make ppt",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("http_500");
    }
  });

  it("converts timeout into failed envelope", async () => {
    const fetchImpl = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

    const result = await new ClaudeCodeProvider(provider({ runtimeFamily: "claude-code", timeoutMs: 1 }), fetchImpl as any).dispatch({
      definition: definition({ timeoutMs: 1 }),
      provider: provider({ runtimeFamily: "claude-code", timeoutMs: 1 }),
      prompt: "make ppt",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.error?.code).toBe("timeout");
    }
  });

  it("maps artifacts without signing URLs at provider layer", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      output: "ppt ready",
      artifacts: [{ id: "ppt-1", type: "pptx", name: "deck.pptx", downloadUrl: "/provider/download/deck.pptx" }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await new ClaudeCodeProvider(provider({ runtimeFamily: "claude-code" }), fetchImpl as any).dispatch({
      definition: definition(),
      provider: provider({ runtimeFamily: "claude-code" }),
      prompt: "make ppt",
      context,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifacts[0]?.type).toBe("pptx");
      expect(result.value.artifacts[0]?.downloadUrl).toBe("/provider/download/deck.pptx");
      expect(result.value.artifacts[0]?.previewUrl).toBeUndefined();
    }
  });

  it("uses OpenAI-compatible chat completions when the legacy resolver marks the binding", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let body: any = null;
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (url.includes(":19798/files")) {
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      body = JSON.parse(String(init.body));
      return new Response('data: {"choices":[{"delta":{"content":"可以"}}]}\n\ndata: {"choices":[{"delta":{"content":"做PPT"}}]}\n\ndata: [DONE]\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new ClaudeCodeProvider(provider({ runtimeFamily: "claude-code", authType: "bearer-token" }), fetchImpl as any, {
      buildTenantContext: () => ({
        userId: 1,
        agentId: "task-ppt",
        tenantToken: "tenant-token-full",
        tenantShort: "tenantshort1234",
        workspace: "/tmp/tenant-workspace",
        sessionKey: "business:task-ppt:t:tenantshort1234:main",
      }),
    }).dispatch({
      definition: definition({ id: "task-ppt", profileRef: "task-ppt" }),
      provider: provider({ runtimeFamily: "claude-code", authType: "bearer-token" }),
      prompt: "介绍能力",
      context: { ...context, clusterRunId: "cluster-run-1" },
      resolved: {
        endpoint: "http://198.51.100.10:19800",
        auth: SecretHandle.of("claude-token"),
        remoteAgentId: "claude-code",
        localAgentId: "task-ppt",
        systemPrompt: "中文回复",
        metadata: { adapterProtocol: "openai-chat-completions" },
      },
    });

    expect(seenUrl).toBe("http://198.51.100.10:19800/v1/chat/completions");
    expect(seenHeaders.authorization).toBe("Bearer claude-token");
    expect(seenHeaders["x-openclaw-scopes"]).toBe("operator.write");
    expect(seenHeaders["x-openclaw-session-key"]).toBe("business:task-ppt:t:tenantshort1234:main");
    expect(seenHeaders["x-tenant-token"]).toBe("tenant-token-full");
    expect(seenHeaders["x-tenant-workspace"]).toBe("/tmp/tenant-workspace");
    expect(body.model).toBe("openclaw/claude-code");
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("中文回复");
    expect(body.messages[0].content).toContain("tenantshort1234");
    expect(body.messages[1]).toEqual({ role: "user", content: "介绍能力" });
    expect(JSON.stringify(body)).not.toContain("claude-token");
    expect(JSON.stringify(body)).not.toContain("tenant-token-full");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      expect(result.value.output).toBe("可以做PPT");
      expect(JSON.stringify(result.value)).not.toContain("claude-token");
      expect(JSON.stringify(result.value)).not.toContain("tenant-token-full");
    }
  });

  it("collects remote PPT artifacts through the file service after a task-ppt run", async () => {
    const urls: string[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const fetchImpl = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.includes(":19798/files")) {
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer file-service-token");
        return new Response(JSON.stringify({
          files: [
            { name: "banking-ai-1777821856838.pptx", size: 4096, mtime: nowSec },
            { name: "banking-ai-preview-1777821856837.html", size: 2048, mtime: nowSec },
            { name: "banking-ai-print-1777821856837.pptx", size: 1024, mtime: nowSec },
            { name: "content_banking_ai-1777821856840.json", size: 512, mtime: nowSec },
            { name: "old-banking-ai-1777821856000.pptx", size: 4096, mtime: nowSec - 20 },
            { name: "old-banking-ai-preview-1777821856000.html", size: 2048, mtime: nowSec - 20 },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response('data: {"choices":[{"delta":{"content":"已生成"}}]}\n\ndata: [DONE]\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const result = await new ClaudeCodeProvider(provider({ runtimeFamily: "claude-code", authType: "bearer-token" }), fetchImpl as any, {
      fileServiceToken: "file-service-token",
      now: () => nowSec * 1000,
      buildTenantContext: () => ({
        userId: 1,
        agentId: "task-ppt",
        tenantToken: "tenant-token-full",
        tenantShort: "abc123tenant",
        workspace: "/tmp/tenant-workspace",
        sessionKey: "business:task-ppt:t:abc123tenant:main",
      }),
    }).dispatch({
      definition: definition({ id: "task-ppt", profileRef: "task-ppt" }),
      provider: provider({ runtimeFamily: "claude-code", authType: "bearer-token" }),
      prompt: "生成 PPT",
      context: { ...context, clusterRunId: "cluster-run-2" },
      resolved: {
        endpoint: "http://198.51.100.10:19800",
        auth: SecretHandle.of("claude-token"),
        remoteAgentId: "claude-code",
        localAgentId: "task-ppt",
        systemPrompt: "生成 PPT",
        metadata: { adapterProtocol: "openai-chat-completions" },
      },
    });

    expect(urls).toContain("http://198.51.100.10:19800/v1/chat/completions");
    expect(urls.some((url) => url.includes("http://198.51.100.10:19798/files?tenant=abc123tenant&source=task-ppt"))).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifacts).toHaveLength(1);
      expect(result.value.artifacts[0]?.type).toBe("pptx");
      expect(result.value.artifacts[0]?.downloadUrl).toBe("/api/claw/business-files/download?agentId=task-ppt&file=banking-ai-1777821856838.pptx");
      expect(result.value.artifacts[0]?.previewUrl).toBe("/api/claw/remote-file?agentId=task-ppt&file=banking-ai-preview-1777821856837.html&preview=1");
      expect(JSON.stringify(result.value)).not.toContain("tenant-token-full");
      expect(JSON.stringify(result.value)).not.toContain("file-service-token");
      expect(JSON.stringify(result.value)).not.toContain("content_banking_ai");
      expect(JSON.stringify(result.value)).not.toContain("old-banking-ai");
    }
  });
});
