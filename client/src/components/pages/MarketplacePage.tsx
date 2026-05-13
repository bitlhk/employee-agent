import { useEffect, useState, type ComponentType } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  Check,
  Compass,
  Database,
  Download,
  FileText,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type OriginKey = "opensource" | "squad";

const CATEGORY_MAP: Record<string, { label: string; Icon: ComponentType<{ size?: number; className?: string }> }> = {
  all: { label: "全部", Icon: Layers },
  writing: { label: "办公效率", Icon: FileText },
  office: { label: "办公效率", Icon: FileText },
  finance: { label: "金融专业", Icon: BarChart3 },
  dev: { label: "开发工具", Icon: Wrench },
  general: { label: "通用", Icon: Sparkles },
  data: { label: "数据分析", Icon: Database },
};

const ORIGIN_META: Record<OriginKey, { label: string; Icon: ComponentType<{ size?: number; className?: string }> }> = {
  opensource: { label: "开源社区", Icon: Compass },
  squad: { label: "中队原创", Icon: Sparkles },
};

interface MarketSkill {
  id: number;
  skillId: string;
  title: string;
  description: string;
  author: string;
  installCount: number;
  version: string;
  category: string;
  origin: OriginKey;
  license: string;
}

function categoryMeta(category: string) {
  return CATEGORY_MAP[category] || { label: category || "其他", Icon: BriefcaseBusiness };
}

export function MarketplacePage({ adoptId }: { adoptId?: string }) {
  const { confirm, dialog } = useConfirmDialog();
  const [items, setItems] = useState<MarketSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [activeOrigin, setActiveOrigin] = useState<OriginKey>("opensource");
  const [installedMarket, setInstalledMarket] = useState<Record<string, { skillId: string; version?: string }>>({});
  const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/trpc/claw.marketList")
      .then((r) => r.json())
      .then((d) => {
        const list = d?.result?.data?.json || d?.result?.data || [];
        setItems(
          list.map((s: any) => ({
            id: s.id,
            skillId: s.skillId,
            title: s.name || s.skillId,
            description: s.description || "暂无说明",
            author: s.author || "官方",
            installCount: s.downloadCount || 0,
            version: s.version || "1.0.0",
            category: s.category || "general",
            origin: s.origin === "squad" ? "squad" : "opensource",
            license: s.license || "MIT",
          })),
        );
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!adoptId) {
      setInstalledMarket({});
      return;
    }
    fetch(`/api/claw/skills/registry?adoptId=${encodeURIComponent(adoptId)}`)
      .then((r) => r.json())
      .then((d) => {
        const rows = Array.isArray(d?.items) ? d.items : [];
        const next: Record<string, { skillId: string; version?: string }> = {};
        for (const skill of rows) {
          if (skill?.source?.kind !== "marketplace") continue;
          const state = String(skill?.state || "");
          if (skill?.enabled === false || state === "disabled" || state === "source_missing") continue;
          const marketId = String(skill?.source?.marketplaceId || "").trim();
          if (!marketId) continue;
          const installedSkillId = String(skill?.id || skill?.source?.skillId || "");
          const installedVersion = String(skill?.source?.version || "");
          next[marketId] = { skillId: installedSkillId, version: installedVersion };
          if (installedSkillId) next[`skill:${installedSkillId}`] = { skillId: installedSkillId, version: installedVersion };
        }
        setInstalledMarket(next);
      })
      .catch(() => setInstalledMarket({}));
  }, [adoptId]);

  const installState = (item: MarketSkill) => {
    const installed = installedMarket[String(item.id)] || installedMarket[`skill:${item.skillId}`];
    const installedVersion = installed?.version || "";
    const canUpdate = !!installed && !!installedVersion && installedVersion !== item.version;
    return { installed, installedVersion, canUpdate };
  };

  const onInstall = async (item: MarketSkill) => {
    if (!adoptId || installing) return;
    setInstalling(item.id);
    try {
      const r = await fetch("/api/trpc/claw.marketInstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { marketId: item.id, adoptId } }),
      });
      const d = await r.json();
      if (d?.error) throw new Error(d.error?.message || "安装失败");
      toast.success(`已安装：${item.title}`);
      const installedSkillId = String(d?.result?.data?.json?.skillId || d?.result?.data?.skillId || item.skillId);
      setInstalledMarket((prev) => ({
        ...prev,
        [String(item.id)]: { skillId: installedSkillId, version: item.version },
        [`skill:${installedSkillId}`]: { skillId: installedSkillId, version: item.version },
      }));
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, installCount: (x.installCount || 0) + 1 } : x)));
    } catch (e: any) {
      toast.error(`安装失败${e?.message ? `：${e.message}` : ""}`);
    } finally {
      setInstalling(null);
    }
  };

  const onUninstall = async (item: MarketSkill) => {
    if (!adoptId || installing) return;
    const installed = installedMarket[String(item.id)];
    if (!installed?.skillId) return;
    const ok = await confirm({
      title: "卸载技能？",
      description: `确认卸载 ${item.title}？广场源不会删除，可重新安装。`,
      confirmText: "卸载",
      variant: "danger",
    });
    if (!ok) return;
    setInstalling(item.id);
    try {
      const r = await fetch("/api/claw/skills/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId, skillId: installed.skillId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.error) throw new Error(d?.error || "卸载失败");
      toast.success(`已卸载：${item.title}`);
      setInstalledMarket((prev) => {
        const next = { ...prev };
        delete next[String(item.id)];
        delete next[`skill:${item.skillId}`];
        return next;
      });
    } catch (e: any) {
      toast.error(`卸载失败${e?.message ? `：${e.message}` : ""}`);
    } finally {
      setInstalling(null);
    }
  };

  const filtered = items.filter((x) => {
    const matchOrigin = x.origin === activeOrigin;
    const matchQ = !q.trim() || `${x.title} ${x.description} ${x.skillId}`.toLowerCase().includes(q.toLowerCase());
    return matchOrigin && matchQ;
  });
  const originCounts = items.reduce<Record<string, number>>((acc, x) => {
    acc[x.origin] = (acc[x.origin] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="skills-market">
      {dialog}
      <div className="skills-market-hero settings-card">
        <div className="skills-market-hero__icon"><Store size={18} /></div>
        <div className="min-w-0">
          <div className="skills-market-hero__title">技能广场</div>
          <div className="skills-market-hero__desc">
            从技能广场安装的技能会进入“我的技能”，并同步到当前员工智能体运行时。
          </div>
        </div>
      </div>

      <div className="skills-market-toolbar">
        <div className="skills-search skills-market-search">
          <Search size={14} className="skills-search-icon" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索技能..." />
        </div>
        <div className="skills-market-categories" aria-label="技能广场来源">
          {(Object.keys(ORIGIN_META) as OriginKey[]).map((origin) => {
            const meta = ORIGIN_META[origin];
            const Icon = meta.Icon;
            const active = activeOrigin === origin;
            const count = originCounts[origin] || 0;
            return (
              <button key={origin} className={`skills-tab ${active ? "active" : ""}`} onClick={() => setActiveOrigin(origin)}>
                <Icon size={13} />
                {meta.label}
                <span className="skills-market-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="settings-card skills-market-empty">
          <Loader2 size={20} className="animate-spin" />
          <div>正在加载技能广场...</div>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="settings-card skills-market-empty">
          <Store size={22} />
          <div>{items.length === 0 ? "技能广场暂无技能" : "没有匹配的技能"}</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="skills-market-grid">
          {filtered.map((item) => {
            const meta = categoryMeta(item.category);
            const originMeta = ORIGIN_META[item.origin] || ORIGIN_META.opensource;
            const Icon = meta.Icon;
            const { installed, canUpdate } = installState(item);
            const installLabel = canUpdate ? "更新" : installed ? "已安装" : "安装";
            return (
              <div
                key={item.id}
                className="skills-market-card settings-card"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedSkill(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedSkill(item);
                  }
                }}
              >
                <div className="skills-market-card__head">
                  <div className="skills-market-card__title-wrap">
                    <div className="skills-market-card__title">
                      <Icon size={15} />
                      <span>{item.title}</span>
                    </div>
                    <div className="skills-market-card__meta">{item.author} · v{item.version}</div>
                  </div>
                  <span className="skills-chip skills-chip--neutral">{originMeta.label}</span>
                </div>

                <div className="skills-market-card__desc">{item.description}</div>

                <div className="skills-market-card__foot">
                  <span className="skills-market-card__installs"><Download size={12} />{item.installCount} 次安装</span>
                  <button
                    className="skills-btn"
                    disabled={!adoptId || installing === item.id || (!!installed && !canUpdate)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onInstall(item);
                    }}
                  >
                    {installing === item.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : installed && !canUpdate ? (
                      <Check size={12} />
                    ) : (
                      <Download size={12} />
                    )}
                    {installing === item.id ? "安装中" : installLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedSkill && (
        <div className="skills-market-detail" role="dialog" aria-modal="true" aria-label={`${selectedSkill.title} 详情`}>
          <button className="skills-market-detail__backdrop" type="button" aria-label="关闭详情" onClick={() => setSelectedSkill(null)} />
          <div className="skills-market-detail__panel settings-card">
            {(() => {
              const meta = categoryMeta(selectedSkill.category);
              const originMeta = ORIGIN_META[selectedSkill.origin] || ORIGIN_META.opensource;
              const Icon = meta.Icon;
              const { installed, installedVersion, canUpdate } = installState(selectedSkill);
              const installLabel = canUpdate ? "更新" : installed ? "已安装" : "安装";
              return (
                <>
                  <div className="skills-market-detail__head">
                    <div className="skills-market-detail__icon"><Icon size={18} /></div>
                    <div className="min-w-0">
                      <div className="skills-market-detail__title">{selectedSkill.title}</div>
                      <div className="skills-market-detail__meta">{selectedSkill.author} · v{selectedSkill.version}</div>
                    </div>
                    <button className="skills-icon-btn" type="button" aria-label="关闭详情" onClick={() => setSelectedSkill(null)}>
                      <X size={15} />
                    </button>
                  </div>

                  <div className="skills-market-detail__chips">
                    <span className="skills-chip skills-chip--neutral">{originMeta.label}</span>
                    <span className="skills-chip skills-chip--neutral">{meta.label}</span>
                    <span className="skills-chip skills-chip--neutral">{selectedSkill.license}</span>
                    {installed ? (
                      <span className="skills-chip skills-chip--ok"><Check size={12} />已安装{installedVersion ? ` v${installedVersion}` : ""}</span>
                    ) : (
                      <span className="skills-chip skills-chip--neutral">未安装</span>
                    )}
                    {canUpdate && <span className="skills-chip skills-chip--warn">可更新</span>}
                  </div>

                  <div className="skills-market-detail__section">
                    <div className="skills-market-detail__label">说明</div>
                    <div className="skills-market-detail__body">{selectedSkill.description || "暂无说明"}</div>
                  </div>

                  <div className="skills-market-detail__facts">
                    <div><span>安装次数</span><strong>{selectedSkill.installCount}</strong></div>
                    <div><span>技能 ID</span><strong>{selectedSkill.skillId}</strong></div>
                    <div><span>审核</span><strong><ShieldCheck size={12} />静态扫描通过</strong></div>
                  </div>

                  <div className="skills-market-detail__actions">
                    <div className="skills-market-detail__action-buttons">
                      <button
                        className="skills-btn"
                        disabled={!adoptId || installing === selectedSkill.id || (!!installed && !canUpdate)}
                        onClick={() => onInstall(selectedSkill)}
                      >
                        {installing === selectedSkill.id ? <Loader2 size={12} className="animate-spin" /> : installed && !canUpdate ? <Check size={12} /> : <Download size={12} />}
                        {installing === selectedSkill.id ? "安装中" : installLabel}
                      </button>
                      {installed && (
                        <button className="skills-btn skills-btn--ghost" disabled={!adoptId || installing === selectedSkill.id} onClick={() => onUninstall(selectedSkill)}>
                          {installing === selectedSkill.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          卸载
                        </button>
                      )}
                    </div>
                    <span className="skills-market-detail__hint">
                      安装后会进入“我的技能”，并同步到当前员工智能体运行时。
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
