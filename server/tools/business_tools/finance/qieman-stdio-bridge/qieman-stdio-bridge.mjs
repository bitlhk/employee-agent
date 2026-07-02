#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVER_URL = process.env.QIEMAN_MCP_URL || "https://stargate.yingmi.com/mcp/v2";
const CLIENT_VERSION = "openclaw-qieman-stdio-bridge/0.1.0";

const ALLOWED_TOOLS = new Set([
  // 基础与时间
  "GetCurrentTime",

  // 家庭财富规划 / 财务体检 / 目标测算
  "AnalyzeFamilyMembers",
  "AnalyzeIncomeExpense",
  "AnalyzeAssetLiability",
  "AnalyzeFinancialIndicators",
  "AnalyzeCashFlow",
  "GetAssetAllocationPlan",
  "GetCompositeModel",
  "AnalyzeInvestmentPerformance",
  "MonteCarloSimulate",

  // 基金搜索 / 基金分析
  "GuessFundCode",
  "SearchFunds",
  "GetPopularFund",
  "BatchGetFundsDetail",
  "GetBatchFundPerformance",
  "BatchGetFundNavHistory",
  "GetFundDiagnosis",
  "AnalyzeFundRisk",
  "BatchGetFundTradeLimit",
  "BatchGetFundTradeRules",
  "getFundBenchmarkInfo",
  "getFundTurnoverRate",
  "getFundIndustryAllocation",
  "getFundIndustryPreference",
  "getFundIndustryConcentration",
  "getStockAllocationAndMetricsByFundCode",
  "getBondIndicator",
  "getBondFundCreditRatingLevel",
  "getBondFundWithAlertRecord",

  // 基金组合诊断
  "DiagnoseFundPortfolio",
  "GetAssetAllocation",
  "GetFundsCorrelation",
  "GetFundsBackTest",
  "AnalyzePortfolioRisk",
  "GetFundAssetClassAnalysis",
  "GetPortfolioNavHistory",

  // 内容、观点与展示
  "SearchFinancialNews",
  "SearchManagerViewpoint",
  "searchInvestAdvisorContent",
  "SearchHotTopic",
  "searchRealtimeAiAnalysis",
  "RenderEchart",
  "RenderHtmlToPdf",
]);

let cachedTools = null;

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function getApiKey() {
  if (process.env.QIEMAN_API_KEY) return process.env.QIEMAN_API_KEY;
  const cliConfig = readJsonIfExists(join(homedir(), ".yingmi-skill-cli", "config.json"));
  if (cliConfig?.apiKey) return cliConfig.apiKey;
  throw new Error("QIEMAN_API_KEY is not configured and ~/.yingmi-skill-cli/config.json has no apiKey");
}

function parseSseOrJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data: ")) last = line.slice(6);
  }
  if (!last) throw new Error(`Unrecognized Qieman MCP response: ${text.slice(0, 200)}`);
  return JSON.parse(last);
}

async function remoteRequest(method, params, timeoutMs = 60_000) {
  const resp = await fetch(SERVER_URL, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Qieman HTTP ${resp.status}: ${text.slice(0, 300)}`);
  const payload = parseSseOrJson(text);
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  return payload.result;
}

async function initializeRemote() {
  return remoteRequest(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-qieman-stdio-bridge", version: "0.1.0" },
    },
    30_000
  );
}

async function loadTools() {
  if (cachedTools) return cachedTools;
  await initializeRemote();
  const result = await remoteRequest("tools/list", {}, 30_000);
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  cachedTools = tools.filter((tool) => ALLOWED_TOOLS.has(tool.name));
  return cachedTools;
}

async function remoteToolCall(name, args) {
  if (!ALLOWED_TOOLS.has(name)) throw new Error(`Qieman tool is not allowlisted: ${name}`);
  await initializeRemote();
  return remoteRequest(
    "tools/call",
    {
      name,
      arguments: args || {},
      _meta: { clientVersion: CLIENT_VERSION },
    },
    600_000
  );
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message) {
  if (!message || !message.method) return;
  const id = message.id;
  try {
    if (message.method === "initialize") {
      result(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "qieman", version: "0.1.0" },
      });
      return;
    }
    if (message.method === "tools/list") {
      result(id, { tools: await loadTools() });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      result(id, await remoteToolCall(name, args));
      return;
    }
    if (id !== undefined) result(id, {});
  } catch (err) {
    if (id !== undefined) error(id, -32000, err?.message || String(err));
  }
}

let textBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  textBuffer += chunk;
  while (true) {
    const lineEnd = textBuffer.indexOf("\n");
    if (lineEnd < 0) break;
    const line = textBuffer.slice(0, lineEnd).replace(/\r$/, "");
    textBuffer = textBuffer.slice(lineEnd + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch (err) {
      console.error(err?.message || String(err));
    }
  }
});
