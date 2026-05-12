import { describe, expect, it } from "vitest";
import { AdapterAgentClusterRunner } from "../agent-cluster-runner";
import type { AgentRegistry } from "../../../../shared/types/agent";
import { definition, provider } from "./provider-fixtures";

function registry(definitions: any[], providers = [provider()]): AgentRegistry {
  return {
    listProviders: async () => ({ ok: true, value: providers }),
    listDefinitions: async () => ({ ok: true, value: definitions }),
    getDefinition: async (id: string) => {
      const found = definitions.find((item) => item.id === id);
      return found ? { ok: true, value: found } : { ok: false, error: { kind: "not_found", detail: id } };
    },
    setEnabled: async () => ({ ok: false, error: { kind: "not_implemented", detail: "x" } }),
    dispatchToDefinition: async () => ({ ok: false, error: { kind: "not_implemented", detail: "x" } }),
    healthCheck: async () => ({ ok: true, value: "healthy" }),
  } as AgentRegistry;
}

describe("AdapterAgentClusterRunner.runCluster", () => {
  it("returns partial_success when one selected agent fails", async () => {
    const defs = [definition({ id: "a", agentKey: "a" }), definition({ id: "b", agentKey: "b" })];
    const runner = new AdapterAgentClusterRunner({
      registry: registry(defs),
      userId: 1,
      createAdapter: () => ({
        dispatch: async ({ definition }) => ({
          ok: true,
          value: {
            id: `${definition.id}-result`,
            envelopeVersion: "v1",
            agentDefinitionId: definition.id,
            status: definition.id === "a" ? "success" : "failed",
            output: definition.id === "a" ? "A" : undefined,
            artifacts: [],
            error: definition.id === "b" ? { code: "boom", detail: "failed" } : undefined,
            producedAt: "2026-05-03T00:00:00.000Z",
          },
        }),
      }),
    });

    const run = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["a", "b"] });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = await runner.getRunResult(run.value.runId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("partial_success");
      expect(result.value.resultsJson).toHaveLength(2);
    }
  });

  it("rejects more agents than maxAgents", async () => {
    const defs = ["a", "b", "c"].map((id) => definition({ id, agentKey: id }));
    const runner = new AdapterAgentClusterRunner({
      registry: registry(defs),
      userId: 1,
      maxAgents: 2,
      createAdapter: () => ({ dispatch: async () => ({ ok: false, error: { kind: "dispatch_failed", detail: "should not run" } }) }),
    });

    const result = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["a", "b", "c"] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation_failed");
  });

  it("rejects invisible agents before dispatch", async () => {
    let dispatchCount = 0;
    const runner = new AdapterAgentClusterRunner({
      registry: registry([definition({ id: "visible", agentKey: "visible" })]),
      userId: 1,
      createAdapter: () => ({ dispatch: async () => { dispatchCount += 1; return { ok: false, error: { kind: "dispatch_failed", detail: "no" } }; } }),
    });

    const result = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["missing"] });

    expect(result.ok).toBe(false);
    expect(dispatchCount).toBe(0);
    if (!result.ok) expect(result.error.kind).toBe("unauthorized");
  });

  it("records timeout-style provider failure as failed cluster run", async () => {
    const runner = new AdapterAgentClusterRunner({
      registry: registry([definition({ id: "slow", agentKey: "slow" })]),
      userId: 1,
      createAdapter: () => ({
        dispatch: async ({ definition }) => ({
          ok: true,
          value: {
            id: "slow-result",
            envelopeVersion: "v1",
            agentDefinitionId: definition.id,
            status: "failed",
            artifacts: [],
            error: { code: "timeout", detail: "provider timed out" },
            producedAt: "2026-05-03T00:00:00.000Z",
          },
        }),
      }),
    });

    const run = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["slow"] });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = await runner.getRunResult(run.value.runId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.resultsJson[0]?.error?.code).toBe("timeout");
    }
  });

  it("passes resolved legacy binding into the provider adapter", async () => {
    let seenEndpoint: string | undefined;
    const runner = new AdapterAgentClusterRunner({
      registry: registry([definition({ id: "resolved", agentKey: "resolved" })]),
      userId: 1,
      resolveBinding: async () => ({ ok: true, value: { endpoint: "http://legacy/run", auth: null } }),
      createAdapter: () => ({
        dispatch: async ({ definition, resolved }) => {
          seenEndpoint = resolved?.endpoint;
          return {
            ok: true,
            value: {
              id: "resolved-result",
              envelopeVersion: "v1",
              agentDefinitionId: definition.id,
              status: "success",
              artifacts: [],
              producedAt: "2026-05-03T00:00:00.000Z",
            },
          };
        },
      }),
    });

    const run = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["resolved"] });

    expect(run.ok).toBe(true);
    expect(seenEndpoint).toBe("http://legacy/run");
  });

  it("persists provider transport kind in runtimeSnapshotJson", async () => {
    const runner = new AdapterAgentClusterRunner({
      registry: registry([
        definition({ id: "hermes", agentKey: "hermes" }),
      ], [
        provider({
          transport: {
            kind: "ssh-reverse-tunnel",
            upstreamRef: "internal-upstream",
          },
        }),
      ]),
      userId: 1,
      createAdapter: () => ({
        dispatch: async ({ definition }) => ({
          ok: true,
          value: {
            id: "hermes-result",
            envelopeVersion: "v1",
            agentDefinitionId: definition.id,
            status: "success",
            artifacts: [],
            producedAt: "2026-05-03T00:00:00.000Z",
          },
        }),
      }),
    });

    const run = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["hermes"] });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = await runner.getRunResult(run.value.runId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const selected = (result.value.runtimeSnapshotJson as any).selected;
      expect(selected[0].transport.kind).toBe("ssh-reverse-tunnel");
      expect(JSON.stringify(result.value.runtimeSnapshotJson)).not.toContain("internal-upstream");
    }
  });

  it("prefers resolved binding transport kind in runtimeSnapshotJson", async () => {
    const runner = new AdapterAgentClusterRunner({
      registry: registry([
        definition({ id: "hermes", agentKey: "hermes" }),
      ], [
        provider({ transport: { kind: "direct" } }),
      ]),
      userId: 1,
      resolveBinding: async () => ({
        ok: true,
        value: {
          endpoint: "http://127.0.0.1:8642",
          auth: null,
          transport: { kind: "ssh-reverse-tunnel" },
        },
      }),
      createAdapter: () => ({
        dispatch: async ({ definition }) => ({
          ok: true,
          value: {
            id: "hermes-result",
            envelopeVersion: "v1",
            agentDefinitionId: definition.id,
            status: "success",
            artifacts: [],
            producedAt: "2026-05-03T00:00:00.000Z",
          },
        }),
      }),
    });

    const run = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["hermes"] });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = await runner.getRunResult(run.value.runId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const selected = (result.value.runtimeSnapshotJson as any).selected;
      expect(selected[0].transport.kind).toBe("ssh-reverse-tunnel");
      expect(selected[0].transportKind).toBe("ssh-reverse-tunnel");
    }
  });

  it("records resolver failures as failed agent results", async () => {
    const runner = new AdapterAgentClusterRunner({
      registry: registry([definition({ id: "broken", agentKey: "broken" })]),
      userId: 1,
      resolveBinding: async () => ({ ok: false, error: { kind: "not_found", detail: "legacy row missing" } }),
      createAdapter: () => ({ dispatch: async () => ({ ok: false, error: { kind: "dispatch_failed", detail: "should not run" } }) }),
    });

    const run = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["broken"] });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = await runner.getRunResult(run.value.runId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.resultsJson[0]?.error?.code).toBe("not_found");
    }
  });

  it("creates a fresh clusterRunId for each run instead of a stable user session", async () => {
    const seenClusterRunIds: Array<string | undefined> = [];
    const runner = new AdapterAgentClusterRunner({
      registry: registry([definition({ id: "tool", agentKey: "tool" })]),
      userId: 1,
      createAdapter: () => ({
        dispatch: async ({ definition, context }) => {
          seenClusterRunIds.push(context.clusterRunId);
          return {
            ok: true,
            value: {
              id: `${definition.id}-result-${seenClusterRunIds.length}`,
              envelopeVersion: "v1",
              agentDefinitionId: definition.id,
              clusterRunId: context.clusterRunId,
              status: "success",
              artifacts: [],
              producedAt: "2026-05-03T00:00:00.000Z",
            },
          };
        },
      }),
    });

    const first = await runner.runCluster(null, { input: "hello", agentDefinitionIds: ["tool"] });
    const second = await runner.runCluster(null, { input: "hello again", agentDefinitionIds: ["tool"] });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(seenClusterRunIds).toHaveLength(2);
    expect(seenClusterRunIds[0]).toBeTruthy();
    expect(seenClusterRunIds[1]).toBeTruthy();
    expect(seenClusterRunIds[0]).not.toBe(seenClusterRunIds[1]);
    expect(seenClusterRunIds[0]).not.toContain("user_1");
    expect(seenClusterRunIds[1]).not.toContain("user_1");
  });
});
