import { describe, expect, it } from "vitest";
import { createAgentClusterLabRunHandler } from "../../../_routes/agent-cluster-lab";
import type { AgentClusterRun, AgentClusterRunner } from "../../../../shared/types/agent";

function mockResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function runner(run: AgentClusterRun): AgentClusterRunner {
  return {
    createCluster: async () => ({ ok: false, error: { kind: "not_implemented", detail: "x" } }),
    loadLastUsed: async () => ({ ok: false, error: { kind: "not_implemented", detail: "x" } }),
    runCluster: async () => ({ ok: true, value: { runId: run.id } }),
    getRunResult: async () => ({ ok: true, value: run }),
  };
}

const baseRun: AgentClusterRun = {
  id: "run-1",
  userId: 1,
  input: "hello",
  selectedAgentIdsJson: ["task-stock"],
  status: "completed",
  resultsJson: [{
    id: "result-1",
    envelopeVersion: "v1",
    agentDefinitionId: "task-stock",
    status: "success",
    output: "OK",
    artifacts: [],
    metadata: {
      providerKey: "provider-1",
      apiToken: "must-not-leak",
      baseEndpointRef: "http://127.0.0.1:8642",
      nested: { authorization: "bad" },
    },
    producedAt: "2026-05-03T00:00:00.000Z",
  }],
  runtimeSnapshotJson: {
    token: "bad",
    transportKind: "ssh-reverse-tunnel",
  },
  createdAt: "2026-05-03T00:00:00.000Z",
};

describe("agent cluster lab route", () => {
  it("returns 404 when lab flag is disabled", async () => {
    const res = mockResponse();
    const handler = createAgentClusterLabRunHandler({ enabled: () => false });

    await handler({ body: {} } as any, res as any);

    expect(res.statusCode).toBe(404);
  });

  it("rejects non-admin users", async () => {
    const res = mockResponse();
    const handler = createAgentClusterLabRunHandler({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "user" }),
    });

    await handler({ body: {} } as any, res as any);

    expect(res.statusCode).toBe(403);
  });

  it("runs cluster for admin users and returns redacted envelope", async () => {
    const res = mockResponse();
    const handler = createAgentClusterLabRunHandler({
      enabled: () => true,
      authenticateUser: async () => ({ id: 1, role: "admin" }),
      createRunner: () => runner(baseRun),
    });

    await handler({
      body: { agentDefinitionIds: ["task-stock"], prompt: "hello" },
    } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe("agent-cluster-lab");
    const serialized = JSON.stringify(res.body);
    expect(serialized).toContain("OK");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("baseEndpointRef");
    expect(serialized).not.toContain("127.0.0.1:8642");
  });

  it("rejects agents outside the lab allowlist before runner dispatch", async () => {
    const res = mockResponse();
    let called = false;
    const handler = createAgentClusterLabRunHandler({
      enabled: () => true,
      authenticateUser: async () => ({ id: 1, role: "admin" }),
      createRunner: () => ({
        ...runner(baseRun),
        runCluster: async () => {
          called = true;
          return { ok: true, value: { runId: baseRun.id } };
        },
      }),
    });

    await handler({
      body: { agentDefinitionIds: ["task-slides"], prompt: "hello" },
    } as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("agent_not_allowed_in_lab");
    expect(called).toBe(false);
  });
});
