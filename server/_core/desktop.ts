import express from "express";
import http from "http";

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

function requireDesktopToken(req: express.Request, res: express.Response) {
  const expected = desktopToken();
  if (!expected) return true;
  if (bearerToken(req) === expected) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function forwardOpenClawChat(req: express.Request, res: express.Response) {
  if (!requireDesktopToken(req, res)) return;

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

  req.on("close", () => upstream.destroy());
  upstream.write(body);
  upstream.end();
}

export function registerDesktopRoutes(app: express.Express) {
  app.get("/api/desktop/bootstrap", (req, res) => {
    const base = publicBaseUrl(req);
    const agentId = defaultDesktopAgentId();
    res.json({
      mode: "mvp",
      user: {
        id: "desktop-mvp-user",
        name: "Desktop MVP User",
      },
      gatewayUrl:
        process.env.DESKTOP_OPENCLAW_GATEWAY_URL ||
        `${base}/api/desktop/openclaw`,
      gatewayToken: desktopToken(),
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
