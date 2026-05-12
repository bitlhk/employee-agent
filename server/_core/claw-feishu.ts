/**
 * Lingxia Feishu channel binding.
 *
 * Feishu uses the same app-registration device flow that OpenClaw uses:
 * init -> begin -> poll. The registration endpoint returns a dynamic appId /
 * appSecret pair after the user scans and authorizes with Feishu.
 */
import express from "express";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import path from "path";
import { APP_ROOT, requireClawOwner } from "./helpers";
import type {
  ChannelBindHandle,
  ChannelBindStart,
  ChannelBindStatus,
  ChannelPayload,
  Result,
} from "@shared/types/cron";

const FEISHU_ACCOUNTS_URL = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_URL = "https://accounts.larksuite.com";
const FEISHU_API_URL = "https://open.feishu.cn/open-apis";
const LARK_API_URL = "https://open.larksuite.com/open-apis";
const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REQUEST_TIMEOUT_MS = 10_000;

const FEISHU_CONFIG_DIR = path.join(APP_ROOT, "data/feishu-accounts");
mkdirSync(FEISHU_CONFIG_DIR, { recursive: true });

const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();

type FeishuDomain = "feishu" | "lark";

type FeishuAccount = {
  appId: string;
  appSecret: string;
  openId?: string;
  domain: FeishuDomain;
  boundAt: string;
};

type FeishuPollToken = {
  deviceCode: string;
  domain: FeishuDomain;
  expiresAt: number;
  interval: number;
  domainSwitched?: boolean;
};

function accountPath(adoptId: string) {
  return path.join(FEISHU_CONFIG_DIR, `${adoptId}.json`);
}

function loadAccount(adoptId: string): FeishuAccount | null {
  const p = accountPath(adoptId);
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
  } catch {
    return null;
  }
}

function saveAccount(adoptId: string, account: FeishuAccount) {
  writeFileSync(accountPath(adoptId), JSON.stringify(account, null, 2), "utf-8");
}

function removeAccount(adoptId: string) {
  try {
    unlinkSync(accountPath(adoptId));
  } catch {
    // Already unbound.
  }
}

function accountsBaseUrl(domain: FeishuDomain) {
  return domain === "lark" ? LARK_ACCOUNTS_URL : FEISHU_ACCOUNTS_URL;
}

function apiBaseUrl(domain: FeishuDomain) {
  return domain === "lark" ? LARK_API_URL : FEISHU_API_URL;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postRegistration(domain: FeishuDomain, body: Record<string, string>) {
  const response = await fetchWithTimeout(`${accountsBaseUrl(domain)}${REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return await response.json().catch(() => ({}));
}

function encodePollToken(token: FeishuPollToken): string {
  return Buffer.from(JSON.stringify(token), "utf-8").toString("base64url");
}

function decodePollToken(raw: string): FeishuPollToken | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (!parsed?.deviceCode) return null;
    return {
      deviceCode: String(parsed.deviceCode),
      domain: parsed.domain === "lark" ? "lark" : "feishu",
      expiresAt: Number(parsed.expiresAt || 0),
      interval: Number(parsed.interval || 5) || 5,
      domainSwitched: !!parsed.domainSwitched,
    };
  } catch {
    return null;
  }
}

function toBindHandle(userId: number, account: FeishuAccount): ChannelBindHandle {
  return {
    channelId: "feishu",
    userId,
    targetId: account.openId,
    targetLabel: account.openId || "飞书用户",
    boundAt: account.boundAt,
    domain: account.domain,
    metadata: {
      appId: account.appId,
      appSecret: account.appSecret,
      openId: account.openId,
    },
  };
}

export function getFeishuStatus(adoptId: string): { bound: boolean; targetLabel?: string; domain?: string } {
  const account = loadAccount(adoptId);
  return {
    bound: !!(account?.appId && account?.appSecret),
    targetLabel: account?.openId || "",
    domain: account?.domain,
  };
}

export async function initFeishuBindFlow(): Promise<Result<{ supported: boolean; reason?: string }>> {
  const data = await postRegistration("feishu", { action: "init" });
  const methods = Array.isArray(data?.supported_auth_methods) ? data.supported_auth_methods : [];
  if (!methods.includes("client_secret")) {
    return {
      ok: true,
      value: { supported: false, reason: "当前飞书环境不支持 client_secret app-registration" },
    };
  }
  return { ok: true, value: { supported: true } };
}

export async function startFeishuBindFlow(): Promise<Result<ChannelBindStart>> {
  const init = await initFeishuBindFlow();
  if (!init.ok) return { ok: false, error: init.error };
  if (!init.value.supported) {
    return { ok: false, error: { kind: "auth_failed", detail: init.value.reason || "feishu registration unsupported" } };
  }

  const data = await postRegistration("feishu", {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  if (!data?.device_code || !data?.verification_uri_complete) {
    return { ok: false, error: { kind: "channel_unreachable", detail: "Feishu begin response missing device_code" } };
  }
  const interval = Number(data.interval || 5) || 5;
  const expireIn = Number(data.expires_in || 3600) || 3600;
  const pollToken = encodePollToken({
    deviceCode: String(data.device_code),
    domain: "feishu",
    expiresAt: Date.now() + expireIn * 1000,
    interval,
  });
  const qrUrl = new URL(String(data.verification_uri_complete));
  qrUrl.searchParams.set("from", "lingxia_channel");
  qrUrl.searchParams.set("tp", "lingxia_feishu");
  return {
    ok: true,
    value: {
      qrCode: qrUrl.toString(),
      pollToken,
      expiresAt: new Date(Date.now() + expireIn * 1000).toISOString(),
      verificationUri: String(data.verification_uri || ""),
      userCode: String(data.user_code || ""),
      pollIntervalMs: interval * 1000,
    },
  };
}

export async function pollFeishuBindStatus(adoptId: string, userId: number, rawPollToken: string): Promise<Result<ChannelBindStatus & { pollToken?: string }>> {
  const token = decodePollToken(rawPollToken);
  if (!token) return { ok: false, error: { kind: "payload_rejected", detail: "invalid feishu poll token" } };
  if (Date.now() > token.expiresAt) return { ok: true, value: { status: "expired" } };

  let data: any;
  try {
    data = await postRegistration(token.domain, { action: "poll", device_code: token.deviceCode });
  } catch {
    return { ok: true, value: { status: "pending" } };
  }

  if (data?.user_info?.tenant_brand === "lark" && token.domain !== "lark" && !token.domainSwitched) {
    const next = encodePollToken({ ...token, domain: "lark", domainSwitched: true });
    return { ok: true, value: { status: "pending", pollToken: next } };
  }

  if (data?.client_id && data?.client_secret) {
    const openId = data.user_info?.open_id ? String(data.user_info.open_id) : "";
    if (!openId) {
      return {
        ok: false,
        error: {
          kind: "auth_failed",
          detail: "Feishu authorization did not return open_id; please retry binding",
        },
      };
    }
    const account: FeishuAccount = {
      appId: String(data.client_id),
      appSecret: String(data.client_secret),
      openId,
      domain: token.domain,
      boundAt: new Date().toISOString(),
    };
    saveAccount(adoptId, account);
    return { ok: true, value: { status: "confirmed", bindHandle: toBindHandle(userId, account) } };
  }

  if (data?.error === "access_denied" || data?.error === "expired_token") {
    return { ok: true, value: { status: "expired" } };
  }
  return { ok: true, value: { status: "pending" } };
}

async function getTenantAccessToken(account: FeishuAccount): Promise<string> {
  const cacheKey = `${account.domain}:${account.appId}`;
  const cached = tenantTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }
  const response = await fetchWithTimeout(`${apiBaseUrl(account.domain)}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: account.appId, app_secret: account.appSecret }),
  });
  const data = await response.json().catch(() => ({}));
  if (data?.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`Feishu token error: ${data?.msg || "unknown"}`);
  }
  const token = String(data.tenant_access_token);
  const expiresIn = Number(data.expire || 7200) || 7200;
  tenantTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return token;
}

export async function sendFeishuMessage(adoptId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const account = loadAccount(adoptId);
  if (!account?.appId || !account?.appSecret || !account?.openId) {
    return { ok: false, error: "feishu not bound" };
  }
  try {
    const token = await getTenantAccessToken(account);
    const response = await fetchWithTimeout(`${apiBaseUrl(account.domain)}/im/v1/messages?receive_id_type=open_id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: account.openId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (data?.code !== 0) {
      return { ok: false, error: data?.msg || `Feishu send failed with HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || "feishu send failed" };
  }
}

export async function unbindFeishu(adoptId: string): Promise<void> {
  removeAccount(adoptId);
}

export function registerFeishuRoutes(app: express.Express) {
  app.get("/api/claw/feishu/status", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      res.json(getFeishuStatus(adoptId));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "feishu status failed" });
    }
  });

  app.post("/api/claw/feishu/init", async (_req, res) => {
    try {
      const result = await initFeishuBindFlow();
      if (!result.ok) return res.status(502).json({ supported: false, reason: result.error.detail });
      res.json(result.value);
    } catch (error: any) {
      res.status(502).json({ supported: false, reason: error?.message || "feishu init failed" });
    }
  });

  app.post("/api/claw/feishu/begin", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await startFeishuBindFlow();
      if (!result.ok) return res.status(502).json({ error: result.error.detail });
      res.json(result.value);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "feishu begin failed" });
    }
  });

  app.post("/api/claw/feishu/poll", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const pollToken = String(req.body?.pollToken || "").trim();
      if (!adoptId || !pollToken) return res.status(400).json({ error: "adoptId and pollToken required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await pollFeishuBindStatus(adoptId, Number(claw.userId), pollToken);
      if (!result.ok) return res.status(502).json({ error: result.error.detail });
      if (result.value.status === "confirmed") {
        // Do not leak channel-specific credentials (appSecret) back to the browser.
        return res.json({
          status: "confirmed",
          targetLabel: result.value.bindHandle.targetLabel || "",
        });
      }
      res.json(result.value);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "feishu poll failed" });
    }
  });

  app.post("/api/claw/feishu/unbind", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      await unbindFeishu(adoptId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "feishu unbind failed" });
    }
  });

  app.post("/api/claw/feishu/test", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await sendFeishuMessage(adoptId, "员工智能体频道测试\n\n飞书频道已连接，后续定时任务可投递到这里。");
      res.json(result.ok ? { ok: true } : { ok: false, error: result.error });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || "feishu test failed" });
    }
  });
}
