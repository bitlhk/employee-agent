import { MessageSquareText, Brain, Sparkles, Radio, CalendarClock, Settings2, Users, FolderTree, Store, Mic2 } from "lucide-react";
export type PageKey = "chat" | "skills" | "weixin" | "agent" | "workspace" | "schedule" | "collab" | "meeting" | "settings";
const items: { key: PageKey; label: string; icon: any; adminOnly?: boolean }[] = [
  { key: "chat", label: "聊天", icon: MessageSquareText },
  { key: "skills", label: "技能", icon: Sparkles },
  { key: "weixin", label: "频道", icon: Radio },
  { key: "agent", label: "记忆", icon: Brain },
  { key: "collab", label: "协作", icon: Users },
  { key: "workspace", label: "工作空间", icon: FolderTree },
  { key: "schedule", label: "定时任务", icon: CalendarClock },
  { key: "meeting", label: "会议纪要", icon: Mic2 },
  { key: "settings", label: "设置", icon: Settings2 },
];
const bottomItemKeys = new Set<PageKey>(["meeting", "settings"]);
const mainItems = items.filter((it) => !bottomItemKeys.has(it.key));
const bottomItems = items.filter((it) => bottomItemKeys.has(it.key));

export function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  onOpenSettings,
  coopBadge,
  onOpenAgentMarket,
  agentMarketOpen,
}: {
  activePage: PageKey;
  setActivePage: (k: PageKey) => void;
  collapsed?: boolean;
  onOpenSettings?: () => void;
  coopBadge?: number;
  onOpenAgentMarket?: () => void;
  agentMarketOpen?: boolean;
}) {
  const renderAgentMarketButton = () => onOpenAgentMarket ? (
    <button
      title="智能体广场"
      onClick={onOpenAgentMarket}
      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left sidebar-item relative ${agentMarketOpen ? "active" : ""}`}
    >
      {agentMarketOpen && <span className="sidebar-item-indicator" />}
      <Store size={16} className="sidebar-item-icon" style={{ color: agentMarketOpen ? "var(--oc-accent)" : "var(--oc-text-secondary)" }} />
      {!collapsed && <span className="text-sm sidebar-item-label" style={{ color: agentMarketOpen ? "var(--oc-accent)" : "var(--oc-text-secondary)" }}>智能体广场</span>}
    </button>
  ) : null;

  const renderItem = (it: typeof items[number]) => {
          const Icon = it.icon;
          const active = activePage === it.key;
          return (
            <div key={it.key} className="flex flex-col gap-1">
              <button title={it.label} onClick={() => setActivePage(it.key)} className={`w-full flex items-center gap-2 px-3 py-2.5 text-left sidebar-item relative ${active ? "active" : ""}`}>
                {active && <span className="sidebar-item-indicator" />}
                <Icon size={16} className="sidebar-item-icon" style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }} />
                {!collapsed && <span className="text-sm sidebar-item-label" style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }}>{it.label}</span>}
                {it.key === "collab" && coopBadge !== undefined && coopBadge > 0 ? (
                  <span className="absolute right-2 top-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-semibold rounded-full bg-red-500 text-white" style={{ lineHeight: 1 }}>
                    {coopBadge > 99 ? "99+" : coopBadge}
                  </span>
                ) : null}
              </button>
              {it.key === "schedule" ? renderAgentMarketButton() : null}
            </div>
          );
  };

  return (
    <div className="px-2 py-3 flex flex-col flex-1 min-h-0">
      <div className="space-y-1">
        {mainItems.map(renderItem)}
      </div>
      <div className="space-y-1 pt-1">
        {bottomItems.map(renderItem)}
      </div>
    </div>
  );
}
