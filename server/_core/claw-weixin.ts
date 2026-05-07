/**
 * 灵虾个人微信绑定 — 基于 iLink Bot API
 */
import express from "express";
import { requireClawOwner } from "./helpers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID, randomBytes } from "crypto";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = String((2 << 16) | (2 << 8) | 0);
const CHANNEL_VERSION = "2.2.0";

const APP_ROOT = process.env.APP_ROOT || process.cwd();
const WEIXIN_CONFIG_DIR = `${APP_ROOT}/data/weixin-accounts`;
mkdirSync(WEIXIN_CONFIG_DIR, { recursive: true });

function getAccountPath(adoptId: string) {
  return path.join(WEIXIN_CONFIG_DIR, `${adoptId}.json`);
}

function loadAccount(adoptId: string): any {
  const p = getAccountPath(adoptId);
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null; } catch { return null; }
}

function saveAccount(adoptId: string, data: any) {
  writeFileSync(getAccountPath(adoptId), JSON.stringify(data, null, 2), "utf-8");
}

function randomWechatUin(): string {
  const buf = randomBytes(4);
  const value = buf.readUInt32BE(0);
  return Buffer.from(String(value)).toString("base64");
}

function makeHeaders(token?: string, bodyLen?: number): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "AuthorizationType": "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION,
  };
  if (bodyLen !== undefined) h["Content-Length"] = String(bodyLen);
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function ilinkGet(endpoint: string): Promise<any> {
  const url = `${ILINK_BASE_URL}/${endpoint}`;
  const resp = await fetch(url, {
    headers: { "iLink-App-Id": ILINK_APP_ID, "iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION },
  });
  return resp.json();
}

async function ilinkPost(baseUrl: string, endpoint: string, payload: any, token?: string): Promise<any> {
  // 2026-04-17: errcode 检查 — ilink 失败时返回 { errcode != 0, errmsg }
  // 之前不检查导致 sendMessage 看似成功但实际未投递（token 过期等场景）
  const body = JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } });
  const url = `${baseUrl.replace(/\/+$/, "")}/${endpoint}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: makeHeaders(token, Buffer.byteLength(body)),
    body,
  });
  const data: any = await resp.json().catch(() => ({}));
  if (data?.errcode !== undefined && data.errcode !== 0) {
    const tag = endpoint.split("/").pop();
    const err = new Error(`ilink ${tag} failed: errcode=${data.errcode} errmsg=${data.errmsg || data.errMsg || "unknown"}`);
    (err as any).ilinkErrcode = data.errcode;
    throw err;
  }
  return data;
}

// 刷新 context_token（短超时，不阻塞）
async function refreshContextToken(acct: any): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const body = JSON.stringify({ get_updates_buf: acct.syncBuf || "", base_info: { channel_version: CHANNEL_VERSION } });
    const url = `${(acct.baseUrl || ILINK_BASE_URL).replace(/\/+$/, "")}/ilink/bot/getupdates`;
    const resp = await fetch(url, {
      method: "POST",
      headers: makeHeaders(acct.token, Buffer.byteLength(body)),
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await resp.json() as any;
    const msgs = Array.isArray(data.msgs) ? data.msgs : [];
    if (data.get_updates_buf || data.sync_buf) {
      acct.syncBuf = data.get_updates_buf || data.sync_buf;
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].context_token && msgs[i].from_user_id) {
        acct.lastContextToken = msgs[i].context_token;
        acct.lastChatId = msgs[i].from_user_id;
        break;
      }
    }
  } catch {
    // 超时或网络错误，用已有的 context_token
  }
}

// 发送消息到微信
export async function sendWeixinMessage(adoptId: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const acct = loadAccount(adoptId);
  if (!acct || !acct.token) return { ok: false, error: "weixin not bound" };
  try {
    // 尝试刷新 context_token（3 秒超时）
    await refreshContextToken(acct);
    const targetId = chatId || acct.lastChatId || acct.userId;
    const contextToken = acct.lastContextToken || "";
    if (!contextToken) return { ok: false, error: "no context_token, please send a message to bot first" };
    const msg: any = {
      from_user_id: "",
      to_user_id: targetId,
      client_id: "lingxia-" + randomUUID(),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text } }],
    };
    await ilinkPost(acct.baseUrl || ILINK_BASE_URL, "ilink/bot/sendmessage", { msg }, acct.token);
    saveAccount(adoptId, acct);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function getWeixinStatus(adoptId: string): { bound: boolean; targetLabel?: string; needsReactivation?: boolean } {
  const acct = loadAccount(adoptId);
  return {
    bound: !!(acct && acct.token),
    targetLabel: acct?.userId || "",
    needsReactivation: !!acct?.needsReactivation,
  };
}

export function registerWeixinRoutes(app: express.Express) {
  // Internal key for platform tool access
  const WEIXIN_INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";

  app.get("/api/claw/weixin/status", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      // Internal key bypass for platform tool
      let claw: any;
      if (req.headers["x-internal-key"] === WEIXIN_INTERNAL_KEY) {
        const { getClawByAdoptId } = await import("../db");
        claw = await getClawByAdoptId(adoptId);
        if (!claw) return res.status(404).json({ error: "NOT_FOUND" });
      } else {
        claw = await requireClawOwner(req, res, adoptId);
        if (!claw) return;
      }
      const acct = loadAccount(adoptId);
      res.json({ bound: !!(acct && acct.token), userId: acct?.userId || "" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/claw/weixin/qrcode", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const data = await ilinkGet("ilink/bot/get_bot_qrcode?bot_type=3");
      res.json({ qrcode: data.qrcode || "", qrcodeUrl: data.qrcode_img_content || "" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/claw/weixin/qrstatus", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const qrcode = String(req.query.qrcode || "").trim();
      if (!adoptId || !qrcode) return res.status(400).json({ error: "adoptId and qrcode required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const data = await ilinkGet(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`);
      const status = data.status || "wait";
      if (status === "confirmed") {
        saveAccount(adoptId, {
          accountId: data.ilink_bot_id || "",
          token: data.bot_token || "",
          baseUrl: data.baseurl || ILINK_BASE_URL,
          userId: data.ilink_user_id || "",
          savedAt: new Date().toISOString(),
        });
        // 绑定成功后自动启动这只虾的 polling（无需重启服务）
        try {
          const { startPollForAccount } = await import("./claw-weixin-bridge");
          startPollForAccount(adoptId);
          console.log(`[WEIXIN] auto-started polling for ${adoptId}`);
        } catch (e: any) {
          console.error(`[WEIXIN] failed to start polling for ${adoptId}:`, e?.message);
        }
        return res.json({ status: "confirmed", userId: data.ilink_user_id || "" });
      }
      let baseUrl = "";
      if (status === "scaned_but_redirect" && data.redirect_host) {
        baseUrl = `https://${data.redirect_host}`;
      }
      res.json({ status, baseUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/claw/weixin/unbind", async (req, res) => {
    // 解绑时停止该虾的微信 polling
    try {
      const { stopPollForAccount } = await import("./claw-weixin-bridge");
      stopPollForAccount(String(req.body?.adoptId || ""));
    } catch {}
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      try { require("fs").unlinkSync(getAccountPath(adoptId)); } catch {}
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/claw/weixin/test", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const result = await sendWeixinMessage(adoptId, "", "\u{1F99E} \u7075\u867e\u901a\u77e5\u6d4b\u8bd5\n\n\u5fae\u4fe1\u7ed1\u5b9a\u6210\u529f\uff01\u8fd9\u6761\u6d88\u606f\u6765\u81ea\u7075\u867e Agent \u5e73\u53f0\u3002");
      res.json(result);
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });
}
