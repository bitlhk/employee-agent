import { BrandIcon } from "@/components/BrandIcon";
import { memo, useState, useRef } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { formatModelName } from "@/lib/modelDisplay";

export type ToolCallEntry = {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  ts: number;
  executor?: "sandbox" | "native" | "none" | "gateway";
  truncated?: boolean;
  suppressedOriginalResult?: boolean;
  policyDenyReason?: string;
  auditId?: string;
  outputFiles?: Array<{ name: string; size: number; wsPath?: string }>;
  adoptId?: string;
  _gateway?: boolean;
};

type ChatMessageProps = {
  role: "user" | "assistant";
  text: string;
  isLast: boolean;
  isPlaceholder: boolean;
  streaming: boolean;
  displayName: string;
  modelId: string;
  timeLabel: string;
  toolCalls?: ToolCallEntry[];
  showToolCalls?: boolean;
  usage?: { input: number; output: number };
  contextPercent?: number | null;
  onDelete?: () => void;
};

// ── Gateway 内部工具内联状态（web_search / memory_search 等）──
const GATEWAY_TOOL_META: Record<string, { icon: string; label: string }> = {
  web_search:    { icon: "🔍", label: "搜索网页" },
  web_fetch:     { icon: "🌐", label: "获取网页" },
  memory_search: { icon: "🧠", label: "查找记忆" },
  read:          { icon: "📄", label: "读取文件" },
  thinking:      { icon: "💭", label: "深度思考" },
};

function RunFileButton({ adoptId, filePath, fileName }: { adoptId: string; filePath: string; fileName: string }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<{ exitCode: number; stdout: string; stderr: string } | null>(null);

  const handleRun = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState("running");
    try {
      const resp = await fetch("/api/claw/workspace/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ adoptId, path: filePath }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setResult({ exitCode: 1, stdout: "", stderr: data.error || `HTTP ${resp.status}` });
      } else {
        setResult({ exitCode: data.exitCode, stdout: data.stdout || "", stderr: data.stderr || "" });
      }
    } catch (err) {
      setResult({ exitCode: 1, stdout: "", stderr: String(err) });
    }
    setState("done");
  };

  return (
    <>
      <button
        onClick={handleRun}
        type="button"
        disabled={state === "running"}
        title="在沙箱中运行"
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 8px", borderRadius: "var(--oc-radius-sm)", fontSize: "var(--oc-text-xs)", fontWeight: "var(--oc-weight-medium)",
          color: state === "running" ? "#9ca3af" : "#34d399",
          background: state === "running" ? "rgba(156,163,175,0.08)" : "rgba(52,211,153,0.10)",
          border: `1px solid ${state === "running" ? "rgba(156,163,175,0.2)" : "rgba(52,211,153,0.25)"}`,
          cursor: state === "running" ? "wait" : "pointer",
          whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        {state === "running" ? (
          <><span className="animate-pulse">●</span> 运行中</>
        ) : (
          <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> 运行</>
        )}
      </button>
      {state === "done" && result && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => { setState("idle"); setResult(null); }}
        >
          <div
            style={{
              width: "min(640px, 92vw)", maxHeight: "80vh", background: "var(--oc-panel, #1a1a2e)",
              border: "1px solid var(--oc-border, #333)", borderRadius: "var(--oc-radius-lg)",
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              padding: "12px 16px", borderBottom: "1px solid var(--oc-border, #333)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ fontSize: "var(--oc-text-base)", fontWeight: "var(--oc-weight-semibold)", color: "var(--oc-text-primary, #e5e5e5)" }}>
                运行结果 · {fileName}
                <span style={{
                  marginLeft: 8, fontSize: "var(--oc-text-xs)", padding: "1px 6px", borderRadius: 4,
                  background: result.exitCode === 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  color: result.exitCode === 0 ? "#4ade80" : "#f87171",
                }}>
                  exit {result.exitCode}
                </span>
              </div>
              <button onClick={() => { setState("idle"); setResult(null); }} style={{
                background: "none", border: "none", color: "var(--oc-text-secondary, #999)",
                cursor: "pointer", fontSize: 16, padding: "0 4px",
              }}>×</button>
            </div>
            <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
              {result.stdout && (
                <div style={{ marginBottom: result.stderr ? 12 : 0 }}>
                  <div style={{ fontSize: "var(--oc-text-xs)", color: "var(--oc-text-secondary)", marginBottom: 4 }}>stdout</div>
                  <pre style={{
                    fontSize: "var(--oc-text-sm)", lineHeight: 1.5, color: "var(--oc-text-primary, #e5e5e5)",
                    background: "rgba(0,0,0,0.2)", borderRadius: "var(--oc-radius-md)", padding: 12,
                    whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 400, overflow: "auto",
                    margin: 0,
                  }}>{result.stdout}</pre>
                </div>
              )}
              {result.stderr && (
                <div>
                  <div style={{ fontSize: "var(--oc-text-xs)", color: "var(--oc-danger)", marginBottom: 4 }}>stderr</div>
                  <pre style={{
                    fontSize: "var(--oc-text-sm)", lineHeight: 1.5, color: "#fca5a5",
                    background: "rgba(239,68,68,0.06)", borderRadius: "var(--oc-radius-md)", padding: 12,
                    whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflow: "auto",
                    margin: 0,
                  }}>{result.stderr}</pre>
                </div>
              )}
              {!result.stdout && !result.stderr && (
                <div style={{ fontSize: "var(--oc-text-base)", color: "var(--oc-text-secondary)", textAlign: "center", padding: 24 }}>
                  (无输出)
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatToolArguments(rawArguments: string) {
  let argsDisplay = rawArguments;
  try {
    const parsed = JSON.parse(rawArguments);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {}
  return argsDisplay;
}

function toolResultSnippet(tc: ToolCallEntry): string {
  if (!tc.result || tc.status === "running") return "";
  const text = String(tc.result)
    .replace(/\s+/g, " ")
    .replace(/[{}"]/g, "")
    .trim();
  if (!text) return "";
  return text.length > 78 ? `${text.slice(0, 78)}...` : text;
}

function ToolCallDetailBody({ tc }: { tc: ToolCallEntry }) {
  const isRunning = tc.status === "running";
  const isError = tc.status === "error";
  const argsDisplay = formatToolArguments(tc.arguments);

  return (
    <div className="lingxia-toolcard__body">
      {argsDisplay && (
        <div className="lingxia-toolcard__section">
          <div className="lingxia-toolcard__label">参数</div>
          <pre className="lingxia-toolcard__pre">{argsDisplay}</pre>
        </div>
      )}

      {!isRunning && (
        <div className="lingxia-toolcard__section">
          <div className="lingxia-toolcard__label">{isError ? "错误" : "结果"}</div>
          <pre className="lingxia-toolcard__pre">{tc.result || "(无输出)"}</pre>
        </div>
      )}

      {tc.outputFiles && tc.outputFiles.length > 0 && (
        <div className="lingxia-toolcard__section">
          <div className="lingxia-toolcard__label">产出文件</div>
          <div className="lingxia-toolcard__files">
            {tc.outputFiles.map((f) => {
              const sizeStr =
                f.size > 1024 * 1024
                  ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                  : f.size > 1024
                  ? `${(f.size / 1024).toFixed(1)} KB`
                  : `${f.size} B`;

              const wsPath = (f as any).wsPath as string | undefined;
              const adoptId = tc.adoptId || "";

              const handleDownload = async (e: React.MouseEvent) => {
                e.preventDefault();
                try {
                  const path = wsPath ? wsPath : `sandbox-files/${f.name}`;
                  const resp = await fetch("/api/claw/files/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ adoptId, path }),
                  });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    alert(`下载失败：${err.error || resp.status}`);
                    return;
                  }
                  const { url } = await resp.json();
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = f.name;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                } catch (err) {
                  alert(`下载异常：${String(err)}`);
                }
              };

              const isHtmlFile = /\.html?$/i.test(f.name);
              const isRunnable = /\.(py|js|ts|sh|bash)$/i.test(f.name);

              const handlePreview = async (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  const path = wsPath ? wsPath : `sandbox-files/${f.name}`;
                  const resp = await fetch("/api/claw/files/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ adoptId, path }),
                  });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    alert(`预览失败：${err.error || resp.status}`);
                    return;
                  }
                  const { url } = await resp.json();
                  window.open(url + "&preview=1", "_blank", "noopener");
                } catch (err) {
                  alert(`预览异常：${String(err)}`);
                }
              };

              return (
                <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <a href="#" onClick={handleDownload} className="lingxia-toolcard__file" style={{ flex: 1 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <span>{f.name}</span>
                    <span style={{ opacity: 0.6 }}>({sizeStr})</span>
                  </a>
                  {isHtmlFile && (
                    <button
                      onClick={handlePreview}
                      type="button"
                      title="在新标签页预览"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 3,
                        padding: "2px 8px", borderRadius: "var(--oc-radius-sm)", fontSize: "var(--oc-text-xs)", fontWeight: "var(--oc-weight-medium)",
                        color: "#a78bfa", background: "rgba(124,58,237,0.10)",
                        border: "1px solid rgba(124,58,237,0.25)", cursor: "pointer",
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      预览
                    </button>
                  )}
                  {isRunnable && (
                    <RunFileButton adoptId={adoptId} filePath={wsPath || `sandbox-files/${f.name}`} fileName={f.name} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallEntry }) {
  const isRunning = tc.status === "running";
  const isDone    = tc.status === "done";
  const isError   = tc.status === "error";

  const duration = tc.durationMs != null ? `${tc.durationMs}ms` : null;

  return (
    <details className="lingxia-toolcard" >
      <summary className="lingxia-toolcard__header" style={{ cursor: "pointer", listStyle: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 4, background: isRunning ? "rgba(239,68,68,0.12)" : isDone ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isRunning ? "#ef4444" : isDone ? "#22c55e" : "#ef4444"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </span>
        <span className="lingxia-toolcard__title">{tc.name}</span>
        <span className="lingxia-toolcard__status">
          {isRunning && <span className="animate-pulse">执行中…</span>}
          {isDone    && "✓"}
          {isError   && "✕"}
        </span>
        <div className="lingxia-toolcard__meta">
          {tc.executor === "sandbox" && (
            <span className="lingxia-toolcard__chip lingxia-toolcard__chip--sandbox">沙箱</span>
          )}
          {tc.truncated && (
            <span className="lingxia-toolcard__chip lingxia-toolcard__chip--warn">输出已截断</span>
          )}
          {tc.policyDenyReason && (
            <span className="lingxia-toolcard__chip lingxia-toolcard__chip--danger">安全策略拒绝</span>
          )}
          {duration && <span className="lingxia-toolcard__status">{duration}</span>}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4, opacity: 0.4, transition: "transform 0.2s" }} className="lingxia-toolcard__chevron"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </summary>

      <ToolCallDetailBody tc={tc} />
    </details>
  );
}

function toolCallLabel(tc: ToolCallEntry): string {
  return GATEWAY_TOOL_META[tc.name]?.label || tc.name.replace(/[_-]+/g, " ");
}

function toolCallDurationLabel(tc: ToolCallEntry): string {
  const duration = tc.durationMs ?? (tc.status === "running" ? Date.now() - tc.ts : 0);
  if (!duration || duration < 1000) return "";
  const seconds = Math.round(duration / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function toolCallStatusLabel(status: ToolCallEntry["status"]): string {
  return status === "running" ? "执行中" : status === "error" ? "失败" : "完成";
}

function toolCallSummaryLabel(calls: ToolCallEntry[]): string {
  if (calls.length === 1) {
    const call = calls[0];
    const duration = toolCallDurationLabel(call);
    return [
      toolCallLabel(call),
      toolCallStatusLabel(call.status),
      duration,
      call.outputFiles?.length ? `${call.outputFiles.length} 个文件` : "",
    ].filter(Boolean).join(" · ");
  }

  const running = calls.filter((tc) => tc.status === "running").length;
  const errors = calls.filter((tc) => tc.status === "error").length;
  const done = calls.filter((tc) => tc.status === "done").length;
  const files = calls.reduce((total, tc) => total + (tc.outputFiles?.length || 0), 0);
  return [
    `调用 ${calls.length} 个工具`,
    running ? `${running} 执行中` : "",
    done ? `${done} 完成` : "",
    errors ? `${errors} 失败` : "",
    files ? `${files} 个文件` : "",
  ].filter(Boolean).join(" · ");
}

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCallEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleCalls = toolCalls.filter((tc) => tc?.id && tc?.name);
  if (visibleCalls.length === 0) return null;
  const hasError = visibleCalls.some((tc) => tc.status === "error");
  const hasRunning = visibleCalls.some((tc) => tc.status === "running");

  return (
    <div className="lingxia-tool-timeline-wrap" data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        className={`lingxia-tool-summary ${hasError ? "is-error" : hasRunning ? "is-running" : "is-done"}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="lingxia-tool-summary__dot" aria-hidden="true" />
        <span className="lingxia-tool-summary__text">{toolCallSummaryLabel(visibleCalls)}</span>
        <span className="lingxia-tool-summary__action">{expanded ? "收起" : "详情"}</span>
        <svg className="lingxia-tool-summary__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {expanded ? (
        <div className="lingxia-tool-timeline-panel">
          <div className="lingxia-tool-timeline" aria-label="工具调用记录">
            {visibleCalls.map((tc, index) => {
              const duration = toolCallDurationLabel(tc);
              const snippet = toolResultSnippet(tc);
              const meta = [
                toolCallStatusLabel(tc.status),
                duration,
                tc.outputFiles?.length ? `${tc.outputFiles.length} 个文件` : "",
                snippet,
              ].filter(Boolean).join(" · ");
              const body = (
                <>
                  <span className="lingxia-tool-step__rail" aria-hidden="true">
                    <span className="lingxia-tool-step__dot" />
                    {index < visibleCalls.length - 1 ? <span className="lingxia-tool-step__line" /> : null}
                  </span>
                  <span className="lingxia-tool-step__body">
                    <span className="lingxia-tool-step__title">{toolCallLabel(tc)}</span>
                    <span className="lingxia-tool-step__meta">{meta}</span>
                  </span>
                </>
              );

              if (tc._gateway) {
                return (
                  <div key={tc.id} className={`lingxia-tool-step is-${tc.status}`}>
                    {body}
                  </div>
                );
              }

              return (
                <details key={tc.id} className={`lingxia-tool-step-detail is-${tc.status}`}>
                  <summary className="lingxia-tool-step-summary">
                    {body}
                    <svg className="lingxia-tool-step__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </summary>
                  <div className="lingxia-tool-step-detail__body">
                    <ToolCallDetailBody tc={tc} />
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toolCallsRenderSignature(toolCalls?: ToolCallEntry[]): string {
  if (!toolCalls?.length) return "";
  return toolCalls
    .map((tc) => [
      tc.id,
      tc.name,
      tc.status,
      tc.durationMs ?? "",
      tc.result ? tc.result.length : 0,
      tc.outputFiles?.length ?? 0,
      tc.truncated ? "truncated" : "",
      tc.policyDenyReason || "",
    ].join(":"))
    .join("|");
}

function ChatMessageInner({
  role,
  text,
  isLast,
  isPlaceholder,
  streaming,
  displayName,
  modelId,
  timeLabel,
  toolCalls,
  showToolCalls = true,
  usage,
  contextPercent,
  onDelete,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex items-start gap-3 justify-end lingxia-msg-fade">
        <div className="lingxia-user-bubble">
          <div className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm whitespace-pre-wrap lingxia-user-msg-text lingxia-bubble-user">
            {text}
          </div>
          <p className="text-[10px] mt-1 px-1 text-right" style={{ color: "var(--oc-text-tertiary)" }}>You · {timeLabel}</p>
        </div>
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
          style={{
            marginTop: 2,
            background: "linear-gradient(135deg, #be1e2d, #8b1520)",
            border: "1px solid rgba(190,30,45,0.5)",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
          </svg>
        </div>
      </div>
    );
  }

  if (isPlaceholder) {
    return (
      <div className="flex items-start gap-3 lingxia-ai-bubble-wrap lingxia-msg-fade">
        <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai" style={{ marginTop: 2 }}><BrandIcon size={22} /></div>
        <div>
          {showToolCalls && toolCalls && toolCalls.length > 0 && (
            <div className="mb-2">
              <ToolCallTimeline toolCalls={toolCalls} />
            </div>
          )}
          <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-2 lingxia-bubble-ai" style={{ color: "var(--oc-text-tertiary)" }}>
            <span className="animate-pulse">●</span>
            <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
            <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
          </div>
        </div>
      </div>
    );
  }

  const [copied, setCopied] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const onCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="flex items-start gap-3 lingxia-ai-bubble-wrap lingxia-msg-fade">
      <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai" style={{ marginTop: 2 }}><BrandIcon size={22} /></div>
      <div>
        {showToolCalls && toolCalls && toolCalls.length > 0 && (
          <div className="mb-2">
            <ToolCallTimeline toolCalls={toolCalls} />
          </div>
        )}
        <div className="relative group">
          <div
            className={`relative rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed lingxia-bubble-ai ${(isLast && streaming && text) ? "lingxia-token-active" : ""}`}
          >
            {/* 复制按钮 — 气泡右上角 */}
            {!streaming && text && (
              <div className="lingxia-msg-copy absolute top-2 right-2 z-10 flex items-center gap-0.5">
                <button
                  onClick={onCopyMarkdown}
                  type="button"
                  title="复制"
                  className="lingxia-msg-action-btn"
                  style={{ color: copied ? "#4ade80" : undefined }}
                >
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </button>
              </div>
            )}
            <ChatMarkdown content={text} />
            {isLast && streaming && <span className="animate-pulse ml-0.5" style={{ color: "var(--oc-text-tertiary)" }}>▌</span>}
          </div>
        </div>
        {/* 时间戳行 + 朗读/删除 */}
        <p className="text-[10px] mt-1 px-1 font-mono flex items-center gap-1.5 flex-wrap" style={{ color: "var(--oc-text-tertiary)" }}>
          <span>
            {displayName} · {formatModelName(modelId)} · {timeLabel}
            {usage && usage.input + usage.output > 0 && (
              <> · ↑{usage.input} ↓{usage.output}</>
            )}
            {contextPercent != null && (
              <> · {contextPercent}% ctx</>
            )}
          </span>
          {!streaming && text && (
            <>
              <button
                onClick={() => {
                  if (ttsPlaying) { ttsAudioRef.current?.pause(); setTtsPlaying(false); return; }
                  setTtsPlaying(true);
                  fetch("/api/claw/voice/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: text.slice(0, 2000) }),
                  })
                    .then(r => { if (!r.ok) throw new Error("TTS failed"); return r.blob(); })
                    .then(blob => {
                      const url = URL.createObjectURL(blob);
                      const audio = new Audio(url);
                      ttsAudioRef.current = audio;
                      audio.onended = () => { setTtsPlaying(false); URL.revokeObjectURL(url); };
                      audio.onerror = () => { setTtsPlaying(false); URL.revokeObjectURL(url); };
                      audio.play();
                    })
                    .catch(() => setTtsPlaying(false));
                }}
                type="button"
                title={ttsPlaying ? "停止朗读" : "朗读"}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: ttsPlaying ? "var(--oc-accent)" : "#5f667b", lineHeight: 1 }}
              >
                {ttsPlaying ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                )}
              </button>
              {onDelete && (
                <button
                  onClick={onDelete}
                  type="button"
                  title="删除此消息"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "var(--oc-text-tertiary)", lineHeight: 1 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner, (prev, next) => {
  return (
    prev.role === next.role &&
    prev.text === next.text &&
    prev.isLast === next.isLast &&
    prev.isPlaceholder === next.isPlaceholder &&
    prev.streaming === next.streaming &&
    prev.displayName === next.displayName &&
    prev.modelId === next.modelId &&
    prev.timeLabel === next.timeLabel &&
    prev.showToolCalls === next.showToolCalls &&
    toolCallsRenderSignature(prev.toolCalls) === toolCallsRenderSignature(next.toolCalls) &&
    prev.usage?.input === next.usage?.input &&
    prev.usage?.output === next.usage?.output &&
    prev.contextPercent === next.contextPercent
  );
});
