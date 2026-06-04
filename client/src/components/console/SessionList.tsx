import { Check, MessageSquareText, MoreVertical, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SessionListConversation = {
  conversationId: string;
  sessionKey?: string;
  sessionId?: string;
  title: string;
  customTitle?: string;
  preview: string;
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
  today: "今天",
  yesterday: "昨天",
  week: "近 7 天",
  earlier: "更早",
};

function filterSessions(sessions: SessionListConversation[], query: string) {
  const q = normalizeText(query).toLowerCase();
  if (!q) return sessions;
  return sessions.filter((session) => {
    const haystack = `${session.title || ""} ${session.preview || ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

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
  searchable = variant === "mobile",
  title = "历史会话",
  loading = false,
}: SessionListProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isMobile = variant === "mobile";

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filteredSessions = useMemo(
    () => filterSessions(sessions, debouncedQuery),
    [debouncedQuery, sessions],
  );

  const groupedSessions = useMemo(() => {
    const groups = new Map<SessionGroup, SessionListConversation[]>();
    for (const session of filteredSessions) {
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
  }, [filteredSessions]);

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
      <div className={isMobile ? "mb-2 flex items-center justify-between px-1" : "mb-1 flex items-center justify-between px-3"}>
        <span style={{ color: isMobile ? "var(--oc-text-primary)" : "var(--oc-sidebar-muted)", fontSize: isMobile ? 14 : 12, fontWeight: isMobile ? 500 : 400 }}>
          {title}
        </span>
        {onNewConversation ? (
          <button
            type="button"
            title="新建会话"
            onClick={onNewConversation}
            disabled={!!sessionSwitchingId}
            className="rounded-md flex items-center justify-center"
            style={{
              width: isMobile ? 30 : 24,
              height: isMobile ? 30 : 24,
              border: isMobile ? "1px solid var(--oc-border-subtle)" : "none",
              background: isMobile ? "var(--oc-bg)" : "transparent",
              color: isMobile ? "var(--oc-text-primary)" : "var(--oc-sidebar-muted)",
              opacity: sessionSwitchingId ? 0.45 : 1,
              cursor: sessionSwitchingId ? "not-allowed" : "pointer",
            }}
          >
            <Plus size={isMobile ? 15 : 14} />
          </button>
        ) : null}
      </div>

      {searchable ? (
        <div
          className="session-searchbar mb-2 flex items-center gap-2 rounded-md px-2"
          style={{
            minHeight: 34,
            border: "1px solid var(--oc-border-subtle)",
            background: isMobile ? "var(--oc-bg)" : "rgba(255,255,255,0.03)",
          }}
        >
          <Search size={14} style={{ color: "var(--oc-text-tertiary)", flexShrink: 0 }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话"
            className="session-searchbar__input min-w-0 flex-1 bg-transparent text-sm"
            style={{
              color: "var(--oc-text-primary)",
              border: 0,
              borderColor: "transparent",
              outline: "none",
              boxShadow: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="flex items-center justify-center rounded"
              style={{ width: 22, height: 22, color: "var(--oc-text-tertiary)" }}
              aria-label="清空搜索"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      ) : null}

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
          <div className={isMobile ? "px-3 py-4 text-xs" : "px-3 py-4 text-xs"} style={{ color: "var(--oc-text-tertiary)" }}>
            暂无历史会话
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="px-3 py-4 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
            没有匹配的会话
          </div>
        ) : (
          <div className={isMobile ? "space-y-2" : "space-y-2"}>
            {groupedSessions.map((group) => (
              <div key={group.key} className="space-y-0.5">
                {isMobile || searchable ? (
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
                      className={`group w-full text-left flex items-center gap-3 sidebar-item relative ${active ? "active" : ""}`}
                      style={{
                        padding: isMobile ? "10px 10px" : "10px 16px",
                        minHeight: isMobile ? 58 : 44,
                        borderRadius: isMobile ? 8 : undefined,
                        opacity: sessionSwitchingId && !switching ? 0.52 : 1,
                        cursor: sessionSwitchingId ? "wait" : "pointer",
                      }}
                    >
                      {active && !isMobile ? <span className="sidebar-item-indicator" /> : null}
                      <MessageSquareText size={16} className="sidebar-item-icon" style={{ flexShrink: 0 }} />
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
                          <div className="sidebar-item-label truncate" style={{ fontSize: 14, fontWeight: 400, color: isMobile ? "var(--oc-text-primary)" : undefined }}>
                            {switching ? "正在切换..." : shortTitle(session)}
                          </div>
                        )}
                        {isMobile && session.preview ? (
                          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                            {session.preview}
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
                            onClick={() => setMenuId(menuOpen ? null : session.conversationId)}
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
                            <div className="session-row-menu" style={{ right: 0, top: isMobile ? 34 : 26 }}>
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
    </div>
  );
}
