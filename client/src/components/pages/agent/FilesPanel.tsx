import { ChatMarkdown } from "@/components/ChatMarkdown";
import type { CoreFileMeta } from "./types";

function fmtSize(n: number | null) {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesPanel({
  coreFiles,
  fileFilter,
  setFileFilter,
  refreshAll,
  fileName,
  loadCoreFile,
  fileContent,
  setFileContent,
  saveCoreFile,
  fileSaving,
  fileLoading,
  dirty,
  resetLocal,
  previewOpen,
  setPreviewOpen,
}: {
  coreFiles: CoreFileMeta[];
  fileFilter: string;
  setFileFilter: (v: string) => void;
  refreshAll: () => void;
  fileName: string;
  loadCoreFile: (name: string) => void;
  fileContent: string;
  setFileContent: (v: string) => void;
  saveCoreFile: () => void;
  fileSaving: boolean;
  fileLoading: boolean;
  dirty: boolean;
  resetLocal: () => void;
  previewOpen: boolean;
  setPreviewOpen: (v: boolean) => void;
}) {
  const filteredFiles = coreFiles.filter((f) => f.name.toLowerCase().includes(fileFilter.trim().toLowerCase()));
  const currentMeta = coreFiles.find((f) => f.name === fileName) || null;
  const isMarkdown = /\.md$/i.test(fileName);
  const isReadOnly = fileName === "DREAMS.md";

  return (
    <>
      <div className="grid gap-3 agent-files-layout" style={{ gridTemplateColumns: "320px 1fr" }}>
        <div className="settings-card agent-file-list">
          <div className="flex items-center gap-2 mb-2">
            <input value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="搜索文件" className="settings-input px-2 py-1 text-xs w-full" />
            <button className="skills-btn" onClick={refreshAll}>Refresh</button>
          </div>
          <div className="space-y-1">
            {filteredFiles.map((f) => (
              <button key={f.name} onClick={() => loadCoreFile(f.name)} className="w-full text-left rounded px-2 py-1 agent-file-item"
                style={{
                  border: "1px solid var(--oc-border)",
                  background: fileName === f.name ? "rgba(158,24,34,0.18)" : "rgba(255,255,255,0.02)",
                  color: "var(--oc-text-secondary)",
                }}>
                <div className="text-xs" style={{ color: "var(--oc-text-primary)" }}>{f.name}{f.name === "DREAMS.md" && <span style={{ marginLeft: 6, fontSize: 10, color: "#a78bfa", fontWeight: 500 }}>梦境日记</span>}</div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>workspace/{f.name}</div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{fmtSize(f.size)} {f.updatedAt ? `· ${new Date(f.updatedAt).toLocaleString()}` : ""}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-card agent-file-detail">
          <div className="flex items-center justify-between mb-2 agent-file-toolbar">
            <div>
              <div className="text-sm" style={{ color: "var(--oc-text-primary)", fontWeight: 600 }}>{fileName || "选择文件"}</div>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>workspace/{fileName}</div>
              {currentMeta && <div className="text-[10px]" style={{ color: "var(--muted)" }}>{fmtSize(currentMeta.size)} {currentMeta.updatedAt ? `· ${new Date(currentMeta.updatedAt).toLocaleString()}` : ""}</div>}
            </div>
            <div className="flex items-center gap-2">
              <button className="skills-btn" onClick={refreshAll}>Refresh</button>
              <button className="skills-btn" onClick={() => setPreviewOpen(true)} disabled={!isMarkdown}>Preview</button>
              <button className="skills-btn" onClick={resetLocal} disabled={!dirty}>Reset</button>
              <button className="btn-primary-soft" onClick={saveCoreFile} disabled={fileSaving || fileLoading || !dirty || isReadOnly}>{fileSaving ? "保存中…" : isReadOnly ? "只读" : "Save"}</button>
            </div>
          </div>

          {fileLoading ? (
            <div className="rounded p-3 text-xs" style={{ border: "1px solid var(--oc-border)", color: "var(--muted)", minHeight: 280 }}>Loading file content...</div>
          ) : (
            <textarea
              value={fileContent}
              onChange={(e) => { if (!isReadOnly) setFileContent(e.target.value); }}
              readOnly={isReadOnly}
              rows={18}
              className="w-full rounded p-2 text-xs font-mono agent-file-editor"
              style={{
                border: "1px solid var(--oc-border)",
                background: "var(--input)",
                color: "var(--oc-text-primary)",
                minHeight: 360,
                height: "clamp(360px, 52vh, 760px)",
                resize: "vertical",
              }}
            />
          )}

          <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>{fileLoading ? "读取中…" : isReadOnly ? "由 Dreaming 系统自动生成（只读）" : dirty ? "有未保存改动" : "已同步"}</div>
        </div>
      </div>

      {previewOpen && isMarkdown && (
        <div className="preview-modal" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000 }} onClick={() => setPreviewOpen(false)}>
          <div className="preview-modal__body" style={{ width: "min(980px, 92vw)", height: "min(82vh, 820px)", margin: "5vh auto", background: "var(--oc-panel)", border: "1px solid var(--oc-border)", borderRadius: 12, display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--oc-border)" }}>
              <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Preview · {fileName}</div>
              <button className="skills-btn" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
            <div className="sidebar-markdown" style={{ padding: 16, overflow: "auto" }}>
              <ChatMarkdown content={fileContent || ""} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
