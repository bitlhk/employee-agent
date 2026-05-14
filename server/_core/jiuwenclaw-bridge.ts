import type { Request, Response } from "express";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { WebSocket, type RawData } from "ws";
import {
  appendLogAsync,
  buildSessionRegistryScope,
  bumpSessionEpoch,
  lookupSessionRegistry,
  normalizeConversationId,
  normalizeSessionChannel,
  normalizeSessionPart,
  readSessionEpoch,
  resolveRuntimeWorkspace,
  upsertSessionRegistry,
} from "./helpers";

export type JiuwenClawRuntimeClaw = {
  adoptId: string;
  agentId: string;
  userId: number;
};

type ForwardOptions = {
  model?: string;
  req?: Request;
  channel?: unknown;
  conversationId?: unknown;
  epochLabel?: unknown;
  clientRunId?: string | null;
  runtimeMode?: unknown;
};

const DEFAULT_AGENTSERVER_WS_URL = "ws://127.0.0.1:18092";
const DEFAULT_SERVICE_ID = "linggan";

function runtimeEnabled(): boolean {
  return String(process.env.JIUWENCLAW_RUNTIME_ENABLED || "").toLowerCase() === "true";
}

export function isJiuwenClawRuntimeEnabled(): boolean {
  return runtimeEnabled();
}

function sanitizeRuntimeId(value: unknown, fallback: string, maxLen = 96): string {
  const normalized = normalizeSessionPart(value, maxLen).replace(/:/g, "_").toLowerCase();
  return normalized || fallback;
}

function buildServiceId(): string {
  return sanitizeRuntimeId(process.env.JIUWENCLAW_SERVICE_ID || DEFAULT_SERVICE_ID, DEFAULT_SERVICE_ID, 64);
}

function buildAgentId(claw: JiuwenClawRuntimeClaw): string {
  const configured = process.env.JIUWENCLAW_AGENT_ID_OVERRIDE;
  if (configured) return sanitizeRuntimeId(configured, `jiuwen_${claw.adoptId}`, 96);
  return sanitizeRuntimeId(claw.agentId || `jiuwen_${claw.adoptId}`, `jiuwen_${claw.adoptId}`, 96);
}

function buildSessionId(claw: JiuwenClawRuntimeClaw, agentId: string, opts: ForwardOptions): string {
  const epoch = readSessionEpoch(claw.adoptId);
  const scope = buildSessionRegistryScope(opts.channel, opts.conversationId);
  const found = lookupSessionRegistry(claw.adoptId, agentId, epoch, scope);
  if (found) return found;

  const channel = normalizeSessionChannel(opts.channel);
  const conversationId = normalizeConversationId(opts.conversationId);
  const epochLabel = normalizeSessionPart(opts.epochLabel, 48);
  const scopePart = channel !== "main" && conversationId ? `${channel}_${conversationId}` : "main";
  const suffix = epochLabel || (epoch > 0 ? `e${epoch}` : "default");
  const sessionId = sanitizeRuntimeId(`sess_${claw.adoptId}_${scopePart}_${suffix}`, "sess_default", 160);
  upsertSessionRegistry(claw.adoptId, agentId, sessionId, epoch, scope);
  return sessionId;
}

function jiuwenChannelFromOption(value: unknown): string {
  const channel = normalizeSessionChannel(value);
  if (channel === "weixin" || channel === "wechat") return "wechat";
  if (channel === "wecom") return "wecom";
  if (channel === "feishu") return "feishu";
  if (channel === "xiaoyi") return "xiaoyi";
  if (channel === "dingtalk") return "dingtalk";
  return "web";
}

function wsOriginFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const protocol = url.protocol === "wss:" ? "https:" : "http:";
    return `${protocol}//${url.host}`;
  } catch {
    return "http://127.0.0.1";
  }
}

function initSse(res: Response): void {
  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
  }
  if (res.socket) res.socket.setNoDelay(true);
}

function parseJsonFrame(raw: RawData): any | null {
  try {
    const text = Array.isArray(raw)
      ? Buffer.concat(raw).toString("utf8")
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : String(raw);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const obj = value as any;
  for (const key of ["content", "text", "message", "delta"]) {
    if (typeof obj[key] === "string") return obj[key];
  }
  return "";
}

function pickErrorMessage(frame: any): string {
  const body = frame?.body || {};
  return String(
    body?.message
      || body?.error
      || body?.details?.message
      || body?.details?.error
      || frame?.message
      || "jiuwenclaw runtime error"
  ).slice(0, 1000);
}

function collectRecentWorkspaceFiles(workspaceDir: string, sinceMs: number): Array<{ name: string; size: number; path: string }> {
  if (!workspaceDir || !existsSync(workspaceDir)) return [];
  const skipDirs = new Set(["skills", "memory", "node_modules", ".git", ".dreams", "dist", "build", ".openclaw", ".agent_history"]);
  const files: Array<{ name: string; size: number; path: string }> = [];

  const scanDir = (dir: string, relBase: string, depth: number) => {
    if (depth > 3) return;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".")) continue;
        if (depth === 0 && skipDirs.has(entry)) continue;
        const full = `${dir}/${entry}`;
        const rel = relBase ? `${relBase}/${entry}` : entry;
        try {
          const st = statSync(full);
          if (st.isFile()) {
            if (st.mtimeMs >= sinceMs - 1000) files.push({ name: entry, size: st.size, path: rel });
          } else if (st.isDirectory()) {
            scanDir(full, rel, depth + 1);
          }
        } catch {}
      }
    } catch {}
  };

  scanDir(workspaceDir, "", 0);
  return files.sort((a, b) => b.path.localeCompare(a.path));
}

function sanitizeWorkspaceRelativePath(raw: unknown): string | null {
  const text = String(raw || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!text) return null;
  const parts = text.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

function normalizeWorkspaceFilePayload(file: any, workspaceDir: string): { name: string; size: number; path: string } | null {
  const rawPath = String(file?.path || file?.file_path || file?.full_path || file?.filepath || "").trim();
  let relPath: string | null = null;

  if (rawPath) {
    if (path.isAbsolute(rawPath)) {
      const workspaceRoot = path.resolve(workspaceDir);
      const absPath = path.resolve(rawPath);
      const rel = path.relative(workspaceRoot, absPath);
      if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") return null;
      relPath = rel.split(path.sep).join("/");
    } else {
      relPath = sanitizeWorkspaceRelativePath(rawPath);
    }
  }

  if (!relPath) return null;
  const absFile = path.join(workspaceDir, relPath);
  let size = Number(file?.size || 0);
  try {
    const st = statSync(absFile);
    if (!st.isFile()) return null;
    size = st.size;
  } catch {}

  const name = String(file?.name || path.basename(relPath)).trim() || path.basename(relPath);
  return { name, size, path: relPath };
}

function normalizeJiuwenFileEvent(delta: any, workspaceDir: string): Array<{ name: string; size: number; path: string }> {
  const candidates = Array.isArray(delta?.files)
    ? delta.files
    : Array.isArray(delta?.file_list)
      ? delta.file_list
      : delta?.file
        ? [delta.file]
        : delta?.path
          ? [delta]
          : [];
  const files: Array<{ name: string; size: number; path: string }> = [];
  for (const candidate of candidates) {
    const normalized = normalizeWorkspaceFilePayload(candidate, workspaceDir);
    if (normalized) files.push(normalized);
  }
  return files;
}

function normalizeJiuwenMode(value: unknown): "agent.fast" | "agent.plan" | "team" {
  return "agent.fast";
}

function buildChatRequest(args: {
  requestId: string;
  serviceId: string;
  agentId: string;
  sessionId: string;
  channelId: string;
  message: string;
  workspaceDir: string;
  model?: string;
  runtimeMode?: unknown;
}) {
  const mode = normalizeJiuwenMode(args.runtimeMode || process.env.JIUWENCLAW_DEFAULT_MODE);
  return {
    protocol_version: "1.0",
    request_id: args.requestId,
    timestamp: new Date().toISOString(),
    identity_origin: "user",
    channel: args.channelId,
    channel_context: {
      effective_project_dir: args.workspaceDir,
      cwd: args.workspaceDir,
      source_channel: args.channelId,
    },
    method: "chat.send",
    is_stream: true,
    service_id: args.serviceId,
    agent_id: args.agentId,
    session_id: args.sessionId,
    params: {
      service_id: args.serviceId,
      agent_id: args.agentId,
      session_id: args.sessionId,
      query: args.message,
      content: args.message,
      project_dir: args.workspaceDir,
      interactive_ask: true,
      request_metadata: {
        effective_project_dir: args.workspaceDir,
        source_channel: args.channelId,
      },
      mode,
      ...(args.model ? { model_name: args.model } : {}),
    },
  };
}

export async function forwardToJiuwenClaw(
  claw: JiuwenClawRuntimeClaw,
  message: string,
  res: Response,
  opts: ForwardOptions = {},
): Promise<void> {
  if (!runtimeEnabled()) {
    res.status(503).json({ error: "jiuwenclaw runtime is disabled" });
    return;
  }

  const msgTrim = String(message || "").trim();
  initSse(res);

  const writeData = (obj: any) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const writeEvent = (event: string, obj: any) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
  };

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

  if (msgTrim === "/new" || msgTrim === "/reset") {
    const epoch = bumpSessionEpoch(claw.adoptId);
    writeData({
      choices: [{
        delta: { content: `已开始新对话。` },
        index: 0,
      }],
    });
    writeData({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }] });
    appendLogAsync("jiuwenclaw-exec.log", {
      ts: new Date().toISOString(),
      event: "session_reset",
      adoptId: claw.adoptId,
      agentId: claw.agentId,
      userId: claw.userId,
      epoch,
    });
    emitDone();
    return;
  }

  const wsUrl = String(process.env.JIUWENCLAW_AGENTSERVER_WS_URL || DEFAULT_AGENTSERVER_WS_URL);
  const serviceId = buildServiceId();
  const agentId = buildAgentId(claw);
  const sessionId = buildSessionId(claw, agentId, opts);
  const channelId = jiuwenChannelFromOption(opts.channel);
  const workspaceDir = resolveRuntimeWorkspace(claw, claw.adoptId);
  const startedAt = Date.now();
  const requestId = `linggan-jiuwen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const requestPayload = buildChatRequest({
    requestId,
    serviceId,
    agentId,
    sessionId,
    channelId,
    message,
    workspaceDir,
    model: opts.model,
    runtimeMode: opts.runtimeMode,
  });

  appendLogAsync("jiuwenclaw-exec.log", {
    ts: new Date().toISOString(),
    event: "chat_stream_request",
    adoptId: claw.adoptId,
    agentId,
    serviceId,
    sessionId,
    channelId,
    userId: claw.userId,
    clientRunId: opts.clientRunId || "",
    mode: requestPayload.params?.mode || "",
    message: String(message || "").slice(0, 500),
  });

  const maxRunMs = Math.max(30_000, Number(process.env.JIUWENCLAW_CHAT_TIMEOUT_MS || 180_000) || 180_000);

  await new Promise<void>((resolve) => {
    let settled = false;
    let requestSent = false;
    let sawText = false;
    let clientClosed = false;
    let ackFallbackTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    const emittedWorkspaceFilePaths = new Set<string>();

    const logEnd = (event: string, extra: Record<string, unknown> = {}) => {
      appendLogAsync("jiuwenclaw-exec.log", {
        ts: new Date().toISOString(),
        event,
        adoptId: claw.adoptId,
        agentId,
        serviceId,
        sessionId,
        channelId,
        userId: claw.userId,
        clientRunId: opts.clientRunId || "",
        mode: requestPayload.params?.mode || "",
        requestId,
        durationMs: Date.now() - startedAt,
        ...extra,
      });
    };
    const writeStatus = (label: string) => {
      writeData({
        __status: label,
        kind: "heartbeat",
        tool: "jiuwenclaw",
        elapsedMs: Date.now() - startedAt,
      });
    };
    const keepalive = setInterval(() => {
      if (res.writableEnded) return;
      writeStatus("JiuwenClaw 仍在处理...");
      res.flush?.();
    }, 10_000);
    const cleanup = () => {
      if (ackFallbackTimer) clearTimeout(ackFallbackTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      clearInterval(keepalive);
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: string) => {
      logEnd("chat_stream_failed", { error: error.slice(0, 1000) });
      writeData({ __stream_error: true, error });
      emitDone();
      settle();
    };
    const complete = () => {
      const recentFiles = collectRecentWorkspaceFiles(workspaceDir, startedAt)
        .filter((file) => !emittedWorkspaceFilePaths.has(file.path));
      if (recentFiles.length > 0) {
        writeEvent("workspace_files", { adoptId: claw.adoptId, files: recentFiles });
      }
      writeData({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }] });
      emitDone();
      logEnd("chat_stream_complete", {
        recentFiles: recentFiles.length,
        sawText,
      });
      settle();
    };
    const sendRequest = (ws: WebSocket) => {
      if (requestSent || ws.readyState !== WebSocket.OPEN) return;
      requestSent = true;
      ws.send(JSON.stringify(requestPayload));
    };

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: process.env.JIUWENCLAW_WS_ORIGIN || wsOriginFromUrl(wsUrl),
      },
    });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      const seconds = Math.round(maxRunMs / 1000);
      const error = `JiuwenClaw 本次任务执行超过 ${seconds} 秒，已停止以避免连接超时。请缩小问题范围，或切换“快速”模式后重试。`;
      try { ws.close(1000, "timeout"); } catch {}
      fail(error);
    }, maxRunMs);

    const onClientClose = () => {
      if (res.writableEnded || settled) return;
      clientClosed = true;
      logEnd("chat_stream_client_closed");
      try { ws.close(1000, "client closed"); } catch {}
      settle();
    };
    res.on("close", onClientClose);

    ws.on("open", () => {
      ackFallbackTimer = setTimeout(() => sendRequest(ws), 2000);
    });

    ws.on("message", (raw) => {
      const frame = parseJsonFrame(raw);
      if (!frame) return;

      if (frame?.event === "connection.ack") {
        sendRequest(ws);
        return;
      }

      const frameRequestId = String(frame?.request_id || frame?.response_id || "");
      if (frameRequestId && frameRequestId !== requestId) return;

      const kind = String(frame?.response_kind || frame?.event || "");
      const status = String(frame?.status || "");
      const body = frame?.body || {};

      if (status === "failed" || kind === "e2a.error" || kind.endsWith(".error")) {
        fail(pickErrorMessage(frame));
        try { ws.close(1000, "failed"); } catch {}
        return;
      }

      if (kind === "e2a.chunk") {
        if (body?.delta_kind === "text") {
          const text = pickText(body?.delta);
          if (text) {
            sawText = true;
            writeData({ choices: [{ delta: { content: text }, index: 0 }] });
          }
          return;
        }
        if (body?.delta_kind === "reasoning") {
          const reasoning = pickText(body?.delta);
          if (reasoning) writeData({ choices: [{ delta: { reasoning_content: reasoning }, index: 0 }] });
          return;
        }
        if (body?.delta_kind === "custom") {
          const eventType = String(body?.event_type || body?.delta?.event_type || "jiuwen.event");
          const text = pickText(body?.delta);
          if (eventType === "chat.delta" && text) {
            sawText = true;
            writeData({ choices: [{ delta: { content: text }, index: 0 }] });
            return;
          }
          if (eventType === "chat.reasoning" && text) {
            writeData({ choices: [{ delta: { reasoning_content: text }, index: 0 }] });
            return;
          }
          if (eventType === "chat.final") {
            if (text && !sawText) writeData({ choices: [{ delta: { content: text }, index: 0 }] });
            complete();
            try { ws.close(1000, "complete"); } catch {}
            return;
          }
          if (eventType === "chat.error") {
            fail(text || pickErrorMessage(frame));
            try { ws.close(1000, "failed"); } catch {}
            return;
          }
          if (eventType === "chat.file" || eventType === "chat.media") {
            const files = normalizeJiuwenFileEvent(body?.delta, workspaceDir);
            if (files.length > 0) {
              for (const file of files) emittedWorkspaceFilePaths.add(file.path);
              writeEvent("workspace_files", { adoptId: claw.adoptId, files });
            }
            return;
          }
          writeEvent("jiuwen_event", {
            event_type: eventType,
            delta: body?.delta ?? null,
          });
          return;
        }
      }

      if (frame?.is_final || kind === "e2a.complete") {
        const finalText = pickText(body?.result || body);
        if (finalText && !sawText) writeData({ choices: [{ delta: { content: finalText }, index: 0 }] });
        complete();
        try { ws.close(1000, "complete"); } catch {}
      }
    });

    ws.on("error", (err) => {
      if (clientClosed || settled) return;
      fail(String((err as any)?.message || err || "jiuwenclaw websocket error").slice(0, 1000));
    });

    ws.on("close", () => {
      res.off("close", onClientClose);
      if (clientClosed || settled) return;
      if (doneEmitted) {
        settle();
        return;
      }
      fail("jiuwenclaw upstream closed before completion");
    });
  });
}
