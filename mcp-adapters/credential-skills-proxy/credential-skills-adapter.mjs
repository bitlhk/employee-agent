#!/usr/bin/env node
/**
 * credential-skills-adapter.mjs — 凭证技能 MCP 本机 Adapter（模式B）
 * 端口 17896。职责：
 *  1. 转发 /mcp 到上游凭证技能服务，自动注入 Bearer Token（密钥不进 openclaw.json）
 *  2. 协议清洗：上游成功响应携带非法的 "error": null（违反 JSON-RPC 2.0 互斥规则，
 *     会被 OpenClaw 官方 MCP SDK 严格校验拒收）→ 在此剥除。
 *     上游修复后本清洗逻辑自然空转，可保留。
 *  3. 透传用户上下文头 x-jiuwen-channel-id / x-openclaw-agent-id
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = join(__dirname, "credential-skills-adapter.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
loadLocalEnv();

const HOST = process.env.CRED_ADAPTER_HOST || "127.0.0.1";
const PORT = Number(process.env.CRED_ADAPTER_PORT || 17896);
const UPSTREAM = (process.env.CRED_UPSTREAM_URL || "http://1.92.221.155:8005").replace(/\/+$/, "");
const TOKEN = process.env.CRED_UPSTREAM_TOKEN || "";

// 递归剥除 JSON-RPC 消息中非法的 error:null（含批量响应）
function sanitize(msg) {
  if (Array.isArray(msg)) return msg.map(sanitize);
  if (msg && typeof msg === "object") {
    if ("result" in msg && msg.error === null) delete msg.error;
    if (msg.error === null && !("result" in msg)) delete msg.error;
  }
  return msg;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    let upstream = "unknown";
    try {
      const r = await fetch(`${UPSTREAM}/health`, { signal: AbortSignal.timeout(5000) });
      upstream = r.ok ? "ok" : `http ${r.status}`;
    } catch (e) { upstream = "unreachable"; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "credential-skills-adapter", port: PORT, upstream }));
    return;
  }
  if (req.method !== "POST" || !/^\/mcp\/?$/.test(req.url || "")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    const raw = await readBody(req);
    const headers = { "content-type": "application/json" };
    if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
    for (const h of ["x-jiuwen-channel-id", "x-openclaw-agent-id"]) {
      if (req.headers[h]) headers[h] = String(req.headers[h]);
    }
    const upstreamResp = await fetch(`${UPSTREAM}/mcp`, {
      method: "POST",
      headers,
      body: raw,
      signal: AbortSignal.timeout(120_000),
    });
    const text = await upstreamResp.text();
    let body = text;
    try {
      body = JSON.stringify(sanitize(JSON.parse(text)));
    } catch { /* 非 JSON（如 202 空体）原样透传 */ }
    res.writeHead(upstreamResp.status, { "Content-Type": "application/json" });
    res.end(body || "{}");
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `adapter upstream error: ${e?.message || e}` } }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`credential-skills-adapter listening on http://${HOST}:${PORT} → ${UPSTREAM}`);
});
