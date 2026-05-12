import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2, Bot, Presentation, Code2, TrendingUp, Dna, BarChart3, Battery, Compass, Search, FileText, Globe2 } from "lucide-react";
import { toast } from "sonner";
import {
  isBuiltinBusinessAgentAdapter,
  isReservedLegacyBusinessAgentId,
} from "@shared/business-agent-presets";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

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
  providerType?: string | null; adapterProtocol?: string | null;
  capabilitiesJson?: string | null; endpointConfigJson?: string | null;
}

const EMPTY: Partial<BizAgent> = {
  id: "", name: "", description: "", kind: "remote",
  apiUrl: "", apiToken: "", remoteAgentId: "main",
  localAgentId: "", skills: "", icon: "🤖", enabled: 1, sortOrder: 0,
  expiresAt: null, maxDailyRequests: 0, allowedProfiles: "plus,internal", tags: "",
  providerType: "openai-compatible", adapterProtocol: "openai-chat-completions",
  capabilitiesJson: "[\"chat\"]", endpointConfigJson: "",
};

const CATEGORY_OPTIONS = [
  { value: "core", label: "灵枢 · 核心引擎" },
  { value: "tools", label: "灵匠 · 创作工具" },
  { value: "finance", label: "灵犀 · 分析研判" },
  { value: "other", label: "其他能力" },
];

const TEMPLATE_OPTIONS = [
  { value: "general_chat", label: "通用对话模板" },
  { value: "research_analysis", label: "研究分析模板" },
  { value: "artifact_generation", label: "产物生成模板" },
  { value: "workflow_decision", label: "专业流程模板" },
];

const PROVIDER_OPTIONS = [
  { value: "openai-compatible", label: "OpenAI 兼容服务" },
  { value: "openclaw-local", label: "本机 OpenClaw" },
  { value: "openclaw-remote", label: "远端 OpenClaw Gateway" },
  { value: "hermes", label: "Hermes Runtime" },
  { value: "http-sse", label: "HTTP SSE 服务" },
  { value: "mcp", label: "MCP Server（实验）" },
  { value: "a2a", label: "A2A Agent（实验）" },
];

const ADAPTER_OPTIONS = [
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "openclaw-chat", label: "OpenClaw Chat" },
  { value: "hermes-events", label: "Hermes Events" },
  { value: "stock-agent-v1", label: "Stock Agent v1" },
  { value: "my-wealth-hermes-v1", label: "个人理财 Hermes v1" },
  { value: "bond-hermes-v1", label: "债券投研 Hermes v1" },
  { value: "credit-risk-hermes-v1", label: "智贷决策 Hermes v1" },
  { value: "claim-ev-hermes-v1", label: "EV 理赔 Hermes v1" },
  { value: "mcp-tools-v1", label: "MCP Tools v1" },
  { value: "a2a-task-v1", label: "A2A Task v1" },
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

const LEGACY_TEMPLATE_MAP: Record<string, string> = {
  general: "general_chat",
  finance: "research_analysis",
  tool: "artifact_generation",
  compact: "general_chat",
};

function normalizeUiTemplate(value?: string | null) {
  const raw = String(value || "").trim();
  const normalized = LEGACY_TEMPLATE_MAP[raw] || raw;
  return TEMPLATE_OPTIONS.some((option) => option.value === normalized) ? normalized : "";
}

function defaultUiTemplateFor(id: string, providerType?: string | null, adapterProtocol?: string | null) {
  if (["task-ppt", "task-code", "task-slides"].includes(id)) return "artifact_generation";
  if (["task-stock", "task-bond", "task-my-wealth"].includes(id)) return "research_analysis";
  if (["task-credit-risk", "task-claim-ev"].includes(id)) return "workflow_decision";
  if (String(adapterProtocol || "").includes("bond") || String(adapterProtocol || "").includes("stock")) return "research_analysis";
  if (String(providerType || "") === "hermes") return "research_analysis";
  return "general_chat";
}

function defaultRuntimeFor(id: string, kind: string) {
  if (id === "task-stock") return { providerType: "http-sse", adapterProtocol: "stock-agent-v1", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (id === "task-my-wealth") return { providerType: "hermes", adapterProtocol: "my-wealth-hermes-v1", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (id === "task-bond") return { providerType: "hermes", adapterProtocol: "bond-hermes-v1", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (id === "task-credit-risk") return { providerType: "hermes", adapterProtocol: "credit-risk-hermes-v1", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (id === "task-claim-ev") return { providerType: "hermes", adapterProtocol: "claim-ev-hermes-v1", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (id === "task-hermes") return { providerType: "hermes", adapterProtocol: "hermes-events", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (kind === "local") return { providerType: "openclaw-local", adapterProtocol: "openclaw-chat", capabilitiesJson: "[\"chat\",\"tools\",\"files\"]" };
  return { providerType: "openai-compatible", adapterProtocol: "openai-chat-completions", capabilitiesJson: "[\"chat\"]" };
}

function defaultRuntimeForProvider(providerType: string, kind: string) {
  if (providerType === "mcp") return { adapterProtocol: "mcp-tools-v1", capabilitiesJson: "[\"chat\",\"tools\"]" };
  if (providerType === "a2a") return { adapterProtocol: "a2a-task-v1", capabilitiesJson: "[\"chat\",\"long_task\"]" };
  if (providerType === "openclaw-local" || kind === "local") return { adapterProtocol: "openclaw-chat", capabilitiesJson: "[\"chat\",\"tools\",\"files\"]" };
  if (providerType === "openclaw-remote") return { adapterProtocol: "openai-chat-completions", capabilitiesJson: "[\"chat\",\"tools\",\"files\"]" };
  if (providerType === "hermes") return { adapterProtocol: "hermes-events", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  if (providerType === "http-sse") return { adapterProtocol: "stock-agent-v1", capabilitiesJson: "[\"chat\",\"tools\",\"long_task\"]" };
  return { adapterProtocol: "openai-chat-completions", capabilitiesJson: "[\"chat\"]" };
}

function endpointConfigTemplate(providerType: string) {
  if (providerType === "mcp") {
    return JSON.stringify({ rpcPath: "/mcp", toolName: "chat", messageParam: "message", arguments: {} }, null, 2);
  }
  if (providerType === "a2a") {
    return JSON.stringify({ rpcPath: "/", healthPath: "/.well-known/agent-card.json", stream: false }, null, 2);
  }
  return JSON.stringify({ path: "/v1/chat/completions", timeoutMs: 0 }, null, 2);
}

function endpointConfigPlaceholder(providerType?: string | null) {
  return endpointConfigTemplate(providerType || "openai-compatible");
}

function parseJsonForSave(label: string, value: string, expect: "array" | "object") {
  if (!value.trim()) return true;
  try {
    const parsed = JSON.parse(value);
    if (expect === "array" && !Array.isArray(parsed)) {
      toast.error(`${label} 必须是 JSON 数组`);
      return false;
    }
    if (expect === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
      toast.error(`${label} 必须是 JSON 对象`);
      return false;
    }
    return true;
  } catch {
    toast.error(`${label} 不是合法 JSON`);
    return false;
  }
}

function agentIcon(id: string, size = 20) {
  const style = { color: "var(--oc-accent)" };
  if (id === "task-ppt") return <Presentation size={size} style={style} />;
  if (id === "task-code") return <Code2 size={size} style={style} />;
  if (id === "task-hermes") return <Dna size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-trace") return <Bot size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-stock") return <BarChart3 size={size} style={{ color: "var(--oc-danger)" }} />;
  if (id === "task-claim-ev") return <Battery size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-my-wealth") return <TrendingUp size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-bond") return <BarChart3 size={size} style={{ color: "#be1e2d" }} />;
  if (id === "task-credit-risk") return <Compass size={size} style={{ color: "#be1e2d" }} />;
  return <Bot size={size} style={style} />;
}

function configuredIcon(icon?: string | null, size = 20) {
  const key = String(icon || "").trim().toLowerCase();
  const style = { color: "var(--oc-accent)" };
  if (key === "search") return <Search size={size} style={style} />;
  if (key === "filetext" || key === "file-text") return <FileText size={size} style={style} />;
  if (key === "globe" || key === "globe2") return <Globe2 size={size} style={style} />;
  if (key === "bot") return <Bot size={size} style={style} />;
  if (icon && icon.trim().length <= 4 && !icon.trim().startsWith("/")) {
    return <span style={{ fontSize: size + 2, lineHeight: 1 }}>{icon.trim()}</span>;
  }
  return null;
}

function renderAgentIcon(agent: Pick<BizAgent, "id" | "icon">, size = 20) {
  if (LEGACY_CATEGORY[agent.id]) return agentIcon(agent.id, size);
  const icon = configuredIcon(agent.icon, size);
  if (icon) return icon;
  return <Bot size={size} style={{ color: "var(--oc-accent)" }} />;
}

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

function endpointConfigObject(providerType: string | null | undefined, raw: string | null | undefined): Record<string, any> {
  const fallback = endpointConfigTemplate(providerType || "openai-compatible");
  try {
    const parsed = JSON.parse(raw && raw.trim() ? raw : fallback);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    try {
      return JSON.parse(fallback);
    } catch {
      return {};
    }
  }
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function adapterOptionsForProvider(providerType: string | null | undefined, current?: string | null) {
  const allowed: Record<string, string[]> = {
    "mcp": ["mcp-tools-v1"],
    "a2a": ["a2a-task-v1"],
    "openclaw-local": ["openclaw-chat"],
    "openai-compatible": ["openai-chat-completions"],
    "openclaw-remote": ["openai-chat-completions", "openclaw-chat"],
    "http-sse": ["stock-agent-v1"],
    "hermes": ["hermes-events", "my-wealth-hermes-v1", "bond-hermes-v1", "credit-risk-hermes-v1", "claim-ev-hermes-v1"],
  };
  const keys = allowed[String(providerType || "")] || ADAPTER_OPTIONS.map((option) => option.value);
  const merged = current && !keys.includes(current) ? [...keys, current] : keys;
  return ADAPTER_OPTIONS.filter((option) => merged.includes(option.value));
}

function toAgentPayload(v: any) {
  const {
    uiCategory, uiTemplate, uiSubtitle, welcomeTitle,
    welcomeDescription, examplePrompts, uiBadges,
    ...payload
  } = v;
  const uiConfig = {
    category: uiCategory || "other",
    template: normalizeUiTemplate(uiTemplate) || "general_chat",
    subtitle: uiSubtitle || "",
    welcomeTitle: welcomeTitle || "",
    welcomeDescription: welcomeDescription || "",
    examples: parseExamples(examplePrompts || ""),
    badges: String(uiBadges || "").split(",").map((item) => item.trim()).filter(Boolean),
  };
  return {
    ...payload,
    description: payload.description || "",
    apiUrl: payload.apiUrl || "",
    apiToken: payload.apiToken || "",
    remoteAgentId: payload.remoteAgentId || "",
    localAgentId: payload.localAgentId || "",
    skills: payload.skills || "",
    icon: payload.icon || "🤖",
    allowedProfiles: payload.allowedProfiles || "plus,internal",
    tags: payload.tags || "",
    systemPrompt: payload.systemPrompt || "",
    providerType: payload.providerType || defaultRuntimeFor(payload.id || "", payload.kind || "remote").providerType,
    adapterProtocol: payload.adapterProtocol || defaultRuntimeFor(payload.id || "", payload.kind || "remote").adapterProtocol,
    capabilitiesJson: payload.capabilitiesJson || defaultRuntimeFor(payload.id || "", payload.kind || "remote").capabilitiesJson,
    endpointConfigJson: payload.endpointConfigJson || "",
    uiConfig: JSON.stringify(uiConfig),
  };
}

function optionLabel(options: { value: string; label: string }[], value?: string) {
  return options.find((option) => option.value === value)?.label || value || "未配置";
}

function AgentForm({ initial, saving = false, onSave, onCancel }: {
  initial: Partial<BizAgent>; saving?: boolean; onSave: (v: any) => void; onCancel: () => void;
}) {
  const ui = parseUiConfig(initial.uiConfig);
  const runtimeDefaults = defaultRuntimeFor(String(initial.id || ""), String(initial.kind || "remote"));
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [argumentsDraft, setArgumentsDraft] = useState(
    prettyJson(endpointConfigObject(initial.providerType || runtimeDefaults.providerType, initial.endpointConfigJson).arguments || {}),
  );
  const [v, setV] = useState<any>({
    ...EMPTY,
    ...initial,
    apiToken: initial.id ? "" : (initial.apiToken || ""),
    uiCategory: ui.category || LEGACY_CATEGORY[String(initial.id || "")] || "other",
    uiTemplate: normalizeUiTemplate(ui.template) || defaultUiTemplateFor(String(initial.id || ""), initial.providerType || runtimeDefaults.providerType, initial.adapterProtocol || runtimeDefaults.adapterProtocol),
    uiSubtitle: ui.subtitle || "",
    welcomeTitle: ui.welcomeTitle || initial.name || "",
    welcomeDescription: ui.welcomeDescription || initial.description || "",
    examplePrompts: formatExamples(ui.examples),
    uiBadges: Array.isArray(ui.badges) ? ui.badges.join(",") : "",
    providerType: initial.providerType || runtimeDefaults.providerType,
    adapterProtocol: initial.adapterProtocol || runtimeDefaults.adapterProtocol,
    capabilitiesJson: initial.capabilitiesJson || runtimeDefaults.capabilitiesJson,
    endpointConfigJson: initial.endpointConfigJson || "",
  });
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));
  const isEdit = !!initial.id;
  const endpointConfig = endpointConfigObject(v.providerType, v.endpointConfigJson);
  const availableAdapterOptions = adapterOptionsForProvider(v.providerType, v.adapterProtocol);
  const usesBuiltinPreset = isReservedLegacyBusinessAgentId(v.id) || isBuiltinBusinessAgentAdapter(v.adapterProtocol);
  const patchEndpointConfig = (patch: Record<string, any>) => {
    set("endpointConfigJson", prettyJson({ ...endpointConfigObject(v.providerType, v.endpointConfigJson), ...patch }));
  };
  const handleProviderChange = (providerType: string) => {
    const defaults = defaultRuntimeForProvider(providerType, String(v.kind || "remote"));
    setV((p: any) => ({
      ...p,
      providerType,
      adapterProtocol: defaults.adapterProtocol,
      capabilitiesJson: defaults.capabilitiesJson,
      endpointConfigJson: endpointConfigTemplate(providerType),
    }));
  };
  const handleSave = () => {
    if (usesBuiltinPreset) {
      toast.warning("当前配置命中了内置演示 Preset。开源/独立部署默认会由后端拒绝，需显式开启 ENABLE_BUILTIN_BUSINESS_AGENT_PRESETS。");
    }
    if ((v.providerType === "mcp" && v.adapterProtocol !== "mcp-tools-v1") || (v.providerType === "a2a" && v.adapterProtocol !== "a2a-task-v1")) {
      toast.error("调用方式和协议适配器不匹配");
      return;
    }
    if (!parseJsonForSave("能力声明 JSON", v.capabilitiesJson || "", "array")) return;
    if (!parseJsonForSave("连接配置 JSON", v.endpointConfigJson || "", "object")) return;
    onSave(toAgentPayload(v));
  };

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
          <select value={v.kind} onChange={e => {
            const kind = e.target.value;
            const defaults = defaultRuntimeFor(String(v.id || ""), kind);
            setV((p: any) => ({ ...p, kind, ...defaults }));
          }}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            <option value="remote">🌐 远端 API（OpenAI 兼容）</option>
            <option value="local">💻 本地 Agent（本机 OpenClaw）</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>调用方式</label>
          <select value={v.providerType || "openai-compatible"} onChange={e => handleProviderChange(e.target.value)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            {PROVIDER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {(v.providerType === "mcp" || v.providerType === "a2a") && (
            <div className="text-[9px] mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.65 }}>实验能力：已接入通用 HTTP/JSON-RPC 适配器，生产使用前建议先做健康检查和小流量验证</div>
          )}
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>协议适配器</label>
          <select value={v.adapterProtocol || "openai-chat-completions"} onChange={e => set("adapterProtocol", e.target.value)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            {availableAdapterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div className="text-[9px] mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.65 }}>
            已按调用方式过滤适配器，避免误选不兼容协议
          </div>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>能力声明 JSON</label>
          <input value={v.capabilitiesJson || ""} onChange={e => set("capabilitiesJson", e.target.value)}
            placeholder='["chat","tools","files","artifacts","long_task"]'
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        </div>
        {usesBuiltinPreset && (
          <div className="col-span-2 rounded-lg px-3 py-2 text-[10px] leading-relaxed"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.28)", color: "#b45309" }}>
            命中内置演示 Preset：该 ID 或适配器会触发平台内置金融 demo 逻辑。开源/独立部署默认关闭，请使用自定义 ID + 通用适配器，或由管理员显式开启 ENABLE_BUILTIN_BUSINESS_AGENT_PRESETS。
          </div>
        )}
        <div className="col-span-2 rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--oc-border)", background: "color-mix(in oklab, var(--oc-card) 70%, transparent)" }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>连接配置</label>
              <div className="text-[9px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.72 }}>
                常用字段可直接填写；复杂场景再展开高级 JSON
              </div>
            </div>
            <button type="button" onClick={() => {
              const template = endpointConfigTemplate(v.providerType || "openai-compatible");
              set("endpointConfigJson", template);
              setArgumentsDraft(prettyJson(endpointConfigObject(v.providerType, template).arguments || {}));
            }}
              className="admin-secondary-action px-3 py-1 rounded-lg text-[10px]"
              style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)", cursor: "pointer" }}>
              填入模板
            </button>
          </div>
          {v.providerType === "mcp" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>MCP RPC Path</label>
                <input value={endpointConfig.rpcPath ?? ""} onChange={e => patchEndpointConfig({ rpcPath: e.target.value })}
                  placeholder="/mcp；端点已带 /mcp 时可留空"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>工具名</label>
                <input value={endpointConfig.toolName ?? ""} onChange={e => patchEndpointConfig({ toolName: e.target.value })}
                  placeholder="tavily_search"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>消息参数名</label>
                <input value={endpointConfig.messageParam ?? "message"} onChange={e => patchEndpointConfig({ messageParam: e.target.value })}
                  placeholder="query / message"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>健康检查 Path（可选）</label>
                <input value={endpointConfig.healthPath ?? ""} onChange={e => patchEndpointConfig({ healthPath: e.target.value || undefined })}
                  placeholder="默认复用 rpcPath"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>固定参数 JSON</label>
                <textarea value={argumentsDraft} onChange={e => {
                  const nextText = e.target.value;
                  setArgumentsDraft(nextText);
                  try { patchEndpointConfig({ arguments: JSON.parse(nextText || "{}") }); } catch {}
                }} rows={3}
                  placeholder='{"max_results":5}'
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none resize-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
            </div>
          )}
          {v.providerType === "a2a" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>A2A RPC Path</label>
                <input value={endpointConfig.rpcPath ?? "/"} onChange={e => patchEndpointConfig({ rpcPath: e.target.value })}
                  placeholder="/"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>Agent Card Path</label>
                <input value={endpointConfig.healthPath ?? "/.well-known/agent-card.json"} onChange={e => patchEndpointConfig({ healthPath: e.target.value })}
                  placeholder="/.well-known/agent-card.json"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)" }}>
                <div>
                  <div className="text-[10px] font-medium" style={{ color: "var(--oc-text-primary)" }}>流式调用</div>
                  <div className="text-[9px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.72 }}>关闭时使用 message/send；开启后使用 message/stream</div>
                </div>
                <input type="checkbox" checked={endpointConfig.stream === true} onChange={e => patchEndpointConfig({ stream: e.target.checked })}
                  className="h-4 w-4 accent-[#be1e2d]" />
              </div>
            </div>
          )}
          {!["mcp", "a2a"].includes(String(v.providerType || "")) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>请求路径</label>
                <input value={endpointConfig.path ?? "/v1/chat/completions"} onChange={e => patchEndpointConfig({ path: e.target.value })}
                  placeholder="/v1/chat/completions"
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
              <div>
                <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>超时毫秒（0=默认）</label>
                <input type="number" value={endpointConfig.timeoutMs ?? 0} onChange={e => patchEndpointConfig({ timeoutMs: parseInt(e.target.value) || 0 })}
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none font-mono"
                  style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
              </div>
            </div>
          )}
          <button type="button" onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
            className="text-[10px] font-medium"
            style={{ color: "var(--oc-accent)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            {showAdvancedConfig ? "收起高级 JSON" : "展开高级 JSON"}
          </button>
          {showAdvancedConfig && (
            <textarea value={v.endpointConfigJson || ""} onChange={e => set("endpointConfigJson", e.target.value)} rows={5}
              placeholder={endpointConfigPlaceholder(v.providerType)}
              className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none resize-none font-mono"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          )}
        </div>
        <div>
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>图标（Emoji 或单色图标名）</label>
          <input value={v.icon || "Bot"} onChange={e => set("icon", e.target.value)}
            disabled={!!LEGACY_CATEGORY[String(v.id || "")]}
            placeholder="Search / FileText / Globe2 / Bot"
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none disabled:opacity-50"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
          {LEGACY_CATEGORY[String(v.id || "")] && (
            <div className="text-[9px] mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.65 }}>内置智能体使用平台单色图标，避免被配置覆盖</div>
          )}
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
          <label className="text-[10px] block mb-1" style={{ color: "var(--oc-text-secondary)" }}>前端模板</label>
          <select value={v.uiTemplate} onChange={e => set("uiTemplate", e.target.value)}
            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
            {TEMPLATE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div className="text-[9px] mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.65 }}>只控制广场和聊天页展示形态；实际调用由下面的协议适配器决定</div>
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
            {isEdit && (
              <div className="text-[9px] mt-1" style={{ color: "var(--oc-text-secondary)", opacity: 0.65 }}>留空则保留现有 Token；填写新值才会替换</div>
            )}
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
        <button onClick={handleSave}
          disabled={!v.id || !v.name || saving}
          className="admin-primary-action px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ background: "var(--oc-accent)", color: "var(--oc-text-on-accent)", border: "none", cursor: "pointer" }}>
          {saving ? "保存中..." : "保存"}
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
  const { confirm, dialog } = useConfirmDialog();
  const listQ = trpc.bizAgents.list.useQuery();
  const healthCheckMutation = trpc.agentHealth.check.useMutation({ onSuccess: () => listQ.refetch() });
  const healthCheckAllMutation = trpc.agentHealth.checkAll.useMutation({
    onSuccess: () => { listQ.refetch(); toast.success("健康检查完成"); },
  });
  const upsert = trpc.bizAgents.upsert.useMutation({
    onSuccess: () => { listQ.refetch(); setEditing(null); setAdding(false); toast.success("已保存"); },
    onError: (error) => toast.error(error.message || "保存失败"),
  });
  const del = trpc.bizAgents.delete.useMutation({
    onSuccess: () => { listQ.refetch(); toast.success("已删除"); },
    onError: (error) => toast.error(error.message || "删除失败"),
  });
  const setEnabled = trpc.bizAgents.setEnabled.useMutation({
    onSuccess: () => listQ.refetch(),
    onError: (error) => toast.error(error.message || "状态更新失败"),
  });

  const [editing, setEditing] = useState<BizAgent | null>(null);
  const [adding, setAdding] = useState(false);

  const agents: BizAgent[] = (listQ.data as any) || [];

  const onDeleteAgent = async (agent: BizAgent) => {
    const ok = await confirm({
      title: "删除智能体配置？",
      description: `确定删除「${agent.name}」？`,
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    del.mutate({ id: agent.id });
  };

  return (
    <div className="space-y-3">
      {dialog}
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
        <AgentForm initial={EMPTY} saving={upsert.isPending} onSave={(v) => upsert.mutate(v)} onCancel={() => setAdding(false)} />
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
              <AgentForm initial={editing} saving={upsert.isPending} onSave={(v) => upsert.mutate(v)} onCancel={() => setEditing(null)} />
            ) : (
              <div className="rounded-xl border px-4 py-3 flex items-center gap-3"
                style={{ borderColor: "var(--oc-border)", background: "var(--oc-input-bg)", opacity: a.enabled ? 1 : 0.5 }}>
                <div className="relative">
                  <span className="flex items-center justify-center" style={{ width: 24, height: 24 }}>{renderAgentIcon(a, 22)}</span>
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
                    <span>{optionLabel(PROVIDER_OPTIONS, a.providerType || defaultRuntimeFor(a.id, a.kind).providerType)}</span>
                    <span>{optionLabel(ADAPTER_OPTIONS, a.adapterProtocol || defaultRuntimeFor(a.id, a.kind).adapterProtocol)}</span>
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
                  <button onClick={() => { void onDeleteAgent(a); }}
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
