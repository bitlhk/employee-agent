import { describe, expect, it } from "vitest";
import { StubAgentClusterRunner } from "../agent-cluster-runner";
import { JsonAgentRegistry } from "../agent-registry";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("agent registry Phase 2 read path and stubs", () => {
  function seedPath(seed: unknown) {
    const dir = mkdtempSync(path.join(tmpdir(), "agent-registry-"));
    const file = path.join(dir, "agents.seed.json");
    writeFileSync(file, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
    return file;
  }

  function baseSeed(overrides: any = {}) {
    const provider = {
      id: "provider-1",
      providerKey: "provider-1",
      displayName: "Provider One",
      runtimeFamily: "hermes",
      protocol: "http-json",
      baseEndpointRef: "AGENT_PROVIDER_ONE",
      authType: "internal-token",
      enabled: true,
      healthStatus: "unknown",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
      ...(overrides.provider || {}),
    };
    const definition = {
      id: "agent-1",
      agentKey: "agent-1",
      displayName: "Agent One",
      shortDescription: "Useful test agent",
      capabilityCategory: "general-assistant",
      providerId: provider.id,
      iconName: "Bot",
      sortOrder: 1,
      enabled: true,
      healthStatus: "unknown",
      visibilityScope: "platform-global",
      visibilityConfigJson: {},
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
      ...(overrides.definition || {}),
    };
    return { providers: [provider], definitions: [definition, ...(overrides.extraDefinitions || [])] };
  }

  it("AgentRegistry.listProviders reads JSON seed", async () => {
    const registry = new JsonAgentRegistry({ seedPath: seedPath(baseSeed()) });

    const result = await registry.listProviders();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].id).toBe("provider-1");
  });

  it("AgentRegistry.listDefinitions treats unknown as dispatchable grace state", async () => {
    const registry = new JsonAgentRegistry({ seedPath: seedPath(baseSeed()) });

    const result = await registry.listDefinitions(123);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((agent) => agent.id)).toEqual(["agent-1"]);
  });

  it("AgentRegistry.listDefinitions treats healthy as visible", async () => {
    const registry = new JsonAgentRegistry({
      seedPath: seedPath(baseSeed({
        provider: { healthStatus: "healthy" },
        definition: { healthStatus: "healthy" },
      })),
    });

    const result = await registry.listDefinitions(123);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((agent) => agent.id)).toEqual(["agent-1"]);
  });

  it("AgentRegistry.listDefinitions hides non-dispatchable health or disabled entries", async () => {
    const sample = baseSeed();
    const registry = new JsonAgentRegistry({
      seedPath: seedPath(baseSeed({
        extraDefinitions: [
          {
            ...sample.definitions[0],
            id: "agent-degraded",
            agentKey: "agent-degraded",
            healthStatus: "degraded",
            sortOrder: 2,
          },
          {
            ...sample.definitions[0],
            id: "agent-unhealthy",
            agentKey: "agent-unhealthy",
            healthStatus: "unhealthy",
            sortOrder: 3,
          },
          {
            ...sample.definitions[0],
            id: "agent-offline",
            agentKey: "agent-offline",
            healthStatus: "offline",
            sortOrder: 4,
          },
          {
            ...sample.definitions[0],
            id: "agent-disabled",
            agentKey: "agent-disabled",
            enabled: false,
            sortOrder: 5,
          },
        ],
      })),
    });

    const result = await registry.listDefinitions(123);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((agent) => agent.id)).toEqual(["agent-1"]);
  });

  it("AgentRegistry.listDefinitions denies subscription-scoped agents until profile context is wired", async () => {
    const registry = new JsonAgentRegistry({
      seedPath: seedPath(baseSeed({
        definition: {
          visibilityScope: "subscription-scoped",
          visibilityConfigJson: { profileKeys: ["plus", "internal"] },
        },
      })),
    });

    const result = await registry.listDefinitions(123);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("AgentRegistry.listDefinitions applies user-scoped visibility", async () => {
    const registry = new JsonAgentRegistry({
      seedPath: seedPath(baseSeed({
        definition: {
          visibilityScope: "user-scoped",
          visibilityConfigJson: { userIds: [7] },
        },
      })),
    });

    const visible = await registry.listDefinitions(7);
    const hidden = await registry.listDefinitions(8);

    expect(visible.ok).toBe(true);
    if (visible.ok) expect(visible.value).toHaveLength(1);
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.value).toHaveLength(0);
  });

  it("AgentRegistry.listDefinitions applies space-scoped visibility", async () => {
    const registry = new JsonAgentRegistry({
      seedPath: seedPath(baseSeed({
        definition: {
          visibilityScope: "space-scoped",
          visibilityConfigJson: { spaceIds: [2] },
        },
      })),
      resolveViewerContext: async (viewerUserId) => ({ spaceId: viewerUserId === 1 ? 2 : null }),
    });

    const visible = await registry.listDefinitions(1);
    const hidden = await registry.listDefinitions(2);

    expect(visible.ok).toBe(true);
    if (visible.ok) expect(visible.value).toHaveLength(1);
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.value).toHaveLength(0);
  });

  it("AgentRegistry.listDefinitions hides space-scoped agents from a different space", async () => {
    const registry = new JsonAgentRegistry({
      seedPath: seedPath(baseSeed({
        definition: {
          visibilityScope: "space-scoped",
          visibilityConfigJson: { spaceIds: [3] },
        },
      })),
      resolveViewerContext: async () => ({ spaceId: 2 }),
    });

    const result = await registry.listDefinitions(1);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("AgentRegistry.dispatchToDefinition still returns not_implemented", async () => {
    const registry = new JsonAgentRegistry({ seedPath: seedPath(baseSeed()) });

    const result = await registry.dispatchToDefinition("agent-1", "hello", {
      adoptId: "lgc-test",
      userId: 1,
      agentId: "agent-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_implemented");
  });

  it("AgentClusterRunner.runCluster returns not_implemented", async () => {
    const result = await new StubAgentClusterRunner().runCluster("cluster-1", {
      input: "run it",
      agentDefinitionIds: ["stock-analysis"],
      executionMode: "parallel-append",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_implemented");
    expect(result.error.detail).toContain("AgentClusterRunner.runCluster");
  });
});
