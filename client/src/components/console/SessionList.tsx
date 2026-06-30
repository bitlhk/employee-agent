import { Check, ChevronDown, ChevronRight, MessageSquareText, MoreVertical, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SessionListConversation = {
  conversationId: string;
  sessionKey?: string;
  sessionId?: string;
  title: string;
  customTitle?: string;
  preview: string;
  searchText?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
};

type SessionGroup = "pinned" | "today" | "yesterday" | "week" | "earlier";

type SessionListProps = {
  sessions?: SessionListConversation[];
  currentConversationId?: string;
  sessionSwitchingId?: string | null;
  messageSearchProvider?: (conversationId: string, query: string) => string;
  onSwitchConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onRenameConversation?: (conversationId: string, title: string) => void;
  onTogglePinConversation?: (conversationId: string, pinned: boolean) => void;
  onNewConversation?: () => void;
  variant?: "sidebar" | "mobile";
  searchable?: boolean;
  title?: string;
  loading?: boolean;
};

function normalizeText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shortTitle(session: SessionListConversation) {
  return normalizeText(session.customTitle || session.title || "未命名会话");
}

function formatUpdatedAt(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function groupForTimestamp(ts: number): SessionGroup {
  if (!Number.isFinite(ts) || ts <= 0) return "earlier";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  if (d > weekAgo) return "week";
  return "earlier";
}

const GROUP_LABELS: Record<SessionGroup, string> = {
  pinned: "置顶",
  today: "",
  yesterday: "",
  week: "",
  earlier: "",
};

export function SessionList({
  sessions = [],
  currentConversationId,
  sessionSwitchingId,
  onSwitchConversation,
  onDeleteConversation,
  onRenameConversation,
  onTogglePinConversation,
  onNewConversation,
  variant = "sidebar",
  title = "历史会话",
  loading = false,
}: SessionListProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("bottom");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [historyCollapsed, setHistoryCollapsed] = useState(() => {
    try {
      return localStorage.getItem("ea_history_sessions_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isMobile = variant === "mobile";

  useEffect(() => {
    if (!menuId) return;
    const closeMenu = () => setMenuId(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuId]);

  useEffect(() => {
    try {
      localStorage.setItem("ea_history_sessions_collapsed", historyCollapsed ? "1" : "0");
    } catch {}
  }, [historyCollapsed]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<SessionGroup, SessionListConversation[]>();
    for (const session of sessions) {
      const key = session.pinnedAt ? "pinned" : groupForTimestamp(session.updatedAt || session.createdAt);
      const rows = groups.get(key) || [];
      rows.push(session);
      groups.set(key, rows);
    }
    return (["pinned", "today", "yesterday", "week", "earlier"] as SessionGroup[])
      .filter((key) => groups.has(key))
      .map((key) => ({
        key,
        sessions: (groups.get(key) || []).sort((a, b) => {
          if (key === "pinned") return Number(b.pinnedAt || 0) - Number(a.pinnedAt || 0);
          return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        }),
      }));
  }, [sessions]);

  const saveRename = (session: SessionListConversation) => {
    const title = normalizeText(draftTitle).slice(0, 60);
    setEditingId(null);
    setDraftTitle("");
    if (!title || title === shortTitle(session)) return;
    onRenameConversation?.(session.conversationId, title);
  };

  const startRename = (session: SessionListConversation) => {
    setMenuId(null);
    setEditingId(session.conversationId);
    setDraftTitle(shortTitle(session));
  };

  const toggleRowMenu = (sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (menuId === sessionId) {
      setMenuId(null);
      return;
    }
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const rootRect = rootRef.current?.getBoundingClientRect();
    const lowerBound = rootRect ? Math.min(rootRect.bottom, window.innerHeight) : window.innerHeight;
    const menuHeight = onRenameConversation && onTogglePinConversation && onDeleteConversation ? 118 : 88;
    const gap = 8;
    const spaceBelow = lowerBound - buttonRect.bottom;
    setMenuPlacement(spaceBelow >= menuHeight + gap ? "bottom" : "top");
    setMenuId(sessionId);
  };

  const skeletonRows = isMobile ? 5 : 7;

  useEffect(() => {
    if (!menuId) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuId]);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className={isMobile ? "mb-2 flex items-center justify-between px-1" : "mt-4 mb-2 flex items-center justify-between px-0"}>
        <button
          type="button"
          onClick={() => setHistoryCollapsed((value) => !value)}
          className="flex min-w-0 items-center gap-1 rounded-md"
          title={historyCollapsed ? "显示历史会话" : "隐藏历史会话"}
          style={{
            color: isMobile ? "var(--oc-text-primary)" : "var(--oc-sidebar-muted)",
            fontSize: isMobile ? 14 : 12,
            fontWeight: 500,
            padding: isMobile ? "4px 6px" : "2px 0",
          }}
        >
          {historyCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1">
          {!historyCollapsed && sessions.length > 0 ? (
            <span style={{ color: "var(--oc-text-tertiary)", fontSize: 11 }}>
              {sessions.length}
            </span>
          ) : null}
          {onNewConversation ? (
            <button
              type="button"
              title="新建会话"
              onClick={onNewConversation}
              disabled={!!sessionSwitchingId}
              className="rounded-md flex items-center justify-center"
              style={{
                width: isMobile ? 30 : 16,
                height: isMobile ? 30 : 16,
                border: isMobile ? "1px solid var(--oc-border-subtle)" : "none",
                background: isMobile ? "var(--oc-bg)" : "transparent",
                color: isMobile ? "var(--oc-text-primary)" : "var(--oc-sidebar-muted)",
                opacity: sessionSwitchingId ? 0.45 : 1,
                cursor: sessionSwitchingId ? "not-allowed" : "pointer",
              }}
            >
              <Plus size={isMobile ? 15 : 16} />
            </button>
          ) : null}
        </div>
      </div>

      {!historyCollapsed ? (
      <div className="min-h-0 flex-1 overflow-y-auto stealth-scrollbar pr-1">
        {loading ? (
          <div className="space-y-2 px-2 py-2" aria-label="正在加载会话">
            {Array.from({ length: skeletonRows }).map((_, index) => (
              <div key={index} className="session-list-skeleton-row" style={{ minHeight: isMobile ? 58 : 44 }}>
                <span className="session-list-skeleton-dot" />
                <span className="session-list-skeleton-lines">
                  <span style={{ width: `${62 + (index % 3) * 10}%` }} />
                  {isMobile ? <span style={{ width: `${44 + (index % 2) * 14}%` }} /> : null}
                </span>
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className={isMobile ? "px-3 py-4 text-xs text-center" : "px-3 py-4 text-center"} style={{ color: "var(--oc-text-tertiary)", fontSize: 13 }}>
            暂无历史会话
          </div>
        ) : (
          <div className={isMobile ? "space-y-2" : "space-y-0.5"}>
            {groupedSessions.map((group) => (
              <div key={group.key} className="space-y-0.5">
                {isMobile && GROUP_LABELS[group.key] ? (
                  <div className="px-2 pb-1 text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
                    {GROUP_LABELS[group.key]}
                  </div>
                ) : null}
                {group.sessions.map((session) => {
                  const active = session.conversationId === currentConversationId;
                  const switching = sessionSwitchingId === session.conversationId;
                  const disabled = !!sessionSwitchingId;
                  const editing = editingId === session.conversationId;
                  const menuOpen = menuId === session.conversationId;
                  const pinned = Boolean(session.pinnedAt);
                  const previewText = session.preview || "";
                  return (
                    <div
                      key={session.conversationId}
                      role="button"
                      tabIndex={0}
                      title={shortTitle(session)}
                      onClick={() => {
                        if (!disabled) onSwitchConversation?.(session.conversationId);
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && !disabled) {
                          event.preventDefault();
                          onSwitchConversation?.(session.conversationId);
                        }
                      }}
                      className={`group w-full text-left flex items-center sidebar-item session-list-item relative ${active ? "active" : ""}`}
                      style={{
                        padding: isMobile ? "10px 10px" : undefined,
                        minHeight: isMobile ? 58 : undefined,
                        borderRadius: isMobile ? 8 : undefined,
                        opacity: sessionSwitchingId && !switching ? 0.52 : 1,
                        cursor: sessionSwitchingId ? "wait" : "pointer",
                      }}
                    >
                      {active && !isMobile ? <span className="sidebar-item-indicator" /> : null}
                      <MessageSquareText size={18} strokeWidth={1.7} className="sidebar-item-icon" style={{ flexShrink: 0 }} />
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                            <input
                              value={draftTitle}
                              autoFocus
                              maxLength={60}
                              className="session-rename-input min-w-0 flex-1"
                              onChange={(event) => setDraftTitle(event.target.value)}
                              onBlur={() => saveRename(session)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveRename(session);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setEditingId(null);
                                  setDraftTitle("");
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="session-mini-action"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                saveRename(session);
                              }}
                              title="保存"
                            >
                              <Check size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="sidebar-item-label truncate" style={{ fontSize: isMobile ? 14 : 13, fontWeight: 400, color: isMobile ? "var(--oc-text-primary)" : undefined }}>
                            {switching ? "正在切换..." : shortTitle(session)}
                          </div>
                        )}
                        {isMobile && previewText ? (
                          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                            {previewText}
                          </div>
                        ) : null}
                        {isMobile ? (
                          <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
                            <span>{formatUpdatedAt(session.updatedAt)}</span>
                            {session.messageCount > 0 ? <span>{session.messageCount} 条</span> : null}
                          </div>
                        ) : null}
                      </div>
                      {!isMobile ? (
                        <span className="group-hover:hidden" style={{ color: "var(--oc-sidebar-subtle)", fontSize: 11, flexShrink: 0 }}>
                          {formatUpdatedAt(session.updatedAt)}
                        </span>
                      ) : null}
                      {onRenameConversation || onTogglePinConversation || onDeleteConversation ? (
                        <div className="relative" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            title="会话操作"
                            disabled={disabled}
                            onClick={(event) => toggleRowMenu(session.conversationId, event)}
                            className={`${isMobile || menuOpen ? "flex" : "hidden group-hover:flex"} items-center justify-center rounded-md`}
                            style={{
                              width: isMobile ? 30 : 22,
                              height: isMobile ? 30 : 22,
                              color: isMobile ? "var(--oc-text-tertiary)" : "var(--oc-sidebar-subtle)",
                              flexShrink: 0,
                              opacity: disabled ? 0.45 : 1,
                            }}
                          >
                            <MoreVertical size={isMobile ? 15 : 14} />
                          </button>
                          {menuOpen ? (
                            <div
                              className="session-row-menu"
                              style={{
                                right: 0,
                                ...(menuPlacement === "top"
                                  ? { bottom: isMobile ? 34 : 26 }
                                  : { top: isMobile ? 34 : 26 }),
                              }}
                            >
                              {onTogglePinConversation ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuId(null);
                                    onTogglePinConversation(session.conversationId, !pinned);
                                  }}
                                >
                                  {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                                  <span>{pinned ? "取消置顶" : "置顶"}</span>
                                </button>
                              ) : null}
                              {onRenameConversation ? (
                                <button type="button" onClick={() => startRename(session)}>
                                  <Pencil size={13} />
                                  <span>重命名</span>
                                </button>
                              ) : null}
                              {onDeleteConversation ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuId(null);
                                    onDeleteConversation(session.conversationId);
                                  }}
                                  className="session-row-menu-danger"
                                >
                                  <Trash2 size={13} />
                                  <span>删除</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      ) : null}
    </div>
  );
}
