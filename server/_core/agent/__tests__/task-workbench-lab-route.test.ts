import http from "node:http";
import { describe, expect, it } from "vitest";
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
  id: "generic_report_writing",
  version: 1,
  status: "active",
  displayName: "PPT 汇报写作",
  shortDescription: "将主题或材料整理成结构化演示文稿草稿。",
  category: "presentation",
  estimatedDurationMs: 90000,
  maxDurationMs: 300000,
  stages: [{
    id: "outline_writer",
    displayName: "生成 PPT 蓝图",
    personaId: "writer",
    agentDefinitionId: "generic-writer",
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
  taskTemplateId: "generic_report_writing",
  taskTemplateVersion: 1,
  taskTemplateChainHash: "hash",
  status: "completed",
  stages: [{
    stageId: "outline_writer",
    personaId: "writer",
    agentDefinitionId: "generic-writer",
    status: "success",
    durationMs: 100,
    artifacts: [],
    runResult: {
      id: "result-1",
      envelopeVersion: "v1",
      agentDefinitionId: "generic-writer",
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
      "excel_fill",
      "meeting_prep_agent",
      "meeting_notes",
      "wind_announcement_digest",
      "fund_compare",
      "peer_comps_analysis",
      "theme_leader_analysis",
      "earnings_commentary",
      "company_one_page_memo",
      "macro_data_brief",
      "credit_analysis",
      "bond_rate_outlook",
      "research_ppt",
      "video_outline",
    ]);
    expect(loadedIds).toEqual([
      "market_research_brief",
      "excel_fill",
      "meeting_prep_agent",
      "meeting_notes",
      "wind_announcement_digest",
      "fund_compare",
      "peer_comps_analysis",
      "theme_leader_analysis",
      "earnings_commentary",
      "company_one_page_memo",
      "macro_data_brief",
      "credit_analysis",
      "bond_rate_outlook",
      "research_ppt",
      "video_outline",
    ]);
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

    await handlers.routePrompt({ body: { taskTemplateId: "research_ppt", prompt: "你好" } } as any, res as any);

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
        selectedTemplateId: "research_ppt",
        normalizedGoal: "Sequoia AI Ascent 2026 PPT",
        userVisiblePlan: ["检索员筛选可信资料", "分析师提炼逻辑线", "大纲员生成蓝图", "模板渲染器生成 PPTX", "质量校验器检查产物"],
      }),
    });

    await handlers.routePrompt({ body: { taskTemplateId: "research_ppt", prompt: "把 Sequoia AI Ascent 2026 做成 PPT" } } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.decision.intent).toBe("run_template");
    expect(res.body.decision.selectedTemplateId).toBe("research_ppt");
    expect(res.body.decision.userVisiblePlan).toHaveLength(5);
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
    const oldWindSkillDir = process.env.WIND_MCP_SKILL_DIR;
    let remoteBody: any = null;
    const server = http.createServer((req, response) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/v1/harness/execute");
      expect(req.headers.authorization).toBe("Bearer test-token");
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        remoteBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          status: "completed",
          stages: [{
            stageId: "comps_analyst",
            profile: "market-comps-spreader",
            role: "Analyst",
            status: "success",
            runId: "run-1",
            durationMs: 12,
            output: "analysis ok",
            skillRefs: ["comps-analysis"],
          }, {
            stageId: "note_writer",
            profile: "market-note-writer",
            role: "Writer",
            status: "success",
            runId: "run-2",
            durationMs: 13,
            output: "remote ok",
            skillRefs: ["client-report"],
          }],
          finalOutput: "remote ok",
        }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR = "true";
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN = "test-token";
    process.env.WIND_MCP_SKILL_DIR = "/tmp/not-installed-wind-mcp-skill";
    let localRunnerCalled = false;
    const handlers = createTaskWorkbenchLabHandlers({
      enabled: () => true,
      authenticateUser: async () => ({ id: 2, role: "admin" }),
      createRunner: () => ({
        loadTemplate: async () => ({
          ok: true,
          value: { ...baseTemplate, id: "market_research_brief" },
        }),
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
          dataRequirements: [{
            id: "d1",
            type: "internal_context",
            query: "cross-border payment policy updates",
            topK: 4,
            required: true,
          }],
          computeRequirements: [{
            id: "c1",
            type: "peer_comparison_table",
            inputRefs: ["d1"],
            reason: "compare evidence coverage",
          }],
          stages: [{
            stageId: "sector_reader",
            role: "Reader",
            profile: "market-sector-reader",
          }, {
            stageId: "comps_analyst",
            role: "Analyst",
            profile: "market-comps-spreader",
          }, {
            stageId: "note_writer",
            role: "Writer",
            profile: "market-note-writer",
          }],
        },
      },
    } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(localRunnerCalled).toBe(false);
    expect(remoteBody).toBeTruthy();
    expect(remoteBody.harnessPlan.stages.map((stage: any) => stage.profile)).toEqual([
      "market-comps-spreader",
      "market-note-writer",
    ]);
    expect(remoteBody.financeDataPack).toEqual(expect.objectContaining({
      version: "v1.1",
      provider: "wind-financial-docs",
      evidenceItems: [],
      sourceCards: [],
    }));
    expect(remoteBody.financeDataPack.requirements).toHaveLength(0);
    expect(remoteBody.financeDataPack.sections).toHaveLength(0);
    expect(remoteBody.financeDataPack.gaps[0]).toEqual(expect.objectContaining({
      id: "gap_spec_1",
      requirementId: "d1",
      severity: "error",
    }));
    expect(remoteBody.financeComputePack).toEqual(expect.objectContaining({
      version: "v1",
      computeItems: expect.arrayContaining([
        expect.objectContaining({
          id: "c1",
          type: "peer_comparison_table",
        }),
      ]),
    }));
    expect(remoteBody.financeComputePack.gaps[0]).toEqual(expect.objectContaining({
      computeId: "c1",
      severity: "warning",
    }));
    expect(res.body.taskRun.metadata.remoteHarness.enabled).toBe(true);
    expect(res.body.taskRun.metadata.financeDataPack).toEqual(expect.objectContaining({
      provider: "wind-financial-docs",
      requirementCount: 0,
      gapCount: 1,
      confidenceSummary: expect.objectContaining({ level: "missing" }),
    }));
    expect(res.body.taskRun.metadata.financeComputePack).toEqual(expect.objectContaining({
      computeCount: 1,
      gapCount: 1,
    }));
    expect(res.body.taskRun.stages.map((stage: any) => stage.agentDefinitionId)).toEqual([
      "market-comps-spreader",
      "market-note-writer",
    ]);
    expect(res.body.taskRun.stages[1].runResult.output).toBe("remote ok");

    await new Promise<void>(resolve => server.close(() => resolve()));
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR = oldEnabled;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT = oldEndpoint;
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN = oldToken;
    process.env.WIND_MCP_SKILL_DIR = oldWindSkillDir;
  });
});
