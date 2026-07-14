import { Badge } from "./badge";
import { cn } from "@/lib/utils";

/**
 * 统一状态 Badge 组件
 * 所有页面使用同一套状态颜色和中文映射
 */

type StatusType =
  | "active" | "online" | "success" | "approved" | "resolved"
  | "creating" | "pending" | "running" | "processing"
  | "failed" | "error" | "rejected" | "blocked" | "destructive"
  | "recycled" | "offline" | "disabled" | "hidden" | "ignored"
  | "info" | "developing";

const STATUS_CONFIG: Record<StatusType, { label: string; className: string }> = {
  // ── 成功/活跃 ──
  active:    { label: "启用",   className: "bg-[var(--status-success-bg)] text-[var(--status-success)] border-green-200" },
  online:    { label: "在线",   className: "bg-[var(--status-success-bg)] text-[var(--status-success)] border-green-200" },
  success:   { label: "成功",   className: "bg-[var(--status-success-bg)] text-[var(--status-success)] border-green-200" },
  approved:  { label: "已通过", className: "bg-[var(--status-success-bg)] text-[var(--status-success)] border-green-200" },
  resolved:  { label: "已处理", className: "bg-[var(--status-success-bg)] text-[var(--status-success)] border-green-200" },
  // ── 进行中/警告 ──
  creating:   { label: "创建中", className: "bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-yellow-200" },
  pending:    { label: "待处理", className: "bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-yellow-200" },
  running:    { label: "运行中", className: "bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-yellow-200" },
  processing: { label: "处理中", className: "bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-yellow-200" },
  developing: { label: "开发中", className: "bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-yellow-200" },
  // ── 失败/危险 ──
  failed:      { label: "失败",   className: "bg-[var(--status-danger-bg)] text-[var(--status-danger)] border-red-200" },
  error:       { label: "错误",   className: "bg-[var(--status-danger-bg)] text-[var(--status-danger)] border-red-200" },
  rejected:    { label: "已拒绝", className: "bg-[var(--status-danger-bg)] text-[var(--status-danger)] border-red-200" },
  blocked:     { label: "已封禁", className: "bg-[var(--status-danger-bg)] text-[var(--status-danger)] border-red-200" },
  destructive: { label: "危险",   className: "bg-[var(--status-danger-bg)] text-[var(--status-danger)] border-red-200" },
  // ── 非活跃/中性 ──
  recycled: { label: "已回收", className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-gray-200" },
  offline:  { label: "离线",   className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-gray-200" },
  disabled: { label: "已禁用", className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-gray-200" },
  hidden:   { label: "隐藏",   className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-gray-200" },
  ignored:  { label: "已忽略", className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-gray-200" },
  // ── 信息 ──
  info: { label: "信息", className: "bg-[var(--status-info-bg)] text-[var(--status-info)] border-blue-200" },
};

interface StatusBadgeProps {
  status: string;
  label?: string;        // 覆盖默认中文标签
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status as StatusType] || {
    label: status,
    className: "bg-gray-100 text-gray-600 border-gray-200",
  };

  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium border", config.className, className)}
    >
      {label || config.label}
    </Badge>
  );
}

// 导出配置供需要的地方使用
export { STATUS_CONFIG };
export type { StatusType };
