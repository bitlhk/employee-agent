import { useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/console/PageContainer";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  EyeOff,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { sessionStatusMeta } from "@/lib/coopStatus";
import { CoopNewForm } from "@/pages/CoopNew";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type PageMode = "list" | "create";
type FilterKey = "all" | "action" | "created" | "participating" | "completed";

type CoopSessionRow = {
  id: string;
  title?: string | null;
  status: string;
  creator_user_id?: number;
  creator_name?: string | null;
  total_members?: number;
  completed_members?: number;
  pending_members?: number;
  i_am_member?: boolean | number;
  i_am_creator?: boolean | number;
  my_request_status?: string | null;
  created_at?: string | Date | null;
  published_at?: string | Date | null;
};

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function countOf(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function createdAtValue(session: CoopSessionRow) {
  const time = session.created_at ? new Date(session.created_at).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getSessionFlags(session: CoopSessionRow) {
  const total = countOf(session.total_members);
  const completed = countOf(session.completed_members);
  const pending = countOf(session.pending_members);
  const isCreator = truthy(session.i_am_creator);
  const isMember = truthy(session.i_am_member);
  const needMyAction = isMember && session.my_request_status === "pending";
  const readyToConsolidate =
    isCreator &&
    session.status === "running" &&
    completed > 0 &&
    completed >= Math.max(0, total - pending);

  return { total, completed, pending, isCreator, isMember, needMyAction, readyToConsolidate };
}

function primaryActionLabel(session: CoopSessionRow) {
  const flags = getSessionFlags(session);
  if (flags.needMyAction) return "处理";
  if (flags.readyToConsolidate) return "汇总";
  return "进入";
}

function roleLabel(session: CoopSessionRow) {
  const flags = getSessionFlags(session);
  if (flags.isCreator && flags.isMember) return "发起人 / 成员";
  if (flags.isCreator) return "发起人";
  if (flags.isMember) return "成员";
  return "旁观";
}

function progressLabel(session: CoopSessionRow) {
  const { total, completed, pending } = getSessionFlags(session);
  if (total <= 0) return "未分配";
  if (pending > 0) return `${completed}/${total} 已提交 · ${pending} 待响应`;
  return `${completed}/${total} 已提交`;
}

function sortSessions(list: CoopSessionRow[]) {
  return [...list].sort((a, b) => {
    const fa = getSessionFlags(a);
    const fb = getSessionFlags(b);
    const score = (flags: ReturnType<typeof getSessionFlags>, session: CoopSessionRow) => {
      if (flags.needMyAction) return 4;
      if (flags.readyToConsolidate) return 3;
      if (session.status === "running" || session.status === "inviting") return 2;
      if (session.status === "consolidating") return 1;
      return 0;
    };
    const delta = score(fb, b) - score(fa, a);
    if (delta !== 0) return delta;
    return createdAtValue(b) - createdAtValue(a);
  });
}

export function CollabPage({ adoptId: _adoptId }: { adoptId: string }) {
  const [, setLocationCoop] = useLocation();
  const [mode, setMode] = useState<PageMode>("list");

  if (mode === "create") {
    return (
      <PageContainer title="协作工作台" icon={<Users size={18} />}>
        <div className="coop-workbench">
          <div className="coop-workbench__create-head">
            <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="text-foreground">
              <ArrowLeft className="w-4 h-4 mr-1" /> 返回协作工作台
            </Button>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">发起多人协作</div>
              <div className="text-xs text-muted-foreground">选择成员、拆分子任务，并在成员提交后统一汇总。</div>
            </div>
          </div>
          <CoopNewForm
            onDone={(sid) => setLocationCoop(`/coop/${sid}`)}
            onCancel={() => setMode("list")}
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="协作工作台" icon={<Users size={18} />}>
      <div className="coop-workbench">
        <div className="page-section-toolbar">
          <div className="page-section-title">
            <h2 className="page-section-title__main">协作工作台</h2>
            <p className="page-section-title__desc">多人任务分发、成员响应和 AI 汇总</p>
          </div>
          <button
            onClick={() => setMode("create")}
            className="page-primary-action"
            title="发起多人协作"
          >
            <Plus size={15} aria-hidden="true" />
            发起协作
          </button>
        </div>

        <CoopSessionsWorkbench onCreate={() => setMode("create")} />
      </div>
    </PageContainer>
  );
}

function CoopSessionsWorkbench({ onCreate }: { onCreate?: () => void }) {
  const [, setLoc] = useLocation();
  const { confirm, dialog } = useConfirmDialog();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const { data: sessions, isLoading, isFetching, refetch } = trpc.coop.listMySessions.useQuery({ limit: 80 }, {
    refetchInterval: 10_000,
  });
  const list = ((sessions as CoopSessionRow[]) || []).map((session) => ({
    ...session,
    id: String(session.id || ""),
  })).filter((session) => session.id);
  const sorted = useMemo(() => sortSessions(list), [list]);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target?.closest?.("[data-coop-menu]") || target?.closest?.("[data-coop-menu-trigger]")) return;
      setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenuId]);

  const softDeleteMut = trpc.coop.softDelete.useMutation({
    onSuccess: () => { toast.success("协作已删除"); setOpenMenuId(null); refetch(); },
    onError: (error) => toast.error(error.message || "删除失败"),
  });
  const toggleHideMut = trpc.coop.toggleHide.useMutation({
    onSuccess: () => { toast.success("已从你的列表隐藏"); setOpenMenuId(null); refetch(); },
    onError: (error) => toast.error(error.message || "操作失败"),
  });

  const stats = useMemo(() => {
    return sorted.reduce(
      (acc, session) => {
        const flags = getSessionFlags(session);
        if (flags.needMyAction) acc.action += 1;
        if (flags.readyToConsolidate) acc.ready += 1;
        if (session.status === "running" || session.status === "inviting" || session.status === "consolidating") acc.active += 1;
        if (session.status === "published" || session.status === "closed") acc.done += 1;
        return acc;
      },
      { action: 0, ready: 0, active: 0, done: 0 }
    );
  }, [sorted]);

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "全部", count: sorted.length },
    { key: "action", label: "待我处理", count: stats.action },
    { key: "created", label: "我发起的", count: sorted.filter((session) => getSessionFlags(session).isCreator).length },
    { key: "participating", label: "我参与的", count: sorted.filter((session) => getSessionFlags(session).isMember && !getSessionFlags(session).isCreator).length },
    { key: "completed", label: "已完成", count: stats.done },
  ];

  const filtered = sorted.filter((session) => {
    const flags = getSessionFlags(session);
    if (activeFilter === "action") return flags.needMyAction;
    if (activeFilter === "created") return flags.isCreator;
    if (activeFilter === "participating") return flags.isMember && !flags.isCreator;
    if (activeFilter === "completed") return session.status === "published" || session.status === "closed";
    return true;
  });

  const handleDelete = async (session: CoopSessionRow) => {
    const ok = await confirm({
      title: "删除协作？",
      description: `确认删除协作「${session.title || session.id}」？\n\n所有成员的视图都会消失（软删除，30 天内可联系管理员恢复）。`,
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    softDeleteMut.mutate({ sessionId: session.id });
  };
  const handleHide = async (session: CoopSessionRow) => {
    const ok = await confirm({
      title: "隐藏协作？",
      description: `从你的列表隐藏「${session.title || session.id}」？\n\n仅影响你的视图，发起人和其他成员不受影响。`,
      confirmText: "隐藏",
    });
    if (!ok) return;
    toggleHideMut.mutate({ sessionId: session.id, hide: true });
  };

  if (isLoading) {
    return (
      <>
        {dialog}
        <div className="coop-workbench__loading">加载协作任务...</div>
      </>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="coop-empty-state">
        {dialog}
        <div className="coop-empty-state__icon"><UsersRound size={24} /></div>
        <div className="coop-empty-state__title">还没有协作任务</div>
        <div className="coop-empty-state__desc">你可以发起一个多人协作，让成员分别处理子任务后统一汇总。</div>
        <button className="page-primary-action" onClick={() => onCreate?.()}>
          <Plus size={15} /> 发起协作
        </button>
      </div>
    );
  }

  return (
    <>
      {dialog}
      <div className="coop-summary-grid">
        <SummaryItem icon={<Clock3 size={16} />} label="待我处理" value={stats.action} tone={stats.action > 0 ? "warning" : "neutral"} />
        <SummaryItem icon={<Activity size={16} />} label="进行中" value={stats.active} tone="info" />
        <SummaryItem icon={<CheckCircle2 size={16} />} label="可汇总" value={stats.ready} tone={stats.ready > 0 ? "accent" : "neutral"} />
        <SummaryItem icon={<UsersRound size={16} />} label="总协作" value={sorted.length} tone="neutral" />
      </div>

      <div className="coop-workbench__list-head">
        <div className="coop-filter-tabs" role="tablist" aria-label="协作任务筛选">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="coop-filter-tab"
              data-active={activeFilter === filter.key}
              onClick={() => setActiveFilter(filter.key)}
            >
              {filter.label}
              <span>{filter.count}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="coop-empty-state coop-empty-state--compact">
          <div className="coop-empty-state__title">当前筛选下没有任务</div>
          <div className="coop-empty-state__desc">切换到“全部”可以查看所有协作任务。</div>
        </div>
      ) : (
        <div className="coop-task-table" role="table" aria-label="协作任务列表">
          <div className="coop-task-table__head" role="row">
            <div>任务</div>
            <div>状态</div>
            <div>角色</div>
            <div>进度</div>
            <div>创建时间</div>
            <div>操作</div>
          </div>
          <div className="coop-task-table__body">
            {filtered.map((session) => {
              const meta = sessionStatusMeta(session.status);
              const flags = getSessionFlags(session);
              const progress = flags.total > 0 ? Math.min(100, Math.round((flags.completed / flags.total) * 100)) : 0;
              return (
                <div
                  key={session.id}
                  className="coop-task-row"
                  data-action={flags.needMyAction || flags.readyToConsolidate ? "true" : "false"}
                  onClick={() => setLoc(`/coop/${session.id}`)}
                  role="row"
                >
                  <div className="coop-task-row__title-cell">
                    <div className="coop-task-row__title-line">
                      {(flags.needMyAction || flags.readyToConsolidate) ? <span className="coop-task-row__dot" /> : null}
                      <span className="coop-task-row__title">{session.title || "未命名协作"}</span>
                    </div>
                    <div className="coop-task-row__meta">
                      发起人：{session.creator_name || `#${session.creator_user_id || "—"}`}
                    </div>
                  </div>
                  <div>
                    <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
                  </div>
                  <div className="coop-task-row__role">
                    <UserRound size={13} />
                    {roleLabel(session)}
                  </div>
                  <div className="coop-task-row__progress">
                    <div className="coop-task-row__progress-label">{progressLabel(session)}</div>
                    <div className="coop-progress-bar" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="coop-task-row__date">{formatDate(session.created_at)}</div>
                  <div className="coop-task-row__actions" onClick={(event) => event.stopPropagation()}>
                    <Button size="sm" variant={flags.needMyAction || flags.readyToConsolidate ? "default" : "outline"} onClick={() => setLoc(`/coop/${session.id}`)}>
                      {primaryActionLabel(session)}
                    </Button>
                    <button
                      type="button"
                      data-coop-menu-trigger
                      className="coop-task-row__more"
                      aria-label="更多操作"
                      onClick={() => setOpenMenuId(openMenuId === session.id ? null : session.id)}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {openMenuId === session.id ? (
                      <div className="coop-row-menu" data-coop-menu>
                        {flags.isCreator ? (
                          <button type="button" className="coop-row-menu__item coop-row-menu__item--danger" onClick={() => handleDelete(session)} disabled={softDeleteMut.isPending}>
                            <Trash2 size={14} />
                            删除协作
                          </button>
                        ) : (
                          <button type="button" className="coop-row-menu__item" onClick={() => handleHide(session)} disabled={toggleHideMut.isPending}>
                            <EyeOff size={14} />
                            从我的列表隐藏
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function SummaryItem({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "warning" | "info" | "accent" | "neutral" }) {
  return (
    <div className="coop-summary-item" data-tone={tone}>
      <div className="coop-summary-item__icon">{icon}</div>
      <div>
        <div className="coop-summary-item__value">{value}</div>
        <div className="coop-summary-item__label">{label}</div>
      </div>
    </div>
  );
}
