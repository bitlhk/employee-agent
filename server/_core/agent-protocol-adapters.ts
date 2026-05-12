import type express from "express";
import { randomUUID } from "crypto";

type ProtocolAdapterInput = {
  providerType: "mcp" | "a2a";
  adapterProtocol: string;
  agentId: string;
  apiUrl: string;
  apiToken?: string | null;
  remoteAgentId?: string | null;
  endpointConfig: Record<string, any>;
  message: string;
  res: express.Response;
  appendDelta?: (text: string) => void;
};

type JsonRpcResponse = {
  id?: string | number | null;
  result?: any;
  error?: { code?: number; message?: string; data?: any };
};

function sseData(res: express.Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof (res as any).flush === "function") (res as any).flush();
}

function status(res: express.Response, text: string) {
  sseData(res, { __status: text });
}

function delta(res: express.Response, text: string, appendDelta?: (text: string) => void) {
  if (!text) return;
  appendDelta?.(text);
  sseData(res, {
    id: `protocol-adapter-${Date.now()}`,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
}

function authHeaders(token?: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function endpoint(baseUrl: string, pathValue?: string) {
  if (!pathValue) return baseUrl;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = String(pathValue || "").replace(/^\//, "");
  return new URL(path, base).toString();
}

function formatToolText(text: string) {
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj?.results)) {
      const lines: string[] = [];
      if (obj.query) lines.push(`查询：${obj.query}`);
      if (obj.answer) lines.push("", String(obj.answer));
      lines.push("", "搜索结果：");
      obj.results.slice(0, 8).forEach((item: any, idx: number) => {
        const title = String(item?.title || item?.url || `结果 ${idx + 1}`);
        const url = String(item?.url || "");
        const content = String(item?.content || item?.raw_content || "").replace(/\s+/g, " ").trim();
        lines.push(`${idx + 1}. ${url ? `[${title}](${url})` : title}`);
        if (content) lines.push(`   ${content.slice(0, 260)}${content.length > 260 ? "..." : ""}`);
      });
      return lines.join("\n");
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return text;
  }
}

function parseSseJson(text: string): any[] {
  const out: any[] = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    if (dataLines.length === 0) continue;
    const joined = dataLines.join("\n");
    try { out.push(JSON.parse(joined)); } catch {}
  }
  return out;
}

async function postJsonRpc(url: string, body: Record<string, any>, headers: Record<string, string> = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const sessionId = r.headers.get("mcp-session-id") || r.headers.get("Mcp-Session-Id") || undefined;
  const raw = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${raw.slice(0, 300)}`);
  const contentType = r.headers.get("content-type") || "";
  const parsed = contentType.includes("text/event-stream")
    ? parseSseJson(raw).pop()
    : JSON.parse(raw || "{}");
  const resp = parsed as JsonRpcResponse;
  if (resp?.error) throw new Error(resp.error.message || `JSON-RPC error ${resp.error.code || ""}`.trim());
  return { resp, sessionId, raw };
}

function extractMcpText(result: any) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const texts = content
    .map((item: any) => {
      if (item?.type === "text" && typeof item.text === "string") return formatToolText(item.text);
      if (typeof item?.text === "string") return formatToolText(item.text);
      return "";
    })
    .filter(Boolean);
  if (texts.length > 0) return texts.join("\n");
  if (result?.structuredContent) return JSON.stringify(result.structuredContent, null, 2);
  if (result && typeof result === "object") return JSON.stringify(result, null, 2);
  return String(result || "");
}

function extractA2AText(value: any): string {
  const texts: string[] = [];
  const visit = (node: any) => {
    if (!node) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    if ((node.kind === "text" || node.type === "text") && typeof node.text === "string") {
      texts.push(node.text);
      return;
    }
    if (Array.isArray(node.parts)) visit(node.parts);
    if (Array.isArray(node.artifacts)) visit(node.artifacts);
    if (node.message) visit(node.message);
    if (node.status?.message) visit(node.status.message);
    if (node.result) visit(node.result);
  };
  visit(value);
  return texts.join("\n").trim();
}

async function runMcpToolsV1(input: ProtocolAdapterInput) {
  const rpcUrl = endpoint(input.apiUrl, input.endpointConfig.rpcPath ?? input.endpointConfig.path ?? "/mcp");
  const baseHeaders: Record<string, string> = {
    ...authHeaders(input.apiToken),
  };
  status(input.res, "MCP: 初始化连接...");
  const init = await postJsonRpc(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: input.endpointConfig.protocolVersion || "2025-06-18",
      capabilities: {},
      clientInfo: { name: "lingxia-agent-plaza", version: "1.0.0" },
    },
  }, baseHeaders);

  const headers = init.sessionId ? { ...baseHeaders, "mcp-session-id": init.sessionId } : baseHeaders;
  await postJsonRpc(rpcUrl, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, headers)
    .catch(() => null);

  status(input.res, "MCP: 发现工具...");
  const toolsResp = await postJsonRpc(rpcUrl, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, headers);
  const tools = Array.isArray(toolsResp.resp.result?.tools) ? toolsResp.resp.result.tools : [];
  const toolName = String(input.endpointConfig.toolName || input.remoteAgentId || tools[0]?.name || "").trim();
  if (!toolName) throw new Error("MCP endpoint has no callable tool; configure endpointConfig.toolName");

  const staticArgs = input.endpointConfig.arguments && typeof input.endpointConfig.arguments === "object"
    ? input.endpointConfig.arguments
    : {};
  const messageParam = String(input.endpointConfig.messageParam || "message");
  const args = { ...staticArgs, [messageParam]: input.message };
  status(input.res, `MCP: 调用 ${toolName}...`);
  const callResp = await postJsonRpc(rpcUrl, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  }, headers);
  delta(input.res, extractMcpText(callResp.resp.result), input.appendDelta);
}

async function runA2ATaskV1(input: ProtocolAdapterInput) {
  const rpcUrl = endpoint(input.apiUrl, input.endpointConfig.rpcPath ?? input.endpointConfig.path ?? "");
  const method = input.endpointConfig.stream === true ? "message/stream" : "message/send";
  status(input.res, `A2A: ${method}...`);
  const message = {
    role: "user",
    messageId: randomUUID(),
    parts: [{ kind: "text", text: input.message }],
  };
  const rpc = await postJsonRpc(rpcUrl, {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    params: { message },
  }, authHeaders(input.apiToken));
  const text = extractA2AText(rpc.resp.result) || JSON.stringify(rpc.resp.result || {}, null, 2);
  delta(input.res, text, input.appendDelta);
}

export async function runProtocolAgentAdapter(input: ProtocolAdapterInput) {
  if (input.providerType === "mcp" && input.adapterProtocol === "mcp-tools-v1") {
    await runMcpToolsV1(input);
    return;
  }
  if (input.providerType === "a2a" && input.adapterProtocol === "a2a-task-v1") {
    await runA2ATaskV1(input);
    return;
  }
  throw new Error(`${input.providerType}/${input.adapterProtocol} is not supported`);
}
