/**
 * Hermes memory & core-files provider.
 * Hermes profile layout:
 *   /root/.hermes/profiles/<name>/
 *     ├── SOUL.md                      ← agent persona
 *     └── memories/USER.md             ← user-scoped persistent memory
 *
 * Maps OpenClaw-compatible "MEMORY.md" alias → Hermes USER.md
 * so existing AgentPage UI works without prefix knowledge.
 */
import path from "path";
import { existsSync, statSync, readFileSync } from "fs";
import { hermesProfileDir } from "./helpers";

const HERMES_USER_FILE_LIMIT = 256 * 1024;   // USER.md — agent's knowledge of the user
const HERMES_MEMORY_FILE_LIMIT = 256 * 1024; // MEMORY.md — agent's own working memory
const HERMES_SOUL_FILE_LIMIT = 64 * 1024;    // SOUL.md — persona

export type HermesCoreFile = { name: string; rel: string; max: number };

// Mirror of Hermes tools/memory_tool.py _path_for():
//   target="user"  → memories/USER.md   (agent's understanding of the user)
//   target="memory"→ memories/MEMORY.md (agent's own insights / decisions)
// SOUL.md is the persona system-prompt, lives in profile root.
export const HERMES_CORE_FILES: HermesCoreFile[] = [
  { name: "SOUL.md", rel: "SOUL.md", max: HERMES_SOUL_FILE_LIMIT },
  { name: "MEMORY.md", rel: "memories/MEMORY.md", max: HERMES_MEMORY_FILE_LIMIT },
  { name: "USER.md", rel: "memories/USER.md", max: HERMES_USER_FILE_LIMIT },
];

export function adoptIdToProfilePath(adoptId: string): string | null {
  const m = String(adoptId || "").match(/^lgh-([a-z0-9][a-z0-9_-]{0,63})$/);
  if (!m) return null;
  return hermesProfileDir(m[1]);
}

export type HermesPathResolved = { ok: true; path: string; max: number } | { ok: false; reason: string };

export function resolveHermesCoreFilePath(adoptId: string, name: string): HermesPathResolved {
  const profilePath = adoptIdToProfilePath(adoptId);
  if (!profilePath) return { ok: false, reason: "invalid_adopt_id" };
  const entry = HERMES_CORE_FILES.find(f => f.name === name);
  if (!entry) return { ok: false, reason: "path_not_allowed" };
  return { ok: true, path: path.join(profilePath, entry.rel), max: entry.max };
}

/**
 * Memory write target resolution. Hermes 1:1 — no OpenClaw aliasing because
 * Hermes' MEMORY.md (agent working memory) and USER.md (user knowledge) are
 * different concepts; aliasing would corrupt the agent's mental model.
 */
export function resolveHermesMemoryTarget(adoptId: string, target: string): HermesPathResolved {
  const t = String(target || "").trim();
  if (t === "SOUL.md" || t === "MEMORY.md" || t === "USER.md") {
    return resolveHermesCoreFilePath(adoptId, t);
  }
  return { ok: false, reason: "path_not_allowed" };
}

export function listHermesCoreFileMeta(adoptId: string) {
  const profilePath = adoptIdToProfilePath(adoptId);
  if (!profilePath) return null;
  return {
    workspace: profilePath,
    files: HERMES_CORE_FILES.map(({ name, rel }) => {
      const fp = path.join(profilePath, rel);
      if (!existsSync(fp)) return { name, exists: false, updatedAt: null, size: null };
      try {
        const st = statSync(fp);
        return { name, exists: true, updatedAt: st.mtime.toISOString(), size: Number(st.size || 0) };
      } catch {
        return { name, exists: false, updatedAt: null, size: null };
      }
    }),
  };
}
