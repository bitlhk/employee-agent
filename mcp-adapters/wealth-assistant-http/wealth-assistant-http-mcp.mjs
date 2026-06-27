#!/usr/bin/env node
/**
 * wealth-assistant-http-mcp.mjs
 * HTTP MCP 代理，运行在 17894 端口。
 * 从 x-jiuwen-channel-id 头（由 jiuwenswarm Patch 3 注入）读取用户身份，
 * 代替 OpenClaw plugin 的 agentId → userCode 映射，实现 jiuwenswarm 多用户分权。
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = join(__dirname, "wealth-assistant-http-mcp.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) process.env[key] = value;
  }
}

loadLocalEnv();

const HOST = process.env.WEALTH_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.WEALTH_MCP_PORT || 17894);
const WEALTH_API_BASE = (process.env.WEALTH_ASSISTANT_API_BASE || "").replace(/\/+$/, "");
const INTERNAL_TOKEN = process.env.WEALTH_ASSISTANT_INTERNAL_TOKEN || "";

// ── 用户映射表 ────────────────────────────────────────────────────────────────
const PRINCIPAL_MAP = {
  "lgj-liwenhua": {
    userCode: "liwenhua",
    displayName: "李文华",
    role: "客户经理",
    branchCode: "SZ001",
    allowedProductSegments: ["stable", "balanced"],
  },
  "lgj-lulu": {
    userCode: "lulu",
    displayName: "鲁璐",
    role: "客户经理",
    branchCode: "SH001",
    allowedProductSegments: ["stable", "balanced"],
  },
  "lgj-lihongkun": {
    userCode: "lihongkun",
    displayName: "李泓锟",
    role: "管理员",
    branchCode: "HQ000",
    allowedProductSegments: ["stable", "balanced", "growth"],
  },
};

const DEMO_PRINCIPAL = {
  userCode: "demo_manager",
  displayName: "演示客户经理",
  role: "客户经理",
  branchCode: "SH002",
  allowedProductSegments: ["stable"],
};

const DEMO_CUSTOMERS = [
  {
    customerId: "C-LWH-001", name: "张女士", ownerUserCode: "liwenhua",
    aum: 1860000, riskLevel: "R2", tags: ["稳健理财", "现金管理"],
    nextAction: "本周跟进到期资金续投，优先推荐低波产品。",
  },
  {
    customerId: "C-LWH-002", name: "王先生", ownerUserCode: "liwenhua",
    aum: 4280000, riskLevel: "R3", tags: ["基金定投", "权益关注"],
    nextAction: "结合持仓回撤情况，推荐均衡配置组合。",
  },
  {
    customerId: "C-LL-001", name: "陈总", ownerUserCode: "lulu",
    aum: 3100000, riskLevel: "R2", tags: ["债券偏好", "稳健增值"],
    nextAction: "推荐固收增强系列，关注到期续作。",
  },
  {
    customerId: "C-DEMO-001", name: "演示客户", ownerUserCode: "demo_manager",
    aum: 500000, riskLevel: "R1", tags: ["保守型"],
    nextAction: "仅推荐低风险现金管理产品。",
  },
];

const DEMO_PRODUCTS = [
  { productId: "P-CASH-001", name: "稳健现金管理 A", segment: "stable", riskLevel: "R1", assetClass: "现金管理" },
  { productId: "P-FIXED-002", name: "固收增强优选 B", segment: "balanced", riskLevel: "R2", assetClass: "固收+" },
  { productId: "P-EQUITY-003", name: "权益成长精选 C", segment: "growth", riskLevel: "R4", assetClass: "权益" },
];

// ── 工具定义 ──────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "wealth_assistant_context_probe",
    description: "返回当前请求的用户身份（principal）和 channel_id，用于验证多用户分权是否正确生效。",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", description: "可选备注。" } },
      additionalProperties: true,  // 允许系统注入 __jiuwen_channel_id（Patch 5）
    },
  },
  {
    name: "wealth_assistant_customer_list",
    description: "按当前客户经理身份查询其名下客户列表，支持关键词过滤。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "客户姓名、风险等级或标签关键词。" },
        pageSize: { type: "number", description: "返回数量，默认 5。" },
      },
      additionalProperties: true,  // 允许系统注入 __jiuwen_channel_id（Patch 5）
    },
  },
  {
    name: "wealth_assistant_product_search",
    description: "按当前客户经理权限查询可推荐产品列表，支持关键词过滤。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "产品名称、风险等级或资产类别关键词。" },
        pageSize: { type: "number", description: "返回数量，默认 5。" },
      },
      additionalProperties: true,  // 允许系统注入 __jiuwen_channel_id（Patch 5）
    },
  },
];

// ── 辅助函数 ──────────────────────────────────────────────────────────────────
function resolvePrincipal(channelId) {
  return PRINCIPAL_MAP[channelId] || DEMO_PRINCIPAL;
}

function pageSize(raw, def = 5) {
  const n = typeof raw === "number" ? raw : def;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function matchesQuery(fields, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return fields.some((f) => String(f || "").toLowerCase().includes(q));
}

function buildWealthHeaders(principal) {
  const h = {
    "accept": "application/json",
    "x-linggan-user-code": principal.userCode,
  };
  if (INTERNAL_TOKEN) h.authorization = `Bearer ${INTERNAL_TOKEN}`;
  return h;
}

async function callBackendGet(path, params, principal) {
  if (!WEALTH_API_BASE) return null;
  try {
    const url = new URL(`${WEALTH_API_BASE}${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const resp = await fetch(url, {
      method: "GET",
      headers: buildWealthHeaders(principal),
      signal: AbortSignal.timeout(25_000),
    });
    const text = await resp.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (resp.ok) return { ok: true, source: "wealth-service", data };
    // 后端 4xx/5xx（路径未就绪 / token 未对齐等）→ 降级 demo 数据，错误仅记日志
    console.error("[wealth-mcp] backend " + resp.status + " on " + path + ": " + JSON.stringify(data).slice(0, 200));
    return null;
  } catch (e) {
    console.error("[wealth-mcp] backend request failed on " + path + ": " + (e?.message || String(e)));
    return null;
  }
}

// ── 工具实现 ──────────────────────────────────────────────────────────────────
async function callTool(name, input, channelId) {
  // [Patch 5] 请求级身份：jiuwenswarm StreamEventRail 在工具执行前强制覆写
  // __jiuwen_channel_id 参数（模型伪造值会被替换），优先于连接级 header。
  const argChannel = typeof input?.__jiuwen_channel_id === "string"
    ? input.__jiuwen_channel_id.trim()
    : "";
  if (input && typeof input === "object") delete input.__jiuwen_channel_id;
  if (argChannel) channelId = argChannel;

  const principal = resolvePrincipal(channelId);

  if (name === "wealth_assistant_context_probe") {
    return {
      ok: true,
      channelId,
      principal,
      source: "jiuwenswarm-http-mcp",
      note: input?.note,
    };
  }

  if (name === "wealth_assistant_customer_list") {
    const q = typeof input?.query === "string" ? input.query : undefined;
    const ps = pageSize(input?.pageSize);

    const external = await callBackendGet("/customers", { search: q, page: 1, pageSize: ps }, principal);
    if (external) return external;

    const customers = DEMO_CUSTOMERS
      .filter((c) => c.ownerUserCode === principal.userCode)
      .filter((c) => matchesQuery([c.customerId, c.name, c.riskLevel, ...c.tags], q))
      .slice(0, ps);
    return { ok: true, source: "demo", principal, customers, pagination: { pageSize: ps, returned: customers.length } };
  }

  if (name === "wealth_assistant_product_search") {
    const q = typeof input?.query === "string" ? input.query : undefined;
    const ps = pageSize(input?.pageSize);

    const external = await callBackendGet("/products", { search: q, page: 1, pageSize: ps }, principal);
    if (external) return external;

    const products = DEMO_PRODUCTS
      .filter((p) => principal.allowedProductSegments.includes(p.segment))
      .filter((p) => matchesQuery([p.productId, p.name, p.segment, p.riskLevel, p.assetClass], q))
      .slice(0, ps);
    return { ok: true, source: "demo", principal, products, pagination: { pageSize: ps, returned: products.length } };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── MCP 协议处理 ──────────────────────────────────────────────────────────────
function ok(id, result) { return { jsonrpc: "2.0", id: id ?? null, result }; }
function err(id, code, msg) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message: msg } }; }
function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value };
}

async function handleMessage(msg, channelId) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.method === "notifications/initialized") return null;
  try {
    if (msg.method === "initialize") {
      return msg.id === undefined ? null : ok(msg.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "wealth-assistant", version: "1.0.0" },
        instructions: "财富助手工具，按客户经理身份分权返回客户和产品数据。",
      });
    }
    if (msg.method === "tools/list") {
      return msg.id === undefined ? null : ok(msg.id, { tools: TOOLS });
    }
    if (msg.method === "tools/call") {
      const value = await callTool(msg.params?.name, msg.params?.arguments || {}, channelId);
      return msg.id === undefined ? null : ok(msg.id, toolResult(value));
    }
    return msg.id === undefined ? null : err(msg.id, -32601, `Unknown method: ${msg.method}`);
  } catch (e) {
    return msg.id === undefined ? null : err(msg.id, -32000, e?.message || String(e));
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ── HTTP 服务 ─────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: PORT }));
    return;
  }
  if (req.method !== "POST" || !/^\/mcp\/?$/.test(req.url || "")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const channelId = (req.headers["x-jiuwen-channel-id"] || "").trim() || "unknown";

  try {
    const raw = await readBody(req);
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    const response = Array.isArray(parsed)
      ? (await Promise.all(parsed.map((m) => handleMessage(m, channelId)))).filter(Boolean)
      : await handleMessage(parsed, channelId);

    if (!response || (Array.isArray(response) && response.length === 0)) {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Mcp-Session-Id": `wealth-assistant-${channelId}`,
    });
    res.end(JSON.stringify(response));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(err(null, -32000, e?.message || String(e))));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`wealth-assistant-http-mcp listening on http://${HOST}:${PORT}`);
});
