import express from "express";
import { createHash } from "crypto";
import { execSync } from "child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "fs";
import path from "path";
import type { SkillSource } from "../../shared/types/skill";
import {
  APP_ROOT,
  requireClawOwner,
  resolveRuntimeAgentId,
  bumpSessionEpoch,
  clearAgentSessionsCache,
  OPENCLAW_BASE_HOME,
  OPENCLAW_HOME,
  OPENCLAW_JSON_PATH,
  openClawAgentDir,
  openClawSkillMarketDir,
  resolveRuntimeWorkspaceByIds,
} from "./helpers";
import { listApprovedSkillMarketItems, listMcpInvocationCounts, listSkillInvocationCounts, resolveEffectiveRoleAssets } from "../db";
import { skillRegistry } from "./skills/skill-registry";
import { skillInstaller } from "./skills/skill-installer";
import {
  MAX_SKILL_PACKAGE_BYTES,
  parseSkillPackageBuffer,
  parseSkillSourceDirectory,
} from "./skills/skill-source";

function registryErrorStatus(kind?: string): number {
  if (kind === "not_found") return 404;
  if (kind === "permission_denied") return 403;
  if (kind === "validation_failed") return 400;
  return 500;
}

function decodeParam(value: unknown): string {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function skillSourceCacheDir(adoptId: string, skillId: string): string {
  return path.join(APP_ROOT, "data", "generated-skills", adoptId, skillId);
}

function skillPackageIndexPath(): string {
  return path.join(APP_ROOT, "data", "skill-packages", "index.json");
}

function readSkillPackageIndex(): any[] {
  const idxPath = skillPackageIndexPath();
  if (!existsSync(idxPath)) return [];
  try {
    const raw = String(readFileSync(idxPath, "utf-8") || "[]").trim();
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeSkillPackageIndex(rows: any[]): void {
  writeFileSync(skillPackageIndexPath(), JSON.stringify(rows, null, 2), "utf-8");
}

function removeSkillPackageIndexRows(adoptId: string, params: { skillId?: string; sourcePath?: string; sha256?: string; filename?: string }): any[] {
  const skillId = String(params.skillId || "").trim();
  const sourcePath = String(params.sourcePath || "").trim();
  const sha256 = String(params.sha256 || "").trim();
  const filename = String(params.filename || "").trim();
  const rows = readSkillPackageIndex();
  const removed: any[] = [];
  const next = rows.filter((row: any) => {
    if (String(row?.adoptId || "") !== adoptId) return true;
    const match = (!!skillId && String(row?.installedSkillId || "") === skillId)
      || (!!sourcePath && String(row?.path || "") === sourcePath)
      || (!!sha256 && String(row?.sha256 || "") === sha256)
      || (!!filename && String(row?.filename || "") === filename);
    if (match) {
      removed.push(row);
      return false;
    }
    return true;
  });
  if (removed.length > 0) writeSkillPackageIndex(next);
  return removed;
}

const MCP_TOOL_CATALOG = [
  {
    id: "wind",
    name: "Wind 金融数据",
    category: "公共金融数据",
    description:
      "公共授权金融数据源，覆盖行情、财务、公告新闻、指数、基金、债券、宏观和市场分析，供投研、投顾、风控等岗位复用。",
    children: [
      {
        id: "wind-financial-docs",
        name: "金融文档与公告研报",
        description: "查询公告、新闻、研报、财经资讯和金融资料检索能力。",
        serverIds: ["wind_financial_docs"],
        tools: [
          {
            name: "get_company_announcements",
            description: "公告数据：按公司、关键词和时间范围查找上市公司公告。",
          },
          {
            name: "get_financial_news",
            description: "资讯数据：检索财经新闻、市场动态和相关金融资料。",
          },
        ],
      },
      {
        id: "wind-stock-data",
        name: "股票行情与财务",
        description: "覆盖 A 股、港股、美股的行情、K 线、财务和公司事件。",
        serverIds: ["wind_stock_data"],
        tools: [
          {
            name: "get_stock_quote",
            description: "股票快照：查询最新价、涨跌幅、成交量和行情快照。",
          },
          {
            name: "get_stock_kline",
            description: "股票走势：获取日线、分钟线和历史 K 线。",
          },
          {
            name: "get_stock_fundamentals",
            description: "股票基本面：查询财报、股本、分红、公司事件和风险指标。",
          },
        ],
      },
      {
        id: "wind-index-data",
        name: "指数与板块数据",
        description: "查询指数行情、成分、行业板块和相关基本面数据。",
        serverIds: ["wind_index_data"],
        tools: [
          {
            name: "get_index_quote",
            description: "指数快照：查询指数最新行情、涨跌幅和成交信息。",
          },
          {
            name: "get_index_fundamentals",
            description: "指数基本面：查看指数估值、成分、行业板块和权重变化。",
          },
        ],
      },
      {
        id: "wind-fund-data",
        name: "基金与 ETF 数据",
        description: "覆盖 ETF、公募基金行情、档案、持仓、业绩和管理人数据。",
        serverIds: ["wind_fund_data"],
        tools: [
          {
            name: "get_fund_quote",
            description: "基金行情：查询 ETF、公募基金净值、涨跌和行情快照。",
          },
          {
            name: "get_fund_portfolio",
            description: "基金画像：查询基金持仓、持有人、业绩、风险和管理公司信息。",
          },
        ],
      },
      {
        id: "wind-bond-data",
        name: "债券数据",
        description: "查询债券档案、主体、估值、行情和发行人财务数据。",
        serverIds: ["wind_bond_data"],
        tools: [
          {
            name: "get_bond_basicinfo",
            description: "债券档案：查询债券基础信息、期限、票息和发行条款。",
          },
          {
            name: "get_bond_valuation",
            description: "债券估值：查询债券估值、成交、主体财务和评级信息。",
          },
        ],
      },
      {
        id: "wind-economic-data",
        name: "宏观经济数据",
        description: "查询宏观指标、行业指标、经济周期和统计数据。",
        serverIds: ["wind_economic_data"],
        tools: [
          {
            name: "get_macro_indicator",
            description: "宏观指标：查询 GDP、CPI、PMI、社融等经济指标。",
          },
          {
            name: "get_industry_indicator",
            description: "行业指标：查询行业景气、价格、产量和库存数据。",
          },
        ],
      },
      {
        id: "wind-analytics-data",
        name: "市场分析工具",
        description: "提供技术指标、风险指标和组合分析相关的数据能力。",
        serverIds: ["wind_analytics_data"],
        tools: [
          { name: "get_technical_indicators", description: "技术指标：查询或计算常用技术分析指标。" },
          {
            name: "get_risk_metrics",
            description: "风险指标：支持风险指标、收益分析和组合诊断。",
          },
        ],
      },
    ],
    recommendedSkills: ["wind-mcp-skill", "wind-find-finance-skill"],
  },
  {
    id: "qieman",
    name: "且慢财富数据",
    category: "公共金融数据",
    description:
      "公共财富管理数据源，面向基金分析、组合诊断、资产配置和目标测算场景，由财富类技能统一调度。",
    children: [
      {
        id: "qieman-wealth",
        name: "财富规划与基金分析",
        description: "查询且慢侧基金、组合、目标测算和财富诊断工具。",
        serverIds: ["qieman"],
        tools: [
          {
            name: "qieman_fund_search",
            description: "基金检索：查询基金资料、业绩、风险和持仓特征。",
          },
          {
            name: "qieman_portfolio_analyze",
            description: "组合诊断：分析组合配置、波动、收益和集中度。",
          },
          {
            name: "qieman_goal_calculate",
            description: "目标测算：按目标金额、期限和风险偏好做规划测算。",
          },
          {
            name: "qieman_wealth_healthcheck",
            description: "财富体检：评估资产结构、现金流和风险暴露。",
          },
        ],
      },
    ],
    recommendedSkills: [
      "wealth-family-advisor",
      "wealth-healthcheck",
      "wealth-goalcalc",
      "fund-analyst",
      "portfolio-doctor",
    ],
  },
  {
    id: "bond-quote-parse",
    name: "债券报价解析 MCP",
    category: "内部业务 MCP",
    description:
      "内部业务 MCP，解析债券申购群聊、报价语料和 CSV 表格，提取机构、利率、投标量和错误项。",
    children: [
      {
        id: "bond-quote-parse",
        name: "债券群聊报价解析",
        description: "从群聊文本或表格中解析债券报价、申购量、机构和异常项。",
        serverIds: ["bond_quote_parse", "bond-quote-parse"],
        displayServerId: "bond-quote-parse",
        tools: [
          {
            name: "bond_parse_validate",
            description: "报价解析：从群聊文本中抽取债券简称、期限、收益率、量和机构，并返回校验结果。",
          },
          {
            name: "bond_parse_batch",
            description: "批量校验：校验 CSV 或表格中的缺失项、格式错误和重复记录。",
          },
          {
            name: "bond_parse_schema",
            description: "字段说明：返回债券报价解析的标准字段、类型和枚举约束。",
          },
        ],
      },
    ],
    recommendedSkills: ["bond-quote-parse"],
  },
  {
    id: "wealth-assistant",
    name: "财富经理业务数据 MCP",
    category: "内部业务 MCP",
    description:
      "内部业务 MCP，面向客户经理获取本人授权范围内的客户数据、产品数据和推荐上下文，辅助客户经营和产品推荐。",
    children: [
      {
        id: "wealth-assistant",
        name: "客户经理财富助手",
        description:
          "聚合客户数据与推荐产品数据，可查询客户列表、客户详情、基金/理财产品、净值历史和市场新闻。",
        serverIds: ["wealth_assistant_customer", "wealth_assistant_product"],
        displayServerId: "wealth-assistant-context",
        tools: [
          {
            name: "wealth_assistant_customer_list",
            description:
              "客户列表：查询客户列表、搜索客户，并获取客户画像和资产信息。",
          },
          {
            name: "wealth_assistant_product_search",
            description:
              "产品检索：查询基金、理财产品、净值历史和市场新闻，辅助客户经理做产品匹配。",
          },
          {
            name: "wealth_assistant_context_probe",
            description:
              "上下文探测：检查调用方 agentId、权限上下文和财富助手服务连通性。",
          },
        ],
      },
    ],
    recommendedSkills: [],
  },
  {
    id: "group-insurance-audit",
    name: "团险审核工作流 MCP",
    category: "内部业务 MCP",
    description:
      "内部业务 MCP，面向团险运营审核材料完整性、责任配置、费率风险和审核摘要，当前为内部演示接入。",
    children: [
      {
        id: "group-insurance-audit",
        name: "团险审核工作流",
        description:
          "围绕团单材料理解、配置校验、责任审核和风险摘要输出结构化审核结果。",
        serverIds: ["group_insurance_audit"],
        tools: [
          {
            name: "group_insurance_audit_workflow",
            description:
              "团险审核：执行材料解析、完整性检查、责任配置审核、风险识别和建议摘要。",
          },
        ],
      },
    ],
    recommendedSkills: [
      "group-policy-document-understanding",
      "group-insurance-material-check",
      "group-insurance-liability-review",
      "group-insurance-risk-summary",
    ],
  },
  {
    id: "credential-skills",
    name: "凭证智能审核 MCP",
    category: "内部业务 MCP",
    description:
      "内部业务 MCP，提供凭证分类、要素提取、图像质量分析与字段定位能力，面向凭证审核与进件合规检查场景。",
    children: [
      {
        id: "credential-classification",
        name: "凭证分类",
        description: "将凭证图片自动分类到 60 种预定义凭证类型。",
        serverIds: ["credential_skills"],
        tools: [
          {
            name: "classification",
            description: "凭证分类：输入凭证图片，返回凭证类型、置信度与页数。",
          },
        ],
      },
      {
        id: "credential-extraction",
        name: "凭证要素提取",
        description: "从凭证图像提取关键要素，支持 20 种凭证类型与提取 Prompt 版本管理。",
        serverIds: ["credential_skills"],
        tools: [
          {
            name: "credential-extractor",
            description: "要素提取：按凭证类型从图像中提取收款人、金额、日期等关键信息。",
          },
          {
            name: "list-credential-types",
            description: "类型清单：列出当前支持的全部凭证类型。",
          },
          {
            name: "sync-prompt",
            description: "Prompt 管理：保存自定义提取 Prompt 配置。",
          },
          {
            name: "query-prompt",
            description: "Prompt 管理：查询提取 Prompt 配置及版本。",
          },
          {
            name: "activate-prompt",
            description: "Prompt 管理：激活指定版本的提取 Prompt。",
          },
        ],
      },
      {
        id: "credential-image-analysis",
        name: "凭证图像分析",
        description: "图像质量分级与字段坐标定位，辅助审核划重点。",
        serverIds: ["credential_skills"],
        tools: [
          {
            name: "image-analyzer",
            description: "质量分析：图像特征维度分析与元素等级判断（L1-L4）。",
          },
          {
            name: "locate-field",
            description: "字段定位：在图像中定位单个字段的 bbox 坐标。",
          },
          {
            name: "locate-all-fields",
            description: "批量定位：一次定位图像中全部字段的 bbox 坐标。",
          },
        ],
      },
      {
        id: "credential-image-workspace",
        name: "工作目录凭证图片处理",
        description: "读取当前 Agent 工作目录内的凭证图片或 PDF，安全转换后调用凭证识别服务。",
        serverIds: ["credential_image_workspace"],
        tools: [
          {
            name: "credential_image_extract_from_workspace",
            description: "工作目录凭证处理：仅接受 workspace 相对路径，服务端校验边界后执行凭证分类、要素提取或提示词生成。",
          },
        ],
      },
    ],
    recommendedSkills: ["credential-review"],
  },
  {
    id: "insurance-kb",
    name: "保险知识库 MCP",
    category: "内部业务 MCP",
    description:
      "内部业务 MCP，连接保险知识库，提供保险产品、条款解释、异议处理和销售辅助知识检索能力。",
    children: [
      {
        id: "insurance-kb-search",
        name: "保险知识库检索",
        description: "检索保险产品信息、条款解释、FAQ 和异议处理话术。",
        serverIds: ["insurance_kb"],
        tools: [
          {
            name: "insurance_kb_search",
            description:
              "知识检索：输入保险相关问题，返回匹配的知识片段、相似度和来源。",
          },
          {
            name: "insurance_kb_list",
            description:
              "知识库清单：列出可用保险知识库，用于确认检索范围。",
          },
        ],
      },
    ],
    recommendedSkills: ["insurance-advisor-pro"],
  },
  {
    id: "post-loan-risk-data",
    name: "贷后风控数据 MCP",
    category: "内部业务 MCP",
    description:
      "内部业务 MCP，提供企业贷后风控所需的企业画像、贷款账户、财报、还款、担保、司法、舆情和行业基准数据。",
    children: [
      {
        id: "post-loan-risk-core",
        name: "企业贷后风险数据",
        description: "围绕统一社会信用代码查询贷后风险评估所需的数据，当前为灰度演示版。",
        serverIds: ["post_loan_risk_data"],
        tools: [
          { name: "get_enterprise_profile", description: "企业画像：查询企业基本信息、行业、规模和经营状态。" },
          { name: "get_loan_account", description: "贷款账户：查询贷款余额、授信额度、五级分类和逾期情况。" },
          { name: "get_financial_statements", description: "财务报表：查询资产、负债、现金流、利润和偿债指标。" },
          { name: "get_repayment_history", description: "还款历史：查询逾期次数、最大逾期天数和近期还款记录。" },
          { name: "get_credit_rating", description: "信用评级：查询内部评级、外部评级和评分变化。" },
        ],
      },
      {
        id: "post-loan-risk-external",
        name: "外部风险与行业基准",
        description: "补充司法、舆情、经营异常、税务、失信、行业和宏观风险信号。",
        serverIds: ["post_loan_risk_data"],
        tools: [
          { name: "get_judicial_info", description: "司法风险：查询诉讼、执行和资产冻结信息。" },
          { name: "get_public_opinion", description: "舆情风险：查询负面舆情和重大风险报道。" },
          { name: "get_business_abnormal", description: "经营异常：查询工商异常和严重违法信息。" },
          { name: "get_dishonest_record", description: "失信记录：查询企业及关联方失信被执行信息。" },
          { name: "get_industry_benchmark", description: "行业基准：查询偿债、流动性、负债率等行业对标指标。" },
          { name: "get_industry_rating", description: "行业评级：查询行业风险评级、景气度和政策风险。" },
          { name: "get_macro_indicator", description: "宏观指标：查询 GDP、PMI、CPI、PPI、LPR、M2 等宏观指标。" },
        ],
      },
    ],
    recommendedSkills: ["post-loan-risk-prediction"],
  },
  {
    id: "insurance-telesales-recommend",
    name: "车险智能外呼 MCP",
    category: "内部业务 MCP",
    description:
      "车险电销对话分析 MCP，实时识别客户意图并推荐合规应对话术，面向车险外呼坐席辅助场景。",
    children: [
      {
        id: "telesales-analyze",
        name: "外呼对话分析",
        description: "分析外呼通话记录，识别客户意图并推荐应对话术。",
        serverIds: ["insurance_telesales_recommend"],
        tools: [
          {
            name: "telesales_analyze_conversation",
            description:
              "对话分析：输入通话对话历史，返回意图编码、置信度、推荐话术与风险提示。",
          },
          {
            name: "telesales_list_intents",
            description:
              "意图清单：返回系统支持的全部意图分类（编码 + 名称 + 关键词）。",
          },
        ],
      },
    ],
    recommendedSkills: ["insurance-telesales-recommend"],
  },
];

function readOpenClawConfig(): Record<string, any> {
  try {
    if (!existsSync(OPENCLAW_JSON_PATH)) return {};
    const cfg = JSON.parse(
      String(readFileSync(OPENCLAW_JSON_PATH, "utf-8") || "{}")
    );
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}

function readOpenClawMcpServers(config = readOpenClawConfig()): Record<string, any> {
  return config?.mcp?.servers && typeof config.mcp.servers === "object"
    ? config.mcp.servers
    : {};
}

export function listConfiguredMcpServers() {
  const servers = readOpenClawMcpServers();
  return Object.entries(servers)
    .map(([serverId, raw]) => ({
      serverId,
      configured: true,
      enabled: !Boolean((raw as any)?.disabled),
      status: Boolean((raw as any)?.disabled) ? "disabled" : "available",
      existsOnDisk: mcpServerExistsOnDisk(serverId, raw),
    }))
    .sort((a, b) => a.serverId.localeCompare(b.serverId));
}

function readAllowedToolNames(config: Record<string, any>): Set<string> {
  const names = new Set<string>();
  const add = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const name = String(item || "").trim();
      if (name) names.add(name);
    }
  };
  add(config?.tools?.alsoAllow);
  add(config?.tools?.sandbox?.tools?.alsoAllow);
  for (const agent of Array.isArray(config?.agents?.list) ? config.agents.list : []) {
    add(agent?.tools?.alsoAllow);
  }
  return names;
}

type McpLiveTool = {
  name: string;
  description: string;
};

type McpLiveStatus = {
  serverId: string;
  status: "live" | "unavailable" | "unsupported";
  tools: McpLiveTool[];
  checkedAt: string;
  error?: string;
};

const MCP_TOOLS_LIVE_TTL_MS = 45_000;
const mcpToolsLiveCache = new Map<string, { expiresAt: number; value: McpLiveStatus }>();

function normalizeMcpTransport(raw: any): string {
  return String(raw?.transport || raw?.type || "").trim().toLowerCase();
}

function normalizeMcpUrl(raw: any): string {
  return String(raw?.url || raw?.endpoint || "").trim();
}

function normalizeMcpHeaders(raw: any): Record<string, string> {
  const headers: Record<string, string> = {};
  const source = raw?.headers && typeof raw.headers === "object" ? raw.headers : {};
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    headers[key] = String(value ?? "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
      if (name === "OPENCLAW_AGENT_ID") return "";
      return process.env[name] || "";
    });
  }
  return headers;
}

function readMcpToolInclude(raw: any): Set<string> | null {
  const include = raw?.toolFilter?.include;
  if (!Array.isArray(include)) return null;
  const names = include.map((item: any) => String(item || "").trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function parseMcpToolsListPayload(text: string): McpLiveTool[] {
  const payload = String(text || "").trim();
  if (!payload) return [];
  const candidates: string[] = [];
  if (payload.includes("\ndata:") || payload.startsWith("data:")) {
    const dataLines = payload
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .filter(Boolean);
    candidates.push(...dataLines.reverse());
  }
  candidates.push(payload);
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(candidate);
      const tools = json?.result?.tools || json?.tools || json?.data?.tools;
      if (!Array.isArray(tools)) continue;
      return tools
        .map((tool: any) => ({
          name: String(tool?.name || "").trim(),
          description: String(tool?.description || "").trim(),
        }))
        .filter(tool => tool.name);
    } catch {
      continue;
    }
  }
  return [];
}

async function fetchMcpLiveStatus(serverId: string, raw: any, options: { force?: boolean } = {}): Promise<McpLiveStatus> {
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  const cacheKey = `${serverId}:${normalizeMcpUrl(raw)}`;
  const cached = mcpToolsLiveCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > now) return cached.value;

  const transport = normalizeMcpTransport(raw);
  const url = normalizeMcpUrl(raw);
  if (!url || (transport && transport !== "url" && transport !== "streamable-http" && transport !== "http")) {
    const value: McpLiveStatus = { serverId, status: "unsupported", tools: [], checkedAt };
    mcpToolsLiveCache.set(cacheKey, { expiresAt: now + MCP_TOOLS_LIVE_TTL_MS, value });
    return value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        connection: "close",
        ...normalizeMcpHeaders(raw),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let tools = parseMcpToolsListPayload(text);
    const include = readMcpToolInclude(raw);
    if (include) tools = tools.filter(tool => include.has(tool.name));
    const value: McpLiveStatus = {
      serverId,
      status: "live",
      tools,
      checkedAt,
    };
    mcpToolsLiveCache.set(cacheKey, { expiresAt: now + MCP_TOOLS_LIVE_TTL_MS, value });
    return value;
  } catch (e: any) {
    const value: McpLiveStatus = {
      serverId,
      status: "unavailable",
      tools: [],
      checkedAt,
      error: e?.name === "AbortError" ? "timeout" : String(e?.message || e || "fetch failed"),
    };
    mcpToolsLiveCache.set(cacheKey, { expiresAt: now + MCP_TOOLS_LIVE_TTL_MS, value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMcpLiveStatuses(
  servers: Record<string, any>,
  allowedServerIds: Set<string>,
  options: { force?: boolean } = {}
): Promise<Record<string, McpLiveStatus>> {
  const entries = Object.entries(servers).filter(
    ([serverId, raw]) => allowedServerIds.has(serverId) && !Boolean((raw as any)?.disabled)
  );
  const result: Record<string, McpLiveStatus> = {};
  const concurrency = 4;
  for (let i = 0; i < entries.length; i += concurrency) {
    const chunk = entries.slice(i, i + concurrency);
    const rows = await Promise.all(chunk.map(([serverId, raw]) => fetchMcpLiveStatus(serverId, raw, options)));
    for (const row of rows) result[row.serverId] = row;
  }
  return result;
}

function readSkillMarkdownCandidate(
  dir?: string
): { text: string; source: "runtime" | "source" } | null {
  if (!dir || !existsSync(dir)) return null;
  try {
    const st = statSync(dir);
    if (!st.isDirectory()) return null;
    const file = path.join(dir, "SKILL.md");
    if (!existsSync(file)) return null;
    const fileStat = statSync(file);
    if (!fileStat.isFile() || fileStat.size > 200 * 1024) return null;
    const text = String(readFileSync(file, "utf-8") || "");
    if (!text.trim() || text.includes("\u0000")) return null;
    return { text, source: "runtime" };
  } catch {
    return null;
  }
}

function extractSkillIntroduction(skillMd: string, fallback: string): string {
  const raw = String(skillMd || "");
  const fm = raw.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]*/);
  const fmBlock = fm?.[1] || "";
  const description = fmBlock
    .match(/^description:\s*['"]?([^'"\n]+)['"]?/im)?.[1]
    ?.trim();
  let body = fm ? raw.slice(fm[0].length) : raw;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*#\s+.+$/m, "")
    .trim();
  const intro = body || description || fallback || "暂无说明";
  return intro.length > 6000
    ? `${intro.slice(0, 6000).trimEnd()}\n\n（内容较长，已截断）`
    : intro;
}

function mcpServerExistsOnDisk(serverId: string, raw: any): boolean {
  const command = typeof raw?.command === "string" ? raw.command : "";
  const args = Array.isArray(raw?.args)
    ? raw.args.map((x: any) => String(x || ""))
    : [];
  const candidates = [command, ...args].filter(Boolean);
  for (const item of candidates) {
    if (item.startsWith("/") && existsSync(item)) return true;
  }
  return existsSync(path.join(OPENCLAW_HOME, "mcp", serverId));
}

export function listMcpToolGroups(options: {
  allowedServerIds?: Set<string> | null;
  invocationCounts?: Record<string, { total: number; tools: Record<string, number> }> | null;
  liveStatuses?: Record<string, McpLiveStatus> | null;
} = {}) {
  const allowedServerIds = options.allowedServerIds || null;
  const invocationCounts = options.invocationCounts || {};
  const liveStatuses = options.liveStatuses || {};
  const config = readOpenClawConfig();
  const servers = readOpenClawMcpServers(config);
  const allowedToolNames = readAllowedToolNames(config);
  const serverRows = Object.entries(servers).map(([serverId, raw]) => {
    const disabled = Boolean((raw as any)?.disabled);
    return {
      serverId,
      configured: true,
      enabled: !disabled,
      status: disabled ? "disabled" : "available",
      existsOnDisk: mcpServerExistsOnDisk(serverId, raw),
    };
  });
  const byId = new Map(serverRows.map(row => [row.serverId, row]));
  const knownServerIds = new Set<string>();

  const groups = MCP_TOOL_CATALOG.map(item => {
    const visibleChildren = allowedServerIds
      ? item.children.filter(child => child.serverIds.some(serverId => allowedServerIds.has(serverId)))
      : item.children;
    const children = visibleChildren.map(child => {
      const visibleServerIds = allowedServerIds
        ? child.serverIds.filter(serverId => allowedServerIds.has(serverId))
        : child.serverIds;
      for (const id of visibleServerIds) knownServerIds.add(id);
      const aliasServers = visibleServerIds.map(
        serverId =>
          byId.get(serverId) || {
            serverId,
            configured: false,
            enabled: false,
            status: "missing",
            existsOnDisk: existsSync(path.join(OPENCLAW_HOME, "mcp", serverId)),
          }
      );
      const activeServer =
        aliasServers.find(server => server.configured) || aliasServers[0];
      const toolNames = Array.isArray(child.tools)
        ? child.tools.map(tool => String(tool?.name || "").trim()).filter(Boolean)
        : [];
      const invocationCount = visibleServerIds.reduce((sum, serverId) => sum + Number(invocationCounts[serverId]?.total || 0), 0);
      const liveRows = visibleServerIds
        .map(serverId => liveStatuses[serverId])
        .filter(Boolean);
      const liveTools = liveRows
        .filter(row => row.status === "live")
        .flatMap(row => row.tools || []);
      const hasLiveProbe = liveRows.length > 0;
      const hasLiveSuccess = liveRows.some(row => row.status === "live");
      const hasLiveFailure = liveRows.some(row => row.status === "unavailable");
      const fallbackTools = Array.isArray(child.tools)
        ? child.tools.map((tool: any) => {
          const toolName = String(tool?.name || "").trim();
          const toolInvocationCount = visibleServerIds.reduce(
            (sum, serverId) => sum + Number(invocationCounts[serverId]?.tools?.[toolName] || 0),
            0
          );
          return { ...tool, invocationCount: toolInvocationCount };
        })
        : child.tools;
      const liveToolNames = new Set<string>();
      const tools = liveTools.length > 0
        ? liveTools
          .filter(tool => {
            if (liveToolNames.has(tool.name)) return false;
            liveToolNames.add(tool.name);
            return true;
          })
          .map(tool => {
            const toolInvocationCount = visibleServerIds.reduce(
              (sum, serverId) => sum + Number(invocationCounts[serverId]?.tools?.[tool.name] || 0),
              0
            );
            return { ...tool, invocationCount: toolInvocationCount, source: "live" };
          })
        : fallbackTools;
      const pluginToolsConfigured =
        toolNames.length > 0 && toolNames.every(toolName => allowedToolNames.has(toolName));
      const configured = aliasServers.some(server => server.configured) || pluginToolsConfigured;
      const enabled = aliasServers.some(
        server => server.configured && server.enabled
      ) || pluginToolsConfigured;
      const status = enabled && (!hasLiveProbe || hasLiveSuccess)
        ? "available"
        : configured || hasLiveFailure
          ? "disabled"
          : "missing";
      const liveStatus = hasLiveSuccess
        ? "live"
        : hasLiveFailure
          ? "unavailable"
          : hasLiveProbe
            ? "unsupported"
            : "fallback";
      const liveErrors = liveRows
        .filter(row => row.error)
        .map(row => `${row.serverId}: ${row.error}`);
      return {
        id: child.id,
        name: child.name,
        description: child.description,
        serverId: (child as any).displayServerId || activeServer.serverId,
        configured,
        enabled,
        status,
        existsOnDisk: aliasServers.some(server => server.existsOnDisk) || pluginToolsConfigured,
        invocationCount,
        tools,
        toolSource: liveTools.length > 0 ? "live" : "fallback",
        liveStatus,
        liveCheckedAt: liveRows.map(row => row.checkedAt).sort().pop() || null,
        liveError: liveErrors[0] || null,
      };
    });
    const availableCount = children.filter(
      child => child.status === "available"
    ).length;
    const configuredCount = children.filter(child => child.configured).length;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      description: item.description,
      recommendedSkills: item.recommendedSkills,
      status:
        availableCount > 0
          ? "available"
          : configuredCount > 0
            ? "disabled"
            : "missing",
      availableCount,
      configuredCount,
      serverCount: children.length,
      invocationCount: children.reduce((sum, child: any) => sum + Number(child.invocationCount || 0), 0),
      liveStatus: children.some((child: any) => child.liveStatus === "live")
        ? "live"
        : children.some((child: any) => child.liveStatus === "unavailable")
          ? "unavailable"
          : children.some((child: any) => child.liveStatus === "unsupported")
            ? "unsupported"
            : "fallback",
      children,
    };
  }).filter(group => group.children.length > 0);

  const visibleServerRows = allowedServerIds
    ? serverRows.filter(row => allowedServerIds.has(row.serverId))
    : serverRows;

  return {
    items: groups,
    totals: {
      groups: groups.length,
      configuredServers: visibleServerRows.length,
      availableServers: visibleServerRows.filter(row => row.enabled).length,
      invocations: groups.reduce((sum, group: any) => sum + Number(group.invocationCount || 0), 0),
    },
  };
}

async function discoverGeneratedRuntimeSkills(
  adoptId: string,
  runtimeAgentId: string,
  onlySkillId?: string
): Promise<{
  discovered: number;
  installed: Array<{ skillId: string; displayName: string }>;
  skipped: Array<{ skillId: string; reason: string }>;
}> {
  const runtimeSkillsRoot = path.join(
    resolveRuntimeWorkspaceByIds(adoptId, runtimeAgentId),
    "skills"
  );
  if (!existsSync(runtimeSkillsRoot))
    return { discovered: 0, installed: [], skipped: [] };

  const listed = await skillRegistry.listSkills(adoptId);
  const registered = new Set(
    listed.ok ? listed.value.map(item => item.id) : []
  );
  const installed: Array<{ skillId: string; displayName: string }> = [];
  const skipped: Array<{ skillId: string; reason: string }> = [];

  for (const entry of readdirSync(runtimeSkillsRoot, { withFileTypes: true })) {
    const sourceDir = path.join(runtimeSkillsRoot, entry.name);
    const isSkillDir = entry.isDirectory() || (entry.isSymbolicLink() && existsSync(sourceDir) && statSync(sourceDir).isDirectory());
    if (!isSkillDir) continue;
    if (!existsSync(path.join(sourceDir, "SKILL.md"))) continue;
    if (onlySkillId && entry.name !== onlySkillId) continue;

    try {
      const parsed = parseSkillSourceDirectory(sourceDir, entry.name);
      if (
        onlySkillId &&
        parsed.skillId !== onlySkillId &&
        entry.name !== onlySkillId
      )
        continue;
      if (registered.has(parsed.skillId)) {
        skipped.push({ skillId: parsed.skillId, reason: "already_registered" });
        continue;
      }

      const sourceCache = skillSourceCacheDir(adoptId, parsed.skillId);
      rmSync(sourceCache, { recursive: true, force: true });
      mkdirSync(path.dirname(sourceCache), { recursive: true });
      cpSync(sourceDir, sourceCache, { recursive: true });
      const st = statSync(sourceCache);
      if (!st.isDirectory()) {
        skipped.push({ skillId: parsed.skillId, reason: "source_copy_failed" });
        continue;
      }

      const source: SkillSource = {
        kind: "generated",
        skillId: parsed.skillId,
        displayName: parsed.displayName || parsed.skillId,
        description: parsed.description || "聊天生成的个人技能",
        sourcePath: sourceCache,
        version: String(parsed.manifest?.version || ""),
      };
      const result = await skillRegistry.install(adoptId, source);
      if (!result.ok) {
        skipped.push({ skillId: parsed.skillId, reason: result.error.detail });
        continue;
      }
      await skillRegistry.updateScan(adoptId, parsed.skillId, {
        warnings: parsed.warnings,
        scannedAt: new Date().toISOString(),
      });
      registered.add(parsed.skillId);
      installed.push({
        skillId: parsed.skillId,
        displayName: source.displayName,
      });
    } catch (e: any) {
      skipped.push({ skillId: entry.name, reason: String(e?.message || e) });
    }
  }

  return { discovered: installed.length, installed, skipped };
}

async function readSkillPackagePayload(req: express.Request): Promise<{
  adoptId: string;
  filename: string;
  fileBuf: Buffer;
  displayName: string;
  description: string;
}> {
  const body = (req.body || {}) as any;
  const adoptId = String(body.adoptId || req.query.adoptId || "").trim();
  const filename = decodeParam(
    body.filename || req.query.filename || req.header("x-skill-filename") || ""
  ).trim();
  const displayName = String(
    body.displayName || req.query.displayName || ""
  ).trim();
  const description = String(
    body.description || req.query.description || ""
  ).trim();
  const contentBase64 = String(body.contentBase64 || "").trim();
  if (contentBase64) {
    return {
      adoptId,
      filename,
      fileBuf: Buffer.from(contentBase64, "base64"),
      displayName,
      description,
    };
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any);
    total += buf.length;
    if (total > MAX_SKILL_PACKAGE_BYTES) {
      const err = new Error("file too large (max 50MB)") as Error & {
        statusCode?: number;
      };
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return {
    adoptId,
    filename,
    fileBuf: Buffer.concat(chunks),
    displayName,
    description,
  };
}

export function registerSkillRoutes(app: express.Express) {
  app.get("/api/claw/skill-market/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const roleTemplate = String((claw as any).roleTemplate || "general-assistant");
      const rows = await listApprovedSkillMarketItems();
      const invocationCounts = await listSkillInvocationCounts(
        rows.map((item: any) => String(item.skillId || "").trim())
      ).catch(() => ({} as Record<string, number>));
      res.json({
        items: rows.map((item: any) => {
          const skillId = String(item.skillId || "").trim();
          return { ...item, invocationCount: invocationCounts[skillId] || 0 };
        }),
        roleTemplate,
        filtered: false,
      });
    } catch (e) {
      console.error("[skill market] list failed", e);
      res.status(500).json({ error: "list skill market failed" });
    }
  });

  app.get("/api/claw/mcp-tools/status", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const roleTemplate = String((claw as any).roleTemplate || "general-assistant");
      const effectiveAssets = await resolveEffectiveRoleAssets(roleTemplate);
      const force = String(req.query.force || "") === "1";
      const allowedServerIds = new Set([
        ...effectiveAssets.mcpServers.default,
        ...effectiveAssets.mcpServers.optional,
      ]);
      const config = readOpenClawConfig();
      const servers = readOpenClawMcpServers(config);
      const liveStatuses = await fetchMcpLiveStatuses(servers, allowedServerIds, { force }).catch(
        (e) => {
          console.warn("[mcp tools] live probe failed", e);
          return {} as Record<string, McpLiveStatus>;
        }
      );
      const invocationCounts = await listMcpInvocationCounts(Array.from(allowedServerIds)).catch(
        () => ({} as Record<string, { total: number; tools: Record<string, number> }>)
      );
      const payload = listMcpToolGroups({ allowedServerIds, invocationCounts, liveStatuses });
      res.json({
        ...payload,
        roleTemplate,
        filtered: true,
        allowedServerIds: Array.from(allowedServerIds).sort(),
        live: {
          enabled: true,
          ttlMs: MCP_TOOLS_LIVE_TTL_MS,
          checkedAt: new Date().toISOString(),
          serverStatuses: Object.fromEntries(
            Object.entries(liveStatuses).map(([serverId, status]) => [
              serverId,
              {
                status: status.status,
                toolCount: status.tools.length,
                checkedAt: status.checkedAt,
                error: status.error || null,
              },
            ])
          ),
        },
      });
    } catch (e) {
      console.error("[mcp tools] status failed", e);
      res.status(500).json({ error: "list mcp tools failed" });
    }
  });

  app.get("/api/claw/skills/registry", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const roleTemplate = String((claw as any).roleTemplate || "general-assistant");
      const runtimeAgentId = await resolveRuntimeAgentId(
        adoptId,
        String((claw as any).agentId || "")
      );
      await discoverGeneratedRuntimeSkills(adoptId, runtimeAgentId);
      const result = await skillRegistry.listSkills(adoptId);
      if (!result.ok) {
        res
          .status(registryErrorStatus(result.error.kind))
          .json({ error: result.error.detail, kind: result.error.kind });
        return;
      }
      res.json({
        items: result.value,
        roleTemplate,
        filtered: false,
      });
    } catch (e) {
      console.error("[skills registry] list failed", e);
      res.status(500).json({ error: "list skills failed" });
    }
  });

  app.get("/api/claw/skills/introduction", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const skillId = String(req.query.skillId || "").trim();
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const listed = await skillRegistry.listSkills(adoptId);
      if (!listed.ok) {
        res
          .status(registryErrorStatus(listed.error.kind))
          .json({ error: listed.error.detail, kind: listed.error.kind });
        return;
      }
      const skill = listed.value.find(item => item.id === skillId);
      if (!skill) {
        res.status(404).json({ error: "skill not found" });
        return;
      }

      const runtimeRead = readSkillMarkdownCandidate(skill.sync?.runtimePath);
      if (runtimeRead) {
        res.json({
          skillId,
          introduction: extractSkillIntroduction(
            runtimeRead.text,
            skill.source.description || ""
          ),
          source: "runtime",
        });
        return;
      }

      const sourceRead = readSkillMarkdownCandidate(skill.source?.sourcePath);
      if (sourceRead) {
        res.json({
          skillId,
          introduction: extractSkillIntroduction(
            sourceRead.text,
            skill.source.description || ""
          ),
          source: "source",
        });
        return;
      }

      res.json({
        skillId,
        introduction: skill.source.description || "暂无说明",
        source: skill.source.description ? "registry" : "fallback",
      });
    } catch (e) {
      console.error("[skills registry] introduction failed", e);
      res.status(500).json({ error: "load skill introduction failed" });
    }
  });

  app.post("/api/claw/skills/reconcile", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const runtimeAgentId = await resolveRuntimeAgentId(
        adoptId,
        String((claw as any).agentId || "")
      );
      const discovered = await discoverGeneratedRuntimeSkills(
        adoptId,
        runtimeAgentId,
        skillId || undefined
      );
      const result = await skillRegistry.reconcile(
        adoptId,
        skillId ? { skillId } : undefined
      );
      if (!result.ok) {
        res
          .status(registryErrorStatus(result.error.kind))
          .json({ error: result.error.detail, kind: result.error.kind });
        return;
      }
      console.log("[SKILL-RECONCILE]", {
        adoptId,
        skillId: skillId || "(all)",
        scanned: result.value.scanned,
        changed: result.value.changed,
        failed: result.value.failed,
        discovered: discovered.discovered,
      });
      res.json({ report: result.value, discovered });
    } catch (e) {
      console.error("[skills registry] reconcile failed", e);
      res.status(500).json({ error: "reconcile skills failed" });
    }
  });

  app.post("/api/claw/skills/set-enabled", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      const enabled = !!body.enabled;
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await skillRegistry.setEnabled(adoptId, skillId, enabled);
      if (!result.ok) {
        res
          .status(registryErrorStatus(result.error.kind))
          .json({ error: result.error.detail, kind: result.error.kind });
        return;
      }
      res.json({ item: result.value });
    } catch (e) {
      console.error("[skills registry] set-enabled failed", e);
      res.status(500).json({ error: "set skill enabled failed" });
    }
  });

  app.post("/api/claw/skills/uninstall", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await skillRegistry.uninstall(adoptId, skillId);
      if (!result.ok) {
        res
          .status(registryErrorStatus(result.error.kind))
          .json({ error: result.error.detail, kind: result.error.kind });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("[skills registry] uninstall failed", e);
      res.status(500).json({ error: "uninstall skill failed" });
    }
  });

  app.post("/api/claw/skills/destroy", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const listed = await skillRegistry.listSkills(adoptId);
      const skill = listed.ok ? listed.value.find((item) => item.id === skillId) : undefined;
      const result = await skillRegistry.destroy(adoptId, skillId);
      if (!result.ok) {
        res
          .status(registryErrorStatus(result.error.kind))
          .json({ error: result.error.detail, kind: result.error.kind });
        return;
      }
      if (skill?.source.kind === "uploaded") {
        removeSkillPackageIndexRows(adoptId, {
          skillId,
          sourcePath: skill.source.sourcePath,
        });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("[skills registry] destroy failed", e);
      res.status(500).json({ error: "delete skill failed" });
    }
  });

  app.post("/api/claw/skills/rename", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      const displayName = String(body.displayName || "").trim();
      if (!adoptId || !skillId || !displayName) {
        res
          .status(400)
          .json({ error: "adoptId, skillId and displayName required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await skillRegistry.rename(adoptId, skillId, displayName);
      if (!result.ok) {
        res
          .status(registryErrorStatus(result.error.kind))
          .json({ error: result.error.detail, kind: result.error.kind });
        return;
      }
      res.json({ item: result.value });
    } catch (e) {
      console.error("[skills registry] rename failed", e);
      res.status(500).json({ error: "rename skill failed" });
    }
  });

  app.post("/api/claw/skill-package/inspect", async (req, res) => {
    try {
      const { adoptId, filename, fileBuf } = await readSkillPackagePayload(req);

      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (!/\.(zip|skill)$/i.test(filename)) {
        res.status(400).json({ error: "only .zip or .skill allowed" });
        return;
      }
      if (fileBuf.length <= 0) {
        res.status(400).json({ error: "file content required" });
        return;
      }
      if (fileBuf.length > MAX_SKILL_PACKAGE_BYTES) {
        res.status(400).json({ error: "file too large (max 50MB)" });
        return;
      }
      const parsed = await parseSkillPackageBuffer(fileBuf, filename);
      res.json({
        ok: true,
        skill: {
          skillId: parsed.skillId,
          displayName: parsed.displayName,
          description: parsed.description,
          manifest: parsed.manifest,
          mdMeta: parsed.mdMeta,
          totalBytes: parsed.totalBytes,
          warnings: parsed.warnings,
        },
      });
    } catch (e: any) {
      console.error("[skill-package inspect] failed", e);
      res
        .status(Number(e?.statusCode || 400))
        .json({ error: String(e?.message || "inspect skill package failed") });
    }
  });

  app.post("/api/claw/skill-package/upload", async (req, res) => {
    try {
      const {
        adoptId,
        filename,
        fileBuf,
        displayName: requestedName,
        description: requestedDescription,
      } = await readSkillPackagePayload(req);

      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (!/\.(zip|skill)$/i.test(filename)) {
        res.status(400).json({ error: "only .zip or .skill allowed" });
        return;
      }
      if (fileBuf.length <= 0) {
        res.status(400).json({ error: "file content required" });
        return;
      }
      if (fileBuf.length > MAX_SKILL_PACKAGE_BYTES) {
        res.status(400).json({ error: "file too large (max 50MB)" });
        return;
      }
      const parsed = await parseSkillPackageBuffer(fileBuf, filename);
      const displayName = requestedName || parsed.displayName;
      if (!displayName || displayName.length < 2) {
        res
          .status(400)
          .json({ error: "displayName must be at least 2 characters" });
        return;
      }
      const displayDescription = requestedDescription || parsed.description;

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const qDir = `${APP_ROOT}/data/skill-packages/${adoptId}`;
      mkdirSync(qDir, { recursive: true });
      const ts = Date.now();
      const zipPath = `${qDir}/${ts}-${safeName}`;
      writeFileSync(zipPath, fileBuf);

      const sha256 = createHash("sha256").update(fileBuf).digest("hex");

      // 写入 index.json
      const idxPathUpload = `${APP_ROOT}/data/skill-packages/index.json`;
      let idxRows: any[] = [];
      if (existsSync(idxPathUpload)) {
        const rawIdx = String(readFileSync(idxPathUpload, "utf-8") || "[]");
        try {
          idxRows = JSON.parse(rawIdx);
        } catch {
          idxRows = [];
        }
      }
      const mdMeta = parsed.mdMeta || {};
      const indexRow = {
        adoptId,
        filename: safeName,
        path: zipPath,
        sha256,
        size: fileBuf.length,
        manifest: parsed.manifest || {},
        mdMeta,
        displayName,
        displayDescription,
        installedSkillId: parsed.skillId,
        installedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      idxRows.push(indexRow);
      writeFileSync(idxPathUpload, JSON.stringify(idxRows, null, 2), "utf-8");

      const source: SkillSource = {
        kind: "uploaded",
        skillId: parsed.skillId,
        displayName,
        description: displayDescription,
        sourcePath: zipPath,
        version: String(parsed.manifest?.version || ""),
      };
      const installed = await skillRegistry.install(adoptId, source);
      if (!installed.ok) {
        res
          .status(registryErrorStatus(installed.error.kind))
          .json({ error: installed.error.detail, kind: installed.error.kind });
        return;
      }
      await skillRegistry.updateScan(adoptId, parsed.skillId, {
        warnings: parsed.warnings,
        scannedAt: new Date().toISOString(),
      });
      const reconciled = await skillRegistry.reconcile(adoptId, {
        skillId: parsed.skillId,
      });
      if (!reconciled.ok) {
        res
          .status(registryErrorStatus(reconciled.error.kind))
          .json({
            error: reconciled.error.detail,
            kind: reconciled.error.kind,
          });
        return;
      }

      bumpSessionEpoch(adoptId);
      res.json({
        ok: true,
        file: { filename: safeName, sha256, size: fileBuf.length },
        item: installed.value,
        report: reconciled.value,
        manifest: parsed.manifest || {},
        warnings: parsed.warnings,
      });
    } catch (e: any) {
      console.error("[skill-package upload] failed", e);
      res
        .status(Number(e?.statusCode || 500))
        .json({ error: String(e?.message || "skill package upload failed") });
    }
  });

  app.post("/api/claw/skill-market/submit", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const skillId = String(body.skillId || "").trim();
      const version =
        String(body.version || "1.0.0")
          .trim()
          .slice(0, 32) || "1.0.0";
      if (!adoptId || !skillId) {
        res.status(400).json({ error: "adoptId and skillId required" });
        return;
      }

      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const listed = await skillRegistry.listSkills(adoptId);
      if (!listed.ok) {
        res
          .status(registryErrorStatus(listed.error.kind))
          .json({ error: listed.error.detail, kind: listed.error.kind });
        return;
      }
      const skill = listed.value.find(item => item.id === skillId);
      if (!skill) {
        res.status(404).json({ error: "skill not found" });
        return;
      }
      if (!["uploaded", "generated"].includes(skill.source.kind)) {
        res
          .status(400)
          .json({
            error: "only uploaded or generated skills can be submitted",
          });
        return;
      }
      if (!skill.source.sourcePath || !existsSync(skill.source.sourcePath)) {
        res.status(404).json({ error: "skill source missing" });
        return;
      }
      if (!skillInstaller.canInstall(skill.source.sourcePath)) {
        res.status(400).json({ error: "unsupported skill source" });
        return;
      }

      const marketDir = openClawSkillMarketDir();
      const pendingDir = `${marketDir}/pending/${skill.id}-${Date.now()}`;
      skillInstaller.installFromSource(skill.source.sourcePath, pendingDir);
      const parsed = parseSkillSourceDirectory(pendingDir, skill.id);
      const { insertSkillMarketItem } = await import("../db");
      const marketItemId = await insertSkillMarketItem({
        skillId: parsed.skillId || skill.id,
        name: skill.source.displayName || parsed.displayName || skill.id,
        description: skill.source.description || parsed.description || null,
        author: "中队专区",
        authorUserId: Number((claw as any).userId || 0) || null,
        version,
        category: "general",
        origin: "squad",
        status: "pending",
        license: "内部共享",
        packagePath: pendingDir,
      });

      res.json({ ok: true, marketItemId, status: "pending" });
    } catch (e: any) {
      console.error("[skill-market submit] failed", e);
      res
        .status(500)
        .json({ error: String(e?.message || "submit skill to market failed") });
    }
  });

  app.get("/api/claw/skill-package/mine", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const rows = readSkillPackageIndex().filter(
        (x: any) => String(x?.adoptId || "") === adoptId
      );
      res.json({ items: rows });
    } catch (e) {
      console.error("[skill-package mine] failed", e);
      res.status(500).json({ error: "list mine packages failed" });
    }
  });

  app.post("/api/claw/skill-package/delete", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      const skillId = String(body.skillId || "").trim();
      const sha256 = String(body.sha256 || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const rows = readSkillPackageIndex();

      const found = rows.find(
        (x: any) =>
          String(x?.adoptId || "") === adoptId &&
          ((filename && String(x?.filename || "") === filename) ||
            (skillId && String(x?.installedSkillId || "") === skillId) ||
            (sha256 && String(x?.sha256 || "") === sha256))
      );

      if (!found) {
        res.status(404).json({ error: "package not found" });
        return;
      }

      removeSkillPackageIndexRows(adoptId, {
        filename,
        skillId: skillId || String(found?.installedSkillId || ""),
        sha256,
        sourcePath: String(found?.path || ""),
      });

      const packagePath = String(found?.path || "").trim();
      const sid = String(found?.installedSkillId || "").trim();
      if (sid) {
        const destroyed = await skillRegistry.destroy(adoptId, sid);
        if (!destroyed.ok && destroyed.error.kind !== "not_found") {
          res
            .status(registryErrorStatus(destroyed.error.kind))
            .json({ error: destroyed.error.detail, kind: destroyed.error.kind });
          return;
        }
      }
      if (packagePath && existsSync(packagePath)) rmSync(packagePath, { force: true });

      // best-effort clean installed dir
      if (sid) {
        const { getClawByAdoptId } = await import("../db");
        const claw = await getClawByAdoptId(adoptId).catch(() => null);
        if (claw?.agentId) {
          // runtimeAgentId 优先：与 chat-stream / install 保持一致
          const trialAgentId = `trial_${adoptId}`;
          const trialAgentDir = openClawAgentDir(trialAgentId);
          const runtimeAgentId = existsSync(trialAgentDir)
            ? trialAgentId
            : claw.agentId;
          const skillsBase = `${resolveRuntimeWorkspaceByIds(adoptId, runtimeAgentId)}/skills`;

          // 1) 精确匹配
          const dir = `${skillsBase}/${sid}`;
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
          } else if (existsSync(skillsBase)) {
            // 2) fallback：查找包含 installedSkillId 关键词的子目录（防止命名漂移）
            try {
              const { readdirSync } = await import("fs");
              const candidates = readdirSync(skillsBase).filter(
                d => d.includes(sid) || sid.includes(d)
              );
              for (const c of candidates) {
                const cDir = `${skillsBase}/${c}`;
                rmSync(cDir, { recursive: true, force: true });
              }
            } catch {}
          }
        }
      }

      // 清除 agent sessions 缓存，让下次对话自动感知技能变更
      if (sid) {
        const trialAgentIdD = `trial_${adoptId}`;
        const trialAgentDirD = openClawAgentDir(trialAgentIdD);
        const runtimeAgentIdD = existsSync(trialAgentDirD)
          ? trialAgentIdD
          : String(claw?.agentId || "");
        if (runtimeAgentIdD)
          clearAgentSessionsCache(runtimeAgentIdD, OPENCLAW_BASE_HOME);
      }
      bumpSessionEpoch(adoptId);
      res.json({ ok: true });
    } catch (e) {
      console.error("[skill-package delete] failed", e);
      res.status(500).json({ error: "delete package failed" });
    }
  });

  app.get("/api/claw/shared-packages", async (_req, res) => {
    try {
      const regPath = `${APP_ROOT}/data/shared-skill-registry.json`;
      let rows: any[] = [];
      if (existsSync(regPath)) {
        const raw = String(readFileSync(regPath, "utf-8") || "[]").trim();
        if (raw) rows = JSON.parse(raw);
      }
      res.json({ items: Array.isArray(rows) ? rows : [] });
    } catch (e) {
      console.error("[shared-packages] list failed", e);
      res.status(500).json({ error: "list shared packages failed" });
    }
  });

  app.post("/api/claw/skill-package/install", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      if (!adoptId || !filename) {
        res.status(400).json({ error: "adoptId and filename required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let rows: any[] = [];
      if (existsSync(idxPath)) {
        const raw = String(readFileSync(idxPath, "utf-8") || "[]");
        try {
          rows = JSON.parse(raw);
        } catch {
          rows = [];
        }
      }
      const found = rows.find(
        (x: any) =>
          String(x?.adoptId || "") === adoptId &&
          String(x?.filename || "") === filename
      );
      if (!found) {
        res.status(404).json({ error: "package not found" });
        return;
      }
      const zipPath = String(found?.path || "").trim();
      if (!zipPath || !existsSync(zipPath)) {
        res.status(404).json({ error: "package file missing" });
        return;
      }

      // runtimeAgentId: prefer trial_{adoptId} if it exists, else fall back to db agentId
      const trialAgentIdInst = `trial_${adoptId}`;
      const trialAgentDirInst = openClawAgentDir(trialAgentIdInst);
      const runtimeAgentId = existsSync(trialAgentDirInst)
        ? trialAgentIdInst
        : String(claw.agentId || "");

      // skillId = zip 包内顶层目录名（原样，不做二次加工）
      // fallback：文件名去掉时间戳前缀和 .zip
      const py_probe = `import zipfile, json, re
with zipfile.ZipFile(${JSON.stringify(zipPath)}, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 tops=list({n.split('/')[0] for n in names if '/' in n})
 # 如果 zip 里有且只有一个顶层目录，用它作为 skillId
 if len(tops)==1:
  sid=tops[0].lower().strip()
 else:
  # fallback: filename 去掉时间戳(纯数字前缀)和 .zip
  raw=${JSON.stringify(filename.replace(/\.zip$/i, ""))}
  sid=re.sub(r'^[0-9]+-','',raw).lower()
 # 只保留合法字符
 sid=re.sub(r'[^a-z0-9-]+','-',sid).strip('-')[:48] or 'uploaded-skill'
 print(json.dumps({'skillId':sid}))`;
      const pyProbePath = `/tmp/claw_probe_${Date.now()}.py`;
      writeFileSync(pyProbePath, py_probe, "utf-8");
      let probeRaw = "";
      try {
        probeRaw = execSync(`python3 ${pyProbePath}`, {
          encoding: "utf-8",
          timeout: 5000,
        });
      } finally {
        try {
          rmSync(pyProbePath, { force: true });
        } catch {}
      }
      const skillId: string =
        JSON.parse(probeRaw.trim())?.skillId || "uploaded-skill";

      const skillDir = `${resolveRuntimeWorkspaceByIds(adoptId, runtimeAgentId)}/skills/${skillId}`;

      const py = `import zipfile, os, json
zip_path=${JSON.stringify(zipPath)}
dst=${JSON.stringify(skillDir)}
os.makedirs(dst, exist_ok=True)
with zipfile.ZipFile(zip_path, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 for n in names:
  if n.startswith('/') or '..' in n:
   raise Exception('path traversal')
 prefix=''
 top={n.split('/')[0] for n in names if '/' in n}
 if len(top)==1:
  only=list(top)[0]
  if all(n.startswith(only + '/') for n in names):
   prefix=only + '/'
 for n in names:
  m=n[len(prefix):] if prefix and n.startswith(prefix) else n
  if not m:
   continue
  out=os.path.join(dst,m)
  os.makedirs(os.path.dirname(out), exist_ok=True)
  with z.open(n) as src, open(out,'wb') as fw:
   fw.write(src.read())
print(json.dumps({'ok':True}))`;
      const pyInstallPath = `/tmp/claw_install_${Date.now()}.py`;
      writeFileSync(pyInstallPath, py, "utf-8");
      try {
        execSync(`python3 ${pyInstallPath}`, {
          encoding: "utf-8",
          timeout: 12000,
        });
      } finally {
        try {
          rmSync(pyInstallPath, { force: true });
        } catch {}
      }

      // 确保 SKILL.md 存在（zip 里已有则已解压；兜底写一个轻量版）
      const skillMdPath = `${skillDir}/SKILL.md`;
      if (!existsSync(skillMdPath)) {
        const title = String(
          found?.displayName || found?.manifest?.name || skillId
        ).trim();
        let desc = String(
          found?.displayDescription ||
            found?.manifest?.description ||
            "uploaded skill"
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);
        writeFileSync(
          skillMdPath,
          `---\nname: ${skillId}\ndescription: "${desc.replace(/"/g, "'")}"\n---\n\n# ${title}\n\n${desc}\n`,
          "utf-8"
        );
      }

      // 更新索引记录
      rows = rows.map((r: any) => {
        if (
          String(r?.adoptId || "") === adoptId &&
          String(r?.filename || "") === filename
        ) {
          return {
            ...r,
            installedSkillId: skillId,
            installedAt: new Date().toISOString(),
          };
        }
        return r;
      });
      writeFileSync(idxPath, JSON.stringify(rows, null, 2), "utf-8");

      // 清除 agent sessions 缓存，让下次对话自动用新 session（含新技能快照）
      clearAgentSessionsCache(runtimeAgentId, OPENCLAW_BASE_HOME);
      bumpSessionEpoch(adoptId);

      res.json({ ok: true, skillId, path: skillDir });
    } catch (e) {
      console.error("[skill-package install] failed", e);
      res.status(500).json({ error: "install package failed" });
    }
  });

  app.post("/api/claw/skill-package/publish", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      const title = String(body.title || filename || "").trim();
      const desc = String(body.description || "").trim();
      const homepage = String(body.homepage || "").trim();
      if (!adoptId || !filename) {
        res.status(400).json({ error: "adoptId and filename required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let idx: any[] = [];
      if (existsSync(idxPath)) {
        const raw = String(readFileSync(idxPath, "utf-8") || "[]");
        try {
          idx = JSON.parse(raw);
        } catch {
          idx = [];
        }
      }
      const found = idx.find(
        (x: any) =>
          String(x?.adoptId || "") === adoptId &&
          String(x?.filename || "") === filename
      );
      if (!found) {
        res.status(404).json({ error: "package not found" });
        return;
      }

      const regPath = `${APP_ROOT}/data/shared-skill-registry.json`;
      let rows: any[] = [];
      if (existsSync(regPath)) {
        const raw = String(readFileSync(regPath, "utf-8") || "[]");
        try {
          rows = JSON.parse(raw);
        } catch {
          rows = [];
        }
      }

      const id = `shared-${found.sha256?.slice(0, 10) || Date.now()}`;
      const row = {
        id,
        title: title || filename,
        description: desc || found?.manifest?.description || "",
        homepage,
        filename,
        fromAdoptId: adoptId,
        version: found?.manifest?.version || "0.1.0",
        manifest: found?.manifest || {},
        createdAt: new Date().toISOString(),
      };
      rows = rows.filter((r: any) => r.id !== id);
      rows.push(row);
      mkdirSync(`${APP_ROOT}/data`, { recursive: true });
      writeFileSync(regPath, JSON.stringify(rows, null, 2), "utf-8");

      res.json({ ok: true, item: row });
    } catch (e) {
      console.error("[shared-packages] publish failed", e);
      res.status(500).json({ error: "publish shared package failed" });
    }
  });

  // ── 技能市场：从市场安装技能到个人空间 ──────────────────────────
  app.post("/api/claw/skill-market/install", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const marketItemId = String(body.marketItemId || "").trim();
      if (!adoptId || !marketItemId) {
        res.status(400).json({ error: "adoptId and marketItemId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      // 1. find market item from registry
      const regPath = `${APP_ROOT}/data/shared-skill-registry.json`;
      let registry: any[] = [];
      if (existsSync(regPath)) {
        try {
          registry = JSON.parse(String(readFileSync(regPath, "utf-8") || "[]"));
        } catch {
          registry = [];
        }
      }
      const marketItem = registry.find(
        (r: any) => String(r?.id || "") === marketItemId
      );
      if (!marketItem) {
        res.status(404).json({ error: "market item not found" });
        return;
      }

      // 2. find source package zip from publisher
      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let allPkgs: any[] = [];
      if (existsSync(idxPath)) {
        try {
          allPkgs = JSON.parse(String(readFileSync(idxPath, "utf-8") || "[]"));
        } catch {
          allPkgs = [];
        }
      }
      const srcPkg = allPkgs.find(
        (x: any) =>
          String(x?.adoptId || "") === String(marketItem.fromAdoptId || "") &&
          String(x?.filename || "") === String(marketItem.filename || "")
      );
      if (!srcPkg || !srcPkg.path || !existsSync(srcPkg.path)) {
        res.status(404).json({ error: "source package file not found" });
        return;
      }

      // 3. copy zip to current user's package dir
      const userPkgDir = `${APP_ROOT}/data/skill-packages/${adoptId}`;
      mkdirSync(userPkgDir, { recursive: true });
      const srcFilename = String(marketItem.filename || "market-skill.zip");
      const newFilename = `${Date.now()}-${srcFilename}`;
      const dstZipPath = `${userPkgDir}/${newFilename}`;
      copyFileSync(srcPkg.path, dstZipPath);

      // 4. probe skillId + unzip to workspace (same as install API)
      const trialAgentId = `trial_${adoptId}`;
      const trialAgentDir = openClawAgentDir(trialAgentId);
      const runtimeAgentId = existsSync(trialAgentDir)
        ? trialAgentId
        : String(claw.agentId || "");

      const pyProbe = `import zipfile, json, re
with zipfile.ZipFile(${JSON.stringify(dstZipPath)}, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 tops=list({n.split('/')[0] for n in names if '/' in n})
 if len(tops)==1:
  sid=tops[0].lower().strip()
 else:
  raw=${JSON.stringify(srcFilename.replace(/\.zip$/i, ""))}
  sid=re.sub(r'^[0-9]+-','',raw).lower()
 sid=re.sub(r'[^a-z0-9-]+','-',sid).strip('-')[:48] or 'market-skill'
 print(json.dumps({'skillId':sid}))`;
      const pyProbePath = `/tmp/claw_mkt_probe_${Date.now()}.py`;
      writeFileSync(pyProbePath, pyProbe, "utf-8");
      let probeRaw = "";
      try {
        probeRaw = execSync(`python3 ${pyProbePath}`, {
          encoding: "utf-8",
          timeout: 5000,
        });
      } finally {
        try {
          rmSync(pyProbePath, { force: true });
        } catch {}
      }
      const skillId: string =
        JSON.parse(probeRaw.trim())?.skillId || "market-skill";

      const skillDir = `${resolveRuntimeWorkspaceByIds(adoptId, runtimeAgentId)}/skills/${skillId}`;
      const pyInstall = `import zipfile, os, json
zip_path=${JSON.stringify(dstZipPath)}
dst=${JSON.stringify(skillDir)}
os.makedirs(dst, exist_ok=True)
with zipfile.ZipFile(zip_path, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 for n in names:
  if n.startswith('/') or '..' in n:
   raise Exception('path traversal')
 prefix=''
 top={n.split('/')[0] for n in names if '/' in n}
 if len(top)==1:
  only=list(top)[0]
  if all(n.startswith(only + '/') for n in names):
   prefix=only + '/'
 for n in names:
  m=n[len(prefix):] if prefix and n.startswith(prefix) else n
  if not m:
   continue
  out=os.path.join(dst,m)
  os.makedirs(os.path.dirname(out), exist_ok=True)
  with z.open(n) as src, open(out,'wb') as fw:
   fw.write(src.read())
print(json.dumps({'ok':True}))`;
      const pyInstallPath = `/tmp/claw_mkt_install_${Date.now()}.py`;
      writeFileSync(pyInstallPath, pyInstall, "utf-8");
      try {
        execSync(`python3 ${pyInstallPath}`, {
          encoding: "utf-8",
          timeout: 12000,
        });
      } finally {
        try {
          rmSync(pyInstallPath, { force: true });
        } catch {}
      }

      // ensure SKILL.md exists
      const skillMdPath = `${skillDir}/SKILL.md`;
      if (!existsSync(skillMdPath)) {
        const title = String(marketItem.title || skillId).trim();
        const desc = String(marketItem.description || "from skill market")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);
        writeFileSync(
          skillMdPath,
          `---\nname: ${skillId}\ndescription: "${desc.replace(/"/g, "'")}"\n---\n\n# ${title}\n\n${desc}\n`,
          "utf-8"
        );
      }

      // 5. register in package index
      const newEntry = {
        adoptId,
        filename: newFilename,
        path: dstZipPath,
        sha256: srcPkg.sha256 || "",
        size: srcPkg.size || 0,
        manifest: srcPkg.manifest || {},
        mdMeta: srcPkg.mdMeta || {},
        displayName: marketItem.title || srcPkg.displayName || srcFilename,
        displayDescription:
          marketItem.description || srcPkg.displayDescription || "",
        createdAt: new Date().toISOString(),
        installedSkillId: skillId,
        installedAt: new Date().toISOString(),
        fromMarket: marketItemId,
      };
      allPkgs.push(newEntry);
      writeFileSync(idxPath, JSON.stringify(allPkgs, null, 2), "utf-8");

      // 6. update market install count
      const updatedRegistry = registry.map((r: any) => {
        if (String(r?.id || "") === marketItemId) {
          return { ...r, installCount: (r.installCount || 0) + 1 };
        }
        return r;
      });
      writeFileSync(regPath, JSON.stringify(updatedRegistry, null, 2), "utf-8");

      // 7. clear cache + bump epoch
      clearAgentSessionsCache(runtimeAgentId, OPENCLAW_BASE_HOME);
      bumpSessionEpoch(adoptId);

      res.json({ ok: true, skillId, marketItemId, path: skillDir });
    } catch (e) {
      console.error("[skill-market install] failed", e);
      res.status(500).json({ error: "install from market failed" });
    }
  });
}
