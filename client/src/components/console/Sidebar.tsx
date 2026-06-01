import {
  BriefcaseBusiness,
  CalendarClock,
  FolderTree,
  MessageSquareText,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type PageKey = "chat" | "skills" | "weixin" | "agent" | "workspace" | "office" | "schedule" | "collab" | "meeting" | "settings";

type NavItem = { key: PageKey; label: string; icon: any; adminOnly?: boolean };

export type SidebarConversation = {
  conversationId: string;
  sessionKey?: string;
  sessionId?: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

const primaryItems: NavItem[] = [
  { key: "chat", label: "聊天", icon: MessageSquareText },
  { key: "skills", label: "技能", icon: Sparkles },
  { key: "collab", label: "协作", icon: Users },
  { key: "workspace", label: "文件", icon: FolderTree },
];

const workbenchItems: NavItem[] = [
  { key: "office", label: "办公空间", icon: BriefcaseBusiness },
  { key: "schedule", label: "定时任务", icon: CalendarClock },
];

function formatUpdatedAt(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function shortTitle(session: SidebarConversation) {
  return (session.title || "未命名会话").replace(/\s+/g, " ").trim();
}

export function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  onOpenSettings,
  coopBadge,
  sessions = [],
  currentConversationId,
  sessionSwitchingId,
  onSwitchConversation,
  onDeleteConversation,
  onNewConversation,
  footer,
}: {
  activePage: PageKey;
  setActivePage: (k: PageKey) => void;
  collapsed?: boolean;
  onOpenSettings?: () => void;
  coopBadge?: number;
  sessions?: SidebarConversation[];
  currentConversationId?: string;
  sessionSwitchingId?: string | null;
  onSwitchConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onNewConversation?: () => void;
  footer?: ReactNode;
}) {
  const [openMenu, setOpenMenu] = useState<"settings" | "workbench" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const renderItem = (it: NavItem, compact = false) => {
          const Icon = it.icon;
          const active = activePage === it.key;
          return (
            <div key={it.key} className="flex flex-col gap-1">
              <button title={it.label} onClick={() => setActivePage(it.key)} className={`w-full flex items-center gap-3 text-left sidebar-item relative ${active ? "active" : ""}`} style={{ padding: "10px 16px", minHeight: 44 }}>
                <Icon size={16} className="sidebar-item-icon" />
                {!collapsed && <span className="sidebar-item-label">{it.label}</span>}
                {it.key === "collab" && coopBadge !== undefined && coopBadge > 0 ? (
                  <span className="absolute right-2 top-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-semibold rounded-full bg-red-500 text-white" style={{ lineHeight: 1 }}>
                    {coopBadge > 99 ? "99+" : coopBadge}
                  </span>
                ) : null}
              </button>
            </div>
          );
  };

  const renderBottomMenu = (
    key: "settings" | "workbench",
    label: string,
    icon: any,
    active: boolean,
    children: React.ReactNode,
  ) => {
    const Icon = icon;
    const open = openMenu === key;
    return (
      <div className="relative" ref={open ? menuRef : undefined}>
        <button
          type="button"
          title={label}
          onClick={() => setOpenMenu(open ? null : key)}
          className={`sidebar-item sidebar-icon-button flex items-center justify-center relative ${active || open ? "active" : ""}`}
          style={{ width: 34, height: 34, padding: 0 }}
        >
          <Icon size={16} className="sidebar-item-icon" />
        </button>
        {open ? (
          <div
            className="absolute left-0 bottom-[42px] z-50"
            style={{
              width: 190,
              padding: 6,
              borderRadius: 12,
              border: "1px solid var(--oc-border-subtle)",
              background: "var(--oc-bg-surface)",
              boxShadow: "0 16px 34px rgba(0,0,0,0.16)",
            }}
          >
            <div style={{ padding: "5px 8px 7px", fontSize: 11, color: "var(--oc-text-tertiary)" }}>{label}</div>
            {children}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="px-2 py-2 flex flex-col flex-1 min-h-0">
      <div className="space-y-1 shrink-0">
        {primaryItems.map((item) => renderItem(item))}
      </div>

      {!collapsed ? (
        <div className="mt-6 flex-1 min-h-0 flex flex-col">
          <div className="px-3 mb-1 flex items-center justify-between">
            <span style={{ color: "var(--oc-sidebar-muted)", fontSize: 12, fontWeight: 400 }}>历史会话</span>
            {onNewConversation ? (
              <button
                type="button"
                title="新建会话"
                onClick={onNewConversation}
                disabled={!!sessionSwitchingId}
                className="rounded-md flex items-center justify-center"
                style={{
                  width: 24,
                  height: 24,
                  border: "none",
                  background: "transparent",
                  color: "var(--oc-sidebar-muted)",
                  opacity: sessionSwitchingId ? 0.45 : 1,
                  cursor: sessionSwitchingId ? "not-allowed" : "pointer",
                }}
              >
                <Plus size={14} />
              </button>
            ) : null}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto stealth-scrollbar pr-1">
            {sessions.length === 0 ? (
              <div className="px-3 py-4 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>暂无历史会话</div>
            ) : (
              <div className="space-y-0.5">
                {sessions.map((session) => {
                  const active = session.conversationId === currentConversationId;
                  const switching = sessionSwitchingId === session.conversationId;
                  return (
                    <button
                      key={session.conversationId}
                      type="button"
                      title={shortTitle(session)}
                      onClick={() => onSwitchConversation?.(session.conversationId)}
                      disabled={!!sessionSwitchingId}
                      className={`group w-full text-left flex items-center gap-3 sidebar-item relative ${active ? "active" : ""}`}
                      style={{
                        padding: "10px 16px",
                        minHeight: 44,
                        opacity: sessionSwitchingId && !switching ? 0.52 : 1,
                        cursor: sessionSwitchingId ? "wait" : "pointer",
                      }}
                    >
                      {active && <span className="sidebar-item-indicator" />}
                      <MessageSquareText size={16} className="sidebar-item-icon" style={{ flexShrink: 0 }} />
                      <span className="sidebar-item-label min-w-0 flex-1 truncate" style={{ fontSize: 14, fontWeight: 400 }}>
                        {switching ? "正在切换…" : shortTitle(session)}
                      </span>
                      <span className="group-hover:hidden" style={{ color: "var(--oc-sidebar-subtle)", fontSize: 11, flexShrink: 0 }}>
                        {formatUpdatedAt(session.updatedAt)}
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        title="删除会话"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!sessionSwitchingId) onDeleteConversation?.(session.conversationId);
                        }}
                        className="hidden group-hover:flex items-center justify-center rounded-md"
                        style={{ width: 22, height: 22, color: "var(--oc-sidebar-subtle)", flexShrink: 0 }}
                      >
                        <Trash2 size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="shrink-0 pt-2 flex items-center gap-1.5" style={{ borderTop: "1px solid var(--oc-border-subtle)" }}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="设置"
            onClick={() => onOpenSettings?.()}
            className="sidebar-item sidebar-icon-button flex items-center justify-center relative"
            style={{ width: 34, height: 34, padding: 0 }}
          >
            <Settings2 size={16} className="sidebar-item-icon" />
          </button>
          {renderBottomMenu("workbench", "工作台", BriefcaseBusiness, activePage === "office" || activePage === "schedule", (
            <div className="space-y-1">
              {workbenchItems.map((item) => renderItem(item))}
            </div>
          ))}
        </div>
        {!collapsed && footer ? <div className="ml-auto min-w-0">{footer}</div> : null}
      </div>
    </div>
  );
}
