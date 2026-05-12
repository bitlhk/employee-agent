import "dotenv/config";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";
import type { Skill } from "../shared/types/skill";

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
const CLEANUP_SOURCE = process.argv.includes("--cleanup-source");
const ADOPT_ID = process.argv.find((arg) => arg.startsWith("--adoptId="))?.split("=")[1]?.trim();

if (!ADOPT_ID) {
  console.error("[SKILL-REALIGN] missing --adoptId=<id>");
  process.exit(1);
}

type OpenClawAgentEntry = { id?: string; workspace?: string; skills?: string[]; [key: string]: unknown };
type OpenClawConfig = { agents?: { list?: OpenClawAgentEntry[]; [key: string]: unknown }; [key: string]: unknown };

type RealignItem = {
  adoptId: string;
  skillId: string;
  current?: string;
  target: string;
  sourcePath?: string;
  sourceKind: string;
  action: "copy" | "already_target" | "missing_source";
};

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

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const backup = `${filePath}.bak-skill-realign-${Date.now()}`;
  if (existsSync(filePath)) cpSync(filePath, backup);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

function resolveWorkspacePath(workspace: string): string {
  const value = String(workspace || "").trim();
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.join(OPENCLAW_HOME, value);
}

function findAgentEntry(config: OpenClawConfig, adoptId: string, runtimeAgentId: string): OpenClawAgentEntry | null {
  const list = Array.isArray(config?.agents?.list) ? config.agents!.list! : [];
  const candidates = new Set([runtimeAgentId, adoptId, `trial_${adoptId}`].filter(Boolean));
  return list.find((entry) => candidates.has(String(entry?.id || ""))) || null;
}

function runtimeAgentIdForAdopt(adoptId: string, config?: OpenClawConfig): string {
  const list = Array.isArray(config?.agents?.list) ? config!.agents!.list! : [];
  const direct = list.find((entry) => String(entry?.id || "") === adoptId || String(entry?.id || "") === `trial_${adoptId}`);
  return String(direct?.id || `trial_${adoptId}`);
}

async function main() {
  const registryPath = path.join(APP_ROOT, "data", "skill-registry.json");
  const openclawConfigPath = path.join(OPENCLAW_HOME, "openclaw.json");
  const registry = readJson<Skill[]>(registryPath, []);
  const config = readJson<OpenClawConfig>(openclawConfigPath, {});
  const runtimeAgentId = runtimeAgentIdForAdopt(ADOPT_ID!, config);
  const agentEntry = findAgentEntry(config, ADOPT_ID!, runtimeAgentId);
  const workspace = resolveWorkspacePath(String(agentEntry?.workspace || ""));
  if (!workspace) {
    console.error("[SKILL-REALIGN] target OpenClaw agent workspace not found", { adoptId: ADOPT_ID, runtimeAgentId });
    process.exit(1);
  }
  const targetRoot = path.join(workspace, "skills");
  const rows = registry.filter((skill) => skill.adoptId === ADOPT_ID);
  const items: RealignItem[] = [];

  for (const skill of rows) {
    const target = path.join(targetRoot, skill.id);
    const current = skill.sync?.runtimePath;
    if (current === target) {
      items.push({ adoptId: skill.adoptId, skillId: skill.id, current, target, sourcePath: skill.source.sourcePath, sourceKind: skill.source.kind, action: "already_target" });
      continue;
    }
    const copySource = current && existsSync(current) ? current : skill.source.sourcePath;
    items.push({
      adoptId: skill.adoptId,
      skillId: skill.id,
      current,
      target,
      sourcePath: skill.source.sourcePath,
      sourceKind: skill.source.kind,
      action: copySource && existsSync(copySource) ? "copy" : "missing_source",
    });
  }

  const misaligned = items.filter((item) => item.action !== "already_target");
  console.log(`[SKILL-REALIGN] adoptId=${ADOPT_ID} runtimeAgentId=${runtimeAgentId}`);
  console.log(`[SKILL-REALIGN] target workspace: ${workspace}`);
  console.log(`[SKILL-REALIGN] Total registry entries scanned: ${rows.length}`);
  console.log(`[SKILL-REALIGN] Misaligned entries: ${misaligned.length}`);
  for (const item of misaligned) {
    console.log(`  - ${item.adoptId}/${item.skillId} (${item.sourceKind})`);
    console.log(`      current: ${item.current || "<none>"}`);
    console.log(`      source:  ${item.sourcePath || "<none>"}`);
    console.log(`      target:  ${item.target}`);
    console.log(`      action:  ${item.action}`);
  }

  if (!APPLY) {
    console.log("[SKILL-REALIGN] dry-run only. Re-run with --apply to copy and update registry.");
    return;
  }

  let changed = 0;
  const next = registry.map((skill) => {
    const item = items.find((x) => x.skillId === skill.id && x.adoptId === skill.adoptId);
    if (!item || item.action === "already_target") return skill;
    if (item.action === "missing_source") return { ...skill, state: "sync_failed" as const, sync: { ...skill.sync, reason: "runtime realign source missing" }, updatedAt: new Date().toISOString() };

    const copySource = item.current && existsSync(item.current) ? item.current : item.sourcePath!;
    rmSync(item.target, { recursive: true, force: true });
    mkdirSync(path.dirname(item.target), { recursive: true });
    cpSync(copySource, item.target, { recursive: true });
    if (CLEANUP_SOURCE && item.current && item.current !== item.target && existsSync(item.current)) {
      const disabledRoot = path.join(path.dirname(item.current), ".realigned-disabled");
      mkdirSync(disabledRoot, { recursive: true });
      renameSync(item.current, path.join(disabledRoot, `${path.basename(item.current)}-${Date.now()}`));
    }
    changed++;
    const nextSource = skill.source.kind === "builtin" && skill.source.sourcePath === item.current
      ? { ...skill.source, sourcePath: item.target }
      : skill.source;
    return {
      ...skill,
      source: nextSource,
      state: skill.enabled ? "ready" as const : "disabled" as const,
      sync: { ...skill.sync, runtimePath: item.target, lastSyncedAt: new Date().toISOString(), reason: "runtime path realigned to OpenClaw agent.workspace" },
      updatedAt: new Date().toISOString(),
    };
  });

  writeJsonAtomic(registryPath, next);
  console.log(`[SKILL-REALIGN] applied. changed=${changed}. cleanupSource=${CLEANUP_SOURCE}`);
}

main().catch((e) => {
  console.error("[SKILL-REALIGN] failed", e);
  process.exit(1);
});
