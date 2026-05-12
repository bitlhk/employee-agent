#!/usr/bin/env -S npx tsx
/**
 * backfill-cron-delivery-config.ts
 *
 * Backfill data/cron-delivery-config.json for existing OpenClaw cron jobs.
 *
 * Default mode is read-only:
 *   pnpm tsx scripts/backfill-cron-delivery-config.ts --dry-run
 *
 * Apply after manually reviewing the dry-run output:
 *   pnpm tsx scripts/backfill-cron-delivery-config.ts --apply --channel=wechat
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";

type DeliveryConfig = {
  adoptId: string;
  jobId?: string;
  jobName: string;
  channel: string;
  lastDeliveredRunTs?: number;
  failCount?: number;
  lastFailedAt?: number;
  disabled?: boolean;
};

type OpenClawJob = {
  id?: string;
  name?: string;
  agentId?: string;
  createdAtMs?: number;
  createdAt?: string;
};

const APP_ROOT = process.env.APP_ROOT || process.cwd();
const CONFIG_PATH = process.env.CRON_DELIVERY_CONFIG_PATH || path.join(APP_ROOT, "data", "cron-delivery-config.json");
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY_RUN = argv.includes("--dry-run") || !APPLY;
const CHANNEL = stringArg("--channel", "wechat");

function stringArg(name: string, fallback: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || fallback;
  const idx = argv.indexOf(name);
  if (idx >= 0) return (argv[idx + 1] || "").trim() || fallback;
  return fallback;
}

function readConfigs(): DeliveryConfig[] {
  if (!existsSync(CONFIG_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${err?.message || err}`);
  }
}

function writeConfigs(configs: DeliveryConfig[]) {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(configs, null, 2)}\n`, "utf8");
}

function readOpenClawJobs(): OpenClawJob[] {
  const out = execFileSync("openclaw", ["cron", "list", "--json"], {
    timeout: 15_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
  const parsed = JSON.parse(out);
  return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
}

function createdLabel(job: OpenClawJob) {
  if (typeof job.createdAtMs === "number" && Number.isFinite(job.createdAtMs)) {
    return new Date(job.createdAtMs).toISOString().slice(0, 10);
  }
  if (typeof job.createdAt === "string" && job.createdAt) return job.createdAt.slice(0, 10);
  return "unknown";
}

function hasConfig(configs: DeliveryConfig[], adoptId: string, job: OpenClawJob) {
  const jobId = String(job.id || "");
  const jobName = String(job.name || "");
  return configs.some((cfg) =>
    cfg.adoptId === adoptId &&
    ((jobId && cfg.jobId === jobId) || (!cfg.jobId && jobName && cfg.jobName === jobName))
  );
}

function findLegacyConfigWithoutJobId(configs: DeliveryConfig[], adoptId: string, job: OpenClawJob) {
  const jobName = String(job.name || "");
  if (!jobName || !job.id) return undefined;
  return configs.find((cfg) => cfg.adoptId === adoptId && !cfg.jobId && cfg.jobName === jobName);
}

async function main() {
  if (!["wechat", "feishu", "wecom"].includes(CHANNEL)) {
    throw new Error(`Unsupported --channel=${CHANNEL}; expected wechat, feishu, or wecom`);
  }

  const { listClawAdoptionsAdmin } = await import("../server/db");
  const jobs = readOpenClawJobs();
  const configs = readConfigs();
  // Use all adoption rows for mapping. Some legacy OpenClaw jobs can outlive
  // the UI-visible "active" status; dry-run should surface those instead of
  // silently treating them as unmapped.
  const adoptions = await listClawAdoptionsAdmin({ status: "all", limit: 1000 });

  const agentToAdopt = new Map<string, string>();
  for (const claw of adoptions) {
    const adoptId = String(claw.adoptId || "");
    const agentId = String(claw.agentId || "");
    if (!adoptId) continue;
    if (agentId) agentToAdopt.set(agentId, adoptId);
    agentToAdopt.set(`trial_${adoptId}`, adoptId);
    agentToAdopt.set(adoptId, adoptId);
  }

  const missing: Array<{ job: OpenClawJob; adoptId: string }> = [];
  const legacyMatches: Array<{ job: OpenClawJob; adoptId: string; config: DeliveryConfig }> = [];
  const unmapped: OpenClawJob[] = [];

  for (const job of jobs) {
    const agentId = String(job.agentId || "");
    const adoptId = agentToAdopt.get(agentId);
    if (!adoptId) {
      unmapped.push(job);
      continue;
    }
    const legacy = findLegacyConfigWithoutJobId(configs, adoptId, job);
    if (legacy) legacyMatches.push({ job, adoptId, config: legacy });
    if (!hasConfig(configs, adoptId, job)) missing.push({ job, adoptId });
  }

  console.log(`[BACKFILL] scanned ${jobs.length} cron jobs`);
  console.log(`[BACKFILL] ${missing.length} missing delivery config:`);
  for (const item of missing) {
    console.log(`  - ${item.adoptId}/${item.job.name || item.job.id || "unknown"} (created ${createdLabel(item.job)})`);
  }
  console.log(`[BACKFILL] ${legacyMatches.length} legacy configs missing jobId:`);
  for (const item of legacyMatches) {
    console.log(`  - ${item.adoptId}/${item.config.jobName} -> ${item.job.id}`);
  }
  if (unmapped.length > 0) {
    console.log(`[BACKFILL] ${unmapped.length} jobs skipped because agentId could not map to a known adoptId:`);
    for (const job of unmapped.slice(0, 20)) {
      console.log(`  - agentId=${job.agentId || "-"} job=${job.name || job.id || "unknown"}`);
    }
    if (unmapped.length > 20) console.log(`  ... ${unmapped.length - 20} more`);
  }
  console.log(`[BACKFILL] ${DRY_RUN ? "would default" : "defaulting"} to ${CHANNEL} for all missing configs (override with --channel=feishu)`);

  if (DRY_RUN) {
    console.log("[BACKFILL] dry-run only; rerun with --apply after reviewing the list");
    return;
  }

  if (missing.length === 0 && legacyMatches.length === 0) {
    console.log("[BACKFILL] nothing to apply");
    return;
  }

  const next = [...configs];
  for (const item of legacyMatches) {
    item.config.jobId = item.job.id ? String(item.job.id) : undefined;
  }
  for (const item of missing) {
    next.push({
      adoptId: item.adoptId,
      jobId: item.job.id ? String(item.job.id) : undefined,
      jobName: String(item.job.name || item.job.id || "未命名定时任务"),
      channel: CHANNEL,
    });
  }
  writeConfigs(next);
  console.log(`[BACKFILL] applied ${missing.length} config rows and updated ${legacyMatches.length} legacy rows in ${CONFIG_PATH}`);
}

main().then(() => {
  // Drizzle/MySQL keeps sockets open; scripts should terminate deterministically.
  process.exit(0);
}).catch((err) => {
  console.error(`[BACKFILL] failed: ${err?.message || err}`);
  process.exit(1);
});
