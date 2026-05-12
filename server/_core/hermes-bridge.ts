/**
 * Hermes runtime bridge — translates Linggan's OpenAI-compatible SSE protocol
 * to/from the Hermes HTTP API (see http_api.py in hermes-agent repo).
 *
 * Called from claw-chat.ts when adoptId starts with "lgh-".
 *
 * Protocol translation:
 *   Hermes event                             →  OpenClaw SSE frame
 *   ─────────────────────────────────────────────────────────────────
 *   event:session  data:{session_id}         →  (logged, not forwarded)
 *   data:{type:"delta", text:"..."}          →  data:{choices:[{delta:{content:"..."}}]}
 *   data:{type:"tool_start", tool:"..."}     →  event:hermes_tool_start  (optional, UI may ignore)
 *   data:{type:"tool_complete", tool:"..."}  →  event:hermes_tool_complete
 *   data:{type:"final", text:"..."}          →  (skipped, deltas already accumulated)
 *   data:{type:"error", message:"..."}       →  data:{__stream_error:true, error:"..."}
 *   event:done                               →  data:[DONE] + data:{__stream_end:true}
 *
 * Design:
 *   - Zero impact on OpenClaw (lgc-*) code path: this module is only imported
 *     dynamically from claw-chat.ts when adoptId.startsWith("lgh-").
 *   - Hermes HTTP API is internal only (127.0.0.1:<port>) protected by
 *     HERMES_HTTP_KEY header. Port resolved from claw.hermesPort column.
 *   - Upstream read errors return 502 to the client; session isolation preserved.
 */

import type { Request, Response } from "express";
import * as httpMod from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type HermesClaw = {
  adoptId: string;
  agentId: string;
  userId: number;
  hermesPort?: number | null;
};

const DEFAULT_HERMES_PORT = 8643;

// 前端灵虾模型下拉项 → Hermes custom_provider 名
// OpenClaw gateway 用 "glm5/glm-5.1"；Hermes profile 配成 "huawei-maas" provider。
// 保持 deepseek 不变（Hermes profile 也叫 deepseek）。
// MiniMax 暂无 key，返回 null 让 bridge 回退到默认 provider。
const FRONTEND_TO_HERMES_PROVIDER: Record<string, string> = {
  "glm5": "huawei-maas",
  "maas": "huawei-maas",
  "deepseek": "deepseek",
  // "minimax-portal": 需要 MiniMax API key，暂未配
};

// ── 坑 1 + 坑 3 辅助：每个 adoptId 的"当前 session 基线" ─────────────
// - 坑 1（无记忆）：同一 adoptId 所有请求用同一 session_id，Hermes state.db 会累积 history
// - 坑 3（/new reset）：/new 后把这个 map 的值换掉，下次请求就落到新 session_id
// 2026-04-20 review fix: 持久化到文件，避免 pm2 restart 后 /new 基线丢失、老 session 重接
const APP_ROOT_BRIDGE = process.env.APP_ROOT || process.cwd();
const MARKERS_PATH = `${APP_ROOT_BRIDGE}/data/hermes-session-markers.json`;

function loadMarkers(): Map<string, string> {
  try {
    if (!existsSync(MARKERS_PATH)) return new Map();
    const j = JSON.parse(readFileSync(MARKERS_PATH, "utf8") || "{}");
    return new Map(Object.entries(j).filter(([, v]) => typeof v === "string")) as Map<string, string>;
  } catch {
    return new Map();
  }
}

function saveMarkers() {
  try {
    mkdirSync(dirname(MARKERS_PATH), { recursive: true });
    const obj: Record<string, string> = {};
    newSessionMarkers.forEach((v, k) => { obj[k] = v; });
    writeFileSync(MARKERS_PATH, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("[HERMES-BRIDGE] failed to save session markers:", (e as any)?.message || e);
  }
}

const newSessionMarkers: Map<string, string> = loadMarkers();

function makeSessionId(adoptId: string): string {
  const marker = newSessionMarkers.get(adoptId) || "default";
  return `main-${adoptId}-${marker}`;
}

function mapFrontendModelToHermes(frontendModel?: string): string | null {
  if (!frontendModel || typeof frontendModel !== "string") return null;
  const slash = frontendModel.indexOf("/");
  if (slash < 0) {
    // Bare model name (e.g. "deepseek-chat") — pass through as-is for Hermes default provider
    return frontendModel;
  }
  const fp = frontendModel.slice(0, slash).trim();
  const mm = frontendModel.slice(slash + 1).trim();
  const hermesProvider = FRONTEND_TO_HERMES_PROVIDER[fp];
  if (!hermesProvider) {
    // Unknown frontend provider (e.g. minimax-portal 未配) — fall back to default
    console.warn(`[HERMES-BRIDGE] unknown frontend provider: ${fp} (model=${frontendModel}), fallback to default`);
    return null;
  }
  return `${hermesProvider}/${mm}`;
}

export async function forwardToHermes(
  claw: HermesClaw,
  message: string,
  res: Response,
  opts: { sessionId?: string; model?: string; req?: import("express").Request } = {},
): Promise<void> {
  const port = Number(claw.hermesPort || DEFAULT_HERMES_PORT);
  const key = process.env.HERMES_HTTP_KEY || "";

  // ── 坑 3: /new /reset 语义处理 ────────────────────────────────────
  // 前端主聊天输入 /new 或 /reset 要"换新对话"：
  //   1) 不把这条 msg 发给 LLM（OpenClaw 路径本来也是内部 gateway 消费这条命令）
  //   2) 直接回前端一个短确认消息 + 换下次 session_id 的基线
  // 我们 lgh- 虾用 DB-stored 时间戳或 adoptId 后缀切换 session；这里用 session_id 前缀 "new-"
  // 并返回本次不走 LLM，直接响应确认
  const msgTrim = String(message || "").trim();
  if (msgTrim === "/new" || msgTrim === "/reset") {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "✅ 已开始新对话（Hermes 会保留长期记忆，不过会话上下文已切换）。" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ __stream_end: true })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    // 把"当前 session"标记作废：下次请求自动使用新 main-session-id（见下方 makeSessionId）
    newSessionMarkers.set(claw.adoptId, Date.now().toString(36));
    saveMarkers();  // 2026-04-20 持久化
    return;
  }

  // SSE headers to the linggan client (same as claw-chat.ts openclaw path)
  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
  }
  if (res.socket) res.socket.setNoDelay(true);

  const writeData = (obj: any) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const writeEvent = (event: string, obj: any) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
  };

  // 前端的模型字符串格式："<openclaw_provider>/<model>"（如 glm5/glm-5.1）
  // 翻译到 Hermes profile 中配置的 custom_provider（如 huawei-maas/glm-5.1）
  // Hermes http_api.py 收到 "provider/model" 会自动路由到对应 custom_provider
  const mappedModel = mapFrontendModelToHermes(opts.model);
  // ── 坑 1 修复：session_id 固定到 adoptId 级别（而不是每请求 timestamp）
  // 让 Hermes state.db 的 conversation history 跨请求累积，
  // skill 自进化 / 长记忆才有基础数据
  const sessionId = opts.sessionId || makeSessionId(claw.adoptId);
  const body = JSON.stringify({
    message,
    session_id: sessionId,
    ...(mappedModel ? { model: mappedModel } : {}),
  });

  const reqOpts: httpMod.RequestOptions = {
    hostname: "127.0.0.1",
    port,
    path: "/chat/stream",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body).toString(),
      ...(key ? { "X-Internal-Key": key } : {}),
    },
  };

  // Keepalive every 8s to prevent nginx/LB idle timeout (matches openclaw path).
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, 8000);

  await new Promise<void>((resolve) => {
    let doneEmitted = false;
    const emitDone = () => {
      if (doneEmitted) return;
      doneEmitted = true;
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ __stream_end: true })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    };

    const proxyReq = httpMod.request(reqOpts, (proxyRes) => {
      if ((proxyRes.statusCode || 0) >= 400) {
        writeData({
          __stream_error: true,
          error: `hermes upstream ${proxyRes.statusCode}`,
        });
        emitDone();
        clearInterval(keepalive);
        proxyRes.resume();
        resolve();
        return;
      }

      // Parse upstream SSE line-by-line.
      let buffer = "";
      let accumulated = "";
      let currentEvent = ""; // track "event:" line for next data: frame

      proxyRes.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        // SSE frames are \n\n-separated, but we process line-by-line to be safe.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, "");

          if (line === "") {
            // blank line separates frames; reset currentEvent after frame
            currentEvent = "";
            continue;
          }

          if (line.startsWith(":")) {
            // comment (hermes keepalive) — ignore
            continue;
          }

          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith("data: ")) continue;

          const dataStr = line.slice(6).trim();

          // "event: done" + "data: [DONE]" → emit OpenClaw terminator
          if (dataStr === "[DONE]") {
            emitDone();
            currentEvent = "";
            continue;
          }

          // "event: session" → log only
          if (currentEvent === "session") {
            try {
              const obj = JSON.parse(dataStr);
              console.log(`[HERMES-BRIDGE] adopt=${claw.adoptId} session=${obj.session_id}`);
            } catch {}
            currentEvent = "";
            continue;
          }

          // regular data frames: parse and translate
          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          switch (parsed?.type) {
            case "delta": {
              const text = String(parsed.text || "");
              if (text) {
                accumulated += text;
                // OpenAI chat-completions compatible frame
                writeData({
                  choices: [{ delta: { content: text } }],
                });
              }
              break;
            }
            case "tool_start": {
              // Optional event; frontend may ignore but preserve for visibility.
              writeEvent("hermes_tool_start", {
                tool: String(parsed.tool || ""),
                args_preview: String(parsed.args_preview || ""),
              });
              break;
            }
            case "tool_complete": {
              writeEvent("hermes_tool_complete", {
                tool: String(parsed.tool || ""),
              });
              break;
            }
            case "final": {
              // Deltas already accumulated; emit a finish signal so frontend
              // knows the LLM has stopped producing content.
              writeData({
                choices: [{ delta: {}, finish_reason: "stop" }],
              });
              break;
            }
            case "error": {
              writeData({
                __stream_error: true,
                error: String(parsed.message || "hermes runtime error"),
              });
              break;
            }
            default:
              // Unknown event type — forward raw for debugging.
              writeData({ __hermes_raw: parsed });
          }
        }
      });

      proxyRes.on("end", () => {
        // Fallback: if upstream closed without emitting [DONE], finalize here.
        emitDone();
        clearInterval(keepalive);
        resolve();
      });

      proxyRes.on("error", (err) => {
        console.error(`[HERMES-BRIDGE] upstream error adopt=${claw.adoptId}:`, err);
        if (!doneEmitted && !res.writableEnded) {
          writeData({ __stream_error: true, error: `hermes upstream read error: ${err.message}` });
        }
        emitDone();
        clearInterval(keepalive);
        resolve();
      });
    });

    proxyReq.setTimeout(300_000, () => {
      proxyReq.destroy(new Error("hermes_bridge_timeout"));
    });

    proxyReq.on("error", (err) => {
      console.error(`[HERMES-BRIDGE] request error adopt=${claw.adoptId}:`, err);
      if (!doneEmitted && !res.writableEnded) {
        writeData({
          __stream_error: true,
          error: `hermes bridge connect failed (port ${port}): ${err.message}`,
        });
      }
      emitDone();
      clearInterval(keepalive);
      resolve();
    });

    // ── 坑 2 修复：前端 abort（AbortController.abort()）时断掉 upstream ───
    // 对应 claw-chat.ts:716 OpenClaw 路径的 req.on("close") → proxyReq.destroy()
    // 不监听 abort 的话 Hermes 会继续消耗 token 和线程
    if (opts.req) {
      opts.req.on("close", () => {
        if (!doneEmitted) {
          console.log(`[HERMES-BRIDGE] client abort, destroy upstream adopt=${claw.adoptId}`);
          proxyReq.destroy(new Error("client_aborted"));
        }
      });
    }

    proxyReq.write(body);
    proxyReq.end();
  });
}
