import express from "express";
import { existsSync } from "fs";
import { clawChatLimiter } from "./security";
import { resolveRequesterUserId } from "./helpers";
import path from "path";

export function registerBusinessRoutes(app: express.Express) {
  // ── Stock Analysis WebUI: 静态文件本地 serve + API 代理 ──────────────
  const stockStaticDir = path.resolve(process.cwd(), "stock-webui");

  // API 请求代理到 stock analysis 服务（8188）
  // 注入 X-Owner-Id header → 后端按用户隔离 portfolio_* 表
  app.use("/api/claw/stock-webui/api", async (req: any, res: any) => {
    const http = await import("http");
    const targetPath = "/api" + req.url;
    const userId = await resolveRequesterUserId(req, res);
    if (!userId) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Login required to access stock-webui API" });
      return;
    }
    const ownerId = `lingxia_user_${userId}`;
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: 8188,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: "127.0.0.1:8188", "x-owner-id": ownerId },
    }, (proxyRes: any) => {
      const headers = { ...proxyRes.headers };
      delete headers["transfer-encoding"];
      // 防止跨用户切换时浏览器/SPA cache 命中陈旧数据
      headers["cache-control"] = "no-store, no-cache, must-revalidate";
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res, { end: true });
    });
    proxyReq.on("error", (err: any) => {
      console.error("[STOCK-API] proxy error:", err.message);
      if (!res.headersSent) res.status(502).json({ error: "Stock API unavailable" });
    });
    req.pipe(proxyReq, { end: true });
  });

  // 静态文件直接从本地 serve（CSS/JS/图片，秒加载）
  app.use("/api/claw/stock-webui", express.static(stockStaticDir, { maxAge: "7d" }));

  // SPA fallback: 非文件请求返回 index.html
  app.use("/api/claw/stock-webui", (_req: any, res: any) => {
    const indexPath = path.join(stockStaticDir, "index.html");
    if (existsSync(indexPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: "Stock WebUI not installed" });
    }
  });

  const legacyAgentPlazaArchived = (_req: express.Request, res: express.Response) => {
    return res.status(410).json({
      error: "LEGACY_AGENT_PLAZA_ARCHIVED",
      message: "旧智能体广场接口已归档。外部 Agent 请使用 /api/claw/agents/available 和 /api/claw/agent-tasks。",
    });
  };
  app.get("/api/claw/business-agents", legacyAgentPlazaArchived);

  // ── 旧智能体广场聊天接口已归档 ───────────────────────────────────────
  // POST /api/claw/business-chat-stream { agentId, message, sessionKey? }
  app.post("/api/claw/business-chat-stream", clawChatLimiter, legacyAgentPlazaArchived);

  // ── 旧智能体广场工作文件夹接口已归档 ─────────────────────────────────
  const legacyBusinessFilesArchived = (_req: express.Request, res: express.Response) => {
    return res.status(410).json({
      error: "LEGACY_BUSINESS_FILES_ARCHIVED",
      message: "旧智能体广场工作文件夹接口已归档。请使用当前工作空间文件接口或外部 Agent 任务结果。",
    });
  };
  app.get("/api/claw/business-files", legacyBusinessFilesArchived);
  app.get("/api/claw/business-files/download", legacyBusinessFilesArchived);
  app.delete("/api/claw/business-files", legacyBusinessFilesArchived);
  app.get("/api/claw/remote-file", legacyBusinessFilesArchived);
}
