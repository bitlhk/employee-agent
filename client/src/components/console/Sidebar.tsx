import { MessageSquareText, Brain, Sparkles, Radio, CalendarClock, Settings2, BookOpen, Users, FolderTree } from "lucide-react";
export type PageKey = "chat" | "skills" | "weixin" | "agent" | "workspace" | "schedule" | "collab" | "settings" | "docs";
const items: { key: PageKey; label: string; icon: any; adminOnly?: boolean }[] = [
  { key: "chat", label: "聊天", icon: MessageSquareText },
  { key: "skills", label: "技能", icon: Sparkles },
  { key: "weixin", label: "频道", icon: Radio },
  { key: "agent", label: "记忆", icon: Brain },
  { key: "collab", label: "协作", icon: Users },
  { key: "workspace", label: "工作空间", icon: FolderTree },
  { key: "schedule", label: "定时任务", icon: CalendarClock },
  { key: "settings", label: "设置", icon: Settings2 },
  { key: "docs", label: "文档", icon: BookOpen },
];

export function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  onOpenSettings,
  coopBadge,
}: {
  activePage: PageKey;
  setActivePage: (k: PageKey) => void;
  collapsed?: boolean;
  onOpenSettings?: () => void;
  coopBadge?: number;
}) {
  return (
    <div className="px-2 py-3 space-y-1 flex flex-col h-full">
      <div className="space-y-1">
        {items.map((it) => {
          const Icon = it.icon;
          const active = activePage === it.key;
          return (
            <button key={it.key} title={it.label} onClick={() => setActivePage(it.key)} className={`w-full flex items-center gap-2 px-3 py-2.5 text-left sidebar-item relative ${active ? "active" : ""}`}>
              {active && <span className="sidebar-item-indicator" />}
              <Icon size={16} className="sidebar-item-icon" style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }} />
              {!collapsed && <span className="text-sm sidebar-item-label" style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }}>{it.label}</span>}
              {it.key === "collab" && coopBadge !== undefined && coopBadge > 0 ? (
                <span className="absolute right-2 top-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-semibold rounded-full bg-red-500 text-white" style={{ lineHeight: 1 }}>
                  {coopBadge > 99 ? "99+" : coopBadge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
