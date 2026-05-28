import {
  BarChart3,
  Bot,
  Building2,
  CircleDollarSign,
  Code2,
  Database,
  FileSpreadsheet,
  FileText,
  FileSearch,
  Landmark,
  Mic2,
  MoreHorizontal,
  Presentation,
  Search,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Video,
  type LucideIcon,
} from "lucide-react";

export type DocumentTaskConfigTemplate = {
  id: string;
  displayName: string;
  shortDescription: string;
};

export const TASK_ICONS: Record<string, LucideIcon> = {
  market_research_brief: BarChart3,
  excel_fill: FileSpreadsheet,
  meeting_notes: Mic2,
  meeting_prep_agent: FileText,
  research_ppt: Presentation,
  video_outline: Video,
  wind_announcement_digest: FileSearch,
  fund_compare: CircleDollarSign,
  peer_comps_analysis: Building2,
  theme_leader_analysis: Target,
  earnings_commentary: FileText,
  company_one_page_memo: Landmark,
  macro_data_brief: TrendingUp,
  credit_analysis: ShieldCheck,
  bond_rate_outlook: Scale,
  ppt_report_writing: Presentation,
  stock_ppt_report: TrendingUp,
};

export const TASK_DISPLAY_OVERRIDES: Record<string, string> = {
  market_research_brief: "市场研究简报",
  excel_fill: "Excel 填表",
  meeting_notes: "会议纪要",
  meeting_prep_agent: "客户会议准备",
  research_ppt: "幻灯片",
  video_outline: "视频提纲",
  wind_announcement_digest: "公告解读",
  fund_compare: "基金对比",
  peer_comps_analysis: "同业比选",
  theme_leader_analysis: "题材龙头",
  earnings_commentary: "财报点评",
  company_one_page_memo: "公司一页纸",
  macro_data_brief: "宏观解读",
  credit_analysis: "信用分析",
  bond_rate_outlook: "利率研判",
};

export const TASK_DESCRIPTION_OVERRIDES: Record<string, string> = {
  market_research_brief:
    "检索公开资料，按 Reader / Analyst / Writer 链路生成中文研究简报初稿。",
  excel_fill:
    "上传 Excel 和背景材料，先生成可审核填表方案，再写回一个新的 Excel 副本。",
  meeting_notes:
    "上传会议录音或粘贴会议转写，生成会议摘要、关键决策、待办事项和待确认问题。",
  meeting_prep_agent:
    "面向客户拜访场景，生成背景、交流议题、问题清单和人工复核提示。",
  research_ppt:
    "检索资料、提炼逻辑线、生成 PPT 蓝图，并用模板渲染成可预览、可下载的 PPTX。",
  video_outline:
    "读取公开视频链接和可用文字资料，生成适合复习、汇报或转 PPT 的结构化提纲。",
  wind_announcement_digest:
    "读取公告和财经新闻，生成公告事实摘要、影响路径、风险与跟踪清单。",
  fund_compare:
    "读取基金档案、业绩、持仓和市场背景，生成基金对比与风险收益分析。",
  peer_comps_analysis:
    "读取公司画像、财务指标、行情和新闻，生成同业公司横向比选材料。",
  theme_leader_analysis:
    "基于受控金融数据识别题材龙头、中军、跟随股与掉队股，生成题材跟踪框架。",
  earnings_commentary:
    "读取财报公告、财务指标和市场解读，生成财报点评与待复核清单。",
  company_one_page_memo:
    "基于 Wind 数据包和写作员生成上市公司一页纸研究材料。",
  macro_data_brief:
    "基于 Wind 宏观数据包解读宏观指标、趋势结构和市场影响。",
  credit_analysis:
    "基于 Wind 数据包分析主体资质、财务健康度、现金流和信用风险。",
  bond_rate_outlook:
    "基于 Wind 数据包从交易、策略、配置视角研判债券利率走势。",
};

export const TASK_PLACEHOLDERS: Record<string, string> = {
  market_research_brief:
    "输入金融市场、行业、公司或监管主题，例如：跨境支付最近有什么新的动态？",
  excel_fill:
    "上传 Excel 和背景资料，说明填表规则，例如：只补空白并标注资料不足原因。",
  meeting_notes:
    "上传会议录音，或粘贴会议转写并说明纪要要求，例如：整理待办事项和风险清单。",
  meeting_prep_agent:
    "输入客户、机构、会议目标和关注方向，例如：准备拜访某银行科技部的会议问题。",
  research_ppt:
    "输入汇报主题、受众、页数和风格要求，例如：生成 8 页员工智能体趋势汇报 PPT。",
  video_outline:
    "输入公开视频链接和提纲要求，例如：分析这个视频的主要内容，生成学习提纲。",
  wind_announcement_digest:
    "输入公司、股票或公告主题，例如：解读宁德时代最新公告对业绩和估值的影响。",
  fund_compare:
    "输入 2-5 只基金名称或代码，以及对比目标，例如：比较收益、回撤和持仓风格。",
  peer_comps_analysis:
    "输入目标公司和可比公司，或说明行业范围，例如：比较几家银行的业务质量和估值。",
  theme_leader_analysis:
    "输入题材、板块或热点主题，例如：分析 CPO 板块的龙头股。",
  earnings_commentary:
    "输入公司名称、股票代码和财报期间，例如：点评某公司最新季度财报。",
  company_one_page_memo:
    "输入上市公司名称或代码，例如：生成宁德时代公司一页纸。",
  macro_data_brief:
    "输入宏观指标、时间窗口和关注方向，例如：解读最新 CPI 对债市的影响。",
  credit_analysis:
    "输入债券发行主体、城投平台或公司名称，例如：分析某城投主体信用风险。",
  bond_rate_outlook:
    "输入利率品种、期限和时间窗口，例如：研判未来一个月 10 年国债利率走势。",
  ppt_report_writing: "输入汇报主题、受众和风格要求。",
  stock_ppt_report: "输入股票、报告用途和关注维度。",
};

export const TASK_QUICK_PROMPTS: Record<string, string[]> = {
  market_research_brief: [
    "洞察近期中东地缘冲突对原油、黄金、美元和 A 股风险偏好的影响，生成领导简报。",
    "分析美联储降息预期变化对美债收益率、黄金、港股和人民币资产的传导影响。",
    "梳理中国银行业净息差、资产质量和资本补充压力的最新变化，形成研究简报。",
    "研究 AI 算力产业链近期市场表现、政策催化和估值风险，生成金融市场研究简报。",
  ],
  excel_fill: [
    "只补空白，不覆盖已有内容",
    "按字段映射填写并标注依据",
    "补全客户资料表和风险提示",
    "补全项目台账和下一步动作",
  ],
  meeting_notes: [
    "上传会议录音，生成标准会议纪要",
    "从会议转写里提取待办事项",
    "整理成发给领导的简版纪要",
    "生成项目例会风险与决策清单",
  ],
  meeting_prep_agent: [
    "准备拜访某银行科技部，整理客户背景、交流议题和问题清单。",
    "为一次金融机构高层交流准备会前材料，突出合作机会和风险点。",
    "准备客户续约会议，梳理历史合作、客户诉求和下一步动作。",
    "准备向客户介绍员工智能体平台，生成沟通主线和关键问题。",
  ],
  research_ppt: [
    "生成 8 页智能体趋势 PPT",
    "银行业 AI Agent 趋势 PPT",
    "企业知识库工作台方案 PPT",
    "OpenClaw 部署方案 PPT",
  ],
  video_outline: [
    "分析视频主要内容，生成学习提纲",
    "整理成适合领导汇报的摘要",
    "提取课程知识点、案例和方法论",
    "输出适合做 PPT 的章节结构",
  ],
  wind_announcement_digest: [
    "解读贵州茅台最新公告对经营和估值的影响。",
    "分析宁德时代近期公告里的关键风险和后续跟踪点。",
    "梳理某上市公司年报中的核心变化和投资者关注问题。",
    "解读一家公司回购公告对市场预期的影响。",
  ],
  fund_compare: [
    "对比易方达蓝筹精选、兴全合润和富国天惠的收益、回撤和持仓风格。",
    "比较两只沪深 300 指数基金的跟踪误差、费率和规模变化。",
    "筛选适合稳健配置的债券基金，并说明主要风险。",
    "生成 3 只主动权益基金的领导汇报版对比材料。",
  ],
  peer_comps_analysis: [
    "比较招商银行、宁波银行和平安银行的业务质量、估值和风险差异。",
    "分析三家新能源车企的收入结构、盈利能力和估值位置。",
    "为某行业挑选 3-5 家可比公司并生成对比分析。",
    "梳理银行 IT 厂商的同业格局、增长驱动和估值分歧。",
  ],
  theme_leader_analysis: [
    "分析 CPO 板块的龙头股，区分龙头、中军、跟随股和掉队股。",
    "识别 AI 算力题材的核心标的、驱动逻辑和后续观察点。",
    "判断机器人板块当前处于启动、强化、扩散还是退潮阶段。",
    "梳理低空经济题材内部角色分层和风险信号。",
  ],
  earnings_commentary: [
    "点评贵州茅台最新季度财报，突出收入、利润率和现金流变化。",
    "分析宁德时代财报中超预期或低于预期的关键指标。",
    "生成某上市公司年报点评，列出核心变化和后续跟踪点。",
    "梳理一家银行财报中的净息差、资产质量和资本充足率变化。",
  ],
  company_one_page_memo: [
    "生成宁德时代公司一页纸，覆盖业务、财务、催化和风险。",
    "快速整理贵州茅台的一页纸投资研究材料。",
    "生成招商银行公司速览，突出核心投资逻辑和风险。",
    "为首次覆盖某上市公司生成一页纸研究备忘录。",
  ],
  macro_data_brief: [
    "解读最新 CPI 和 PPI 数据对债市、权益和汇率的影响。",
    "分析 PMI 变化背后的生产、需求和价格结构。",
    "生成本月社融数据解读，突出信贷结构和市场影响。",
    "梳理最新 GDP 数据的结构亮点、压力和后续观察指标。",
  ],
  credit_analysis: [
    "分析某城投平台的信用风险，关注现金流、债务和区域财政。",
    "生成某房地产发行主体的信用分析和风险提示。",
    "评估一家银行二级资本债发行主体的信用资质。",
    "梳理某国企债券主体的评级对标、偿债能力和风险因素。",
  ],
  bond_rate_outlook: [
    "研判未来一个月 10 年国债利率走势，分别给出交易和配置视角。",
    "分析近期资金面、通胀和供给对债券利率的影响。",
    "生成二季度债券利率走势研判，突出核心变量和风险情景。",
    "从交易视角分析 5 年国债收益率的短期机会和风险。",
  ],
};

export const TASK_QUICK_PROMPT_LABELS: Record<string, string[]> = {
  market_research_brief: ["地缘冲突", "降息预期", "银行业", "AI算力"],
  excel_fill: ["只补空白", "字段映射", "客户资料", "项目台账"],
  meeting_notes: ["标准纪要", "待办事项", "领导简版", "风险清单"],
  meeting_prep_agent: ["客户拜访", "高层交流", "续约会议", "平台介绍"],
  research_ppt: ["智能体趋势", "金融AI", "产品方案", "部署方案"],
  video_outline: ["学习提纲", "汇报摘要", "课程笔记", "PPT结构"],
  wind_announcement_digest: ["公告影响", "风险跟踪", "年报解读", "回购解读"],
  fund_compare: ["主动权益", "指数基金", "债券基金", "对比材料"],
  peer_comps_analysis: ["银行同业", "新能源车", "可比公司", "IT厂商"],
  theme_leader_analysis: ["CPO", "AI算力", "机器人", "低空经济"],
  earnings_commentary: ["季报点评", "业绩分析", "年报点评", "银行财报"],
  company_one_page_memo: ["宁德时代", "贵州茅台", "招商银行", "首次覆盖"],
  macro_data_brief: ["CPI/PPI", "PMI", "社融", "GDP"],
  credit_analysis: ["城投信用", "地产主体", "银行资本债", "国企债券"],
  bond_rate_outlook: ["10年国债", "资金面", "季度研判", "5年国债"],
};

export const QUICK_PROMPT_ICONS = [
  TrendingUp,
  Search,
  BarChart3,
  Sparkles,
  MoreHorizontal,
];

export const PERSONA_LABELS: Record<string, string> = {
  data: "数据准备",
  reader: "检索员 (AI)",
  analyst: "分析师 (AI)",
  writer: "写作员 (AI)",
  renderer: "模板渲染器",
  checker: "质量校验器",
  hengyue: "衡研 (AI) · 数据研究",
  qingzhan: "青栈 (AI) · 代码工程",
};

export const PERSONA_DISPLAY_ALIASES: Record<string, string> = {
  wenzhou: "reader",
  moheng: "analyst",
  jianye: "writer",
};

export const PERSONA_INITIALS: Record<string, string> = {
  data: "数",
  reader: "检",
  analyst: "析",
  writer: "写",
  renderer: "渲",
  checker: "校",
  hengyue: "衡",
  qingzhan: "青",
};

export const PERSONA_STEPS: Record<string, string[]> = {
  data: ["读取数据需求", "调用受控数据源", "生成数据包", "完成审计脱敏"],
  reader: ["理解任务范围", "检索公开资料", "筛选可信来源", "输出结构化证据"],
  analyst: ["读取上游证据", "拆解业务逻辑", "形成分析判断", "标注不确定性"],
  writer: ["吸收上游材料", "组织交付结构", "生成可读内容", "整理交付说明"],
  renderer: [
    "读取 PPT 蓝图",
    "套用模板版式",
    "生成预览与 PPTX",
    "整理下载文件",
  ],
  checker: ["检查页数", "核对标题", "校验关键要点", "输出质量报告"],
  hengyue: ["读取数据", "分析走势与风险", "生成研究结论"],
  qingzhan: ["理解代码需求", "规划实现路径", "生成工程建议"],
};

export const PERSONA_DESCRIPTIONS: Record<string, string> = {
  data: "由 employee-agent 按权限调用受控数据源，生成 DataPack / ComputePack。",
  reader: "检索、筛选和组织公开资料，输出结构化证据包。",
  analyst: "分析上游证据，拆解逻辑、形成判断并标注关键不确定性。",
  writer: "把上游材料整理成简报、会议包或可交付内容。",
  renderer: "把 PPT_BLUEPRINT_JSON 渲染为可预览、可下载的 PPTX 文件。",
  checker: "检查页数、标题、关键要点和交付文件是否一致。",
  hengyue: "读取行情与指标，生成数据研究和风险提示。",
  qingzhan: "协助代码分析、改造建议和工程落地。",
};

export const PERSONA_COLORS: Record<
  string,
  { fg: string; bg: string; soft: string }
> = {
  data: { fg: "#0369a1", bg: "#0284c7", soft: "rgba(2,132,199,0.10)" },
  reader: { fg: "#1d4ed8", bg: "#2563eb", soft: "rgba(37,99,235,0.10)" },
  analyst: { fg: "#047857", bg: "#059669", soft: "rgba(5,150,105,0.10)" },
  writer: { fg: "#6d28d9", bg: "#7c3aed", soft: "rgba(124,58,237,0.10)" },
  renderer: { fg: "#be123c", bg: "#e11d48", soft: "rgba(225,29,72,0.10)" },
  checker: { fg: "#0f766e", bg: "#0d9488", soft: "rgba(13,148,136,0.10)" },
  hengyue: { fg: "#be123c", bg: "#e11d48", soft: "rgba(225,29,72,0.10)" },
  qingzhan: { fg: "#0f766e", bg: "#0d9488", soft: "rgba(13,148,136,0.10)" },
};

export const PERSONA_ICONS: Record<string, LucideIcon> = {
  data: Database,
  reader: Search,
  analyst: BarChart3,
  writer: FileText,
  renderer: Presentation,
  checker: Sparkles,
  hengyue: BarChart3,
  qingzhan: Code2,
};

export const DISCLAIMER_LABELS: Record<string, string> = {
  ai_generated_label: "AI 生成标识",
  investment_advisory: "非投资建议",
  code_review_required: "代码需人工 Review",
  fact_check_required: "事实需人工核查",
};

export function taskDisplayName(
  template:
    | Pick<DocumentTaskConfigTemplate, "id" | "displayName">
    | null
    | undefined
) {
  if (!template) return "任务执行";
  return TASK_DISPLAY_OVERRIDES[template.id] || template.displayName;
}

export function taskDescription(
  template: Pick<DocumentTaskConfigTemplate, "id" | "shortDescription">
) {
  return TASK_DESCRIPTION_OVERRIDES[template.id] || template.shortDescription;
}

export function taskPlaceholder(
  template:
    | Pick<DocumentTaskConfigTemplate, "id" | "shortDescription">
    | null
    | undefined
) {
  if (!template) return "输入想完成的任务，或先从左侧选择一个预制任务...";
  return TASK_PLACEHOLDERS[template.id] || template.shortDescription;
}
