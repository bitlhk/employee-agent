import { useState, useRef, useEffect, useCallback } from "react";
import { Code2, ChevronLeft, Loader2, Send, FolderOpen, Download, Trash2, X } from "lucide-react";
import { ChatMarkdown } from "../ChatMarkdown";
import { CodeBlock } from "./CodeBlock";
import { ToolCallCard } from "./ToolCallCard";
import "./code-agent.css";

interface CodeAgentMessage {
  role: "user" | "assistant";
  text: string;
  status?: string;
  toolCalls?: Array<{ name: string; args?: string; status: "running" | "done" | "error" }>;
}

interface FileItem {
  name: string;
  size: number;
  mtime?: string;
  path?: string;
}

interface CodeAgentViewProps {
  agent: { id: string; name: string; description?: string | null };
  apiBase: string;
  onBack: () => void;
}

function parseToolStatus(status: string): { name: string; args: string } | null {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower.includes("read") || lower.includes("reading"))
    return { name: "read", args: status.replace(/^.*?(reading|read)\s*/i, "") };
  if (lower.includes("exec") || lower.includes("bash") || lower.includes("running"))
    return { name: "exec", args: status.replace(/^.*?(executing|running)\s*/i, "") };
  if (lower.includes("writ") || lower.includes("edit"))
    return { name: "write", args: status.replace(/^.*?(writing|editing)\s*/i, "") };
  if (lower.includes("search") || lower.includes("grep") || lower.includes("glob"))
    return { name: "search", args: status.replace(/^.*?(searching|grep|glob)\s*/i, "") };
  if (lower.includes("think"))
    return { name: "think", args: "" };
  return { name: "tool", args: status };
}

function getSessionKey(agentId: string): string {
  const storageKey = `ca-session-${agentId}`;
  const stored = sessionStorage.getItem(storageKey);
  if (stored) {
    const { key, ts } = JSON.parse(stored);
    if (Date.now() - ts < 30 * 60 * 1000) return key;
  }
  const key = crypto.randomUUID();
  sessionStorage.setItem(storageKey, JSON.stringify({ key, ts: Date.now() }));
  return key;
}

function parseFilesFromText(text: string): { cleaned: string; files: string[] } {
  const match = text.match(/<!--\s*__files:\s*(\[.*?\])\s*-->/s);
  if (!match) return { cleaned: text, files: [] };
  try {
    const files = JSON.parse(match[1]);
    return { cleaned: text.replace(match[0], "").trim(), files };
  } catch {
    return { cleaned: text, files: [] };
  }
}

export function CodeAgentView({ agent, apiBase, onBack }: CodeAgentViewProps) {
  const [messages, setMessages] = useState<CodeAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch(`${apiBase}/api/claw/business-files?agentId=${agent.id}`);
      if (res.ok) { const d = await res.json(); setFiles(d.files || []); }
    } catch { /* ignore */ }
    setLoadingFiles(false);
  }, [apiBase, agent.id]);

  const downloadFile = useCallback((fileName: string) => {
    const url = `${apiBase}/api/claw/business-files/download?agentId=${agent.id}&file=${encodeURIComponent(fileName)}`;
    window.open(url, "_blank");
  }, [apiBase, agent.id]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const userMsg: CodeAgentMessage = { role: "user", text };
    setMessages(prev => [...prev, userMsg]);

    const sessionKey = getSessionKey(agent.id);
    const assistantMsg: CodeAgentMessage = { role: "assistant", text: "", toolCalls: [] };
    setMessages(prev => [...prev, assistantMsg]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${apiBase}/api/claw/business-chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Key": sessionKey },
        body: JSON.stringify({ agentId: agent.id, message: text, sessionKey }),
        signal: ctrl.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let toolCalls: CodeAgentMessage["toolCalls"] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            if (chunk.error) {
              accumulated += `\n\n**Error:** ${chunk.error}`;
            } else if (chunk.__status) {
              // Finalize previous running tool calls
              toolCalls = (toolCalls || []).map(tc =>
                tc.status === "running" ? { ...tc, status: "done" as const } : tc
              );
              const parsed = parseToolStatus(chunk.__status);
              if (parsed) {
                toolCalls = [...toolCalls, { name: parsed.name, args: parsed.args, status: "running" }];
              }
            } else if (chunk.choices?.[0]?.delta?.content) {
              accumulated += chunk.choices[0].delta.content;
            }
          } catch { /* skip malformed */ }
        }

        // Finalize tool calls in last update
        const finalTools = (toolCalls || []).map(tc =>
          tc.status === "running" ? tc : tc
        );
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", text: accumulated, toolCalls: finalTools };
          return next;
        });
      }

      // Mark all remaining tools as done
      toolCalls = (toolCalls || []).map(tc =>
        tc.status === "running" ? { ...tc, status: "done" as const } : tc
      );
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", text: accumulated, toolCalls };
        return next;
      });

      // Refresh file list after response completes
      fetchFiles();
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", text: "Connection error. Please try again." };
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, agent.id, apiBase, fetchFiles]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    const storageKey = `ca-session-${agent.id}`;
    sessionStorage.removeItem(storageKey);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="ca-root">
      {/* Header */}
      <div className="ca-header">
        <button className="ca-header-back" onClick={onBack}><ChevronLeft size={18} /></button>
        <Code2 size={18} className="ca-header-icon" />
        <span className="ca-header-title">{agent.name}</span>
        <div className="ca-header-actions">
          <button className="ca-icon-btn" onClick={() => { setShowFiles(v => !v); if (!showFiles) fetchFiles(); }}
            title="Files"><FolderOpen size={16} /></button>
          <button className="ca-icon-btn" onClick={clearChat} title="Clear"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="ca-body">
        {/* Chat area */}
        <div className="ca-chat">
          <div className="ca-messages">
            {isEmpty && (
              <div className="ca-welcome">
                <Code2 size={40} className="ca-welcome-icon" />
                <h3>{agent.name}</h3>
                {agent.description && <p>{agent.description}</p>}
                <p className="ca-welcome-hint">Describe a task to get started.</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`ca-msg ca-msg-${msg.role}`}>
                {msg.role === "assistant" && msg.toolCalls?.map((tc, j) => (
                  <ToolCallCard key={j} toolName={tc.name} args={tc.args} status={tc.status} />
                ))}
                <div className="ca-msg-bubble">
                  {msg.role === "assistant" ? (
                    <ChatMarkdown content={parseFilesFromText(msg.text).cleaned} />
                  ) : (
                    <span>{msg.text}</span>
                  )}
                  {msg.role === "assistant" && streaming && i === messages.length - 1 && !msg.text && (
                    <Loader2 size={16} className="ca-spinner" />
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="ca-input-area">
            <textarea
              ref={textareaRef}
              className="ca-input"
              rows={1}
              placeholder="Describe your task..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
            />
            <button className="ca-send-btn" onClick={sendMessage} disabled={streaming || !input.trim()}>
              {streaming ? <Loader2 size={16} className="ca-spinner" /> : <Send size={16} />}
            </button>
          </div>
        </div>

        {/* Files panel */}
        {showFiles && (
          <div className="ca-files">
            <div className="ca-files-header">
              <span>Files</span>
              <button className="ca-icon-btn" onClick={() => setShowFiles(false)}><X size={14} /></button>
            </div>
            <div className="ca-files-list">
              {loadingFiles && <Loader2 size={16} className="ca-spinner ca-files-loading" />}
              {!loadingFiles && files.length === 0 && (
                <p className="ca-files-empty">No files yet.</p>
              )}
              {files.map((f, i) => (
                <div key={i} className="ca-file-row">
                  <span className="ca-file-name" title={f.path || f.name}>{f.name}</span>
                  <button className="ca-icon-btn" onClick={() => downloadFile(f.name)} title="Download">
                    <Download size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
