import { z } from "zod";
import { callLLM, type LLMProvider } from "../llm-provider";

export const taskWorkbenchRouterDecisionSchema = z.object({
  intent: z.enum(["chat", "clarify", "run_template", "unsupported"]),
  confidence: z.enum(["high", "medium", "low"]),
  selectedTemplateId: z.enum(["ai_topic_insight_ppt", "market_research_brief"]).optional(),
  normalizedGoal: z.string().optional(),
  userVisiblePlan: z.array(z.string()).optional(),
  clarifyingQuestion: z.string().optional(),
  reply: z.string().optional(),
});

export type TaskWorkbenchRouterDecision = z.infer<typeof taskWorkbenchRouterDecisionSchema>;

type RouteInput = {
  prompt: string;
  selectedTemplateId?: string | null;
};

const DEFAULT_PLAN = [
  "闻舟检索并筛选可信资料",
  "墨衡提炼逻辑线与引用依据",
  "简页生成可预览、可下载的 PPT",
];

const MARKET_RESEARCH_PLAN = [
  "闻舟检索并分层筛选可信来源",
  "墨衡提炼市场判断、机会约束和不确定性",
  "简页生成可审阅的市场研究简报",
  "墨衡复核引用、合规边界和人工待核查项",
];

function trimPrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim();
}

function isGreetingOrMeta(prompt: string) {
  const text = trimPrompt(prompt).toLowerCase();
  if (!text) return false;
  if (/^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|晚上好)[!！。,.，\s]*$/.test(text)) return true;
  if (/^(你是谁|你能做什么|怎么用|如何使用|介绍一下你|你有什么能力)[?？!！。,.，\s]*$/.test(text)) return true;
  return text.length <= 8 && /^(hi|hello|你好|在吗|help|帮助)$/.test(text);
}

function isUnsupported(prompt: string) {
  return /(替我|帮我)?(下单|买入|卖出|交易|转账|付款|提现|发邮件|群发|发送给客户|删除生产|重置生产|执行交易)/.test(prompt);
}

function hasPptSignal(prompt: string) {
  return /(ppt|pptx|slides?|deck|演示|汇报|路演|课件|幻灯片|做材料|生成材料|生成.*材料|做成.*材料|可下载|可预览)/i.test(prompt);
}

function hasMarketBriefSignal(prompt: string) {
  return /(市场研究|行业研究|专题研究|研究简报|研究报告|市场简报|行业简报|竞品|可比公司|产业链|商业模式|监管影响|投研|尽调|研判|机会|风险)/i.test(prompt);
}

function hasResearchSignal(prompt: string) {
  return /(搜索|检索|研究|分析|洞察|趋势|最新|影响|观点|提炼|逻辑线|报告|总结|对比|SOTA|模型|AI|金融|大会|开源|技术|产业|Hermes|OpenClaw|Sequoia|Ascent|Mythos)/i.test(prompt);
}

function looksLikeShortQuestion(prompt: string) {
  const text = trimPrompt(prompt);
  return text.length < 18 && /^(什么是|怎么|如何|为什么|能不能|可以吗|是否|介绍)/.test(text);
}

export function routeTaskWorkbenchPromptByRules(input: RouteInput): TaskWorkbenchRouterDecision {
  const prompt = trimPrompt(input.prompt);
  if (isGreetingOrMeta(prompt)) {
    return {
      intent: "chat",
      confidence: "high",
      reply: "你好，我是任务工作台。现在支持两类灰度任务：「金融市场研究简报」和「热点话题 PPT 生成」。你给一个研究主题，我会组织闻舟检索资料、墨衡分析复核，再由简页整理成可审阅材料。",
    };
  }

  if (isUnsupported(prompt)) {
    return {
      intent: "unsupported",
      confidence: "high",
      reply: "这个请求涉及交易、外发或高风险操作，任务工作台不会直接执行。我可以帮你整理分析材料、风险提示或汇报草稿。",
    };
  }

  if (hasPptSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "ai_topic_insight_ppt",
      normalizedGoal: prompt,
      userVisiblePlan: DEFAULT_PLAN,
    };
  }

  if (input.selectedTemplateId === "market_research_brief" && hasResearchSignal(prompt) && !looksLikeShortQuestion(prompt)) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "market_research_brief",
      normalizedGoal: prompt,
      userVisiblePlan: MARKET_RESEARCH_PLAN,
    };
  }

  if (hasMarketBriefSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "market_research_brief",
      normalizedGoal: prompt,
      userVisiblePlan: MARKET_RESEARCH_PLAN,
    };
  }

  if (input.selectedTemplateId === "ai_topic_insight_ppt" && hasResearchSignal(prompt) && !looksLikeShortQuestion(prompt)) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "ai_topic_insight_ppt",
      normalizedGoal: prompt,
      userVisiblePlan: DEFAULT_PLAN,
    };
  }

  if (hasResearchSignal(prompt)) {
    return {
      intent: "clarify",
      confidence: "medium",
      clarifyingQuestion: "你是想把这个主题直接生成 PPT，还是只想先做资料研究和逻辑梳理？",
    };
  }

  return {
    intent: "chat",
    confidence: "medium",
    reply: "我可以继续聊，也可以帮你把一个 AI、金融或技术趋势主题做成 PPT。你可以直接说：把某个主题整理成一份汇报 PPT。",
  };
}

function extractJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function providerFromEnv(): LLMProvider | undefined {
  const raw = String(process.env.TASK_WORKBENCH_ROUTER_PROVIDER || "").toLowerCase();
  if (raw === "deepseek" || raw === "zhipu") return raw;
  return undefined;
}

function normalizeDecision(decision: TaskWorkbenchRouterDecision, fallbackPrompt: string): TaskWorkbenchRouterDecision {
  if (decision.intent === "run_template") {
    const selectedTemplateId = decision.selectedTemplateId === "market_research_brief" ? "market_research_brief" : "ai_topic_insight_ppt";
    return {
      ...decision,
      selectedTemplateId,
      normalizedGoal: decision.normalizedGoal || fallbackPrompt,
      userVisiblePlan: decision.userVisiblePlan?.length
        ? decision.userVisiblePlan
        : selectedTemplateId === "market_research_brief" ? MARKET_RESEARCH_PLAN : DEFAULT_PLAN,
    };
  }
  return decision;
}

export async function routeTaskWorkbenchPrompt(input: RouteInput): Promise<TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }> {
  const prompt = trimPrompt(input.prompt);

  // Deterministic guards are intentionally ahead of LLM routing.
  if (isGreetingOrMeta(prompt) || isUnsupported(prompt)) {
    return { ...routeTaskWorkbenchPromptByRules(input), router: { mode: "rules_guard" } };
  }

  if (String(process.env.TASK_WORKBENCH_ROUTER_LLM || "true").toLowerCase() === "false") {
    return { ...routeTaskWorkbenchPromptByRules(input), router: { mode: "rules_only" } };
  }

  try {
    const result = await callLLM({
      provider: providerFromEnv(),
      temperature: 0,
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content: [
            "你是灵虾任务工作台的入口 Router。你只做意图分流，不执行任务，不创建新 Agent。",
            "当前可运行模板有两个：",
            "1. market_research_brief：金融市场研究简报，闻舟检索资料 → 墨衡市场分析 → 简页写简报 → 墨衡风险审阅。",
            "2. ai_topic_insight_ppt：热点话题 PPT 生成，闻舟检索资料 → 墨衡提炼逻辑线 → 简页生成 PPT。",
            "如果用户只是问候、闲聊、问你能做什么，intent=chat。",
            "如果用户明确要求生成 PPT、汇报、演示文稿、slides、deck、材料，intent=run_template。",
            "如果用户要求市场研究、行业研究、专题研究、研究简报、竞品/可比公司/产业链/监管影响分析，优先选择 market_research_brief。",
            "如果用户围绕 AI/金融/技术趋势提出较完整研究主题，且当前选中某个模板，也可以 intent=run_template 并保持当前模板。",
            "如果用户只是模糊地说研究/看看/分析但未说明交付物，intent=clarify。",
            "高风险操作、交易下单、外发邮件、生产删除等 intent=unsupported。",
            "只返回 JSON，不要 Markdown。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt,
            selectedTemplateId: input.selectedTemplateId || null,
            outputSchema: {
              intent: "chat | clarify | run_template | unsupported",
              confidence: "high | medium | low",
              selectedTemplateId: "market_research_brief | ai_topic_insight_ppt when run_template",
              normalizedGoal: "clean task goal when run_template",
              userVisiblePlan: DEFAULT_PLAN,
              clarifyingQuestion: "when clarify",
              reply: "when chat or unsupported",
            },
          }),
        },
      ],
    });
    const json = extractJsonObject(result.content);
    if (!json) throw new Error("router_llm_no_json");
    const parsed = taskWorkbenchRouterDecisionSchema.safeParse(JSON.parse(json));
    if (!parsed.success) throw new Error(`router_llm_invalid_json: ${parsed.error.message}`);
    const decision = normalizeDecision(parsed.data, prompt);
    return { ...decision, router: { mode: "llm", provider: result.provider, model: result.model } };
  } catch (error) {
    const decision = normalizeDecision(routeTaskWorkbenchPromptByRules(input), prompt);
    return {
      ...decision,
      router: {
        mode: "rules_fallback",
        reason: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
      },
    };
  }
}
