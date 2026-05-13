#!/usr/bin/env -S npx tsx
/**
 * check-openclaw-runtime-contract.ts
 *
 * OpenClaw Runtime Contract 1.0 自动化 smoke test
 * 完整契约见 docs/runtime/OPENCLAW_RUNTIME_CONTRACT.md
 *
 * 用途：
 *   - OpenClaw 升级前后跑一次，确认 9 个契约仍然成立
 *   - CI 集成（失败 exit 1）
 *
 * 范围（v1 smoke）：
 *   - C1+C2+C8（RPC liveness）：cron.list 通了 = 握手+鉴权+RPC 都正常
 *   - C3/C4（事件 schema）：从近期 trajectory + sessions.json 被动验证
 *   - C5（HTTP 兼容层）：探测 /v1/chat/completions 端点存活
 *   - C6（sessions.json schema）：读真文件验 sessionKey -> sessionId
 *   - C7（trace.artifacts schema）：读真 trajectory 验 capturedAt/finalStatus/assistantTexts
 *   - C9（thinking 泄漏）：扫近 5 条 assistantTexts，看是否含 <thinking> / <think> 标记
 *
 * 不在 smoke 范围（需 active LLM call）：
 *   - 主动发起 WS chat 验证 lifecycle.end / chat.final 事件 → 走 --full
 *   - 主动发起 HTTP chat 验证 delta / finish_reason / [DONE] → 走 --http
 *
 * 用法：
 *   pnpm tsx scripts/check-openclaw-runtime-contract.ts            # smoke
 *   pnpm tsx scripts/check-openclaw-runtime-contract.ts --json     # JSON 输出
 *   pnpm tsx scripts/check-openclaw-runtime-contract.ts --agent <id>  # 指定 agent 验证（默认自动挑）
 *   pnpm tsx scripts/check-openclaw-runtime-contract.ts --full --agent <id> # 主动 WS full chain
 *   pnpm tsx scripts/check-openclaw-runtime-contract.ts --http --agent <id> # 主动 HTTP full chain
 *   pnpm tsx scripts/check-openclaw-runtime-contract.ts --all --agent <id>  # WS + HTTP 双主动链路
 *
 * 输出：
 *   - stdout 彩色 PASS/FAIL/SKIP
 *   - exit 0 全过；exit 1 任一失败；exit 2 setup 错（如 OpenClaw 不在线）
 */

import { execFileSync } from "child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "crypto";
import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import http from "http";
import { WebSocket } from "ws";

// ────────────── 配置 ──────────────
loadDotenv({ quiet: true });

const REMOTE_HOST = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
const GATEWAY_PORT = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
const GATEWAY_TOKEN = process.env.CLAW_GATEWAY_TOKEN || "";
const OPENCLAW_HOME = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
const AGENTS_DIR = `${OPENCLAW_HOME}/.openclaw/agents`;

const argv = process.argv.slice(2);
const FORMAT_JSON = argv.includes("--json");
const FULL_MODE = argv.includes("--full");
const HTTP_FULL_MODE = argv.includes("--http") || argv.includes("--all");
const ALL_MODE = argv.includes("--all");
const AGENT_OVERRIDE = argv.includes("--agent") ? argv[argv.indexOf("--agent") + 1] : null;

const SCOPES = ["operator.admin", "operator.read", "operator.write"];
const ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const { publicKey: DEVICE_PUBLIC_KEY, privateKey: DEVICE_PRIVATE_KEY } = generateKeyPairSync("ed25519");
const DEVICE_SPKI = DEVICE_PUBLIC_KEY.export({ type: "spki", format: "der" });
const DEVICE_RAW_PUBLIC_KEY = DEVICE_SPKI.subarray(ED25519_PREFIX.length);
const DEVICE_ID = createHash("sha256").update(DEVICE_RAW_PUBLIC_KEY).digest("hex");
const b64u = (b: Buffer) => b.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
const DEVICE_PUBLIC_B64 = b64u(DEVICE_RAW_PUBLIC_KEY);

function signGatewayChallenge(nonce: string) {
  const signedAt = Date.now();
  const payload = ["v2", DEVICE_ID, "openclaw-control-ui", "ui", "operator", SCOPES.join(","), String(signedAt), GATEWAY_TOKEN, nonce].join("|");
  return { signature: b64u(sign(null, Buffer.from(payload, "utf8"), DEVICE_PRIVATE_KEY)), signedAt };
}

// ────────────── 结果 ──────────────
type Status = "pass" | "fail" | "skip";
interface CheckResult {
  contract: string;
  title: string;
  status: Status;
  detail: string;
  err?: string;
}
const results: CheckResult[] = [];

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function log(...args: any[]) { if (!FORMAT_JSON) console.log(...args); }

function record(contract: string, title: string, status: Status, detail: string, err?: string) {
  results.push({ contract, title, status, detail, err });
  if (FORMAT_JSON) return;
  const tag = status === "pass" ? `${GREEN}PASS${RESET}` : status === "fail" ? `${RED}FAIL${RESET}` : `${YELLOW}SKIP${RESET}`;
  console.log(`  ${tag}  [${contract}] ${title}`);
  console.log(`    ${DIM}${detail}${RESET}`);
  if (err) console.log(`    ${RED}${err}${RESET}`);
}

// ────────────── Helper：自动挑一个有数据的 agent ──────────────
function pickTestAgent(): string | null {
  if (AGENT_OVERRIDE) return AGENT_OVERRIDE;
  if (!existsSync(AGENTS_DIR)) return null;
  const candidates = readdirSync(AGENTS_DIR)
    .filter(d => d.startsWith("trial_lgc-"))
    .map(d => {
      const sessionsJson = `${AGENTS_DIR}/${d}/sessions/sessions.json`;
      try {
        const stat = statSync(sessionsJson);
        return { d, mtime: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ d: string; mtime: number }>;
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].d;
}

// ────────────── Check C1+C2+C8: RPC liveness via cron.list ──────────────
function checkRpcLiveness(): void {
  const title = "Gateway RPC 通畅 (handshake+auth+sessions+cron)";
  try {
    const out = execFileSync("openclaw", [
      "gateway", "call", "cron.list",
      "--url", `ws://${REMOTE_HOST}:${GATEWAY_PORT}`,
      "--token", GATEWAY_TOKEN,
      "--params", JSON.stringify({ includeDisabled: true }),
      "--json",
      "--timeout", "10000",
    ], { encoding: "utf-8", timeout: 15000 });
    const parsed = JSON.parse(out);
    // 期待返回 jobs 数组（可空）或 ok 字段
    const jobs = parsed?.jobs ?? parsed?.payload?.jobs ?? null;
    if (Array.isArray(jobs)) {
      record("C1+C2+C8", title, "pass", `cron.list 返回 ${jobs.length} 个 jobs`);
    } else if (parsed?.ok === true) {
      record("C1+C2+C8", title, "pass", `RPC ok=true（响应 schema 已变，cron jobs 字段缺失）`);
    } else {
      record("C1+C2+C8", title, "fail", "cron.list 响应无 jobs 数组也无 ok=true", JSON.stringify(parsed).slice(0, 200));
    }
  } catch (e: any) {
    record("C1+C2+C8", title, "fail", "RPC 调用失败", e?.message || String(e));
  }
}

// ────────────── Check C5: HTTP /v1/chat/completions 端点存活 ──────────────
function checkHttpEndpoint(): Promise<void> {
  const title = "HTTP /v1/chat/completions 端点存活";
  return new Promise((resolve) => {
    const req = http.request({
      hostname: REMOTE_HOST,
      port: GATEWAY_PORT,
      path: "/v1/chat/completions",
      method: "GET",  // 故意 GET（应该 405）来探测端点存在
      timeout: 5000,
    }, (res) => {
      // 端点存在的话应该 405 Method Not Allowed 或 400/401
      if ([400, 401, 403, 404, 405].includes(res.statusCode || 0)) {
        record("C5", title, "pass", `HTTP ${res.statusCode}（端点存在；GET 被拒预期内）`);
      } else if (res.statusCode === 200) {
        record("C5", title, "pass", "HTTP 200（端点存在且响应）");
      } else {
        record("C5", title, "fail", `意外状态码 ${res.statusCode}`);
      }
      res.resume();
      resolve();
    });
    req.on("error", (e) => {
      record("C5", title, "fail", "连接失败", e.message);
      resolve();
    });
    req.on("timeout", () => {
      record("C5", title, "fail", "5s 超时");
      req.destroy();
      resolve();
    });
    req.end();
  });
}

// ────────────── Check C6: sessions.json schema ──────────────
function checkSessionsJson(agentId: string): void {
  const title = `sessions.json schema (sessionKey -> { sessionId })`;
  const path = `${AGENTS_DIR}/${agentId}/sessions/sessions.json`;
  try {
    if (!existsSync(path)) {
      record("C6", title, "skip", `${path} 不存在`);
      return;
    }
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof data !== "object" || data === null) {
      record("C6", title, "fail", "sessions.json 不是对象");
      return;
    }
    const keys = Object.keys(data);
    if (keys.length === 0) {
      record("C6", title, "skip", "sessions.json 空");
      return;
    }
    // 验前 3 个 key 都有 sessionId 字段
    let ok = 0, fail = 0, sample = "";
    for (const k of keys.slice(0, 3)) {
      const entry = data[k];
      if (entry && typeof entry === "object" && typeof entry.sessionId === "string") {
        ok++;
        sample = entry.sessionId;
      } else {
        fail++;
      }
    }
    if (fail === 0) {
      record("C6", title, "pass", `${ok}/3 entry 含 sessionId 字段（sample=${sample.slice(0, 12)}...）`);
    } else {
      record("C6", title, "fail", `${fail}/3 entry 缺 sessionId 字段`);
    }
  } catch (e: any) {
    record("C6", title, "fail", "读取/解析失败", e?.message || String(e));
  }
}

// ────────────── Check C7: trace.artifacts schema + Check C9: thinking 泄漏 ──────────────
function checkTrajectoryAndThinking(agentId: string): void {
  const sessionsDir = `${AGENTS_DIR}/${agentId}/sessions`;
  if (!existsSync(sessionsDir)) {
    record("C7", "trace.artifacts schema", "skip", `${sessionsDir} 不存在`);
    record("C9", "thinking 泄漏", "skip", `${sessionsDir} 不存在`);
    return;
  }
  const trajFiles = readdirSync(sessionsDir)
    .filter(f => f.endsWith(".trajectory.jsonl"))
    .map(f => ({ f, mtime: statSync(`${sessionsDir}/${f}`).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (trajFiles.length === 0) {
    record("C7", "trace.artifacts schema", "skip", "无 trajectory 文件");
    record("C9", "thinking 泄漏", "skip", "无 trajectory 文件");
    return;
  }

  // 找最近一条 trajectory 验 schema
  const trajPath = `${sessionsDir}/${trajFiles[0].f}`;
  const lines = readFileSync(trajPath, "utf-8").split("\n").filter(Boolean);
  let artifactCount = 0;
  let schemaOk = 0;
  let schemaFail = 0;
  let thinkingLeaks = 0;
  let recentArtifacts: any[] = [];

  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e?.type === "trace.artifacts") {
        artifactCount++;
        const data = e?.data;
        const hasCapturedAt = data?.capturedAt !== undefined;
        const hasFinalStatus = typeof data?.finalStatus === "string";
        const hasTexts = Array.isArray(data?.assistantTexts);
        if (hasCapturedAt && hasFinalStatus && hasTexts) {
          schemaOk++;
          recentArtifacts.push(data);
        } else {
          schemaFail++;
        }
      }
    } catch { /* skip malformed line */ }
  }

  // C7
  if (artifactCount === 0) {
    record("C7", "trace.artifacts schema", "skip", `trajectory 中无 trace.artifacts 事件 (${trajFiles[0].f})`);
  } else if (schemaFail > 0) {
    record("C7", "trace.artifacts schema", "fail", `${schemaFail}/${artifactCount} 缺关键字段（capturedAt/finalStatus/assistantTexts）`);
  } else {
    record("C7", "trace.artifacts schema", "pass", `${schemaOk}/${artifactCount} trace.artifacts schema 完整 (${trajFiles[0].f.slice(0, 12)}...)`);
  }

  // C9 — 扫最近 5 条 trace.artifacts 的 assistantTexts，找 <thinking> 泄漏
  const checkSlice = recentArtifacts.slice(-5);
  if (checkSlice.length === 0) {
    record("C9", "thinking 泄漏检测", "skip", "无 trace.artifacts 可扫");
  } else {
    for (const data of checkSlice) {
      for (const t of data.assistantTexts || []) {
        if (typeof t === "string") {
          if (t.includes("<thinking>") || t.includes("<think>") || /^好的[，,].{0,50}让我.{0,30}思考/.test(t)) {
            thinkingLeaks++;
          }
        }
      }
    }
    if (thinkingLeaks > 0) {
      record("C9", "thinking 泄漏检测", "fail", `${thinkingLeaks} 条 assistantText 含 <thinking>/<think> 标记，patch 可能失效`);
    } else {
      const totalTexts = checkSlice.reduce((s, d) => s + (d.assistantTexts?.length || 0), 0);
      record("C9", "thinking 泄漏检测", "pass", `扫描 ${checkSlice.length} 条 artifacts (${totalTexts} 个 assistantText)，无 thinking 泄漏`);
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseTimeMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function findArtifactAfter(agentId: string, sessionKey: string, startMs: number): { sessionId: string; capturedAt: unknown; textCount: number } | null {
  const sessionsJsonPath = `${AGENTS_DIR}/${agentId}/sessions/sessions.json`;
  if (!existsSync(sessionsJsonPath)) return null;
  const sessions = JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
  const sessionId = sessions?.[sessionKey]?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) return null;

  const trajectoryPath = `${AGENTS_DIR}/${agentId}/sessions/${sessionId}.trajectory.jsonl`;
  if (!existsSync(trajectoryPath)) return null;
  const lines = readFileSync(trajectoryPath, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type !== "trace.artifacts") continue;
      const data = event.data || {};
      const capturedMs = parseTimeMs(data.capturedAt);
      if (capturedMs >= startMs && data.finalStatus === "success" && Array.isArray(data.assistantTexts)) {
        if (data.assistantTexts.every((text: unknown) => typeof text === "string")) {
          return { sessionId, capturedAt: data.capturedAt, textCount: data.assistantTexts.length };
        }
      }
    } catch {
      // Ignore malformed historical lines.
    }
  }
  return null;
}

async function pollArtifactAfter(agentId: string, sessionKey: string, startMs: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const artifact = findArtifactAfter(agentId, sessionKey, startMs);
    if (artifact) return artifact;
    await sleep(1000);
  }
  return null;
}

function parseSseDataEvents(buffer: string): string[] {
  const dataEvents: string[] = [];
  for (const block of buffer.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim());
    if (dataLines.length > 0) dataEvents.push(dataLines.join("\n"));
  }
  return dataEvents;
}

function extractHttpContent(delta: any): string {
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
  }
  return "";
}

async function checkFullHttp(agentId: string): Promise<void> {
  const title = "主动 HTTP full chain (/v1/chat/completions -> [DONE] -> trajectory)";
  if (!GATEWAY_TOKEN) {
    record("FULL-HTTP", title, "fail", "CLAW_GATEWAY_TOKEN 为空，无法进行 HTTP 鉴权");
    return;
  }

  const sessionKey = `agent:${agentId}:contract-http:${Date.now()}`;
  const startedAt = Date.now();
  const body = JSON.stringify({
    model: "openclaw",
    stream: true,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  });

  let sawDelta = false;
  let sawReasoning = false;
  let sawDone = false;
  let finishReason: string | null = null;
  let assistantText = "";
  let statusCode = 0;

  await new Promise<void>((resolve) => {
    const req = http.request({
      hostname: REMOTE_HOST,
      port: GATEWAY_PORT,
      path: "/v1/chat/completions",
      method: "POST",
      timeout: 150000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `Bearer ${GATEWAY_TOKEN}`,
        "x-openclaw-agent-id": agentId,
        "x-openclaw-session-key": sessionKey,
      },
    }, (res) => {
      statusCode = res.statusCode || 0;
      let buffer = "";

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || "";
        for (const part of parts) {
          for (const dataStr of parseSseDataEvents(`${part}\n\n`)) {
            if (dataStr === "[DONE]") {
              sawDone = true;
              continue;
            }
            let parsed: any;
            try { parsed = JSON.parse(dataStr); } catch { continue; }
            const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null;
            const delta = choice?.delta || {};
            const content = extractHttpContent(delta);
            const reasoning = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
            if (content) {
              sawDelta = true;
              assistantText += content;
            }
            if (reasoning) sawReasoning = true;
            if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
          }
        }
      });
      res.on("end", resolve);
    });

    req.on("error", (err) => {
      record("FULL-HTTP", title, "fail", "HTTP request error", err.message);
      resolve();
    });
    req.on("timeout", () => {
      record("FULL-HTTP", title, "fail", "150s 超时", JSON.stringify({ sessionKey, sawDelta, sawDone, finishReason }));
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });

  if (statusCode !== 200) {
    record("FULL-HTTP", title, "fail", `HTTP status ${statusCode}`, JSON.stringify({ sessionKey }));
    return;
  }
  if (!sawDelta) {
    record("FULL-HTTP", title, "fail", "未收到 delta.content", JSON.stringify({ sessionKey, sawDone, finishReason }));
    return;
  }
  if (!sawDone) {
    record("FULL-HTTP", title, "fail", "未收到 data: [DONE]", JSON.stringify({ sessionKey, finishReason, assistantText }));
    return;
  }
  if (finishReason !== "stop") {
    record("FULL-HTTP", title, "fail", "finish_reason 不是 stop", JSON.stringify({ sessionKey, finishReason, assistantText }));
    return;
  }

  const artifact = await pollArtifactAfter(agentId, sessionKey, startedAt, 15000);
  if (!artifact) {
    record("FULL-HTTP", title, "fail", "HTTP 完成但 15s 内未找到新 trace.artifacts", JSON.stringify({ sessionKey, sawDelta, sawDone, finishReason }));
    return;
  }

  record(
    "FULL-HTTP",
    title,
    "pass",
    `sessionKey=${sessionKey}; sessionId=${artifact.sessionId.slice(0, 12)}...; finishReason=${finishReason}; assistantChars=${assistantText.length}; reasoning=${sawReasoning}; assistantTexts=${artifact.textCount}`,
  );
}

async function checkFullWs(agentId: string): Promise<void> {
  const title = "主动 WS full chain (connect -> send -> lifecycle.end -> trajectory)";
  if (!GATEWAY_TOKEN) {
    record("FULL-WS", title, "fail", "CLAW_GATEWAY_TOKEN 为空，无法进行 WS 鉴权");
    return;
  }

  const wsUrl = `ws://${REMOTE_HOST}:${GATEWAY_PORT}`;
  const sessionKey = `agent:${agentId}:contract:${Date.now()}`;
  const startedAt = Date.now();
  let sawAssistantDelta = false;
  let sawChatFinal = false;
  let sawLifecycleEnd = false;
  let sessionCreated = false;
  let messageSent = false;

  const connectReqId = randomUUID();
  const createReqId = randomUUID();
  const sendReqId = randomUUID();

  await new Promise<void>((resolve) => {
    const origin = process.env.LINGXIA_INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5180"}`;
    const ws = new WebSocket(wsUrl, { headers: { Origin: origin.replace(/\/+$/, "") } });
    const timer = setTimeout(() => {
      record("FULL-WS", title, "fail", "150s 超时", JSON.stringify({ sessionKey, sawAssistantDelta, sawChatFinal, sawLifecycleEnd, sessionCreated, messageSent }));
      try { ws.close(); } catch {}
      resolve();
    }, 150000);

    const finish = async () => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      const artifact = await pollArtifactAfter(agentId, sessionKey, startedAt, 15000);
      if (!artifact) {
        record("FULL-WS", title, "fail", "WS 完成但 15s 内未找到新 trace.artifacts", JSON.stringify({ sessionKey, sawAssistantDelta, sawChatFinal, sawLifecycleEnd }));
      } else if (!sawAssistantDelta) {
        record("FULL-WS", title, "fail", "未收到 agent/assistant delta", JSON.stringify({ sessionKey, sessionId: artifact.sessionId }));
      } else if (!sawLifecycleEnd) {
        record("FULL-WS", title, "fail", "未收到 agent/lifecycle.end", JSON.stringify({ sessionKey, sessionId: artifact.sessionId }));
      } else {
        record("FULL-WS", title, "pass", `sessionKey=${sessionKey}; sessionId=${artifact.sessionId.slice(0, 12)}...; chatFinal=${sawChatFinal}; assistantTexts=${artifact.textCount}`);
      }
      resolve();
    };

    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.event === "connect.challenge") {
        const nonce = msg.payload?.nonce;
        const { signature, signedAt } = signGatewayChallenge(String(nonce || ""));
        ws.send(JSON.stringify({
          type: "req",
          id: connectReqId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "openclaw-control-ui", version: "1.0.0", platform: "lingxia-contract", mode: "ui" },
            role: "operator",
            scopes: SCOPES,
            auth: { token: GATEWAY_TOKEN },
            device: { id: DEVICE_ID, publicKey: DEVICE_PUBLIC_B64, signature, signedAt, nonce },
            caps: ["tool-events"],
          },
        }));
        return;
      }

      if (msg.type === "res" && msg.id === connectReqId) {
        if (!msg.ok) {
          clearTimeout(timer);
          record("FULL-WS", title, "fail", "connect RPC 失败", JSON.stringify(msg.error || msg).slice(0, 300));
          try { ws.close(); } catch {}
          resolve();
          return;
        }
        ws.send(JSON.stringify({ type: "req", id: createReqId, method: "sessions.create", params: { agentId, key: sessionKey } }));
        return;
      }

      if (msg.type === "res" && msg.id === createReqId) {
        if (!msg.ok) {
          clearTimeout(timer);
          record("FULL-WS", title, "fail", "sessions.create 失败", JSON.stringify(msg.error || msg).slice(0, 300));
          try { ws.close(); } catch {}
          resolve();
          return;
        }
        sessionCreated = true;
        ws.send(JSON.stringify({
          type: "req",
          id: sendReqId,
          method: "sessions.send",
          params: { key: sessionKey, message: "Reply with exactly: pong" },
        }));
        messageSent = true;
        return;
      }

      if (msg.type === "event") {
        const payload = msg.payload || {};
        if (payload.sessionKey && payload.sessionKey !== sessionKey) return;
        if (msg.event === "agent" && payload.stream === "assistant" && typeof payload.data?.delta === "string" && payload.data.delta.length > 0) {
          sawAssistantDelta = true;
        }
        if (msg.event === "chat" && payload.state === "final") {
          sawChatFinal = true;
        }
        if (msg.event === "agent" && payload.stream === "lifecycle" && payload.data?.phase === "end") {
          sawLifecycleEnd = true;
          void finish();
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      record("FULL-WS", title, "fail", "WebSocket error", err.message);
      resolve();
    });
  });

  // Keep the generated contract session for auditability. It uses an isolated
  // sessionKey and does not appear in Lingxia's browser localStorage main chat.
}

// ────────────── Main ──────────────
async function main() {
  log(`\nOpenClaw Runtime Contract 1.0 — Smoke Test`);
  log(`${DIM}Gateway: ws://${REMOTE_HOST}:${GATEWAY_PORT}  |  Home: ${OPENCLAW_HOME}${RESET}\n`);

  // 前置：OpenClaw 必须可达
  try {
    execFileSync("openclaw", ["--version"], { encoding: "utf-8", timeout: 3000 });
  } catch (e: any) {
    console.error(`${RED}FATAL${RESET} OpenClaw 不可达：${e?.message}`);
    if (FORMAT_JSON) console.log(JSON.stringify({ ok: false, fatal: "openclaw_unreachable", err: e?.message }));
    process.exit(2);
  }

  const agent = pickTestAgent();
  if (!agent) {
    console.error(`${RED}FATAL${RESET} 找不到可用 trial agent (尝试 --agent <id>)`);
    if (FORMAT_JSON) console.log(JSON.stringify({ ok: false, fatal: "no_test_agent" }));
    process.exit(2);
  }
  log(`${DIM}Test agent: ${agent}${RESET}\n`);

  // 跑所有 check
  log("[Live RPC]");
  checkRpcLiveness();
  await checkHttpEndpoint();

  log("\n[File system schema]");
  checkSessionsJson(agent);
  checkTrajectoryAndThinking(agent);

  if (FULL_MODE || ALL_MODE) {
    log("\n[Active full chain]");
    await checkFullWs(agent);
  }
  if (HTTP_FULL_MODE) {
    log(FULL_MODE || ALL_MODE ? "\n[Active HTTP chain]" : "\n[Active full chain]");
    await checkFullHttp(agent);
  }

  // 汇总
  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const skipped = results.filter(r => r.status === "skip").length;

  if (FORMAT_JSON) {
    console.log(JSON.stringify({
      ok: failed === 0,
      summary: { passed, failed, skipped },
      agent,
      contractVersion: "1.0",
      mode: ALL_MODE ? "all" : FULL_MODE ? "full" : HTTP_FULL_MODE ? "http" : "smoke",
      results,
    }, null, 2));
  } else {
    log(`\n${DIM}─────────────────────────${RESET}`);
    log(`总计: ${GREEN}${passed} pass${RESET}  ${failed > 0 ? `${RED}${failed} fail${RESET}` : `${DIM}0 fail${RESET}`}  ${YELLOW}${skipped} skip${RESET}`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
