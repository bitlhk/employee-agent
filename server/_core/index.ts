import "dotenv/config";
// 全局异常捕获：防止 uncaught exception 导致服务崩溃，并打印完整 stack 方便排查
process.on("uncaughtException", (err: Error) => {
  console.error("[UNCAUGHT EXCEPTION] Shutting down gracefully...");
  console.error("Error:", err?.message);
  console.error("Stack:", err?.stack);
  // 给 PM2/systemd 5 秒优雅退出，然后重启干净的进程
  setTimeout(() => process.exit(1), 5000);
});
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[UNHANDLED REJECTION]", reason);
});
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import compression from "compression";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerVoiceRoutes } from "./voice";
import { startRecycler } from "./recycler";
import { registerCronRoutes } from "./claw-cron";
import { registerNotifyRoutes } from "./claw-notify";
import { registerWeixinRoutes } from "./claw-weixin";
import { registerFeishuRoutes } from "./claw-feishu";
import { registerSkillRoutes } from "./claw-skills";
import { registerCollabRoutes } from "./claw-collab";
import { registerBusinessRoutes } from "./claw-business";
import { registerSkillConfigRoutes } from "./claw-skill-config";
import { registerToolsPolicyRoutes } from "./claw-tools-policy";
import { registerCoreFileRoutes } from "./claw-core-files";
import { registerMemoryRoutes } from "./claw-memory";
import { registerDownloadRoutes } from "./claw-downloads";
import { registerFilesRoutes } from "./claw-files";
import { registerSandboxRoutes } from "./claw-sandbox";
import { registerChatStreamRoutes } from "./claw-chat";
import { registerRecoverRoutes } from "./claw-recover";
import { registerCoopUploadRoutes } from "./coop-upload";
import { registerWSProxy } from "./claw-ws-proxy";
import { registerIframeRoutes } from "./claw-iframe";
import { registerMiscRoutes } from "./claw-misc";
import { registerAuditExportRoutes } from "./audit-export-routes";
import { registerAgentClusterLabRoutes } from "../_routes/agent-cluster-lab";
import { registerTaskWorkbenchLabRoutes } from "../_routes/task-workbench-lab";
import { APP_ROOT } from "./helpers";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getClientIp } from "./ip-utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  setupSecurityHeaders,
  generalLimiter,
  authLimiter,
  strictLimiter,
  clawChatLimiter,
  detectSuspiciousActivity,
  requestSizeLimiter,
  ipBlacklistMiddleware,
} from "./security";
import {
  block4xxAbuse,
  trackResponseErrors,
} from "./error-tracking";
import { sandboxExec, sandboxHealthCheck } from "./sandbox";
import { routeTool, type ToolContext } from "./tool_router";
import { buildChatRequestBody, type PermissionProfile } from "./tool_schema";


// 检查端口是否可用，如果被占用则抛出错误（不自动切换端口）
async function checkPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve());
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Please stop the process using this port or change the PORT environment variable.`));
      } else {
        reject(err);
      }
    });
  });
}



async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // ========== 信任代理配置 ==========
  // 如果应用部署在代理服务器（如 nginx）后面，需要信任代理以正确获取客户端IP
  // 开发环境：信任所有代理（localhost 场景）
  // 生产环境：根据实际情况配置信任的代理IP
  if (process.env.TRUST_PROXY === "true" || process.env.NODE_ENV !== "production") {
    app.set("trust proxy", true);
    console.log("[Server] Trust proxy enabled");
  } else if (process.env.TRUST_PROXY) {
    // 可以设置为具体的代理IP列表，用逗号分隔
    app.set("trust proxy", process.env.TRUST_PROXY.split(",").map(ip => ip.trim()));
    console.log(`[Server] Trust proxy enabled for: ${process.env.TRUST_PROXY}`);
  } else {
    // 2026-04-18: 生产默认信任 1 层反向代理（nginx），消除 express-rate-limit 的 X-Forwarded-For 告警
    app.set("trust proxy", 1);
    console.log("[Server] Trust proxy set to 1 (default: 1 reverse proxy hop)");
  }
  
  // ========== 性能优化 ==========
  // 启用 gzip 压缩（在所有中间件之前，确保所有响应都被压缩）
  // compression 中间件会自动处理静态文件和动态响应
  app.use(compression({
    filter: (req, res) => {
      // SSE 端点不压缩——compression 会缓冲数据，破坏流式
      if (req.path === "/api/claw/chat-stream") {
        return false;
      }
      // 如果请求头明确要求不压缩，则不压缩
      if (req.headers["x-no-compression"]) {
        return false;
      }
      // 使用默认过滤器，它会自动识别可压缩的内容类型
      // 包括：text/*, application/javascript, application/json, application/xml, 
      // image/svg+xml, font/* 等
      return compression.filter(req, res);
    },
    level: 6, // 压缩级别 1-9，6 是平衡性能和压缩率的好选择
    threshold: 512, // 降低阈值到 512 字节，压缩更多小文件（包括首页 HTML）
    // 压缩所有可压缩的内容类型
    memLevel: 8, // 内存使用级别（1-9），8 是较好的平衡
  }));
  
  // ========== 安全配置 ==========
  // 1. 设置安全 HTTP 头
  setupSecurityHeaders(app);
  
  // 2. IP 黑名单检查（最优先，在所有其他检查之前）
  app.use(ipBlacklistMiddleware());
  
  // 3. 检测可疑活动（在所有中间件之前）
  app.use(detectSuspiciousActivity);
  
  // 4. 4xx 错误追踪和限制（在速率限制之前）
  app.use(trackResponseErrors);
  app.use(block4xxAbuse);
  
  // 5. 请求大小限制
  app.use(requestSizeLimiter(50 * 1024 * 1024)); // 50MB
  
  // 6. 通用速率限制
  app.use(generalLimiter);
  
  // Configure CORS for frontend-backend separation
  // 支持多个 origin，用逗号分隔
  const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
  
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // 如果请求有 origin 头，且在我们的允许列表中，则允许
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    } else if (allowedOrigins.length === 1 && allowedOrigins[0] === '*') {
      // 只有在明确设置为 '*' 时才使用通配符（不推荐，因为不支持 credentials）
      res.header("Access-Control-Allow-Origin", "*");
    }
    
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  registerVoiceRoutes(app);
  registerCronRoutes(app);
  registerNotifyRoutes(app);
  registerWeixinRoutes(app);
  registerFeishuRoutes(app);
  // 启动微信双向聊天桥
  import("./claw-weixin-bridge").then(m => m.startWeixinBridge()).catch(e => console.error("weixin bridge start failed:", e));
  // 启动 cron 结果投递轮询（灵虾平台侧，补充 Gateway 不支持的渠道）
  import("./cron-delivery").then(m => m.startCronDeliveryPoller()).catch(e => console.error("cron delivery poller start failed:", e));
  registerSkillRoutes(app);
  registerCollabRoutes(app);
  registerBusinessRoutes(app);
  registerSkillConfigRoutes(app);
  registerToolsPolicyRoutes(app);
  registerCoreFileRoutes(app);
  registerMemoryRoutes(app);
  registerDownloadRoutes(app);
  registerFilesRoutes(app);
  registerSandboxRoutes(app);
  registerChatStreamRoutes(app);
  registerRecoverRoutes(app);
  registerCoopUploadRoutes(app);
  registerWSProxy(server);
  registerIframeRoutes(app);
  registerMiscRoutes(app);
  registerAuditExportRoutes(app);
  registerAgentClusterLabRoutes(app);
  registerTaskWorkbenchLabRoutes(app);

  // ── 灵虾流式聊天 SSE 端点 ──
  // Session/auth helpers extracted to ./helpers.ts


  // tRPC API - 应用速率限制
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: async (opts) => {
        try {
          return await createContext(opts);
        } catch (error) {
          console.error("[tRPC] Context creation error:", error);
          // 即使创建上下文失败，也返回一个基本的上下文
          return {
            req: opts.req,
            res: opts.res,
            user: null,
          };
        }
      },
      onError: ({ error, path, type }) => {
        // 只记录错误，不手动发送响应（让 tRPC 自己处理）
        console.error(`[tRPC Error] ${type} ${path}:`, error);
      },
    })
  );

  // 登录/注册端点应用严格速率限制
  app.use("/api/trpc/auth.login", authLimiter);
  app.use("/api/trpc/auth.register", authLimiter);

  // ── 品牌配置公开 API（无需登录） ──
  app.get("/api/brand", async (_req, res) => {
    try {
      const { getBrandConfig } = await import("./brand");
      const brand = await getBrandConfig();
      res.json(brand);
    } catch {
      const { DEFAULT_BRAND } = await import("@shared/brand");
      res.json(DEFAULT_BRAND);
    }
  });

  app.get("/api/meta/openclaw-version", async (_req, res) => {
    try {
      const raw = execSync("openclaw --version", { encoding: "utf-8", timeout: 2500 });
      const text = String(raw || "").trim();
      res.json({ version: text || "unknown" });
    } catch (_e) {
      res.json({ version: "unknown" });
    }
  });

  app.get("/api/claw/help-doc", async (_req, res) => {
    try {
      const helpPath = `${APP_ROOT}/HELP.md`;
      if (!existsSync(helpPath)) {
        res.status(404).json({ error: "HELP.md not found" });
        return;
      }
      const content = String(readFileSync(helpPath, "utf-8") || "");
      res.json({ content });
    } catch (_e) {
      res.status(500).json({ error: "read help doc failed" });
    }
  });

  // Health check endpoint（必须在静态文件服务之前）
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 静态文件服务（始终提供前端构建文件，不区分环境）
  const clientDistPath = path.resolve(__dirname, "../../dist/client");
  const fs = await import("fs");
  const isProduction = process.env.NODE_ENV === "production";
  
  // 检查静态文件目录是否存在
  if (fs.existsSync(clientDistPath)) {
    // 静态资源（JS/CSS/图片等），排除 index.html
    const staticOptions = {
      maxAge: isProduction ? "1y" : 0,
      etag: isProduction,
      lastModified: isProduction,
      index: false, // 禁用自动 index.html 服务，避免冲突
      setHeaders: (res: express.Response, filePath: string) => {
        // index.html 不在这里处理，会在下面的路由中单独处理
        if (filePath.endsWith("index.html")) {
          return; // 跳过 index.html
        }
        // 其他静态资源设置缓存策略
        if (isProduction) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
        // 确保静态资源可以被压缩（compression 中间件会自动处理）
        // 不需要手动设置压缩头，compression 中间件会根据内容类型自动处理
      },
    };
  app.use(express.static(clientDistPath, staticOptions));
    
    // SPA 路由回退：所有非 API 请求返回 index.html
    // 注意：这个路由必须在静态文件服务之后，确保静态文件优先匹配
    app.get("*", (req, res, next) => {
      // 跳过 API 路由和 health 检查
      if (req.path.startsWith("/api") || req.path.startsWith("/health")) {
        return next();
      }
      
      // 跳过静态资源文件（已经有 express.static 处理）
      const ext = path.extname(req.path);
      const staticExtensions = [".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".json"];
      if (ext && staticExtensions.includes(ext.toLowerCase())) {
        return next(); // 让 404 处理
      }
      
      // 如果已经发送了响应（比如静态文件已匹配），直接返回
      if (res.headersSent) {
        return;
      }
      
      // index.html 的缓存策略
      if (isProduction) {
        // 生产环境：index.html 短期缓存（1小时），确保 SPA 更新能及时生效
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("ETag", `"${Date.now()}"`); // 简单的 ETag，实际应该基于文件内容
      } else {
        // 开发环境：index.html 不缓存
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
      
      const indexPath = path.join(clientDistPath, "index.html");
      if (!fs.existsSync(indexPath)) {
        console.error("[SPA Fallback] index.html not found at:", indexPath);
        return next();
      }
      
      res.sendFile(indexPath, (err) => {
        if (err && !res.headersSent) {
          console.error("[SPA Fallback] Error sending index.html:", err);
          next(err);
        }
      });
    });
  } else {
    console.warn("[Static Files] Frontend build not found at", clientDistPath, "- skipping static file serving");
    
    // 开发环境：如果静态文件不存在，对于非 API 请求提供友好提示或重定向
    if (!isProduction) {
      app.get("*", (req, res, next) => {
        // 跳过 API 路由和 health 检查
        if (req.path.startsWith("/api") || req.path.startsWith("/health")) {
          return next();
        }
        
        // 开发环境提示：前端由 Vite 开发服务器提供
        if (!res.headersSent) {
          res.status(200).send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>开发服务器提示</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      backdrop-filter: blur(10px);
      max-width: 600px;
    }
    h1 { margin-top: 0; }
    .info {
      background: rgba(255, 255, 255, 0.2);
      padding: 1rem;
      border-radius: 0.5rem;
      margin: 1rem 0;
    }
    a {
      color: #fff;
      text-decoration: underline;
    }
    code {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      font-family: 'Monaco', 'Courier New', monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 开发服务器</h1>
    <div class="info">
      <p>这是后端 API 服务器（端口 5174）</p>
      <p>前端开发服务器运行在：<code>http://localhost:5173</code></p>
      <p><a href="http://localhost:5173" target="_blank">点击访问前端页面</a></p>
    </div>
    <div class="info">
      <p><strong>API 端点：</strong></p>
      <p><code>http://localhost:5174/api/trpc</code></p>
      <p><code>http://localhost:5174/health</code></p>
    </div>
  </div>
</body>
</html>
          `);
        }
      });
    }
  }

  // 全局错误处理中间件（必须在所有路由之后）
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Server Error]:", err);
    
    // 确保响应是 JSON 格式
    if (!res.headersSent) {
      res.status(err.status || 500).json({
        error: err.message || "内部服务器错误",
      });
    }
  });

  // 404 处理（必须在所有路由之后，包括静态文件服务）
  app.use((req: Request, res: Response) => {
    if (!res.headersSent) {
      res.status(404).json({ error: "路由不存在" });
    }
  });

  const port = parseInt(process.env.PORT || "5174");
  
  // 检查端口是否可用，如果被占用则直接报错，不自动切换
  try {
    await checkPortAvailable(port);
  } catch (error) {
    console.error(`\n❌ 端口 ${port} 已被占用！`);
    console.error(`请停止占用该端口的进程，或修改 .env 文件中的 PORT 环境变量。\n`);
    throw error;
  }

  server.listen(port, () => {
    console.log(`✅ Backend API server running on http://localhost:${port}/`);
    console.log(`   API endpoint: http://localhost:${port}/api/trpc`);
    console.log(`   CORS allowed origins: ${allowedOrigins.join(', ')}`);
  });
  startRecycler();
}
startServer().catch(console.error);
