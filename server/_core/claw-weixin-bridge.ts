/**
 * Compatibility shim for old Lingxia imports.
 *
 * WeChat transport is owned by the official OpenClaw `openclaw-weixin` channel
 * plugin. The old in-process iLink poller must stay disabled to avoid double
 * polling and duplicate replies.
 */
import { sendWeixinMessage } from "./claw-weixin";

export function stopPollForAccount(_adoptId: string): void {
  // Official OpenClaw channel runtime owns account lifecycle.
}

export function startPollForAccount(_adoptId: string): void {
  // Official OpenClaw channel runtime owns account lifecycle.
}

export async function sendMessageToWeixin(adoptId: string, text: string): Promise<void> {
  const result = await sendWeixinMessage(adoptId, "", text);
  if (!result.ok) throw new Error(result.error || "该智能体未绑定微信");
}

export function startWeixinBridge(): void {
  console.log("[WEIXIN-BRIDGE] disabled; using official OpenClaw openclaw-weixin channel plugin");
}
