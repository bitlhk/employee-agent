import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Bot, CheckCircle2, Code2, FileText, Loader2, Play, ShieldCheck, WalletCards, XCircle } from "lucide-react";
import { toast } from "sonner";

type BusinessAgent = {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  remote?: boolean;
};

type AgentRunEnvelope = {
  id: string;
  agentDefinitionId: string;
  status: "success" | "failed";
  summary?: string;
  output?: string;
  artifacts?: Array<{ id?: string; name?: string; type?: string; downloadUrl?: string; previewUrl?: string }>;
  error?: { code?: string; detail?: string };
  producedAt?: string;
};

type ClusterRun = {
  id: string;
  input: string;
  selectedAgentIdsJson: string[];
  status: "completed" | "partial_success" | "failed" | "timeout" | "cancelled" | "running";
  resultsJson: AgentRunEnvelope[];
  startedAt?: string;
  completedAt?: string;
  errorSummary?: string;
};

const MVP_AGENT_IDS = ["task-my-wealth", "task-ppt", "task-code", "task-stock"] as const;
const MAX_SELECTED = 3;

const FALLBACK_AGENTS: Record<string, BusinessAgent> = {
  "task-my-wealth": {
    id: "task-my-wealth",
    name: "个人财富解释助手",
    description: "财富管理、资产配置和材料解读的教育型助手，不提供个性化买卖建议。",
    remote: true,
  },
  "task-ppt": {
    id: "task-ppt",
    name: "PPT 汇报助手",
    description: "面向企业汇报材料的结构规划、内容生成和演示文稿产出助手。",
    remote: true,
  },
  "task-code": {
    id: "task-code",
    name: "代码开发助手",
    description: "用于代码开发、调试、重构和工程化分析的 Claude Code 工具型助手。",
    remote: true,
  },
  "task-stock": {
    id: "task-stock",
    name: "股票分析助手",
    description: "本机独立服务，提供行情、技术指标、资金流和综合研判能力。",
    remote: false,
  },
};

const AGENT_ICONS: Record<string, typeof WalletCards> = {
  "task-my-wealth": WalletCards,
  "task-ppt": FileText,
  "task-code": Code2,
  "task-stock": BarChart3,
};

const QUICK_PROMPTS = [
  "请分别说明你会如何帮助完成一份金融汇报，不要生成文件。",
  "请用三句话说明你能完成什么任务，不要生成文件。",
  "请分别从财富解释、股票分析和汇报制作角度，给我一份银行客户资产配置沟通材料的工作思路。",
];

function statusLabel(status: string) {
  if (status === "completed") return "全部完成";
  if (status === "partial_success") return "部分完成";
  if (status === "failed") return "失败";
  if (status === "timeout") return "超时";
  if (status === "running") return "运行中";
  return status;
}

function resultLabel(status: string) {
  return status === "success" ? "成功" : "失败";
}

function elapsedMs(run?: ClusterRun | null) {
  if (!run?.startedAt || !run?.completedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function formatElapsed(ms: number | null) {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentClusterLabPage() {
  const [agents, setAgents] = useState<Record<string, BusinessAgent>>(FALLBACK_AGENTS);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [selected, setSelected] = useState<string[]>(["task-my-wealth", "task-ppt"]);
  const [prompt, setPrompt] = useState(QUICK_PROMPTS[0]);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<ClusterRun | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/claw/business-agents", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        const rows = Array.isArray(d?.agents) ? d.agents : [];
        const next = { ...FALLBACK_AGENTS };
        for (const row of rows) {
          if (!MVP_AGENT_IDS.includes(row?.id)) continue;
          next[row.id] = {
            ...next[row.id],
            id: row.id,
            name: row.name || next[row.id]?.name,
            description: row.description || next[row.id]?.description,
            kind: row.kind,
            remote: row.remote,
          };
        }
        setAgents(next);
      })
      .catch(() => {
        if (!cancelled) toast.warning("智能体目录加载失败，已使用本地 MVP 清单");
      })
      .finally(() => {
        if (!cancelled) setLoadingAgents(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const canRun = selected.length > 0 && prompt.trim().length > 0 && !running;

  const toggleAgent = (agentId: string) => {
    if (running) return;
    setSelected((prev) => {
      if (prev.includes(agentId)) return prev.filter((id) => id !== agentId);
      if (prev.length >= MAX_SELECTED) {
        toast.info(`Lab 模式单次最多选择 ${MAX_SELECTED} 个智能体`);
        return prev;
      }
      return [...prev, agentId];
    });
  };

  const runCluster = async () => {
    if (!canRun) return;
    setRunning(true);
    setLastError(null);
    setRun(null);
    const started = performance.now();
    try {
      const r = await fetch("/api/admin/agent-cluster-lab/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentDefinitionIds: selected,
          prompt: prompt.trim(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = r.status === 404
          ? "Lab 尚未开启，或当前账号不在灰度名单中。"
          : d?.error || d?.message || `HTTP ${r.status}`;
        throw new Error(message);
      }
      const nextRun = d?.run as ClusterRun | undefined;
      if (!nextRun?.id) throw new Error("Lab 返回缺少 run 信息");
      setRun(nextRun);
      const label = statusLabel(nextRun.status);
      toast.success(`集群运行完成：${label} · ${formatElapsed(Math.round(performance.now() - started))}`);
    } catch (e: any) {
      const message = e?.message || "智能体集群运行失败";
      setLastError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const runMs = elapsedMs(run);

  return (
    <div className="h-full min-h-0 overflow-y-auto stealth-scrollbar" style={{ background: "var(--oc-bg)" }}>
      <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-5">
        <section className="settings-card overflow-hidden" style={{ borderColor: "color-mix(in oklab, var(--oc-accent) 24%, var(--oc-border))" }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium" style={{ background: "color-mix(in oklab, var(--oc-accent) 10%, transparent)", color: "var(--oc-accent)" }}>
                <ShieldCheck size={14} />
                Admin Lab · 显式选择 · 不进入主会话记忆
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--oc-text-primary)" }}>智能体工作台</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--oc-text-secondary)" }}>
                  这里验证未来的智能体集群形态：用户明确选择多个智能体，同一个任务并行分发，结果分卡片展示。当前只开放 MVP 四个智能体，并保留 lab kill switch。
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)" }}>
                <div className="text-lg font-semibold" style={{ color: "var(--oc-text-primary)" }}>{MVP_AGENT_IDS.length}</div>
                <div className="text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>MVP 智能体</div>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)" }}>
                <div className="text-lg font-semibold" style={{ color: "var(--oc-text-primary)" }}>{MAX_SELECTED}</div>
                <div className="text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>单次上限</div>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)" }}>
                <div className="text-lg font-semibold" style={{ color: "var(--oc-text-primary)" }}>{run ? statusLabel(run.status) : "待运行"}</div>
                <div className="text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>最近结果</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="settings-card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>选择智能体</h2>
                  <p className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>最多选择 {MAX_SELECTED} 个，当前 {selected.length} 个</p>
                </div>
                {loadingAgents && <Loader2 size={16} className="animate-spin" style={{ color: "var(--oc-text-tertiary)" }} />}
              </div>
              <div className="space-y-2">
                {MVP_AGENT_IDS.map((agentId) => {
                  const agent = agents[agentId] || FALLBACK_AGENTS[agentId];
                  const Icon = AGENT_ICONS[agentId] || Bot;
                  const checked = selectedSet.has(agentId);
                  return (
                    <button
                      key={agentId}
                      type="button"
                      onClick={() => toggleAgent(agentId)}
                      className="w-full rounded-xl px-3 py-3 text-left transition-all"
                      style={{
                        background: checked ? "color-mix(in oklab, var(--oc-accent) 12%, var(--oc-card))" : "var(--oc-card)",
                        border: checked ? "1px solid color-mix(in oklab, var(--oc-accent) 48%, var(--oc-border))" : "1px solid var(--oc-border)",
                        color: "var(--oc-text-primary)",
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: checked ? "var(--oc-accent)" : "var(--oc-bg-active)", color: checked ? "#fff" : "var(--oc-text-secondary)" }}>
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{agent.name || agentId}</span>
                            {checked && <CheckCircle2 size={14} style={{ color: "var(--oc-accent)" }} />}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: "var(--oc-text-secondary)" }}>{agent.description}</p>
                          <p className="mt-2 font-mono text-[10px]" style={{ color: "var(--oc-text-tertiary)" }}>{agentId}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-card">
              <h2 className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>快速任务</h2>
              <div className="mt-3 space-y-2">
                {QUICK_PROMPTS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPrompt(item)}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors"
                    style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="settings-card">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>输入任务</h2>
                  <p className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>v1 使用 same-input fan-out：每个智能体收到同一份任务，不由模型改写子任务。</p>
                </div>
                <button
                  type="button"
                  disabled={!canRun}
                  onClick={runCluster}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "var(--oc-accent)", color: "#fff", border: "none" }}
                >
                  {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                  运行
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={running}
                rows={6}
                className="w-full resize-y rounded-xl px-4 py-3 text-sm leading-6 outline-none"
                style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}
                placeholder="描述你希望多个智能体共同处理的任务..."
              />
              {lastError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{lastError}</span>
                </div>
              )}
            </div>

            {run && (
              <div className="settings-card">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>运行结果</h2>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: run.status === "completed" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)", color: run.status === "completed" ? "#10b981" : "#f59e0b" }}>
                        {statusLabel(run.status)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>{run.id}</p>
                  </div>
                  <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                    {runMs !== null ? `耗时 ${formatElapsed(runMs)}` : ""}
                    {run.errorSummary ? ` · ${run.errorSummary}` : ""}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {(run.resultsJson || []).map((result) => {
                    const agent = agents[result.agentDefinitionId] || FALLBACK_AGENTS[result.agentDefinitionId];
                    const ok = result.status === "success";
                    return (
                      <article key={result.id} className="rounded-xl p-4" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)" }}>
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {ok ? <CheckCircle2 size={16} style={{ color: "#10b981" }} /> : <XCircle size={16} style={{ color: "#ef4444" }} />}
                              <h3 className="truncate text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>{agent?.name || result.agentDefinitionId}</h3>
                              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: ok ? "#10b981" : "#ef4444" }}>
                                {resultLabel(result.status)}
                              </span>
                            </div>
                            <p className="mt-1 font-mono text-[10px]" style={{ color: "var(--oc-text-tertiary)" }}>{result.agentDefinitionId}</p>
                          </div>
                          <div className="text-[11px]" style={{ color: "var(--oc-text-tertiary)" }}>
                            {result.producedAt ? new Date(result.producedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
                          </div>
                        </div>

                        {result.error && (
                          <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                            {result.error.code || "error"}：{result.error.detail || result.summary || "运行失败"}
                          </div>
                        )}

                        <div className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--oc-text-primary)" }}>
                          {result.output || result.summary || "无文本输出"}
                        </div>

                        {Array.isArray(result.artifacts) && result.artifacts.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <div className="text-xs font-semibold" style={{ color: "var(--oc-text-secondary)" }}>产物</div>
                            {result.artifacts.map((artifact, idx) => (
                              <div key={artifact.id || `${result.id}-${idx}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}>
                                <span>{artifact.name || artifact.type || "artifact"}</span>
                                {artifact.downloadUrl ? <a href={artifact.downloadUrl} target="_blank" rel="noreferrer" style={{ color: "var(--oc-accent)" }}>下载</a> : <span>待签发</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
