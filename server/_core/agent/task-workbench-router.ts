import { z } from "zod";
import { callLLM, type LLMProvider } from "../llm-provider";

export const taskWorkbenchHarnessPlanStageSchema = z.object({
  stageId: z.string().min(1),
  role: z.enum(["Reader", "Analyst", "Writer"]),
  profile: z.string().min(1),
  inputContract: z.string().optional(),
  outputContract: z.string().optional(),
  skillRefs: z.array(z.string()).optional(),
  mcpPolicy: z.record(z.string(), z.unknown()).optional(),
});
export type TaskWorkbenchHarnessPlanStage = z.infer<typeof taskWorkbenchHarnessPlanStageSchema>;

export const taskWorkbenchHarnessPlanSchema = z.object({
  source: z.literal("financial_harness"),
  runId: z.string().min(1),
  templateId: z.enum(["market-researcher", "meeting-prep-agent", "clarify", "reject_or_reframe"]),
  confidenceScore: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  riskFlags: z.array(z.string()).optional(),
  stages: z.array(taskWorkbenchHarnessPlanStageSchema),
});
export type TaskWorkbenchHarnessPlan = z.infer<typeof taskWorkbenchHarnessPlanSchema>;

export const taskWorkbenchRouterDecisionSchema = z.object({
  intent: z.enum(["chat", "clarify", "run_template", "unsupported"]),
  confidence: z.enum(["high", "medium", "low"]),
  selectedTemplateId: z.enum(["ai_topic_insight_ppt", "market_research_brief", "meeting_prep_agent"]).optional(),
  normalizedGoal: z.string().optional(),
  userVisiblePlan: z.array(z.string()).optional(),
  clarifyingQuestion: z.string().optional(),
  reply: z.string().optional(),
  harnessPlan: taskWorkbenchHarnessPlanSchema.optional(),
});

export type TaskWorkbenchRouterDecision = z.infer<typeof taskWorkbenchRouterDecisionSchema>;

type RouteInput = {
  prompt: string;
  selectedTemplateId?: string | null;
};

const DEFAULT_PLAN = [
  "检索员检索并筛选可信资料",
  "分析师提炼逻辑线与引用依据",
  "写作员生成可预览、可下载的 PPT",
];

const MARKET_RESEARCH_PLAN = [
  "检索员筛选公开市场资料",
  "分析师提炼趋势、机会与风险",
  "写作员生成研究简报",
];

const MEETING_PREP_PLAN = [
  "检索员整理客户与会议资料",
  "分析师提炼客户画像与问题清单",
  "写作员生成会前准备材料",
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

function isClearlyOutOfScopeUtility(prompt: string) {
  return /(天气|气温|下雨|降雨|空气质量|几点|现在时间|今天星期几|日历|闹钟|提醒我|翻译一下|算一下|计算一下|快递|航班|火车票|地图|导航)/i.test(prompt);
}

function hasPptSignal(prompt: string) {
  return /(ppt|pptx|slides?|deck|演示|汇报|路演|课件|幻灯片|做材料|生成材料|生成.*材料|做成.*材料|可下载|可预览)/i.test(prompt);
}

function hasMarketBriefSignal(prompt: string) {
  return /(市场研究|行业研究|专题研究|研究简报|研究报告|市场简报|行业简报|竞品|可比公司|产业链|商业模式|监管影响|投研|尽调|研判|机会|风险)/i.test(prompt);
}

function hasFinancialTopicSignal(prompt: string) {
  return /(跨境支付|支付|清算|结算|人民币国际化|数字人民币|稳定币|代币化|贸易金融|供应链金融|银行|券商|保险|资管|财富管理|信贷|风控|反洗钱|KYC|合规|监管|央行|金融科技|FinTech|fintech)/i.test(prompt);
}

function hasMarketUpdateSignal(prompt: string) {
  return /(最新|最近|近期|新动态|动态|变化|趋势|进展|政策|监管|新闻|有什么新的|发生了什么|怎么看|影响)/i.test(prompt);
}

function hasMeetingPrepSignal(prompt: string) {
  return /(meeting|prep|briefing|客户拜访|客户会|会前|会议准备|拜访准备|访谈提纲|沟通提纲|问题清单|客户画像|参会|纪要准备)/i.test(prompt);
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
      reply: "你好，这里是任务工作台。你可以输入金融研究主题、客户会议目标，或需要整理成汇报材料的主题，我会自动选择合适的任务流程。",
    };
  }

  if (isClearlyOutOfScopeUtility(prompt)) {
    return {
      intent: "chat",
      confidence: "high",
      reply: "这个问题不需要启动任务流程。当前灰度页主要用于金融研究、客户会议准备和材料生成；天气、时间这类即时查询建议回到主聊天处理。",
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

  if (input.selectedTemplateId === "meeting_prep_agent" && hasResearchSignal(prompt) && !looksLikeShortQuestion(prompt)) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "meeting_prep_agent",
      normalizedGoal: prompt,
      userVisiblePlan: MEETING_PREP_PLAN,
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

  if (hasFinancialTopicSignal(prompt) && hasMarketUpdateSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "market_research_brief",
      normalizedGoal: prompt,
      userVisiblePlan: MARKET_RESEARCH_PLAN,
    };
  }

  if (hasMeetingPrepSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "meeting_prep_agent",
      normalizedGoal: prompt,
      userVisiblePlan: MEETING_PREP_PLAN,
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
    reply: "这个输入暂时不像一个可执行任务。你可以换成更明确的目标，例如“整理跨境支付近期动态为研究简报”或“准备拜访某银行科技部的问题清单”。",
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

function harnessEndpointFromEnv(): string | null {
  const endpoint = process.env.TASK_WORKBENCH_HARNESS_ENDPOINT || process.env.LINGXIA_FIN_HARNESS_ENDPOINT || "";
  return endpoint.trim() || null;
}

function parseHarnessOutputFromSse(value: string): string {
  let output = "";
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const body = line.slice("data:".length).trim();
    if (!body || body === "[DONE]") continue;
    try {
      const event = JSON.parse(body) as { event?: string; output?: string; text?: string; delta?: string };
      if (event.event === "run.completed" && typeof event.output === "string") return event.output;
      if (event.event === "reasoning.available" && typeof event.text === "string") output = event.text;
      if (!output && event.event === "message.delta" && typeof event.delta === "string") output += event.delta;
    } catch {
      // Ignore keepalive/comment lines and malformed partials; the completed event is authoritative.
    }
  }
  return output;
}

function mapHarnessTemplateId(templateId: unknown): TaskWorkbenchRouterDecision["selectedTemplateId"] | null {
  if (templateId === "market-researcher") return "market_research_brief";
  if (templateId === "meeting-prep-agent") return "meeting_prep_agent";
  return null;
}

function confidenceFromHarnessScore(score: unknown): TaskWorkbenchRouterDecision["confidence"] {
  if (typeof score !== "number" || !Number.isFinite(score)) return "medium";
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function normalizeHarnessRole(value: unknown): TaskWorkbenchHarnessPlanStage["role"] | null {
  if (value === "Reader" || value === "Analyst" || value === "Writer") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "reader") return "Reader";
  if (normalized === "analyst") return "Analyst";
  if (normalized === "writer") return "Writer";
  return null;
}

function normalizeHarnessPlan(input: {
  runId: string;
  templateId: "market-researcher" | "meeting-prep-agent" | "clarify" | "reject_or_reframe";
  confidence?: unknown;
  reason?: unknown;
  riskFlags?: unknown;
  plan?: unknown;
}): TaskWorkbenchHarnessPlan {
  const stages: TaskWorkbenchHarnessPlanStage[] = [];
  for (const item of Array.isArray(input.plan) ? input.plan : []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const role = normalizeHarnessRole(record.role);
    const stageId = typeof record.stage_id === "string" ? record.stage_id.trim() : "";
    const profile = typeof record.profile === "string" ? record.profile.trim() : "";
    if (!role || !stageId || !profile) continue;
    stages.push({
      stageId,
      role,
      profile,
      inputContract: typeof record.input_contract === "string" ? record.input_contract.trim() : undefined,
      outputContract: typeof record.output_contract === "string" ? record.output_contract.trim() : undefined,
      skillRefs: stringArrayFromUnknown(record.skill_refs),
      mcpPolicy: record.mcp_policy && typeof record.mcp_policy === "object" && !Array.isArray(record.mcp_policy)
        ? record.mcp_policy as Record<string, unknown>
        : undefined,
    });
  }
  return taskWorkbenchHarnessPlanSchema.parse({
    source: "financial_harness",
    runId: input.runId,
    templateId: input.templateId,
    confidenceScore: typeof input.confidence === "number" && Number.isFinite(input.confidence) ? input.confidence : undefined,
    reason: typeof input.reason === "string" ? input.reason.trim() : undefined,
    riskFlags: stringArrayFromUnknown(input.riskFlags),
    stages,
  });
}

async function routeWithFinancialHarness(input: RouteInput): Promise<(TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }) | null> {
  if (String(process.env.TASK_WORKBENCH_ROUTER_HARNESS || "true").toLowerCase() === "false") return null;
  const endpoint = harnessEndpointFromEnv();
  const token = process.env.TASK_WORKBENCH_HARNESS_TOKEN || process.env.HERMES_HTTP_KEY || "";
  if (!endpoint || !token) return null;

  const prompt = trimPrompt(input.prompt);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  const routeResponse = await fetch(`${endpoint.replace(/\/+$/, "")}/v1/harness/route`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      selected_template_id: input.selectedTemplateId || null,
      available_templates: ["market-researcher", "meeting-prep-agent"],
    }),
  });
  const routePayload = await routeResponse.json() as {
    status?: unknown;
    run_id?: string;
    runId?: string;
    result?: unknown;
    error?: unknown;
  };
  const runId = routePayload.run_id || routePayload.runId;
  if (!routeResponse.ok || routePayload.status === "failed" || !runId) {
    throw new Error(`financial_harness_route_failed: ${JSON.stringify(routePayload).slice(0, 220)}`);
  }
  const parsed = (routePayload.result && typeof routePayload.result === "object" ? routePayload.result : routePayload) as {
    template_id?: unknown;
    confidence?: unknown;
    reason?: unknown;
    clarification_question?: unknown;
    risk_flags?: unknown;
    plan?: unknown;
  };
  const templateId = parsed.template_id === "market-researcher" || parsed.template_id === "meeting-prep-agent" || parsed.template_id === "clarify" || parsed.template_id === "reject_or_reframe"
    ? parsed.template_id
    : null;
  if (!templateId) return null;
  const harnessPlan = normalizeHarnessPlan({
    runId,
    templateId,
    confidence: parsed.confidence,
    reason: parsed.reason,
    riskFlags: parsed.risk_flags,
    plan: parsed.plan,
  });

  if (templateId === "clarify") {
    return {
      intent: "clarify",
      confidence: confidenceFromHarnessScore(parsed.confidence),
      clarifyingQuestion: typeof parsed.clarification_question === "string" && parsed.clarification_question.trim()
        ? parsed.clarification_question.trim()
        : "你希望我按市场研究简报，还是按客户会议准备来处理？",
      harnessPlan,
      router: { mode: "financial_harness", runId, templateId, reason: parsed.reason, riskFlags: parsed.risk_flags, harnessPlan },
    };
  }
  if (templateId === "reject_or_reframe") {
    return {
      intent: "unsupported",
      confidence: "high",
      reply: typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "这个请求涉及高风险金融操作，我可以改为帮你整理研究材料、风险提示或汇报草稿。",
      harnessPlan,
      router: { mode: "financial_harness", runId, templateId, reason: parsed.reason, riskFlags: parsed.risk_flags, harnessPlan },
    };
  }

  const selectedTemplateId = mapHarnessTemplateId(templateId);
  if (!selectedTemplateId) return null;
  const decision = normalizeDecision({
    intent: "run_template",
    confidence: confidenceFromHarnessScore(parsed.confidence),
    selectedTemplateId,
    normalizedGoal: prompt,
    userVisiblePlan: selectedTemplateId === "market_research_brief" ? MARKET_RESEARCH_PLAN : MEETING_PREP_PLAN,
  }, prompt);
  return {
    ...decision,
    harnessPlan,
    router: { mode: "financial_harness", runId, templateId, reason: parsed.reason, riskFlags: parsed.risk_flags, harnessPlan },
  };
}

function normalizeDecision(decision: TaskWorkbenchRouterDecision, fallbackPrompt: string): TaskWorkbenchRouterDecision {
  if (decision.intent === "run_template") {
    const selectedTemplateId = decision.selectedTemplateId === "market_research_brief"
      ? "market_research_brief"
      : decision.selectedTemplateId === "meeting_prep_agent"
        ? "meeting_prep_agent"
        : "ai_topic_insight_ppt";
    return {
      ...decision,
      selectedTemplateId,
      normalizedGoal: decision.normalizedGoal || fallbackPrompt,
      userVisiblePlan: decision.userVisiblePlan?.length
        ? decision.userVisiblePlan
        : selectedTemplateId === "market_research_brief"
          ? MARKET_RESEARCH_PLAN
          : selectedTemplateId === "meeting_prep_agent"
            ? MEETING_PREP_PLAN
            : DEFAULT_PLAN,
    };
  }
  return decision;
}

export async function routeTaskWorkbenchPrompt(input: RouteInput): Promise<TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }> {
  const prompt = trimPrompt(input.prompt);
  const ruleDecision = routeTaskWorkbenchPromptByRules(input);

  // Deterministic guards are intentionally ahead of LLM routing.
  if (isGreetingOrMeta(prompt) || isUnsupported(prompt) || isClearlyOutOfScopeUtility(prompt)) {
    return { ...ruleDecision, router: { mode: "rules_guard" } };
  }

  if (String(process.env.TASK_WORKBENCH_ROUTER_LLM || "true").toLowerCase() === "false") {
    return { ...ruleDecision, router: { mode: "rules_only" } };
  }

  if (ruleDecision.intent === "run_template" && ruleDecision.selectedTemplateId === "ai_topic_insight_ppt") {
    return { ...normalizeDecision(ruleDecision, prompt), router: { mode: "rules_ppt_guard" } };
  }

  try {
    const harnessDecision = await routeWithFinancialHarness(input);
    if (harnessDecision) return harnessDecision.router ? harnessDecision : { ...harnessDecision, router: { mode: "financial_harness" } };
  } catch (error) {
    // Keep the grey lab usable while the remote Harness profile is being hardened.
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
            "你是员工智能体任务工作台的入口 Router。你只做意图分流，不执行任务，不创建新 Agent。",
            "当前可运行模板有三个：",
            "1. market_research_brief：金融市场研究简报，检索员筛选公开市场资料 → 分析师提炼趋势、机会与风险 → 写作员生成研究简报。",
            "2. meeting_prep_agent：客户会议准备，检索员整理客户与会议资料 → 分析师提炼客户画像与问题清单 → 写作员生成会前准备材料。",
            "3. ai_topic_insight_ppt：热点话题 PPT 生成，检索员检索资料 → 分析师提炼逻辑线 → 写作员生成 PPT。",
            "如果用户只是问候、闲聊、问你能做什么，intent=chat。",
            "如果用户明确要求生成 PPT、汇报、演示文稿、slides、deck、材料，intent=run_template。",
            "如果用户要求市场研究、行业研究、专题研究、研究简报、竞品/可比公司/产业链/监管影响分析，优先选择 market_research_brief。",
            "如果用户要求客户拜访、会前准备、会议准备、访谈提纲、客户画像或问题清单，优先选择 meeting_prep_agent。",
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
              selectedTemplateId: "market_research_brief | meeting_prep_agent | ai_topic_insight_ppt when run_template",
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
