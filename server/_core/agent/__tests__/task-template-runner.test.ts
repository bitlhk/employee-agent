import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JsonTaskTemplateRunner } from "../task-template-runner";
import type {
  AgentCluster,
  AgentClusterRun,
  AgentClusterRunner,
  AgentResult,
  CreateClusterInput,
  RunClusterInput,
} from "../../../../shared/types/agent";
import type { TaskTemplate } from "../../../../shared/types/task-template";

function template(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: "stock_data_research",
    version: 1,
    status: "active",
    displayName: "股票数据研究",
    shortDescription: "整理股票数据、历史走势、指标和风险因素；不提供投资建议。",
    category: "stock_research",
    estimatedDurationMs: 60000,
    maxDurationMs: 180000,
    stages: [
      {
        id: "stock_research",
        displayName: "生成股票数据研究报告",
        personaId: "hengyue",
        agentDefinitionId: "task-stock",
        executionMode: "single",
        inputMapping: { original: true },
        expectedOutputs: ["markdown_report"],
        timeoutMs: 180000,
        onFailure: "retry_once_then_stop",
      },
    ],
    outputPolicy: {
      allowedArtifactTypes: ["markdown_report", "file_download"],
      disclaimers: ["ai_generated_label", "investment_advisory", "fact_check_required"],
      citationRequired: false,
      saveToWorkspaceDefault: false,
    },
    ...overrides,
  };
}

function twoStageTemplate(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  const first = {
    ...template().stages[0]!,
    id: "research",
    displayName: "研究阶段",
    onFailure: "stop" as const,
  };
  const second = {
    ...template().stages[0]!,
    id: "deck",
    displayName: "生成阶段",
    personaId: "jianye",
    agentDefinitionId: "task-ppt",
    inputMapping: { original: true, fromStages: ["research"] },
    onFailure: "stop" as const,
  };
  return template({
    id: "two_stage_task",
    displayName: "两阶段任务",
    category: "presentation",
    stages: [first, second],
    ...overrides,
  });
}

function sourceResearchTemplate(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  const sourceStage = {
    ...template().stages[0]!,
    id: "source_research",
    stageType: "source_research" as const,
    displayName: "检索员检索趋势来源",
    personaId: "wenzhou",
    agentDefinitionId: "wenzhou-source-research",
    expectedOutputs: ["markdown_report" as const],
    onFailure: "stop" as const,
  };
  const reviewStage = {
    ...template().stages[0]!,
    id: "research_review",
    displayName: "分析师提炼观点与大纲",
    personaId: "moheng",
    agentDefinitionId: "task-moheng-reviewer",
    inputMapping: { original: true, fromStages: ["source_research"] },
    onFailure: "stop" as const,
  };
  return template({
    id: "ai_topic_insight_ppt",
    displayName: "AI 趋势洞察 PPT",
    category: "presentation",
    stages: [sourceStage, reviewStage],
    outputPolicy: {
      allowedArtifactTypes: ["markdown_report", "file_download"],
      disclaimers: ["ai_generated_label", "fact_check_required"],
      citationRequired: true,
      saveToWorkspaceDefault: false,
    },
    ...overrides,
  });
}

function pptBlueprintTemplate(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  const reviewStage = {
    ...template().stages[0]!,
    id: "research_review",
    displayName: "分析师提炼观点与页结构",
    personaId: "moheng",
    agentDefinitionId: "task-moheng-reviewer",
    inputMapping: { original: true },
    onFailure: "stop" as const,
  };
  const pptStage = {
    ...template().stages[0]!,
    id: "ppt_generation",
    displayName: "写作员生成演示文稿",
    personaId: "jianye",
    agentDefinitionId: "task-ppt",
    inputMapping: { original: true, fromStages: ["research_review"] },
    onFailure: "stop" as const,
  };
  return template({
    id: "ppt_blueprint_task",
    displayName: "PPT 蓝图执行测试",
    category: "presentation",
    stages: [reviewStage, pptStage],
    outputPolicy: {
      allowedArtifactTypes: ["ppt_preview", "file_download", "markdown_report"],
      disclaimers: ["ai_generated_label", "fact_check_required"],
      citationRequired: false,
      saveToWorkspaceDefault: false,
    },
    ...overrides,
  });
}

function clusterRun(overrides: Partial<AgentClusterRun> = {}): AgentClusterRun {
  return {
    id: "cluster-run-1",
    clusterId: null,
    userId: 1,
    input: "hello",
    selectedAgentIdsJson: ["task-stock"],
    status: "completed",
    resultsJson: [
      {
        id: "task-stock-result",
        envelopeVersion: "v1",
        agentDefinitionId: "task-stock",
        clusterRunId: "cluster-run-1",
        status: "success",
        output: "OK",
        artifacts: [
          {
            id: "artifact-1",
            type: "markdown",
            name: "report.md",
            downloadUrl: "/signed/report.md",
          },
        ],
        producedAt: "2026-05-03T00:00:00.000Z",
      },
    ],
    createdAt: "2026-05-03T00:00:00.000Z",
    ...overrides,
  };
}

class MockClusterRunner implements AgentClusterRunner {
  public runCalls: RunClusterInput[] = [];
  private runs = new Map<string, AgentClusterRun>();

  constructor(private readonly responses: AgentClusterRun[]) {}

  async createCluster(_userId: number, _input: CreateClusterInput): Promise<AgentResult<AgentCluster>> {
    return { ok: false, error: { kind: "not_implemented", detail: "createCluster" } };
  }

  async loadLastUsed(): Promise<AgentResult<AgentCluster | null>> {
    return { ok: false, error: { kind: "not_implemented", detail: "loadLastUsed" } };
  }

  async runCluster(_clusterId: string | null, input: RunClusterInput): Promise<AgentResult<{ runId: string }>> {
    this.runCalls.push(input);
    const index = this.runCalls.length - 1;
    const response = this.responses[index] || this.responses[this.responses.length - 1];
    if (!response) return { ok: false, error: { kind: "dispatch_failed", detail: "no response" } };
    this.runs.set(response.id, response);
    return { ok: true, value: { runId: response.id } };
  }

  async getRunResult(runId: string): Promise<AgentResult<AgentClusterRun>> {
    const run = this.runs.get(runId);
    return run
      ? { ok: true, value: run }
      : { ok: false, error: { kind: "not_found", detail: runId } };
  }
}

function runner(clusterRunner: AgentClusterRunner, overrides: Partial<ConstructorParameters<typeof JsonTaskTemplateRunner>[0]> = {}) {
  return new JsonTaskTemplateRunner({
    clusterRunner,
    now: () => new Date("2026-05-03T00:00:00.000Z"),
    idFactory: () => "task-run-1",
    ...overrides,
  });
}

describe("JsonTaskTemplateRunner", () => {
  it("loads templates from JSON seed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "task-template-"));
    const file = path.join(dir, "task-templates.seed.json");
    writeFileSync(file, `${JSON.stringify({ templates: [template()] }, null, 2)}\n`, "utf8");
    const result = await new JsonTaskTemplateRunner({
      seedPath: file,
      clusterRunner: new MockClusterRunner([clusterRun()]),
    }).loadTemplate("stock_data_research");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("stock_data_research");
  });

  it("returns completed for single-stage success", async () => {
    const result = await runner(new MockClusterRunner([clusterRun()])).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      expect(result.value.stages[0]?.status).toBe("success");
    }
  });

  it("preserves external orchestration metadata on the task run", async () => {
    const harnessPlan = {
      source: "financial_harness",
      runId: "run-harness-1",
      templateId: "market-researcher",
      stages: [{ stageId: "sector_reader", role: "Reader", profile: "market-sector-reader" }],
    };
    const result = await runner(new MockClusterRunner([clusterRun()])).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test", metadata: { harnessPlan } },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata?.harnessPlan).toEqual(harnessPlan);
    }
  });

  it("retries once and returns failed when retry also fails", async () => {
    const failedRun = clusterRun({
      id: "failed-1",
      status: "failed",
      resultsJson: [{
        id: "failed-result",
        envelopeVersion: "v1",
        agentDefinitionId: "task-stock",
        status: "failed",
        artifacts: [],
        error: { code: "boom", detail: "failed" },
        producedAt: "2026-05-03T00:00:00.000Z",
      }],
    });
    const clusterRunner = new MockClusterRunner([failedRun, { ...failedRun, id: "failed-2" }]);

    const result = await runner(clusterRunner).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(clusterRunner.runCalls).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("failed");
  });

  it("injects ai_generated_label disclaimer marker into task metadata", async () => {
    const result = await runner(new MockClusterRunner([clusterRun()])).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value.metadata as any).disclaimers).toContain("ai_generated_label");
  });

  it("keeps investment advisory disclaimer for stock tasks", async () => {
    const result = await runner(new MockClusterRunner([clusterRun()])).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.disclaimers).toContain("investment_advisory");
  });

  it("filters artifacts that are not in the task whitelist", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await runner(new MockClusterRunner([
      clusterRun({
        resultsJson: [{
          id: "ppt-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-stock",
          status: "success",
          artifacts: [{
            id: "ppt-1",
            type: "pptx",
            name: "deck.pptx",
            downloadUrl: "/signed/deck.pptx",
          }],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ])).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifacts).toHaveLength(0);
      expect(result.value.stages[0]?.warnings?.[0]).toContain("artifact rejected");
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("maps cluster timeout to task timeout", async () => {
    const result = await runner(new MockClusterRunner([
      clusterRun({
        status: "timeout",
        resultsJson: [{
          id: "timeout-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-stock",
          status: "failed",
          artifacts: [],
          error: { code: "timeout", detail: "provider timed out" },
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ])).runTask({
      template: template({ stages: [{ ...template().stages[0]!, onFailure: "stop" }] }),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("timeout");
  });

  it("runs deterministic multi-stage templates sequentially", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "research-run",
        resultsJson: [{
          id: "research-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-stock",
          status: "success",
          output: "FIRST STAGE OUTPUT",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
      clusterRun({
        id: "deck-run",
        resultsJson: [{
          id: "deck-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-ppt",
          status: "success",
          output: "SECOND STAGE OUTPUT",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: twoStageTemplate(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    expect(clusterRunner.runCalls).toHaveLength(2);
    expect(clusterRunner.runCalls[1]?.input).toContain("FIRST STAGE OUTPUT");
    expect(clusterRunner.runCalls[1]?.input).toContain("用户原始需求");
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      expect(result.value.stages.map((stage) => stage.stageId)).toEqual(["research", "deck"]);
    }
  });

  it("passes Moheng slide blueprint to Jianye as a hard deck contract", async () => {
    const mohengBlueprint = [
      "## 建议页结构",
      "第 1 页：封面页——AI 从回答走向执行",
      "- 点明主题",
      "第 2 页：企业场景影响",
      "- 说明流程重构",
      "第 3 页：金融场景影响",
      "- 保留人工决策边界",
    ].join("\n");
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: mohengBlueprint,
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
      clusterRun({
        id: "deck-run",
        resultsJson: [{
          id: "deck-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-ppt",
          status: "success",
          output: [
            "PPT 已生成。",
            "## 蓝图执行情况",
            "分析师建议页数：3",
            "实际生成页数：3",
            "每页标题：1. AI 从回答走向执行；2. 企业场景影响；3. 金融场景影响",
            "无合并、无删减、无新增。",
          ].join("\n"),
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: pptBlueprintTemplate(),
      userInput: "生成一份 AI 趋势洞察 PPT",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    expect(clusterRunner.runCalls).toHaveLength(2);
    const jianyeInput = clusterRunner.runCalls[1]?.input || "";
    expect(jianyeInput).toContain("Deck Blueprint Contract");
    expect(jianyeInput).toContain("最终 PPT 必须也是 3 页");
    expect(jianyeInput).toContain("不得擅自合并、删除或新增页面");
    expect(jianyeInput).toContain("企业影响");
    expect(jianyeInput).toContain("金融影响");
    expect(jianyeInput).toContain("蓝图执行情况");
    expect(jianyeInput).toContain("四字概述标签：清晰观点");
    expect(jianyeInput).toContain("3-4 条精炼证据");
    expect(jianyeInput).toContain("AS-IS / TO-BE");
    if (result.ok) expect(result.value.status).toBe("completed");
  });

  it("prefers structured PPT_BLUEPRINT_JSON when Moheng provides a machine-readable deck plan", async () => {
    const structuredBlueprint = [
      "## 核心洞察",
      "观点：AI 工作流正在从回答转向执行。依据：[src_001]",
      "",
      "## PPT_BLUEPRINT_JSON",
      "```PPT_BLUEPRINT_JSON",
      JSON.stringify({
        version: "v1",
        slides: [
          {
            pageNo: 1,
            title: "模型趋势：AI 从回答走向执行",
            keyMessage: "Agent 正在把软件交互从单次问答改写为可委派工作流。",
            bullets: [
              { text: "Sequoia 强调 doers 而非 talkers", citationRefs: ["src_001"] },
              { text: "Karpathy 关注 agent-native workflow", citationRefs: ["src_002"] },
            ],
            visualIntent: "compare-two-column",
          },
          {
            pageNo: 2,
            title: "企业建议：优先选择可验证流程",
            keyMessage: "企业落地应从高价值、可验证、可追责的流程切入。",
            bullets: [
              { text: "验证闭环比单点模型能力更重要", citationRefs: ["src_002"] },
            ],
            visualIntent: "decision-checklist",
          },
        ],
      }),
      "```",
    ].join("\n");
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: structuredBlueprint,
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
      clusterRun({
        id: "deck-run",
        resultsJson: [{
          id: "deck-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-ppt",
          status: "success",
          output: [
            "PPT 已生成。",
            "## 蓝图执行情况",
            "分析师建议页数：2",
            "实际生成页数：2",
            "每页标题：1. 模型趋势：AI 从回答走向执行；2. 企业建议：优先选择可验证流程",
            "无合并、无删减、无新增。",
          ].join("\n"),
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: pptBlueprintTemplate(),
      userInput: "生成一份 AI 趋势洞察 PPT",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    expect(clusterRunner.runCalls).toHaveLength(2);
    const jianyeInput = clusterRunner.runCalls[1]?.input || "";
    expect(jianyeInput).toContain("最终 PPT 必须也是 2 页");
    expect(jianyeInput).toContain("【结构化蓝图摘要】");
    expect(jianyeInput).toContain("模型趋势：AI 从回答走向执行");
    expect(jianyeInput).toContain("企业建议：优先选择可验证流程");
    expect(jianyeInput).toContain("Agent 正在把软件交互从单次问答改写为可委派工作流");
    expect(jianyeInput).toContain("compare-two-column");
    expect(jianyeInput).toContain("src_001");
    if (result.ok) expect(result.value.status).toBe("completed");
  });

  it("fails ppt_generation when Jianye drifts from Moheng slide count", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: [
            "## 建议页结构",
            "第 1 页：封面页——AI 趋势",
            "第 2 页：企业影响",
            "第 3 页：金融影响",
          ].join("\n"),
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
      clusterRun({
        id: "deck-run",
        resultsJson: [{
          id: "deck-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-ppt",
          status: "success",
          output: [
            "PPT 已生成。",
            "## 蓝图执行情况",
            "分析师建议页数：3",
            "实际生成页数：2",
            "合并：企业影响 + 金融影响。",
          ].join("\n"),
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: pptBlueprintTemplate(),
      userInput: "生成一份 AI 趋势洞察 PPT",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.stages[1]?.status).toBe("failed");
      expect(result.value.stages[1]?.runResult?.error?.code).toBe("ppt_blueprint_violation");
      expect(result.value.stages[1]?.runResult?.error?.detail).toContain("expected 3 slides");
    }
  });

  it("fails ppt_generation when Jianye keeps count but drifts from Moheng title anchors", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: [
            "## 建议页结构",
            "第 1 页：封面页——AI 从回答走向执行",
            "第 2 页：企业场景影响",
            "第 3 页：金融场景影响",
          ].join("\n"),
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
      clusterRun({
        id: "deck-run",
        resultsJson: [{
          id: "deck-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-ppt",
          status: "success",
          output: [
            "PPT 已生成。",
            "## 蓝图执行情况",
            "分析师建议页数：3",
            "实际生成页数：3",
            "每页标题：1. AI 从回答走向执行；2. 企业场景影响；3. 管理层建议",
            "无合并、无删减、无新增。",
          ].join("\n"),
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: pptBlueprintTemplate(),
      userInput: "生成一份 AI 趋势洞察 PPT",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.stages[1]?.runResult?.error?.code).toBe("ppt_blueprint_violation");
      expect(result.value.stages[1]?.runResult?.error?.detail).toContain("ppt_blueprint_title_mismatch");
      expect(result.value.stages[1]?.runResult?.error?.detail).toContain("金融场景影响");
    }
  });

  it("stops deterministic multi-stage execution when a stop stage fails", async () => {
    const failedRun = clusterRun({
      id: "failed-research",
      status: "failed",
      resultsJson: [{
        id: "failed-result",
        envelopeVersion: "v1",
        agentDefinitionId: "task-stock",
        status: "failed",
        artifacts: [],
        error: { code: "boom", detail: "failed" },
        producedAt: "2026-05-03T00:00:00.000Z",
      }],
    });
    const clusterRunner = new MockClusterRunner([failedRun, clusterRun({ id: "should-not-run" })]);

    const result = await runner(clusterRunner).runTask({
      template: twoStageTemplate(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(clusterRunner.runCalls).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.stages).toHaveLength(1);
    }
  });

  it("continues after a failed stage when policy allows partial success", async () => {
    const firstStage = { ...twoStageTemplate().stages[0]!, onFailure: "continue" as const };
    const failedRun = clusterRun({
      id: "failed-research",
      status: "failed",
      resultsJson: [{
        id: "failed-result",
        envelopeVersion: "v1",
        agentDefinitionId: "task-stock",
        status: "failed",
        output: "FAILED BUT AVAILABLE CONTEXT",
        artifacts: [],
        error: { code: "boom", detail: "failed" },
        producedAt: "2026-05-03T00:00:00.000Z",
      }],
    });
    const successRun = clusterRun({
      id: "deck-run",
      resultsJson: [{
        id: "deck-result",
        envelopeVersion: "v1",
        agentDefinitionId: "task-ppt",
        status: "success",
        output: "deck",
        artifacts: [],
        producedAt: "2026-05-03T00:00:00.000Z",
      }],
    });
    const clusterRunner = new MockClusterRunner([failedRun, successRun]);

    const result = await runner(clusterRunner).runTask({
      template: twoStageTemplate({ stages: [firstStage, twoStageTemplate().stages[1]!] }),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(clusterRunner.runCalls).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("partial_success");
  });

  it("passes upstream artifact metadata without signed URLs or bytes", async () => {
    const second = {
      ...twoStageTemplate().stages[1]!,
      inputMapping: { original: true, fromArtifacts: [{ stageId: "research", artifactType: "markdown_report" }] },
    };
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "research-run",
        resultsJson: [{
          id: "research-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-stock",
          status: "success",
          output: "research",
          artifacts: [{
            id: "artifact-1",
            type: "markdown",
            name: "report.md",
            downloadUrl: "/signed/report.md",
          }],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
      clusterRun({ id: "deck-run", resultsJson: [{ ...clusterRun().resultsJson[0]!, agentDefinitionId: "task-ppt" }] }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: twoStageTemplate({ stages: [twoStageTemplate().stages[0]!, second] }),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    expect(clusterRunner.runCalls[1]?.input).toContain("report.md");
    expect(clusterRunner.runCalls[1]?.input).not.toContain("/signed/report.md");
  });

  it("propagates upstream citations through deterministic stages", async () => {
    const citation = {
      id: "cite-1",
      sourceAgentDefinitionId: "task-stock",
      sourceRunResultId: "research-result",
      sourceStageId: "research",
      excerpt: "A concise cited excerpt",
      externalUrl: "https://example.com/report",
      externalTitle: "Report",
    };
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "research-run",
        resultsJson: [{
          id: "research-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-stock",
          status: "success",
          output: "research",
          artifacts: [],
          ownCitations: [citation],
          producedAt: "2026-05-03T00:00:00.000Z",
        } as any],
      }),
      clusterRun({
        id: "deck-run",
        resultsJson: [{
          id: "deck-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-ppt",
          status: "success",
          output: "deck",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);

    const result = await runner(clusterRunner).runTask({
      template: twoStageTemplate(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.upstreamCitations?.[0]?.id).toBe("cite-1");
      expect(result.value.stages[1]?.upstreamCitations?.[0]?.id).toBe("cite-1");
    }
  });

  it("runs source_research stages without dispatching through AgentClusterRunner", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: "PPT outline with evidence [src_001]",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);
    const sourceResearchProvider = {
      research: vi.fn(async () => ({
        topic: "Sequoia AI Ascent 2026",
        generatedAt: "2026-05-03T00:00:00.000Z",
        candidates: [{
          id: "source-1",
          title: "Sequoia AI Ascent 2026",
          url: "https://www.sequoiacap.com/article/ai-ascent/",
          snippet: "Sequoia AI Ascent notes",
          provider: "tavily" as const,
          credibility: "official" as const,
          language: "en" as const,
          tags: ["ai"],
          score: 0.9,
        }],
      })),
    };

    const result = await runner(clusterRunner, { sourceResearchProvider }).runTask({
      template: sourceResearchTemplate(),
      userInput: "Sequoia AI Ascent 2026",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    expect(sourceResearchProvider.research).toHaveBeenCalledWith("Sequoia AI Ascent 2026");
    expect(clusterRunner.runCalls).toHaveLength(1);
    expect(clusterRunner.runCalls[0]?.agentDefinitionIds).toEqual(["task-moheng-reviewer"]);
    expect(clusterRunner.runCalls[0]?.input).toContain("检索员来源证据包");
    expect(clusterRunner.runCalls[0]?.input).toContain("Sequoia AI Ascent notes");
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      expect(result.value.stages[0]?.stageId).toBe("source_research");
      expect(result.value.stages[0]?.ownCitations?.[0]?.externalUrl).toBe("https://www.sequoiacap.com/article/ai-ascent/");
      expect(result.value.runtimeSnapshotJson.stageSnapshots[0]?.stageType).toBe("source_research");
    }
  });

  it("compacts source evidence before handing it to downstream agents", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: "PPT outline with evidence [src_001]",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);
    const sourceResearchProvider = {
      research: vi.fn(async () => ({
        topic: "AI banking",
        generatedAt: "2026-05-03T00:00:00.000Z",
        candidates: Array.from({ length: 10 }, (_, index) => ({
          id: `source-${index + 1}`,
          title: `Source ${index + 1}`,
          url: `https://example.com/source-${index + 1}`,
          snippet: `Snippet ${index + 1} ${"x".repeat(700)}`,
          provider: "tavily" as const,
          credibility: "official" as const,
          language: "en" as const,
          tags: ["ai"],
          score: 0.9,
        })),
      })),
    };

    const result = await runner(clusterRunner, { sourceResearchProvider }).runTask({
      template: sourceResearchTemplate(),
      userInput: "AI banking",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    expect(clusterRunner.runCalls[0]?.input).toContain("Source 8");
    expect(clusterRunner.runCalls[0]?.input).not.toContain("Source 9");
    expect(clusterRunner.runCalls[0]?.input).toContain("已压缩：来源证据包共 10 条候选");
    expect(clusterRunner.runCalls[0]?.input.length).toBeLessThan(9500);
  });

  it("fails research_review when upstream citations exist but output lacks src_NNN ids", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: "PPT outline without traceable citation ids",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);
    const sourceResearchProvider = {
      research: vi.fn(async () => ({
        topic: "AI banking",
        generatedAt: "2026-05-03T00:00:00.000Z",
        candidates: [{
          id: "source-1",
          sourceId: "src_001",
          title: "Official source",
          url: "https://sequoiacap.com/article/ai-ascent/",
          snippet: "Official insight",
          provider: "tavily" as const,
          credibility: "official" as const,
          tier: "official" as const,
          language: "en" as const,
          tags: ["ai"],
          score: 0.9,
        }],
      })),
    };

    const result = await runner(clusterRunner, { sourceResearchProvider }).runTask({
      template: sourceResearchTemplate(),
      userInput: "AI banking",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.stages[1]?.status).toBe("failed");
      expect(result.value.stages[1]?.runResult?.error?.code).toBe("missing_citation_ids");
    }
  });

  it("copies query correction audit entries into task run metadata", async () => {
    const clusterRunner = new MockClusterRunner([
      clusterRun({
        id: "review-run",
        resultsJson: [{
          id: "review-result",
          envelopeVersion: "v1",
          agentDefinitionId: "task-moheng-reviewer",
          status: "success",
          output: "PPT outline with evidence [src_001]",
          artifacts: [],
          producedAt: "2026-05-03T00:00:00.000Z",
        }],
      }),
    ]);
    const sourceResearchProvider = {
      research: vi.fn(async () => ({
        topic: "AI Ascend",
        normalizedQuery: {
          rawQuery: "AI Ascend",
          canonicalQuery: "AI Ascent",
          aliases: ["AI Ascent"],
          corrections: [{ from: "AI Ascend", to: "AI Ascent", confidence: "high" as const, reason: "dictionary" }],
        },
        generatedAt: "2026-05-03T00:00:00.000Z",
        candidates: [{
          id: "source-1",
          sourceId: "src_001",
          title: "Official source",
          url: "https://sequoiacap.com/article/ai-ascent/",
          snippet: "Official insight",
          provider: "tavily" as const,
          credibility: "official" as const,
          tier: "official" as const,
          language: "en" as const,
          tags: ["ai"],
          score: 0.9,
        }],
      })),
    };

    const result = await runner(clusterRunner, { sourceResearchProvider }).runTask({
      template: sourceResearchTemplate(),
      userInput: "AI Ascend",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata?.rawUserPrompt).toBe("AI Ascend");
      expect(result.value.metadata?.appliedCorrections).toEqual([
        expect.objectContaining({ stage: "source_research", from: "AI Ascend", to: "AI Ascent" }),
      ]);
    }
  });

  it("checks actionable advice in reviewer synthesis output", () => {
    const r = runner(new MockClusterRunner([clusterRun()]));
    const riskReviewStage = {
      ...template().stages[0]!,
      id: "risk_review",
      personaId: "reviewer",
      displayName: "审阅员复核合规边界",
      stageType: "llm_synthesis" as const,
    };

    const warnings = (r as any).validateLlmSynthesisOutput(
      riskReviewStage,
      [
        "## 审阅结论",
        "建议立即买入贵州茅台，目标价 2000 元。",
        "## 需人工复核",
        "无。",
        "## 合规边界提醒",
        "无。",
      ].join("\n"),
      [],
    );

    expect(warnings).toContain("financial_advice_boundary_violation: risk_review output contains prohibited advice wording");
  });

  it("separates soft formatting findings from hard synthesis failures", () => {
    const r = runner(new MockClusterRunner([clusterRun()]));
    const analystStage = {
      ...template().stages[0]!,
      id: "market_analysis",
      personaId: "analyst",
      displayName: "分析师提炼观点",
      stageType: "llm_synthesis" as const,
    };

    const findings = (r as any).validateLlmSynthesisOutputFindings(
      analystStage,
      [
        "## 研究结论",
        "跨境支付行业关注度提升。[src_001]",
        "## 关键事实",
        "- 公开资料显示相关政策和市场讨论持续增加。[src_001]",
      ].join("\n"),
      ["src_001"],
    );

    expect(findings).toContainEqual({ severity: "soft", message: "missing_required_heading: ## 不确定性" });
    expect(findings.some((finding: any) => finding.severity === "hard")).toBe(false);
  });

  it("records task template snapshot in runtimeSnapshotJson", async () => {
    const result = await runner(new MockClusterRunner([clusterRun()])).runTask({
      template: template(),
      userInput: "hello",
      context: { userId: 1, adoptId: "lgc-test" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runtimeSnapshotJson.taskTemplateId).toBe("stock_data_research");
      expect(result.value.runtimeSnapshotJson.taskTemplateVersion).toBe(1);
      expect(result.value.runtimeSnapshotJson.chainHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
