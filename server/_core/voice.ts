import express from "express";
import { IncomingMessage, Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import crypto from "crypto";
import { createContext } from "./context";
import path from "path";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import {
  buildRuntimeSessionKey,
  requireClawOwner,
  resolveRuntimeAgentId,
  resolveRuntimeWorkspace,
} from "./helpers";
import { buildChatRequestBody, type PermissionProfile } from "./tool_schema";

function buildRtasrUrl(appId: string, apiKey: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const base = crypto
    .createHash("md5")
    .update(appId + ts)
    .digest("hex");
  const signa = crypto.createHmac("sha1", apiKey).update(base).digest("base64");
  return `wss://rtasr.xfyun.cn/v1/ws?appid=${encodeURIComponent(appId)}&ts=${encodeURIComponent(ts)}&signa=${encodeURIComponent(signa)}&lang=cn`;
}

function extractRtasrText(raw: string): {
  text: string;
  action?: string;
  code?: string;
  desc?: string;
} {
  const msg = JSON.parse(raw);
  const code = String(msg.code ?? "0");
  const action = String(msg.action || "");
  const desc = String(msg.desc || msg.message || "");
  if (code !== "0") return { text: "", action, code, desc };

  let data = msg.data;
  if (typeof data === "string" && data.trim()) {
    try {
      data = JSON.parse(data);
    } catch {}
  }
  const rt = data?.cn?.st?.rt;
  if (!Array.isArray(rt)) return { text: "", action, code, desc };

  const parts: string[] = [];
  for (const item of rt) {
    const ws = Array.isArray(item?.ws) ? item.ws : [];
    for (const word of ws) {
      const cw = Array.isArray(word?.cw) ? word.cw : [];
      for (const candidate of cw) {
        if (candidate?.w) parts.push(String(candidate.w));
      }
    }
  }
  return { text: parts.join("").trim(), action, code, desc };
}

function humanizeRtasrError(code: string, desc: string) {
  if (code === "10105" && /no appid info/i.test(desc)) {
    return "当前讯飞 AppID 没有可用的实时语音转写 RTASR 标准版授权。请在讯飞控制台为该应用开通实时语音转写，或配置该服务对应的 AppID/APIKey。";
  }
  if (code === "10105" && /client_ip/i.test(desc)) {
    return "讯飞实时语音转写拒绝了当前服务器 IP，请检查 RTASR 服务的 IP 白名单。";
  }
  if (code === "10110") {
    return "讯飞实时语音转写未授权或签名无效，请检查 RTASR APIKey 与 AppID 是否匹配。";
  }
  return desc || `讯飞实时转写错误 ${code}`;
}

function safeMeetingName(input: string) {
  return (
    String(input || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80)
      .replace(/^_+|_+$/g, "") || crypto.randomUUID()
  );
}

function safeFileStem(input: string) {
  return (
    String(input || "output")
      .trim()
      .replace(/[\\/:*?"<>|#\r\n\t]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 48)
      .replace(/^_+|_+$/g, "") || "output"
  );
}

const meetingTypeConfig: Record<
  string,
  { label: string; instruction: string }
> = {
  general: {
    label: "普通会议",
    instruction: "突出会议摘要、关键决策、明确待办和待确认问题。",
  },
  project: {
    label: "项目例会",
    instruction: "突出项目进展、里程碑变化、风险阻塞、负责人和下一步计划。",
  },
  client: {
    label: "客户拜访",
    instruction: "突出客户背景、客户诉求、承诺事项、商机风险和后续跟进计划。",
  },
  training: {
    label: "培训纪要",
    instruction: "突出培训主题、核心知识点、现场问题、课后行动和待补充材料。",
  },
  assignment: {
    label: "领导交办",
    instruction: "突出交办事项、验收标准、优先级、截止时间、协作对象和风险点。",
  },
  sales: {
    label: "销售跟进",
    instruction: "突出客户需求、预算/决策链、竞争态势、下一步动作和成交风险。",
  },
  weekly: {
    label: "周会纪要",
    instruction:
      "突出本周进展、下周计划、跨团队依赖、风险问题和需要升级的事项。",
  },
  interview: {
    label: "面试纪要",
    instruction: "突出候选人背景、能力评价、风险疑点、岗位匹配度和后续建议。",
  },
};

function normalizeMeetingType(input: string) {
  const key = String(input || "general").trim();
  return meetingTypeConfig[key] ? key : "general";
}

function extractMeetingTitle(markdown: string, fallback: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!heading) return fallback;
  return heading.replace(/[\\/:*?"<>|#]/g, "").slice(0, 40) || fallback;
}

function stripFirstHeading(markdown: string) {
  return markdown.replace(/^#\s+.+\n+/, "").trim();
}

function countActionItems(markdown: string) {
  const match = markdown.match(/##\s*待办事项\s*\n([\s\S]*?)(?:\n##\s+|$)/);
  const body = match?.[1] || "";
  if (!body || /暂无|无明确|未明确/.test(body)) return 0;
  return body
    .split("\n")
    .filter(line => /^\s*(?:[-*]|\d+[.)]|- \[[ xX]\])\s+/.test(line)).length;
}

function ensureMeetingDirs(workspace: string) {
  const root = path.join(workspace, "meeting-notes");
  const dirs = {
    root,
    audio: path.join(root, "audio"),
    transcripts: path.join(root, "transcripts"),
    summaries: path.join(root, "summaries"),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return dirs;
}

function ensureSingleMeetingDirs(workspace: string, meetingId: string) {
  const safeId = safeMeetingName(meetingId);
  const root = path.join(workspace, "meeting-notes", safeId);
  const outputs = path.join(root, "outputs");
  mkdirSync(outputs, { recursive: true });
  return {
    root,
    outputs,
    relRoot: `meeting-notes/${safeId}`,
    outputRel: (fileName: string) =>
      `meeting-notes/${safeId}/outputs/${fileName}`,
  };
}

function writeMeetingRecord(
  workspace: string,
  recordsRoot: string,
  records: any[],
  record: any
) {
  if (record?.metaPath) {
    try {
      writeFileSync(
        path.join(workspace, record.metaPath),
        JSON.stringify(record, null, 2),
        "utf8"
      );
    } catch {}
  }
  writeMeetingIndex(recordsRoot, [
    record,
    ...records.filter(item => item?.id !== record?.id),
  ]);
}

function meetingRecordForResponse(record: any, adoptId: string) {
  return {
    ...record,
    audioUrl: record.audioPath
      ? `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(record.audioPath)}`
      : "",
    transcriptUrl: record.transcriptPath
      ? `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(record.transcriptPath)}`
      : "",
    summaryUrl: record.summaryPath
      ? `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(record.summaryPath)}`
      : "",
    followups: Array.isArray(record.followups)
      ? record.followups.map((followup: any) => ({
          ...followup,
          outputUrl: followup.outputPath
            ? `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(followup.outputPath)}`
            : "",
        }))
      : [],
  };
}

function readMeetingIndex(root: string): any[] {
  try {
    const p = path.join(root, "index.json");
    if (!existsSync(p)) return [];
    const parsed = JSON.parse(readFileSync(p, "utf8") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMeetingIndex(root: string, records: any[]) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, "index.json"),
    JSON.stringify(records.slice(0, 100), null, 2),
    "utf8"
  );
}

function readRawBody(req: express.Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("audio too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function xfyunOstHeaders(args: {
  url: string;
  method: "POST";
  body: Buffer;
  contentType: string;
}) {
  const apiKey = process.env.XFYUN_API_KEY || "";
  const apiSecret = process.env.XFYUN_API_SECRET || "";
  if (!apiKey || !apiSecret)
    throw new Error("讯飞极速语音转写未配置 APIKey/APISecret");
  const u = new URL(args.url);
  const host = u.host;
  const date = new Date().toUTCString();
  const digest = `SHA-256=${crypto.createHash("sha256").update(args.body).digest("base64")}`;
  const signOrigin = [
    `host: ${host}`,
    `date: ${date}`,
    `${args.method} ${u.pathname} HTTP/1.1`,
    `digest: ${digest}`,
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(signOrigin)
    .digest("base64");
  const authorization = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line digest", signature="${signature}"`;
  return {
    host,
    date,
    digest,
    authorization,
    "content-type": args.contentType,
    "content-length": String(args.body.length),
  };
}

function multipartBody(
  parts: Array<{
    name: string;
    value?: string;
    fileName?: string;
    contentType?: string;
    data?: Buffer;
  }>
) {
  const boundary = `----linggan-${crypto.randomUUID().replace(/-/g, "")}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, "utf8"));
    if (part.data) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName || "audio.pcm"}"\r\n`,
          "utf8"
        )
      );
      chunks.push(
        Buffer.from(
          `Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`,
          "utf8"
        )
      );
      chunks.push(part.data);
      chunks.push(Buffer.from("\r\n", "utf8"));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value || ""}\r\n`,
          "utf8"
        )
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function humanizeOstError(data: any, fallback: string) {
  const code = String(data?.code ?? "");
  const taskId = data?.data?.task_id ? `，任务 ${data.data.task_id}` : "";
  if (code === "20304") {
    return `讯飞没有识别到有效语音${taskId}。请录制 5 秒以上，并确认麦克风输入正常、说话声音足够清晰。`;
  }
  if (code === "10007" || code === "10008") {
    return "讯飞极速语音转写鉴权失败，请检查 AppID、APIKey、APISecret 是否属于同一个应用。";
  }
  return data?.message ? `讯飞极速转写失败: ${data.message}` : fallback;
}

async function xfyunOstPost(url: string, body: Buffer, contentType: string) {
  const headers = xfyunOstHeaders({ url, method: "POST", body, contentType });
  const resp = await fetch(url, { method: "POST", headers, body: body as any });
  const text = await resp.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!resp.ok) {
    throw new Error(
      humanizeOstError(
        data,
        `讯飞极速转写 HTTP ${resp.status}: ${text.slice(0, 300)}`
      )
    );
  }
  if (!data || Number(data.code) !== 0) {
    throw new Error(
      humanizeOstError(
        data,
        `讯飞极速转写失败: ${data?.message || text.slice(0, 300)}`
      )
    );
  }
  return data;
}

function extractOstTranscript(result: any) {
  const lattice = Array.isArray(result?.lattice) ? result.lattice : [];
  const parts: string[] = [];
  for (const segment of lattice) {
    const rt = segment?.json_1best?.st?.rt;
    if (!Array.isArray(rt)) continue;
    for (const item of rt) {
      const ws = Array.isArray(item?.ws) ? item.ws : [];
      for (const word of ws) {
        const cw = Array.isArray(word?.cw) ? word.cw : [];
        for (const candidate of cw) {
          const w = String(candidate?.w || "");
          if (w) parts.push(w);
        }
      }
    }
  }
  return parts.join("").trim();
}

export async function transcribeWithXfyunOst(
  pcmPath: string,
  meetingId: string,
  durationSec: number
) {
  const appId = process.env.XFYUN_APPID || "";
  if (!appId) throw new Error("讯飞极速语音转写未配置 AppID");
  const requestId = safeMeetingName(meetingId);
  const pcm = readFileSync(pcmPath);
  const upload = multipartBody([
    { name: "app_id", value: appId },
    { name: "request_id", value: requestId },
    {
      name: "data",
      fileName: `${requestId}.pcm`,
      contentType: "application/octet-stream",
      data: pcm,
    },
  ]);
  const uploaded = await xfyunOstPost(
    "https://upload-ost-api.xfyun.cn/file/upload",
    upload.body,
    upload.contentType
  );
  const audioUrl = uploaded?.data?.url;
  if (!audioUrl) throw new Error("讯飞极速转写上传成功但未返回 audio_url");

  const createPayload = Buffer.from(
    JSON.stringify({
      common: { app_id: appId },
      business: {
        request_id: requestId,
        language: "zh_cn",
        domain: "pro_ost_ed",
        accent: "mandarin",
        postproc_on: 1,
        smoothproc: true,
        colloqproc: true,
        language_type: 1,
        ...(durationSec > 0 ? { duration: durationSec } : {}),
      },
      data: {
        audio_url: audioUrl,
        audio_src: "http",
        audio_size: pcm.length,
        format: "audio/L16;rate=16000",
        encoding: "raw",
      },
    }),
    "utf8"
  );
  const created = await xfyunOstPost(
    "https://ost-api.xfyun.cn/v2/ost/pro_create",
    createPayload,
    "application/json"
  );
  const taskId = created?.data?.task_id;
  if (!taskId) throw new Error("讯飞极速转写创建任务成功但未返回 task_id");

  const deadline =
    Date.now() + Number(process.env.XFYUN_OST_POLL_TIMEOUT_MS || 180_000);
  let lastMessage = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 4000));
    const queryPayload = Buffer.from(
      JSON.stringify({
        common: { app_id: appId },
        business: { task_id: taskId },
      }),
      "utf8"
    );
    const queried = await xfyunOstPost(
      "https://ost-api.xfyun.cn/v2/ost/query",
      queryPayload,
      "application/json"
    );
    const status = String(queried?.data?.task_status || "");
    lastMessage = queried?.message || status;
    if (status === "3" || status === "4") {
      const transcript = extractOstTranscript(queried?.data?.result);
      if (!transcript) throw new Error("讯飞极速转写完成但结果为空");
      return { transcript, taskId };
    }
  }
  throw new Error(`讯飞极速转写超时: ${lastMessage || taskId}`);
}

export async function summarizeMeetingWithOpenClaw(args: {
  claw: any;
  adoptId: string;
  runtimeAgentId: string;
  meetingId: string;
  meetingType: string;
  transcript: string;
}) {
  const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
  const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  const sessionKey = buildRuntimeSessionKey({
    runtimeAgentId: args.runtimeAgentId,
    channel: "meeting",
    conversationId: args.meetingId,
  });
  const template =
    meetingTypeConfig[normalizeMeetingType(args.meetingType)] ||
    meetingTypeConfig.general;
  const prompt = [
    "请基于以下会议转写生成一份企业会议纪要。",
    "",
    `会议类型：${template.label}`,
    `模板重点：${template.instruction}`,
    "",
    "输出要求：",
    "1. 使用简体中文 Markdown。",
    "2. 第一行必须是一级标题，标题需概括本次会议主题，不超过 18 个汉字，不要使用“会议纪要”这种泛标题。",
    "3. 固定包含以下二级标题：会议摘要、关键决策、待办事项、风险与待确认问题。",
    "4. 待办事项使用列表；每条尽量写清事项、负责人、截止时间。原文没有明确时写“未明确”。",
    "5. 不要编造转写里没有的信息；没有内容的章节写“暂无明确内容”。",
    "",
    "输出格式：",
    "# <会议主题标题>",
    "",
    "## 会议摘要",
    "",
    "## 关键决策",
    "",
    "## 待办事项",
    "",
    "## 风险与待确认问题",
    "",
    "会议转写：",
    args.transcript.slice(0, 60000),
  ].join("\n");
  const rawProfile = String(args.claw?.permissionProfile || "starter");
  const permissionProfile: PermissionProfile =
    rawProfile === "plus" || rawProfile === "internal" ? rawProfile : "starter";
  const body = Buffer.from(
    JSON.stringify(
      buildChatRequestBody({
        message: prompt,
        permissionProfile,
        brandSystemPrompt:
          "你是企业会议纪要助手，负责把会议转写整理成准确、可执行的纪要。",
      })
    ),
    "utf8"
  );

  const httpMod = await import("http");
  return await new Promise<string>((resolve, reject) => {
    const req = httpMod.request(
      {
        hostname: remoteHost,
        port: gatewayPort,
        path: "/v1/chat/completions",
        method: "POST",
        timeout: 0,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          Authorization: `Bearer ${gatewayToken}`,
          "x-openclaw-agent-id": args.runtimeAgentId,
          "x-openclaw-session-key": sessionKey,
        },
      },
      res => {
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
          if (!text) reject(new Error("OpenClaw 会议纪要生成结果为空"));
          else resolve(text);
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(180_000, () =>
      req.destroy(new Error("OpenClaw 会议纪要生成超时"))
    );
    req.write(body);
    req.end();
  });
}

async function askMeetingWithOpenClaw(args: {
  claw: any;
  runtimeAgentId: string;
  meetingId: string;
  title: string;
  summary: string;
  transcript: string;
  question: string;
}) {
  const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
  const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  const sessionKey = buildRuntimeSessionKey({
    runtimeAgentId: args.runtimeAgentId,
    channel: "meeting-followup",
    conversationId: args.meetingId,
  });
  const prompt = [
    "请只基于下面这次会议的纪要和原始转写，完成用户的后续办公处理请求。",
    "",
    "要求：",
    "1. 使用简体中文。",
    "2. 不要编造会议中没有的信息；没有明确内容时说明“会议中未明确”。",
    "3. 如果用户要求生成微信、邮件、周报、PPT 大纲或任务清单，请直接给出可复制使用的成稿。",
    "4. 输出要短而实用，适合企业办公场景。",
    "",
    `会议标题：${args.title}`,
    "",
    "会议纪要：",
    args.summary.slice(0, 30000) || "暂无纪要",
    "",
    "原始转写：",
    args.transcript.slice(0, 50000) || "暂无转写",
    "",
    "用户请求：",
    args.question,
  ].join("\n");
  const rawProfile = String(args.claw?.permissionProfile || "starter");
  const permissionProfile: PermissionProfile =
    rawProfile === "plus" || rawProfile === "internal" ? rawProfile : "starter";
  const body = Buffer.from(
    JSON.stringify(
      buildChatRequestBody({
        message: prompt,
        permissionProfile,
        brandSystemPrompt:
          "你是企业会议后续处理助手，负责把单次会议内容加工成可执行、可复制、可落地的办公材料。",
      })
    ),
    "utf8"
  );

  const httpMod = await import("http");
  return await new Promise<string>((resolve, reject) => {
    const req = httpMod.request(
      {
        hostname: remoteHost,
        port: gatewayPort,
        path: "/v1/chat/completions",
        method: "POST",
        timeout: 0,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          Authorization: `Bearer ${gatewayToken}`,
          "x-openclaw-agent-id": args.runtimeAgentId,
          "x-openclaw-session-key": sessionKey,
        },
      },
      res => {
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
          if (!text) reject(new Error("会议后续处理结果为空"));
          else resolve(text);
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(180_000, () => req.destroy(new Error("会议后续处理超时")));
    req.write(body);
    req.end();
  });
}

export function registerVoiceRoutes(app: express.Express) {
  // ── 语音转文字（讯飞语音听写 WebAPI）──────────────────────────────
  app.post("/api/claw/voice/transcribe", async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        const audioBuffer = Buffer.concat(chunks);
        if (audioBuffer.length === 0) {
          res.status(400).json({ error: "No audio data" });
          return;
        }
        if (audioBuffer.length > 50 * 1024 * 1024) {
          res.status(413).json({ error: "Audio too large" });
          return;
        }

        const appId = process.env.XFYUN_APPID || "";
        const apiSecret = process.env.XFYUN_API_SECRET || "";
        const apiKey = process.env.XFYUN_API_KEY || "";
        if (!appId || !apiSecret || !apiKey) {
          res.status(503).json({ error: "讯飞语音服务未配置" });
          return;
        }

        // 1) 用 ffmpeg 将 webm 转为 PCM 16k 16bit mono
        const { execSync } = await import("child_process");
        const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
        const tmpIn = `/tmp/voice_${Date.now()}.webm`;
        const tmpOut = `/tmp/voice_${Date.now()}.pcm`;
        writeFileSync(tmpIn, audioBuffer);
        try {
          execSync(
            `ffmpeg -y -i ${tmpIn} -ar 16000 -ac 1 -f s16le ${tmpOut} 2>/dev/null`
          );
        } catch (e) {
          try {
            unlinkSync(tmpIn);
          } catch {}
          res
            .status(400)
            .json({ error: "音频格式转换失败，请确认 ffmpeg 已安装" });
          return;
        }
        const pcmBuffer = readFileSync(tmpOut);
        try {
          unlinkSync(tmpIn);
          unlinkSync(tmpOut);
        } catch {}

        // 2) 构建讯飞签名 URL
        const crypto = await import("crypto");
        const host = "iat-api.xfyun.cn";
        const path = "/v2/iat";
        const date = new Date().toUTCString();
        const signOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
        const hmac = crypto.createHmac("sha256", apiSecret);
        hmac.update(signOrigin);
        const sha = hmac.digest("base64");
        const authOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sha}"`;
        const authorization = Buffer.from(authOrigin).toString("base64");
        const wsUrl = `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;

        // 3) WebSocket 连接讯飞
        const { WebSocket: WS } = await import("ws");
        const textParts: string[] = [];

        await new Promise<void>((resolve, reject) => {
          const ws = new WS(wsUrl);
          let offset = 0;
          const FRAME = 1280; // 40ms at 16kHz 16bit
          let frameIdx = 0;
          let sendTimer: any = null;

          ws.on("open", () => {
            // 分帧发送 PCM
            sendTimer = setInterval(() => {
              if (offset >= pcmBuffer.length) {
                // 最后一帧
                const lastFrame =
                  offset < pcmBuffer.length
                    ? pcmBuffer.subarray(offset)
                    : Buffer.alloc(0);
                ws.send(
                  JSON.stringify({
                    common: frameIdx === 0 ? { app_id: appId } : undefined,
                    business:
                      frameIdx === 0
                        ? {
                            language: "zh_cn",
                            domain: "iat",
                            accent: "mandarin",
                            vad_eos: 3000,
                            dwa: "wpgs",
                          }
                        : undefined,
                    data: {
                      status: 2,
                      format: "audio/L16;rate=16000",
                      encoding: "raw",
                      audio: lastFrame.toString("base64"),
                    },
                  })
                );
                clearInterval(sendTimer);
                return;
              }
              const end = Math.min(offset + FRAME, pcmBuffer.length);
              const frame = pcmBuffer.subarray(offset, end);
              const status = frameIdx === 0 ? 0 : 1;
              ws.send(
                JSON.stringify({
                  common: frameIdx === 0 ? { app_id: appId } : undefined,
                  business:
                    frameIdx === 0
                      ? {
                          language: "zh_cn",
                          domain: "iat",
                          accent: "mandarin",
                          vad_eos: 3000,
                          dwa: "wpgs",
                        }
                      : undefined,
                  data: {
                    status,
                    format: "audio/L16;rate=16000",
                    encoding: "raw",
                    audio: frame.toString("base64"),
                  },
                })
              );
              offset = end;
              frameIdx++;
            }, 40);
          });

          ws.on("message", (raw: any) => {
            try {
              const msg = JSON.parse(String(raw));
              if (msg.code !== 0) {
                console.error("[xfyun] error:", msg.code, msg.message);
                ws.close();
                reject(new Error(msg.message || "讯飞识别错误 " + msg.code));
                return;
              }
              const wsArr = msg.data?.result?.ws || [];
              for (const w of wsArr) {
                for (const cw of w.cw || []) {
                  textParts.push(cw.w || "");
                }
              }
              if (msg.data?.status === 2) {
                ws.close();
                resolve();
              }
            } catch {}
          });

          ws.on("error", (err: any) => {
            if (sendTimer) clearInterval(sendTimer);
            reject(err);
          });

          ws.on("close", () => {
            if (sendTimer) clearInterval(sendTimer);
          });

          // 超时保护
          setTimeout(() => {
            try {
              ws.close();
            } catch {}
            resolve();
          }, 30000);
        });

        const text = textParts.join("").trim();
        res.json({ text });
      });
    } catch (err: any) {
      console.error("[voice] error:", err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
  });

  // -- 文字转语音（讯飞超拟人语音合成）--
  app.post("/api/claw/voice/tts", async (req, res) => {
    try {
      let text = String((req.body as any)?.text || "").trim();
      if (!text) {
        res.status(400).json({ error: "No text" });
        return;
      }
      if (text.length > 2000) text = text.slice(0, 2000);

      const appId = process.env.XFYUN_APPID || "";
      const apiSecret = process.env.XFYUN_API_SECRET || "";
      const apiKey = process.env.XFYUN_API_KEY || "";
      if (!appId || !apiSecret || !apiKey) {
        res.status(503).json({ error: "TTS service not configured" });
        return;
      }

      const crypto = await import("crypto");
      const host = "cbm01.cn-huabei-1.xf-yun.com";
      const wsPath = "/v1/private/mcd9m97e6";
      const date = new Date().toUTCString();
      const signOrigin = `host: ${host}\ndate: ${date}\nGET ${wsPath} HTTP/1.1`;
      const hmac = crypto.createHmac("sha256", apiSecret);
      hmac.update(signOrigin);
      const sha = hmac.digest("base64");
      const authOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sha}"`;
      const authorization = Buffer.from(authOrigin).toString("base64");
      const wsUrl = `wss://${host}${wsPath}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;

      const { WebSocket: WS } = await import("ws");
      const audioParts: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WS(wsUrl);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              header: { app_id: appId, status: 2 },
              parameter: {
                oral: { oral_level: "mid" },
                tts: {
                  vcn: "x6_lingxiaoxuan_pro",
                  speed: 50,
                  volume: 50,
                  pitch: 50,
                  bgs: 0,
                  reg: 0,
                  rdn: 0,
                  rhy: 0,
                  audio: {
                    encoding: "lame",
                    sample_rate: 24000,
                    channels: 1,
                    bit_depth: 16,
                    frame_size: 0,
                  },
                },
              },
              payload: {
                text: {
                  encoding: "utf8",
                  compress: "raw",
                  format: "plain",
                  status: 2,
                  seq: 0,
                  text: Buffer.from(text, "utf8").toString("base64"),
                },
              },
            })
          );
        });

        ws.on("message", (raw: any) => {
          try {
            const msg = JSON.parse(String(raw));
            const code = msg.header?.code ?? msg.code;
            if (code !== undefined && code !== 0) {
              console.error(
                "[tts] xfyun error:",
                code,
                msg.header?.message || msg.message
              );
              ws.close();
              reject(
                new Error(
                  msg.header?.message || msg.message || "TTS error " + code
                )
              );
              return;
            }
            const audioData = msg.payload?.audio?.audio || msg.data?.audio;
            if (audioData) {
              audioParts.push(Buffer.from(audioData, "base64"));
            }
            const status =
              msg.header?.status ??
              msg.payload?.audio?.status ??
              msg.data?.status;
            if (status === 2) {
              ws.close();
              resolve();
            }
          } catch {}
        });

        ws.on("error", (err: any) => reject(err));
        setTimeout(() => {
          try {
            ws.close();
          } catch {}
          resolve();
        }, 30000);
      });

      const audioBuffer = Buffer.concat(audioParts);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length);
      res.send(audioBuffer);
    } catch (err: any) {
      console.error("[tts] error:", err);
      res.status(500).json({ error: err.message || "TTS error" });
    }
  });

  app.get("/api/claw/meeting-notes/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const dirs = ensureMeetingDirs(resolveRuntimeWorkspace(claw, adoptId));
      const records = readMeetingIndex(dirs.root).map(record =>
        meetingRecordForResponse(record, adoptId)
      );
      res.json({ records });
    } catch (err: any) {
      console.error("[meeting-notes] list error:", err);
      res.status(500).json({ error: err.message || "list failed" });
    }
  });

  app.post("/api/claw/meeting-notes/process", async (req, res) => {
    try {
      const adoptId = String(
        req.query.adoptId || req.headers["x-adopt-id"] || ""
      ).trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const audioBuffer = await readRawBody(
        req,
        Number(process.env.MEETING_NOTES_MAX_AUDIO_BYTES || 50 * 1024 * 1024)
      );
      if (audioBuffer.length < 100) {
        res.status(400).json({ error: "audio required" });
        return;
      }

      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const runtimeAgentId = resolveRuntimeAgentId(
        adoptId,
        String((claw as any).agentId || "")
      );
      const dirs = ensureMeetingDirs(workspace);
      const meetingId = safeMeetingName(
        String(req.query.meetingId || crypto.randomUUID())
      );
      const meetingDirs = ensureSingleMeetingDirs(workspace, meetingId);
      const createdAt = new Date().toISOString();
      const durationSec = Math.max(
        0,
        Math.round(
          Number(
            req.headers["x-meeting-duration"] || req.query.duration || 0
          ) || 0
        )
      );
      const meetingType = normalizeMeetingType(
        String(
          req.query.meetingType || req.headers["x-meeting-type"] || "general"
        )
      );
      const meetingTypeLabel =
        meetingTypeConfig[meetingType]?.label ||
        meetingTypeConfig.general.label;
      const contentType = String(
        req.headers["content-type"] || "audio/webm"
      ).toLowerCase();
      const audioExt =
        contentType.includes("mpeg") || contentType.includes("mp3")
          ? "mp3"
          : contentType.includes("mp4") || contentType.includes("m4a")
            ? "m4a"
            : contentType.includes("aac")
              ? "aac"
              : contentType.includes("wav")
                ? "wav"
                : contentType.includes("ogg")
                  ? "ogg"
                  : "webm";
      const audioRel = `${meetingDirs.relRoot}/audio.${audioExt}`;
      const pcmRel = `${meetingDirs.relRoot}/audio.pcm`;
      const transcriptRel = `${meetingDirs.relRoot}/transcript.md`;
      const summaryRel = `${meetingDirs.relRoot}/summary.md`;
      const metaRel = `${meetingDirs.relRoot}/meta.json`;
      const audioPath = path.join(workspace, audioRel);
      const pcmPath = path.join(workspace, pcmRel);
      const transcriptPath = path.join(workspace, transcriptRel);
      const summaryPath = path.join(workspace, summaryRel);
      const metaPath = path.join(workspace, metaRel);
      writeFileSync(audioPath, audioBuffer);

      try {
        execFileSync(
          "ffmpeg",
          [
            "-y",
            "-i",
            audioPath,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "s16le",
            pcmPath,
          ],
          { timeout: 180_000, stdio: "ignore" }
        );
      } catch {
        res
          .status(400)
          .json({ error: "音频格式转换失败，请确认录音文件可被 ffmpeg 解析" });
        return;
      }

      const pcmBytes = statSync(pcmPath).size;
      const actualDurationSec = pcmBytes / (16000 * 2);
      if (actualDurationSec < 5) {
        res
          .status(400)
          .json({
            error: "录音太短或没有有效语音，请至少录制 5 秒后再生成会议纪要。",
          });
        return;
      }

      const { transcript, taskId } = await transcribeWithXfyunOst(
        pcmPath,
        meetingId,
        durationSec
      );
      const transcriptMd = [
        `# 会议转写 ${meetingId}`,
        "",
        `- 时间：${createdAt}`,
        `- 时长：${durationSec || "未记录"} 秒`,
        `- 讯飞任务：${taskId}`,
        "",
        "## 原始转写",
        "",
        transcript,
        "",
      ].join("\n");
      writeFileSync(transcriptPath, transcriptMd, "utf8");

      const summary = await summarizeMeetingWithOpenClaw({
        claw,
        adoptId,
        runtimeAgentId,
        meetingId,
        meetingType,
        transcript,
      });
      const fallbackTitle = `${new Date(createdAt).toLocaleString("zh-CN", { hour12: false })} ${meetingTypeLabel}`;
      const title = extractMeetingTitle(summary, fallbackTitle);
      const summaryBody = stripFirstHeading(summary);
      const actionItemsCount = countActionItems(summaryBody);
      const summaryMd = [
        `# ${title}`,
        "",
        `- 时间：${createdAt}`,
        `- 时长：${durationSec || "未记录"} 秒`,
        `- 类型：${meetingTypeLabel}`,
        `- 待办：${actionItemsCount} 项`,
        "",
        summaryBody,
        "",
      ].join("\n");
      writeFileSync(summaryPath, summaryMd, "utf8");

      const record = {
        id: meetingId,
        title,
        createdAt,
        durationSec,
        audioPath: audioRel,
        pcmPath: pcmRel,
        transcriptPath: transcriptRel,
        summaryPath: summaryRel,
        transcript,
        summary: summaryBody,
        meetingType,
        meetingTypeLabel,
        actionItemsCount,
        meetingDir: meetingDirs.relRoot,
        metaPath: metaRel,
        followups: [],
        asr: { provider: "xfyun-ost", taskId },
        summarizer: {
          provider: "openclaw",
          sessionKey: buildRuntimeSessionKey({
            runtimeAgentId,
            channel: "meeting",
            conversationId: meetingId,
          }),
        },
      };
      writeFileSync(metaPath, JSON.stringify(record, null, 2), "utf8");
      const nextIndex = [
        record,
        ...readMeetingIndex(dirs.root).filter(item => item?.id !== meetingId),
      ].slice(0, 100);
      writeMeetingIndex(dirs.root, nextIndex);

      res.json({
        record: {
          ...record,
          audioUrl: `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(audioRel)}`,
          transcriptUrl: `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(transcriptRel)}`,
          summaryUrl: `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(summaryRel)}`,
        },
      });
    } catch (err: any) {
      console.error("[meeting-notes] process error:", err);
      const message = err?.message || "meeting notes process failed";
      const statusCode =
        /有效语音|录音太短|audio required|audio too large|音频格式转换失败/.test(
          message
        )
          ? 400
          : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  app.post("/api/claw/meeting-notes/ask", async (req, res) => {
    try {
      const adoptId = String(
        req.query.adoptId || req.headers["x-adopt-id"] || ""
      ).trim();
      const meetingId = safeMeetingName(
        String((req.body as any)?.meetingId || req.query.meetingId || "")
      );
      const question = String((req.body as any)?.question || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      if (!meetingId) {
        res.status(400).json({ error: "meetingId required" });
        return;
      }
      if (!question) {
        res.status(400).json({ error: "question required" });
        return;
      }
      if (question.length > 4000) {
        res.status(400).json({ error: "问题太长，请缩短后再试" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const dirs = ensureMeetingDirs(workspace);
      const records = readMeetingIndex(dirs.root);
      const record = records.find(item => item?.id === meetingId);
      if (!record) {
        res.status(404).json({ error: "会议纪要不存在" });
        return;
      }
      const runtimeAgentId = resolveRuntimeAgentId(
        adoptId,
        String((claw as any).agentId || "")
      );
      const answer = await askMeetingWithOpenClaw({
        claw,
        runtimeAgentId,
        meetingId,
        title: String(record.title || "会议纪要"),
        summary: String(record.summary || ""),
        transcript: String(record.transcript || ""),
        question,
      });
      const followup = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        question,
        answer,
      };
      const meetingDirs = ensureSingleMeetingDirs(workspace, meetingId);
      const outputName = `${new Date(followup.createdAt).toISOString().replace(/[:.]/g, "-")}-${safeFileStem(question)}.md`;
      const outputPath = meetingDirs.outputRel(outputName);
      const outputMd = [
        `# ${String(record.title || "会议后续处理")}`,
        "",
        `- 时间：${followup.createdAt}`,
        `- 请求：${question}`,
        "",
        answer,
        "",
      ].join("\n");
      writeFileSync(path.join(workspace, outputPath), outputMd, "utf8");
      (followup as any).outputPath = outputPath;
      (followup as any).outputUrl =
        `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(outputPath)}`;
      record.followups = [
        followup,
        ...(Array.isArray(record.followups) ? record.followups : []),
      ].slice(0, 50);
      writeMeetingRecord(workspace, dirs.root, records, record);
      res.json({ followup });
    } catch (err: any) {
      console.error("[meeting-notes] ask error:", err);
      res.status(500).json({ error: err.message || "meeting followup failed" });
    }
  });

  app.post("/api/claw/meeting-notes/followup/rename", async (req, res) => {
    try {
      const adoptId = String(
        req.query.adoptId || req.headers["x-adopt-id"] || ""
      ).trim();
      const meetingId = safeMeetingName(
        String((req.body as any)?.meetingId || "")
      );
      const followupId = String((req.body as any)?.followupId || "").trim();
      const nextName = safeFileStem(String((req.body as any)?.name || ""));
      if (!adoptId || !meetingId || !followupId || !nextName) {
        res
          .status(400)
          .json({ error: "adoptId/meetingId/followupId/name required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const dirs = ensureMeetingDirs(workspace);
      const records = readMeetingIndex(dirs.root);
      const record = records.find(item => item?.id === meetingId);
      const followups = Array.isArray(record?.followups)
        ? record.followups
        : [];
      const followup = followups.find((item: any) => item?.id === followupId);
      if (!record || !followup) {
        res.status(404).json({ error: "派生结果不存在" });
        return;
      }
      if (!followup.outputPath) {
        res.status(400).json({ error: "该派生结果没有文件" });
        return;
      }
      const oldRel = String(followup.outputPath);
      const oldAbs = path.join(workspace, oldRel);
      if (
        !oldRel.startsWith(`meeting-notes/${meetingId}/outputs/`) ||
        !existsSync(oldAbs)
      ) {
        res.status(404).json({ error: "派生结果文件不存在" });
        return;
      }
      const newRel = `meeting-notes/${meetingId}/outputs/${nextName.endsWith(".md") ? nextName : `${nextName}.md`}`;
      const newAbs = path.join(workspace, newRel);
      if (oldRel !== newRel) {
        if (existsSync(newAbs)) {
          res.status(409).json({ error: "目标文件名已存在" });
          return;
        }
        const fs = await import("fs");
        fs.renameSync(oldAbs, newAbs);
        followup.outputPath = newRel;
      }
      followup.outputUrl = `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(followup.outputPath)}`;
      writeMeetingRecord(workspace, dirs.root, records, record);
      res.json({ record: meetingRecordForResponse(record, adoptId), followup });
    } catch (err: any) {
      console.error("[meeting-notes] followup rename error:", err);
      res.status(500).json({ error: err.message || "rename failed" });
    }
  });

  app.post("/api/claw/meeting-notes/followup/delete", async (req, res) => {
    try {
      const adoptId = String(
        req.query.adoptId || req.headers["x-adopt-id"] || ""
      ).trim();
      const meetingId = safeMeetingName(
        String((req.body as any)?.meetingId || "")
      );
      const followupId = String((req.body as any)?.followupId || "").trim();
      if (!adoptId || !meetingId || !followupId) {
        res
          .status(400)
          .json({ error: "adoptId/meetingId/followupId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const dirs = ensureMeetingDirs(workspace);
      const records = readMeetingIndex(dirs.root);
      const record = records.find(item => item?.id === meetingId);
      const followups = Array.isArray(record?.followups)
        ? record.followups
        : [];
      const followup = followups.find((item: any) => item?.id === followupId);
      if (!record || !followup) {
        res.status(404).json({ error: "派生结果不存在" });
        return;
      }
      if (
        followup.outputPath &&
        String(followup.outputPath).startsWith(
          `meeting-notes/${meetingId}/outputs/`
        )
      ) {
        try {
          const fs = await import("fs");
          fs.rmSync(path.join(workspace, String(followup.outputPath)), {
            force: true,
          });
        } catch {}
      }
      record.followups = followups.filter(
        (item: any) => item?.id !== followupId
      );
      writeMeetingRecord(workspace, dirs.root, records, record);
      res.json({ record: meetingRecordForResponse(record, adoptId) });
    } catch (err: any) {
      console.error("[meeting-notes] followup delete error:", err);
      res.status(500).json({ error: err.message || "delete failed" });
    }
  });

  app.post("/api/claw/meeting-notes/summarize", async (req, res) => {
    try {
      const transcript = String((req.body as any)?.transcript || "").trim();
      if (!transcript) {
        res.status(400).json({ error: "transcript required" });
        return;
      }
      const clipped = transcript.slice(0, 30000);
      const { llmText } = await import("./llm-provider");
      const summary = await llmText(
        [
          {
            role: "system",
            content:
              "你是企业会议纪要助手。请根据会议转写生成结构清晰、可执行的中文会议纪要，不要编造转写中没有的信息。",
          },
          {
            role: "user",
            content: [
              "请整理以下会议转写，输出 Markdown，包含：",
              "1. 会议摘要",
              "2. 关键决策",
              "3. 待办事项（负责人/截止时间未知就写未明确）",
              "4. 风险与待确认问题",
              "",
              "会议转写：",
              clipped,
            ].join("\n"),
          },
        ],
        { maxTokens: 1800, temperature: 0.2 }
      );
      res.json({ summary: summary.trim() || "未能生成纪要。" });
    } catch (err: any) {
      console.error("[meeting-notes] summarize error:", err);
      res.status(500).json({ error: err.message || "summary failed" });
    }
  });
}

export function registerVoiceWsRoutes(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/api/claw/voice/rtasr") return;

    try {
      const fakeRes = {
        setHeader: () => {},
        getHeader: () => undefined,
      } as any;
      const ctx = await createContext({
        req: req as any,
        res: fakeRes,
        info: {} as any,
      });
      if (!ctx.user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const adoptId = url.searchParams.get("adoptId") || "";
      if (!adoptId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const { getClawByAdoptId } = await import("../db");
      const claw = await getClawByAdoptId(adoptId);
      if (!claw || claw.userId !== ctx.user.id) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit("connection", ws, req, { adoptId, userId: ctx.user!.id });
      });
    } catch (err) {
      console.error("[rtasr] upgrade error:", err);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on(
    "connection",
    (
      client: WebSocket,
      _req: IncomingMessage,
      meta: { adoptId: string; userId: number }
    ) => {
      const appId = process.env.XFYUN_APPID || "";
      const apiKey = process.env.XFYUN_API_KEY || "";
      if (!appId || !apiKey) {
        client.send(
          JSON.stringify({ type: "error", error: "讯飞实时转写未配置" })
        );
        client.close();
        return;
      }

      const upstream = new WebSocket(buildRtasrUrl(appId, apiKey));
      let upstreamReady = false;
      let ended = false;
      let queue = Buffer.alloc(0);
      let flushTimer: NodeJS.Timeout | null = null;
      const FRAME_BYTES = 1280;

      const sendClient = (payload: unknown) => {
        if (client.readyState === WebSocket.OPEN)
          client.send(JSON.stringify(payload));
      };
      const cleanup = () => {
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = null;
        try {
          if (
            upstream.readyState === WebSocket.OPEN ||
            upstream.readyState === WebSocket.CONNECTING
          )
            upstream.close();
        } catch {}
        try {
          if (client.readyState === WebSocket.OPEN) client.close();
        } catch {}
      };
      const flushFrame = () => {
        if (!upstreamReady || upstream.readyState !== WebSocket.OPEN) return;
        if (queue.length >= FRAME_BYTES) {
          upstream.send(queue.subarray(0, FRAME_BYTES));
          queue = queue.subarray(FRAME_BYTES);
          return;
        }
        if (ended) {
          if (queue.length > 0) {
            upstream.send(queue);
            queue = Buffer.alloc(0);
          }
          upstream.send(Buffer.from(JSON.stringify({ end: true })));
          if (flushTimer) clearInterval(flushTimer);
          flushTimer = null;
        }
      };

      upstream.on("open", () => {
        sendClient({ type: "connecting" });
      });
      upstream.on("message", raw => {
        try {
          const parsed = extractRtasrText(String(raw));
          if (parsed.code && parsed.code !== "0") {
            sendClient({
              type: "error",
              error: humanizeRtasrError(parsed.code, parsed.desc || ""),
            });
            cleanup();
            return;
          }
          if (parsed.text) sendClient({ type: "text", text: parsed.text });
          if (parsed.action === "started") {
            upstreamReady = true;
            if (!flushTimer) flushTimer = setInterval(flushFrame, 40);
            sendClient({ type: "ready" });
          }
        } catch (err: any) {
          console.warn("[rtasr] parse warning:", err?.message || err);
        }
      });
      upstream.on("error", err => {
        console.error("[rtasr] upstream error:", err);
        sendClient({
          type: "error",
          error: err.message || "讯飞实时转写连接失败",
        });
        cleanup();
      });
      upstream.on("close", () => {
        sendClient({ type: "done" });
        cleanup();
      });

      client.on("message", (data, isBinary) => {
        if (isBinary) {
          queue = Buffer.concat([queue, Buffer.from(data as Buffer)]);
          return;
        }
        try {
          const msg = JSON.parse(String(data));
          if (msg?.type === "end") ended = true;
        } catch {}
      });
      client.on("close", () => {
        ended = true;
        if (!queue.length) cleanup();
      });
      client.on("error", cleanup);

      console.log("[rtasr] connected:", meta.adoptId, "user=", meta.userId);
    }
  );
}
