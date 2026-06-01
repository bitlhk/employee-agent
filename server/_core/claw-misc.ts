import express from "express";
import { COOKIE_NAME } from "@shared/const";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { strictLimiter } from "./security";
import {
  APP_ROOT,
  OPENCLAW_HOME,
  OPENCLAW_JSON_PATH,
  buildSessionRegistryScope,
  openClawAgentDir,
  openClawSkillMarketDir,
  openClawWorkspaceDir,
  readSessionEpoch,
  requireClawOwner,
  upsertSessionRegistry,
} from "./helpers";
import { createContext } from "./context";
import { skillInstaller } from "./skills/skill-installer";
import { MAX_SKILL_PACKAGE_BYTES, parseSkillPackageBuffer } from "./skills/skill-source";

type UsageBucket = { total: number; days: Record<string, number>; lastTs: string; userId: number };
type ChatHistoryMessage = { id: string; role: "user" | "assistant"; text: string; timeLabel: string; timestamp: number };
type HistoryRunMessages = { source: string; runAt: number; messages: ChatHistoryMessage[] };

function normalizeHistoryText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateHistoryText(value: unknown, max = 28): string {
  const text = normalizeHistoryText(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatHistoryTimeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function stripPlatformLanguagePolicy(text: string): string {
  return text
    .replace(/\[[^\]]*Employee Agent Platform Language Policy\][\s\S]*?\[\/Employee Agent Platform Language Policy\]\s*/g, "")
    .replace(/^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+GMT[+-]\d+\]\s*/g, "")
    .trim();
}

function textFromOpenClawContent(content: unknown, role: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content as any[]) {
    if (!item || typeof item !== "object") continue;
    const type = String(item.type || "");
    if (type === "thinking" || type === "tool_use" || type === "tool_result") continue;
    if (typeof item.text === "string") parts.push(item.text);
    else if (role === "assistant" && typeof item.content === "string" && (type === "output_text" || type === "text")) parts.push(item.content);
  }
  return parts.join("\n\n").trim();
}

function extractOpenClawChatMessages(sessionFile: string, maxMessages = 200): ChatHistoryMessage[] {
  if (!sessionFile || !existsSync(sessionFile)) return [];
  const messages: ChatHistoryMessage[] = [];
  const lines = readFileSync(sessionFile, "utf8").split("\n");
  for (const line of lines) {
    if (!line) continue;
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type !== "message") continue;
    const role = String(event?.message?.role || "");
    if (role !== "user" && role !== "assistant") continue;
    let text = textFromOpenClawContent(event?.message?.content, role);
    if (role === "user") text = stripPlatformLanguagePolicy(text);
    text = text.trim();
    if (!text) continue;
    const timestamp = Number(event?.message?.timestamp || event?.timestamp || 0) || 0;
    messages.push({
      id: `hist-${String(event?.id || messages.length)}`,
      role,
      text,
      timeLabel: formatHistoryTimeLabel(timestamp),
      timestamp,
    });
  }
  return messages.slice(-maxMessages);
}

function chatHistoryMessageFromOpenClawMessage(raw: any, fallbackTimestamp: number, idPrefix: string, index: number): ChatHistoryMessage | null {
  const role = String(raw?.role || "");
  if (role !== "user" && role !== "assistant") return null;
  let text = textFromOpenClawContent(raw?.content, role);
  if (role === "user") text = stripPlatformLanguagePolicy(text);
  text = text.trim();
  if (!text) return null;
  const timestamp = Number(raw?.timestamp || fallbackTimestamp || 0) || 0;
  return {
    id: `hist-${idPrefix}-${index}`,
    role,
    text,
    timeLabel: formatHistoryTimeLabel(timestamp),
    timestamp,
  };
}

function extractTrajectoryRunMessages(trajectoryFile: string, expectedSessionKey: string): HistoryRunMessages | null {
  if (!trajectoryFile || !existsSync(trajectoryFile)) return null;
  let matched = false;
  let runAt = 0;
  let latestSnapshot: any[] | null = null;
  let latestSnapshotAt = 0;
  const source = path.basename(trajectoryFile).replace(/\.trajectory\.jsonl$/, "");

  for (const line of readFileSync(trajectoryFile, "utf8").split("\n")) {
    if (!line) continue;
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.sessionKey === expectedSessionKey) matched = true;
    if (!matched && event?.sessionKey) continue;
    const eventAt = typeof event?.ts === "string" ? Date.parse(event.ts) : Number(event?.ts || 0);
    if (Number.isFinite(eventAt) && eventAt > runAt) runAt = eventAt;
    const snapshot = event?.data?.messagesSnapshot;
    if (Array.isArray(snapshot)) {
      latestSnapshot = snapshot;
      latestSnapshotAt = Number.isFinite(eventAt) && eventAt > 0 ? eventAt : latestSnapshotAt;
    }
  }

  if (!matched || !latestSnapshot) return null;
  const fallbackTimestamp = latestSnapshotAt || runAt;
  const messages = latestSnapshot
    .map((message, index) => chatHistoryMessageFromOpenClawMessage(message, fallbackTimestamp, source, index))
    .filter(Boolean) as ChatHistoryMessage[];
  if (messages.length === 0) return null;
  return { source, runAt: runAt || fallbackTimestamp || 0, messages };
}

function listTrajectoryRunsForSessionKey(sessionsDir: string, sessionKey: string): HistoryRunMessages[] {
  const runs: HistoryRunMessages[] = [];
  let entries: ReturnType<typeof readdirSync> = [];
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true }) as any;
  } catch {
    return runs;
  }
  for (const entry of entries as any[]) {
    if (!entry.isFile() || !entry.name.endsWith(".trajectory.jsonl")) continue;
    const run = extractTrajectoryRunMessages(path.join(sessionsDir, entry.name), sessionKey);
    if (run) runs.push(run);
  }
  return runs.sort((a, b) => a.runAt - b.runAt);
}

function dedupeHistoryMessages(messages: ChatHistoryMessage[], maxMessages: number): ChatHistoryMessage[] {
  const seen = new Set<string>();
  const deduped: ChatHistoryMessage[] = [];
  for (const message of messages) {
    const normalizedText = normalizeHistoryText(message.text);
    if (!normalizedText) continue;
    const timeBucket = message.timestamp > 0 ? String(message.timestamp) : "no-ts";
    const fingerprint = `${message.role}|${timeBucket}|${normalizedText}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push({
      ...message,
      id: `hist-merged-${deduped.length}`,
      timeLabel: formatHistoryTimeLabel(message.timestamp),
    });
  }
  return deduped
    .sort((a, b) => {
      if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return 0;
    })
    .slice(-maxMessages);
}

function collectOpenClawChatHistoryMessages(args: {
  sessionsDir: string;
  sessionKey: string;
  currentSessionFile?: string;
  maxMessages?: number;
}): ChatHistoryMessage[] {
  const maxMessages = args.maxMessages || 200;
  const runs = listTrajectoryRunsForSessionKey(args.sessionsDir, args.sessionKey);
  const merged: ChatHistoryMessage[] = [];
  for (const run of runs) merged.push(...run.messages);

  const currentSessionFile = args.currentSessionFile ? path.resolve(args.currentSessionFile) : "";
  const hasCurrentRun = currentSessionFile
    ? runs.some((run) => currentSessionFile.endsWith(`${run.source}.jsonl`))
    : false;
  if (currentSessionFile && !hasCurrentRun) {
    merged.push(...extractOpenClawChatMessages(currentSessionFile, maxMessages));
  }

  return dedupeHistoryMessages(merged, maxMessages);
}

function parseWebSessionKey(sessionKey: string, runtimeAgentId: string): { conversationId: string; epoch?: number } | null {
  const parts = String(sessionKey || "").split(":");
  if (parts[0] !== "agent" || parts[1] !== runtimeAgentId || parts[2] !== "web" || !parts[3]) return null;
  const epochPart = parts[4] || "";
  const epochMatch = /^e(\d+)$/.exec(epochPart);
  return { conversationId: parts[3], epoch: epochMatch ? Number(epochMatch[1]) : undefined };
}

const RECOVERED_WEB_CONVERSATION_PREFIX = "hist_";

function recoveredConversationId(sessionId: string): string {
  return `${RECOVERED_WEB_CONVERSATION_PREFIX}${sessionId}`;
}

function recoveredSessionIdFromConversationId(conversationId: string): string | null {
  const value = String(conversationId || "").trim();
  if (!value.startsWith(RECOVERED_WEB_CONVERSATION_PREFIX)) return null;
  const sessionId = value.slice(RECOVERED_WEB_CONVERSATION_PREFIX.length);
  return /^[a-zA-Z0-9._-]{12,80}$/.test(sessionId) ? sessionId : null;
}

function isRecoverableHistoryMessages(messages: ChatHistoryMessage[]): boolean {
  const firstUser = messages.find((message) => message.role === "user" && normalizeHistoryText(message.text));
  if (!firstUser) return false;
  const firstText = normalizeHistoryText(firstUser.text).toLowerCase();
  if (!firstText) return false;
  if (firstText.includes("[openclaw heartbeat poll]")) return false;
  if (firstText.startsWith("[cron:")) return false;
  if (firstText.includes("reply with exactly: pong")) return false;
  if (firstText.includes("smoke测试") || firstText.includes("smoke_ok")) return false;
  if (firstText.includes("测试流式输出") || firstText.includes("测试前端流式输出")) return false;
  if (firstText.includes("测试文章") && firstText.includes("不少于")) return false;
  if (firstText.includes("沙箱验收")) return false;
  if (firstText.includes("office-ppt-outline") && firstText.includes("smoke")) return false;
  return true;
}

function resolveRecoveredSessionFile(sessionsDir: string, conversationId: string): { sessionId: string; sessionFile: string } | null {
  const sessionId = recoveredSessionIdFromConversationId(conversationId);
  if (!sessionId) return null;
  const sessionsRoot = path.resolve(sessionsDir);
  const sessionFile = path.resolve(path.join(sessionsDir, `${sessionId}.jsonl`));
  if (!sessionFile.startsWith(sessionsRoot + path.sep) || !existsSync(sessionFile)) return null;
  return { sessionId, sessionFile };
}

function listRecoveredWebSessions(args: {
  sessionsDir: string;
  runtimeAgentId: string;
  indexedSessionIds: Set<string>;
  limit: number;
}): any[] {
  const out: any[] = [];
  let entries: ReturnType<typeof readdirSync> = [];
  try {
    entries = readdirSync(args.sessionsDir, { withFileTypes: true }) as any;
  } catch {
    return out;
  }
  const sessionsRoot = path.resolve(args.sessionsDir);
  for (const entry of entries as any[]) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl") || entry.name.includes(".trajectory")) continue;
    if (entry.name.includes(".codex-app-server")) continue;
    const sessionId = entry.name.replace(/\.jsonl$/, "");
    if (!sessionId || args.indexedSessionIds.has(sessionId)) continue;
    const sessionFile = path.resolve(path.join(args.sessionsDir, entry.name));
    if (!sessionFile.startsWith(sessionsRoot + path.sep)) continue;
    const messages = extractOpenClawChatMessages(sessionFile, 80);
    if (!isRecoverableHistoryMessages(messages)) continue;
    const firstTs = messages.find((message) => message.timestamp > 0)?.timestamp || 0;
    const lastTs = [...messages].reverse().find((message) => message.timestamp > 0)?.timestamp || 0;
    const st = statSync(sessionFile);
    const updatedAt = lastTs || st.mtimeMs || 0;
    const createdAt = firstTs || st.birthtimeMs || updatedAt;
    const conversationId = recoveredConversationId(sessionId);
    out.push({
      conversationId,
      sessionKey: `agent:${args.runtimeAgentId}:web:${conversationId}`,
      sessionId,
      sessionFile,
      updatedAt,
      createdAt,
      messageCount: messages.length,
      title: "新对话",
      preview: "",
      recovered: true,
    });
  }
  return out
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, args.limit);
}

function addUsageEvent(params: {
  byAdopt: Record<string, UsageBucket>;
  dailyAll: Record<string, number>;
  seen: Set<string>;
  key: string;
  adoptId: string;
  ts: string;
  userId?: number;
}) {
  const aid = String(params.adoptId || "").trim();
  const ts = String(params.ts || "").trim();
  const day = ts.slice(0, 10);
  if (!aid || !day || params.seen.has(params.key)) return;
  params.seen.add(params.key);

  const uid = Number(params.userId || 0);
  if (!params.byAdopt[aid]) params.byAdopt[aid] = { total: 0, days: {}, lastTs: "", userId: uid };
  params.byAdopt[aid].total += 1;
  params.byAdopt[aid].days[day] = (params.byAdopt[aid].days[day] || 0) + 1;
  if (ts > params.byAdopt[aid].lastTs) {
    params.byAdopt[aid].lastTs = ts;
    params.byAdopt[aid].userId = uid;
  }
  params.dailyAll[day] = (params.dailyAll[day] || 0) + 1;
}

function runtimeAgentIdFromSessionKey(sessionKey: string): string {
  const match = /^agent:([^:]+):/.exec(String(sessionKey || ""));
  return match?.[1] || "";
}

function adoptIdFromRuntimeAgentId(runtimeAgentId: string): string {
  return String(runtimeAgentId || "").startsWith("trial_")
    ? String(runtimeAgentId).slice("trial_".length)
    : "";
}

function listTrajectoryFiles(rootDir: string, maxFiles: number): string[] {
  const files: Array<{ path: string; mtimeMs: number }> = [];
  const visit = (dir: string) => {
    let entries: ReturnType<typeof readdirSync> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }
    for (const entry of entries as any[]) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".trajectory.jsonl")) {
        try {
          files.push({ path: fullPath, mtimeMs: statSync(fullPath).mtimeMs });
        } catch {
          files.push({ path: fullPath, mtimeMs: 0 });
        }
      }
    }
  };
  visit(rootDir);
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((item) => item.path);
}

export function registerMiscRoutes(app: express.Express) {

  // ── Runtime info ──────────────────────────────────────
  app.get("/api/claw/runtime-info", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const dbAgentId = String((claw as any).agentId || "").trim();
      const trialAgentId = `trial_${String(adoptId)}`;
      const trialAgentDir = openClawAgentDir(trialAgentId);
      const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : dbAgentId;
      const skillsDir = `${openClawWorkspaceDir(runtimeAgentId)}/skills`;
      res.json({ adoptId, dbAgentId, runtimeAgentId, skillsDir, trialAgentDirExists: existsSync(trialAgentDir) });
    } catch (e) {
      res.status(500).json({ error: "runtime info failed" });
    }
  });

  app.get("/api/claw/chat-history/sessions", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const limit = Math.min(Math.max(Number(req.query.limit || 50) || 50, 1), 100);
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const dbAgentId = String((claw as any).agentId || "").trim();
      const trialAgentId = `trial_${adoptId}`;
      const runtimeAgentId = existsSync(openClawAgentDir(trialAgentId)) ? trialAgentId : dbAgentId;
      const sessionsPath = path.join(openClawAgentDir(runtimeAgentId), "sessions", "sessions.json");
      if (!existsSync(sessionsPath)) {
        res.json({ sessions: [] });
        return;
      }

      const rawIndex = JSON.parse(readFileSync(sessionsPath, "utf8") || "{}") || {};
      const byConversation = new Map<string, any>();
      const sessionsDir = path.join(openClawAgentDir(runtimeAgentId), "sessions");
      const resolvedSessionsDir = path.resolve(sessionsDir);
      const indexedSessionIds = new Set<string>();
      for (const [sessionKey, raw] of Object.entries(rawIndex) as Array<[string, any]>) {
        const parsed = parseWebSessionKey(sessionKey, runtimeAgentId);
        if (!parsed) continue;
        const sessionId = String(raw?.sessionId || "").trim();
        if (!sessionId) continue;
        indexedSessionIds.add(sessionId);
        const sessionFile = String(raw?.sessionFile || path.join(sessionsDir, `${sessionId}.jsonl`));
        const resolvedSessionFile = path.resolve(sessionFile);
        if (!resolvedSessionFile.startsWith(resolvedSessionsDir + path.sep)) continue;
        const updatedAt = Number(raw?.updatedAt || raw?.lastInteractionAt || raw?.endedAt || raw?.startedAt || 0) || 0;
        const existing = byConversation.get(parsed.conversationId);
        if (!existing || updatedAt > existing.updatedAt) {
          byConversation.set(parsed.conversationId, {
            conversationId: parsed.conversationId,
            sessionKey,
            sessionId,
            sessionFile: resolvedSessionFile,
            updatedAt,
            createdAt: Number(raw?.sessionStartedAt || raw?.startedAt || updatedAt || 0) || updatedAt,
            messageCount: 0,
            title: "新对话",
            preview: "",
          });
        }
      }
      for (const recovered of listRecoveredWebSessions({
        sessionsDir,
        runtimeAgentId,
        indexedSessionIds,
        limit,
      })) {
        if (!byConversation.has(recovered.conversationId)) {
          byConversation.set(recovered.conversationId, recovered);
        }
      }

      const sessions = Array.from(byConversation.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map((entry) => {
          const messages = collectOpenClawChatHistoryMessages({
            sessionsDir,
            sessionKey: entry.sessionKey,
            currentSessionFile: entry.sessionFile,
            maxMessages: 80,
          });
          const firstUser = messages.find((m) => m.role === "user");
          const last = [...messages].reverse().find((m) => normalizeHistoryText(m.text));
          return {
            conversationId: entry.conversationId,
            sessionKey: entry.sessionKey,
            sessionId: entry.sessionId,
            title: truncateHistoryText(firstUser?.text || "", 24) || "新对话",
            preview: truncateHistoryText(last?.text || "", 42),
            messageCount: messages.length,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          };
        })
        .filter((entry) => entry.messageCount > 0);

      res.json({ sessions });
    } catch (error: any) {
      console.warn("[chat-history] list failed", error?.message || error);
      res.status(500).json({ error: "chat_history_list_failed" });
    }
  });

  app.get("/api/claw/chat-history/messages", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const sessionKey = String(req.query.sessionKey || "").trim();
      if (!adoptId || !sessionKey) {
        res.status(400).json({ error: "adoptId and sessionKey required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const dbAgentId = String((claw as any).agentId || "").trim();
      const trialAgentId = `trial_${adoptId}`;
      const runtimeAgentId = existsSync(openClawAgentDir(trialAgentId)) ? trialAgentId : dbAgentId;
      const parsed = parseWebSessionKey(sessionKey, runtimeAgentId);
      if (!parsed) {
        res.status(403).json({ error: "session_not_allowed" });
        return;
      }

      const sessionsPath = path.join(openClawAgentDir(runtimeAgentId), "sessions", "sessions.json");
      if (!existsSync(sessionsPath)) {
        res.status(404).json({ error: "sessions_index_missing" });
        return;
      }
      const rawIndex = JSON.parse(readFileSync(sessionsPath, "utf8") || "{}") || {};
      const raw = rawIndex[sessionKey];
      const sessionsDir = path.join(openClawAgentDir(runtimeAgentId), "sessions");
      const recovered = raw?.sessionId ? null : resolveRecoveredSessionFile(sessionsDir, parsed.conversationId);
      const sessionId = String(raw?.sessionId || recovered?.sessionId || "").trim();
      if (!sessionId) {
        res.status(404).json({ error: "session_missing" });
        return;
      }
      const fallbackSessionFile = path.join(openClawAgentDir(runtimeAgentId), "sessions", `${sessionId}.jsonl`);
      const sessionFile = String(raw?.sessionFile || recovered?.sessionFile || fallbackSessionFile);
      const resolvedFile = path.resolve(sessionFile);
      if (!resolvedFile.startsWith(path.resolve(sessionsDir) + path.sep)) {
        res.status(403).json({ error: "session_file_not_allowed" });
        return;
      }
      const messages = collectOpenClawChatHistoryMessages({
        sessionsDir,
        sessionKey,
        currentSessionFile: resolvedFile,
        maxMessages: 200,
      });
      res.json({ conversationId: parsed.conversationId, sessionKey, sessionId, messages });
    } catch (error: any) {
      console.warn("[chat-history] messages failed", error?.message || error);
      res.status(500).json({ error: "chat_history_messages_failed" });
    }
  });

  app.post("/api/claw/chat-history/activate", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const sessionKey = String(req.body?.sessionKey || "").trim();
      if (!adoptId || !sessionKey) {
        res.status(400).json({ error: "adoptId and sessionKey required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const dbAgentId = String((claw as any).agentId || "").trim();
      const trialAgentId = `trial_${adoptId}`;
      const runtimeAgentId = existsSync(openClawAgentDir(trialAgentId)) ? trialAgentId : dbAgentId;
      const parsed = parseWebSessionKey(sessionKey, runtimeAgentId);
      if (!parsed) {
        res.status(403).json({ error: "session_not_allowed" });
        return;
      }

      const sessionsPath = path.join(openClawAgentDir(runtimeAgentId), "sessions", "sessions.json");
      const rawIndex = existsSync(sessionsPath) ? JSON.parse(readFileSync(sessionsPath, "utf8") || "{}") || {} : {};
      const sessionsDir = path.join(openClawAgentDir(runtimeAgentId), "sessions");
      const recovered = rawIndex[sessionKey]?.sessionId ? null : resolveRecoveredSessionFile(sessionsDir, parsed.conversationId);
      if (!rawIndex[sessionKey]?.sessionId && !recovered?.sessionId) {
        res.status(404).json({ error: "session_missing" });
        return;
      }
      if (!rawIndex[sessionKey]?.sessionId && recovered) {
        rawIndex[sessionKey] = {
          sessionId: recovered.sessionId,
          sessionFile: recovered.sessionFile,
          updatedAt: statSync(recovered.sessionFile).mtimeMs,
          sessionStartedAt: statSync(recovered.sessionFile).birthtimeMs,
          recovered: true,
        };
        writeFileSync(sessionsPath, JSON.stringify(rawIndex, null, 2), "utf8");
      }

      const currentEpoch = readSessionEpoch(adoptId);
      const scope = buildSessionRegistryScope("web", parsed.conversationId);
      upsertSessionRegistry(adoptId, runtimeAgentId, sessionKey, currentEpoch, scope);
      res.json({ ok: true, conversationId: parsed.conversationId, sessionKey, epoch: currentEpoch });
    } catch (error: any) {
      console.warn("[chat-history] activate failed", error?.message || error);
      res.status(500).json({ error: "chat_history_activate_failed" });
    }
  });

  // ── 每日洞察 API ──────────────────────────────────────
  app.get("/api/insights/latest", async (_req, res) => {
    try {
      const { getLatestDailyInsight } = await import("../db");
      const insight = await getLatestDailyInsight();
      if (!insight) {
        res.status(404).json({ error: "No insight found" });
        return;
      }
      res.json({
        id: insight.id,
        date: insight.date,
        title: insight.title,
        summary: insight.summary,
        content: insight.content,
        source: insight.source,
        updatedAt: insight.updatedAt,
      });
    } catch (error) {
      console.error("[Insights] Failed to get latest insight:", error);
      res.status(500).json({ error: "Failed to get latest insight" });
    }
  });

  app.post("/api/insights/upsert", strictLimiter, async (req, res) => {
    try {
      const expectedToken = process.env.INSIGHTS_PUSH_TOKEN;
      const tokenFromHeader = req.header("x-insights-token") || req.header("authorization")?.replace(/^Bearer\s+/i, "");

      if (!expectedToken || tokenFromHeader !== expectedToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const body = req.body || {};
      const date = typeof body.date === "string" ? body.date.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const summary = typeof body.summary === "string" ? body.summary.trim() : "";
      const source = typeof body.source === "string" ? body.source.trim() : "openclaw";

      if (!date || !title || !content) {
        res.status(400).json({ error: "date/title/content are required" });
        return;
      }

      const { upsertDailyInsight } = await import("../db");
      await upsertDailyInsight({ date, title, summary, content, source });

      res.json({ success: true });
    } catch (error) {
      console.error("[Insights] Failed to upsert insight:", error);
      res.status(500).json({ error: "Failed to upsert insight" });
    }
  });

  // ── Logout all sessions/cookies ───────────────────────
  app.post("/api/auth/logout-all", async (req, res) => {
    try {
      const clearOpts = [
        { path: "/" },
        { domain: process.env.COOKIE_DOMAIN || ".linggan.top", path: "/" },
        { domain: (process.env.COOKIE_DOMAIN || ".linggan.top").replace(/^\./, ""), path: "/" },
        { domain: `www.${(process.env.COOKIE_DOMAIN || ".linggan.top").replace(/^\./, "")}`, path: "/" },
      ] as const;

      for (const opt of clearOpts) {
        try { res.clearCookie(COOKIE_NAME, { ...opt, httpOnly: true, secure: true, sameSite: "none" as const }); } catch {}
        try { res.clearCookie(COOKIE_NAME, { ...opt, httpOnly: true, secure: false, sameSite: "lax" as const }); } catch {}
      }

      // lock sso-bridge for 3 minutes to avoid immediate auto-login after logout
      res.cookie("logout_lock", "1", {
        domain: process.env.COOKIE_DOMAIN || ".linggan.top",
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
        maxAge: 3 * 60 * 1000,
      });

      // best-effort site data clear (supported browsers only)
      res.setHeader("Clear-Site-Data", '"cookies", "storage"');
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false });
    }
  });

  // ── Embed auth probe for nginx auth_request ───────────
  app.get("/api/embed/auth-check", async (req, res) => {
    try {
      const context = await createContext({ req, res, info: {} as any });
      if (context.user) {
        res.status(204).end();
      } else {
        res.status(401).json({ error: "UNAUTHORIZED" });
      }
    } catch (e) {
      res.status(401).json({ error: "UNAUTHORIZED" });
    }
  });

  // ── SSO bridge ────────────────────────────────────────
  app.get("/api/embed/sso-bridge", async (req, res) => {
    try {
      const nextRaw = typeof req.query.next === "string" ? req.query.next : (process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/"));
      let nextUrl: URL;
      try {
        nextUrl = new URL(nextRaw);
      } catch {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      // only allow configured domain destinations
      if (!nextUrl.hostname.endsWith((process.env.COOKIE_DOMAIN || ".linggan.top").replace(/^\./, ""))) {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      // If user just logged out, skip auto-bridge to avoid immediate re-login loop
      if ((req as any).cookies?.logout_lock === "1") {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      const context = await createContext({ req, res, info: {} as any });
      if (!context.user) {
        return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
      }

      const { sdk } = await import("./sdk");

      const token = await sdk.signSession({
        userId: context.user.id,
        name: context.user.name ?? "",
      });

      // shared cookie for subdomains
      res.cookie(COOKIE_NAME, token, {
        domain: process.env.COOKIE_DOMAIN || ".linggan.top",
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
      });

      return res.redirect(nextUrl.toString());
    } catch (e) {
      return res.redirect((process.env.FRONTEND_URL || (process.env.FRONTEND_URL || "https://www.linggan.top/")));
    }
  });

  // ── AI 审核技能包 ───────────────────────────────────
  app.post("/api/claw/admin/ai-review-skill", async (req, res) => {
    try {
      const context = await createContext({ req, res, info: {} as any });
      if (!context.user || context.user.role !== "admin") {
        res.status(403).json({ error: "admin only" });
        return;
      }

      const { getSkillMarketItem: getSMI } = await import("../db");

      const { skillMarketId } = req.body || {};
      if (!skillMarketId) { res.status(400).json({ error: "Missing skillMarketId" }); return; }

      const item = await getSMI(Number(skillMarketId));
      if (!item) { res.status(404).json({ error: "技能不存在" }); return; }

      // 读取源码
      const dir = item.packagePath || "";
      let skillMd = "";
      let scriptFiles: string[] = [];
      let scriptContent = "";
      try { skillMd = readFileSync(`${dir}/SKILL.md`, "utf8"); } catch {}
      try {
        if (existsSync(`${dir}/scripts`)) {
          scriptFiles = readdirSync(`${dir}/scripts`);
          // 读取前 3 个脚本内容
          for (const f of scriptFiles.slice(0, 3)) {
            try {
              const c = readFileSync(`${dir}/scripts/${f}`, "utf8");
              scriptContent += `\n--- ${f} ---\n${c.slice(0, 2000)}\n`;
            } catch {}
          }
        }
      } catch {}

      const prompt = `审核此技能包，简要回答（200字内）：1.安全性 2.描述准确性 3.建议(通过/拒绝/需修改)\n\nSKILL.md(摘要):\n${skillMd.slice(0, 1000)}\n\n脚本: ${scriptFiles.join(",")}\n${scriptContent.slice(0, 1500)}`;

      // 调用 OpenClaw 的模型
      const OPENCLAW_JSON = OPENCLAW_JSON_PATH;
      let apiBase = "";
      let apiToken = "";
      let modelId = "";
      try {
        const cfg = JSON.parse(readFileSync(OPENCLAW_JSON, "utf8"));
        const providers = cfg?.models?.providers || {};
        for (const [pid, prov] of Object.entries<any>(providers)) {
          if ((prov?.baseURL || prov?.baseUrl) && prov?.apiKey) {
            apiBase = String(prov.baseURL || prov.baseUrl).replace(/\/$/, "");
            apiToken = String(prov.apiKey);
            const models = Array.isArray(prov.models) ? prov.models : [];
            modelId = models[0]?.id || models[0] || `${pid}/default`;
            if (typeof modelId === "object") modelId = (modelId as any).id || "";
            break;
          }
        }
      } catch {}

      if (!apiBase || !apiToken) {
        res.status(503).json({ error: "未配置模型，无法 AI 审核" });
        return;
      }

      // SSE 流式输出
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const chatUrl = apiBase.match(/\/v[0-9]/) ? `${apiBase}/chat/completions` : `${apiBase}/v1/chat/completions`;
      const apiRes = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          max_tokens: 500,
        }),
      });

      if (!apiRes.ok || !apiRes.body) {
        res.write(`data: ${JSON.stringify({ error: "LLM 调用失败: " + apiRes.status })}\n\n`);
        res.end();
        return;
      }

      const reader = (apiRes.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); continue; }
          try {
            const d = JSON.parse(payload);
            const chunk = d.choices?.[0]?.delta?.content || "";
            if (chunk) res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          } catch {}
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("[ai-review]", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else { try { res.end(); } catch {} }
    }
  });

  // ── 管理员上传开源社区技能包（zip）────────────────────
  app.post("/api/claw/skill-market/upload", async (req, res) => {
    try {
      const ctx = await createContext({ req, res } as any);
      if (!ctx.user || ctx.user.role !== "admin") {
        res.status(403).json({ error: "admin only" });
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        try {
          const buf = Buffer.concat(chunks);
          if (buf.length === 0) { res.status(400).json({ error: "No data" }); return; }
          if (buf.length > MAX_SKILL_PACKAGE_BYTES) { res.status(413).json({ error: "File too large (max 30MB)" }); return; }

          const filename = decodeURIComponent(String(req.header("x-skill-filename") || "uploaded.zip")).trim() || "uploaded.zip";
          const parsed = await parseSkillPackageBuffer(buf, filename);
          const marketDir = openClawSkillMarketDir();
          const uploadId = `upload-${Date.now()}`;
          const tmpZip = path.join("/tmp", `${uploadId}.zip`);
          const finalDir = path.join(marketDir, "pending", `${parsed.skillId}-${uploadId}`);

          writeFileSync(tmpZip, buf);
          try {
            skillInstaller.installFromSource(tmpZip, finalDir);
          } finally {
            try { rmSync(tmpZip, { force: true }); } catch {}
          }

          const { insertSkillMarketItem } = await import("../db");
          const marketItemId = await insertSkillMarketItem({
            skillId: parsed.skillId,
            name: parsed.displayName || parsed.skillId,
            description: parsed.description || null,
            author: "管理员上传",
            authorUserId: ctx.user!.id,
            version: String(parsed.manifest?.version || "1.0.0"),
            category: "general",
            origin: "opensource",
            status: "pending",
            license: String(parsed.manifest?.license || "MIT"),
            packagePath: finalDir,
          });

          res.json({
            ok: true,
            uploadId: parsed.skillId,
            name: parsed.displayName || parsed.skillId,
            description: parsed.description || "",
            path: finalDir,
            marketItemId,
            warnings: parsed.warnings,
          });
        } catch (err: any) {
          console.error("[skill-market upload] failed", err);
          res.status(400).json({ error: String(err?.message || "技能包解析失败") });
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ── 智能体使用量统计（从聊天日志解析）──
  app.get("/api/claw/admin/usage-stats", async (req, res) => {
    try {
      // 简单鉴权
      const { createContext } = await import("./context");
      const ctx = await createContext({ req, res } as any);
      if (!ctx.user || ctx.user.role !== "admin") {
        return res.status(403).json({ error: "admin only" });
      }

      const logPaths = [
        APP_ROOT + "/logs/claw-exec-detail.log",
        APP_ROOT + "/logs/claw-exec.log",
      ];
      const lines = logPaths.flatMap((logPath) => {
        if (!existsSync(logPath)) return [] as string[];
        return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      });
      // 按 adoptId 统计
      const byAdopt: Record<string, UsageBucket> = {};
      const dailyAll: Record<string, number> = {};
      const seen = new Set<string>();
      const isChatUsageEvent = (d: any) => {
        if (d?.event === "chat_stream_response" || d?.event === "ws_chat_response") return true;
        // 兼容旧 tRPC claw.chat 日志；排除管理操作，例如 admin_delete_claw。
        if (d?.event === "claw_exec" && d?.message && d?.message !== "admin_delete_claw") return true;
        return false;
      };
      const usageKey = (d: any) => {
        const sessionKey = d?.sessionKey ? String(d.sessionKey) : "";
        const chatId = d?.chatCompletionId ? String(d.chatCompletionId) : "";
        return [
          d?.event || "",
          d?.adoptId || "",
          d?.ts || "",
          sessionKey,
          chatId,
        ].join("|");
      };

      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          if (!isChatUsageEvent(d)) continue;
          addUsageEvent({
            byAdopt,
            dailyAll,
            seen,
            key: usageKey(d),
            adoptId: d.adoptId || "",
            ts: d.ts || "",
            userId: d.userId || 0,
          });
        } catch {}
      }

      // 查用户名和 runtime agent 映射。OpenClaw 微信 channel 直接进 gateway，
      // 不经过 employee-agent 的聊天接口，所以需要从 trajectory 里补统计。
      let userMap: Record<number, string> = {};
      const agentToAdopt: Record<string, { adoptId: string; userId: number }> = {};
      try {
        const { getDb } = await import("../db");
        const { users, clawAdoptions } = await import("../../drizzle/schema");
        const db = await getDb();
        if (db) {
          const allUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
          for (const u of allUsers) userMap[u.id] = u.name || u.email || String(u.id);
          const claws = await db.select({
            adoptId: clawAdoptions.adoptId,
            agentId: clawAdoptions.agentId,
            userId: clawAdoptions.userId,
          }).from(clawAdoptions);
          for (const claw of claws) {
            const adoptId = String(claw.adoptId || "").trim();
            const userId = Number(claw.userId || 0);
            const configuredAgentId = String(claw.agentId || "").trim();
            if (configuredAgentId) agentToAdopt[configuredAgentId] = { adoptId, userId };
            if (adoptId) agentToAdopt[`trial_${adoptId}`] = { adoptId, userId };
          }
        }
      } catch {}

      try {
        const maxFiles = Math.min(Math.max(Number(process.env.LINGXIA_USAGE_TRAJECTORY_MAX_FILES || 5000), 1), 50000);
        const trajectoryFiles = listTrajectoryFiles(path.join(OPENCLAW_HOME, "agents"), maxFiles);
        for (const filePath of trajectoryFiles) {
          let raw = "";
          try {
            raw = readFileSync(filePath, "utf8");
          } catch {
            continue;
          }
          for (const line of raw.split("\n")) {
            if (!line.includes('"type":"trace.artifacts"') || !line.includes("openclaw-weixin")) continue;
            try {
              const d = JSON.parse(line);
              const sessionKey = String(d?.sessionKey || "");
              if (!sessionKey.includes(":openclaw-weixin:")) continue;
              const runtimeAgentId = runtimeAgentIdFromSessionKey(sessionKey);
              const mapped = agentToAdopt[runtimeAgentId];
              const adoptId = mapped?.adoptId || adoptIdFromRuntimeAgentId(runtimeAgentId);
              if (!adoptId) continue;
              addUsageEvent({
                byAdopt,
                dailyAll,
                seen,
                key: ["trajectory", d?.traceId || "", d?.runId || "", d?.seq || "", sessionKey].join("|"),
                adoptId,
                ts: d?.ts || "",
                userId: mapped?.userId || 0,
              });
            } catch {}
          }
        }
      } catch {}

      // 构建排行
      const adoptions = Object.entries(byAdopt)
        .map(([adoptId, stat]) => ({
          adoptId,
          total: stat.total,
          userId: stat.userId,
          userName: userMap[stat.userId] || String(stat.userId),
          lastActivity: stat.lastTs,
          recent7d: Object.entries(stat.days)
            .filter(([d]) => d >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
            .reduce((s, [, c]) => s + c, 0),
          dailyBreakdown: Object.entries(stat.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14)
            .map(([date, count]) => ({ date, count })),
        }))
        .sort((a, b) => b.total - a.total);

      // 每日全局趋势（最近14天）
      const daily = Object.entries(dailyAll)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 14)
        .map(([date, count]) => ({ date, count }))
        .reverse();

      return res.json({
        adoptions,
        daily,
        summary: {
          totalClaws: adoptions.length,
          totalChats: seen.size,
          activeToday: adoptions.filter(a => a.dailyBreakdown.some(d => d.date === new Date().toISOString().slice(0, 10))).length,
        },
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

}
