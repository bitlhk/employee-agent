/**
 * 灵虾微信双向聊天桥
 * 后台 long-poll iLink → 收到消息 → 调 OpenClaw → 回复到微信
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID, randomBytes } from "crypto";
import { internalApiUrl } from "./helpers";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = String((2 << 16) | (2 << 8) | 0);
const CHANNEL_VERSION = "2.2.0";
const APP_ROOT = process.env.APP_ROOT || process.cwd();
const WEIXIN_CONFIG_DIR = `${APP_ROOT}/data/weixin-accounts`;
try { mkdirSync(WEIXIN_CONFIG_DIR, { recursive: true }); } catch {}
const POLL_TIMEOUT_MS = 35000;

function randomWechatUin(): string {
  const buf = randomBytes(4);
  return Buffer.from(String(buf.readUInt32BE(0))).toString("base64");
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

function loadAccount(adoptId: string): any {
  try {
    return JSON.parse(readFileSync(path.join(WEIXIN_CONFIG_DIR, `${adoptId}.json`), "utf-8"));
  } catch { return null; }
}

function saveAccount(adoptId: string, data: any) {
  writeFileSync(path.join(WEIXIN_CONFIG_DIR, `${adoptId}.json`), JSON.stringify(data, null, 2), "utf-8");
}

// iLink POST
async function ilinkPost(baseUrl: string, endpoint: string, payload: any, token?: string): Promise<any> {
  const body = JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } });
  const url = `${baseUrl.replace(/\/+$/, "")}/${endpoint}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: makeHeaders(token, Buffer.byteLength(body)),
    body,
  });
  const json: any = await resp.json().catch(() => ({}));
  // 临时：打印 sendmessage 的完整响应，看字段名
  if (endpoint === "ilink/bot/sendmessage") {
    console.log(`[WEIXIN-BRIDGE] sendmessage status=${resp.status} body=${JSON.stringify(json).slice(0, 400)}`);
  }
  const errcode = Number(json?.errcode ?? json?.ret ?? json?.error_code ?? 0);
  if (!resp.ok || errcode !== 0) {
    console.error(`[WEIXIN-BRIDGE] ilinkPost ${endpoint} failed status=${resp.status} errcode=${errcode} errmsg=${String(json?.errmsg || json?.message || json?.err_msg || "").slice(0, 160)}`);
  }
  return json;
}

// 发消息到微信——返回 iLink 结果，调用方可据此判失败
async function sendToWeixin(acct: any, chatId: string, text: string, contextToken: string): Promise<any> {
  const msg: any = {
    from_user_id: "",
    to_user_id: chatId,
    client_id: "lingxia-" + randomUUID(),
    message_type: 2,
    message_state: 2,
    context_token: contextToken,
    item_list: [{ type: 1, text_item: { text } }],
  };
  const result = await ilinkPost(acct.baseUrl || ILINK_BASE_URL, "ilink/bot/sendmessage", { msg }, acct.token);
  const errcode = Number(result?.errcode ?? result?.ret ?? 0);
  if (errcode !== 0) {
    throw new Error(`iLink sendmessage failed: errcode=${errcode} errmsg=${String(result?.errmsg || result?.message || "").slice(0, 120)}`);
  }
  return result;
}

// 调灵虾 chat-stream（internal key 绕过 auth）
async function chatWithLingxia(adoptId: string, message: string): Promise<string> {
  try {
    const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026"; // TODO: import from constants.ts
    const resp = await fetch(internalApiUrl("/api/claw/chat-stream"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify({ adoptId, message }),
      signal: AbortSignal.timeout(120000),
    });

    console.log(`[WEIXIN-BRIDGE] chat-stream resp status=${resp.status} ok=${resp.ok} hasBody=${!!resp.body}`);
    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "");
      console.error(`[WEIXIN-BRIDGE] chat-stream ${resp.status}: ${errText.slice(0, 100)}`);
      return "sorry, request failed";
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let result = "";
    let rawLog = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      if (rawLog.length < 2000) rawLog += decoded;
      buf += decoded;
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]" || !raw) continue;
        try {
          const chunk = JSON.parse(raw);
          if (chunk.__stream_end) break;
          if (chunk.__stream_error) { result = result || `（${chunk.error || "出错了"}）`; break; }
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) result += delta;
        } catch {}
      }
    }
    if (!result) {
      console.error(`[WEIXIN-BRIDGE] empty result! raw stream preview: ${rawLog.slice(0, 500)}`);
    }
    return result || "(no response)";
  } catch (e: any) {
    console.error(`[WEIXIN-BRIDGE] chat error for ${adoptId}:`, e.message?.slice(0, 200));
    return "sorry, error occurred";
  }
}

// 提取消息内容（文本 + 语音识别）
function extractText(msg: any): string {
  const items = msg.item_list || [];
  for (const item of items) {
    // type 1 = 文本
    if (item.type === 1 && item.text_item?.text) return item.text_item.text;
    // type 3 = 语音（iLink 可能带 recognition 字段 = 微信 STT）
    if (item.type === 3) {
      const voice = item.voice_item || item.audio_item || item;
      const recog = voice.recognition || voice.text || voice.content || "";
      if (recog) return recog;
      // 没有识别结果，记录结构方便调试
      console.log(`[WEIXIN-BRIDGE] voice item without recognition: ${JSON.stringify(item).slice(0, 500)}`);
      return "[语音消息，暂无法识别]";
    }
    // 未知类型 → 调试日志
    if (item.type !== 1) {
      console.log(`[WEIXIN-BRIDGE] unknown item type=${item.type}: ${JSON.stringify(item).slice(0, 300)}`);
    }
  }
  return "";
}

// 单个子虾的 polling loop
async function pollLoop(adoptId: string): Promise<void> {
  const acct = loadAccount(adoptId);
  if (!acct?.token) return;

  console.log(`[WEIXIN-BRIDGE] starting poll for ${adoptId}`);
  let syncBuf = acct.syncBuf || "";
  let consecutiveErrors = 0;

  while (activePolls.has(adoptId)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS + 5000);

      const body = JSON.stringify({
        get_updates_buf: syncBuf,
        base_info: { channel_version: CHANNEL_VERSION },
      });
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
        syncBuf = data.get_updates_buf || data.sync_buf;
        acct.syncBuf = syncBuf;
      }

      for (const m of msgs) {
        const fromId = m.from_user_id || "";
        const contextToken = m.context_token || "";

        // 调试：打印所有收到的 item 类型
        const itemTypes = (m.item_list || []).map((it: any) => it.type);
        if (itemTypes.length > 0 && !fromId.includes("@im.bot")) {
          console.log(`[WEIXIN-BRIDGE] ${adoptId} msg from=${fromId.slice(0,20)} item_types=${JSON.stringify(itemTypes)}`);
        }

        const text = extractText(m);

        // 跳过空消息和 bot 自己的消息
        if (!text || !fromId || fromId.includes("@im.bot")) continue;

        // 保存 context_token
        acct.lastContextToken = contextToken;
        acct.lastChatId = fromId;
        saveAccount(adoptId, acct);

        consecutiveErrors = 0; // 收到消息说明连接正常
        console.log(`[WEIXIN-BRIDGE] ${adoptId} received: "${text.slice(0, 50)}"`);

        // 显示"正在输入"
        try {
          const configResp = await ilinkPost(acct.baseUrl || ILINK_BASE_URL, "ilink/bot/getconfig", { ilink_user_id: fromId, context_token: contextToken }, acct.token);
          const typingTicket = configResp.typing_ticket || "";
          if (typingTicket) {
            await ilinkPost(acct.baseUrl || ILINK_BASE_URL, "ilink/bot/sendtyping", { ilink_user_id: fromId, typing_ticket: typingTicket, status: 1 }, acct.token);
          }
        } catch {}

        // 调灵虾主聊天（空结果自动重试一次，应对冷启动）
        let reply = await chatWithLingxia(adoptId, text);
        if (reply === "(no response)") {
          console.log(`[WEIXIN-BRIDGE] ${adoptId} empty response, retrying once...`);
          reply = await chatWithLingxia(adoptId, text);
        }

        // 刷新 context_token（发完 typing 后可能变了）
        try {
          const refreshBody = JSON.stringify({ get_updates_buf: syncBuf, base_info: { channel_version: CHANNEL_VERSION } });
          const refreshCtrl = new AbortController();
          const refreshTimer = setTimeout(() => refreshCtrl.abort(), 3000);
          const refreshResp = await fetch(url, {
            method: "POST",
            headers: makeHeaders(acct.token, Buffer.byteLength(refreshBody)),
            body: refreshBody,
            signal: refreshCtrl.signal,
          });
          clearTimeout(refreshTimer);
          const refreshData = await refreshResp.json() as any;
          if (refreshData.get_updates_buf || refreshData.sync_buf) {
            syncBuf = refreshData.get_updates_buf || refreshData.sync_buf;
            acct.syncBuf = syncBuf;
          }
          let refreshedToken = false;
          for (const rm of (refreshData.msgs || []).reverse()) {
            if (rm.context_token && rm.from_user_id) {
              acct.lastContextToken = rm.context_token;
              refreshedToken = true;
              break;
            }
          }
          // 2026-04-17 fix: refresh 后必须 save，否则 server 重启会丢最 fresh 的 contextToken
          // 主动推送（coop-notify 等）依赖 acct.lastContextToken，旧 token 会被 ilink 静默拒绝
          if (refreshedToken || acct.syncBuf) saveAccount(adoptId, acct);
        } catch {}

        // 发回复（截断到 4000 字）
        const trimmed = reply.length > 4000 ? reply.slice(0, 3990) + "\n..." : reply;
        try {
          await sendToWeixin(acct, fromId, trimmed, acct.lastContextToken || contextToken);
          console.log(`[WEIXIN-BRIDGE] ${adoptId} replied: "${trimmed.slice(0, 50)}..."`);
        } catch (e: any) {
          console.error(`[WEIXIN-BRIDGE] ${adoptId} send failed:`, e.message);
        }
      }
    } catch (e: any) {
      // 超时是正常的（35s 无消息），其他错误指数退避重试
      if (!String(e.message || e).includes("abort")) {
        consecutiveErrors++;
        if (consecutiveErrors > 20) {
          console.error(`[WEIXIN-BRIDGE] ${adoptId} too many consecutive errors (${consecutiveErrors}), stopping poll`);
          break;
        }
        const backoff = Math.min(5000 * consecutiveErrors, 30000);
        console.error(`[WEIXIN-BRIDGE] ${adoptId} poll error (${consecutiveErrors}x), retry in ${backoff}ms:`, e.message);
        await new Promise(r => setTimeout(r, backoff));
      } else {
        consecutiveErrors = 0; // 超时是正常的，重置计数
      }
    }
  }
  // 循环退出后清理
  activePolls.delete(adoptId);
  console.log(`[WEIXIN-BRIDGE] ${adoptId} poll loop exited`);
}

// 启动所有已绑定子虾的 polling
/** 外部调用：给指定子虾的微信用户发消息（供 platform tool 使用） */
// 跟踪已启动的 polling，防止重复启动
const activePolls = new Set<string>();

/** 停止某只虾的 polling（解绑时调用） */
export function stopPollForAccount(adoptId: string): void {
  activePolls.delete(adoptId);
  console.log(`[WEIXIN-BRIDGE] stopped polling for ${adoptId}`);
}

/** 外部调用：为新绑定的子虾启动 polling（绑定成功时调用，无需重启服务） */
export function startPollForAccount(adoptId: string): void {
  if (activePolls.has(adoptId)) return; // 已在 polling
  const acct = loadAccount(adoptId);
  if (!acct?.token) return;
  activePolls.add(adoptId);
  console.log(`[WEIXIN-BRIDGE] hot-start polling for ${adoptId}`);
  pollLoop(adoptId).catch(e => console.error(`[WEIXIN-BRIDGE] ${adoptId} poll crashed:`, e));
}

export async function sendMessageToWeixin(adoptId: string, text: string): Promise<void> {
  const acct = loadAccount(adoptId);
  if (!acct?.token) throw new Error("该子虾未绑定微信");
  if (!acct.lastChatId) throw new Error("尚未收到过微信消息，无法回复");
  const trimmed = text.length > 4000 ? text.slice(0, 3990) + "\n..." : text;
  await sendToWeixin(acct, acct.lastChatId, trimmed, acct.lastContextToken || "");
}

export function startWeixinBridge(): void {
  try {
    const files = readdirSync(WEIXIN_CONFIG_DIR).filter(f => f.endsWith(".json"));
    console.log(`[WEIXIN-BRIDGE] found ${files.length} bound accounts`);
    for (const file of files) {
      const adoptId = file.replace(".json", "");
      const acct = loadAccount(adoptId);
      if (acct?.token) {
        activePolls.add(adoptId);
        pollLoop(adoptId).catch(e => console.error(`[WEIXIN-BRIDGE] ${adoptId} loop crashed:`, e));
      }
    }
  } catch (e: any) {
    console.error("[WEIXIN-BRIDGE] startup error:", e.message);
  }
}
