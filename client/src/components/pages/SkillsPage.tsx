import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Package,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/console/PageContainer";
import { handleRovingTabKey } from "@/lib/a11y";
import { MarketplacePage } from "./MarketplacePage";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type SourceKind = "builtin" | "marketplace" | "uploaded" | "generated";
type RuntimeState =
  | "ready"
  | "disabled"
  | "syncing"
  | "sync_failed"
  | "source_missing"
  | "review_pending"
  | "reviewing"
  | "review_failed";
type ReviewState = "none" | "pending" | "reviewing" | "passed" | "failed";

type RegistrySkill = {
  id: string;
  adoptId: string;
  source: {
    kind: SourceKind;
    skillId: string;
    displayName: string;
    description?: string;
    sourcePath?: string;
    version?: string;
  };
  state: RuntimeState;
  enabled: boolean;
  review: {
    state: ReviewState;
    reason?: string;
    checkedAt?: string;
  };
  sync: {
    runtimePath?: string;
    lastSyncedAt?: string;
    reason?: string;
  };
  scan?: {
    warnings: string[];
    scannedAt: string;
  };
  capabilities?: string[];
  examples?: string[];
  createdAt: string;
  updatedAt: string;
};

type SkillPackageInspectResponse = {
  skill: {
    skillId: string;
    displayName: string;
    description?: string;
    warnings?: string[];
  };
};

const SKILL_TAB_KEYS = ["mine", "market", "mcp"] as const;
type SkillTab = (typeof SKILL_TAB_KEYS)[number];
type SourceFilter = "all" | SourceKind;
type StateFilter = "all" | "ready" | "attention" | "disabled";

type McpServerStatus = "available" | "disabled" | "missing";
type McpToolSummary = {
  name: string;
  description: string;
};
type McpToolChild = {
  id: string;
  name: string;
  description: string;
  serverId: string;
  configured: boolean;
  enabled: boolean;
  status: McpServerStatus;
  existsOnDisk?: boolean;
  tools?: McpToolSummary[];
};
type McpToolGroup = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: McpServerStatus;
  availableCount: number;
  configuredCount: number;
  serverCount: number;
  children: McpToolChild[];
  recommendedSkills?: string[];
};
type McpToolsResponse = {
  items: McpToolGroup[];
  totals?: {
    groups: number;
    configuredServers: number;
    availableServers: number;
  };
};

const SOURCE_LABEL: Record<SourceKind, string> = {
  builtin: "平台内置",
  marketplace: "广场安装",
  uploaded: "我的上传",
  generated: "对话生成",
};

const STATE_LABEL: Record<RuntimeState, string> = {
  ready: "可用",
  disabled: "已停用",
  syncing: "同步中",
  sync_failed: "同步失败",
  source_missing: "源文件缺失",
  review_pending: "待审核",
  reviewing: "审核中",
  review_failed: "审核未通过",
};

const BUILTIN_DISPLAY: Record<string, { name: string; description?: string }> = {
  "finance-news": {
    name: "金融新闻晨报",
    description: "汇总金融资讯、市场动态和关键事件，适合晨报与投研简报。",
  },
  pptx: {
    name: "PPT 生成",
    description: "根据材料生成演示文稿草稿，适合汇报、路演和研究展示。",
  },
  "research-report": {
    name: "研究报告",
    description: "生成研报结构、观点提纲和分析草稿，适合投研场景。",
  },
  "stock-query": {
    name: "行情查询",
    description: "查询股票行情与基础市场数据，适合快速获取标的概览。",
  },
};

function sourceIcon(kind: SourceKind) {
  if (kind === "builtin") return <ShieldCheck size={17} aria-hidden="true" />;
  if (kind === "marketplace") return <Store size={17} aria-hidden="true" />;
  if (kind === "uploaded") return <Package size={17} aria-hidden="true" />;
  return <Sparkles size={17} aria-hidden="true" />;
}

function skillIcon(skill: RegistrySkill) {
  const id = skill.id.toLowerCase();
  if (id.includes("finance") || id.includes("stock") || id.includes("rate")) return <BarChart3 size={18} aria-hidden="true" />;
  if (id.includes("report") || id.includes("ppt") || id.includes("doc")) return <FileText size={18} aria-hidden="true" />;
  if (id.includes("compliance") || id.includes("credit") || id.includes("due-diligence")) return <BriefcaseBusiness size={18} aria-hidden="true" />;
  if (id.includes("creator") || id.includes("builder")) return <Wrench size={18} aria-hidden="true" />;
  return <Layers size={18} aria-hidden="true" />;
}

function stateTone(state: RuntimeState): "ok" | "warn" | "danger" | "neutral" {
  if (state === "ready") return "ok";
  if (state === "sync_failed" || state === "source_missing" || state === "review_failed") return "danger";
  if (state === "syncing" || state === "review_pending" || state === "reviewing") return "warn";
  return "neutral";
}

function pillToneClass(tone: "ok" | "warn" | "danger" | "neutral") {
  return `skills-chip--${tone}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `request failed: ${res.status}`);
  return data as T;
}

async function fetchSkillPackageBinary<T>(url: string, file: File, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params);
  return fetchJson<T>(`${url}?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
}

function reasonOf(skill: RegistrySkill): string {
  return skill.sync?.reason || skill.review?.reason || "";
}

function displayNameOf(skill: RegistrySkill): string {
  if (skill.source.kind === "builtin") return BUILTIN_DISPLAY[skill.id]?.name || skill.source.displayName || skill.id;
  return skill.source.displayName || skill.id;
}

function descriptionOf(skill: RegistrySkill): string {
  if (skill.source.kind === "builtin") return BUILTIN_DISPLAY[skill.id]?.description || skill.source.description || "暂无说明";
  return skill.source.description || "暂无说明";
}

function sourceCanRename(skill: RegistrySkill) {
  return skill.source.kind === "uploaded" || skill.source.kind === "generated";
}

function sourceCanDestroy(skill: RegistrySkill) {
  return skill.source.kind === "uploaded" || skill.source.kind === "generated";
}

function sourceCanUninstall(skill: RegistrySkill) {
  return skill.source.kind === "marketplace";
}

function sourceCanPublish(skill: RegistrySkill) {
  return skill.source.kind === "uploaded" || skill.source.kind === "generated";
}

function SkillPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "ok" | "warn" | "danger" | "neutral" }) {
  return <span className={`skills-chip ${pillToneClass(tone)}`}>{children}</span>;
}

function mcpStatusTone(status: McpServerStatus): "ok" | "warn" | "neutral" {
  if (status === "available") return "ok";
  if (status === "disabled") return "warn";
  return "neutral";
}

function mcpStatusLabel(status: McpServerStatus) {
  if (status === "available") return "可用";
  if (status === "disabled") return "已停用";
  return "未接入";
}

function McpToolsPage({ adoptId }: { adoptId?: string }) {
  const [items, setItems] = useState<McpToolGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [openChildId, setOpenChildId] = useState<string | null>(null);

  const loadMcpTools = async () => {
    if (!adoptId) return;
    setLoading(true);
    try {
      const data = await fetchJson<McpToolsResponse>(`/api/claw/mcp-tools/status?adoptId=${encodeURIComponent(adoptId)}`);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      toast.error(`MCP 工具加载失败${e?.message ? `: ${e.message}` : ""}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMcpTools();
  }, [adoptId]);

  useEffect(() => {
    setOpenChildId((current) => {
      if (current && items.some((item) => item.children?.some((child) => `${item.id}:${child.id}` === current))) return current;
      const firstAvailable = items
        .flatMap((item) => (item.children || []).map((child) => ({ item, child })))
        .find(({ child }) => child.status === "available");
      return firstAvailable ? `${firstAvailable.item.id}:${firstAvailable.child.id}` : null;
    });
  }, [items]);

  const availableGroups = items.filter((item) => item.status === "available").length;
  const configuredServers = items.reduce((sum, item) => sum + item.configuredCount, 0);
  const availableServers = items.reduce((sum, item) => sum + item.availableCount, 0);

  return (
    <div className="skills-market skills-mcp">
      <div className="skills-market-hero settings-card">
        <div className="skills-market-hero__icon"><Wrench size={18} /></div>
        <div className="min-w-0">
          <div className="skills-market-hero__title">MCP工具</div>
          <div className="skills-market-hero__desc">
            MCP 是平台统一接入的宿主机工具能力，只展示当前 OpenClaw 的注册和可用状态；安装、密钥和网络访问由管理员统一治理。
          </div>
        </div>
      </div>

      <div className="skills-header">
        <div className="skills-summary skills-muted-text text-xs">
          共 {items.length} 类 MCP · {availableGroups} 类可用 · {availableServers}/{configuredServers} 个服务已启用
        </div>
        <button className="skills-btn" onClick={() => void loadMcpTools()} disabled={loading}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {loading && <div className="settings-card skills-market-empty"><RefreshCw size={18} className="animate-spin" /><div>正在加载 MCP 工具...</div></div>}
      {!loading && items.length === 0 && <div className="settings-card skills-market-empty"><Wrench size={22} /><div>暂无 MCP 工具配置</div></div>}

      {!loading && items.length > 0 && (
        <div className="skills-mcp-groups">
          {items.map((item) => (
            <section key={item.id} className="settings-card skills-mcp-group">
              <div className="skills-mcp-group__head">
                <div className="skills-mcp-group__title-wrap">
                  <div className="skills-mcp-group__title">
                    <Wrench size={16} />
                    <span>{item.name}</span>
                  </div>
                  <div className="skills-mcp-group__desc">{item.description}</div>
                </div>
                <div className="skills-mcp-group__status">
                  <span className="skills-chip skills-chip--neutral">{item.category}</span>
                  <span className={`skills-chip ${pillToneClass(mcpStatusTone(item.status))}`}>
                    {mcpStatusLabel(item.status)} {item.availableCount}/{item.serverCount}
                  </span>
                </div>
              </div>

              <div className="skills-mcp-children">
                {(item.children || []).map((child) => {
                  const childKey = `${item.id}:${child.id}`;
                  const open = openChildId === childKey;
                  const childTone = mcpStatusTone(child.status);
                  return (
                    <div key={child.id} className="skills-mcp-child" data-open={open ? "true" : "false"}>
                      <button className="skills-mcp-child__row" onClick={() => setOpenChildId(open ? null : childKey)}>
                        <span className="skills-mcp-child__chevron">
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </span>
                        <span className="skills-mcp-child__main">
                          <span className="skills-mcp-child__name">{child.name}</span>
                          <span className="skills-mcp-child__desc">{child.description}</span>
                        </span>
                        <span className="skills-mcp-child__meta">
                          <span className="skills-mcp-child__server">{child.serverId}</span>
                          <span className={`skills-chip ${pillToneClass(childTone)}`}>{mcpStatusLabel(child.status)}</span>
                        </span>
                      </button>

                      <div className="skills-mcp-child__panel" aria-hidden={!open}>
                        <div className="skills-mcp-tools">
                          {(child.tools && child.tools.length > 0 ? child.tools : [{ name: "工具清单", description: "该 MCP 已接入，工具明细以管理员配置为准。" }]).map((tool) => (
                            <div key={`${child.id}:${tool.name}`} className="skills-mcp-tool">
                              <div className="skills-mcp-tool__name">{tool.name}</div>
                              <div className="skills-mcp-tool__desc">{tool.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {item.recommendedSkills && item.recommendedSkills.length > 0 && (
                <div className="skills-mcp-related">
                  关联技能：{item.recommendedSkills.join("、")}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillsToolbar({
  q,
  setQ,
  source,
  setSource,
  state,
  setState,
}: {
  q: string;
  setQ: (v: string) => void;
  source: SourceFilter;
  setSource: (v: SourceFilter) => void;
  state: StateFilter;
  setState: (v: StateFilter) => void;
}) {
  const sourceFilters: { key: SourceFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "builtin", label: "平台内置" },
    { key: "marketplace", label: "广场安装" },
    { key: "uploaded", label: "我的上传" },
    { key: "generated", label: "对话生成" },
  ];
  const stateFilters: { key: StateFilter; label: string }[] = [
    { key: "all", label: "全部状态" },
    { key: "ready", label: "可用" },
    { key: "attention", label: "需处理" },
    { key: "disabled", label: "已停用" },
  ];

  return (
    <div className="skills-toolbar">
      <div className="skills-search">
        <Search size={14} className="skills-search-icon" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索技能名称、说明或来源" />
      </div>
      <div className="skills-tabs" aria-label="技能来源筛选">
        {sourceFilters.map((item) => (
          <button key={item.key} className={`skills-tab ${source === item.key ? "active" : ""}`} onClick={() => setSource(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="skills-tabs" aria-label="技能状态筛选">
        {stateFilters.map((item) => (
          <button key={item.key} className={`skills-tab ${state === item.key ? "active" : ""}`} onClick={() => setState(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  onOpen,
  onToggle,
  busy,
}: {
  skill: RegistrySkill;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
}) {
  const tone = stateTone(skill.state);
  return (
    <div className="skills-row">
      <div className="skills-row-main" onClick={onOpen}>
        <div className="skills-icon">{skillIcon(skill)}</div>
        <div className="min-w-0">
          <div className="skills-name">{displayNameOf(skill)}</div>
          <div className="skills-desc">{descriptionOf(skill)}</div>
          <div className="skills-badges">
            <SkillPill>{sourceIcon(skill.source.kind)} {SOURCE_LABEL[skill.source.kind]}</SkillPill>
            <SkillPill tone={tone}>{STATE_LABEL[skill.state]}</SkillPill>
            {skill.review.state !== "none" && <SkillPill tone={skill.review.state === "failed" ? "danger" : "warn"}>审核：{skill.review.state}</SkillPill>}
          </div>
          {["sync_failed", "source_missing", "review_failed"].includes(skill.state) && (
            <div className="skills-danger-text text-xs mt-1">
              {reasonOf(skill) || "需要处理后才能使用"}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className={`skills-switch ${skill.enabled ? "is-on" : "is-off"}`} disabled={busy} onClick={() => onToggle(!skill.enabled)} aria-label={skill.enabled ? "停用技能" : "启用技能"}>
          <span className={`skills-switch-dot ${skill.enabled ? "on" : ""}`} />
        </button>
        <button className="skills-btn" onClick={onOpen}>详情</button>
      </div>
    </div>
  );
}

function SkillDetailDrawer({
  skill,
  onClose,
  onReconcile,
  onToggle,
  onUninstall,
  onDestroy,
  onRename,
  onPublish,
  busy,
}: {
  skill: RegistrySkill | null;
  onClose: () => void;
  onReconcile: (skill: RegistrySkill) => void;
  onToggle: (skill: RegistrySkill, enabled: boolean) => void;
  onUninstall: (skill: RegistrySkill) => void;
  onDestroy: (skill: RegistrySkill) => void;
  onRename: (skill: RegistrySkill) => void;
  onPublish: (skill: RegistrySkill) => void;
  busy: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => setAdvancedOpen(false), [skill?.id]);
  if (!skill) return null;
  const tone = stateTone(skill.state);

  return (
    <div className="skills-drawer-mask" onClick={onClose}>
      <div className="skills-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="skills-drawer-head">
          <div>
            <div className="skills-drawer-title text-sm">
              {displayNameOf(skill)}
            </div>
            <div className="skills-muted-text text-xs">
              {SOURCE_LABEL[skill.source.kind]} · {skill.id}
            </div>
          </div>
          <button className="skills-btn" onClick={onClose}>关闭</button>
        </div>
        <div className="skills-drawer-body">
          <div className="settings-card space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <SkillPill>{sourceIcon(skill.source.kind)} {SOURCE_LABEL[skill.source.kind]}</SkillPill>
              <SkillPill tone={tone}>{STATE_LABEL[skill.state]}</SkillPill>
              {skill.review.state !== "none" && <SkillPill tone={skill.review.state === "failed" ? "danger" : "warn"}>审核：{skill.review.state}</SkillPill>}
            </div>

            <div className="skills-body-text text-xs">
              {descriptionOf(skill)}
            </div>

            {reasonOf(skill) && (
              <div className="settings-card skills-danger-card">
                <div className="skills-danger-message flex items-start gap-2 text-xs">
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{reasonOf(skill)}</span>
                </div>
              </div>
            )}

            <div className="settings-row">
              <span className="settings-label">启用状态</span>
              <button className={`skills-switch ${skill.enabled ? "is-on" : "is-off"}`} disabled={busy} onClick={() => onToggle(skill, !skill.enabled)}>
                <span className={`skills-switch-dot ${skill.enabled ? "on" : ""}`} />
              </button>
            </div>

            <div className="settings-row">
              <span className="settings-label">最近同步</span>
              <span className="skills-muted-text text-xs">{skill.sync.lastSyncedAt || "未记录"}</span>
            </div>

            <div className="space-y-2">
              <div className="settings-label">操作</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="skills-btn" disabled={busy} onClick={() => onReconcile(skill)}><RotateCw size={13} /> 重新同步</button>
                <button className="skills-btn" disabled={busy} onClick={() => onToggle(skill, !skill.enabled)}>
                  {skill.enabled ? <PowerOff size={13} /> : <Power size={13} />}
                  {skill.enabled ? "停用" : "启用"}
                </button>
                {sourceCanRename(skill) && <button className="skills-btn" disabled={busy} onClick={() => onRename(skill)}><Pencil size={13} /> 重命名</button>}
                {sourceCanPublish(skill) && <button className="skills-btn" disabled={busy} onClick={() => onPublish(skill)}><Store size={13} /> 提交到中队专区</button>}
                {sourceCanUninstall(skill) && <button className="skills-btn" disabled={busy} onClick={() => onUninstall(skill)}><Trash2 size={13} /> 卸载</button>}
                {sourceCanDestroy(skill) && <button className="skills-btn" disabled={busy} onClick={() => onDestroy(skill)}><Trash2 size={13} /> 删除</button>}
              </div>
            </div>

            <div className="space-y-2">
              <button className="skills-group-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
                {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>高级信息</span>
              </button>
              {advancedOpen && (
                <div className="skills-advanced-info text-xs space-y-1">
                  <div>sourcePath: {skill.source.sourcePath || "无"}</div>
                  <div>runtimePath: {skill.sync.runtimePath || "无"}</div>
                  <div>version: {skill.source.version || "未记录"}</div>
                  <div>scan: {skill.scan?.scannedAt || "未扫描"}</div>
                  {skill.scan?.warnings?.length ? (
                    <div className="skills-warning-list space-y-1">
                      <div>静态扫描提示：</div>
                      {skill.scan.warnings.map((warning, idx) => (
                        <div key={`${warning}-${idx}`}>- {warning}</div>
                      ))}
                    </div>
                  ) : (
                    <div>静态扫描提示：无</div>
                  )}
                  <div>updatedAt: {skill.updatedAt}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillsPage({ adoptId }: {
  skills?: { shared: any[]; system: any[]; private: any[] } | null | undefined;
  canEdit?: boolean;
  pending?: boolean;
  onToggle?: (skillId: string, enable: boolean, source: "shared" | "system") => void;
  adoptId?: string;
}) {
  const { confirm, dialog } = useConfirmDialog();
  const [skillTab, setSkillTab] = useState<SkillTab>("mine");
  const [items, setItems] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RegistrySkill | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    if (!adoptId) return;
    setLoading(true);
    try {
      const data = await fetchJson<{ items: RegistrySkill[] }>(`/api/claw/skills/registry?adoptId=${encodeURIComponent(adoptId)}`);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      toast.error(`技能加载失败${e?.message ? `: ${e.message}` : ""}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [adoptId]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim().toLowerCase()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    return items.filter((skill) => {
      if (sourceFilter !== "all" && skill.source.kind !== sourceFilter) return false;
      if (stateFilter === "ready" && skill.state !== "ready") return false;
      if (stateFilter === "disabled" && skill.state !== "disabled") return false;
      if (stateFilter === "attention" && !["sync_failed", "source_missing", "review_pending", "reviewing", "review_failed"].includes(skill.state)) return false;
      if (!qDebounced) return true;
      return `${skill.id} ${displayNameOf(skill)} ${descriptionOf(skill)} ${SOURCE_LABEL[skill.source.kind]}`.toLowerCase().includes(qDebounced);
    });
  }, [items, qDebounced, sourceFilter, stateFilter]);

  const counts = useMemo(() => {
    return {
      total: items.length,
      attention: items.filter((x) => ["sync_failed", "source_missing", "review_pending", "reviewing", "review_failed"].includes(x.state)).length,
      ready: items.filter((x) => x.state === "ready").length,
    };
  }, [items]);

  const reloadDetail = (nextItems: RegistrySkill[]) => {
    if (!detail) return;
    const nextDetail = nextItems.find((x) => x.id === detail.id && x.adoptId === detail.adoptId) || null;
    setDetail(nextDetail);
  };

  const mutate = async (skill: RegistrySkill, label: string, fn: () => Promise<void>) => {
    setBusyId(skill.id);
    try {
      await fn();
      const data = await fetchJson<{ items: RegistrySkill[] }>(`/api/claw/skills/registry?adoptId=${encodeURIComponent(skill.adoptId)}`);
      const next = Array.isArray(data.items) ? data.items : [];
      setItems(next);
      reloadDetail(next);
      toast.success(label);
    } catch (e: any) {
      toast.error(`${label}失败${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setBusyId(null);
    }
  };

  const onReconcile = (skill: RegistrySkill) => mutate(skill, "已重新同步", async () => {
    await fetchJson("/api/claw/skills/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adoptId: skill.adoptId, skillId: skill.id }),
    });
  });

  const onToggleSkill = (skill: RegistrySkill, enabled: boolean) => mutate(skill, enabled ? "已启用" : "已停用", async () => {
    await fetchJson("/api/claw/skills/set-enabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adoptId: skill.adoptId, skillId: skill.id, enabled }),
    });
  });

  const onUninstall = async (skill: RegistrySkill) => {
    const ok = await confirm({
      title: "卸载技能？",
      description: `确认卸载 ${displayNameOf(skill)}？广场源不会删除，可重新安装。`,
      confirmText: "卸载",
      variant: "danger",
    });
    if (!ok) return;
    void mutate(skill, "已卸载", async () => {
      await fetchJson("/api/claw/skills/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: skill.adoptId, skillId: skill.id }),
      });
    });
  };

  const onDestroy = async (skill: RegistrySkill) => {
    const ok = await confirm({
      title: "删除技能？",
      description: `确认删除 ${displayNameOf(skill)}？这会删除源文件和运行时副本。`,
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    void mutate(skill, "已删除", async () => {
      await fetchJson("/api/claw/skills/destroy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: skill.adoptId, skillId: skill.id }),
      });
    });
  };

  const onRename = (skill: RegistrySkill) => {
    const displayName = prompt("新的技能名称", displayNameOf(skill))?.trim();
    if (!displayName || displayName === skill.source.displayName) return;
    void mutate(skill, "已重命名", async () => {
      await fetchJson("/api/claw/skills/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: skill.adoptId, skillId: skill.id, displayName }),
      });
    });
  };

  const onPublish = (skill: RegistrySkill) => {
    const version = prompt("发布版本号", skill.source.version || "1.0.0")?.trim() || "1.0.0";
    if (!version) return;
    void mutate(skill, "已提交审核", async () => {
      await fetchJson("/api/claw/skill-market/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: skill.adoptId, skillId: skill.id, version }),
      });
    });
  };

  const onUploadFile = async (file: File) => {
    if (!adoptId) {
      toast.error("请先进入具体员工智能体实例后再上传技能");
      return;
    }
    if (!/\.(zip|skill)$/i.test(file.name)) {
      toast.error("请上传 .zip 或 .skill 技能包");
      return;
    }
    setUploading(true);
    try {
      const inspect = await fetchSkillPackageBinary<SkillPackageInspectResponse>("/api/claw/skill-package/inspect", file, {
        adoptId,
        filename: file.name,
      });
      const defaultName = inspect.skill.displayName || inspect.skill.skillId || file.name.replace(/\.(zip|skill)$/i, "");
      const displayName = prompt("技能名称", defaultName)?.trim();
      if (!displayName) return;
      if (displayName.length < 2) {
        toast.error("技能名称至少 2 个字");
        return;
      }
      const description = prompt("技能说明", inspect.skill.description || "")?.trim() || inspect.skill.description || "";
      await fetchSkillPackageBinary("/api/claw/skill-package/upload", file, {
        adoptId,
        filename: file.name,
        displayName,
        description,
      });
      if (inspect.skill.warnings?.length) {
        toast.warning(`技能已上传，静态扫描提示 ${inspect.skill.warnings.length} 项，请在详情中确认。`);
      } else {
        toast.success("技能已上传并同步到运行环境");
      }
      setSourceFilter("uploaded");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "上传失败");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  return (
    <PageContainer title="技能">
      {dialog}
      <div className="skills-page">
        <div className="page-tabs" role="tablist" aria-label="技能分区" onKeyDown={(e) => handleRovingTabKey(e, SKILL_TAB_KEYS, skillTab, setSkillTab)}>
          <button id="skills-tab-mine" className="page-tab" data-active={skillTab === "mine" ? "true" : "false"} role="tab" aria-selected={skillTab === "mine"} aria-controls="skills-panel-mine" tabIndex={skillTab === "mine" ? 0 : -1} onClick={() => setSkillTab("mine")}>
            <Package className="page-tab__icon" aria-hidden="true" />
            我的技能
          </button>
          <button id="skills-tab-market" className="page-tab" data-active={skillTab === "market" ? "true" : "false"} role="tab" aria-selected={skillTab === "market"} aria-controls="skills-panel-market" tabIndex={skillTab === "market" ? 0 : -1} onClick={() => setSkillTab("market")}>
            <Store className="page-tab__icon" aria-hidden="true" />
            技能广场
          </button>
          <button id="skills-tab-mcp" className="page-tab" data-active={skillTab === "mcp" ? "true" : "false"} role="tab" aria-selected={skillTab === "mcp"} aria-controls="skills-panel-mcp" tabIndex={skillTab === "mcp" ? 0 : -1} onClick={() => setSkillTab("mcp")}>
            <Wrench className="page-tab__icon" aria-hidden="true" />
            MCP工具
          </button>
        </div>

        {skillTab === "market" && (
          <div id="skills-panel-market" className="skills-panel skills-panel--market stealth-scrollbar" role="tabpanel" aria-labelledby="skills-tab-market" tabIndex={0}>
            <MarketplacePage adoptId={adoptId} />
          </div>
        )}

        {skillTab === "mcp" && (
          <div id="skills-panel-mcp" className="skills-panel skills-panel--market stealth-scrollbar" role="tabpanel" aria-labelledby="skills-tab-mcp" tabIndex={0}>
            <McpToolsPage adoptId={adoptId} />
          </div>
        )}

        {skillTab === "mine" && (
          <div id="skills-panel-mine" className="skills-panel stealth-scrollbar" role="tabpanel" aria-labelledby="skills-tab-mine" tabIndex={0}>
            <div className="skills-header">
              <div className="skills-summary skills-muted-text text-xs">
                共 {counts.total} 个技能 · {counts.ready} 个可用 · {counts.attention} 个需处理
              </div>
              <div className="flex items-center gap-2">
                <button className="skills-btn" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> 刷新</button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".zip,.skill"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onUploadFile(file);
                  }}
                />
                <button className="skills-btn" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
                  <Upload size={13} /> {uploading ? "上传中..." : "上传技能"}
                </button>
              </div>
            </div>
            <SkillsToolbar q={q} setQ={setQ} source={sourceFilter} setSource={setSourceFilter} state={stateFilter} setState={setStateFilter} />

            <div className="skills-list">
              {loading && <div className="settings-card skills-muted-card text-sm">正在加载技能...</div>}
              {!loading && filtered.length === 0 && <div className="settings-card skills-muted-card text-sm">暂无匹配技能</div>}
              {!loading && filtered.map((skill) => (
                <SkillRow
                  key={`${skill.adoptId}:${skill.id}`}
                  skill={skill}
                  busy={busyId === skill.id}
                  onOpen={() => setDetail(skill)}
                  onToggle={(enabled) => onToggleSkill(skill, enabled)}
                />
              ))}
            </div>

            <SkillDetailDrawer
              skill={detail}
              busy={!!busyId}
              onClose={() => setDetail(null)}
              onReconcile={onReconcile}
              onToggle={onToggleSkill}
              onUninstall={onUninstall}
              onDestroy={onDestroy}
              onRename={onRename}
              onPublish={onPublish}
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
