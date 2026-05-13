/**
 * 灵虾组织协作 V2 - 通知派发
 * 
 * 职责：当 coop 事件发生时，把通知推送到：
 *   (1) 被通知人的微信（通过 claw-weixin-bridge）
 *   (2) 未来：浏览器 toast / 左侧红点（WS 广播）
 *
 * 当前实现：只做微信推送；WS 广播交给 Step 4 实时化
 */
import { sendMessageToWeixin } from "./claw-weixin-bridge";
import { getDb } from "../db/connection";
import { eq, and, inArray, desc } from "drizzle-orm";
import { clawAdoptions, users } from "../../drizzle/schema";

const PUBLIC_BASE_URL = process.env.LINGXIA_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://www.linggan.top";

/**
 * 查 user 当前可用的 adoptId（用于发送微信）
 * 规则：取最新 active/expiring 的 adoption；若无则 creating
 */
async function getActiveAdoptIdByUserId(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ adoptId: clawAdoptions.adoptId, status: clawAdoptions.status })
    .from(clawAdoptions)
    .where(and(eq(clawAdoptions.userId, userId), inArray(clawAdoptions.status, ["active", "expiring", "creating"])))
    .orderBy(desc(clawAdoptions.id))
    .limit(1);
  return rows[0]?.adoptId || null;
}

export type CoopNotifyEvent =
  | {
      type: "session_created";
      sessionId: string;
      creatorUserId: number;
      creatorName: string;
      title: string;
      members: Array<{ userId: number; adoptId: string; subtask: string; requestId: number }>;
    }
  | {
      type: "member_agreed" | "member_rejected";
      sessionId: string;
      actorUserId: number;
      actorName: string;
      title: string;
    }
  | {
      type: "result_submitted";
      sessionId: string;
      creatorUserId: number;
      submitterName: string;
      title: string;
    }
  | {
      type: "session_published";
      sessionId: string;
      title: string;
      memberUserIds: number[];
    };

/**
 * 派发通知（异步，容错；任何单个通道失败不影响其他）
 */
export async function notifyCoopEvent(ev: CoopNotifyEvent): Promise<void> {
  try {
    switch (ev.type) {
      case "session_created": {
        // 给每个被邀请人发微信
        const sessionUrl = `${PUBLIC_BASE_URL}/coop/${ev.sessionId}`;
        for (const m of ev.members) {
          const targetAdoptId = await getActiveAdoptIdByUserId(m.userId);
          if (!targetAdoptId) {
            console.log(`[coop-notify] user ${m.userId} has no active adoption, skip weixin`);
            continue;
          }
          const msg = `【协作邀请】${ev.creatorName} 邀请你参与「${ev.title}」\n分配给你的任务：${m.subtask}\n电脑打开员工智能体，或手机长按链接「在浏览器中打开」（微信内登录态可能不稳）：\n${sessionUrl}`;
          try {
            await sendMessageToWeixin(targetAdoptId, msg);
            console.log(`[coop-notify] weixin invite sent to user ${m.userId} (adopt ${targetAdoptId})`);
          } catch (e) {
            console.error(`[coop-notify] weixin send failed for user ${m.userId}:`, e);
          }
        }
        break;
      }

      case "member_agreed":
      case "member_rejected": {
        // Step 3 暂不向发起人推送微信（避免自己给自己刷屏）；
        // 后续 Step 4/5 时会加：按 creatorUserId 查 adoptId 再推送
        // 目前依靠发起人所在的协作窗口轮询拉事件流即可
        break;
      }

      case "result_submitted": {
        const targetAdoptId = await getActiveAdoptIdByUserId(ev.creatorUserId);
        if (!targetAdoptId) break;
        const sessionUrl = `${PUBLIC_BASE_URL}/coop/${ev.sessionId}`;
        const msg = `【协作进展】${ev.submitterName} 已提交结果 → 「${ev.title}」\n💻 电脑或📱手机浏览器打开链接查看 / 整合：\n${sessionUrl}`;
        try {
          await sendMessageToWeixin(targetAdoptId, msg);
        } catch (e) {
          console.error(`[coop-notify] weixin send failed:`, e);
        }
        break;
      }

      case "session_published": {
        const sessionUrl = `${PUBLIC_BASE_URL}/coop/${ev.sessionId}`;
        for (const uid of ev.memberUserIds) {
          const targetAdoptId = await getActiveAdoptIdByUserId(uid);
          if (!targetAdoptId) continue;
          const msg = `【协作完成】「${ev.title}」已发布最终结果\n💻 电脑或📱手机浏览器打开链接查看：\n${sessionUrl}`;
          try {
            await sendMessageToWeixin(targetAdoptId, msg);
          } catch (e) {
            console.error(`[coop-notify] weixin send failed for user ${uid}:`, e);
          }
        }
        break;
      }
    }
  } catch (e) {
    console.error("[coop-notify] dispatch failed:", e);
    // 任何失败都不向上抛，保证 mutation 主路径不被 notify 带挂
  }
}
