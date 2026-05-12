import { describe, expect, it } from "vitest";
import { LegacyBusinessAgentResolver } from "../providers/legacy-business-agent-resolver";
import { definition, provider } from "./provider-fixtures";

describe("LegacyBusinessAgentResolver", () => {
  it("resolves an AWS Hermes tunnel agent with SecretHandle auth", async () => {
    const resolver = new LegacyBusinessAgentResolver(async (id) => ({
      id,
      kind: "remote",
      enabled: 1,
      apiUrl: "http://127.0.0.1:8642/run",
      apiToken: "hermes-token",
      remoteAgentId: "hermes-agent",
      healthStatus: "healthy",
      allowedProfiles: "plus,internal",
      maxDailyRequests: 100,
    }));

    const result = await resolver.resolve(definition({ id: "task-my-wealth" }), provider());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.endpoint).toBe("http://127.0.0.1:8642/run");
    expect(result.value.remoteAgentId).toBe("hermes-agent");
    expect(result.value.transport?.kind).toBe("ssh-reverse-tunnel");
    expect(result.value.metadata?.adapterProtocol).toBe("hermes-v1-runs");
    expect(result.value.metadata?.transportKind).toBe("ssh-reverse-tunnel");
    expect(result.value.systemPrompt).toContain("分析师 (AI)");
    expect(result.value.systemPrompt).toContain("输出给写作员使用的 PPT 大纲");
    expect(result.value.systemPrompt).not.toContain("个人财富解释助手");
    expect(String(result.value.auth)).toBe("[REDACTED]");
    expect(JSON.stringify(result.value)).not.toContain("hermes-token");
    expect(result.value.auth?.use((raw) => raw)).toBe("hermes-token");
  });

  it("resolves a Claude Code agent with localAgentId", async () => {
    const resolver = new LegacyBusinessAgentResolver(async (id) => ({
      id,
      kind: "remote",
      enabled: 1,
      apiUrl: "http://198.51.100.10:19800/run",
      apiToken: "claude-token",
      localAgentId: "task-ppt",
      healthStatus: "healthy",
    }));

    const result = await resolver.resolve(
      definition({ id: "task-ppt", profileRef: "fallback-profile" }),
      provider({ runtimeFamily: "claude-code" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpoint).toBe("http://198.51.100.10:19800/run");
      expect(result.value.localAgentId).toBe("task-ppt");
      expect(result.value.auth?.use((raw) => raw)).toBe("claude-token");
      expect(result.value.metadata?.adapterProtocol).toBe("openai-chat-completions");
      expect(result.value.systemPrompt).toContain("PPT / 演示文稿");
      expect(result.value.systemPrompt).toContain("讨论型问题");
    }
  });

  it("uses explicit DB systemPrompt before legacy fallback prompts", async () => {
    const resolver = new LegacyBusinessAgentResolver(async (id) => ({
      id,
      enabled: 1,
      apiUrl: "http://198.51.100.10:19800/run",
      apiToken: null,
      localAgentId: "task-ppt",
      systemPrompt: "DB prompt wins",
    }));

    const result = await resolver.resolve(
      definition({ id: "task-ppt", profileRef: "task-ppt" }),
      provider({ runtimeFamily: "claude-code" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.systemPrompt).toBe("DB prompt wins");
  });

  it("resolves Moheng reviewer as a research synthesis prompt without changing wealth prompt", async () => {
    const resolver = new LegacyBusinessAgentResolver(async (id) => ({
      id,
      kind: "remote",
      enabled: 1,
      apiUrl: "http://127.0.0.1:8642/run",
      apiToken: "hermes-token",
      remoteAgentId: "hermes-agent",
      healthStatus: "healthy",
    }));

    const result = await resolver.resolve(definition({ id: "task-moheng-reviewer" }), provider());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.systemPrompt).toContain("分析师 (AI)");
      expect(result.value.systemPrompt).toContain("输出给写作员使用的 PPT 大纲");
      expect(result.value.systemPrompt).toContain("不生成 PPTX、DOCX、Excel 或 HTML 文件");
      expect(result.value.systemPrompt).not.toContain("个人财富解释助手");
    }
  });

  it("resolves a local agent without auth", async () => {
    const resolver = new LegacyBusinessAgentResolver(async (id) => ({
      id,
      kind: "local",
      enabled: 1,
      apiUrl: "http://127.0.0.1:8188/run",
      apiToken: null,
      localAgentId: null,
      healthStatus: "healthy",
    }));

    const result = await resolver.resolve(definition({ id: "task-stock", profileRef: "task-stock" }), provider({ authType: "none" }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpoint).toBe("http://127.0.0.1:8188/run");
      expect(result.value.auth).toBeNull();
    }
  });

  it("rejects disabled legacy agents", async () => {
    const resolver = new LegacyBusinessAgentResolver(async (id) => ({
      id,
      enabled: 0,
      apiUrl: "http://disabled/run",
      apiToken: "disabled-token",
    }));

    const result = await resolver.resolve(definition({ id: "task-disabled" }), provider());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("uses AgentDefinition.id as the lookup key", async () => {
    let seenId = "";
    const resolver = new LegacyBusinessAgentResolver(async (id) => {
      seenId = id;
      return { id, enabled: 1, apiUrl: "http://provider/run", apiToken: null };
    });

    await resolver.resolve(definition({ id: "task-from-definition" }), provider());

    expect(seenId).toBe("task-from-definition");
  });

  it("resolves seed-only managed Hermes profiles without a DB row", async () => {
    const resolver = new LegacyBusinessAgentResolver(async () => null);

    const result = await resolver.resolve(
      definition({
        id: "market-sector-reader",
        profileRef: "market-sector-reader",
        endpointRef: "http://127.0.0.1:8651",
        authRef: "managed-token",
        metadata: {
          managedHermesProfile: true,
          agentTemplateId: "market-researcher",
          agentRole: "Reader",
          systemPrompt: "Reader prompt",
        },
      }),
      provider(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.endpoint).toBe("http://127.0.0.1:8651");
    expect(result.value.remoteAgentId).toBe("market-sector-reader");
    expect(result.value.localAgentId).toBe("market-sector-reader");
    expect(result.value.systemPrompt).toBe("Reader prompt");
    expect(result.value.transport?.kind).toBe("ssh-reverse-tunnel");
    expect(result.value.metadata?.adapterProtocol).toBe("hermes-v1-runs");
    expect(result.value.metadata?.managedHermesProfile).toBe(true);
  });
});
