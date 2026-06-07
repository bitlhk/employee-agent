import express from "express";
import http from "http";
import bcrypt from "bcryptjs";
import path from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { getUserByEmail, getUserById } from "../db";
import { sdk } from "./sdk";
import { openClawAgentDir } from "./helpers";

type DesktopUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  accessLevel?: string | null;
};

type DesktopSessionSummary = {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  searchText: string;
  startedAt: number;
  updatedAt: number;
  source: string;
  messageCount: number;
  model: string;
};

type DesktopHistoryItem =
  | { kind: "user"; id: number; content: string; timestamp: number }
  | { kind: "assistant"; id: number; content: string; timestamp: number };

function publicBaseUrl(req: express.Request): string {
  const proto =
    String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() ||
    req.protocol ||
    "http";
  const host = req.get("host") || `127.0.0.1:${process.env.PORT || "5000"}`;
  return `${proto}://${host}`;
}

function desktopToken(): string {
  return (
    process.env.DESKTOP_GATEWAY_TOKEN ||
    process.env.INTERNAL_API_KEY ||
    "desktop-mvp-token"
  );
}

function defaultDesktopAgentId(): string {
  return process.env.DESKTOP_OPENCLAW_AGENT_ID || "trial_lgc-ppstsl9ddr";
}

function bearerToken(req: express.Request): string {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: unknown, max = 48): string {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function toUnixSeconds(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
  }
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
  return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
}

function textFromOpenClawContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(item => textFromOpenClawContent(item))
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    const type = String(obj.type || "");
    if (type === "tool_use" || type === "tool_result") return "";
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.content)) return textFromOpenClawContent(obj.content);
    if (typeof obj.output_text === "string") return obj.output_text;
  }
  return "";
}

function parseDesktopSessionKey(
  sessionKey: string,
  runtimeAgentId: string
): { id: string; channel: string } | null {
  const parts = String(sessionKey || "").split(":");
  if (parts[0] !== "agent" || parts[1] !== runtimeAgentId) return null;
  const channel = parts[2] || "";
  if (channel !== "main" && channel !== "web") return null;
  const id = parts[3] || "";
  if (!id) return null;
  return { id, channel };
}

function safeSessionFile(sessionsDir: string, raw: any): string | null {
  const sessionId = String(raw?.sessionId || "").trim();
  const fallback = sessionId
    ? path.join(sessionsDir, `${sessionId}.jsonl`)
    : "";
  const candidate = String(raw?.sessionFile || fallback || "").trim();
  if (!candidate) return null;
  const root = path.resolve(sessionsDir);
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(root + path.sep)) return null;
  return existsSync(resolved) ? resolved : null;
}

function readDesktopSessionMessagesFromFile(
  sessionFile: string
): DesktopHistoryItem[] {
  const items: DesktopHistoryItem[] = [];
  if (!sessionFile || !existsSync(sessionFile)) return items;
  const lines = readFileSync(sessionFile, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== "message") continue;
    const role = String(event?.message?.role || "");
    if (role !== "user" && role !== "assistant") continue;
    const content = normalizeText(
      textFromOpenClawContent(event?.message?.content)
    );
    if (!content) continue;
    const timestamp = toUnixSeconds(
      event?.message?.timestamp || event?.timestamp
    );
    items.push({
      kind: role === "user" ? "user" : "assistant",
      id: items.length + 1,
      content,
      timestamp,
    });
  }
  return items;
}

function readDesktopSessions(limit = 50): DesktopSessionSummary[] {
  const runtimeAgentId = defaultDesktopAgentId();
  const sessionsDir = path.join(openClawAgentDir(runtimeAgentId), "sessions");
  const sessionsPath = path.join(sessionsDir, "sessions.json");
  if (!existsSync(sessionsPath)) return [];

  let rawIndex: Record<string, any> = {};
  try {
    rawIndex = JSON.parse(readFileSync(sessionsPath, "utf8") || "{}") || {};
  } catch {
    return [];
  }

  const summaries: DesktopSessionSummary[] = [];
  for (const [sessionKey, raw] of Object.entries(rawIndex)) {
    const parsed = parseDesktopSessionKey(sessionKey, runtimeAgentId);
    if (!parsed) continue;
    const sessionFile = safeSessionFile(sessionsDir, raw);
    if (!sessionFile) continue;
    const messages = readDesktopSessionMessagesFromFile(sessionFile);
    if (messages.length === 0) continue;

    const firstUser = messages.find(item => item.kind === "user");
    const lastMessage = [...messages]
      .reverse()
      .find(item => normalizeText(item.content));
    const fileStats = statSync(sessionFile);
    const updatedAt = toUnixSeconds(
      raw?.updatedAt ||
        raw?.lastInteractionAt ||
        raw?.endedAt ||
        lastMessage?.timestamp ||
        fileStats.mtimeMs
    );
    const startedAt = toUnixSeconds(
      raw?.sessionStartedAt ||
        raw?.startedAt ||
        raw?.createdAt ||
        fileStats.birthtimeMs
    );
    summaries.push({
      id: parsed.id,
      sessionKey,
      title: truncateText(firstUser?.content, 50) || "新对话",
      preview: truncateText(lastMessage?.content, 80),
      searchText: normalizeText(
        messages.map(item => item.content).join(" ")
      ).slice(0, 12000),
      startedAt,
      updatedAt,
      source: parsed.channel === "main" ? "OpenClaw Desktop" : "OpenClaw Web",
      messageCount: messages.length,
      model: "openclaw",
    });
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

function findDesktopSession(sessionIdOrKey: string): {
  summary: DesktopSessionSummary;
  sessionFile: string;
} | null {
  const runtimeAgentId = defaultDesktopAgentId();
  const sessionsDir = path.join(openClawAgentDir(runtimeAgentId), "sessions");
  const sessionsPath = path.join(sessionsDir, "sessions.json");
  if (!existsSync(sessionsPath)) return null;
  let rawIndex: Record<string, any> = {};
  try {
    rawIndex = JSON.parse(readFileSync(sessionsPath, "utf8") || "{}") || {};
  } catch {
    return null;
  }
  const wanted = String(sessionIdOrKey || "").trim();
  for (const [sessionKey, raw] of Object.entries(rawIndex)) {
    const parsed = parseDesktopSessionKey(sessionKey, runtimeAgentId);
    if (!parsed) continue;
    if (wanted !== sessionKey && wanted !== parsed.id) continue;
    const sessionFile = safeSessionFile(sessionsDir, raw);
    if (!sessionFile) return null;
    const summary = readDesktopSessions(500).find(
      entry => entry.sessionKey === sessionKey
    );
    if (!summary) return null;
    return { summary, sessionFile };
  }
  return null;
}

async function authenticateDesktopRequest(
  req: express.Request
): Promise<DesktopUser | null> {
  const token = bearerToken(req);
  if (!token) return null;

  // Backward-compatible MVP token for local smoke tests only. Real desktop
  // clients should use /api/desktop/login and send the returned user session.
  if (token === desktopToken()) {
    return { id: "desktop-mvp-user", name: "Desktop MVP User" };
  }

  const session = await sdk.verifySession(token);
  if (!session?.userId) return null;
  const user = await getUserById(session.userId);
  if (!user) return null;
  return {
    id: String(user.id),
    name: user.name || user.email || session.name || "用户",
    email: user.email,
    role: user.role,
    accessLevel: (user as any).accessLevel || "public_only",
  };
}

async function requireDesktopUser(
  req: express.Request,
  res: express.Response
): Promise<DesktopUser | null> {
  const user = await authenticateDesktopRequest(req);
  if (user) return user;
  res.status(401).json({ error: "Unauthorized" });
  return null;
}

async function forwardOpenClawChat(
  req: express.Request,
  res: express.Response
) {
  const user = await requireDesktopUser(req, res);
  if (!user) return;

  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  if (!gatewayToken) {
    res.status(500).json({ error: "CLAW_GATEWAY_TOKEN is not configured" });
    return;
  }

  const body = JSON.stringify(req.body || {});
  const runtimeAgentId =
    String(req.headers["x-openclaw-agent-id"] || "").trim() ||
    defaultDesktopAgentId();
  const sessionKey =
    String(req.headers["x-openclaw-session-key"] || "").trim() ||
    `agent:${runtimeAgentId}:main:desktop`;

  const upstream = http.request(
    {
      hostname: process.env.CLAW_REMOTE_HOST || "127.0.0.1",
      port: parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10),
      path: "/v1/chat/completions",
      method: "POST",
      timeout: 0,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${gatewayToken}`,
        "x-openclaw-agent-id": runtimeAgentId,
        "x-openclaw-session-key": sessionKey,
        ...(req.headers["x-openclaw-model"]
          ? { "x-openclaw-model": String(req.headers["x-openclaw-model"]) }
          : {}),
      },
    },
    upstreamRes => {
      res.status(upstreamRes.statusCode || 502);
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) res.setHeader(key, value as string | string[]);
      }
      upstreamRes.pipe(res);
    }
  );

  upstream.on("error", err => {
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || "OpenClaw proxy failed" });
    } else {
      res.end();
    }
  });

  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
  upstream.write(body);
  upstream.end();
}

export function registerDesktopRoutes(app: express.Express) {
  app.post("/api/desktop/login", express.json(), async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const user = await getUserByEmail(email);
      if (!user?.password) {
        res.status(401).json({ error: "邮箱或密码错误" });
        return;
      }
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) {
        res.status(401).json({ error: "邮箱或密码错误" });
        return;
      }

      const accessToken = await sdk.signSession({
        userId: user.id,
        name: user.name || user.email || email,
      });
      res.json({
        success: true,
        accessToken,
        user: {
          id: String(user.id),
          name: user.name || user.email || email,
          email: user.email,
          role: user.role,
          accessLevel: (user as any).accessLevel || "public_only",
        },
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Desktop login failed",
      });
    }
  });

  app.get("/api/desktop/bootstrap", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    const base = publicBaseUrl(req);
    const agentId = defaultDesktopAgentId();
    res.json({
      mode: "mvp",
      user,
      gatewayUrl:
        process.env.DESKTOP_OPENCLAW_GATEWAY_URL ||
        `${base}/api/desktop/openclaw`,
      gatewayToken: bearerToken(req),
      defaultAgentId: agentId,
      agents: [
        {
          id: agentId,
          name: process.env.DESKTOP_OPENCLAW_AGENT_NAME || "员工智能体",
          description: "Desktop MVP fixed OpenClaw agent",
        },
      ],
    });
  });

  app.get("/api/desktop/openclaw/health", (_req, res) => {
    res.json({ status: "ok", mode: "desktop-openclaw-proxy" });
  });

  app.get("/api/desktop/sessions", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1),
      200
    );
    const query = normalizeText(req.query.q).toLowerCase();
    const sessions = readDesktopSessions(query ? 200 : limit);
    const filtered = query
      ? sessions.filter(session =>
          `${session.title} ${session.preview} ${session.searchText}`
            .toLowerCase()
            .includes(query)
        )
      : sessions;
    res.json({
      sessions: filtered.slice(0, limit),
    });
  });

  app.get("/api/desktop/session-messages", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    const sessionId = String(
      req.query.sessionId || req.query.sessionKey || ""
    ).trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const found = findDesktopSession(sessionId);
    if (!found) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.json({
      session: found.summary,
      messages: readDesktopSessionMessagesFromFile(found.sessionFile),
    });
  });

  app.post("/api/desktop/openclaw/v1/chat/completions", forwardOpenClawChat);
}
