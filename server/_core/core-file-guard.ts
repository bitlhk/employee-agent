import path from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { appendLogAsync } from "./helpers";

const PROTECTED_ROOT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "MEMORY.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
  "USER.md",
] as const;

type ProtectedCoreFileSnapshot = {
  workspace: string;
  files: Array<{ name: string; content: string }>;
};

export function snapshotProtectedCoreFiles(workspace: string): ProtectedCoreFileSnapshot {
  const files: ProtectedCoreFileSnapshot["files"] = [];
  for (const name of PROTECTED_ROOT_FILES) {
    const fp = path.join(workspace, name);
    try {
      if (!existsSync(fp)) continue;
      const st = statSync(fp);
      if (!st.isFile()) continue;
      files.push({ name, content: readFileSync(fp, "utf8") });
    } catch {}
  }
  return { workspace, files };
}

export function restoreDeletedProtectedCoreFiles(
  snapshot: ProtectedCoreFileSnapshot,
  context: { adoptId: string; agentId: string; sessionKey?: string; phase: string }
): string[] {
  const restored: string[] = [];
  for (const item of snapshot.files) {
    const fp = path.join(snapshot.workspace, item.name);
    try {
      if (existsSync(fp) && statSync(fp).isFile()) continue;
      if (existsSync(fp)) rmSync(fp, { recursive: true, force: true });
      mkdirSync(snapshot.workspace, { recursive: true });
      writeFileSync(fp, item.content, "utf8");
      restored.push(item.name);
    } catch (e: any) {
      appendLogAsync("core-file-guard.log", {
        ts: new Date().toISOString(),
        event: "restore_failed",
        ...context,
        file: item.name,
        error: String(e?.message || e),
      });
    }
  }
  if (restored.length > 0) {
    appendLogAsync("core-file-guard.log", {
      ts: new Date().toISOString(),
      event: "restored_deleted_core_files",
      ...context,
      files: restored,
    });
  }
  return restored;
}
