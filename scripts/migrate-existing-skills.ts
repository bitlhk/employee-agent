import "dotenv/config";
import path from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import type { Skill } from "../shared/types/skill";
import { getClawByAdoptId } from "../server/db";

const APP_ROOT = process.env.APP_ROOT || process.cwd();

function expandHome(raw: string): string {
  if (raw === "~") return process.env.HOME || raw;
  if (raw.startsWith("~/")) return path.join(process.env.HOME || "", raw.slice(2));
  return raw;
}

function normalizeOpenClawHome(raw?: string): string {
  const expanded = expandHome(raw || process.env.HOME || process.cwd());
  return path.basename(expanded) === ".openclaw" ? expanded : path.join(expanded, ".openclaw");
}

const OPENCLAW_HOME = normalizeOpenClawHome(process.env.CLAW_OPENCLAW_HOME || process.env.CLAW_REMOTE_OPENCLAW_HOME);
const APPLY = process.argv.includes("--apply");
const CLASSIFY_RUNTIME_ONLY =
  process.argv.find((arg) => arg.startsWith("--classify-runtime-only="))?.split("=")[1] || "skip";
const ADOPT_ID_FILTER = process.argv.find((arg) => arg.startsWith("--adoptId="))?.split("=")[1]?.trim();
const ALL_ADOPTS = process.argv.includes("--all-adopts");
const RECONCILE_AFTER_APPLY = process.argv.includes("--reconcile-after-apply");

if (ADOPT_ID_FILTER && ALL_ADOPTS) {
  console.error("[SKILL-MIGRATE] use either --adoptId=<id> or --all-adopts, not both");
  process.exit(1);
}

const registryPath = path.join(APP_ROOT, "data", "skill-registry.json");
const packageIndexPath = path.join(APP_ROOT, "data", "skill-packages", "index.json");
const builtinAllowlistPath = path.join(APP_ROOT, "data", "skill-builtin-allowlist.json");

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = String(readFileSync(filePath, "utf-8") || "").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function readBuiltinAllowlist(): Set<string> {
  const raw = readJson<unknown>(builtinAllowlistPath, []);
  const list = Array.isArray(raw) ? raw : [];
  return new Set(
    list
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );
}

function safeStat(filePath?: string): { mtimeMs?: number; size?: number } {
  try {
    if (!filePath || !existsSync(filePath)) return {};
    const st = statSync(filePath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return {};
  }
}

function readSkillMarkdown(skillPath: string): string {
  for (const fileName of ["SKILL.md", "README.md", "skill.md"]) {
    const p = path.join(skillPath, fileName);
    if (existsSync(p)) return String(readFileSync(p, "utf-8") || "");
  }
  return "";
}

function firstMeaningfulLine(text: string): string {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^#+\s*/, "").trim();
    if (!line || line === "---" || line.startsWith("name:") || line.startsWith("description:")) continue;
    return line.slice(0, 160);
  }
  return "";
}

function parseSkillMetadata(skillPath: string, skillId: string): { displayName: string; description: string } {
  const text = readSkillMarkdown(skillPath);
  const nameMatch = text.match(/(?:^|\n)\s*name\s*:\s*['"]?([^'"\n]+)['"]?/i);
  const descriptionMatch = text.match(/(?:^|\n)\s*description\s*:\s*['"]?([^'"\n]+)['"]?/i);
  const headingMatch = text.match(/(?:^|\n)#\s+(.+)/);
  return {
    displayName: (nameMatch?.[1] || headingMatch?.[1] || skillId).trim(),
    description: (descriptionMatch?.[1] || firstMeaningfulLine(text)).trim(),
  };
}

function walkSkillDirs(): Map<string, string> {
  const out = new Map<string, string>();
  const visitSkillsDir = (skillsDir: string) => {
    if (!existsSync(skillsDir)) return;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      out.set(`${skillsDir}:${entry.name}`, path.join(skillsDir, entry.name));
    }
  };

  for (const entry of readdirSync(OPENCLAW_HOME, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = path.join(OPENCLAW_HOME, entry.name);
    if (entry.name.startsWith("workspace-")) {
      visitSkillsDir(path.join(base, "skills"));
      // OpenClaw can also use workspace-lingganclaw/trial_<adoptId>/skills.
      if (entry.name === "workspace-lingganclaw") {
        for (const nested of readdirSync(base, { withFileTypes: true })) {
          if (nested.isDirectory()) visitSkillsDir(path.join(base, nested.name, "skills"));
        }
      }
    }
  }
  return out;
}

function findRuntimePath(runtimeDirs: Map<string, string>, adoptId: string, skillId: string): string | undefined {
  for (const p of runtimeDirs.values()) {
    if (!p.endsWith(`/${skillId}`)) continue;
    if (p.includes(adoptId) || p.includes(`trial_${adoptId}`)) return p;
  }
  return undefined;
}

function inferRuntimeOnly(runtimeDirs: Map<string, string>, packageKeys: Set<string>): Array<{ adoptId: string; skillId: string; path: string; reason: string }> {
  const out: Array<{ adoptId: string; skillId: string; path: string; reason: string }> = [];
  for (const p of runtimeDirs.values()) {
    const skillId = path.basename(p);
    const m =
      p.match(/workspace-(trial_lgc-[^/]+)\/skills\//) ||
      p.match(/workspace-lingganclaw\/(trial_lgc-[^/]+)\/skills\//);
    if (!m) continue;
    const adoptId = m[1].replace(/^trial_/, "");
    if (packageKeys.has(`${adoptId}:${skillId}`)) continue;
    out.push({ adoptId, skillId, path: p, reason: "runtime skill has no package-index source row" });
  }
  return out;
}

const packages = readJson<any[]>(packageIndexPath, []);
const registry = readJson<Skill[]>(registryPath, []);
const runtimeOnlyBuiltinAllowlist = readBuiltinAllowlist();
const runtimeDirs = walkSkillDirs();
const now = new Date().toISOString();
const existingKeys = new Set(registry.map((x) => `${x.adoptId}:${x.id}`));
const packageKeys = new Set<string>();
const allPackageKeys = new Set<string>();
const createRows: Skill[] = [];
const runtimeOnlyAllowlistedRows: Skill[] = [];
const corrupted: Array<{ adoptId: string; filename?: string; reason: string }> = [];
const adoptExistsCache = new Map<string, boolean>();

async function adoptExists(adoptId: string): Promise<boolean> {
  if (adoptExistsCache.has(adoptId)) return adoptExistsCache.get(adoptId)!;
  const claw = await getClawByAdoptId(adoptId).catch(() => null);
  const ok = !!claw;
  adoptExistsCache.set(adoptId, ok);
  return ok;
}

function includeAdopt(adoptId: string): boolean {
  if (ADOPT_ID_FILTER) return adoptId === ADOPT_ID_FILTER;
  return true;
}

for (const row of Array.isArray(packages) ? packages : []) {
  const adoptId = String(row?.adoptId || "").trim();
  const skillId = String(row?.installedSkillId || "").trim();
  if (adoptId && skillId) allPackageKeys.add(`${adoptId}:${skillId}`);
  if (adoptId && !includeAdopt(adoptId)) continue;
  if (!adoptId || !skillId) {
    if (adoptId || row?.filename) corrupted.push({ adoptId, filename: row?.filename, reason: "missing adoptId or installedSkillId" });
    continue;
  }
  if (!(await adoptExists(adoptId))) {
    corrupted.push({ adoptId, filename: row?.filename, reason: "adoptId not found in database" });
    continue;
  }
  packageKeys.add(`${adoptId}:${skillId}`);
  if (existingKeys.has(`${adoptId}:${skillId}`)) continue;
  const sourcePath = String(row?.path || "").trim();
  if (!sourcePath || !existsSync(sourcePath)) {
    corrupted.push({ adoptId, filename: row?.filename, reason: "source package file missing" });
    continue;
  }
  const runtimePath = findRuntimePath(runtimeDirs, adoptId, skillId);
  const sourceStats = safeStat(sourcePath);
  const runtimeStats = safeStat(runtimePath);
  createRows.push({
    id: skillId,
    adoptId,
    source: {
      kind: row?.fromMarket ? "marketplace" : "uploaded",
      skillId,
      displayName: String(row?.displayName || row?.manifest?.name || skillId),
      description: String(row?.displayDescription || row?.manifest?.description || ""),
      sourcePath,
      marketplaceId: row?.fromMarket ? String(row.fromMarket) : undefined,
      version: row?.manifest?.version ? String(row.manifest.version) : undefined,
    },
    state: runtimePath ? "ready" : "sync_failed",
    enabled: true,
    review: { state: "none" },
    sync: {
      runtimePath,
      sourceMtimeMs: sourceStats.mtimeMs,
      sourceSizeBytes: sourceStats.size,
      runtimeMtimeMs: runtimeStats.mtimeMs,
      runtimeSizeBytes: runtimeStats.size,
      reason: runtimePath ? undefined : "runtime copy not found during migration",
    },
    capabilities: [],
    examples: [],
    createdAt: String(row?.createdAt || now),
    updatedAt: now,
  });
}

const runtimeOnly = inferRuntimeOnly(runtimeDirs, allPackageKeys);
const filteredRuntimeOnly = runtimeOnly.filter((row) => includeAdopt(row.adoptId));

if (CLASSIFY_RUNTIME_ONLY !== "skip" && CLASSIFY_RUNTIME_ONLY !== "builtin-allowlist") {
  console.error(`[SKILL-MIGRATE] unsupported --classify-runtime-only=${CLASSIFY_RUNTIME_ONLY}`);
  console.error("[SKILL-MIGRATE] expected one of: skip, builtin-allowlist");
  process.exit(1);
}

if (CLASSIFY_RUNTIME_ONLY === "builtin-allowlist") {
  for (const row of filteredRuntimeOnly) {
    if (!runtimeOnlyBuiltinAllowlist.has(row.skillId)) continue;
    if (existingKeys.has(`${row.adoptId}:${row.skillId}`)) continue;
    const sourceStats = safeStat(row.path);
    const { displayName, description } = parseSkillMetadata(row.path, row.skillId);
    runtimeOnlyAllowlistedRows.push({
      id: row.skillId,
      adoptId: row.adoptId,
      source: {
        kind: "builtin",
        skillId: row.skillId,
        displayName,
        description,
        sourcePath: row.path,
      },
      state: "ready",
      enabled: true,
      review: { state: "none" },
      sync: {
        runtimePath: row.path,
        sourceMtimeMs: sourceStats.mtimeMs,
        sourceSizeBytes: sourceStats.size,
        runtimeMtimeMs: sourceStats.mtimeMs,
        runtimeSizeBytes: sourceStats.size,
        lastSyncedAt: now,
        reason: "runtime-only builtin allowlist migration",
      },
      capabilities: [],
      examples: [],
      createdAt: now,
      updatedAt: now,
    });
  }
}

console.log(`[SKILL-MIGRATE] package rows: ${Array.isArray(packages) ? packages.length : 0}`);
console.log(`[SKILL-MIGRATE] existing registry rows: ${registry.length}`);
console.log(`[SKILL-MIGRATE] openclaw home: ${OPENCLAW_HOME}`);
console.log(`[SKILL-MIGRATE] adopt scope: ${ADOPT_ID_FILTER || (ALL_ADOPTS ? "all" : "all (default dry-run)")}`);
console.log(`[SKILL-MIGRATE] builtin allowlist path: ${builtinAllowlistPath}`);
console.log(`[SKILL-MIGRATE] builtin allowlist size: ${runtimeOnlyBuiltinAllowlist.size}`);
console.log(`[SKILL-MIGRATE] runtime skill dirs scanned: ${runtimeDirs.size}`);
console.log(`[SKILL-MIGRATE] new unambiguous registry rows: ${createRows.length}`);
console.log(`[SKILL-MIGRATE] runtime-only classification: ${CLASSIFY_RUNTIME_ONLY}`);
console.log(`[SKILL-MIGRATE] reconcile after apply: ${RECONCILE_AFTER_APPLY ? "yes" : "no"}`);
console.log(`[SKILL-MIGRATE] runtime-only allowlisted builtin rows: ${runtimeOnlyAllowlistedRows.length}`);
console.log(`[SKILL-MIGRATE] corrupted package rows: ${corrupted.length}`);
console.log(`[SKILL-MIGRATE] runtime-only skills: ${filteredRuntimeOnly.length}${ADOPT_ID_FILTER ? ` (filtered from ${runtimeOnly.length})` : ""}`);

if (createRows.length) {
  console.log("[SKILL-MIGRATE] rows to create:");
  for (const row of createRows.slice(0, 30)) {
    console.log(`  - ${row.adoptId}/${row.id} source=${row.source.kind} state=${row.state}`);
  }
  if (createRows.length > 30) console.log(`  ... ${createRows.length - 30} more`);
}

if (corrupted.length) {
  console.log("[SKILL-MIGRATE] corrupted rows requiring manual action:");
  for (const row of corrupted.slice(0, 30)) console.log(`  - ${row.adoptId || "(no adopt)"}/${row.filename || "(no file)"}: ${row.reason}`);
  if (corrupted.length > 30) console.log(`  ... ${corrupted.length - 30} more`);
}

if (filteredRuntimeOnly.length) {
  console.log("[SKILL-MIGRATE] runtime-only skills not auto-migrated:");
  const skipped = filteredRuntimeOnly.filter((row) => !runtimeOnlyBuiltinAllowlist.has(row.skillId));
  for (const row of skipped.slice(0, 30)) console.log(`  - ${row.adoptId}/${row.skillId}: ${row.reason}`);
  if (skipped.length > 30) console.log(`  ... ${skipped.length - 30} more`);
}

if (runtimeOnlyAllowlistedRows.length) {
  console.log("[SKILL-MIGRATE] runtime-only builtin allowlist rows to create:");
  for (const row of runtimeOnlyAllowlistedRows.slice(0, 30)) {
    console.log(`  - ${row.adoptId}/${row.id} source=builtin state=${row.state} displayName=${row.source.displayName}`);
  }
  if (runtimeOnlyAllowlistedRows.length > 30) console.log(`  ... ${runtimeOnlyAllowlistedRows.length - 30} more`);
}

if (!APPLY) {
  console.log("[SKILL-MIGRATE] dry-run only. Re-run with --apply and either --adoptId=<id> or --all-adopts to create rows.");
  process.exit(0);
}

if (!ADOPT_ID_FILTER && !ALL_ADOPTS) {
  console.error("[SKILL-MIGRATE] refusing --apply without explicit --adoptId=<id> or --all-adopts");
  process.exit(1);
}

if (createRows.length) {
  writeJson(registryPath, [...registry, ...createRows, ...runtimeOnlyAllowlistedRows]);
} else if (runtimeOnlyAllowlistedRows.length) {
  writeJson(registryPath, [...registry, ...runtimeOnlyAllowlistedRows]);
}
console.log(`[SKILL-MIGRATE] applied: created ${createRows.length + runtimeOnlyAllowlistedRows.length} registry rows`);

if (RECONCILE_AFTER_APPLY) {
  const { skillRegistry } = await import("../server/_core/skills/skill-registry");
  const adoptIds = [...new Set([...createRows, ...runtimeOnlyAllowlistedRows].map((row) => row.adoptId))];
  console.log(`[SKILL-MIGRATE] reconcile-after-apply adopts: ${adoptIds.length}`);
  let failed = 0;
  for (const adoptId of adoptIds) {
    const result = await skillRegistry.reconcile(adoptId);
    if (!result.ok) {
      failed++;
      console.error(`[SKILL-MIGRATE] reconcile failed for ${adoptId}: ${result.error.kind} ${result.error.detail}`);
      continue;
    }
    console.log(
      `[SKILL-MIGRATE] reconciled ${adoptId}: scanned=${result.value.scanned} changed=${result.value.changed} failed=${result.value.failed}`
    );
    if (result.value.failed > 0) failed++;
  }
  if (failed > 0) {
    console.warn(`[SKILL-MIGRATE] reconcile completed with ${failed} adopt(s) reporting failures`);
  }
}
process.exit(0);
