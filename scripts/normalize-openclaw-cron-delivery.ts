#!/usr/bin/env -S npx tsx
/**
 * normalize-openclaw-cron-delivery.ts
 *
 * Normalize existing OpenClaw cron jobs so OpenClaw only executes the agent
 * turn. Lingxia owns channel delivery through cron-delivery + ChannelProvider.
 *
 * Default mode is read-only:
 *   pnpm tsx scripts/normalize-openclaw-cron-delivery.ts --dry-run
 *
 * Apply after reviewing the dry-run output:
 *   pnpm tsx scripts/normalize-openclaw-cron-delivery.ts --apply
 */

import "dotenv/config";
import { createOpenClawRuntimeAdapter } from "../server/_core/runtime";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY_RUN = argv.includes("--dry-run") || !APPLY;

function needsNormalization(job: any): boolean {
  const delivery = job?.delivery || {};
  const mode = String(delivery.mode || "");
  const unsupportedMode = mode && mode !== "none";
  const staleRoutingFields = mode === "none" && (
    delivery.channel !== undefined ||
    delivery.to !== undefined ||
    delivery.account !== undefined ||
    delivery.accountId !== undefined
  );
  return unsupportedMode || staleRoutingFields;
}

function deliveryLabel(job: any): string {
  const delivery = job?.delivery || {};
  return JSON.stringify({
    mode: delivery.mode,
    channel: delivery.channel,
    to: delivery.to,
  });
}

async function main() {
  const runtime = createOpenClawRuntimeAdapter();
  const list = runtime.callRpc<any>("cron.list", { includeDisabled: true });
  const jobs = Array.isArray(list?.jobs) ? list.jobs : [];
  const dirty = jobs.filter(needsNormalization);

  console.log(`[NORMALIZE] scanned ${jobs.length} OpenClaw cron jobs`);
  console.log(`[NORMALIZE] ${dirty.length} jobs need delivery normalization`);
  for (const job of dirty) {
    console.log(`  - ${job.id} ${job.name || "(unnamed)"} agent=${job.agentId || "-"} delivery=${deliveryLabel(job)}`);
  }

  if (DRY_RUN) {
    console.log("[NORMALIZE] dry-run only; rerun with --apply after reviewing the list");
    return;
  }

  for (const job of dirty) {
    runtime.callRpc("cron.update", {
      id: String(job.id),
      patch: { delivery: { mode: "none" } },
    });
    console.log(`[NORMALIZE] normalized ${job.id} ${job.name || "(unnamed)"}`);
  }
  console.log(`[NORMALIZE] applied ${dirty.length} updates`);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(`[NORMALIZE] failed: ${err?.message || err}`);
  process.exit(1);
});
