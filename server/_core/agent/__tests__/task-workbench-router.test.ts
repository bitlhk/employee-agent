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
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("chat");
    expect(decision.confidence).toBe("high");
    expect(decision.reply).toContain("任务工作台");
  });

  it("routes explicit PPT requests to the focused template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "请把 Sequoia AI Ascent 2026 的核心观点生成一份 PPT",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("ai_topic_insight_ppt");
    expect(decision.userVisiblePlan).toHaveLength(3);
  });

  it("routes research topics to the selected PPT template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "看下最新的几个 SOTA 开源模型，分析能力差异以及对金融 AI 的影响",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.confidence).toBe("medium");
    expect(decision.selectedTemplateId).toBe("ai_topic_insight_ppt");
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
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("unsupported");
    expect(decision.reply).toContain("不会直接执行");
  });

  it("can run in rules-only mode without calling an LLM", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "false");

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "帮我做一份 AI 产业趋势 PPT",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.router?.mode).toBe("rules_only");
  });

  it("returns a normalized Financial Harness plan when the remote harness routes the task", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "true");
    vi.stubEnv("TASK_WORKBENCH_ROUTER_HARNESS", "true");
    vi.stubEnv("LINGXIA_FIN_HARNESS_ENDPOINT", "http://127.0.0.1:18650");
    vi.stubEnv("HERMES_HTTP_KEY", "test-key");

    const harnessResult = {
      template_id: "market-researcher",
      confidence: 0.91,
      reason: "Market update request",
      risk_flags: ["needs_source_check"],
      plan: [
        {
          stage_id: "sector_reader",
          role: "Reader",
          profile: "market-sector-reader",
          input_contract: "public market question",
          output_contract: "source-backed fact pack",
        },
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
    expect(decision.harnessPlan?.stages.map((stage) => stage.profile)).toEqual(["market-sector-reader", "market-comps-spreader"]);
    expect(decision.harnessPlan?.stages[1]?.skillRefs).toEqual(["comps-analysis"]);
  });
});
