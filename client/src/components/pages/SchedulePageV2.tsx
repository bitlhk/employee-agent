import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  MessageCircle,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { PageContainer } from "@/components/console/PageContainer";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type ChannelId = "wechat" | "feishu" | "wecom";

type CronJobV2 = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  prompt?: string;
  schedule: {
    kind: "interval" | "once" | "cron";
    intervalMinutes?: number;
    runAt?: string;
    cronExpr?: string;
    display?: string;
  };
  state?: {
    status?: "scheduled" | "running" | "completed" | "paused" | "failed";
    nextRunAt?: string;
    lastRunAt?: string;
    lastStatus?: "ok" | "error" | "skipped" | "timeout" | "canceled";
    lastDurationMs?: number;
  };
  delivery?: {
    targets?: Array<{
      channelId: ChannelId;
      channelLabel?: string;
      targetLabel?: string;
    }>;
  };
};

type CronRunV2 = {
  id?: string;
  jobId: string;
  jobName?: string;
  startedAt?: string;
  status: "running" | "ok" | "error" | "skipped" | "timeout" | "canceled";
  output?: string;
  summary?: string;
  errorMessage?: string;
  error?: string;
  durationMs?: number;
};

type PreviewRun = { runAt: string; wakeAt?: string };

type CreateScheduleKind = "daily" | "interval" | "once" | "cron";

type CreateForm = {
  name: string;
  prompt: string;
  scheduleKind: CreateScheduleKind;
  dailyTime: string;
  intervalMinutes: string;
  runAt: string;
  cronExpr: string;
  channelId: Exclude<ChannelId, "wecom">;
};

const T = {
  pageTitle: "\u5b9a\u65f6\u4efb\u52a1",
  kicker: "\u4efb\u52a1\u4e2d\u5fc3",
  subtitle: "\u6309\u4efb\u52a1\u884c\u67e5\u770b\u9891\u7387\u3001\u6295\u9012\u6e20\u9053\u3001\u4e0b\u6b21\u6267\u884c\u548c\u6700\u8fd1\u72b6\u6001\u3002",
  refresh: "\u5237\u65b0",
  refreshing: "\u5237\u65b0\u4e2d",
  createTask: "\u65b0\u5efa\u4efb\u52a1",
  collapseCreate: "\u6536\u8d77\u65b0\u5efa",
  missingAdoptId: "\u7f3a\u5c11 adoptId\uff0c\u65e0\u6cd5\u52a0\u8f7d\u5b9a\u65f6\u4efb\u52a1\u3002",
  retry: "\u91cd\u8bd5",
  task: "\u4efb\u52a1",
  schedule: "\u8ba1\u5212",
  delivery: "\u63a8\u9001\u5230",
  nextRun: "\u4e0b\u6b21\u6267\u884c",
  status: "\u6700\u8fd1\u72b6\u6001",
  actions: "\u64cd\u4f5c",
  emptyTitle: "\u6682\u65e0\u5b9a\u65f6\u4efb\u52a1",
  emptyHint: "\u53ef\u4ee5\u5728\u4e3b\u5bf9\u8bdd\u6216\u5fae\u4fe1\u91cc\u8bf4\u51fa\u5b9a\u65f6\u9700\u6c42\uff0c\u4e5f\u53ef\u4ee5\u5728\u8fd9\u91cc\u624b\u52a8\u521b\u5efa\u3002",
  taskName: "\u4efb\u52a1\u540d\u79f0",
  taskNamePlaceholder: "\u6bcf\u65e5\u5929\u6c14\u63d0\u9192",
  promptLabel: "\u8981\u505a\u7684\u4e8b",
  promptPlaceholder: "\u67e5\u4eca\u5929\u5929\u6c14\uff0c\u7b80\u8981\u603b\u7ed3\u540e\u53d1\u7ed9\u6211",
  scheduleKind: "\u6267\u884c\u65b9\u5f0f",
  daily: "\u6bcf\u5929\u5b9a\u65f6",
  interval: "\u95f4\u9694\u6267\u884c",
  cronExpr: "Cron",
  deliveryChannel: "\u6295\u9012\u9891\u9053",
  saveTask: "\u521b\u5efa\u4efb\u52a1",
  saving: "\u521b\u5efa\u4e2d",
  createSuccess: "\u5b9a\u65f6\u4efb\u52a1\u5df2\u521b\u5efa",
  createFailed: "\u521b\u5efa\u5931\u8d25",
  requiredHint: "\u8bf7\u586b\u5199\u4efb\u52a1\u540d\u79f0\u548c\u8981\u505a\u7684\u4e8b",
  every: "\u6bcf",
  minute: "\u5206\u949f",
  once: "\u4e00\u6b21\u6027",
  ok: "\u6210\u529f",
  error: "\u5931\u8d25",
  timeout: "\u8d85\u65f6",
  canceled: "\u5df2\u53d6\u6d88",
  skipped: "\u5df2\u8df3\u8fc7",
  neverRun: "\u672a\u8fd0\u884c",
  loadFailed: "\u52a0\u8f7d\u5931\u8d25",
  jobLoadFailed: "\u4efb\u52a1\u52a0\u8f7d\u5931\u8d25",
  runsLoadFailed: "\u8fd0\u884c\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25",
  run: "\u8fd0\u884c",
  runNow: "\u7acb\u5373\u8fd0\u884c",
  runNowFailed: "\u7acb\u5373\u8fd0\u884c\u5931\u8d25",
  started: "\u5df2\u53d1\u8d77\uff0c\u7ed3\u679c\u5c06\u63a8\u9001\u5230",
  preview: "\u9884\u89c8",
  previewFuture: "\u9884\u89c8\u672a\u6765\u6267\u884c",
  previewFailed: "\u9884\u89c8\u5931\u8d25",
  futureRuns: "\u672a\u6765 5 \u6b21\u6267\u884c",
  computing: "\u8ba1\u7b97\u4e2d...",
  noPreview: "\u6ca1\u6709\u53ef\u9884\u89c8\u7684\u672a\u6765\u6267\u884c\u65f6\u95f4\u3002",
  wake: "\u9884\u70ed",
  enable: "\u542f\u7528",
  disable: "\u505c\u7528",
  enableFailed: "\u542f\u505c\u5931\u8d25",
  enabled: "\u4efb\u52a1\u5df2\u542f\u7528",
  disabled: "\u4efb\u52a1\u5df2\u505c\u7528",
  delete: "\u5220\u9664",
  deleteFailed: "\u5220\u9664\u5931\u8d25",
  deleted: "\u4efb\u52a1\u5df2\u5220\u9664",
  deleteConfirmPrefix: "\u5220\u9664\u300c",
  deleteConfirmSuffix: "\u300d\uff1f\u5220\u9664\u540e\u4efb\u52a1\u548c\u6295\u9012\u914d\u7f6e\u90fd\u4f1a\u6e05\u7406\u3002",
};

const CHANNEL_LABEL: Record<ChannelId, string> = {
  wechat: "\u5fae\u4fe1",
  feishu: "\u98de\u4e66",
  wecom: "\u4f01\u4e1a\u5fae\u4fe1",
};

const EMPTY_CREATE_FORM: CreateForm = {
  name: "",
  prompt: "",
  scheduleKind: "daily",
  dailyTime: "09:00",
  intervalMinutes: "60",
  runAt: "",
  cronExpr: "0 9 * * *",
  channelId: "wechat",
};

function normalizeChannelId(channelId?: string): ChannelId {
  if (channelId === "feishu" || channelId === "wecom") return channelId;
  return "wechat";
}

function channelLabel(channelId?: string) {
  return CHANNEL_LABEL[normalizeChannelId(channelId)];
}

function channelIcon(channelId?: string) {
  const props = { size: 15, strokeWidth: 2 };
  const id = normalizeChannelId(channelId);
  if (id === "feishu") return <Zap {...props} />;
  if (id === "wecom") return <Bell {...props} />;
  return <MessageCircle {...props} />;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scheduleText(job: CronJobV2) {
  if (job.schedule.kind === "interval") return `${T.every} ${job.schedule.intervalMinutes || "?"} ${T.minute}`;
  if (job.schedule.kind === "once") return `${T.once} ${formatDate(job.schedule.runAt)}`;
  return job.schedule.display || job.schedule.cronExpr || "cron";
}

function cronExprFromDailyTime(value: string) {
  const [hourRaw, minuteRaw] = String(value || "09:00").split(":");
  const hour = Math.max(0, Math.min(23, Number(hourRaw || 9)));
  const minute = Math.max(0, Math.min(59, Number(minuteRaw || 0)));
  return `${minute} ${hour} * * *`;
}

function buildCreateJob(form: CreateForm) {
  const name = form.name.trim();
  const prompt = form.prompt.trim();
  const channelLabelValue = CHANNEL_LABEL[form.channelId];
  let schedule: CronJobV2["schedule"];
  if (form.scheduleKind === "daily") {
    schedule = {
      kind: "cron",
      cronExpr: cronExprFromDailyTime(form.dailyTime),
      display: `${T.every}\u5929 ${form.dailyTime || "09:00"}`,
    };
  } else if (form.scheduleKind === "interval") {
    const intervalMinutes = Math.max(30, Number(form.intervalMinutes || 60));
    schedule = { kind: "interval", intervalMinutes, display: `${T.every} ${intervalMinutes} ${T.minute}` };
  } else if (form.scheduleKind === "once") {
    const runAt = form.runAt ? new Date(form.runAt).toISOString() : "";
    schedule = { kind: "once", runAt, display: runAt };
  } else {
    schedule = { kind: "cron", cronExpr: form.cronExpr.trim() || "0 9 * * *", display: form.cronExpr.trim() || "0 9 * * *" };
  }
  return {
    name,
    prompt,
    enabled: true,
    schedule,
    delivery: {
      targets: [{
        channelId: form.channelId,
        channelLabel: channelLabelValue,
        targetLabel: channelLabelValue,
        format: "text",
      }],
    },
  };
}

function statusMeta(status?: string) {
  if (status === "ok") return { label: T.ok, tone: "ok" };
  if (status === "error") return { label: T.error, tone: "danger" };
  if (status === "timeout") return { label: T.timeout, tone: "warn" };
  if (status === "canceled") return { label: T.canceled, tone: "muted" };
  if (status === "skipped") return { label: T.skipped, tone: "muted" };
  return { label: T.neverRun, tone: "muted" };
}

function StatusPill({ status }: { status?: string }) {
  const meta = statusMeta(status);
  return <span className={`schedule-v2-pill schedule-v2-pill--${meta.tone}`}>{meta.label}</span>;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="schedule-v2-row schedule-v2-row--skeleton" key={index}>
          <div className="schedule-v2-skeleton schedule-v2-skeleton--title" />
          <div className="schedule-v2-skeleton schedule-v2-skeleton--meta" />
          <div className="schedule-v2-skeleton schedule-v2-skeleton--actions" />
        </div>
      ))}
    </>
  );
}

export function SchedulePageV2({ adoptId }: { adoptId?: string }) {
  const aid = adoptId || "";
  const { confirm, dialog } = useConfirmDialog();
  const [jobs, setJobs] = useState<CronJobV2[]>([]);
  const [runs, setRuns] = useState<CronRunV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewRun[]>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM);

  const latestRunByJob = useMemo(() => {
    const map = new Map<string, CronRunV2>();
    for (const run of runs) {
      if (!map.has(run.jobId)) map.set(run.jobId, run);
    }
    return map;
  }, [runs]);

  async function load() {
    if (!aid) return;
    setLoading(true);
    setError("");
    try {
      const [jobResp, runResp] = await Promise.all([
        fetch(`/api/claw/cron/list?adoptId=${encodeURIComponent(aid)}&limit=100`, { credentials: "include" }),
        fetch(`/api/claw/cron/runs?adoptId=${encodeURIComponent(aid)}&limit=100`, { credentials: "include" }),
      ]);
      if (!jobResp.ok) throw new Error(`${T.jobLoadFailed} (${jobResp.status})`);
      if (!runResp.ok) throw new Error(`${T.runsLoadFailed} (${runResp.status})`);
      const jobJson = await jobResp.json();
      const runJson = await runResp.json();
      setJobs(Array.isArray(jobJson?.jobs) ? jobJson.jobs : []);
      setRuns(Array.isArray(runJson?.runs) ? runJson.runs : []);
    } catch (err: any) {
      setError(err?.message || T.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [aid]);

  async function runNow(job: CronJobV2) {
    if (!aid || runningJobId) return;
    setRunningJobId(job.id);
    const target = job.delivery?.targets?.[0];
    try {
      const resp = await fetch("/api/claw/cron/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: aid, id: job.id }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.error || `${T.runNowFailed} (${resp.status})`);
      }
      toast.success(`${T.started} ${target?.channelLabel || channelLabel(target?.channelId)}`);
      setTimeout(() => setRunningJobId(null), 1000);
      setTimeout(load, 1800);
    } catch (err: any) {
      setRunningJobId(null);
      toast.error(err?.message || T.runNowFailed);
    }
  }

  async function toggleJob(job: CronJobV2) {
    if (!aid) return;
    const previous = jobs;
    setJobs((items) => items.map((item) => (item.id === job.id ? { ...item, enabled: !job.enabled } : item)));
    try {
      const resp = await fetch("/api/claw/cron/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: aid, id: job.id, patch: { enabled: !job.enabled } }),
      });
      if (!resp.ok) throw new Error(T.enableFailed);
      toast.success(job.enabled ? T.disabled : T.enabled);
      setTimeout(load, 500);
    } catch (err: any) {
      setJobs(previous);
      toast.error(err?.message || T.enableFailed);
    }
  }

  async function removeJob(job: CronJobV2) {
    if (!aid) return;
    const ok = await confirm({
      title: "删除定时任务？",
      description: `${T.deleteConfirmPrefix}${job.name}${T.deleteConfirmSuffix}`,
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const resp = await fetch("/api/claw/cron/remove", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: aid, id: job.id }),
      });
      if (!resp.ok) throw new Error(T.deleteFailed);
      toast.success(T.deleted);
      load();
    } catch (err: any) {
      toast.error(err?.message || T.deleteFailed);
    }
  }

  async function togglePreview(job: CronJobV2) {
    if (previewJobId === job.id) {
      setPreviewJobId(null);
      return;
    }
    setPreviewJobId(job.id);
    if (previews[job.id]) return;
    setPreviewLoading(job.id);
    try {
      const resp = await fetch("/api/claw/cron/preview-runs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: aid, schedule: job.schedule, count: 5 }),
      });
      if (!resp.ok) throw new Error(T.previewFailed);
      const data = await resp.json();
      setPreviews((prev) => ({ ...prev, [job.id]: Array.isArray(data?.runs) ? data.runs : [] }));
    } catch (err: any) {
      toast.error(err?.message || T.previewFailed);
    } finally {
      setPreviewLoading(null);
    }
  }

  async function createJob() {
    if (!aid || createBusy) return;
    const job = buildCreateJob(createForm);
    if (!job.name || !job.prompt) {
      toast.error(T.requiredHint);
      return;
    }
    if (job.schedule.kind === "once" && !job.schedule.runAt) {
      toast.error("\u8bf7\u9009\u62e9\u5355\u6b21\u6267\u884c\u65f6\u95f4");
      return;
    }
    setCreateBusy(true);
    try {
      const resp = await fetch("/api/claw/cron/add", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId: aid, job }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `${T.createFailed} (${resp.status})`);
      toast.success(T.createSuccess);
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || T.createFailed);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <PageContainer title={T.pageTitle}>
      {dialog}
      <div className="schedule-v2">
        <div className="schedule-v2-toolbar">
          <div>
            <div className="schedule-v2-kicker">{T.kicker}</div>
            <div className="schedule-v2-subtitle">{T.subtitle}</div>
          </div>
          <div className="schedule-v2-toolbar-actions">
            <button className="schedule-v2-btn schedule-v2-btn--primary" onClick={() => setCreateOpen((v) => !v)} disabled={!aid}>
              <Plus size={14} /> {createOpen ? T.collapseCreate : T.createTask}
            </button>
            <button className="schedule-v2-btn schedule-v2-btn--ghost" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {T.refresh}
            </button>
          </div>
        </div>

        {!aid && <div className="schedule-v2-empty">{T.missingAdoptId}</div>}

        {error && (
          <div className="schedule-v2-error">
            <span>{error}</span>
            <button className="schedule-v2-btn schedule-v2-btn--ghost" onClick={load}>{T.retry}</button>
          </div>
        )}

        {createOpen && (
          <div className="schedule-v2-create">
            <div className="schedule-v2-form-grid">
              <label className="schedule-v2-field">
                <span>{T.taskName}</span>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={T.taskNamePlaceholder}
                />
              </label>
              <label className="schedule-v2-field schedule-v2-field--wide">
                <span>{T.promptLabel}</span>
                <input
                  value={createForm.prompt}
                  onChange={(e) => setCreateForm((f) => ({ ...f, prompt: e.target.value }))}
                  placeholder={T.promptPlaceholder}
                />
              </label>
              <label className="schedule-v2-field">
                <span>{T.scheduleKind}</span>
                <select
                  value={createForm.scheduleKind}
                  onChange={(e) => setCreateForm((f) => ({ ...f, scheduleKind: e.target.value as CreateScheduleKind }))}
                >
                  <option value="daily">{T.daily}</option>
                  <option value="interval">{T.interval}</option>
                  <option value="once">{T.once}</option>
                  <option value="cron">{T.cronExpr}</option>
                </select>
              </label>
              {createForm.scheduleKind === "daily" ? (
                <label className="schedule-v2-field">
                  <span>{T.nextRun}</span>
                  <input
                    type="time"
                    value={createForm.dailyTime}
                    onChange={(e) => setCreateForm((f) => ({ ...f, dailyTime: e.target.value }))}
                  />
                </label>
              ) : createForm.scheduleKind === "interval" ? (
                <label className="schedule-v2-field">
                  <span>{T.interval}</span>
                  <input
                    type="number"
                    min={30}
                    step={30}
                    value={createForm.intervalMinutes}
                    onChange={(e) => setCreateForm((f) => ({ ...f, intervalMinutes: e.target.value }))}
                  />
                </label>
              ) : createForm.scheduleKind === "once" ? (
                <label className="schedule-v2-field">
                  <span>{T.once}</span>
                  <input
                    type="datetime-local"
                    value={createForm.runAt}
                    onChange={(e) => setCreateForm((f) => ({ ...f, runAt: e.target.value }))}
                  />
                </label>
              ) : (
                <label className="schedule-v2-field">
                  <span>{T.cronExpr}</span>
                  <input
                    value={createForm.cronExpr}
                    onChange={(e) => setCreateForm((f) => ({ ...f, cronExpr: e.target.value }))}
                    placeholder="0 9 * * *"
                  />
                </label>
              )}
              <label className="schedule-v2-field">
                <span>{T.deliveryChannel}</span>
                <select
                  value={createForm.channelId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, channelId: e.target.value as CreateForm["channelId"] }))}
                >
                  <option value="wechat">{CHANNEL_LABEL.wechat}</option>
                  <option value="feishu">{CHANNEL_LABEL.feishu}</option>
                  <option value="wecom" disabled>{CHANNEL_LABEL.wecom}\uff08\u5373\u5c06\u4e0a\u7ebf\uff09</option>
                </select>
              </label>
              <button className="schedule-v2-btn schedule-v2-btn--primary schedule-v2-create-submit" onClick={createJob} disabled={createBusy}>
                <Plus size={14} /> {createBusy ? T.saving : T.saveTask}
              </button>
            </div>
          </div>
        )}

        <div className="schedule-v2-card">
          <div className="schedule-v2-header">
            <span>{T.task}</span>
            <span>{T.schedule}</span>
            <span>{T.delivery}</span>
            <span>{T.nextRun}</span>
            <span>{T.status}</span>
            <span>{T.actions}</span>
          </div>

          {loading ? <SkeletonRows /> : jobs.length === 0 ? (
            <div className="schedule-v2-empty">
              <CalendarClock size={26} />
              <div>{T.emptyTitle}</div>
              <div className="schedule-v2-muted">
                {T.emptyHint}
              </div>
              <button className="schedule-v2-btn schedule-v2-btn--primary" onClick={() => setCreateOpen(true)} disabled={!aid}>
                <Plus size={14} /> {T.createTask}
              </button>
            </div>
          ) : jobs.map((job) => {
            const target = job.delivery?.targets?.[0];
            const latest = latestRunByJob.get(job.id);
            const activePreview = previewJobId === job.id;
            return (
              <div className="schedule-v2-row-group" key={job.id}>
                <div className="schedule-v2-row">
                  <div className="schedule-v2-job">
                    <div className="schedule-v2-job-title">
                      <span className={job.enabled ? "schedule-v2-dot schedule-v2-dot--on" : "schedule-v2-dot"} />
                      <span>{job.name}</span>
                    </div>
                    {job.description && <div className="schedule-v2-muted">{job.description}</div>}
                  </div>

                  <div className="schedule-v2-cell">
                    <Clock3 size={14} />
                    <span>{scheduleText(job)}</span>
                  </div>

                  <div className="schedule-v2-cell">
                    <span className="schedule-v2-channel-icon">{channelIcon(target?.channelId)}</span>
                    <span>{target?.channelLabel || channelLabel(target?.channelId)}</span>
                    {target?.targetLabel && <span className="schedule-v2-muted">· {target.targetLabel}</span>}
                  </div>

                  <div className="schedule-v2-cell">{formatDate(job.state?.nextRunAt)}</div>

                  <div className="schedule-v2-cell">
                    <StatusPill status={latest?.status || job.state?.lastStatus} />
                  </div>

                  <div className="schedule-v2-actions">
                    <button className="schedule-v2-icon-btn" onClick={() => runNow(job)} disabled={runningJobId === job.id} title={T.runNow}>
                      <Play size={14} /> {T.run}
                    </button>
                    <button className="schedule-v2-icon-btn" onClick={() => togglePreview(job)} title={T.previewFuture}>
                      {activePreview ? <ChevronDown size={14} /> : <Eye size={14} />} {T.preview}
                    </button>
                    <button className="schedule-v2-icon-btn" onClick={() => toggleJob(job)} title={job.enabled ? T.disable : T.enable}>
                      <PauseCircle size={14} /> {job.enabled ? T.disable : T.enable}
                    </button>
                    <button className="schedule-v2-icon-btn schedule-v2-icon-btn--danger" onClick={() => removeJob(job)} title={T.delete}>
                      <Trash2 size={14} /> {T.delete}
                    </button>
                  </div>
                </div>

                {activePreview && (
                  <div className="schedule-v2-preview">
                    <div className="schedule-v2-preview-title">
                      <ChevronRight size={14} /> {T.futureRuns}
                    </div>
                    {previewLoading === job.id ? (
                      <div className="schedule-v2-muted">{T.computing}</div>
                    ) : (previews[job.id] || []).length === 0 ? (
                      <div className="schedule-v2-muted">{T.noPreview}</div>
                    ) : (
                      <div className="schedule-v2-preview-list">
                        {(previews[job.id] || []).map((run, index) => (
                          <div className="schedule-v2-preview-item" key={`${run.runAt}-${index}`}>
                            <span>{index + 1}. {formatDate(run.runAt)}</span>
                            {run.wakeAt && <span className="schedule-v2-muted">{T.wake} {formatDate(run.wakeAt)}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
