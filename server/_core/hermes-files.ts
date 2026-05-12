/**
 * Hermes files provider — list/read files in Hermes profile workspace.
 *
 * Per CODING_GUIDELINES rules:
 *   - All Hermes file ops in this file (rule 1)
 *   - hermes-files.ts naming (rule 2)
 *   - LinggClawFile type defined here (rule 3)
 *   - claw-files.ts router does ONE entry-point fork (rule 4)
 *   - Workspace is OS-layer (no cognitive abstraction; rule 6)
 *
 * Workspace path: /root/.hermes/profiles/<name>/workspace/
 */
import path from "path";
import { readdirSync, statSync, existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { hermesProfileWorkspaceDir } from "./helpers";

const MAX_LIST_DEPTH = 4;        // Anti-DOS: limit recursion
const MAX_FILES_PER_LIST = 500;  // Anti-DOS: cap result size
const MAX_READ_BYTES = 10 * 1024 * 1024; // 10MB max single-file read

export type LinggFileNode = {
  name: string;
  path: string;            // workspace-relative, posix-style (e.g. "sample-data/data.csv")
  type: "file" | "directory";
  size?: number;
  modifiedAt?: string;     // ISO
};

export type FilesProviderCapabilities = {
  supportsList: boolean;
  supportsRead: boolean;
  supportsDownload: boolean;
  supportsUpload: boolean;
  supportsDelete: boolean;
  maxUploadBytes: number;
};

export type FilesProviderHandle = { adoptId: string; agentId?: string; userId: number };

// ────────────────────────────────────────────────────────────────────
// Path resolution
// ────────────────────────────────────────────────────────────────────

export function adoptIdToWorkspace(adoptId: string): string | null {
  const m = String(adoptId || "").match(/^lgh-([a-z0-9][a-z0-9_-]{0,63})$/);
  if (!m) return null;
  return hermesProfileWorkspaceDir(m[1]);
}

/**
 * Resolve a user-supplied relative path to absolute, with traversal guards.
 * Returns null if path is malicious or outside workspace.
 */
function resolveSafePath(workspace: string, relPath: string): string | null {
  if (!relPath) return workspace;
  // Reject absolute path, .., null bytes, hidden file marker
  if (relPath.startsWith("/") || relPath.includes("\0")) return null;
  // Normalize and check
  const abs = path.normalize(path.join(workspace, relPath));
  if (!abs.startsWith(workspace + path.sep) && abs !== workspace) return null;
  return abs;
}

// ────────────────────────────────────────────────────────────────────
// Capabilities
// ────────────────────────────────────────────────────────────────────

const HERMES_FILES_CAPABILITIES: FilesProviderCapabilities = {
  supportsList: true,
  supportsRead: true,
  supportsDownload: true,
  supportsUpload: true,    // 2026-04-20 enabled with safety: type whitelist + 10MB + filename sanitize
  supportsDelete: true,
  maxUploadBytes: 10 * 1024 * 1024,
};

// ────────────────────────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────────────────────────

export const hermesFiles = {
  capabilities(): FilesProviderCapabilities {
    return HERMES_FILES_CAPABILITIES;
  },

  /**
   * List files (recursive but capped).
   * subPath is workspace-relative; defaults to root.
   */
  listFiles(claw: FilesProviderHandle, subPath: string = ""): LinggFileNode[] {
    const workspace = adoptIdToWorkspace(claw.adoptId);
    if (!workspace) return [];
    if (!existsSync(workspace)) return [];
    const startAbs = resolveSafePath(workspace, subPath);
    if (!startAbs) return [];

    const out: LinggFileNode[] = [];
    function walk(absPath: string, relPath: string, depth: number) {
      if (depth > MAX_LIST_DEPTH) return;
      if (out.length >= MAX_FILES_PER_LIST) return;
      let entries: string[];
      try { entries = readdirSync(absPath); } catch { return; }
      for (const name of entries) {
        if (out.length >= MAX_FILES_PER_LIST) break;
        if (name.startsWith(".")) continue;  // skip hidden files (.lock etc)
        const childAbs = path.join(absPath, name);
        const childRel = relPath ? `${relPath}/${name}` : name;
        let st;
        try { st = statSync(childAbs); } catch { continue; }
        const node: LinggFileNode = {
          name,
          path: childRel,
          type: st.isDirectory() ? "directory" : "file",
          size: st.isDirectory() ? undefined : Number(st.size),
          modifiedAt: st.mtime.toISOString(),
        };
        out.push(node);
        if (st.isDirectory()) walk(childAbs, childRel, depth + 1);
      }
    }
    walk(startAbs, subPath, 0);
    return out;
  },

  /**
   * Read file content (text). Refuses paths outside workspace or > MAX_READ_BYTES.
   */
  readFile(claw: FilesProviderHandle, relPath: string): { content: string; size: number; modifiedAt: string } | null {
    const workspace = adoptIdToWorkspace(claw.adoptId);
    if (!workspace) return null;
    const abs = resolveSafePath(workspace, relPath);
    if (!abs || !existsSync(abs)) return null;
    const st = statSync(abs);
    if (!st.isFile()) return null;
    if (st.size > MAX_READ_BYTES) return null;
    const content = readFileSync(abs, "utf8");
    return { content, size: Number(st.size), modifiedAt: st.mtime.toISOString() };
  },

  /**
   * Resolve a relative path to absolute for download streaming.
   * Used by the /api/claw/files/download endpoint.
   * Returns null if invalid or outside workspace.
   */
  resolveAbsPath(claw: FilesProviderHandle, relPath: string): string | null {
    const workspace = adoptIdToWorkspace(claw.adoptId);
    if (!workspace) return null;
    const abs = resolveSafePath(workspace, relPath);
    if (!abs || !existsSync(abs)) return null;
    const st = statSync(abs);
    if (!st.isFile()) return null;
    return abs;
  },

  /** Write file (upload). Caller must validate type/size/filename beforehand. */
  writeFile(claw: FilesProviderHandle, relPath: string, content: Buffer): { ok: true; size: number } | { ok: false; reason: string } {
    const workspace = adoptIdToWorkspace(claw.adoptId);
    if (!workspace) return { ok: false, reason: "invalid adoptId" };
    const abs = resolveSafePath(workspace, relPath);
    if (!abs) return { ok: false, reason: "path_not_allowed" };
    if (content.length > 10 * 1024 * 1024) return { ok: false, reason: "file_too_large" };
    try {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      return { ok: true, size: content.length };
    } catch (e: any) {
      return { ok: false, reason: `write failed: ${e?.message || e}` };
    }
  },

  /** Delete file (not directory). */
  deleteFile(claw: FilesProviderHandle, relPath: string): { ok: true } | { ok: false; reason: string } {
    const workspace = adoptIdToWorkspace(claw.adoptId);
    if (!workspace) return { ok: false, reason: "invalid adoptId" };
    const abs = resolveSafePath(workspace, relPath);
    if (!abs || !existsSync(abs)) return { ok: false, reason: "file not found" };
    const st = statSync(abs);
    if (!st.isFile()) return { ok: false, reason: "not a file (refuse rmdir)" };
    try {
      unlinkSync(abs);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: `delete failed: ${e?.message || e}` };
    }
  },
};
