import { describe, expect, it, vi } from "vitest";
import { createTaskWorkbenchLabHandlers } from "../../../_routes/task-workbench-lab";
import type { AgentResult } from "../../../../shared/types/agent";
import type { TaskRunResult, TaskTemplate, TaskTemplateRunner } from "../../../../shared/types/task-template";

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

const baseTemplate: TaskTemplate = {
  id: "ppt_report_writing",
  version: 1,
  status: "active",
  displayName: "PPT 汇报写作",
  shortDescription: "将主题或材料整理成结构化演示文稿草稿。",
  category: "presentation",
  estimatedDurationMs: 90000,
  maxDurationMs: 300000,
  stages: [{
    id: "ppt_generation",
    displayName: "生成演示文稿",
    personaId: "jianye",
    agentDefinitionId: "task-ppt",
    executionMode: "single",
    inputMapping: { original: true },
    expectedOutputs: ["ppt_preview"],
    timeoutMs: 300000,
    onFailure: "retry_once_then_stop",
  }],
  outputPolicy: {
    allowedArtifactTypes: ["ppt_preview", "markdown_report"],
    disclaimers: ["ai_generated_label", "fact_check_required"],
    citationRequired: false,
    saveToWorkspaceDefault: false,
  },
};

const baseRun: TaskRunResult = {
  taskRunId: "task-run-1",
  taskTemplateId: "ppt_report_writing",
  taskTemplateVersion: 1,
  taskTemplateChainHash: "hash",
  status: "completed",
  stages: [{
    stageId: "ppt_generation",
    personaId: "jianye",
    agentDefinitionId: "task-ppt",
    status: "success",
    durationMs: 100,
    artifacts: [],
    runResult: {
      id: "result-1",
      envelopeVersion: "v1",
      agentDefinitionId: "task-ppt",
      status: "success",
      artifacts: [],
      output: "OK",
      metadata: {
        apiToken: "must-not-leak",
        authorization: "bad",
        baseEndpointRef: "http://127.0.0.1:8642",
      },
      producedAt: "2026-05-03T00:00:00.000Z",
    },
  }],
  artifacts: [],
  disclaimers: ["ai_generated_label", "fact_check_required"],
  runtimeSnapshotJson: {
    taskTemplateId: "ppt_report_writing",
    taskTemplateVersion: 1,
    taskTemplateName: "PPT 汇报写作",
    chainHash: "hash",
    stageSnapshots: [],
  },
  startedAt: "2026-05-03T00:00:00.000Z",
  completedAt: "2026-05-03T00:00:01.000Z",
};

function runner(loadResult: AgentResult<TaskTemplate> = { ok: true, value: baseTemplate }, runResult: AgentResult<TaskRunResult> = { ok: true, value: baseRun }): TaskTemplateRunner {
  return {
    loadTemplate: async () => loadResult,
    runTask: async () => runResult,
  };
}

describe("task workbench lab route", () => {
  it("returns 404 when lab is disabled", async () => {
    const res = mockResponse();
    const handlers = createTaskWorkbenchLabHandlers({ enabled: () => false });

    await handlers.listTemplates({} as any, res as any);

    expect(res.statusCode).toBe(404);
  });

  it("rejects non-admin users", async () => {
    const res = mockResponse();
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "user" }),
    });

    await handlers.listTemplates({} as any, res as any);

    expect(res.statusCode).toBe(403);
  });

  it("lists the focused task workbench templates for admin users", async () => {
    const res = mockResponse();
    const loadedIds: string[] = [];
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      createRunner: () => ({
        loadTemplate: async (templateId: string) => {
          loadedIds.push(templateId);
          return { ok: true, value: { ...baseTemplate, id: templateId } };
        },
        runTask: async () => ({ ok: true, value: baseRun }),
      }),
    });

    await handlers.listTemplates({} as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe("task-workbench-lab");
    expect(res.body.templates.map((template: any) => template.id)).toEqual([
      "market_research_brief",
      "meeting_prep_agent",
      "ai_topic_insight_ppt",
    ]);
    expect(loadedIds).toEqual(["market_research_brief", "meeting_prep_agent", "ai_topic_insight_ppt"]);
  });

  it("runs a task and redacts sensitive fields", async () => {
    const res = mockResponse();
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      createRunner: () => runner(),
    });

    await handlers.runTask({ body: { taskTemplateId: "ppt_report_writing", prompt: "hello" } } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe("task-workbench-lab");
    const serialized = JSON.stringify(res.body);
    expect(serialized).toContain("OK");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("baseEndpointRef");
    expect(serialized).not.toContain("127.0.0.1:8642");
  });

  it("routes greetings to chat without starting a task", async () => {
    const res = mockResponse();
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      routePrompt: async () => ({
        intent: "chat",
        confidence: "high",
        reply: "你好，我是任务工作台。",
        router: { mode: "test" },
      }),
    });

    await handlers.routePrompt({ body: { taskTemplateId: "ai_topic_insight_ppt", prompt: "你好" } } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.decision.intent).toBe("chat");
    expect(res.body.decision.reply).toContain("任务工作台");
  });

  it("routes explicit PPT requests to the focused template", async () => {
    const res = mockResponse();
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      routePrompt: async () => ({
        intent: "run_template",
        confidence: "high",
        selectedTemplateId: "ai_topic_insight_ppt",
        normalizedGoal: "Sequoia AI Ascent 2026 PPT",
        userVisiblePlan: ["闻舟检索并筛选可信资料", "墨衡提炼逻辑线与引用依据", "简页生成可预览、可下载的 PPT"],
      }),
    });

    await handlers.routePrompt({ body: { taskTemplateId: "ai_topic_insight_ppt", prompt: "把 Sequoia AI Ascent 2026 做成 PPT" } } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.decision.intent).toBe("run_template");
    expect(res.body.decision.selectedTemplateId).toBe("ai_topic_insight_ppt");
    expect(res.body.decision.userVisiblePlan).toHaveLength(3);
  });

  it("returns 404 when template is missing", async () => {
    const res = mockResponse();
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      createRunner: () => runner({ ok: false, error: { kind: "not_found", detail: "missing" } }),
    });

    await handlers.runTask({ body: { taskTemplateId: "missing", prompt: "hello" } } as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("uses the remote harness executor when a harness plan is present and enabled", async () => {
    const res = mockResponse();
    const oldEnabled = process.env.TASK_WORKBENCH_HARNESS_EXECUTOR;
    const oldEndpoint = process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT;
    const oldToken = process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR = "true";
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT = "http://127.0.0.1:18670";
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN = "test-token";
    let localRunnerCalled = false;
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        stages: [{
          stageId: "sector_reader",
          profile: "market-sector-reader",
          role: "Reader",
          status: "success",
          runId: "run-1",
          durationMs: 12,
          output: "remote ok",
          skillRefs: ["sector-overview"],
        }],
        finalOutput: "remote ok",
      }),
    } as any);
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      createRunner: () => ({
        loadTemplate: async () => ({ ok: true, value: baseTemplate }),
        runTask: async () => {
          localRunnerCalled = true;
          return { ok: true, value: baseRun };
        },
      }),
    });

    await handlers.runTask({
      body: {
        taskTemplateId: "market_research_brief",
        prompt: "market update",
        harnessPlan: {
          source: "financial_harness",
          runId: "harness-run-1",
          templateId: "market-researcher",
          stages: [{
            stageId: "sector_reader",
            role: "Reader",
            profile: "market-sector-reader",
          }],
        },
      },
    } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(localRunnerCalled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18670/v1/harness/execute",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-token" }),
      }),
    );
    expect(res.body.taskRun.metadata.remoteHarness.enabled).toBe(true);
    expect(res.body.taskRun.stages[0].runResult.output).toBe("remote ok");

    fetchMock.mockRestore();
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR = oldEnabled;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT = oldEndpoint;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN = oldToken;
  });
});
