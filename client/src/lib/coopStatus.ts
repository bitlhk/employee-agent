/**
 * 协作状态 - badge class 映射（共享主题）
 *
 * 用法：
 *   import { memberStatusMeta, sessionStatusMeta } from "@/lib/coopStatus";
 *   const meta = memberStatusMeta(status);
 *   <span className={`badge ${meta.badgeClass}`}><meta.icon /> {meta.label}</span>
 *
 * 不要在组件里硬编码 hex 状态色；所有状态色走 index.css 里的 .badge-success / .badge-warning
 * / .badge-danger / .badge-info / .badge-purple / .badge-muted 这套（底层是 var(--oc-*)）。
 */
import { Clock, Play, Send, CheckCircle2, XCircle } from "lucide-react";

export type CoopMemberStatus =
  | "pending"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled"
  | "partial_success"
  | "waiting_input";

export type MemberStatusMeta = {
  label: string;
  badgeClass: string;
  icon: typeof Clock;
};

const MEMBER_STATUS: Record<string, MemberStatusMeta> = {
  pending:         { label: "等待响应",   badgeClass: "badge-warning", icon: Clock },
  approved:        { label: "已同意",     badgeClass: "badge-success", icon: CheckCircle2 },
  running:         { label: "执行中",     badgeClass: "badge-info",    icon: Play },
  completed:       { label: "已提交",     badgeClass: "badge-success", icon: Send },
  failed:          { label: "执行失败",   badgeClass: "badge-danger",  icon: XCircle },
  rejected:        { label: "已拒绝",     badgeClass: "badge-danger",  icon: XCircle },
  cancelled:       { label: "已取消",     badgeClass: "badge-muted",   icon: XCircle },
  partial_success: { label: "部分成功",   badgeClass: "badge-warning", icon: CheckCircle2 },
  waiting_input:   { label: "等待输入",   badgeClass: "badge-warning", icon: Clock },
};

export function memberStatusMeta(status: string): MemberStatusMeta {
  return MEMBER_STATUS[status] || MEMBER_STATUS.pending;
}

export type CoopSessionStatus =
  | "drafting"
  | "inviting"
  | "running"
  | "consolidating"
  | "published"
  | "closed"
  | "dissolved";

export type SessionStatusMeta = {
  label: string;
  badgeClass: string;
};

const SESSION_STATUS: Record<string, SessionStatusMeta> = {
  drafting:      { label: "草稿",         badgeClass: "badge-muted" },
  inviting:      { label: "邀请中",       badgeClass: "badge-warning" },
  running:       { label: "协作进行中",   badgeClass: "badge-info" },
  consolidating: { label: "整合中",       badgeClass: "badge-purple" },
  published:     { label: "已发布",       badgeClass: "badge-success" },
  closed:        { label: "已关闭",       badgeClass: "badge-muted" },
  dissolved:     { label: "已解散",       badgeClass: "badge-muted" },
};

export function sessionStatusMeta(status: string): SessionStatusMeta {
  return SESSION_STATUS[status] || { label: status, badgeClass: "badge-muted" };
}
