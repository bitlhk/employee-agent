/**
 * Files Capability router — unified IO-layer file CRUD across runtimes.
 * Per CODING_GUIDELINES rules 1-6 (entry-point dispatch / runtime-specific in *-files.ts / IO layer only).
 */
import express from "express";
import path from "path";
import { existsSync, statSync, readdirSync, readFileSync, createReadStream, mkdirSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { openClawWorkspaceDir, requireClawOwner, resolveRuntimeAgentId } from "./helpers";
import { hermesFiles, type LinggFileNode, type FilesProviderCapabilities, type FilesProviderHandle, adoptIdToWorkspace } from "./hermes-files";

const OPENCLAW_FILES_CAPABILITIES: FilesProviderCapabilities = {
  supportsList: true,
  supportsRead: true,
  supportsDownload: true,
  supportsUpload: true,
  supportsDelete: true,
  maxUploadBytes: 10 * 1024 * 1024,
};

const MAX_LIST_DEPTH = 4;
const MAX_FILES_PER_LIST = 500;
const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_WORKSPACE = 2000;

// File type whitelist (defense against agent prompt-injection-via-uploaded-file)
const ALLOWED_EXTENSIONS = new Set([
  "md", "txt", "csv", "json", "yaml", "yml", "xml", "toml", "ini", "conf", "log",
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "gif", "svg", "webp",
  "html", "htm", "css",
  "zip", "tar", "gz",
]);

function safeFilename(name: string): string {
  // Strip path separators / dangerous chars / leading dots / collapse '..'
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\.+/g, "_").replace(/^\.+/, "_").slice(0, 200);
}

function getExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i < 0 ? "" : filename.slice(i + 1).toLowerCase();
}

function isHermesAdopt(adoptId: string): boolean {
  return String(adoptId || "").startsWith("lgh-");
}

function toFilesHandle(claw: any): FilesProviderHandle {
  return { adoptId: claw.adoptId, agentId: String(claw.agentId || ""), userId: Number(claw.userId || 0) };
}

function openclawWorkspace(claw: any, adoptId: string): string {
  const runtimeAgentId = resolveRuntimeAgentId(adoptId, String(claw?.agentId || ""));
  return openClawWorkspaceDir(runtimeAgentId);
}

function safeJoin(workspace: string, relPath: string): string | null {
  if (!relPath) return workspace;
  if (relPath.startsWith("/") || relPath.includes("\0") || relPath.includes("..")) return null;
  const abs = path.normalize(path.join(workspace, relPath));
  if (!abs.startsWith(workspace + path.sep) && abs !== workspace) return null;
  return abs;
}

function openclawListFiles(workspace: string, subPath: string = ""): LinggFileNode[] {
  if (!existsSync(workspace)) return [];
  const startAbs = safeJoin(workspace, subPath);
  if (!startAbs) return [];
  const out: LinggFileNode[] = [];
  function walk(absPath: string, relPath: string, depth: number) {
    if (depth > MAX_LIST_DEPTH || out.length >= MAX_FILES_PER_LIST) return;
    let entries: string[];
    try { entries = readdirSync(absPath); } catch { return; }
    for (const name of entries) {
      if (out.length >= MAX_FILES_PER_LIST) break;
      if (name.startsWith(".")) continue;
      const childAbs = path.join(absPath, name);
      const childRel = relPath ? `${relPath}/${name}` : name;
      let st;
      try { st = statSync(childAbs); } catch { continue; }
      out.push({
        name, path: childRel,
        type: st.isDirectory() ? "directory" : "file",
        size: st.isDirectory() ? undefined : Number(st.size),
        modifiedAt: st.mtime.toISOString(),
      });
      if (st.isDirectory()) walk(childAbs, childRel, depth + 1);
    }
  }
  walk(startAbs, subPath, 0);
  return out;
}

export function registerFilesRoutes(app: express.Express) {

  app.get("/api/claw/files/capabilities", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) return res.json({ runtime: "hermes", capabilities: hermesFiles.capabilities() });
      return res.json({ runtime: "openclaw", capabilities: OPENCLAW_FILES_CAPABILITIES });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "capabilities failed") });
    }
  });

  app.get("/api/claw/files/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const subPath = String(req.query.path || "").trim();
      if (isHermesAdopt(adoptId)) {
        const files = hermesFiles.listFiles(toFilesHandle(claw), subPath);
        return res.json({ runtime: "hermes", capabilities: hermesFiles.capabilities(), files });
      }
      const workspace = openclawWorkspace(claw, adoptId);
      const files = openclawListFiles(workspace, subPath);
      return res.json({ runtime: "openclaw", capabilities: OPENCLAW_FILES_CAPABILITIES, files });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "list failed") });
    }
  });

  app.get("/api/claw/files/read", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const relPath = String(req.query.path || "").trim();
      if (!adoptId || !relPath) return res.status(400).json({ error: "adoptId and path required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) {
        const r = hermesFiles.readFile(toFilesHandle(claw), relPath);
        if (!r) return res.status(404).json({ error: "file not found or too large" });
        return res.json({ runtime: "hermes", path: relPath, ...r });
      }
      const workspace = openclawWorkspace(claw, adoptId);
      const abs = safeJoin(workspace, relPath);
      if (!abs || !existsSync(abs)) return res.status(404).json({ error: "file not found" });
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_READ_BYTES) return res.status(413).json({ error: "not a file or too large" });
      const content = readFileSync(abs, "utf8");
      return res.json({ runtime: "openclaw", path: relPath, content, size: Number(st.size), modifiedAt: st.mtime.toISOString() });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "read failed") });
    }
  });

  app.get("/api/claw/files/download", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      const relPath = String(req.query.path || "").trim();
      if (!adoptId || !relPath) return res.status(400).json({ error: "adoptId and path required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      let absPath: string | null = null;
      if (isHermesAdopt(adoptId)) {
        absPath = hermesFiles.resolveAbsPath(toFilesHandle(claw), relPath);
      } else {
        const workspace = openclawWorkspace(claw, adoptId);
        absPath = safeJoin(workspace, relPath);
        if (absPath && (!existsSync(absPath) || !statSync(absPath).isFile())) absPath = null;
      }
      if (!absPath) return res.status(404).json({ error: "file not found" });
      const filename = path.basename(absPath);
      res.setHeader("Content-Disposition", `attachment; filename=\"${encodeURIComponent(filename)}\"`);
      res.setHeader("Content-Type", "application/octet-stream");
      createReadStream(absPath).pipe(res);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "download failed") });
    }
  });

  // POST upload — body { adoptId, path?, filename, contentBase64 }
  // 4 道安全限制: type 白名单 / 10MB / 200 文件 quota / filename sanitize
  app.post("/api/claw/files/upload", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const subPath = String(body.path || "").trim();
      const filenameRaw = String(body.filename || "").trim();
      const contentBase64 = String(body.contentBase64 || "");
      if (!adoptId || !filenameRaw || !contentBase64) return res.status(400).json({ error: "adoptId, filename, contentBase64 required" });
      const filename = safeFilename(filenameRaw);
      if (!filename) return res.status(400).json({ error: "invalid filename" });
      const ext = getExt(filename);
      if (!ALLOWED_EXTENSIONS.has(ext)) return res.status(400).json({ error: `file type .${ext} not allowed` });
      let buf: Buffer;
      try { buf = Buffer.from(contentBase64, "base64"); } catch { return res.status(400).json({ error: "invalid base64" }); }
      if (buf.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: `file too large: ${buf.length}` });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      let existingFiles: LinggFileNode[];
      if (isHermesAdopt(adoptId)) {
        existingFiles = hermesFiles.listFiles(toFilesHandle(claw));
      } else {
        existingFiles = openclawListFiles(openclawWorkspace(claw, adoptId));
      }
      const fileCount = existingFiles.filter(f => f.type === "file").length;
      if (fileCount >= MAX_FILES_PER_WORKSPACE) return res.status(429).json({ error: `workspace file count >= ${MAX_FILES_PER_WORKSPACE}` });
      const targetRel = subPath ? `${subPath}/${filename}` : filename;
      if (isHermesAdopt(adoptId)) {
        const r = hermesFiles.writeFile(toFilesHandle(claw), targetRel, buf);
        if (!r.ok) return res.status(400).json({ error: r.reason });
        return res.json({ runtime: "hermes", ok: true, path: targetRel, size: r.size });
      }
      const ws = openclawWorkspace(claw, adoptId);
      const abs = safeJoin(ws, targetRel);
      if (!abs) return res.status(400).json({ error: "path_not_allowed" });
      try {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
        return res.json({ runtime: "openclaw", ok: true, path: targetRel, size: buf.length });
      } catch (e: any) {
        return res.status(500).json({ error: `write failed: ${e?.message || e}` });
      }
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "upload failed") });
    }
  });

  // DELETE file or directory — body { adoptId, path }
  // 目录递归删除；safeJoin + workspace-root 防护避免越界
  app.delete("/api/claw/files/delete", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const relPath = String(body.path || "").trim();
      if (!adoptId || !relPath) return res.status(400).json({ error: "adoptId and path required" });
      const normalized = path.posix.normalize(relPath.replace(/\\/g, "/"));
      if (normalized === "" || normalized === "." || normalized === "/" || normalized === ".." || normalized.startsWith("../")) {
        return res.status(400).json({ error: "refuse to delete workspace root" });
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) {
        const r = hermesFiles.deleteFile(toFilesHandle(claw), relPath);
        if (!r.ok) return res.status(400).json({ error: r.reason });
        return res.json({ runtime: "hermes", ok: true });
      }
      const ws = openclawWorkspace(claw, adoptId);
      const abs = safeJoin(ws, relPath);
      if (!abs || !existsSync(abs)) return res.status(404).json({ error: "file not found" });
      if (path.resolve(abs) === path.resolve(ws)) return res.status(400).json({ error: "refuse to delete workspace root" });
      const st = statSync(abs);
      try {
        if (st.isDirectory()) {
          rmSync(abs, { recursive: true, force: true });
          return res.json({ runtime: "openclaw", ok: true, deleted: "directory" });
        }
        unlinkSync(abs);
        return res.json({ runtime: "openclaw", ok: true, deleted: "file" });
      } catch (e: any) {
        return res.status(500).json({ error: `delete failed: ${e?.message || e}` });
      }
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "delete failed") });
    }
  });
}
