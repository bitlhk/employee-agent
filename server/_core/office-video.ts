import express from "express";
import http from "http";
import path from "path";
import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import {
  buildRuntimeSessionKey,
  requireClawOwner,
  resolveRuntimeAgentId,
  resolveRuntimeWorkspace,
  sanitizeRelPath,
} from "./helpers";
import { buildChatRequestBody, type PermissionProfile } from "./tool_schema";

type VideoOutlineRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "completed" | "error";
  videoUrl: string;
  instruction: string;
  requestPath?: string;
  outlinePath?: string;
  outline?: string;
  error?: string;
};

const MAX_RECORDS = 100;

function safeTaskId(input: string) {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80) || crypto.randomUUID();
}

function safeFileStem(input: string) {
  return String(input || "video-outline")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50) || "video-outline";
}

function safeUrl(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 2000) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeRel(input: unknown) {
  const rel = sanitizeRelPath(String(input || ""));
  if (!rel || rel.includes("..")) return null;
  return rel;
}

function ensureVideoRoot(workspace: string) {
  const rootRel = "office/video-outline";
  const root = path.join(workspace, rootRel);
  mkdirSync(root, { recursive: true });
  return { root, rootRel };
}

function ensureTaskDirs(workspace: string, taskId: string) {
  const safeId = safeTaskId(taskId);
  const relRoot = `office/video-outline/${safeId}`;
  const absRoot = path.join(workspace, relRoot);
  const outputs = path.join(absRoot, "outputs");
  mkdirSync(outputs, { recursive: true });
  return {
    id: safeId,
    relRoot,
    absRoot,
    rel: (name: string) => `${relRoot}/${name}`,
    outputRel: (name: string) => `${relRoot}/outputs/${name}`,
  };
}

function readVideoIndex(root: string): VideoOutlineRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeVideoIndex(root: string, records: VideoOutlineRecord[]) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "index.json"), JSON.stringify(records.slice(0, MAX_RECORDS), null, 2), "utf8");
}

function upsertRecord(workspace: string, record: VideoOutlineRecord) {
  const { root } = ensureVideoRoot(workspace);
  const records = readVideoIndex(root);
  writeVideoIndex(root, [record, ...records.filter((item) => item?.id !== record.id)]);
  const taskDirs = ensureTaskDirs(workspace, record.id);
  writeFileSync(path.join(taskDirs.absRoot, "meta.json"), JSON.stringify(record, null, 2), "utf8");
}

function recordForResponse(record: VideoOutlineRecord, adoptId: string): VideoOutlineRecord & {
  outlineUrl?: string;
} {
  return {
    ...record,
    outlineUrl: record.outlinePath
      ? `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(record.outlinePath)}`
      : undefined,
  };
}

async function callOpenClawOffice(args: {
  claw: any;
  runtimeAgentId: string;
  sessionChannel: string;
  sessionConversationId: string;
  prompt: string;
  brandSystemPrompt: string;
  timeoutMs?: number;
}) {
  const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
  const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  const sessionKey = buildRuntimeSessionKey({
    runtimeAgentId: args.runtimeAgentId,
    channel: args.sessionChannel,
    conversationId: args.sessionConversationId,
  });
  const rawProfile = String(args.claw?.permissionProfile || "starter");
  const permissionProfile: PermissionProfile =
    rawProfile === "plus" || rawProfile === "internal" ? rawProfile : "starter";
  const body = Buffer.from(JSON.stringify(buildChatRequestBody({
    message: args.prompt,
    permissionProfile,
    brandSystemPrompt: args.brandSystemPrompt,
  })), "utf8");

  return await new Promise<string>((resolve, reject) => {
    const req = http.request({
      hostname: remoteHost,
      port: gatewayPort,
      path: "/v1/chat/completions",
      method: "POST",
      timeout: 0,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length,
        "Authorization": `Bearer ${gatewayToken}`,
        "x-openclaw-agent-id": args.runtimeAgentId,
        "x-openclaw-session-key": sessionKey,
      },
    }, (res) => {
      let buffer = "";
      let out = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content || "";
            if (delta) out += delta;
          } catch {}
        }
      });
      res.on("end", () => {
        const text = out.trim();
        if (!text) reject(new Error("OpenClaw 返回结果为空"));
        else resolve(text);
      });
    });
    req.on("error", reject);
    req.setTimeout(args.timeoutMs || 300_000, () => req.destroy(new Error("OpenClaw 视频提纲生成超时")));
    req.write(body);
    req.end();
  });
}

function buildVideoOutlinePrompt(args: {
  videoUrl: string;
  instruction: string;
  outlinePath: string;
}) {
  return [
    "你是企业学习与研究助手。请根据用户提供的视频链接，生成可归档的学习提纲。",
    "",
    "处理原则：",
    "1. 优先尝试读取视频页面、公开字幕、transcript、简介、章节、评论摘要或可搜索到的公开资料。",
    "2. 如果能拿到 transcript，请以 transcript 为主；如果只能拿到页面信息或搜索结果，请明确标注“未获取完整转写”。",
    "3. 不要声称你已经观看了视频画面；除非确实有逐字稿或页面资料，否则只能基于可获得文本分析。",
    "4. 对登录后可见、付费课程、无字幕或无法访问的链接，要说明限制，并给出用户可上传音频/视频后的处理建议。",
    "5. 不要编造讲者观点、时间戳或课程内容；不确定的内容放到“待确认”。",
    "",
    "视频链接：",
    args.videoUrl,
    "",
    "用户要求：",
    args.instruction || "分析主要内容，并形成适合复习和汇报的提纲。",
    "",
    "请输出 Markdown，固定包含以下章节：",
    "# 视频提纲",
    "## 基本信息",
    "列出标题、来源平台、链接、讲者/频道、时长、发布时间；未知则写未知。",
    "## 内容可得性",
    "说明是否获取到完整转写、字幕、页面正文或仅能获取公开摘要。",
    "## 三句话摘要",
    "## 详细提纲",
    "按主题或章节组织；有可靠时间戳时再写时间戳。",
    "## 关键观点",
    "## 可执行启发",
    "## 适合写进报告或 PPT 的要点",
    "## 待确认与局限",
    "",
    `同时请把同样内容写入工作空间文件：${args.outlinePath}`,
  ].join("\n");
}

export function registerOfficeVideoRoutes(app: express.Express) {
  app.get("/api/claw/office/video-outline/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const { root } = ensureVideoRoot(workspace);
      res.json({ records: readVideoIndex(root).map((record) => recordForResponse(record, adoptId)) });
    } catch (err: any) {
      console.error("[office-video] list error:", err);
      res.status(500).json({ error: err.message || "list failed" });
    }
  });

  app.post("/api/claw/office/video-outline/generate", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || req.headers["x-adopt-id"] || "").trim();
      const body = (req.body || {}) as any;
      const taskId = safeTaskId(String(body.taskId || crypto.randomUUID()));
      const videoUrl = safeUrl(body.videoUrl);
      const instruction = String(body.instruction || "").trim().slice(0, 5000);
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      if (!videoUrl) return res.status(400).json({ error: "请输入有效的视频链接" });

      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const runtimeAgentId = resolveRuntimeAgentId(adoptId, String((claw as any).agentId || ""));
      const taskDirs = ensureTaskDirs(workspace, taskId);
      const createdAt = new Date().toISOString();
      const requestPath = taskDirs.rel("request.md");
      const outlinePath = taskDirs.outputRel("video-outline.md");
      const host = new URL(videoUrl).hostname.replace(/^www\./, "");
      const title = `${safeFileStem(host)} 视频提纲`;

      writeFileSync(path.join(workspace, requestPath), [
        `# ${title}`,
        "",
        `- 时间：${createdAt}`,
        `- 视频链接：${videoUrl}`,
        "",
        "## 用户要求",
        "",
        instruction || "分析主要内容，并形成适合复习和汇报的提纲。",
        "",
      ].join("\n"), "utf8");

      const outline = await callOpenClawOffice({
        claw,
        runtimeAgentId,
        sessionChannel: "office-video-outline",
        sessionConversationId: taskId,
        prompt: buildVideoOutlinePrompt({ videoUrl, instruction, outlinePath }),
        brandSystemPrompt: "你是企业学习与研究助手，负责把公开视频、课程或网页视频资料整理成可信、可归档的提纲。",
        timeoutMs: 360_000,
      });
      writeFileSync(path.join(workspace, outlinePath), `${outline}\n`, "utf8");

      const record: VideoOutlineRecord = {
        id: taskId,
        title,
        createdAt,
        updatedAt: new Date().toISOString(),
        status: "completed",
        videoUrl,
        instruction,
        requestPath: safeRel(requestPath) || requestPath,
        outlinePath,
        outline,
      };
      upsertRecord(workspace, record);
      res.json({ record: recordForResponse(record, adoptId) });
    } catch (err: any) {
      console.error("[office-video] generate error:", err);
      res.status(500).json({ error: err.message || "视频提纲生成失败" });
    }
  });
}
