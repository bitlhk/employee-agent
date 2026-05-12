import "dotenv/config";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
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
const ADOPT_ID = process.argv.find((arg) => arg.startsWith("--adoptId="))?.split("=")[1]?.trim();

if (!ADOPT_ID) {
  console.error("[SKILL-ALLOWLIST] missing --adoptId=<id>");
  process.exit(1);
}

type OpenClawAgentEntry = { id?: string; workspace?: string; skills?: string[]; [key: string]: unknown };
type OpenClawConfig = { agents?: { list?: OpenClawAgentEntry[]; [key: string]: unknown }; [key: string]: unknown };

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

function readSkillRuntimeName(runtimePath: string | undefined, fallback: string): string {
  try {
    if (!runtimePath) return fallback;
    const manifestPath = path.join(runtimePath, "SKILL.md");
    if (!existsSync(manifestPath)) return fallback;
    const text = String(readFileSync(manifestPath, "utf-8") || "");
    const match = text.match(/(?:^|\n)\s*name\s*:\s*['"]?([^'"\n]+)['"]?/i);
    return String(match?.[1] || fallback).trim() || fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak-skill-allowlist-${Date.now()}`);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, filePath);
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
  const registry = readJson<Skill[]>(path.join(APP_ROOT, "data", "skill-registry.json"), []);
  const configPath = path.join(OPENCLAW_HOME, "openclaw.json");
  const config = readJson<OpenClawConfig>(configPath, {});
  const runtimeAgentId = runtimeAgentIdForAdopt(ADOPT_ID!, config);
  const agentEntry = findAgentEntry(config, ADOPT_ID!, runtimeAgentId);
  if (!agentEntry) {
    console.error("[SKILL-ALLOWLIST] target agent entry not found", { adoptId: ADOPT_ID, runtimeAgentId });
    process.exit(1);
  }
  const desired = Array.from(new Set(
    registry
      .filter((skill) => skill.adoptId === ADOPT_ID && skill.enabled && skill.state === "ready")
      .map((skill) => readSkillRuntimeName(skill.sync?.runtimePath, skill.id))
      .filter(Boolean)
  )).sort();
  const current = Array.isArray(agentEntry.skills)
    ? Array.from(new Set(agentEntry.skills.map((x) => String(x || "").trim()).filter(Boolean))).sort()
    : [];
  console.log(`[SKILL-ALLOWLIST] adoptId=${ADOPT_ID} runtimeAgentId=${runtimeAgentId}`);
  console.log(`[SKILL-ALLOWLIST] current (${current.length}): ${current.join(", ") || "<none>"}`);
  console.log(`[SKILL-ALLOWLIST] desired (${desired.length}): ${desired.join(", ") || "<none>"}`);

  const same = current.length === desired.length && current.every((id, i) => id === desired[i]);
  if (same) {
    console.log("[SKILL-ALLOWLIST] already in sync");
    return;
  }
  if (!APPLY) {
    console.log("[SKILL-ALLOWLIST] dry-run only. Re-run with --apply to update openclaw.json.");
    return;
  }
  agentEntry.skills = desired;
  writeJsonAtomic(configPath, config);
  console.log("[SKILL-ALLOWLIST] applied. OpenClaw Gateway restart is required if config hot reload is unavailable.");
}

main().catch((e) => {
  console.error("[SKILL-ALLOWLIST] failed", e);
  process.exit(1);
});
