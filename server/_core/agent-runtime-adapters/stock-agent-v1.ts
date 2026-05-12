import type express from "express";
import * as http from "http";
import { auditTenantAccess, beginTenantSession } from "../tenant-isolation";
import type { ResponseAccumulator } from "../response-accumulator";

type BeginTenantSessionFn = typeof beginTenantSession;
type AuditTenantAccessFn = typeof auditTenantAccess;

type StockAgentConfig = {
  apiUrl?: string | null;
};

export type RunStockAgentV1Input = {
  userId: number;
  agentId: string;
  message: string;
  userAgent?: string;
  bizAgent: StockAgentConfig;
  endpointConfig: Record<string, any>;
  req: express.Request;
  res: express.Response;
  memAcc: ResponseAccumulator;
  beginTenantSessionFn?: BeginTenantSessionFn;
  auditTenantAccessFn?: AuditTenantAccessFn;
};

export async function runStockAgentV1(input: RunStockAgentV1Input): Promise<void> {
  const {
    userId,
    agentId,
    message,
    userAgent,
    bizAgent,
    endpointConfig,
    req,
    res,
    memAcc,
    beginTenantSessionFn = beginTenantSession,
    auditTenantAccessFn = auditTenantAccess,
  } = input;

  const tenantCtxStock = await beginTenantSessionFn(
    userId, agentId, "chat_send",
    { message_length: message.length, ua: userAgent }
  );
  const stockSessionKey = tenantCtxStock.sessionKey;
  console.log("[STOCK] starting chat stream", { agentId, session: stockSessionKey, tenant: tenantCtxStock.tenantShort });
  const stockUrl = new URL(bizAgent.apiUrl || "http://127.0.0.1:8188");

  const KRONOS_KEY = process.env.KRONOS_API_KEY || "";
  const KRONOS_HINT = KRONOS_KEY ? ("\n\n[平台工具] 你可以调用 Kronos 量化预测 API 获取价格预测数据：" +
    `\ncurl -s -X POST http://127.0.0.1:8190/api/v1/predict -H 'Content-Type: application/json' -H 'X-API-Key: ${KRONOS_KEY}' -d '{"symbol":"股票代码","horizon":5}'` +
    "\n返回：current_price(当前价) + signal(BUY/SELL/HOLD) + predictions(未来N天预测+置信区间)" +
    "\nA股代码直接用6位数字（如600036），美股用代码（如AAPL）。" +
    "\n在分析报告中融入预测数据时，必须注明'基于 Kronos 模型的量化预测，仅供参考，不构成投资建议'。\n") : "";
  const stockBody = JSON.stringify({
    message: message + KRONOS_HINT,
    session_id: stockSessionKey,
  });

  const stockHeartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: stock-keepalive ${Date.now()}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    } else {
      clearInterval(stockHeartbeat);
    }
  }, 5000);
  res.write(`: stock-start ${Date.now()}\n\n`);
  if (typeof (res as any).flush === "function") (res as any).flush();

  const stockReq = http.request({
    hostname: stockUrl.hostname,
    port: parseInt(String(stockUrl.port || "8188"), 10),
    path: String(endpointConfig.path || "/api/v1/agent/chat/stream"),
    method: "POST",
    timeout: 0,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(stockBody),
    },
  }, (stockRes: http.IncomingMessage) => {
    let buf = "";

    stockRes.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const evt = JSON.parse(raw);
          const evtType = evt.type || "";

          if (evtType === "done") {
            const content = evt.content || "";
            res.write(`data: ${JSON.stringify({
              choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
            })}\n\n`);
            res.write(`data: [DONE]\n\n`);
          } else if (evtType === "tool_start") {
            res.write(`data: ${JSON.stringify({
              __status: `${evt.display_name || evt.tool || "tool"}: 执行中...`,
            })}\n\n`);
          } else if (evtType === "tool_done") {
            res.write(`data: ${JSON.stringify({
              __status: `${evt.display_name || evt.tool || "tool"}: 完成`,
            })}\n\n`);
          } else if (evtType === "thinking" || evtType === "generating") {
            res.write(`data: ${JSON.stringify({
              __status: evtType === "thinking" ? "分析思考中..." : "生成报告中...",
            })}\n\n`);
          } else if (evtType === "error") {
            res.write(`data: ${JSON.stringify({ error: evt.message || "Stock analysis failed" })}\n\n`);
            res.write(`data: [DONE]\n\n`);
          }
        } catch (_) {}
      }
      if (typeof (res as any).flush === "function") (res as any).flush();
    });

    stockRes.on("end", () => {
      console.log("[STOCK] stream ended");
      clearInterval(stockHeartbeat);
      auditTenantAccessFn(tenantCtxStock, "chat_done", {}).catch(() => {});
      memAcc.flush();
      if (!res.writableEnded) { res.write(`data: [DONE]\n\n`); res.end(); }
    });
  });

  stockReq.on("error", (err: Error) => {
    console.error("[STOCK] request error:", err.message);
    clearInterval(stockHeartbeat);
    if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  });
  req.on("close", () => { clearInterval(stockHeartbeat); stockReq.destroy(); });
  stockReq.write(stockBody);
  stockReq.end();
}
