#!/usr/bin/env -S npx tsx
/**
 * scan-cron-orphans.ts
 *
 * Read-only reconciliation report for OpenClaw cron jobs and Lingxia
 * cron-delivery sidecar rows.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import { createOpenClawRuntimeAdapter } from "../server/_core/runtime";

type DeliveryConfig = {
  adoptId: string;
  jobId?: string;
  jobName: string;
  channel: string;
};

const APP_ROOT = process.env.APP_ROOT || process.cwd();
const CONFIG_PATH = process.env.CRON_DELIVERY_CONFIG_PATH || path.join(APP_ROOT, "data", "cron-delivery-config.json");

function readConfigs(): DeliveryConfig[] {
  if (!existsSync(CONFIG_PATH)) return [];
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

async function main() {
  const { listClawAdoptionsAdmin } = await import("../server/db");
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

  const runtime = createOpenClawRuntimeAdapter();
  const list = runtime.callRpc<any>("cron.list", { includeDisabled: true });
  const jobs = Array.isArray(list?.jobs) ? list.jobs : [];
  const configs = readConfigs();

  const jobIds = new Set(jobs.map((job: any) => String(job.id || "")).filter(Boolean));
  const configKeys = new Set(configs.map((cfg) => `${cfg.adoptId}:${cfg.jobId || ""}`));

  const jobsMissingConfig: any[] = [];
  const jobsUnmapped: any[] = [];
  for (const job of jobs) {
    const agentId = String(job.agentId || "");
    const adoptId = agentToAdopt.get(agentId);
    if (!adoptId) {
      jobsUnmapped.push(job);
      continue;
    }
    if (!configKeys.has(`${adoptId}:${String(job.id || "")}`)) {
      jobsMissingConfig.push({ ...job, adoptId });
    }
  }

  const sidecarOrphans = configs.filter((cfg) => cfg.jobId && !jobIds.has(cfg.jobId));
  const sidecarLegacy = configs.filter((cfg) => !cfg.jobId);

  console.log(`[ORPHAN-SCAN] OpenClaw jobs: ${jobs.length}`);
  console.log(`[ORPHAN-SCAN] sidecar rows: ${configs.length}`);
  console.log(`[ORPHAN-SCAN] jobs missing sidecar: ${jobsMissingConfig.length}`);
  for (const job of jobsMissingConfig) {
    console.log(`  - job=${job.id} adopt=${job.adoptId} name=${job.name || "(unnamed)"} agent=${job.agentId || "-"}`);
  }
  console.log(`[ORPHAN-SCAN] jobs with unmapped agentId: ${jobsUnmapped.length}`);
  for (const job of jobsUnmapped) {
    console.log(`  - job=${job.id} name=${job.name || "(unnamed)"} agent=${job.agentId || "-"}`);
  }
  console.log(`[ORPHAN-SCAN] sidecar rows whose jobId no longer exists: ${sidecarOrphans.length}`);
  for (const cfg of sidecarOrphans) {
    console.log(`  - adopt=${cfg.adoptId} jobId=${cfg.jobId} name=${cfg.jobName} channel=${cfg.channel}`);
  }
  console.log(`[ORPHAN-SCAN] legacy sidecar rows without jobId: ${sidecarLegacy.length}`);
  for (const cfg of sidecarLegacy) {
    console.log(`  - adopt=${cfg.adoptId} name=${cfg.jobName} channel=${cfg.channel}`);
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(`[ORPHAN-SCAN] failed: ${err?.message || err}`);
  process.exit(1);
});
