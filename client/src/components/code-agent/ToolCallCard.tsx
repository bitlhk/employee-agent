import { memo } from "react";
import { FileSearch, Terminal, FileEdit, Loader2, CheckCircle2, XCircle, FolderSearch, Globe, Brain } from "lucide-react";

type ToolStatus = "running" | "done" | "error";

interface ToolCallCardProps {
  toolName: string;
  args?: string;
  status: ToolStatus;
  output?: string;
  durationMs?: number;
}

const TOOL_META: Record<string, { icon: typeof Terminal; label: string; color: string }> = {
  "exec":       { icon: Terminal,    label: "执行命令",   color: "#22c55e" },
  "read":       { icon: FileSearch,  label: "读取文件",   color: "#60a5fa" },
  "write":      { icon: FileEdit,    label: "写入文件",   color: "#f59e0b" },
  "edit":       { icon: FileEdit,    label: "编辑文件",   color: "#f59e0b" },
  "search":     { icon: FolderSearch,label: "搜索文件",   color: "#a78bfa" },
  "grep":       { icon: FolderSearch,label: "搜索内容",   color: "#a78bfa" },
  "glob":       { icon: FolderSearch,label: "查找文件",   color: "#a78bfa" },
  "bash":       { icon: Terminal,    label: "Shell 命令", color: "#22c55e" },
  "web_search": { icon: Globe,       label: "搜索网络",   color: "#06b6d4" },
  "think":      { icon: Brain,       label: "思考中",     color: "#8b5cf6" },
};

function getToolMeta(name: string) {
  // 尝试精确匹配，再尝试前缀匹配
  if (TOOL_META[name]) return TOOL_META[name];
  for (const [key, meta] of Object.entries(TOOL_META)) {
    if (name.toLowerCase().includes(key)) return meta;
  }
  return { icon: Terminal, label: name, color: "var(--oc-text-secondary)" };
}

function ToolCallCardInner({ toolName, args, status, output, durationMs }: ToolCallCardProps) {
  const meta = getToolMeta(toolName);
  const Icon = meta.icon;
  const StatusIcon = status === "running" ? Loader2 : status === "done" ? CheckCircle2 : XCircle;

  // 从 args 中提取关键信息（如文件名、命令）
  const summary = (() => {
    if (!args) return "";
    try {
      const parsed = JSON.parse(args);
      if (parsed.command || parsed.cmd) return parsed.command || parsed.cmd;
      if (parsed.file_path || parsed.path) return parsed.file_path || parsed.path;
      if (parsed.pattern) return parsed.pattern;
      return "";
    } catch {
      return args.length > 80 ? args.slice(0, 80) + "..." : args;
    }
  })();

  return (
    <div className="ca-toolcall">
      <div className="ca-toolcall-header">
        <div className="ca-toolcall-left">
          <Icon size={13} style={{ color: meta.color }} />
          <span className="ca-toolcall-label">{meta.label}</span>
          {summary && <span className="ca-toolcall-summary">{summary}</span>}
        </div>
        <div className="ca-toolcall-right">
          {durationMs != null && <span className="ca-toolcall-duration">{durationMs}ms</span>}
          <StatusIcon
            size={13}
            className={status === "running" ? "animate-spin" : ""}
            style={{ color: status === "done" ? "#22c55e" : status === "error" ? "#ef4444" : "#9ca3af" }}
          />
        </div>
      </div>
      {output && status !== "running" && (
        <div className="ca-toolcall-output">
          <pre>{output.length > 500 ? output.slice(0, 500) + "\n..." : output}</pre>
        </div>
      )}
    </div>
  );
}

export const ToolCallCard = memo(ToolCallCardInner);
