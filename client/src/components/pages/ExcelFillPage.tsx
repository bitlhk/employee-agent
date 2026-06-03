import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clipboard, Download, FileSpreadsheet, FileText, History, Plus, Send, Upload, Wand2, X } from "lucide-react";

type ExcelFillPageProps = {
  adoptId: string;
  onBack?: () => void;
};

type UploadedOfficeFile = {
  name: string;
  path: string;
  size: number;
};

type ExcelFillRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "planned" | "completed" | "error";
  workbookPath: string;
  contextPaths: string[];
  instruction: string;
  planPath?: string;
  resultPath?: string;
  resultNotePath?: string;
  plan?: string;
  resultSummary?: string;
  planUrl?: string;
  resultUrl?: string;
  resultNoteUrl?: string;
};

type ExcelStatus = "idle" | "uploading" | "planning" | "applying" | "error";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const WORKBOOK_ACCEPT = ".xlsx,.xls";
const CONTEXT_ACCEPT = ".pdf,.docx,.xlsx,.xls,.pptx,.txt,.md,.csv,.json,image/*";
const QUICK_REQUIREMENTS = [
  "只补空白，不覆盖已有内容；资料不足的字段留空并列出原因。",
  "先按字段映射填写，所有建议都要标注依据来源和置信度。",
  "适合客户资料表：补全企业基本信息、联系人、需求背景和风险提示。",
  "适合项目台账：补全负责人、截止时间、状态、下一步动作。",
];

function makeTaskId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",").pop() || "" : value);
    };
    reader.onerror = () => reject(reader.error || new Error("read file failed"));
    reader.readAsDataURL(file);
  });
}

function buildMarkdown(record: ExcelFillRecord) {
  return [
    `# ${record.title || "Excel 填表"}`,
    "",
    `- 时间：${new Date(record.createdAt).toLocaleString()}`,
    `- Excel：${record.workbookPath}`,
    ...(record.contextPaths || []).map((item) => `- 背景资料：${item}`),
    "",
    "## 填写要求",
    "",
    record.instruction || "暂无",
    "",
    "## 填表方案",
    "",
    record.plan || "暂无",
    "",
    "## 写回结果",
    "",
    record.resultSummary || "暂无",
    "",
  ].join("\n");
}

export function ExcelFillPage({ adoptId, onBack }: ExcelFillPageProps) {
  const [taskId, setTaskId] = useState(makeTaskId);
  const [status, setStatus] = useState<ExcelStatus>("idle");
  const [error, setError] = useState("");
  const [workbook, setWorkbook] = useState<UploadedOfficeFile | null>(null);
  const [contexts, setContexts] = useState<UploadedOfficeFile[]>([]);
  const [instruction, setInstruction] = useState("");
  const [current, setCurrent] = useState<ExcelFillRecord | null>(null);
  const [records, setRecords] = useState<ExcelFillRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");

  const workbookInputRef = useRef<HTMLInputElement | null>(null);
  const contextInputRef = useRef<HTMLInputElement | null>(null);
  const instructionInputRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = status === "uploading" || status === "planning" || status === "applying";

  const filteredRecords = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter((item) => [
      item.title,
      item.workbookPath,
      item.instruction,
      item.plan,
      item.resultSummary,
    ].some((value) => String(value || "").toLowerCase().includes(q)));
  }, [historyQuery, records]);

  const loadRecords = useCallback(async () => {
    if (!adoptId) return;
    try {
      const resp = await fetch(`/api/claw/office/excel-fill/list?adoptId=${encodeURIComponent(adoptId)}`, { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json();
      const items = Array.isArray(data.records) ? data.records : [];
      setRecords(items);
    } catch {}
  }, [adoptId]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const uploadToWorkspace = useCallback(async (file: File): Promise<UploadedOfficeFile> => {
    if (file.size <= 0) throw new Error("文件为空");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("文件超过 50MB，请先压缩或拆分");
    const contentBase64 = await fileToBase64(file);
    const resp = await fetch("/api/claw/files/upload", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adoptId,
        path: `office/excel-fill/${taskId}/inputs`,
        filename: file.name,
        contentBase64,
      }),
    });
    if (!resp.ok) {
      const payload = await resp.json().catch(() => ({}));
      throw new Error(payload.error || `上传失败 (${resp.status})`);
    }
    const payload = await resp.json();
    return { name: file.name, path: payload.path, size: Number(payload.size || file.size) };
  }, [adoptId, taskId]);

  const handleWorkbook = useCallback(async (file: File) => {
    if (busy) return;
    setStatus("uploading");
    setError("");
    try {
      const uploaded = await uploadToWorkspace(file);
      setWorkbook(uploaded);
      setCurrent(null);
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [busy, uploadToWorkspace]);

  const handleContexts = useCallback(async (files: File[]) => {
    if (busy || files.length === 0) return;
    setStatus("uploading");
    setError("");
    try {
      const uploaded: UploadedOfficeFile[] = [];
      for (const file of files) uploaded.push(await uploadToWorkspace(file));
      setContexts((prev) => [...prev, ...uploaded].slice(0, 12));
      setCurrent(null);
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [busy, uploadToWorkspace]);

  const startNewTask = useCallback(() => {
    if (busy) return;
    setTaskId(makeTaskId());
    setStatus("idle");
    setError("");
    setWorkbook(null);
    setContexts([]);
    setInstruction("");
    setCurrent(null);
  }, [busy]);

  const selectRecord = useCallback((record: ExcelFillRecord) => {
    setCurrent(record);
    setTaskId(record.id);
    setWorkbook({ name: record.workbookPath.split("/").pop() || "workbook.xlsx", path: record.workbookPath, size: 0 });
    setContexts((record.contextPaths || []).map((item) => ({ name: item.split("/").pop() || item, path: item, size: 0 })));
    setInstruction(record.instruction || "");
    setStatus("idle");
    setError("");
    setHistoryOpen(false);
  }, []);

  const createPlan = useCallback(async () => {
    if (!workbook || busy) return;
    setStatus("planning");
    setError("");
    try {
      const resp = await fetch(`/api/claw/office/excel-fill/plan?adoptId=${encodeURIComponent(adoptId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          workbookPath: workbook.path,
          contextPaths: contexts.map((item) => item.path),
          instruction,
        }),
      });
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload.error || `生成填表方案失败 (${resp.status})`);
      }
      const payload = await resp.json();
      const record = payload.record as ExcelFillRecord;
      setCurrent(record);
      setRecords((prev) => [record, ...prev.filter((item) => item.id !== record.id)].slice(0, 100));
      setStatus("idle");
      void loadRecords();
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [adoptId, busy, contexts, instruction, loadRecords, taskId, workbook]);

  const applyPlan = useCallback(async () => {
    if (!current || busy) return;
    setStatus("applying");
    setError("");
    try {
      const resp = await fetch(`/api/claw/office/excel-fill/apply?adoptId=${encodeURIComponent(adoptId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: current.id }),
      });
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload.error || `写回 Excel 失败 (${resp.status})`);
      }
      const payload = await resp.json();
      const record = payload.record as ExcelFillRecord;
      setCurrent(record);
      setRecords((prev) => [record, ...prev.filter((item) => item.id !== record.id)].slice(0, 100));
      setStatus("idle");
      void loadRecords();
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [adoptId, busy, current, loadRecords]);

  const copyCurrent = useCallback(async () => {
    if (!current) return;
    await navigator.clipboard.writeText(buildMarkdown(current));
  }, [current]);

  const useQuickRequirement = useCallback((text: string) => {
    if (busy) return;
    setInstruction(text);
    window.setTimeout(() => instructionInputRef.current?.focus(), 0);
  }, [busy]);

  return (
    <main className="h-full min-h-0 overflow-y-auto stealth-scrollbar" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>
      <div className="max-w-6xl mx-auto px-5 py-5 space-y-4">
        <section className="settings-card" style={{ padding: 18 }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {onBack ? (
                  <button
                    type="button"
                    onClick={onBack}
                    title="返回办公空间"
                    className="inline-flex items-center justify-center rounded-md p-1.5"
                    style={{ color: "var(--oc-text-secondary)", border: "1px solid var(--oc-border)", background: "var(--oc-panel)" }}
                  >
                    <ArrowLeft size={15} />
                  </button>
                ) : null}
                <FileSpreadsheet size={18} style={{ color: "var(--oc-accent)" }} />
                <h2 className="text-base font-semibold">Excel 填表</h2>
              </div>
              <p className="mt-2 text-sm leading-6" style={{ color: "var(--oc-text-secondary)" }}>
                上传 Excel 和背景资料，先生成可审核的填表方案，确认后再写回 Excel 副本。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={startNewTask}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--oc-panel)",
                  border: "1px solid var(--oc-border)",
                  color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)",
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                <Plus size={15} />
                新任务
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}
              >
                <History size={15} />
                历史
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
          <div className="settings-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2 mb-4">
              <Upload size={16} style={{ color: "var(--oc-text-secondary)" }} />
              <h3 className="text-sm font-semibold">文件上下文</h3>
            </div>
            <input
              ref={workbookInputRef}
              type="file"
              accept={WORKBOOK_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void handleWorkbook(file);
              }}
            />
            <input
              ref={contextInputRef}
              type="file"
              accept={CONTEXT_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files || []);
                event.currentTarget.value = "";
                void handleContexts(files);
              }}
            />
            <div className="space-y-3">
              <div className="rounded-md p-3" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Excel 文件</div>
                    <div className="mt-1 truncate text-xs" style={{ color: workbook ? "var(--oc-text-secondary)" : "var(--oc-text-tertiary)" }}>
                      {workbook ? `${workbook.name} · ${workbook.size ? formatFileSize(workbook.size) : workbook.path}` : "上传需要填写的 .xlsx/.xls"}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => workbookInputRef.current?.click()}
                    className="shrink-0 rounded-md px-3 py-2 text-sm"
                    style={{
                      background: "var(--oc-bg-surface)",
                      border: "1px solid var(--oc-border)",
                      color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)",
                    }}
                  >
                    上传
                  </button>
                </div>
              </div>

              <div className="rounded-md p-3" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">背景资料</div>
                    <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>客户资料、需求说明、历史表格、PDF 或文档</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => contextInputRef.current?.click()}
                    className="shrink-0 rounded-md px-3 py-2 text-sm"
                    style={{
                      background: "var(--oc-bg-surface)",
                      border: "1px solid var(--oc-border)",
                      color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)",
                    }}
                  >
                    添加
                  </button>
                </div>
                {contexts.length ? (
                  <div className="mt-3 space-y-2">
                    {contexts.map((file) => (
                      <div key={file.path} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs" style={{ background: "var(--oc-bg-surface)", color: "var(--oc-text-secondary)" }}>
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setContexts((prev) => prev.filter((item) => item.path !== file.path))}
                          className="shrink-0"
                          style={{ color: "var(--oc-text-tertiary)" }}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="settings-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2 mb-4">
              <Wand2 size={16} style={{ color: "var(--oc-text-secondary)" }} />
              <h3 className="text-sm font-semibold">填写要求</h3>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_REQUIREMENTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={busy}
                  onClick={() => useQuickRequirement(item)}
                  className="rounded-md px-3 py-1.5 text-xs"
                  style={{
                    background: "var(--oc-panel)",
                    border: "1px solid var(--oc-border)",
                    color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)",
                  }}
                >
                  {item.slice(0, 18)}
                </button>
              ))}
            </div>
            <textarea
              ref={instructionInputRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={busy}
              rows={8}
              placeholder="例如：根据客户资料补全空白字段，不覆盖已有内容；无法判断的字段列入人工确认清单。"
              className="w-full rounded-md px-3 py-2 text-sm resize-none"
              style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!workbook || busy}
                onClick={() => void createPlan()}
                className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
                style={{
                  background: "var(--oc-accent)",
                  border: "1px solid var(--oc-accent)",
                  color: "white",
                  opacity: !workbook || busy ? 0.55 : 1,
                  cursor: !workbook || busy ? "not-allowed" : "pointer",
                }}
              >
                <Send size={15} />
                生成填表方案
              </button>
              <span className="text-xs" style={{ color: status === "error" ? "var(--banking-danger)" : "var(--oc-text-tertiary)" }}>
                {status === "uploading" ? "上传文件中" : status === "planning" ? "正在生成方案" : status === "applying" ? "正在写回副本" : error || "空闲"}
              </span>
            </div>
          </div>
        </section>

        <section className="settings-card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText size={16} style={{ color: "var(--oc-text-secondary)" }} />
                <h3 className="text-sm font-semibold">填表方案预览</h3>
              </div>
              {current ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                  <span className="truncate">{current.title}</span>
                  <span>{new Date(current.updatedAt || current.createdAt).toLocaleString()}</span>
                  <span>{current.status === "completed" ? "已写回" : "待确认"}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void copyCurrent()} disabled={!current} title="复制方案" className="lingxia-toolbar-icon">
                <Clipboard size={15} />
              </button>
              {current?.planUrl ? (
                <a title="下载方案" href={current.planUrl} className="lingxia-toolbar-icon inline-flex items-center justify-center">
                  <Download size={15} />
                </a>
              ) : null}
            </div>
          </div>
          <div
            className="rounded-md min-h-[320px] p-4 text-sm leading-7 whitespace-pre-wrap overflow-y-auto stealth-scrollbar"
            style={{
              background: "var(--oc-panel)",
              border: "1px solid var(--oc-border)",
              color: current?.plan ? "var(--oc-text-primary)" : "var(--oc-text-tertiary)",
            }}
          >
            {status === "planning" ? "正在读取表格和资料，生成填表方案..." : current?.plan || "上传 Excel 后生成填表方案。这里会先展示建议填写项、依据来源和需人工确认的问题。"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!current?.plan || busy}
              onClick={() => void applyPlan()}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
              style={{
                background: "color-mix(in oklab, var(--oc-accent) 16%, transparent)",
                border: "1px solid color-mix(in oklab, var(--oc-accent) 28%, var(--oc-border))",
                color: "var(--oc-accent)",
                opacity: !current?.plan || busy ? 0.55 : 1,
                cursor: !current?.plan || busy ? "not-allowed" : "pointer",
              }}
            >
              <FileSpreadsheet size={15} />
              确认写回 Excel 副本
            </button>
            {current?.resultUrl ? <a className="text-sm" style={{ color: "var(--oc-accent)" }} href={current.resultUrl}>下载填好后的 Excel</a> : null}
            {current?.resultNoteUrl ? <a className="text-sm" style={{ color: "var(--oc-accent)" }} href={current.resultNoteUrl}>下载处理说明</a> : null}
            {current?.resultSummary ? <span className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>已生成处理说明</span> : null}
          </div>
        </section>
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={() => setHistoryOpen(false)}>
          <aside
            className="h-full w-full max-w-[420px] overflow-y-auto p-4 shadow-xl stealth-scrollbar"
            style={{ background: "var(--oc-bg-surface)", borderLeft: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Excel 填表历史</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>选择一个任务继续处理或下载结果</p>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="lingxia-toolbar-icon" title="关闭">
                <X size={16} />
              </button>
            </div>
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="搜索任务"
              className="mt-4 w-full rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}
            />
            <div className="mt-4 space-y-2">
              {filteredRecords.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectRecord(item)}
                  className="w-full rounded-md p-3 text-left"
                  style={{
                    background: current?.id === item.id ? "color-mix(in oklab, var(--oc-accent) 10%, var(--oc-panel))" : "var(--oc-panel)",
                    border: "1px solid var(--oc-border)",
                    color: "var(--oc-text-primary)",
                  }}
                >
                  <div className="truncate text-sm font-medium">{item.title}</div>
                  <div className="mt-1 truncate text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                    {new Date(item.updatedAt || item.createdAt).toLocaleString()} · {item.status === "completed" ? "已写回" : "待确认"}
                  </div>
                </button>
              ))}
              {!filteredRecords.length ? (
                <div className="rounded-md p-4 text-sm" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-tertiary)" }}>
                  暂无 Excel 填表任务
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
