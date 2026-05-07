import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BizAgent {
  id: string; name: string; description?: string | null;
  kind: "local" | "remote"; apiUrl?: string | null; apiToken?: string | null;
  remoteAgentId?: string | null; localAgentId?: string | null;
  skills?: string | null; icon?: string | null;
  enabled: number; sortOrder: number;
  expiresAt?: string | null; maxDailyRequests?: number;
  healthStatus?: "healthy" | "degraded" | "offline" | "unknown";
  lastHealthCheck?: string | null;
  allowedProfiles?: string | null; tags?: string | null;
  systemPrompt?: string | null; uiConfig?: string | null;
}

const EMPTY: Partial<BizAgent> = {
  id: "", name: "", description: "", kind: "remote",
  apiUrl: "", apiToken: "", remoteAgentId: "main",
  localAgentId: "", skills: "", icon: "🤖", enabled: 1, sortOrder: 0,
  expiresAt: null, maxDailyRequests: 0, allowedProfiles: "plus,internal", tags: "",
};

const CATEGORY_OPTIONS = [
  { value: "core", label: "灵枢 · 核心引擎" },
  { value: "tools", label: "灵匠 · 创作工具" },
  { value: "finance", label: "灵犀 · 分析研判" },
  { value: "other", label: "其他能力" },
];

const TEMPLATE_OPTIONS = [
  { value: "general", label: "通用助手" },
  { value: "finance", label: "金融专业" },
  { value: "tool", label: "工程工具" },
  { value: "compact", label: "轻量卡片" },
];

const LEGACY_CATEGORY: Record<string, string> = {
  "task-hermes": "core",
  "task-trace": "core",
  "task-ppt": "tools",
  "task-code": "tools",
  "task-slides": "tools",
  "task-stock": "finance",
  "task-claim-ev": "finance",
  "task-my-wealth": "finance",
  "task-bond": "finance",
  "task-credit-risk": "finance",
};

function parseUiConfig(raw?: string | null) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as any : {};
  } catch {
    return {};
  }
}

function formatExamples(examples: any) {
  if (!Array.isArray(examples)) return "";
  return examples
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item?.text) return "";
      return item.icon ? `${item.icon}|${item.text}` : item.text;
    })
    .filter(Boolean)
    .join("\n");
}

function parseExamples(text: string) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [first, ...rest] = line.split("|");
      return rest.length > 0 ? { icon: first.trim(), text: rest.join("|").trim() } : { text: line };
    })
    .filter((item) => item.text);
}

function toAgentPayload(v: any) {
  const {
    uiCategory, uiTemplate, uiSubtitle, welcomeTitle,
    welcomeDescription, examplePrompts, uiBadges,
    ...payload
  } = v;
  const uiConfig = {
    category: uiCategory || "other",
    template: uiTemplate || "general",
    subtitle: uiSubtitle || "",
    welcomeTitle: welcomeTitle || "",
    welcomeDescription: welcomeDescription || "",
    examples: parseExamples(examplePrompts || ""),
    badges: String(uiBadges || "").split(",").map((item) => item.trim()).filter(Boolean),
  };
  return { ...payload, uiConfig: JSON.stringify(uiConfig) };
}

function optionLabel(options: { value: string; label: string }[], value?: string) {
  return options.find((option) => option.value === value)?.label || value || "未配置";
}

function AgentForm({ initial, onSave, onCancel }: {
  initial: Partial<BizAgent>; onSave: (v: any) => void; onCancel: () => void;
}) {
  const ui = parseUiConfig(initial.uiConfig);
  const [v, setV] = useState<any>({
    ...EMPTY,
    ...initial,
    uiCategory: ui.category || LEGACY_CATEGORY[String(initial.id || "")] || "other",
    uiTemplate: ui.template || "general",
    uiSubtitle: ui.subtitle || "",
    welcomeTitle: ui.welcomeTitle || initial.name || "",
    welcomeDescription: ui.welcomeDescription || initial.description || "",
    examplePrompts: formatExamples(ui.examples),
    uiBadges: Array.isArray(ui.badges) ? ui.badges.join(",") : "",
  });
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));
  const isEdit = !!initial.id;

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-input-bg)" }}>
      <div className="text-xs font-semibold" style={{ color: "var(--oc-text-primary)" }}>
        {isEdit ? "编辑业务 Agent" : "新增业务 Agent"}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>ID（唯一标识，创建后不可改）</label>
          <input value={v.id} disabled={isEdit} onChange={e => set("id", e.target.value)}
            placeholder="task-xxx"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none disabled:opacity-50"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>显示名称</label>
          <input value={v.name} onChange={e => set("name", e.target.value)} placeholder="代码助手"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>描述</label>
          <input value={v.description || ""} onChange={e => set("description", e.target.value)} placeholder="一句话描述能力..."
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>类型</label>
          <select value={v.kind} onChange={e => set("kind", e.target.value)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            <option value="remote">🌐 远端 API（OpenAI 兼容）</option>
            <option value="local">💻 本地 Agent（本机 OpenClaw）</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>图标（Emoji）</label>
          <input value={v.icon || "🤖"} onChange={e => set("icon", e.target.value)} maxLength={4}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>广场分组</label>
          <select value={v.uiCategory} onChange={e => set("uiCategory", e.target.value)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>详情模板</label>
          <select value={v.uiTemplate} onChange={e => set("uiTemplate", e.target.value)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            {TEMPLATE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>广场副标题</label>
          <input value={v.uiSubtitle || ""} onChange={e => set("uiSubtitle", e.target.value)} placeholder="灵犀 · 债券投研"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>欢迎标题</label>
          <input value={v.welcomeTitle || ""} onChange={e => set("welcomeTitle", e.target.value)} placeholder="灵犀 · 债券投研助手"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>能力标签（逗号分隔）</label>
          <input value={v.uiBadges || ""} onChange={e => set("uiBadges", e.target.value)} placeholder="中债数据,Hermes,投研"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>欢迎说明</label>
          <textarea value={v.welcomeDescription || ""} onChange={e => set("welcomeDescription", e.target.value)} rows={2}
            placeholder="进入智能体后的空状态说明文案"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none resize-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>示例问题（每行一个，支持“图标|问题”）</label>
          <textarea value={v.examplePrompts || ""} onChange={e => set("examplePrompts", e.target.value)} rows={4}
            placeholder={"📊|分析某只股票的多头趋势\n写一个 Python 脚本批量重命名文件"}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none resize-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        {v.kind === "remote" && <>
          <div className="col-span-2">
            <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>API URL（兼容 OpenAI /v1/chat/completions）</label>
            <input value={v.apiUrl || ""} onChange={e => set("apiUrl", e.target.value)} placeholder="http://1.2.3.4:19789"
              className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>Bearer Token</label>
            <input value={v.apiToken || ""} onChange={e => set("apiToken", e.target.value)} placeholder="your-token"
              type="password"
              className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>远端 Agent ID（默认 main）</label>
            <input value={v.remoteAgentId || "main"} onChange={e => set("remoteAgentId", e.target.value)} placeholder="main"
              className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          </div>
        </>}
        {v.kind === "local" && <>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>本地 Agent ID</label>
            <input value={v.localAgentId || ""} onChange={e => set("localAgentId", e.target.value)} placeholder="task-ppt"
              className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>技能包（JSON 数组，可选）</label>
            <input value={v.skills || ""} onChange={e => set("skills", e.target.value)} placeholder='["skill-name"]'
              className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          </div>
        </>}
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>排序权重（数字越小越靠前）</label>
          <input type="number" value={v.sortOrder ?? 0} onChange={e => set("sortOrder", parseInt(e.target.value)||0)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>有效期（留空=永久）</label>
          <input type="date" value={v.expiresAt ? new Date(v.expiresAt).toISOString().slice(0,10) : ""} onChange={e => set("expiresAt", e.target.value || null)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>每日调用上限（0=不限）</label>
          <input type="number" value={v.maxDailyRequests ?? 0} onChange={e => set("maxDailyRequests", parseInt(e.target.value)||0)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>允许角色（逗号分隔）</label>
          <input value={v.allowedProfiles || "plus,internal"} onChange={e => set("allowedProfiles", e.target.value)}
            placeholder="plus,internal"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          <div className="text-[9px] mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.65 }}>plus=员工，internal=管理员</div>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>标签（逗号分隔）</label>
          <input value={v.tags || ""} onChange={e => set("tags", e.target.value)}
            placeholder="金融,投研,报告"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>系统提示词（可选）</label>
          <textarea value={v.systemPrompt || ""} onChange={e => set("systemPrompt", e.target.value)} rows={3}
            placeholder="仅用于后端支持该智能体自定义提示词时生效"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none resize-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={() => onSave(toAgentPayload(v))}
          disabled={!v.id || !v.name}
          className="admin-primary-action px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ background: "var(--oc-accent)", color: "var(--oc-text-on-accent)", border: "none", cursor: "pointer" }}>
          保存
        </button>
        <button onClick={onCancel}
          className="admin-secondary-action px-4 py-1.5 rounded-lg text-xs"
          style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)", cursor: "pointer" }}>
          取消
        </button>
      </div>
    </div>
  );
}

export function BizAgentsPanel() {
  const listQ = trpc.bizAgents.list.useQuery();
  const healthCheckMutation = trpc.agentHealth.check.useMutation({ onSuccess: () => listQ.refetch() });
  const healthCheckAllMutation = trpc.agentHealth.checkAll.useMutation({
    onSuccess: () => { listQ.refetch(); toast.success("健康检查完成"); },
  });
  const upsert = trpc.bizAgents.upsert.useMutation({ onSuccess: () => { listQ.refetch(); setEditing(null); setAdding(false); toast.success("已保存"); } });
  const del = trpc.bizAgents.delete.useMutation({ onSuccess: () => { listQ.refetch(); toast.success("已删除"); } });
  const setEnabled = trpc.bizAgents.setEnabled.useMutation({ onSuccess: () => listQ.refetch() });

  const [editing, setEditing] = useState<BizAgent | null>(null);
  const [adding, setAdding] = useState(false);

  const agents: BizAgent[] = (listQ.data as any) || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>业务智能体配置</div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--oc-text-secondary)" }}>
            配置后前端协作广场"业务智能体"栏目实时生效。支持远端 API（OpenAI 兼容）和本地 Agent。
          </div>
        </div>
        {!adding && !editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => healthCheckAllMutation.mutate()}
              disabled={healthCheckAllMutation.isPending}
              className="admin-secondary-action flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)", cursor: "pointer" }}>
              {healthCheckAllMutation.isPending ? "检查中…" : "🏥 健康检查"}
            </button>
            <button onClick={() => setAdding(true)}
              className="admin-primary-action flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--oc-accent)", color: "var(--oc-text-on-accent)", border: "none", cursor: "pointer" }}>
              <Plus size={12} /> 新增
            </button>
          </div>
        )}
      </div>

      {adding && (
        <AgentForm initial={EMPTY} onSave={(v) => upsert.mutate(v)} onCancel={() => setAdding(false)} />
      )}

      {listQ.isLoading && (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--oc-text-secondary)" }} />
          <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>加载中...</span>
        </div>
      )}

      <div className="space-y-2">
        {agents.map(a => {
          const ui = parseUiConfig(a.uiConfig);
          return (
          <div key={a.id}>
            {editing?.id === a.id ? (
              <AgentForm initial={editing} onSave={(v) => upsert.mutate(v)} onCancel={() => setEditing(null)} />
            ) : (
              <div className="rounded-xl border px-4 py-3 flex items-center gap-3"
                style={{ borderColor: "var(--oc-border)", background: "var(--oc-input-bg)", opacity: a.enabled ? 1 : 0.5 }}>
                <div className="relative">
                  <span style={{ fontSize: 22 }}>{a.icon || "🤖"}</span>
                  <span style={{ position: "absolute", bottom: -2, right: -2, width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--oc-card)", background: a.healthStatus === "healthy" ? "#22c55e" : a.healthStatus === "degraded" ? "#f59e0b" : a.healthStatus === "offline" ? "#ef4444" : "#9ca3af" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: "var(--oc-text-primary)" }}>{a.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: a.kind === "remote" ? "rgba(96,165,250,0.12)" : "rgba(34,197,94,0.12)", color: a.kind === "remote" ? "#60a5fa" : "#22c55e", border: `1px solid ${a.kind === "remote" ? "rgba(96,165,250,0.25)" : "rgba(34,197,94,0.25)"}` }}>
                      {a.kind === "remote" ? "🌐 远端" : "💻 本地"}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: "var(--oc-text-secondary)" }}>#{a.id}</span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--oc-text-secondary)" }}>{a.description || "—"}</div>
                  {a.kind === "remote" && a.apiUrl && (
                    <div className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--oc-text-secondary)", opacity: 0.6 }}>{a.apiUrl}</div>
                  )}
                  {a.kind === "local" && a.localAgentId && (
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--oc-text-secondary)", opacity: 0.6 }}>agent: {a.localAgentId}{a.skills ? ` · skills: ${a.skills}` : ""}</div>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.7 }}>
                    {a.expiresAt && <span>有效期: {new Date(a.expiresAt).toLocaleDateString()}</span>}
                    {!a.expiresAt && <span>永久有效</span>}
                    {(a.maxDailyRequests || 0) > 0 && <span>日限: {a.maxDailyRequests}次</span>}
                    {ui.category && <span>{optionLabel(CATEGORY_OPTIONS, ui.category)}</span>}
                    {ui.template && <span>{optionLabel(TEMPLATE_OPTIONS, ui.template)}</span>}
                    {a.tags && <span>{String(a.tags).split(",").filter(Boolean).map(t => `[${t.trim()}]`).join(" ")}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setEnabled.mutate({ id: a.id, enabled: a.enabled ? 0 : 1 })}
                    title={a.enabled ? "点击禁用" : "点击启用"}
                    style={{ background: "none", border: "none", cursor: "pointer", color: a.enabled ? "#22c55e" : "var(--oc-text-secondary)", padding: 4 }}>
                    {a.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                  <button onClick={() => setEditing(a)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--oc-text-secondary)", padding: 4 }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => { if (confirm(`确定删除「${a.name}」？`)) del.mutate({ id: a.id }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--oc-danger)", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })}
        {!listQ.isLoading && agents.length === 0 && (
          <div className="text-xs text-center py-6" style={{ color: "var(--oc-text-secondary)", opacity: 0.5 }}>
            暂无业务 Agent，点击"新增"添加第一个
          </div>
        )}
      </div>
    </div>
  );
}
