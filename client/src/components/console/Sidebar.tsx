import {
  CalendarClock,
  FolderTree,
  MessageSquareText,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { SessionList, type SessionListConversation } from "./SessionList";

export type PageKey = "chat" | "skills" | "weixin" | "agent" | "workspace" | "schedule" | "collab" | "meeting" | "settings";

type NavItem = { key: PageKey; label: string; icon: any; adminOnly?: boolean };

export type SidebarConversation = SessionListConversation;

const primaryItems: NavItem[] = [
  { key: "chat", label: "聊天", icon: MessageSquareText },
  { key: "skills", label: "技能", icon: Sparkles },
  { key: "collab", label: "协作", icon: Users },
  { key: "schedule", label: "定时任务", icon: CalendarClock },
  { key: "workspace", label: "工作空间", icon: FolderTree },
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
  messageSearchProvider,
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
  messageSearchProvider?: (conversationId: string, query: string) => string;
  onSwitchConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onRenameConversation?: (conversationId: string, title: string) => void;
  onTogglePinConversation?: (conversationId: string, pinned: boolean) => void;
  onNewConversation?: () => void;
  sessionsLoading?: boolean;
  footer?: ReactNode;
}) {
  const renderItem = (it: NavItem) => {
          const Icon = it.icon;
          const active = activePage === it.key;
          return (
            <div key={it.key} className="flex flex-col">
              <button title={it.label} onClick={() => setActivePage(it.key)} className={`w-full flex items-center text-left sidebar-item relative ${active ? "active" : ""}`}>
                <Icon size={20} strokeWidth={1.7} className="sidebar-item-icon" />
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

  return (
    <div className="px-3 py-2 flex flex-col flex-1 min-h-0">
      <div className="flex shrink-0 flex-col gap-0.5">
        {primaryItems.map((item) => renderItem(item))}
      </div>

      {!collapsed ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <SessionList
            sessions={sessions}
            currentConversationId={currentConversationId}
            sessionSwitchingId={sessionSwitchingId}
            messageSearchProvider={messageSearchProvider}
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
            <Settings2 size={16} strokeWidth={1.7} className="sidebar-item-icon" />
          </button>
        </div>
        {!collapsed && footer ? <div className="ml-auto min-w-0">{footer}</div> : null}
      </div>
    </div>
  );
}
