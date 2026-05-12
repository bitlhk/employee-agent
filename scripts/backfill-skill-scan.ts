import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { Skill } from "../shared/types/skill";
import { parseSkillPackageBuffer, parseSkillSourceFiles } from "../server/_core/skills/skill-source";

const APP_ROOT = process.env.APP_ROOT || process.cwd();
const registryPath = process.env.SKILL_REGISTRY_PATH || path.join(APP_ROOT, "data", "skill-registry.json");
const APPLY = process.argv.includes("--apply");

async function scanSource(sourcePath?: string): Promise<{ warnings: string[]; scannedAt: string }> {
  const scannedAt = new Date().toISOString();
  if (!sourcePath || !existsSync(sourcePath)) return { warnings: [], scannedAt };
  const stat = await import("fs").then((fs) => fs.statSync(sourcePath));
  if (stat.isDirectory()) {
    const files: Array<{ path: string; content: string }> = [];
    const walk = async (dir: string, prefix = "") => {
      const fs = await import("fs");
      const path = await import("path");
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(p, rel);
        } else {
          files.push({ path: rel, content: fs.readFileSync(p, "utf-8") });
        }
      }
    };
    await walk(sourcePath);
    return { warnings: parseSkillSourceFiles(files, sourcePath).warnings, scannedAt };
  }
  return { warnings: (await parseSkillPackageBuffer(readFileSync(sourcePath), sourcePath)).warnings, scannedAt };
}

async function main() {
  const rows = JSON.parse(readFileSync(registryPath, "utf-8")) as Skill[];
  let changed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.scan?.scannedAt) continue;
    try {
      row.scan = await scanSource(row.source.sourcePath);
      changed++;
    } catch (e: any) {
      row.scan = { warnings: [`scan failed: ${e?.message || String(e)}`], scannedAt: new Date().toISOString() };
      changed++;
      failed++;
    }
  }
  console.log(`[SKILL-SCAN-BACKFILL] rows=${rows.length} changed=${changed} failed=${failed} apply=${APPLY}`);
  if (APPLY && changed > 0) writeFileSync(registryPath, JSON.stringify(rows, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
