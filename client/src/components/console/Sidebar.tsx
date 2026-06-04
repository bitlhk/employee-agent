import {
  BriefcaseBusiness,
  CalendarClock,
  FolderTree,
  MessageSquareText,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SessionList, type SessionListConversation } from "./SessionList";

export type PageKey = "chat" | "skills" | "weixin" | "agent" | "workspace" | "office" | "schedule" | "collab" | "meeting" | "settings";

type NavItem = { key: PageKey; label: string; icon: any; adminOnly?: boolean };

export type SidebarConversation = SessionListConversation;

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
  onRenameConversation,
  onTogglePinConversation,
  onNewConversation,
  sessionsLoading,
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
  onRenameConversation?: (conversationId: string, title: string) => void;
  onTogglePinConversation?: (conversationId: string, pinned: boolean) => void;
  onNewConversation?: () => void;
  sessionsLoading?: boolean;
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
          <SessionList
            sessions={sessions}
            currentConversationId={currentConversationId}
            sessionSwitchingId={sessionSwitchingId}
            onSwitchConversation={onSwitchConversation}
            onDeleteConversation={onDeleteConversation}
            onRenameConversation={onRenameConversation}
            onTogglePinConversation={onTogglePinConversation}
            onNewConversation={onNewConversation}
            variant="sidebar"
            searchable={sessions.length > 8}
            loading={sessionsLoading}
          />
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
