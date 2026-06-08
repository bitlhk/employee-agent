import express from "express";
import http from "http";
import type { IncomingMessage, Server } from "http";
import bcrypt from "bcryptjs";
import path from "path";
import { createHash, generateKeyPairSync, randomUUID, sign } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import {
  getClawByAdoptId,
  getSkillMarketItem,
  getUserByEmail,
  getUserById,
  incrementSkillDownload,
  listApprovedSkillMarketItems,
} from "../db";
import { sdk } from "./sdk";
import {
  APP_ROOT,
  bumpSessionEpoch,
  INTERNAL_BASE_URL,
  openClawAgentDir,
  resolveRuntimeWorkspaceByIds,
} from "./helpers";
import { normalizeWsEvent } from "./runtime";
import { buildRuntimeUserMessage } from "./tool_schema";
import { listMcpToolGroups } from "./claw-skills";
import { getFeishuStatus, unbindFeishu } from "./claw-feishu";
import { cleanupOpenClawWeixinBindingForAdopt, getWeixinStatus } from "./claw-weixin";
import { skillRegistry } from "./skills/skill-registry";
import { parseSkillSourceDirectory } from "./skills/skill-source";
import type { SkillSource } from "../../shared/types/skill";
import { getAvailableClawModelsFromConfig } from "../routers/helpers";

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

type DesktopSkillItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  path?: string;
  source?: string;
  marketId?: number;
  installed?: boolean;
};

type DesktopModelItem = {
  id: string;
  name: string;
  desc?: string;
  isDefault?: boolean;
};

type DesktopChannelStatus = {
  key: string;
  status: "connected" | "not_connected" | "not_configured" | "unsupported";
  label?: string;
  detail?: string;
};

const ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const { publicKey: DESKTOP_WS_PUB, privateKey: DESKTOP_WS_PRIV } =
  generateKeyPairSync("ed25519");
const DESKTOP_WS_SPKI = DESKTOP_WS_PUB.export({ type: "spki", format: "der" });
const DESKTOP_WS_RAW_PUB = DESKTOP_WS_SPKI.subarray(ED25519_PREFIX.length);
const b64u = (buffer: Buffer) =>
  buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
const DESKTOP_WS_DEV_PUB = b64u(DESKTOP_WS_RAW_PUB);
const DESKTOP_WS_DEV_ID = createHash("sha256")
  .update(DESKTOP_WS_RAW_PUB)
  .digest("hex");
const DESKTOP_WS_SCOPES = ["operator.admin", "operator.read", "operator.write"];

function signDesktopGatewayPayload(nonce: string, gatewayToken: string) {
  const signedAt = Date.now();
  const payload = [
    "v2",
    DESKTOP_WS_DEV_ID,
    "openclaw-control-ui",
    "ui",
    "operator",
    DESKTOP_WS_SCOPES.join(","),
    String(signedAt),
    gatewayToken,
    nonce,
  ].join("|");
  return {
    sig: b64u(sign(null, Buffer.from(payload, "utf8"), DESKTOP_WS_PRIV)),
    signedAt,
  };
}

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

function publicWsBaseUrl(req: express.Request): string {
  const base = publicBaseUrl(req);
  if (base.startsWith("https://")) return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  return base;
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

function defaultDesktopAdoptId(): string {
  return defaultDesktopAgentId().replace(/^trial_/, "");
}

function listDesktopChannels(): { channels: DesktopChannelStatus[] } {
  const adoptId = defaultDesktopAdoptId();
  const weixin = getWeixinStatus(adoptId);
  const feishu = getFeishuStatus(adoptId);

  return {
    channels: [
      {
        key: "weixin",
        status: weixin.bound ? "connected" : "not_connected",
        label: "微信",
        detail: weixin.targetLabel || weixin.userId || weixin.accountId || "",
      },
      {
        key: "feishu",
        status: feishu.bound ? "connected" : "not_connected",
        label: feishu.domain === "lark" ? "Lark" : "飞书",
        detail: feishu.targetLabel || "",
      },
      {
        key: "wecom",
        status: "unsupported",
        label: "企业微信",
        detail: "桌面端暂未接入",
      },
      {
        key: "dingtalk",
        status: "unsupported",
        label: "钉钉",
        detail: "桌面端暂未接入",
      },
      {
        key: "qqbot",
        status: "unsupported",
        label: "QQ Bot",
        detail: "桌面端暂未接入",
      },
    ],
  };
}

function bearerToken(req: express.Request): string {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function bearerTokenFromIncoming(req: IncomingMessage, url: URL): string {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return (
    match?.[1]?.trim() ||
    url.searchParams.get("access_token") ||
    url.searchParams.get("token") ||
    ""
  ).trim();
}

async function verifyDesktopToken(token: string): Promise<DesktopUser | null> {
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

function normalizeText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function preserveMarkdownText(value: unknown): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function truncateText(value: unknown, max = 48): string {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function parseSkillMarkdownMeta(text: string): {
  name?: string;
  description?: string;
  category?: string;
} {
  const raw = String(text || "");
  const frontmatter = raw.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  const block = frontmatter?.[1] || "";
  const pick = (key: string) => {
    const match = block.match(
      new RegExp(`^${key}:\\s*['"]?([^'"\\n]+)['"]?`, "im")
    );
    return match?.[1]?.trim();
  };
  const firstHeading = raw.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: pick("name") || firstHeading,
    description: pick("description"),
    category: pick("category"),
  };
}

function readSkillItemFromDir(skillId: string, dir: string): DesktopSkillItem {
  const mdPath = path.join(dir, "SKILL.md");
  let meta: ReturnType<typeof parseSkillMarkdownMeta> = {};
  try {
    if (existsSync(mdPath)) {
      const stat = statSync(mdPath);
      if (stat.isFile() && stat.size < 256 * 1024) {
        meta = parseSkillMarkdownMeta(readFileSync(mdPath, "utf8"));
      }
    }
  } catch {
    meta = {};
  }
  return {
    id: skillId,
    name: meta.name || skillId,
    description: meta.description || "已安装在当前智能体下的技能。",
    category: meta.category || "已安装",
    path: dir,
    source: "installed",
    installed: true,
  };
}

function listDesktopInstalledSkills(): DesktopSkillItem[] {
  const runtimeAgentId = defaultDesktopAgentId();
  const adoptId = defaultDesktopAdoptId();
  const skillsDir = path.join(
    resolveRuntimeWorkspaceByIds(adoptId, runtimeAgentId),
    "skills"
  );
  if (!existsSync(skillsDir)) return [];
  const items: DesktopSkillItem[] = [];
  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillDir = path.join(skillsDir, entry.name);
      items.push(readSkillItemFromDir(entry.name, skillDir));
    }
  } catch {
    return [];
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function readDesktopSkillContent(skillId: string): string {
  const runtimeAgentId = defaultDesktopAgentId();
  const adoptId = defaultDesktopAdoptId();
  const skillsDir = path.join(
    resolveRuntimeWorkspaceByIds(adoptId, runtimeAgentId),
    "skills"
  );
  const safeId = String(skillId || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(safeId)) return "";
  const mdPath = path.resolve(path.join(skillsDir, safeId, "SKILL.md"));
  const root = path.resolve(skillsDir);
  if (!mdPath.startsWith(root + path.sep) || !existsSync(mdPath)) return "";
  const stat = statSync(mdPath);
  if (!stat.isFile() || stat.size > 256 * 1024) return "";
  return readFileSync(mdPath, "utf8");
}

function readDesktopModelOverride(adoptId: string): string {
  try {
    const overridesPath = path.join(
      APP_ROOT,
      "data",
      "claw-model-overrides.json"
    );
    const raw = existsSync(overridesPath)
      ? JSON.parse(readFileSync(overridesPath, "utf8") || "{}")
      : {};
    return String(raw?.[adoptId] || "").trim();
  } catch {
    return "";
  }
}

function writeDesktopModelOverride(adoptId: string, modelId: string): void {
  const overridesPath = path.join(
    APP_ROOT,
    "data",
    "claw-model-overrides.json"
  );
  let raw: Record<string, string> = {};
  try {
    raw = existsSync(overridesPath)
      ? JSON.parse(readFileSync(overridesPath, "utf8") || "{}")
      : {};
  } catch {
    raw = {};
  }
  raw[adoptId] = modelId;
  mkdirSync(path.dirname(overridesPath), { recursive: true });
  writeFileSync(overridesPath, JSON.stringify(raw, null, 2), "utf8");
}

function listDesktopModels(): {
  selected: string;
  defaultModel: string;
  models: DesktopModelItem[];
} {
  const adoptId = defaultDesktopAdoptId();
  const models = getAvailableClawModelsFromConfig();
  const defaultModel =
    models.find(model => model.isDefault)?.id || models[0]?.id || "";
  const override = readDesktopModelOverride(adoptId);
  const modelIds = new Set(models.map(model => model.id));
  const selected = override && modelIds.has(override) ? override : defaultModel;
  return { selected, defaultModel, models };
}

async function listDesktopMarketSkills(): Promise<DesktopSkillItem[]> {
  const installed = new Set(listDesktopInstalledSkills().map(item => item.id));
  const rows = await listApprovedSkillMarketItems();
  return rows.map((row: any) => {
    const id = String(row.skillId || row.id || "").trim();
    return {
      id,
      marketId: Number(row.id),
      name: String(row.name || row.title || row.skillId || `技能 ${row.id}`),
      description: String(row.description || "技能市场上架技能。"),
      category: String(row.category || "技能市场"),
      source: "market",
      installed: installed.has(id),
    };
  });
}

async function installDesktopMarketSkill(marketId: number): Promise<{
  ok: boolean;
  skillId: string;
  name: string;
}> {
  const adoptId = defaultDesktopAdoptId();
  const runtimeAgentId = defaultDesktopAgentId();
  const item = await getSkillMarketItem(marketId);
  if (!item || item.status !== "approved") {
    throw new Error("技能不存在或未上架");
  }
  if (!item.packagePath || !existsSync(item.packagePath)) {
    throw new Error("技能包源不存在");
  }

  const parsed = parseSkillSourceDirectory(
    item.packagePath,
    item.skillId || item.name || "market-skill"
  );
  const source: SkillSource = {
    kind: "marketplace",
    skillId: parsed.skillId || item.skillId,
    displayName: item.name || parsed.displayName || item.skillId,
    description: item.description || parsed.description || "",
    sourcePath: item.packagePath,
    marketplaceId: String(item.id),
    version: String(item.version || parsed.manifest?.version || "1.0.0"),
  };
  const installed = await skillRegistry.install(adoptId, source);
  if (!installed.ok) {
    throw new Error(installed.error.detail);
  }
  await skillRegistry.updateScan(adoptId, source.skillId, {
    warnings: parsed.warnings,
    scannedAt: new Date().toISOString(),
  });
  await incrementSkillDownload(marketId);
  bumpSessionEpoch(adoptId);
  return {
    ok: true,
    skillId: source.skillId,
    name: source.displayName || source.skillId,
  };
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
    const content = preserveMarkdownText(
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
  return verifyDesktopToken(bearerToken(req));
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
  const models = listDesktopModels();
  const allowedModelIds = new Set(models.models.map(model => model.id));
  const requestedModel = String(req.headers["x-openclaw-model"] || "").trim();
  const backendModel =
    requestedModel && allowedModelIds.has(requestedModel)
      ? requestedModel
      : models.selected;

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
        ...(backendModel ? { "x-openclaw-model": backendModel } : {}),
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

export function registerDesktopWSProxy(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/api/desktop/openclaw/ws") return;

    try {
      const user = await verifyDesktopToken(bearerTokenFromIncoming(req, url));
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const requestedAgentId = String(url.searchParams.get("agentId") || "")
        .trim();
      const agentId = requestedAgentId || defaultDesktopAgentId();
      if (!agentId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit("connection", ws, req, {
          user,
          agentId,
          sessionKey: String(url.searchParams.get("sessionKey") || "").trim(),
        });
      });
    } catch (error) {
      console.error("[DESKTOP-WS] upgrade error:", error);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on(
    "connection",
    (
      client: WebSocket,
      _req: IncomingMessage,
      meta: { user: DesktopUser; agentId: string; sessionKey?: string }
    ) => {
      const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
      if (!gatewayToken) {
        client.send(
          JSON.stringify({
            type: "error",
            message: "CLAW_GATEWAY_TOKEN is not configured",
          })
        );
        client.close();
        return;
      }

      const gatewayUrl = `ws://${process.env.CLAW_REMOTE_HOST || "127.0.0.1"}:${process.env.CLAW_GATEWAY_PORT || "18789"}`;
      const gw = new WebSocket(gatewayUrl, {
        headers: { Origin: INTERNAL_BASE_URL },
      });
      const pendingClientMessages: string[] = [];
      const commandOutputBuffers = new Map<string, string>();
      let ready = false;
      let sessionKey =
        meta.sessionKey ||
        `agent:${meta.agentId}:main:desktop_${Date.now().toString(36)}`;
      let sawAssistantDelta = false;
      let lastChatSnapshotText = "";

      const sendToClient = (payload: object) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(payload));
        }
      };

      const emitAssistantDelta = (content: string) => {
        if (!content) return;
        sendToClient({
          choices: [
            { index: 0, delta: { content }, finish_reason: null },
          ],
        });
      };

      sendToClient({
        type: "connected",
        agentId: meta.agentId,
        sessionKey,
        ready: false,
      });

      gw.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.event === "connect.challenge") {
            const nonce = String(msg.payload?.nonce || "");
            const { sig, signedAt } = signDesktopGatewayPayload(
              nonce,
              gatewayToken
            );
            gw.send(
              JSON.stringify({
                type: "req",
                id: randomUUID(),
                method: "connect",
                params: {
                  minProtocol: 3,
                  maxProtocol: 4,
                  client: {
                    id: "openclaw-control-ui",
                    version: "1.0.0",
                    platform: "lingxia",
                    mode: "ui",
                  },
                  role: "operator",
                  scopes: DESKTOP_WS_SCOPES,
                  auth: { token: gatewayToken },
                  device: {
                    id: DESKTOP_WS_DEV_ID,
                    publicKey: DESKTOP_WS_DEV_PUB,
                    signature: sig,
                    signedAt,
                    nonce,
                  },
                  caps: ["tool-events"],
                },
              })
            );
            return;
          }

          if (msg.type === "res" && msg.id === "desktop-init-session") {
            if (!msg.ok) {
              sendToClient({
                type: "error",
                message: msg.error?.message || "OpenClaw session failed",
              });
              client.close();
              return;
            }
            sessionKey = msg.payload?.key || sessionKey;
            ready = true;
            sendToClient({
              type: "connected",
              agentId: meta.agentId,
              sessionKey,
              ready: true,
            });
            for (const pending of pendingClientMessages.splice(0)) {
              client.emit("message", Buffer.from(pending));
            }
            return;
          }

          if (msg.type === "res" && msg.ok === true && !ready) {
            gw.send(
              JSON.stringify({
                type: "req",
                id: "desktop-init-session",
                method: "sessions.create",
                params: { agentId: meta.agentId, key: sessionKey },
              })
            );
            return;
          }

          if (msg.type === "res" && msg.ok === false && !ready) {
            sendToClient({
              type: "error",
              message: msg.error?.message || "OpenClaw gateway error",
            });
            client.close();
            return;
          }

          if (
            msg.event === "health" ||
            msg.event === "tick" ||
            msg.event === "heartbeat"
          ) {
            return;
          }

          const normalized = normalizeWsEvent(msg, sessionKey);
          if (normalized.kind !== "events") {
            if (msg.type === "res" && msg.ok === false) {
              sendToClient({
                type: "error",
                message: msg.error?.message || "OpenClaw RPC error",
              });
            }
            return;
          }

          const rawEvent = typeof msg.event === "string" ? msg.event : "";
          const rawPayload =
            msg.payload && typeof msg.payload === "object" ? msg.payload : {};
          const rawStream =
            typeof rawPayload.stream === "string" ? rawPayload.stream : "";
          const rawState =
            typeof rawPayload.state === "string" ? rawPayload.state : "";

          for (const event of normalized.events) {
            switch (event.type) {
              case "delta":
                if (
                  rawEvent === "chat" &&
                  rawState === "delta" &&
                  sawAssistantDelta
                ) {
                  break;
                }
                if (rawEvent === "agent" && rawStream === "assistant") {
                  sawAssistantDelta = true;
                }
                emitAssistantDelta(event.content);
                break;

              case "chat_snapshot": {
                if (sawAssistantDelta) break;
                const snapshot = event.content;
                const delta = snapshot.startsWith(lastChatSnapshotText)
                  ? snapshot.slice(lastChatSnapshotText.length)
                  : snapshot;
                lastChatSnapshotText = snapshot;
                emitAssistantDelta(delta);
                break;
              }

              case "thinking":
                sendToClient({
                  choices: [
                    {
                      index: 0,
                      delta: { reasoning_content: event.content },
                      finish_reason: null,
                    },
                  ],
                });
                break;

              case "tool_call":
                if (event.phase === "start") {
                  const toolCallId = event.toolCallId || `tc_${Date.now()}`;
                  commandOutputBuffers.set(toolCallId, "");
                  sendToClient({
                    _event: "tool_call",
                    id: toolCallId,
                    name: event.name || "tool",
                    arguments: JSON.stringify(event.args || {}),
                  });
                } else {
                  const toolCallId = event.toolCallId || "";
                  const buffered = commandOutputBuffers.get(toolCallId) || "";
                  commandOutputBuffers.delete(toolCallId);
                  sendToClient({
                    _event: "tool_result",
                    tool_call_id: toolCallId,
                    result:
                      buffered ||
                      (typeof event.result === "string" ? event.result : ""),
                    is_error: Boolean(event.isError),
                  });
                }
                break;

              case "command_output":
                if (event.phase === "delta") {
                  const toolCallId = event.toolCallId || "";
                  if (toolCallId && commandOutputBuffers.has(toolCallId)) {
                    commandOutputBuffers.set(
                      toolCallId,
                      (commandOutputBuffers.get(toolCallId) || "") +
                        (event.output || "")
                    );
                  }
                } else {
                  const toolCallId = event.toolCallId || "";
                  if (toolCallId && event.output) {
                    commandOutputBuffers.set(toolCallId, event.output);
                  }
                }
                break;

              case "item_status":
                sendToClient({
                  __status: event.progressText,
                  _event: "agent_status",
                  kind: "progress",
                  label: event.progressText,
                });
                break;

              case "lifecycle_end":
                sendToClient({ __stream_end: true });
                sendToClient({
                  choices: [
                    { index: 0, delta: {}, finish_reason: "stop" },
                  ],
                });
                break;

              case "chat_final": {
                if (event.content && !sawAssistantDelta) {
                  const delta = event.content.startsWith(lastChatSnapshotText)
                    ? event.content.slice(lastChatSnapshotText.length)
                    : event.content;
                  lastChatSnapshotText = event.content;
                  emitAssistantDelta(delta);
                }
                sendToClient({
                  choices: [
                    { index: 0, delta: {}, finish_reason: "stop" },
                  ],
                });
                break;
              }

              case "error":
                sendToClient({ error: event.message });
                break;

              default:
                break;
            }
          }
        } catch (error) {
          console.error("[DESKTOP-WS] parse error:", error);
        }
      });

      gw.on("error", error => {
        sendToClient({
          type: "error",
          message: error.message || "OpenClaw gateway websocket error",
        });
      });

      gw.on("close", () => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1012, "OpenClaw gateway closed");
        }
      });

      client.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type !== "chat") return;
          if (!ready) {
            pendingClientMessages.push(raw.toString());
            sendToClient({
              __status: "正在初始化 OpenClaw 会话",
              _event: "agent_status",
              kind: "progress",
              label: "正在初始化 OpenClaw 会话",
            });
            return;
          }

          sawAssistantDelta = false;
          lastChatSnapshotText = "";
          commandOutputBuffers.clear();
          sendToClient({
            __status: "已连接 OpenClaw，正在处理请求",
            _event: "agent_status",
            kind: "progress",
            label: "已连接 OpenClaw，正在处理请求",
          });
          gw.send(
            JSON.stringify({
              type: "req",
              id: randomUUID(),
              method: "chat.send",
              params: {
                sessionKey,
                message: buildRuntimeUserMessage(String(msg.message || "")),
                idempotencyKey: String(msg.clientRunId || randomUUID()),
                thinking: msg.runtimeMode === "plan" ? "on" : "off",
                deliver: false,
              },
            })
          );
        } catch {
          // Ignore malformed client messages.
        }
      });

      client.on("close", () => gw.close());
      client.on("error", () => gw.close());
    }
  );

  console.log("[DESKTOP-WS] registered at /api/desktop/openclaw/ws");
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
    const wsBase = publicWsBaseUrl(req);
    const agentId = defaultDesktopAgentId();
    res.json({
      mode: "mvp",
      user,
      gatewayUrl:
        process.env.DESKTOP_OPENCLAW_GATEWAY_URL ||
        `${base}/api/desktop/openclaw`,
      gatewayWsUrl:
        process.env.DESKTOP_OPENCLAW_GATEWAY_WS_URL ||
        `${wsBase}/api/desktop/openclaw/ws`,
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

  app.get("/api/desktop/models", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    try {
      res.json(listDesktopModels());
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Desktop models failed",
      });
    }
  });

  app.post("/api/desktop/model-select", express.json(), async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    try {
      const modelId = String(req.body?.modelId || "").trim();
      const models = listDesktopModels();
      if (!modelId || !models.models.some(model => model.id === modelId)) {
        res.status(400).json({ error: "Unsupported model" });
        return;
      }
      writeDesktopModelOverride(defaultDesktopAdoptId(), modelId);
      res.json({ ok: true, modelId });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Desktop model select failed",
      });
    }
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

  app.get("/api/desktop/capabilities", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    try {
      const [market, installed] = await Promise.all([
        listDesktopMarketSkills(),
        Promise.resolve(listDesktopInstalledSkills()),
      ]);
      res.json({
        skills: {
          installed,
          market,
        },
        tools: listMcpToolGroups(),
        agents: [],
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Desktop capabilities failed",
      });
    }
  });

  app.get("/api/desktop/channels", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    try {
      res.json(listDesktopChannels());
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Desktop channel status failed",
      });
    }
  });

  app.post("/api/desktop/channels/:key/unbind", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    const key = String(req.params.key || "").trim();
    try {
      const adoptId = defaultDesktopAdoptId();
      const claw = await getClawByAdoptId(adoptId);
      if (key === "weixin") {
        if (!claw) return res.status(404).json({ error: "agent not found" });
        cleanupOpenClawWeixinBindingForAdopt(adoptId, claw);
        return res.json({ ok: true });
      }
      if (key === "feishu") {
        await unbindFeishu(adoptId);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: "unsupported channel" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "unbind failed" });
    }
  });

  app.get("/api/desktop/skill-content", async (req, res) => {
    const user = await requireDesktopUser(req, res);
    if (!user) return;
    const skillId = String(req.query.skillId || "").trim();
    if (!skillId) {
      res.status(400).json({ error: "skillId required" });
      return;
    }
    res.type("text/plain").send(readDesktopSkillContent(skillId));
  });

  app.post(
    "/api/desktop/skill-market/install",
    express.json(),
    async (req, res) => {
      const user = await requireDesktopUser(req, res);
      if (!user) return;
      try {
        const marketId = Number(req.body?.marketId || 0);
        if (!Number.isFinite(marketId) || marketId <= 0) {
          res.status(400).json({ error: "marketId required" });
          return;
        }
        res.json(await installDesktopMarketSkill(marketId));
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Desktop install failed",
        });
      }
    }
  );

  app.post("/api/desktop/openclaw/v1/chat/completions", forwardOpenClawChat);
}
