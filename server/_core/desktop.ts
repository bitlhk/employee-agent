import express from "express";
import http from "http";
import bcrypt from "bcryptjs";
import { getUserByEmail, getUserById } from "../db";
import { sdk } from "./sdk";

type DesktopUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  accessLevel?: string | null;
};

function publicBaseUrl(req: express.Request): string {
  const proto =
    String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() ||
    req.protocol ||
    "http";
  const host = req.get("host") || `127.0.0.1:${process.env.PORT || "5000"}`;
  return `${proto}://${host}`;
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

function bearerToken(req: express.Request): string {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function authenticateDesktopRequest(
  req: express.Request,
): Promise<DesktopUser | null> {
  const token = bearerToken(req);
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

async function requireDesktopUser(
  req: express.Request,
  res: express.Response,
): Promise<DesktopUser | null> {
  const user = await authenticateDesktopRequest(req);
  if (user) return user;
  res.status(401).json({ error: "Unauthorized" });
  return null;
}

async function forwardOpenClawChat(req: express.Request, res: express.Response) {
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
        ...(req.headers["x-openclaw-model"]
          ? { "x-openclaw-model": String(req.headers["x-openclaw-model"]) }
          : {}),
      },
    },
    (upstreamRes) => {
      res.status(upstreamRes.statusCode || 502);
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) res.setHeader(key, value as string | string[]);
      }
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
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

export function registerDesktopRoutes(app: express.Express) {
  app.post("/api/desktop/login", express.json(), async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
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
    const agentId = defaultDesktopAgentId();
    res.json({
      mode: "mvp",
      user,
      gatewayUrl:
        process.env.DESKTOP_OPENCLAW_GATEWAY_URL ||
        `${base}/api/desktop/openclaw`,
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

  app.post("/api/desktop/openclaw/v1/chat/completions", forwardOpenClawChat);
}
