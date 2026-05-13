/**
 * WorkspacePage — agent workspace file browser (per-adoptId).
 *
 * Reads from /api/claw/files/list, supports inline preview + download.
 * Renders runtime-aware via /api/claw/files/capabilities (rule 5).
 *
 * MVP scope: list / preview / download. Upload + delete coming next.
 */
import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/console/PageContainer";
import { Folder, FileText, Download, Eye, RefreshCw, ChevronRight, Loader2, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FileNode = { name: string; path: string; type: "file" | "directory"; size?: number; modifiedAt?: string };
type Capabilities = { supportsList: boolean; supportsRead: boolean; supportsDownload: boolean; supportsUpload: boolean; supportsDelete: boolean; maxUploadBytes: number };
type ListResp = { runtime: string; capabilities: Capabilities; files: FileNode[] };

// Parse response safely: 当上游反代（nginx 413/502 等）返回 HTML 错误页时，
// 避免 r.json() 抛 "Unexpected token '<'"，改为提取可读信息。
async function readResponse(r: Response): Promise<{ data: any; errorText: string | null }> {
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return { data: await r.json(), errorText: null };
    } catch {
      return { data: null, errorText: `响应解析失败 (${r.status})` };
    }
  }
  const text = (await r.text().catch(() => "")).trim();
  const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
  const preview = titleMatch ? titleMatch[1] : (text.slice(0, 80) || r.statusText || "unknown");
  return { data: null, errorText: `${r.status} ${preview}` };
}

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function isPreviewable(name: string): boolean {
  const lower = name.toLowerCase();
  return /\.(md|txt|json|yaml|yml|csv|log|py|js|ts|tsx|jsx|html|css|sql|sh|xml|toml|ini|conf)$/.test(lower);
}

export function WorkspacePage({ adoptId }: { adoptId: string }) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [runtime, setRuntime] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<{ name: string; path: string; content: string; modifiedAt?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [currentPath, setCurrentPath] = useState<string>("");  // workspace-relative current dir, "" = root
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);

  const load = async () => {
    if (!adoptId) return;
    setLoading(true);
    setError("");
    try {
      // 2026-04-20 review fix: 带 currentPath 给后端, 避免深层目录被 MAX_LIST_DEPTH=4 裁剪
      const params = new URLSearchParams({ adoptId });
      if (currentPath) params.set("path", currentPath);
      const r = await fetch("/api/claw/files/list?" + params.toString(), { credentials: "include" });
      if (!r.ok) throw new Error("list " + r.status);
      const d: ListResp = await r.json();
      setFiles(d.files || []);
      setCaps(d.capabilities);
      setRuntime(d.runtime);
    } catch (e: any) {
      setError(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [adoptId, currentPath]);

  const previewFile = async (file: FileNode) => {
    if (!isPreviewable(file.name)) return;
    setPreviewLoading(true);
    try {
      const r = await fetch(`/api/claw/files/read?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(file.path)}`, { credentials: "include" });
      if (!r.ok) throw new Error(`read ${r.status}`);
      const d: any = await r.json();
      setPreviewing({ name: file.name, path: file.path, content: d.content || "", modifiedAt: d.modifiedAt });
    } catch (e: any) {
      setError(e?.message || "预览失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadUrl = (file: FileNode) => `/api/claw/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(file.path)}`;

  const uploadFile = async (file: File) => {
    if (!caps?.supportsUpload) return;
    if (file.size > caps.maxUploadBytes) {
      setUploadError(`文件超大 (${(file.size / 1024 / 1024).toFixed(1)}MB > ${caps.maxUploadBytes / 1024 / 1024}MB)`);
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const buf = await file.arrayBuffer();
      // Base64 encode (chunked for large files)
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const r = await fetch("/api/claw/files/upload", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adoptId,
          path: currentPath || undefined,
          filename: file.name,
          contentBase64: base64,
        }),
      });
      const { data: d, errorText } = await readResponse(r);
      if (!r.ok) {
        setUploadError(d?.error || errorText || `upload ${r.status}`);
        return;
      }
      await load();
    } catch (e: any) {
      setUploadError(e?.message || "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const requestDeleteFile = (file: FileNode) => {
    if (!caps?.supportsDelete) return;
    setDeleteTarget(file);
  };

  const deleteFile = async (file: FileNode) => {
    if (!caps?.supportsDelete) return;
    try {
      const r = await fetch("/api/claw/files/delete", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId, path: file.path }),
      });
      const { data: d, errorText } = await readResponse(r);
      if (!r.ok) {
        setError(d?.error || errorText || `delete ${r.status}`);
        return;
      }
      await load();
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "delete failed");
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadFile(f);
    e.target.value = "";  // reset so same file can be re-picked
  };

  // 当前目录下的直接子项（不含孙子辈）+ dir 在前 + 文件按修改时间倒序
  const sorted = useMemo(() => {
    const prefix = currentPath ? currentPath + "/" : "";
    const filtered = files.filter((f) => {
      if (currentPath === "" ) return !f.path.includes("/");                       // root: 不含斜杠
      if (!f.path.startsWith(prefix)) return false;                                  // 必须在 currentPath 下
      return !f.path.slice(prefix.length).includes("/");                            // 不是孙子辈
    });
    return filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      const ta = a.modifiedAt || "";
      const tb = b.modifiedAt || "";
      return tb.localeCompare(ta);
    });
  }, [files, currentPath]);

  // 面包屑路径段
  const crumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split("/");
    return parts.map((seg, i) => ({ name: seg, path: parts.slice(0, i + 1).join("/") }));
  }, [currentPath]);

  return (
    <PageContainer title="工作空间">
      <div className="flex items-center gap-2 mb-3">
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5 lingxia-soft-action">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          刷新
        </Button>
        {caps?.supportsUpload && (
          <label className="inline-flex">
            <input type="file" className="hidden" onChange={handleFilePick} disabled={uploading} />
            <Button size="sm" variant="outline" disabled={uploading} className="gap-1.5 lingxia-soft-action" asChild>
              <span>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? "上传中" : "上传文件"}
              </span>
            </Button>
          </label>
        )}
        <span className="text-xs text-muted-foreground">
          runtime: <span className="font-mono">{runtime || "-"}</span> · {sorted.length} 项
          {caps?.supportsUpload && <> · 单文件 ≤ {caps.maxUploadBytes / 1024 / 1024}MB</>}
        </span>
      </div>
      {uploadError && (
        <div className="mb-3 px-3 py-2 text-xs rounded-md" style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }}>
          上传失败: {uploadError}
        </div>
      )}

      {/* 面包屑导航 */}
      {(currentPath || files.length > 0) && (
        <div className="mb-2 text-xs flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setCurrentPath("")}
            className={`px-1.5 py-0.5 lingxia-soft-link ${currentPath ? "lingxia-soft-link--accent" : ""}`}
          >
            workspace
          </button>
          {crumbs.map((c) => (
            <span key={c.path} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <button
                type="button"
                onClick={() => setCurrentPath(c.path)}
                className="px-1.5 py-0.5 lingxia-soft-link font-mono"
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-3 px-3 py-2 text-xs rounded-md" style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }}>
          {error}
        </div>
      )}

      {sorted.length === 0 && !loading && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Folder className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>工作空间还是空的</p>
          <p className="text-xs mt-1">让 Agent 帮你生成文件，或稍后启用上传功能</p>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="border rounded-md overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--oc-card, #f9fafb)" }}>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">名称</th>
                <th className="text-right px-3 py-2 font-medium w-24">大小</th>
                <th className="text-left px-3 py-2 font-medium w-32">修改时间</th>
                <th className="text-right px-3 py-2 font-medium w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr key={f.path} className={`border-t lingxia-soft-row ${f.type === "directory" ? "cursor-pointer" : ""}`} style={{ borderColor: "var(--border)" }} onClick={() => f.type === "directory" && setCurrentPath(f.path)}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {f.type === "directory" ? <Folder className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-gray-500" />}
                      <span className="font-mono text-xs">{f.name}</span>
                      {f.type === "directory" && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  </td>
                  <td className="text-right px-3 py-2 text-xs text-muted-foreground">{f.type === "directory" ? "-" : formatSize(f.size)}</td>
                  <td className="text-left px-3 py-2 text-xs text-muted-foreground">{formatTime(f.modifiedAt)}</td>
                  <td className="text-right px-3 py-2">
                    <div className="inline-flex gap-1">
                      {f.type === "file" && isPreviewable(f.name) && caps?.supportsRead && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); previewFile(f); }} className="h-7 px-2 text-xs gap-1 lingxia-soft-action">
                          <Eye className="w-3 h-3" /> 预览
                        </Button>
                      )}
                      {f.type === "file" && caps?.supportsDownload && (
                        <a href={downloadUrl(f)} download={f.name} onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 lingxia-soft-action">
                            <Download className="w-3 h-3" /> 下载
                          </Button>
                        </a>
                      )}
                      {caps?.supportsDelete && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); requestDeleteFile(f); }} className="h-7 px-2 text-xs gap-1 lingxia-soft-action lingxia-soft-action--danger">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview modal */}
      {previewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewing(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="font-mono text-sm">{previewing.path}</span>
                {previewing.modifiedAt && <span className="text-xs text-muted-foreground">· {formatTime(previewing.modifiedAt)}</span>}
              </div>
              <div className="flex gap-2">
                <a href={downloadUrl({ name: previewing.name, path: previewing.path, type: "file" })} download={previewing.name}>
                  <Button size="sm" variant="outline" className="gap-1"><Download className="w-3 h-3" /> 下载</Button>
                </a>
                <Button size="sm" variant="ghost" onClick={() => setPreviewing(null)}>关闭</Button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap" style={{ background: "#fafafa" }}>{previewing.content || "(空文件)"}</pre>
          </div>
        </div>
      )}

      {previewLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent
          className="max-w-[420px]"
          style={{
            background: "var(--oc-bg-surface)",
            borderColor: "var(--oc-border)",
            color: "var(--oc-text-primary)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              {deleteTarget?.type === "directory" ? "删除文件夹？" : "删除文件？"}
            </AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--oc-text-secondary)" }}>
              {deleteTarget?.type === "directory"
                ? "该文件夹及其中所有内容都会被删除，此操作不可撤销。"
                : "该文件会被删除，此操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div
              className="rounded-md px-3 py-2 text-xs font-mono break-all"
              style={{
                background: "color-mix(in oklab, var(--oc-bg) 82%, transparent)",
                border: "1px solid var(--oc-border)",
                color: "var(--oc-text-secondary)",
              }}
            >
              {deleteTarget.path}{deleteTarget.type === "directory" ? "/" : ""}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="lingxia-soft-action">取消</AlertDialogCancel>
            <AlertDialogAction
              className="lingxia-soft-action lingxia-soft-action--danger"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void deleteFile(deleteTarget);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
