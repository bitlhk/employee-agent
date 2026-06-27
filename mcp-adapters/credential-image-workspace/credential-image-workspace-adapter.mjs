#!/usr/bin/env node
/**
 * credential-image-workspace-adapter.mjs
 *
 * Workspace-scoped MCP adapter for credential image extraction.
 * It accepts only workspace-relative file paths, reads the file locally,
 * converts it to base64/data URI, and calls the upstream credential MCP.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_PROTOCOL_VERSION = "2025-03-26";

function loadLocalEnv() {
  for (const name of [".env", "credential-image-workspace-adapter.env"]) {
    const envPath = join(__dirname, name);
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      const value = t.slice(i + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadLocalEnv();

const HOST = process.env.CREDENTIAL_WORKSPACE_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.CREDENTIAL_WORKSPACE_MCP_PORT || 17898);
const UPSTREAM = (process.env.CRED_UPSTREAM_URL || "http://1.92.221.155:8005").replace(/\/+$/, "");
const TOKEN = process.env.CRED_UPSTREAM_TOKEN || "";
const SERVICE_ROOTS = (process.env.CREDENTIAL_JIUWEN_SERVICE_ROOTS
  || "/root/.jiuwenswarm/service_linggan_shanghai,/root/.jiuwenswarm/service_linggan,/home/ubuntu/.jiuwenswarm/service_linggan")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const ALLOWED_EXTENSIONS = new Set((process.env.CREDENTIAL_ALLOWED_EXTENSIONS
  || ".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.pdf")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean));
const MAX_FILE_BYTES = Number(process.env.CREDENTIAL_MAX_FILE_BYTES || 10 * 1024 * 1024);
const IMAGE_MAX_WIDTH = Number(process.env.CREDENTIAL_IMAGE_MAX_WIDTH || 1280);
const IMAGE_JPEG_QUALITY = Number(process.env.CREDENTIAL_IMAGE_JPEG_QUALITY || 82);
const UPSTREAM_IMAGE_FIELD = process.env.CREDENTIAL_UPSTREAM_IMAGE_FIELD || "images";
const UPSTREAM_IMAGE_FORMAT = process.env.CREDENTIAL_UPSTREAM_IMAGE_FORMAT || "data_uri";

const TASK_TO_UPSTREAM_TOOL = {
  classify: process.env.CREDENTIAL_UPSTREAM_CLASSIFY_TOOL || "classification",
  extract_fields: process.env.CREDENTIAL_UPSTREAM_EXTRACT_TOOL || "credential-extractor",
  generate_prompt: process.env.CREDENTIAL_UPSTREAM_PROMPT_TOOL || "credential-prompt-generator",
};

const TOOLS = [
  {
    name: "credential_image_extract_from_workspace",
    description: "读取当前 Agent 工作目录内的凭证图片或 PDF，安全转换后调用凭证识别服务。只允许 workspace 相对路径，不允许访问其他目录。",
    inputSchema: {
      type: "object",
      properties: {
        workspace_relative_path: {
          type: "string",
          description: "当前 Agent workspace 内的相对文件路径，例如 images/boarding-pass.jpg。",
        },
        document_type: {
          type: "string",
          description: "凭证类型，未知可填 auto。",
          default: "auto",
        },
        task: {
          type: "string",
          enum: ["extract_fields", "classify", "generate_prompt"],
          description: "处理任务类型。",
          default: "extract_fields",
        },
        question: {
          type: "string",
          description: "可选，用户对提取结果的具体要求。",
        },
        agent_id: {
          type: "string",
          description: "可选，本地 smoke 使用。生产建议依赖 x-jiuwen-channel-id 可信 header。",
        },
        max_width: {
          type: "number",
          description: "可选，图片最大宽度。",
        },
        jpeg_quality: {
          type: "number",
          description: "可选，JPEG 压缩质量。",
        },
      },
      required: ["workspace_relative_path"],
      additionalProperties: false,
    },
  },
];

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function contentText(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

function normalizeAgentId(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/^agent_/, "");
  if (s.startsWith("jiuwen_lgj-")) return s;
  if (s.startsWith("lgj-")) return `jiuwen_${s}`;
  if (s.startsWith("jiuwen_")) return s;
  return s;
}

function agentIdFromHeaders(headers) {
  return normalizeAgentId(
    headers["x-jiuwen-channel-id"]
    || headers["x-linggan-agent-id"]
    || headers["x-openclaw-agent-id"]
    || ""
  );
}

function resolveWorkspaceRoot(args, headers) {
  const agentId = normalizeAgentId(args?.agent_id) || agentIdFromHeaders(headers);
  if (!agentId) {
    throw new Error("missing agent identity: require x-jiuwen-channel-id header or agent_id for local smoke");
  }
  const candidates = SERVICE_ROOTS.map(root => resolve(root, `agent_${agentId}`, "agent", "jiuwenclaw_workspace"));
  const found = candidates.find(p => existsSync(p));
  if (!found) {
    throw new Error(`workspace not found for ${agentId}; checked ${candidates.join(", ")}`);
  }
  return { agentId, workspaceRoot: found };
}

function resolveWorkspaceFile(workspaceRoot, relPath) {
  if (!relPath || typeof relPath !== "string") throw new Error("workspace_relative_path is required");
  if (relPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relPath)) throw new Error("absolute paths are not allowed");
  const clean = relPath.replace(/\\/g, "/");
  if (clean.split("/").some(part => part === "..")) throw new Error("path traversal is not allowed");
  const filePath = resolve(workspaceRoot, clean);
  const root = resolve(workspaceRoot);
  if (!(filePath === root || filePath.startsWith(root + sep))) {
    throw new Error("path escapes workspace");
  }
  const ext = extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file extension ${ext || "(none)"}`);
  }
  const st = statSync(filePath);
  if (!st.isFile()) throw new Error("path is not a file");
  if (st.size > MAX_FILE_BYTES) throw new Error(`file too large: ${st.size} bytes > ${MAX_FILE_BYTES}`);
  return { filePath, ext, size: st.size };
}

function mimeForExt(ext) {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

async function encodeFile(file, args) {
  let buf = readFileSync(file.filePath);
  let mime = mimeForExt(file.ext);
  let transformed = false;
  if (mime.startsWith("image/")) {
    const sharp = await loadSharp();
    if (sharp) {
      const maxWidth = Math.max(256, Math.min(4096, Number(args?.max_width || IMAGE_MAX_WIDTH)));
      const quality = Math.max(40, Math.min(95, Number(args?.jpeg_quality || IMAGE_JPEG_QUALITY)));
      buf = await sharp(buf).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      mime = "image/jpeg";
      transformed = true;
    }
  }
  const base64 = buf.toString("base64");
  const payload = UPSTREAM_IMAGE_FORMAT === "base64" ? base64 : `data:${mime};base64,${base64}`;
  return { payload, mime, transformed, encodedBytes: buf.length };
}

function buildUpstreamArguments(args, encoded, fileMeta) {
  return {
    [UPSTREAM_IMAGE_FIELD]: [encoded.payload],
    document_type: args.document_type || "auto",
    task: args.task || "extract_fields",
    question: args.question || "",
    source: {
      type: "workspace_file",
      relative_path: args.workspace_relative_path,
      mime: encoded.mime,
      original_bytes: fileMeta.size,
      encoded_bytes: encoded.encodedBytes,
      transformed: encoded.transformed,
    },
  };
}

function sanitizeJsonRpc(msg) {
  if (Array.isArray(msg)) return msg.map(sanitizeJsonRpc);
  if (msg && typeof msg === "object") {
    if ("result" in msg && msg.error === null) delete msg.error;
  }
  return msg;
}

async function callUpstreamTool(toolName, upstreamArgs, headers) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: upstreamArgs },
  });
  const h = { "content-type": "application/json" };
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  for (const key of ["x-jiuwen-channel-id", "x-linggan-agent-id", "x-openclaw-agent-id"]) {
    if (headers[key]) h[key] = String(headers[key]);
  }
  const resp = await fetch(`${UPSTREAM}/mcp`, {
    method: "POST",
    headers: h,
    body,
    signal: AbortSignal.timeout(Number(process.env.CREDENTIAL_UPSTREAM_TIMEOUT_MS || 120_000)),
  });
  const text = await resp.text();
  let data;
  try {
    data = sanitizeJsonRpc(JSON.parse(text));
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`upstream HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function callTool(name, args, headers) {
  if (name !== "credential_image_extract_from_workspace") {
    throw new Error(`unknown tool: ${name}`);
  }
  const task = args?.task || "extract_fields";
  const upstreamTool = TASK_TO_UPSTREAM_TOOL[task];
  if (!upstreamTool) throw new Error(`unsupported task: ${task}`);
  const { agentId, workspaceRoot } = resolveWorkspaceRoot(args, headers);
  const file = resolveWorkspaceFile(workspaceRoot, args.workspace_relative_path);
  const encoded = await encodeFile(file, args);
  const upstreamArgs = buildUpstreamArguments(args, encoded, file);
  const upstream = await callUpstreamTool(upstreamTool, upstreamArgs, headers);
  return {
    ok: true,
    adapter: "credential-image-workspace",
    agentId,
    workspaceRelativePath: args.workspace_relative_path,
    upstreamTool,
    source: {
      mime: encoded.mime,
      originalBytes: file.size,
      encodedBytes: encoded.encodedBytes,
      transformed: encoded.transformed,
    },
    upstream,
  };
}

async function handleJsonRpc(body, headers) {
  const { jsonrpc, id, method, params } = body || {};
  if (jsonrpc !== "2.0") return rpcError(id ?? null, -32600, "Invalid Request: jsonrpc version must be 2.0");
  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "credential-image-workspace-adapter", version: "0.1.0" },
        });
      case "notifications/initialized":
        return null;
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments || {};
        const tool = TOOLS.find(t => t.name === name);
        if (!tool) return rpcError(id, -32602, `Invalid params: tool '${name}' not found`);
        const result = await callTool(name, args, headers);
        return rpcResult(id, contentText(result));
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32000, e?.message || String(e));
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    let upstream = "unknown";
    try {
      const r = await fetch(`${UPSTREAM}/health`, { signal: AbortSignal.timeout(3000) });
      upstream = r.ok ? "ok" : `http ${r.status}`;
    } catch {
      upstream = "unreachable";
    }
    json(res, 200, {
      status: "ok",
      name: "credential-image-workspace-adapter",
      port: PORT,
      upstream,
      serviceRoots: SERVICE_ROOTS,
    });
    return;
  }
  if (req.method !== "POST" || !/^\/mcp\/?$/.test(req.url || "")) {
    json(res, 404, { error: "not found" });
    return;
  }
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const result = Array.isArray(body)
      ? (await Promise.all(body.map(item => handleJsonRpc(item, req.headers)))).filter(Boolean)
      : await handleJsonRpc(body, req.headers);
    if (result === null) {
      res.writeHead(204);
      res.end();
      return;
    }
    json(res, 200, result);
  } catch (e) {
    json(res, 400, rpcError(null, -32700, `Parse error: ${e?.message || e}`));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`credential-image-workspace-adapter listening on http://${HOST}:${PORT} -> ${UPSTREAM}`);
});
