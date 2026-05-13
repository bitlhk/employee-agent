/**
 * AgentTaskCard.tsx — Agent Team 任务卡片
 *
 * 显示 PM 分派的子任务执行状态：
 * - 标题栏：agent 名字 + 状态（执行中/完成）
 * - 进度区：工具调用逐行叠加（✅ done / ⚙️ running）
 * - 结果区：完成后可展开查看 markdown 渲染的完整结果
 */
import { useState } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";

export interface AgentToolStep {
  name: string;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export interface AgentTask {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  status: "running" | "done";
  steps: AgentToolStep[];
  result?: string;
  durationMs?: number;
}

export function AgentTaskCard({ task }: { task: AgentTask }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = task.status === "done";

  return (
    <div style={{
      margin: "6px 0",
      borderRadius: 12,
      border: `1px solid ${isDone ? "rgba(34,197,94,0.2)" : "rgba(99,102,241,0.2)"}`,
      background: isDone ? "rgba(34,197,94,0.03)" : "rgba(99,102,241,0.03)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div
        onClick={() => isDone && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          cursor: isDone ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 15 }}>{isDone ? "\u2705" : "\u23f3"}</span>
        <span style={{
          fontWeight: 600,
          fontSize: 13,
          color: "var(--oc-text-primary)",
          flex: 1,
        }}>
          {task.agentName}
        </span>
        {isDone && task.durationMs && (
          <span style={{ fontSize: 11, color: "var(--oc-text-secondary)", opacity: 0.6 }}>
            {(task.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {isDone && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0)" }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
        {!isDone && (
          <span style={{ fontSize: 11, color: "#818cf8", animation: "pulse 1.5s ease-in-out infinite" }}>
            \u6267\u884c\u4e2d...
          </span>
        )}
      </div>

      {/* Steps progress */}
      {task.steps.length > 0 && (
        <div style={{ padding: "0 14px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
          {task.steps.map((step, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: step.status === "running" ? "#818cf8" : "var(--oc-text-secondary)",
              opacity: step.status === "running" ? 1 : 0.6,
            }}>
              <span style={{ fontSize: 10, width: 14, textAlign: "center" }}>
                {step.status === "running" ? "\u2699\ufe0f" : step.status === "done" ? "\u2705" : "\u274c"}
              </span>
              <span style={{ fontFamily: "monospace" }}>{step.name}</span>
              {step.durationMs != null && (
                <span style={{ opacity: 0.5, marginLeft: "auto" }}>{(step.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expanded result */}
      {expanded && task.result && (
        <div style={{
          borderTop: "1px solid var(--oc-border)",
          padding: "12px 14px",
          fontSize: 13,
          maxHeight: 400,
          overflowY: "auto",
        }}>
          <ChatMarkdown content={task.result} />
        </div>
      )}
    </div>
  );
}
