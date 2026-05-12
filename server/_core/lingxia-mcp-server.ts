#!/usr/bin/env node
/**
 * lingxia-mcp-server.ts — 灵虾平台 MCP Server
 * 
 * 通过 MCP 协议向 OpenClaw Gateway 暴露平台能力：
 * - create_scheduled_task: 创建定时任务
 * - send_notification: 发送通知到用户渠道
 * - get_user_channels: 查询可用渠道
 */
import { readFileSync } from "fs";
import { INTERNAL_BASE_URL as BASE } from "./helpers";

const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
const ADOPT_ID = process.env.LINGXIA_ADOPT_ID || "";

// MCP stdio protocol: read JSON-RPC from stdin, write to stdout
let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) { buffer = buffer.slice(headerEnd + 4); continue; }
    const contentLength = parseInt(contentLengthMatch[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;
    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);
    try {
      const msg = JSON.parse(body);
      handleMessage(msg);
    } catch {}
  }
});

function send(msg: any) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

function sendResult(id: any, result: any) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: any, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const TOOLS = [
  {
    name: "create_scheduled_task",
    description: "Create a recurring scheduled task. Use when user wants daily checks, periodic reminders, or automated reports. Results can be delivered to WeChat, WeCom, Feishu, Webhook, or in-chat.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short task name" },
        message: { type: "string", description: "The instruction to execute each time" },
        cron_expr: { type: "string", description: "Cron expression (min hour day month weekday). Examples: '30 10 * * *' = daily 10:30, '0 9 * * 1-5' = weekdays 9:00, '*/30 * * * *' = every 30 min" },
        delivery_channel: { type: "string", enum: ["conversation", "weixin", "wecom", "feishu", "webhook"], description: "Where to deliver results. Default: conversation" },
      },
      required: ["name", "message", "cron_expr"],
    },
  },
  {
    name: "send_notification",
    description: "Send a one-time message to the user via a connected channel (WeChat, WeCom, Feishu, Webhook). Use when user asks to 'send to my WeChat' or 'notify me'.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["weixin", "wecom", "feishu", "webhook"], description: "Target channel" },
        content: { type: "string", description: "Message content" },
      },
      required: ["channel", "content"],
    },
  },
  {
    name: "get_user_channels",
    description: "Check which notification channels the user has connected. Always call this before creating tasks or sending notifications to verify channel availability.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function handleMessage(msg: any) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "lingxia-platform", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized") return; // no response needed

  if (method === "tools/list") {
    sendResult(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const adoptId = ADOPT_ID;

    if (!adoptId) {
      sendResult(id, { content: [{ type: "text", text: "Error: LINGXIA_ADOPT_ID not set" }], isError: true });
      return;
    }

    try {
      if (toolName === "get_user_channels") {
        const channels: string[] = ["conversation"];
        try {
          const wxResp = await fetch(`${BASE}/api/claw/weixin/status?adoptId=${encodeURIComponent(adoptId)}`, { headers: { "X-Internal-Key": INTERNAL_KEY } });
          const wxData = await wxResp.json() as any;
          if (wxData?.bound) channels.push("weixin");
        } catch {}
        try {
          const nResp = await fetch(`${BASE}/api/claw/notify/config?adoptId=${encodeURIComponent(adoptId)}`, { headers: { "X-Internal-Key": INTERNAL_KEY } });
          const nData = await nResp.json() as any;
          const cfg = nData?.config || {};
          if (cfg.wecom?.enabled) channels.push("wecom");
          if (cfg.feishu?.enabled) channels.push("feishu");
          if (cfg.webhook?.enabled) channels.push("webhook");
        } catch {}
        sendResult(id, { content: [{ type: "text", text: `Available channels: ${channels.join(", ")}` }] });
        return;
      }

      if (toolName === "create_scheduled_task") {
        const cronExpr = args.cron_expr || "0 9 * * *";
        const deliveryChannel = args.delivery_channel || "conversation";
        const job = {
          name: String(args.name || "scheduled task"),
          description: String(args.message || "").slice(0, 100),
          enabled: true,
          schedule: { kind: "cron", expr: cronExpr },
          payload: { kind: "agentTurn", message: String(args.message || "") },
          sessionTarget: "isolated",
          delivery: { mode: "announce", to: deliveryChannel, ...(deliveryChannel !== "conversation" ? { channel: deliveryChannel } : {}) },
        };
        const resp = await fetch(`${BASE}/api/claw/cron/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
          body: JSON.stringify({ adoptId, job }),
        });
        const data = await resp.json() as any;
        if (!resp.ok) {
          sendResult(id, { content: [{ type: "text", text: `Failed: ${data?.error || resp.status}` }], isError: true });
        } else {
          sendResult(id, { content: [{ type: "text", text: `Scheduled task "${job.name}" created. Cron: ${cronExpr}, delivery: ${deliveryChannel}. User can manage it in the Schedule page.` }] });
        }
        return;
      }

      if (toolName === "send_notification") {
        const channel = String(args.channel || "weixin");
        const content = String(args.content || "");
        if (!content) { sendResult(id, { content: [{ type: "text", text: "Error: content is empty" }], isError: true }); return; }

        if (channel === "weixin") {
          // Call weixin bridge via HTTP
          const resp = await fetch(`${BASE}/api/claw/weixin/test`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
            body: JSON.stringify({ adoptId, message: content }),
          });
          if (!resp.ok) {
            sendResult(id, { content: [{ type: "text", text: "WeChat send failed" }], isError: true });
          } else {
            sendResult(id, { content: [{ type: "text", text: "Sent to WeChat successfully" }] });
          }
        } else {
          const resp = await fetch(`${BASE}/api/claw/notify/test`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
            body: JSON.stringify({ adoptId, channel, message: content }),
          });
          if (!resp.ok) {
            sendResult(id, { content: [{ type: "text", text: `Send via ${channel} failed` }], isError: true });
          } else {
            sendResult(id, { content: [{ type: "text", text: `Sent via ${channel} successfully` }] });
          }
        }
        return;
      }

      sendResult(id, { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true });
    } catch (e: any) {
      sendResult(id, { content: [{ type: "text", text: `Error: ${e?.message || String(e)}` }], isError: true });
    }
    return;
  }

  // Unknown method
  if (id) sendError(id, -32601, `Method not found: ${method}`);
}
