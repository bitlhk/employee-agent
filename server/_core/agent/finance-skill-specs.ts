export const FINANCE_SKILL_SPEC_IDS = [
  "announcement-digest",
  "market-research-brief",
  "client-meeting-prep",
  "fund-compare",
  "peer-comps-analysis",
  "theme-leader-analysis",
  "earnings-commentary",
  "company-one-page-memo",
  "macro-data-brief",
  "credit-analysis",
  "bond-rate-outlook",
] as const;

export type FinanceSkillSpecId = (typeof FINANCE_SKILL_SPEC_IDS)[number];
export type FinanceExecutionLane = "official_spec" | "alice_exploration";

export type FinanceSkillSpec = {
  id: FinanceSkillSpecId;
  name: string;
  lane: FinanceExecutionLane;
  source:
    | "wind_official_skill"
    | "windclaw_skill"
    | "community_skill"
    | "internal";
  sourceName?: string;
  intentExamples: string[];
  allowedDataRequirements: string[];
  defaultDataPlan?: Array<{
    slot: string;
    type: string;
    required: boolean;
    reason: string;
    topK?: number;
  }>;
  defaultComputePlan?: Array<{
    id: string;
    type: string;
    inputRefs?: string[];
    parameters?: Record<string, unknown>;
    reason?: string;
  }>;
  allowedComputeRequirements: string[];
  publicSearchPolicy: "disabled" | "fallback" | "optional";
  alicePolicy: "disabled" | "exploration_direct";
  aliceSkillName?: string;
  outputSections: string[];
  riskPolicy: string[];
};

export const FINANCE_SKILL_SPECS: Record<FinanceSkillSpecId, FinanceSkillSpec> = {
  "announcement-digest": {
    id: "announcement-digest",
    name: "公告解读",
    lane: "official_spec",
    source: "internal",
    sourceName: "Wind MCP 公告/新闻",
    intentExamples: ["解读公司公告", "分析重大事项影响", "提炼公告风险"],
    allowedDataRequirements: ["company_announcements", "financial_news"],
    defaultDataPlan: [
      {
        slot: "announcement_facts",
        type: "company_announcements",
        required: true,
        reason: "读取公告原文和关键事实。",
        topK: 8,
      },
      {
        slot: "related_news",
        type: "financial_news",
        required: false,
        reason: "补充市场报道和背景信息。",
        topK: 5,
      },
    ],
    allowedComputeRequirements: ["none"],
    publicSearchPolicy: "disabled",
    alicePolicy: "disabled",
    outputSections: ["一句话结论", "关键公告事实", "影响分析", "风险与待核验", "资料来源"],
    riskPolicy: ["不输出交易建议", "保留公告来源", "事实不确定时显式提示"],
  },
  "market-research-brief": {
    id: "market-research-brief",
    name: "市场研究简报",
    lane: "official_spec",
    source: "windclaw_skill",
    sourceName: "市场主线/盘后复盘/板块轮动方法论",
    intentExamples: ["研究金融 AI 应用趋势", "分析行业机会", "梳理市场主线"],
    allowedDataRequirements: [
      "financial_news",
      "company_announcements",
      "company_profile",
      "stock_fundamentals",
      "market_snapshot",
      "macro_series",
      "fund_data",
      "bond_data",
    ],
    defaultDataPlan: [
      {
        slot: "market_news",
        type: "financial_news",
        required: true,
        reason: "获取主题相关的近期市场动态和公开报道。",
        topK: 8,
      },
      {
        slot: "announcements",
        type: "company_announcements",
        required: false,
        reason: "如主题涉及上市公司，补充公告和监管披露。",
        topK: 5,
      },
      {
        slot: "market_context",
        type: "market_snapshot",
        required: false,
        reason: "补充市场、行业或板块背景。",
        topK: 5,
      },
    ],
    allowedComputeRequirements: [
      "none",
      "time_series_metrics",
      "peer_comparison_table",
      "financial_ratio_summary",
    ],
    publicSearchPolicy: "fallback",
    alicePolicy: "disabled",
    outputSections: ["核心结论", "近期动态", "市场结构与主线", "关键变化", "风险与不确定性", "后续观察", "资料来源"],
    riskPolicy: ["不承诺收益", "不输出买卖指令", "区分事实、推断与观察项"],
  },
  "client-meeting-prep": {
    id: "client-meeting-prep",
    name: "客户会议准备",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "Stock DD List / 公司调研问题清单方法论",
    intentExamples: ["准备客户拜访材料", "生成会前问题清单", "整理公司背景"],
    allowedDataRequirements: [
      "financial_news",
      "company_announcements",
      "company_profile",
      "stock_fundamentals",
      "market_snapshot",
      "fund_data",
      "bond_data",
      "internal_context",
    ],
    defaultDataPlan: [
      {
        slot: "client_recent_news",
        type: "financial_news",
        required: true,
        reason: "获取客户、行业或主题的近期动态。",
        topK: 8,
      },
      {
        slot: "client_announcements",
        type: "company_announcements",
        required: false,
        reason: "如客户为上市公司，补充公告与重大事项。",
        topK: 6,
      },
      {
        slot: "client_profile",
        type: "company_profile",
        required: false,
        reason: "补充客户背景、业务画像和会议准备上下文。",
        topK: 5,
      },
    ],
    allowedComputeRequirements: [
      "none",
      "time_series_metrics",
      "peer_comparison_table",
      "financial_ratio_summary",
    ],
    publicSearchPolicy: "fallback",
    alicePolicy: "disabled",
    outputSections: ["客户画像", "近期动态", "业务与财务要点", "潜在需求与合作机会", "建议会议议题", "建议问题清单", "风险与注意事项"],
    riskPolicy: ["不泄露其他客户信息", "内部材料必须来自授权上传", "明确待确认信息"],
  },
  "fund-compare": {
    id: "fund-compare",
    name: "公募基金对比",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "公募基金对比分析",
    intentExamples: ["比较几只基金", "分析基金风险收益", "基金持仓风格对比"],
    allowedDataRequirements: ["fund_data", "financial_news", "market_snapshot"],
    defaultDataPlan: [
      {
        slot: "fund_profiles",
        type: "fund_data",
        required: true,
        reason: "读取基金档案、业绩、持仓和风险收益数据。",
        topK: 10,
      },
      {
        slot: "market_context",
        type: "market_snapshot",
        required: false,
        reason: "补充相关市场和风格背景。",
        topK: 5,
      },
    ],
    defaultComputePlan: [
      {
        id: "fund_performance_compare",
        type: "fund_performance_compare",
        inputRefs: ["fund_profiles", "market_context"],
        reason: "对基金收益、波动、回撤和风格差异做结构化对比。",
      },
    ],
    allowedComputeRequirements: ["fund_performance_compare", "time_series_metrics"],
    publicSearchPolicy: "disabled",
    alicePolicy: "disabled",
    outputSections: ["对比结论", "基金基本信息", "业绩与风险指标", "持仓与风格差异", "适用场景", "风险提示"],
    riskPolicy: ["不做购买建议", "区分客观对比和主观偏好", "缺少基金代码时先澄清"],
  },
  "peer-comps-analysis": {
    id: "peer-comps-analysis",
    name: "同业比选",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "可比公司分析 / 同业比选",
    intentExamples: ["比较几家公司", "做可比公司分析", "同业估值对比"],
    allowedDataRequirements: [
      "company_profile",
      "stock_fundamentals",
      "market_snapshot",
      "financial_news",
      "company_announcements",
    ],
    defaultDataPlan: [
      {
        slot: "company_profiles",
        type: "company_profile",
        required: true,
        reason: "读取目标公司和可比公司的业务画像。",
        topK: 8,
      },
      {
        slot: "fundamentals",
        type: "stock_fundamentals",
        required: true,
        reason: "补充财务指标、估值和经营数据。",
        topK: 8,
      },
      {
        slot: "recent_news",
        type: "financial_news",
        required: false,
        reason: "补充近期催化、风险和行业变化。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "peer_comparison_table",
        type: "peer_comparison_table",
        inputRefs: ["company_profiles", "fundamentals"],
        reason: "生成同业公司业务、财务、估值和催化因素对比表。",
      },
      {
        id: "financial_ratio_summary",
        type: "financial_ratio_summary",
        inputRefs: ["fundamentals"],
        reason: "提炼关键财务比率和异常项。",
      },
    ],
    allowedComputeRequirements: ["peer_comparison_table", "financial_ratio_summary", "time_series_metrics"],
    publicSearchPolicy: "fallback",
    alicePolicy: "disabled",
    outputSections: ["相对结论", "业务质量对比", "成长与盈利对比", "估值对比", "催化与风险", "待核验信息"],
    riskPolicy: ["不输出估值目标价", "无真实数据不生成虚假倍数", "保留口径说明"],
  },
  "theme-leader-analysis": {
    id: "theme-leader-analysis",
    name: "题材龙头",
    lane: "official_spec",
    source: "windclaw_skill",
    sourceName: "题材龙头识别方法论 + Wind MCP 数据",
    intentExamples: ["识别题材龙头", "分析 CPO 板块核心标的", "判断板块主线和跟随股"],
    allowedDataRequirements: [
      "financial_news",
      "company_announcements",
      "company_profile",
      "stock_fundamentals",
      "market_snapshot",
    ],
    defaultDataPlan: [
      {
        slot: "theme_news",
        type: "financial_news",
        required: true,
        reason: "获取题材、板块和产业链近期催化与市场报道。",
        topK: 10,
      },
      {
        slot: "market_context",
        type: "market_snapshot",
        required: true,
        reason: "补充题材相关板块、指数或候选标的行情表现。",
        topK: 8,
      },
      {
        slot: "candidate_profiles",
        type: "company_profile",
        required: false,
        reason: "补充候选公司的业务画像和题材映射。",
        topK: 8,
      },
      {
        slot: "candidate_fundamentals",
        type: "stock_fundamentals",
        required: false,
        reason: "补充候选公司的财务、估值和基本面支撑。",
        topK: 8,
      },
      {
        slot: "candidate_announcements",
        type: "company_announcements",
        required: false,
        reason: "补充订单、合同、业绩或重大事项公告。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "peer_comparison_table",
        type: "peer_comparison_table",
        inputRefs: ["candidate_profiles", "candidate_fundamentals", "market_context"],
        reason: "对候选标的的题材映射、市场表现、基本面支撑和风险进行结构化比较。",
      },
      {
        id: "time_series_metrics",
        type: "time_series_metrics",
        inputRefs: ["market_context"],
        reason: "提炼题材和候选标的近期行情强弱变化。",
      },
    ],
    allowedComputeRequirements: ["peer_comparison_table", "time_series_metrics", "financial_ratio_summary"],
    publicSearchPolicy: "fallback",
    alicePolicy: "disabled",
    outputSections: ["30 秒结论", "题材结构总览", "龙头/中军/跟随/掉队分层", "核心标的拆解", "题材阶段判断", "风险与失效信号", "资料来源与局限"],
    riskPolicy: ["不能只按短期涨幅定义龙头", "不输出买卖建议或目标价", "资料不足时必须标注待核验"],
  },
  "earnings-commentary": {
    id: "earnings-commentary",
    name: "财报点评",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "全球上市公司财报点评 / 财报解读",
    intentExamples: ["点评季度财报", "分析业绩超预期", "生成财报更新报告"],
    allowedDataRequirements: ["company_announcements", "stock_fundamentals", "financial_news", "company_profile"],
    defaultDataPlan: [
      {
        slot: "earnings_announcements",
        type: "company_announcements",
        required: true,
        reason: "读取财报、业绩快报或业绩预告相关公告。",
        topK: 8,
      },
      {
        slot: "fundamentals",
        type: "stock_fundamentals",
        required: true,
        reason: "读取收入、利润、现金流、费用率等核心财务指标。",
        topK: 8,
      },
      {
        slot: "related_news",
        type: "financial_news",
        required: false,
        reason: "补充市场解读、管理层观点和行业背景。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "financial_ratio_summary",
        type: "financial_ratio_summary",
        inputRefs: ["earnings_announcements", "fundamentals"],
        reason: "汇总同比、环比、利润率和现金流等核心指标变化。",
      },
      {
        id: "time_series_metrics",
        type: "time_series_metrics",
        inputRefs: ["fundamentals"],
        reason: "识别关键指标趋势和异常波动。",
      },
    ],
    allowedComputeRequirements: ["financial_ratio_summary", "time_series_metrics"],
    publicSearchPolicy: "fallback",
    alicePolicy: "disabled",
    outputSections: ["一句话结论", "业绩概览", "核心指标变化", "盈利质量", "经营与现金流", "风险与后续关注"],
    riskPolicy: ["不预测保证性收益", "指标必须来自数据或明示推断", "保留财报期和口径"],
  },
  "company-one-page-memo": {
    id: "company-one-page-memo",
    name: "公司一页纸",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "上市公司一页纸投资报告",
    intentExamples: ["生成公司一页纸", "快速了解上市公司", "首次覆盖材料"],
    allowedDataRequirements: ["company_profile", "stock_fundamentals", "company_announcements", "financial_news"],
    defaultDataPlan: [
      {
        slot: "company_profile",
        type: "company_profile",
        required: true,
        reason: "读取公司业务画像、主营结构和基础资料。",
        topK: 6,
      },
      {
        slot: "fundamentals",
        type: "stock_fundamentals",
        required: true,
        reason: "补充财务、估值和经营指标。",
        topK: 8,
      },
      {
        slot: "recent_events",
        type: "company_announcements",
        required: false,
        reason: "补充近期公告、催化剂和风险事项。",
        topK: 6,
      },
      {
        slot: "related_news",
        type: "financial_news",
        required: false,
        reason: "补充市场报道、行业背景和舆情信号。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "financial_ratio_summary",
        type: "financial_ratio_summary",
        inputRefs: ["fundamentals"],
        reason: "提炼盈利能力、成长性、现金流和估值指标。",
      },
    ],
    allowedComputeRequirements: ["financial_ratio_summary", "peer_comparison_table"],
    publicSearchPolicy: "disabled",
    alicePolicy: "disabled",
    outputSections: ["公司速览", "核心逻辑", "近期催化剂", "财务与估值观察", "风险提示", "待核验信息"],
    riskPolicy: ["不作为投资建议", "不输出目标价或买卖评级", "保留数据口径和待核验信息"],
  },
  "macro-data-brief": {
    id: "macro-data-brief",
    name: "宏观数据解读",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "宏观数据解读",
    intentExamples: ["解读 CPI", "分析 PMI", "写宏观周报"],
    allowedDataRequirements: ["macro_series", "financial_news", "market_snapshot"],
    defaultDataPlan: [
      {
        slot: "macro_series",
        type: "macro_series",
        required: true,
        reason: "读取宏观指标序列、最新值和历史对比。",
        topK: 8,
      },
      {
        slot: "market_context",
        type: "market_snapshot",
        required: false,
        reason: "补充股债汇等市场反应和定价背景。",
        topK: 5,
      },
      {
        slot: "related_news",
        type: "financial_news",
        required: false,
        reason: "补充政策、机构解读和市场报道。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "time_series_metrics",
        type: "time_series_metrics",
        inputRefs: ["macro_series"],
        reason: "计算同比、环比、趋势变化和异常波动。",
      },
    ],
    allowedComputeRequirements: ["time_series_metrics"],
    publicSearchPolicy: "disabled",
    alicePolicy: "disabled",
    outputSections: ["结论摘要", "核心数据", "趋势与结构", "市场影响", "后续跟踪", "资料口径"],
    riskPolicy: ["保留指标口径", "不输出交易建议", "区分事实、推断和风险情景"],
  },
  "credit-analysis": {
    id: "credit-analysis",
    name: "信用分析",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "信用分析",
    intentExamples: ["分析债券主体信用", "城投信用研究", "发行人风险分析"],
    allowedDataRequirements: ["bond_data", "company_profile", "stock_fundamentals", "company_announcements", "financial_news"],
    defaultDataPlan: [
      {
        slot: "issuer_profile",
        type: "company_profile",
        required: true,
        reason: "读取发行主体背景、股东结构和业务画像。",
        topK: 6,
      },
      {
        slot: "bond_profile",
        type: "bond_data",
        required: false,
        reason: "补充存量债券、期限结构、评级和估值信息。",
        topK: 8,
      },
      {
        slot: "fundamentals",
        type: "stock_fundamentals",
        required: false,
        reason: "补充财务健康度、现金流和偿债能力指标。",
        topK: 8,
      },
      {
        slot: "risk_events",
        type: "company_announcements",
        required: false,
        reason: "补充公告、评级变动和潜在信用事件。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "financial_ratio_summary",
        type: "financial_ratio_summary",
        inputRefs: ["fundamentals"],
        reason: "汇总偿债、杠杆、盈利和现金流指标。",
      },
    ],
    allowedComputeRequirements: ["financial_ratio_summary", "time_series_metrics"],
    publicSearchPolicy: "disabled",
    alicePolicy: "disabled",
    outputSections: ["主体资质", "行业风险", "财务健康度", "现金流质量", "评级对标", "风险提示"],
    riskPolicy: ["不替代评级意见", "不输出交易建议", "资料不足时必须列明待核验项"],
  },
  "bond-rate-outlook": {
    id: "bond-rate-outlook",
    name: "债券利率研判",
    lane: "official_spec",
    source: "wind_official_skill",
    sourceName: "债券利率走势研判",
    intentExamples: ["研判债券利率走势", "分析利率策略", "债市配置视角"],
    allowedDataRequirements: ["bond_data", "macro_series", "market_snapshot", "financial_news"],
    defaultDataPlan: [
      {
        slot: "bond_market",
        type: "bond_data",
        required: true,
        reason: "读取债券收益率、曲线和相关市场数据。",
        topK: 8,
      },
      {
        slot: "macro_context",
        type: "macro_series",
        required: true,
        reason: "补充通胀、增长、货币政策和社融等宏观变量。",
        topK: 8,
      },
      {
        slot: "market_snapshot",
        type: "market_snapshot",
        required: false,
        reason: "补充资金面、股债汇商品等市场定价信号。",
        topK: 6,
      },
      {
        slot: "related_news",
        type: "financial_news",
        required: false,
        reason: "补充政策和市场报道。",
        topK: 6,
      },
    ],
    defaultComputePlan: [
      {
        id: "time_series_metrics",
        type: "time_series_metrics",
        inputRefs: ["bond_market", "macro_context"],
        reason: "提炼收益率、宏观变量和资金面指标的趋势变化。",
      },
    ],
    allowedComputeRequirements: ["time_series_metrics"],
    publicSearchPolicy: "disabled",
    alicePolicy: "disabled",
    outputSections: ["核心判断", "交易视角", "策略视角", "配置视角", "风险提示"],
    riskPolicy: ["不输出确定性收益", "不替代投资决策", "不得给出具体下单指令"],
  },
};

export function isFinanceSkillSpecId(value: unknown): value is FinanceSkillSpecId {
  return (
    typeof value === "string" &&
    (FINANCE_SKILL_SPEC_IDS as readonly string[]).includes(value)
  );
}

export function getFinanceSkillSpec(id: FinanceSkillSpecId): FinanceSkillSpec {
  return FINANCE_SKILL_SPECS[id];
}

export function defaultFinanceSkillSpecForHarnessTemplate(
  templateId: string
): FinanceSkillSpec | null {
  if (templateId === "market-researcher")
    return FINANCE_SKILL_SPECS["market-research-brief"];
  if (templateId === "meeting-prep-agent")
    return FINANCE_SKILL_SPECS["client-meeting-prep"];
  return null;
}

export function defaultFinanceSkillSpecForTaskTemplate(
  templateId: string
): FinanceSkillSpec | null {
  if (templateId === "wind_announcement_digest")
    return FINANCE_SKILL_SPECS["announcement-digest"];
  if (templateId === "market_research_brief")
    return FINANCE_SKILL_SPECS["market-research-brief"];
  if (templateId === "meeting_prep_agent")
    return FINANCE_SKILL_SPECS["client-meeting-prep"];
  if (templateId === "fund_compare")
    return FINANCE_SKILL_SPECS["fund-compare"];
  if (templateId === "peer_comps_analysis")
    return FINANCE_SKILL_SPECS["peer-comps-analysis"];
  if (templateId === "theme_leader_analysis")
    return FINANCE_SKILL_SPECS["theme-leader-analysis"];
  if (templateId === "earnings_commentary")
    return FINANCE_SKILL_SPECS["earnings-commentary"];
  if (templateId === "company_one_page_memo")
    return FINANCE_SKILL_SPECS["company-one-page-memo"];
  if (templateId === "macro_data_brief")
    return FINANCE_SKILL_SPECS["macro-data-brief"];
  if (templateId === "credit_analysis")
    return FINANCE_SKILL_SPECS["credit-analysis"];
  if (templateId === "bond_rate_outlook")
    return FINANCE_SKILL_SPECS["bond-rate-outlook"];
  return null;
}
