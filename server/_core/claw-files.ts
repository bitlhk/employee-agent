/**
 * Files Capability router — unified IO-layer file CRUD across runtimes.
 * Per CODING_GUIDELINES rules 1-6 (entry-point dispatch / runtime-specific in *-files.ts / IO layer only).
 */
import express from "express";
import { createHash } from "crypto";
import path from "path";
import { existsSync, statSync, readdirSync, readFileSync, createReadStream, mkdirSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { isJiuwenClawAdoptId, requireClawOwner, resolveRuntimeWorkspace } from "./helpers";
import { hermesFiles, type LinggFileNode, type FilesProviderCapabilities, type FilesProviderHandle, adoptIdToWorkspace } from "./hermes-files";
import { auditActor, auditErrorMetadata, auditRequest, recordAuditBestEffort, recordAuditRequired } from "./audit-events";

const OPENCLAW_FILES_CAPABILITIES: FilesProviderCapabilities = {
  supportsList: true,
  supportsRead: true,
  supportsDownload: true,
  supportsUpload: true,
  supportsDelete: true,
  maxUploadBytes: 50 * 1024 * 1024,
};

const MAX_LIST_DEPTH = 4;
const MAX_FILES_PER_LIST = 2000;
const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const TASK_WORKBENCH_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_WORKSPACE = 2000;
const PROTECTED_ROOT_FILES = new Set([
  "AGENT.md",
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "MEMORY.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
  "USER.md",
]);

// File type whitelist (defense against agent prompt-injection-via-uploaded-file)
const ALLOWED_EXTENSIONS = new Set([
  "md", "txt", "csv", "json", "yaml", "yml", "xml", "toml", "ini", "conf", "log",
  "pdf", "docx", "xls", "xlsx", "pptx",
  "png", "jpg", "jpeg", "gif", "svg", "webp",
  "html", "htm", "css",
  "zip", "tar", "gz",
]);
const TASK_WORKBENCH_AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "aac", "webm", "ogg", "mp4",
]);

function safeFilename(name: string): string {
  // Strip path separators / dangerous chars / leading dots / collapse '..'
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\.+/g, "_").replace(/^\.+/, "_").slice(0, 200);
}

function getExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i < 0 ? "" : filename.slice(i + 1).toLowerCase();
}

function isTaskWorkbenchInputUpload(subPath: string): boolean {
  const normalized = path.posix.normalize(String(subPath || "").replace(/\\/g, "/"));
  return normalized.startsWith("office/task-workbench/") && normalized.endsWith("/inputs");
}

function isAllowedUploadExtension(ext: string, subPath: string): boolean {
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  return isTaskWorkbenchInputUpload(subPath) && TASK_WORKBENCH_AUDIO_EXTENSIONS.has(ext);
}

function uploadLimitFor(ext: string, subPath: string): number {
  if (isTaskWorkbenchInputUpload(subPath) && TASK_WORKBENCH_AUDIO_EXTENSIONS.has(ext)) {
    return TASK_WORKBENCH_AUDIO_UPLOAD_BYTES;
  }
  return MAX_UPLOAD_BYTES;
}

function isHermesAdopt(adoptId: string): boolean {
  return String(adoptId || "").startsWith("lgh-");
}

function runtimeName(adoptId: string): "openclaw" | "hermes" | "jiuwenclaw" {
  if (isHermesAdopt(adoptId)) return "hermes";
  if (isJiuwenClawAdoptId(adoptId)) return "jiuwenclaw";
  return "openclaw";
}

function toFilesHandle(claw: any): FilesProviderHandle {
  return { adoptId: claw.adoptId, agentId: String(claw.agentId || ""), userId: Number(claw.userId || 0) };
}

function runtimeWorkspace(claw: any, adoptId: string): string {
  return resolveRuntimeWorkspace(claw, adoptId);
}

function fileSha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

function auditFileMetadata(args: {
  path: string;
  filename?: string;
  ext?: string;
  size?: number | null;
  sha256?: string | null;
  operation: string;
  uploadLimitBytes?: number;
  deleted?: string;
}) {
  return {
    path: args.path,
    filename: args.filename || path.posix.basename(args.path),
    ext: args.ext || getExt(args.filename || args.path),
    sizeBytes: args.size ?? null,
    sha256: args.sha256 || null,
    operation: args.operation,
    uploadLimitBytes: args.uploadLimitBytes,
    deleted: args.deleted,
  };
}

async function recordFileAudit(args: {
  req: express.Request;
  claw: any;
  adoptId: string;
  action: "file.uploaded" | "file.read" | "file.downloaded" | "file.deleted" | "file.delete.denied" | "file.upload.denied";
  result?: "success" | "failed" | "denied" | "warning";
  severity?: "info" | "low" | "medium" | "high" | "critical";
  path: string;
  filename?: string;
  ext?: string;
  size?: number | null;
  sha256?: string | null;
  runtime?: string;
  errorCode?: string | null;
  policyCode?: string | null;
  metadata?: Record<string, unknown>;
  required?: boolean;
}) {
  const runtime = args.runtime || runtimeName(args.adoptId);
  const input = {
    action: args.action,
    result: args.result || "success",
    severity: args.severity || "info",
    ...auditActor({
      id: args.claw?.userId,
      name: args.claw?.userName,
      email: args.claw?.userEmail,
      role: args.claw?.permissionProfile,
      groupId: args.claw?.userGroupId,
    }),
    ...auditRequest(args.req),
    targetType: "file",
    targetId: args.path,
    targetName: args.filename || path.posix.basename(args.path),
    resourceType: "workspace_file",
    resourceId: args.sha256 || args.path,
    resourceName: args.path,
    agentInstanceId: args.adoptId,
    runtimeType: runtime,
    runtimeAgentId: args.claw?.agentId ? String(args.claw.agentId) : null,
    errorCode: args.errorCode || null,
    policyCode: args.policyCode || null,
    metadata: {
      ...auditFileMetadata({
        path: args.path,
        filename: args.filename,
        ext: args.ext,
        size: args.size,
        sha256: args.sha256,
        operation: args.action,
      }),
      ...args.metadata,
    },
  };
  if (args.required) await recordAuditRequired(input);
  else await recordAuditBestEffort(input);
}

function safeJoin(workspace: string, relPath: string): string | null {
  if (!relPath) return workspace;
  if (relPath.startsWith("/") || relPath.includes("\0") || relPath.includes("..")) return null;
  const abs = path.normalize(path.join(workspace, relPath));
  if (!abs.startsWith(workspace + path.sep) && abs !== workspace) return null;
  return abs;
}

function isProtectedRootFile(relPath: string): boolean {
  const normalized = path.posix.normalize(String(relPath || "").replace(/\\/g, "/"));
  return !normalized.includes("/") && PROTECTED_ROOT_FILES.has(normalized);
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
      return res.json({ runtime: runtimeName(adoptId), capabilities: OPENCLAW_FILES_CAPABILITIES });
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
      const workspace = runtimeWorkspace(claw, adoptId);
      const files = openclawListFiles(workspace, subPath);
      return res.json({ runtime: runtimeName(adoptId), capabilities: OPENCLAW_FILES_CAPABILITIES, files });
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
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.read",
          path: relPath,
          size: Number(r.size || 0),
          runtime: "hermes",
          metadata: { readLimitBytes: MAX_READ_BYTES },
        });
        return res.json({ runtime: "hermes", path: relPath, ...r });
      }
      const workspace = runtimeWorkspace(claw, adoptId);
      const abs = safeJoin(workspace, relPath);
      if (!abs || !existsSync(abs)) return res.status(404).json({ error: "file not found" });
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_READ_BYTES) return res.status(413).json({ error: "not a file or too large" });
      const content = readFileSync(abs, "utf8");
      await recordFileAudit({
        req,
        claw,
        adoptId,
        action: "file.read",
        path: relPath,
        size: Number(st.size),
        runtime: runtimeName(adoptId),
        metadata: { readLimitBytes: MAX_READ_BYTES },
      });
      return res.json({ runtime: runtimeName(adoptId), path: relPath, content, size: Number(st.size), modifiedAt: st.mtime.toISOString() });
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
        const workspace = runtimeWorkspace(claw, adoptId);
        absPath = safeJoin(workspace, relPath);
        if (absPath && (!existsSync(absPath) || !statSync(absPath).isFile())) absPath = null;
      }
      if (!absPath) return res.status(404).json({ error: "file not found" });
      const filename = path.basename(absPath);
      const st = statSync(absPath);
      await recordFileAudit({
        req,
        claw,
        adoptId,
        action: "file.downloaded",
        path: relPath,
        filename,
        size: Number(st.size),
        runtime: isHermesAdopt(adoptId) ? "hermes" : runtimeName(adoptId),
        required: true,
      });
      res.setHeader("Content-Disposition", `attachment; filename=\"${encodeURIComponent(filename)}\"`);
      res.setHeader("Content-Type", "application/octet-stream");
      createReadStream(absPath).pipe(res);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "download failed") });
    }
  });

  // POST upload — body { adoptId, path?, filename, contentBase64 }
  // 4 道安全限制: type 白名单 / 50MB / 200 文件 quota / filename sanitize
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
      if (!isAllowedUploadExtension(ext, subPath)) {
        const claw = await requireClawOwner(req, res, adoptId);
        if (claw) {
          await recordFileAudit({
            req,
            claw,
            adoptId,
            action: "file.upload.denied",
            result: "denied",
            severity: "medium",
            path: subPath ? `${subPath}/${filename}` : filename,
            filename,
            ext,
            runtime: runtimeName(adoptId),
            errorCode: "FILE_TYPE_NOT_ALLOWED",
            policyCode: "upload_extension_whitelist",
            metadata: { allowedExtensions: Array.from(ALLOWED_EXTENSIONS) },
          });
        }
        return res.status(400).json({ error: `file type .${ext} not allowed` });
      }
      let buf: Buffer;
      try { buf = Buffer.from(contentBase64, "base64"); } catch { return res.status(400).json({ error: "invalid base64" }); }
      const maxUploadBytes = uploadLimitFor(ext, subPath);
      if (buf.length > maxUploadBytes) {
        const claw = await requireClawOwner(req, res, adoptId);
        if (claw) {
          await recordFileAudit({
            req,
            claw,
            adoptId,
            action: "file.upload.denied",
            result: "denied",
            severity: "medium",
            path: subPath ? `${subPath}/${filename}` : filename,
            filename,
            ext,
            size: buf.length,
            runtime: runtimeName(adoptId),
            errorCode: "FILE_TOO_LARGE",
            policyCode: "upload_size_limit",
            metadata: { uploadLimitBytes: maxUploadBytes },
          });
        }
        return res.status(413).json({ error: `file too large: ${buf.length}` });
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const sha256 = fileSha256(buf);
      let existingFiles: LinggFileNode[];
      if (isHermesAdopt(adoptId)) {
        existingFiles = hermesFiles.listFiles(toFilesHandle(claw));
      } else {
        existingFiles = openclawListFiles(runtimeWorkspace(claw, adoptId));
      }
      const fileCount = existingFiles.filter(f => f.type === "file").length;
      if (fileCount >= MAX_FILES_PER_WORKSPACE) {
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.upload.denied",
          result: "denied",
          severity: "medium",
          path: subPath ? `${subPath}/${filename}` : filename,
          filename,
          ext,
          size: buf.length,
          sha256,
          runtime: isHermesAdopt(adoptId) ? "hermes" : runtimeName(adoptId),
          errorCode: "WORKSPACE_FILE_QUOTA_EXCEEDED",
          policyCode: "workspace_file_quota",
          metadata: { fileCount, maxFilesPerWorkspace: MAX_FILES_PER_WORKSPACE },
        });
        return res.status(429).json({ error: `workspace file count >= ${MAX_FILES_PER_WORKSPACE}` });
      }
      const targetRel = subPath ? `${subPath}/${filename}` : filename;
      if (isHermesAdopt(adoptId)) {
        const r = hermesFiles.writeFile(toFilesHandle(claw), targetRel, buf);
        if (!r.ok) return res.status(400).json({ error: r.reason });
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.uploaded",
          path: targetRel,
          filename,
          ext,
          size: r.size,
          sha256,
          runtime: "hermes",
          metadata: { uploadLimitBytes: maxUploadBytes, sourcePath: subPath || null },
        });
        return res.json({ runtime: "hermes", ok: true, path: targetRel, size: r.size });
      }
      const ws = runtimeWorkspace(claw, adoptId);
      const abs = safeJoin(ws, targetRel);
      if (!abs) {
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.upload.denied",
          result: "denied",
          severity: "high",
          path: targetRel,
          filename,
          ext,
          size: buf.length,
          sha256,
          runtime: runtimeName(adoptId),
          errorCode: "PATH_NOT_ALLOWED",
          policyCode: "workspace_path_boundary",
        });
        return res.status(400).json({ error: "path_not_allowed" });
      }
      try {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.uploaded",
          path: targetRel,
          filename,
          ext,
          size: buf.length,
          sha256,
          runtime: runtimeName(adoptId),
          metadata: { uploadLimitBytes: maxUploadBytes, sourcePath: subPath || null },
        });
        return res.json({ runtime: runtimeName(adoptId), ok: true, path: targetRel, size: buf.length });
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
      if (isProtectedRootFile(normalized)) {
        const claw = await requireClawOwner(req, res, adoptId);
        if (claw) {
          await recordFileAudit({
            req,
            claw,
            adoptId,
            action: "file.delete.denied",
            result: "denied",
            severity: "high",
            path: normalized,
            runtime: runtimeName(adoptId),
            errorCode: "PROTECTED_CORE_FILE",
            policyCode: "protected_root_file",
          });
        }
        return res.status(403).json({ error: "protected_core_file", message: "system files can be edited but not deleted" });
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (isHermesAdopt(adoptId)) {
        const r = hermesFiles.deleteFile(toFilesHandle(claw), relPath);
        if (!r.ok) return res.status(400).json({ error: r.reason });
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.deleted",
          path: relPath,
          runtime: "hermes",
        });
        return res.json({ runtime: "hermes", ok: true });
      }
      const ws = runtimeWorkspace(claw, adoptId);
      const abs = safeJoin(ws, relPath);
      if (!abs || !existsSync(abs)) return res.status(404).json({ error: "file not found" });
      if (path.resolve(abs) === path.resolve(ws)) return res.status(400).json({ error: "refuse to delete workspace root" });
      const st = statSync(abs);
      try {
        if (st.isDirectory()) {
          rmSync(abs, { recursive: true, force: true });
          await recordFileAudit({
            req,
            claw,
            adoptId,
            action: "file.deleted",
            path: relPath,
            runtime: runtimeName(adoptId),
            metadata: { deleted: "directory" },
          });
          return res.json({ runtime: runtimeName(adoptId), ok: true, deleted: "directory" });
        }
        const size = Number(st.size);
        let sha256: string | null = null;
        try { sha256 = fileSha256(readFileSync(abs)); } catch {}
        unlinkSync(abs);
        await recordFileAudit({
          req,
          claw,
          adoptId,
          action: "file.deleted",
          path: relPath,
          size,
          sha256,
          runtime: runtimeName(adoptId),
          metadata: { deleted: "file" },
        });
        return res.json({ runtime: runtimeName(adoptId), ok: true, deleted: "file" });
      } catch (e: any) {
        return res.status(500).json({ error: `delete failed: ${e?.message || e}` });
      }
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || "delete failed") });
    }
  });
}
