import { randomUUID } from "node:crypto";
import { z } from "zod";
import { callLLM, type LLMProvider } from "../llm-provider";
import {
  FINANCE_SKILL_SPEC_IDS,
  defaultFinanceSkillSpecForHarnessTemplate,
  getFinanceSkillSpec,
  isFinanceSkillSpecId,
} from "./finance-skill-specs";

export const taskWorkbenchHarnessPlanStageSchema = z.object({
  stageId: z.string().min(1),
  role: z.enum(["Reader", "Analyst", "Writer", "Data", "Compute", "Alice", "Reviewer"]),
  profile: z.string().min(1),
  inputContract: z.string().optional(),
  outputContract: z.string().optional(),
  skillRefs: z.array(z.string()).optional(),
  mcpPolicy: z.record(z.string(), z.unknown()).optional(),
});
export type TaskWorkbenchHarnessPlanStage = z.infer<
  typeof taskWorkbenchHarnessPlanStageSchema
>;

export const taskWorkbenchDataRequirementSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "financial_news",
    "company_announcements",
    "company_profile",
    "stock_fundamentals",
    "market_snapshot",
    "macro_series",
    "fund_data",
    "bond_data",
    "internal_context",
  ]),
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional(),
  reason: z.string().optional(),
  required: z.boolean().optional(),
});
export type TaskWorkbenchDataRequirement = z.infer<
  typeof taskWorkbenchDataRequirementSchema
>;

export const taskWorkbenchComputeRequirementSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "none",
    "time_series_metrics",
    "peer_comparison_table",
    "event_window_return",
    "financial_ratio_summary",
    "fund_performance_compare",
    "excel_cleaning_summary",
  ]),
  inputRefs: z.array(z.string()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
});
export type TaskWorkbenchComputeRequirement = z.infer<
  typeof taskWorkbenchComputeRequirementSchema
>;

export const taskWorkbenchHarnessPlanSchema = z.object({
  source: z.literal("financial_harness"),
  runId: z.string().min(1),
  templateId: z.enum([
    "market-researcher",
    "meeting-prep-agent",
    "clarify",
    "reject_or_reframe",
  ]),
  skillSpecId: z.enum(FINANCE_SKILL_SPEC_IDS).optional(),
  executionLane: z.enum(["official_spec", "alice_exploration"]).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  riskFlags: z.array(z.string()).optional(),
  dataRequirements: z.array(taskWorkbenchDataRequirementSchema).optional(),
  computeRequirements: z.array(taskWorkbenchComputeRequirementSchema).optional(),
  stages: z.array(taskWorkbenchHarnessPlanStageSchema),
});
export type TaskWorkbenchHarnessPlan = z.infer<
  typeof taskWorkbenchHarnessPlanSchema
>;

export const taskWorkbenchRouterDecisionSchema = z.object({
  intent: z.enum(["chat", "clarify", "run_template", "unsupported"]),
  confidence: z.enum(["high", "medium", "low"]),
  selectedTemplateId: z
    .enum([
      "research_ppt",
      "market_research_brief",
      "meeting_prep_agent",
      "wind_announcement_digest",
      "fund_compare",
      "peer_comps_analysis",
      "theme_leader_analysis",
      "earnings_commentary",
      "company_one_page_memo",
      "macro_data_brief",
      "credit_analysis",
      "bond_rate_outlook",
      "video_outline",
      "meeting_notes",
      "excel_fill",
    ])
    .optional(),
  normalizedGoal: z.string().optional(),
  userVisiblePlan: z.array(z.string()).optional(),
  clarifyingQuestion: z.string().optional(),
  reply: z.string().optional(),
  harnessPlan: taskWorkbenchHarnessPlanSchema.optional(),
});

export type TaskWorkbenchRouterDecision = z.infer<
  typeof taskWorkbenchRouterDecisionSchema
>;

type RouteInput = {
  prompt: string;
  selectedTemplateId?: string | null;
};

const DEFAULT_PLAN = [
  "检索员检索并筛选可信资料",
  "分析师提炼逻辑线与引用依据",
  "大纲员生成 Markdown 大纲和 PPT_BLUEPRINT_JSON",
  "模板渲染器生成 PPTX",
  "质量校验器检查页数、标题和产物",
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

const WIND_ANNOUNCEMENT_PLAN = [
  "检索员读取万得公告与财经新闻数据",
  "专业写作员生成公告影响解读",
];

const VIDEO_OUTLINE_PLAN = [
  "检索员读取视频链接、字幕和公开页面信息",
  "写作员整理学习提纲、关键观点和可复用要点",
];

const MEETING_NOTES_PLAN = [
  "转写员读取录音或会议转写文本",
  "写作员生成会议摘要、关键决策和待办事项",
];

const EXCEL_FILL_PLAN = [
  "分析员读取 Excel 和背景材料，生成可审核填表方案",
  "执行员按方案写回新的 Excel 副本并输出处理说明",
];

function trimPrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim();
}

function isGreetingOrMeta(prompt: string) {
  const text = trimPrompt(prompt).toLowerCase();
  if (!text) return false;
  if (
    /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|晚上好)[!！。,.，\s]*$/.test(
      text
    )
  )
    return true;
  if (
    /^(你是谁|你能做什么|怎么用|如何使用|介绍一下你|你有什么能力)[?？!！。,.，\s]*$/.test(
      text
    )
  )
    return true;
  return text.length <= 8 && /^(hi|hello|你好|在吗|help|帮助)$/.test(text);
}

function isUnsupported(prompt: string) {
  const text = trimPrompt(prompt);
  if (
    /(下单|买入|卖出|转账|付款|提现|发邮件|群发|发送给客户|删除生产|重置生产|执行交易)/.test(
      text
    )
  ) {
    return true;
  }
  return (
    /(替我|帮我|直接|自动|立即).{0,10}(交易下单|下单交易|委托交易|实盘交易|挂单)/.test(
      text
    ) || /(交易|委托|挂单).{0,8}(下单|执行|账户|实盘)/.test(text)
  );
}

function isClearlyOutOfScopeUtility(prompt: string) {
  return /(天气|气温|下雨|降雨|空气质量|几点|现在时间|今天星期几|日历|闹钟|提醒我|翻译一下|算一下|计算一下|快递|航班|火车票|地图|导航)/i.test(
    prompt
  );
}

function hasPptSignal(prompt: string) {
  return /(ppt|pptx|slides?|deck|演示|汇报|路演|课件|幻灯片|做材料|生成材料|生成.*材料|做成.*材料|可下载|可预览)/i.test(
    prompt
  );
}

function hasMarketBriefSignal(prompt: string) {
  return /(市场研究|行业研究|专题研究|研究简报|研究报告|市场简报|行业简报|竞品|可比公司|产业链|商业模式|监管影响|投研|尽调|研判|机会|风险)/i.test(
    prompt
  );
}

function hasFinancialTopicSignal(prompt: string) {
  return /(跨境支付|支付|清算|结算|人民币国际化|数字人民币|稳定币|代币化|贸易金融|供应链金融|银行|券商|保险|资管|财富管理|信贷|风控|反洗钱|KYC|合规|监管|央行|金融科技|FinTech|fintech)/i.test(
    prompt
  );
}

function hasMarketUpdateSignal(prompt: string) {
  return /(最新|最近|近期|新动态|动态|变化|趋势|进展|政策|监管|新闻|有什么新的|发生了什么|怎么看|影响)/i.test(
    prompt
  );
}

function hasMeetingPrepSignal(prompt: string) {
  return /(meeting|prep|briefing|客户拜访|客户会|会前|会议准备|拜访准备|访谈提纲|沟通提纲|问题清单|客户画像|参会|纪要准备)/i.test(
    prompt
  );
}

function hasMeetingNotesSignal(prompt: string) {
  return /(会议纪要|会议记录|会议摘要|会议转写|录音|音频|待办事项|会议决策|整理纪要|生成纪要)/i.test(
    prompt
  );
}

function hasExcelFillSignal(prompt: string) {
  return /(excel|xlsx|xls|表格|填表|补全|写回|字段映射|台账|客户资料表|数据表|电子表格)/i.test(
    prompt
  );
}

function hasWindAnnouncementSignal(prompt: string) {
  return /(公告|年报|半年报|季报|财报|定期报告|临时公告|监管披露|招股书|董事会决议|股权变动|分红|回购|减持|增持|业绩预告|业绩快报|重大合同|诉讼|处罚|公告解读)/i.test(
    prompt
  );
}

function hasVideoOutlineSignal(prompt: string) {
  return /(视频|课程|讲座|直播|回放|字幕|transcript|youtube|bilibili|b站|抖音|小红书|提纲|笔记|章节|时间戳)/i.test(
    prompt
  );
}

function hasResearchSignal(prompt: string) {
  return /(搜索|检索|研究|分析|洞察|趋势|最新|影响|观点|提炼|逻辑线|报告|总结|对比|SOTA|模型|AI|金融|大会|开源|技术|产业|Hermes|OpenClaw|Sequoia|Ascent|Mythos)/i.test(
    prompt
  );
}

function looksLikeShortQuestion(prompt: string) {
  const text = trimPrompt(prompt);
  return (
    text.length < 18 &&
    /^(什么是|怎么|如何|为什么|能不能|可以吗|是否|介绍)/.test(text)
  );
}

const SELECTED_TEMPLATE_LOCK_IDS = [
  "market_research_brief",
  "meeting_prep_agent",
  "wind_announcement_digest",
  "fund_compare",
  "peer_comps_analysis",
  "theme_leader_analysis",
  "earnings_commentary",
  "company_one_page_memo",
  "macro_data_brief",
  "credit_analysis",
  "bond_rate_outlook",
  "video_outline",
  "meeting_notes",
  "excel_fill",
  "research_ppt",
] as const;

function isLockableTemplateId(
  templateId: unknown
): templateId is TaskWorkbenchRouterDecision["selectedTemplateId"] {
  return SELECTED_TEMPLATE_LOCK_IDS.includes(templateId as any);
}

function visiblePlanForTemplate(
  templateId: TaskWorkbenchRouterDecision["selectedTemplateId"]
) {
  if (templateId === "market_research_brief") return MARKET_RESEARCH_PLAN;
  if (templateId === "meeting_prep_agent") return MEETING_PREP_PLAN;
  if (templateId === "wind_announcement_digest") return WIND_ANNOUNCEMENT_PLAN;
  if (templateId === "video_outline") return VIDEO_OUTLINE_PLAN;
  if (templateId === "meeting_notes") return MEETING_NOTES_PLAN;
  if (templateId === "excel_fill") return EXCEL_FILL_PLAN;
  if (
    templateId &&
    [
      "fund_compare",
      "peer_comps_analysis",
      "theme_leader_analysis",
      "earnings_commentary",
      "company_one_page_memo",
      "macro_data_brief",
      "credit_analysis",
      "bond_rate_outlook",
    ].includes(templateId)
  ) {
    return [
      "调取受控金融数据或官方专业能力",
      "生成结构化分析与风险提示",
      "输出可预览和可下载的研究材料",
    ];
  }
  return DEFAULT_PLAN;
}

export function routeTaskWorkbenchPromptByRules(
  input: RouteInput
): TaskWorkbenchRouterDecision {
  const prompt = trimPrompt(input.prompt);
  if (isGreetingOrMeta(prompt)) {
    return {
      intent: "chat",
      confidence: "high",
      reply:
        "你好，这里是任务工作台。你可以输入金融研究主题、客户会议目标，或需要整理成汇报材料的主题，我会自动选择合适的任务流程。",
    };
  }

  if (isClearlyOutOfScopeUtility(prompt)) {
    return {
      intent: "chat",
      confidence: "high",
      reply:
        "这个问题不需要启动任务流程。当前灰度页主要用于金融研究、客户会议准备和材料生成；天气、时间这类即时查询建议回到主聊天处理。",
    };
  }

  if (isUnsupported(prompt)) {
    return {
      intent: "unsupported",
      confidence: "high",
      reply:
        "这个请求涉及交易、外发或高风险操作，任务工作台不会直接执行。我可以帮你整理分析材料、风险提示或汇报草稿。",
    };
  }

  // If the user entered through a concrete Office Space card, keep that
  // capability selected. Words like "材料/PPT/汇报" should not silently jump a
  // finance workflow into research_ppt.
  if (
    isLockableTemplateId(input.selectedTemplateId) &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: input.selectedTemplateId,
      normalizedGoal: prompt,
      userVisiblePlan: visiblePlanForTemplate(input.selectedTemplateId),
    };
  }

  if (hasPptSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "research_ppt",
      normalizedGoal: prompt,
      userVisiblePlan: DEFAULT_PLAN,
    };
  }

  if (input.selectedTemplateId === "video_outline" && hasResearchSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "video_outline",
      normalizedGoal: prompt,
      userVisiblePlan: VIDEO_OUTLINE_PLAN,
    };
  }

  if (
    input.selectedTemplateId === "meeting_notes" &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "meeting_notes",
      normalizedGoal: prompt,
      userVisiblePlan: MEETING_NOTES_PLAN,
    };
  }

  if (
    input.selectedTemplateId === "excel_fill" &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "excel_fill",
      normalizedGoal: prompt,
      userVisiblePlan: EXCEL_FILL_PLAN,
    };
  }

  if (hasVideoOutlineSignal(prompt) && /(https?:\/\/|www\.)/i.test(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "video_outline",
      normalizedGoal: prompt,
      userVisiblePlan: VIDEO_OUTLINE_PLAN,
    };
  }

  if (
    input.selectedTemplateId === "meeting_prep_agent" &&
    hasResearchSignal(prompt) &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "meeting_prep_agent",
      normalizedGoal: prompt,
      userVisiblePlan: MEETING_PREP_PLAN,
    };
  }

  if (
    input.selectedTemplateId === "wind_announcement_digest" &&
    (hasResearchSignal(prompt) || hasWindAnnouncementSignal(prompt)) &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "wind_announcement_digest",
      normalizedGoal: prompt,
      userVisiblePlan: WIND_ANNOUNCEMENT_PLAN,
    };
  }

  if (
    input.selectedTemplateId === "market_research_brief" &&
    hasResearchSignal(prompt) &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "market_research_brief",
      normalizedGoal: prompt,
      userVisiblePlan: MARKET_RESEARCH_PLAN,
    };
  }

  if (hasWindAnnouncementSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "wind_announcement_digest",
      normalizedGoal: prompt,
      userVisiblePlan: WIND_ANNOUNCEMENT_PLAN,
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

  if (hasMeetingNotesSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "meeting_notes",
      normalizedGoal: prompt,
      userVisiblePlan: MEETING_NOTES_PLAN,
    };
  }

  if (hasExcelFillSignal(prompt)) {
    return {
      intent: "run_template",
      confidence: "high",
      selectedTemplateId: "excel_fill",
      normalizedGoal: prompt,
      userVisiblePlan: EXCEL_FILL_PLAN,
    };
  }

  if (
    input.selectedTemplateId === "research_ppt" &&
    hasResearchSignal(prompt) &&
    !looksLikeShortQuestion(prompt)
  ) {
    return {
      intent: "run_template",
      confidence: "medium",
      selectedTemplateId: "research_ppt",
      normalizedGoal: prompt,
      userVisiblePlan: DEFAULT_PLAN,
    };
  }

  if (hasResearchSignal(prompt)) {
    return {
      intent: "clarify",
      confidence: "medium",
      clarifyingQuestion:
        "你是想把这个主题直接生成 PPT，还是只想先做资料研究和逻辑梳理？",
    };
  }

  return {
    intent: "chat",
    confidence: "medium",
    reply:
      "这个输入暂时不像一个可执行任务。你可以换成更明确的目标，例如“整理跨境支付近期动态为研究简报”或“准备拜访某银行科技部的问题清单”。",
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
  const raw = String(
    process.env.TASK_WORKBENCH_ROUTER_PROVIDER || ""
  ).toLowerCase();
  if (raw === "deepseek" || raw === "zhipu") return raw;
  return undefined;
}

function harnessEndpointFromEnv(): string | null {
  const endpoint =
    process.env.TASK_WORKBENCH_HARNESS_ENDPOINT ||
    process.env.LINGXIA_FIN_HARNESS_ENDPOINT ||
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT ||
    process.env.LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT ||
    "";
  return endpoint.trim() || null;
}

function parseHarnessOutputFromSse(value: string): string {
  let output = "";
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const body = line.slice("data:".length).trim();
    if (!body || body === "[DONE]") continue;
    try {
      const event = JSON.parse(body) as {
        event?: string;
        output?: string;
        text?: string;
        delta?: string;
      };
      if (event.event === "run.completed" && typeof event.output === "string")
        return event.output;
      if (
        event.event === "reasoning.available" &&
        typeof event.text === "string"
      )
        output = event.text;
      if (
        !output &&
        event.event === "message.delta" &&
        typeof event.delta === "string"
      )
        output += event.delta;
    } catch {
      // Ignore keepalive/comment lines and malformed partials; the completed event is authoritative.
    }
  }
  return output;
}

function mapHarnessTemplateId(
  templateId: unknown
): TaskWorkbenchRouterDecision["selectedTemplateId"] | null {
  if (templateId === "market-researcher") return "market_research_brief";
  if (templateId === "meeting-prep-agent") return "meeting_prep_agent";
  return null;
}

function confidenceFromHarnessScore(
  score: unknown
): TaskWorkbenchRouterDecision["confidence"] {
  if (typeof score !== "number" || !Number.isFinite(score)) return "medium";
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim())
      )
    : [];
}

function normalizeDataRequirements(value: unknown): TaskWorkbenchDataRequirement[] {
  const rows = Array.isArray(value) ? value : [];
  const normalized: TaskWorkbenchDataRequirement[] = [];
  rows.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.trim() : "";
    const query = typeof record.query === "string" ? record.query.trim() : "";
    const topKRaw = record.top_k ?? record.topK;
    const topK =
      typeof topKRaw === "number" && Number.isFinite(topKRaw)
        ? Math.max(1, Math.min(20, Math.trunc(topKRaw)))
        : undefined;
    const parsed = taskWorkbenchDataRequirementSchema.safeParse({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : `data_${index + 1}`,
      type,
      query,
      topK,
      reason:
        typeof record.reason === "string" ? record.reason.trim() : undefined,
      required:
        typeof record.required === "boolean" ? record.required : undefined,
    });
    if (parsed.success) normalized.push(parsed.data);
  });
  return normalized;
}

function normalizeComputeRequirements(
  value: unknown
): TaskWorkbenchComputeRequirement[] {
  const rows = Array.isArray(value) ? value : [];
  const normalized: TaskWorkbenchComputeRequirement[] = [];
  rows.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.trim() : "";
    const parsed = taskWorkbenchComputeRequirementSchema.safeParse({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : `compute_${index + 1}`,
      type,
      inputRefs: stringArrayFromUnknown(record.input_refs ?? record.inputRefs),
      parameters:
        record.parameters && typeof record.parameters === "object"
          ? (record.parameters as Record<string, unknown>)
          : undefined,
      reason:
        typeof record.reason === "string" ? record.reason.trim() : undefined,
    });
    if (parsed.success) normalized.push(parsed.data);
  });
  return normalized;
}

function normalizeHarnessRole(
  value: unknown
): TaskWorkbenchHarnessPlanStage["role"] | null {
  if (
    value === "Reader" ||
    value === "Analyst" ||
    value === "Writer" ||
    value === "Data" ||
    value === "Compute" ||
    value === "Alice" ||
    value === "Reviewer"
  )
    return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "reader") return "Reader";
  if (normalized === "analyst") return "Analyst";
  if (normalized === "writer") return "Writer";
  if (normalized === "data") return "Data";
  if (normalized === "compute") return "Compute";
  if (normalized === "alice") return "Alice";
  if (normalized === "reviewer") return "Reviewer";
  return null;
}

function normalizeFinanceSkillSpecId(
  value: unknown,
  templateId: "market-researcher" | "meeting-prep-agent" | "clarify" | "reject_or_reframe"
) {
  if (isFinanceSkillSpecId(value)) return value;
  return defaultFinanceSkillSpecForHarnessTemplate(templateId)?.id;
}

function normalizeFinanceExecutionLane(
  value: unknown,
  skillSpecId?: (typeof FINANCE_SKILL_SPEC_IDS)[number]
) {
  if (value === "official_spec" || value === "alice_exploration") return value;
  return skillSpecId ? getFinanceSkillSpec(skillSpecId).lane : undefined;
}

function normalizeHarnessPlan(input: {
  runId: string;
  templateId:
    | "market-researcher"
    | "meeting-prep-agent"
    | "clarify"
    | "reject_or_reframe";
  confidence?: unknown;
  reason?: unknown;
  riskFlags?: unknown;
  skillSpecId?: unknown;
  executionLane?: unknown;
  dataRequirements?: unknown;
  computeRequirements?: unknown;
  plan?: unknown;
}): TaskWorkbenchHarnessPlan {
  const stages: TaskWorkbenchHarnessPlanStage[] = [];
  for (const item of Array.isArray(input.plan) ? input.plan : []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const role = normalizeHarnessRole(record.role);
    const stageId =
      typeof record.stage_id === "string" ? record.stage_id.trim() : "";
    const profile =
      typeof record.profile === "string" ? record.profile.trim() : "";
    if (!role || !stageId || !profile) continue;
    stages.push({
      stageId,
      role,
      profile,
      inputContract:
        typeof record.input_contract === "string"
          ? record.input_contract.trim()
          : undefined,
      outputContract:
        typeof record.output_contract === "string"
          ? record.output_contract.trim()
          : undefined,
      skillRefs: stringArrayFromUnknown(record.skill_refs),
      mcpPolicy:
        record.mcp_policy &&
        typeof record.mcp_policy === "object" &&
        !Array.isArray(record.mcp_policy)
          ? (record.mcp_policy as Record<string, unknown>)
          : undefined,
    });
  }
  const skillSpecId = normalizeFinanceSkillSpecId(
    input.skillSpecId,
    input.templateId
  );
  return taskWorkbenchHarnessPlanSchema.parse({
    source: "financial_harness",
    runId: input.runId,
    templateId: input.templateId,
    skillSpecId,
    executionLane: normalizeFinanceExecutionLane(input.executionLane, skillSpecId),
    confidenceScore:
      typeof input.confidence === "number" && Number.isFinite(input.confidence)
        ? input.confidence
        : undefined,
    reason: typeof input.reason === "string" ? input.reason.trim() : undefined,
    riskFlags: stringArrayFromUnknown(input.riskFlags),
    dataRequirements: normalizeDataRequirements(input.dataRequirements),
    computeRequirements: normalizeComputeRequirements(input.computeRequirements),
    stages,
  });
}

async function routeWithFinancialHarness(
  input: RouteInput
): Promise<
  (TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }) | null
> {
  if (
    String(
      process.env.TASK_WORKBENCH_ROUTER_HARNESS || "true"
    ).toLowerCase() === "false"
  )
    return null;
  const endpoint = harnessEndpointFromEnv();
  const token =
    process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN ||
    process.env.TASK_WORKBENCH_HARNESS_TOKEN ||
    process.env.HERMES_HTTP_KEY ||
    "";
  if (!endpoint || !token) return null;

  const prompt = trimPrompt(input.prompt);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  const routeResponse = await fetch(
    `${endpoint.replace(/\/+$/, "")}/v1/harness/route`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        selected_template_id: input.selectedTemplateId || null,
        available_templates: ["market-researcher", "meeting-prep-agent"],
      }),
    }
  );
  const routePayload = (await routeResponse.json()) as {
    status?: unknown;
    run_id?: string;
    runId?: string;
    result?: unknown;
    error?: unknown;
  };
  if (!routeResponse.ok || routePayload.status === "failed") {
    throw new Error(
      `financial_harness_route_failed: ${JSON.stringify(routePayload).slice(0, 220)}`
    );
  }
  const parsed = (
    routePayload.result && typeof routePayload.result === "object"
      ? routePayload.result
      : routePayload
  ) as {
    run_id?: unknown;
    runId?: unknown;
    template_id?: unknown;
    confidence?: unknown;
    reason?: unknown;
    clarification_question?: unknown;
    risk_flags?: unknown;
    skill_spec_id?: unknown;
    skillSpecId?: unknown;
    execution_lane?: unknown;
    executionLane?: unknown;
    data_requirements?: unknown;
    dataRequirements?: unknown;
    compute_requirements?: unknown;
    computeRequirements?: unknown;
    plan?: unknown;
  };
  const runId =
    routePayload.run_id ||
    routePayload.runId ||
    (typeof parsed.run_id === "string" ? parsed.run_id : "") ||
    (typeof parsed.runId === "string" ? parsed.runId : "") ||
    `financial-harness-${randomUUID()}`;
  const templateId =
    parsed.template_id === "market-researcher" ||
    parsed.template_id === "meeting-prep-agent" ||
    parsed.template_id === "clarify" ||
    parsed.template_id === "reject_or_reframe"
      ? parsed.template_id
      : null;
  if (!templateId) return null;
  const harnessPlan = normalizeHarnessPlan({
    runId,
    templateId,
    confidence: parsed.confidence,
    reason: parsed.reason,
    riskFlags: parsed.risk_flags,
    skillSpecId: parsed.skill_spec_id ?? parsed.skillSpecId,
    executionLane: parsed.execution_lane ?? parsed.executionLane,
    dataRequirements: parsed.data_requirements ?? parsed.dataRequirements,
    computeRequirements:
      parsed.compute_requirements ?? parsed.computeRequirements,
    plan: parsed.plan,
  });

  if (templateId === "clarify") {
    return {
      intent: "clarify",
      confidence: confidenceFromHarnessScore(parsed.confidence),
      clarifyingQuestion:
        typeof parsed.clarification_question === "string" &&
        parsed.clarification_question.trim()
          ? parsed.clarification_question.trim()
          : "你希望我按市场研究简报，还是按客户会议准备来处理？",
      harnessPlan,
      router: {
        mode: "financial_harness",
        runId,
        templateId,
        skillSpecId: harnessPlan.skillSpecId,
        executionLane: harnessPlan.executionLane,
        reason: parsed.reason,
        riskFlags: parsed.risk_flags,
        harnessPlan,
      },
    };
  }
  if (templateId === "reject_or_reframe") {
    return {
      intent: "unsupported",
      confidence: "high",
      reply:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "这个请求涉及高风险金融操作，我可以改为帮你整理研究材料、风险提示或汇报草稿。",
      harnessPlan,
      router: {
        mode: "financial_harness",
        runId,
        templateId,
        skillSpecId: harnessPlan.skillSpecId,
        executionLane: harnessPlan.executionLane,
        reason: parsed.reason,
        riskFlags: parsed.risk_flags,
        harnessPlan,
      },
    };
  }

  const selectedTemplateId = mapHarnessTemplateId(templateId);
  if (!selectedTemplateId) return null;
  const decision = normalizeDecision(
    {
      intent: "run_template",
      confidence: confidenceFromHarnessScore(parsed.confidence),
      selectedTemplateId,
      normalizedGoal: prompt,
      userVisiblePlan:
        selectedTemplateId === "market_research_brief"
          ? MARKET_RESEARCH_PLAN
          : MEETING_PREP_PLAN,
    },
    prompt
  );
  return {
    ...decision,
    harnessPlan,
    router: {
      mode: "financial_harness",
      runId,
      templateId,
      reason: parsed.reason,
      riskFlags: parsed.risk_flags,
      harnessPlan,
    },
  };
}

function normalizeDecision(
  decision: TaskWorkbenchRouterDecision,
  fallbackPrompt: string
): TaskWorkbenchRouterDecision {
  if (decision.intent === "run_template") {
    const selectedTemplateId = isLockableTemplateId(decision.selectedTemplateId)
      ? decision.selectedTemplateId
      : "research_ppt";
    return {
      ...decision,
      selectedTemplateId,
      normalizedGoal: decision.normalizedGoal || fallbackPrompt,
      userVisiblePlan: decision.userVisiblePlan?.length
        ? decision.userVisiblePlan
        : visiblePlanForTemplate(selectedTemplateId),
    };
  }
  return decision;
}

export async function routeTaskWorkbenchPrompt(
  input: RouteInput
): Promise<TaskWorkbenchRouterDecision & { router?: Record<string, unknown> }> {
  const prompt = trimPrompt(input.prompt);
  const ruleDecision = routeTaskWorkbenchPromptByRules(input);

  // Deterministic guards are intentionally ahead of LLM routing.
  if (
    isGreetingOrMeta(prompt) ||
    isUnsupported(prompt) ||
    isClearlyOutOfScopeUtility(prompt)
  ) {
    return { ...ruleDecision, router: { mode: "rules_guard" } };
  }

  if (
    String(process.env.TASK_WORKBENCH_ROUTER_LLM || "true").toLowerCase() ===
    "false"
  ) {
    return { ...ruleDecision, router: { mode: "rules_only" } };
  }

  if (
    ruleDecision.intent === "run_template" &&
    (ruleDecision.selectedTemplateId === "research_ppt" ||
      ruleDecision.selectedTemplateId === "wind_announcement_digest" ||
      ruleDecision.selectedTemplateId === "fund_compare" ||
      ruleDecision.selectedTemplateId === "peer_comps_analysis" ||
      ruleDecision.selectedTemplateId === "theme_leader_analysis" ||
      ruleDecision.selectedTemplateId === "earnings_commentary" ||
      ruleDecision.selectedTemplateId === "company_one_page_memo" ||
      ruleDecision.selectedTemplateId === "macro_data_brief" ||
      ruleDecision.selectedTemplateId === "credit_analysis" ||
      ruleDecision.selectedTemplateId === "bond_rate_outlook" ||
      ruleDecision.selectedTemplateId === "video_outline" ||
      ruleDecision.selectedTemplateId === "meeting_notes" ||
      ruleDecision.selectedTemplateId === "excel_fill")
  ) {
    return {
      ...normalizeDecision(ruleDecision, prompt),
      router: { mode: "rules_template_guard" },
    };
  }

  try {
    const harnessDecision = await routeWithFinancialHarness(input);
    if (harnessDecision)
      return harnessDecision.router
        ? harnessDecision
        : { ...harnessDecision, router: { mode: "financial_harness" } };
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
            "当前可运行模板有七个：",
            "1. market_research_brief：金融市场研究简报，检索员筛选公开市场资料 → 分析师提炼趋势、机会与风险 → 写作员生成研究简报。",
            "2. meeting_prep_agent：客户会议准备，检索员整理客户与会议资料 → 分析师提炼客户画像与问题清单 → 写作员生成会前准备材料。",
            "3. research_ppt：研究型 PPT 制作，检索员检索资料 → 分析师提炼逻辑线 → 大纲员生成蓝图 → 模板渲染器生成 PPTX → 质量校验。",
            "4. wind_announcement_digest：公告解读，读取公告/财经新闻 → 分析影响路径和风险 → 生成公告解读。",
            "5. video_outline：视频提纲，读取公开视频链接和可用文字资料 → 生成学习、汇报或 PPT 提纲。",
            "6. meeting_notes：会议纪要，读取上传录音或会议转写文本 → 生成会议摘要、关键决策、待办事项和风险问题。",
            "7. excel_fill：Excel 填表，读取 Excel 和背景材料 → 生成填表方案 → 写回新的 Excel 副本。",
            "如果用户只是问候、闲聊、问你能做什么，intent=chat。",
            "如果用户明确要求生成 PPT、汇报、演示文稿、slides、deck、材料，intent=run_template。",
            "如果用户要求市场研究、行业研究、专题研究、研究简报、竞品/可比公司/产业链/监管影响分析，优先选择 market_research_brief。",
            "如果用户要求客户拜访、会前准备、拜访准备、访谈提纲、客户画像或问题清单，优先选择 meeting_prep_agent。",
            "如果用户要求会议纪要、录音转写、会议摘要、待办事项整理，优先选择 meeting_notes。",
            "如果用户要求 Excel、表格、填表、补全字段、写回台账，优先选择 excel_fill。",
            "如果用户要求公告、年报、财报、监管披露、回购、分红、减持、业绩预告、公告解读，优先选择 wind_announcement_digest。",
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
              selectedTemplateId:
                "market_research_brief | meeting_prep_agent | research_ppt | wind_announcement_digest | video_outline | meeting_notes | excel_fill when run_template",
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
    const parsed = taskWorkbenchRouterDecisionSchema.safeParse(
      JSON.parse(json)
    );
    if (!parsed.success)
      throw new Error(`router_llm_invalid_json: ${parsed.error.message}`);
    const decision = normalizeDecision(parsed.data, prompt);
    return {
      ...decision,
      router: { mode: "llm", provider: result.provider, model: result.model },
    };
  } catch (error) {
    const decision = normalizeDecision(
      routeTaskWorkbenchPromptByRules(input),
      prompt
    );
    return {
      ...decision,
      router: {
        mode: "rules_fallback",
        reason:
          error instanceof Error
            ? error.message.slice(0, 160)
            : String(error).slice(0, 160),
      },
    };
  }
}
