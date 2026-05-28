import { afterEach, describe, expect, it, vi } from "vitest";
import {
  routeTaskWorkbenchPrompt,
  routeTaskWorkbenchPromptByRules,
} from "../task-workbench-router";

describe("task workbench router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes greetings to chat", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "你好",
      selectedTemplateId: "research_ppt",
    });

    expect(decision.intent).toBe("chat");
    expect(decision.confidence).toBe("high");
    expect(decision.reply).toContain("任务工作台");
  });

  it("routes explicit PPT requests to the focused template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "请把 Sequoia AI Ascent 2026 的核心观点生成一份 PPT",
      selectedTemplateId: "research_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("research_ppt");
    expect(decision.userVisiblePlan).toHaveLength(5);
  });

  it("keeps selected finance cards from being rerouted to PPT", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "true");
    vi.stubEnv("TASK_WORKBENCH_ROUTER_HARNESS", "true");
    vi.stubEnv("TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT", "http://127.0.0.1:18650");
    vi.stubEnv("HERMES_HTTP_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "生成一份贵州茅台公司一页纸汇报材料，方便给领导看",
      selectedTemplateId: "company_one_page_memo",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("company_one_page_memo");
    expect(decision.router?.mode).toBe("rules_template_guard");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes research topics to the selected PPT template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "看下最新的几个 SOTA 开源模型，分析能力差异以及对金融 AI 的影响",
      selectedTemplateId: "research_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.confidence).toBe("medium");
    expect(decision.selectedTemplateId).toBe("research_ppt");
  });

  it("routes meeting preparation requests to the meeting prep template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "请帮我做一下某银行客户拜访的会前准备和问题清单",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("meeting_prep_agent");
    expect(decision.userVisiblePlan).toHaveLength(3);
  });

  it("routes financial market update questions to the market research template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "跨境支付最近有什么新的动态？",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.confidence).toBe("high");
    expect(decision.selectedTemplateId).toBe("market_research_brief");
    expect(decision.userVisiblePlan).toHaveLength(3);
  });

  it("routes announcement interpretation requests to the Wind template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "帮我解读一下宁德时代最新公告对业绩和估值的影响",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("wind_announcement_digest");
    expect(decision.userVisiblePlan).toEqual([
      "检索员读取万得公告与财经新闻数据",
      "专业写作员生成公告影响解读",
    ]);
  });

  it("asks for clarification when research intent has no selected delivery template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "研究一下最新 AI 趋势",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("clarify");
    expect(decision.clarifyingQuestion).toContain("生成 PPT");
  });

  it("rejects unsupported execution requests", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "帮我买入贵州茅台并发送给客户",
      selectedTemplateId: "research_ppt",
    });

    expect(decision.intent).toBe("unsupported");
    expect(decision.reply).toContain("不会直接执行");
  });

  it("allows bond-rate research prompts that mention trading perspective", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "从短线交易视角研判近期债券利率走势",
      selectedTemplateId: "bond_rate_outlook",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("bond_rate_outlook");
  });

  it("can run in rules-only mode without calling an LLM", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "false");

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "帮我做一份 AI 产业趋势 PPT",
      selectedTemplateId: "research_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.router?.mode).toBe("rules_only");
  });

  it("returns a normalized Financial Harness plan when the remote harness routes the task", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "true");
    vi.stubEnv("TASK_WORKBENCH_ROUTER_HARNESS", "true");
    vi.stubEnv("TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT", "http://127.0.0.1:18650");
    vi.stubEnv("HERMES_HTTP_KEY", "test-key");

    const harnessResult = {
      template_id: "market-researcher",
      confidence: 0.91,
      reason: "Market update request",
      risk_flags: ["needs_source_check"],
      plan: [
        {
          stage_id: "comps_analyst",
          role: "Analyst",
          profile: "market-comps-spreader",
          input_contract: "fact pack",
          output_contract: "market judgment",
          skill_refs: ["comps-analysis"],
          mcp_policy: { tavily: "available" },
        },
      ],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/harness/route")) {
        return new Response(JSON.stringify({
          status: "completed",
          runId: "run-harness-1",
          result: harnessResult,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected_url" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "latest cross-border payment market developments",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("market_research_brief");
    expect(decision.router?.mode).toBe("financial_harness");
    expect(decision.harnessPlan?.runId).toBe("run-harness-1");
    expect(decision.harnessPlan?.templateId).toBe("market-researcher");
    expect(decision.harnessPlan?.skillSpecId).toBe("market-research-brief");
    expect(decision.harnessPlan?.executionLane).toBe("official_spec");
    expect(decision.harnessPlan?.stages.map((stage) => stage.profile)).toEqual(["market-comps-spreader"]);
    expect(decision.harnessPlan?.stages[0]?.skillRefs).toEqual(["comps-analysis"]);
    expect(decision.harnessPlan?.dataRequirements).toEqual([]);
    expect(decision.harnessPlan?.computeRequirements).toEqual([]);
  });

  it("preserves Financial Harness data and compute requirements without executing them", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "true");
    vi.stubEnv("TASK_WORKBENCH_ROUTER_HARNESS", "true");
    vi.stubEnv("LINGXIA_FIN_HARNESS_ENDPOINT", "http://127.0.0.1:18650");
    vi.stubEnv("HERMES_HTTP_KEY", "test-key");

    const harnessResult = {
      template_id: "market-researcher",
      confidence: 0.88,
      reason: "Market update request with explicit data planning",
      risk_flags: ["needs_source_check"],
      skill_spec_id: "market-research-brief",
      execution_lane: "official_spec",
      data_requirements: [
        {
          id: "d1",
          type: "financial_news",
          query: "cross-border payment market developments",
          top_k: 6,
          reason: "Need recent public market evidence",
          required: true,
        },
        {
          id: "ignored",
          type: "unsupported_source",
          query: "should be ignored",
        },
      ],
      compute_requirements: [
        {
          id: "c1",
          type: "none",
          input_refs: ["d1"],
          reason: "No quantitative computation is required",
        },
      ],
      plan: [
        {
          stage_id: "comps_analyst",
          role: "Analyst",
          profile: "market-comps-spreader",
          input_contract: "controlled data pack",
          output_contract: "market judgment",
        },
      ],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/harness/route")) {
        return new Response(JSON.stringify({
          status: "completed",
          runId: "run-harness-2",
          result: harnessResult,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected_url" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "latest cross-border payment market developments",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.harnessPlan?.runId).toBe("run-harness-2");
    expect(decision.harnessPlan?.skillSpecId).toBe("market-research-brief");
    expect(decision.harnessPlan?.executionLane).toBe("official_spec");
    expect(decision.harnessPlan?.dataRequirements).toEqual([
      {
        id: "d1",
        type: "financial_news",
        query: "cross-border payment market developments",
        topK: 6,
        reason: "Need recent public market evidence",
        required: true,
      },
    ]);
    expect(decision.harnessPlan?.computeRequirements).toEqual([
      {
        id: "c1",
        type: "none",
        inputRefs: ["d1"],
        reason: "No quantitative computation is required",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Financial Harness plans when the route response omits run id", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "true");
    vi.stubEnv("TASK_WORKBENCH_ROUTER_HARNESS", "true");
    vi.stubEnv("LINGXIA_FIN_HARNESS_ENDPOINT", "http://127.0.0.1:18650");
    vi.stubEnv("HERMES_HTTP_KEY", "test-key");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/harness/route")) {
        return new Response(JSON.stringify({
          status: "completed",
          result: {
            template_id: "market-researcher",
            confidence: 0.9,
            reason: "Market research request",
            data_requirements: [{
              id: "d1",
              type: "financial_news",
              query: "US Iran conflict market impact",
              top_k: 4,
            }],
            plan: [{
              stage_id: "comps_analyst",
              role: "Analyst",
              profile: "market-comps-spreader",
            }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected_url" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "洞察一下近期美国伊朗战争对金融的影响趋势，生成研究简报",
      selectedTemplateId: "market_research_brief",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("market_research_brief");
    expect(decision.router?.mode).toBe("financial_harness");
    expect(decision.harnessPlan?.runId).toMatch(/^financial-harness-/);
    expect(decision.harnessPlan?.dataRequirements).toHaveLength(1);
  });

  it("routes with executor-only endpoint and token configuration", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "true");
    vi.stubEnv("TASK_WORKBENCH_ROUTER_HARNESS", "true");
    vi.stubEnv("TASK_WORKBENCH_HARNESS_ENDPOINT", "");
    vi.stubEnv("LINGXIA_FIN_HARNESS_ENDPOINT", "");
    vi.stubEnv("HERMES_HTTP_KEY", "");
    vi.stubEnv("LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT", "http://127.0.0.1:18651");
    vi.stubEnv("TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN", "executor-token");

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:18651/v1/harness/route");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer executor-token",
      });
      return new Response(JSON.stringify({
        status: "completed",
        runId: "run-executor-only",
        result: {
          template_id: "meeting-prep-agent",
          confidence: 0.86,
          reason: "Meeting preparation request",
          plan: [{
            stage_id: "meeting_profiler",
            role: "Analyst",
            profile: "meeting-profiler",
          }],
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "准备一次银行客户拜访材料",
      selectedTemplateId: "meeting_prep_agent",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("meeting_prep_agent");
    expect(decision.router?.mode).toBe("financial_harness");
    expect(decision.harnessPlan?.runId).toBe("run-executor-only");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
