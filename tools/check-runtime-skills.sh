#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="${1:-server/_core/agent/data/agent-manifests.seed.json}"
DEFAULT_SKILL_ROOT="/home/ubuntu/.employee-agent/hermes-runtime-skills/anthropic-financial-services/current"
LEGACY_SKILL_ROOT="/home/ubuntu/.lingxia/hermes-runtime-skills/anthropic-financial-services/current"
SKILL_ROOT="${HERMES_RUNTIME_SKILL_ROOT:-$DEFAULT_SKILL_ROOT}"
if [[ -z "${HERMES_RUNTIME_SKILL_ROOT:-}" && ! -d "$SKILL_ROOT" && -d "$LEGACY_SKILL_ROOT" ]]; then
  SKILL_ROOT="$LEGACY_SKILL_ROOT"
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "manifest file not found: $MANIFEST_PATH" >&2
  exit 1
fi

if [[ ! -d "$SKILL_ROOT" ]]; then
  echo "runtime skill root not found: $SKILL_ROOT" >&2
  exit 1
fi

node - "$MANIFEST_PATH" "$SKILL_ROOT" <<'NODE'
const fs = require("fs");
const path = require("path");

const manifestPath = process.argv[2];
const skillRoot = process.argv[3];
const seed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const missing = [];
const checked = [];
const commits = new Set();

for (const manifest of seed.manifests || []) {
  const bundle = manifest.runtimeSkillBundle || {};
  if (bundle.commit) commits.add(bundle.commit);
  const skills = [
    ...((manifest.orchestrator && manifest.orchestrator.skills) || []),
    ...((manifest.workers || []).flatMap((worker) => worker.skills || [])),
  ];
  for (const skill of skills) {
    if (!skill || !skill.path) continue;
    const skillFile = path.join(skillRoot, skill.path, "SKILL.md");
    checked.push(`${manifest.id}:${skill.pluginId}/${skill.id}`);
    if (!fs.existsSync(skillFile)) missing.push(skillFile);
  }
}

console.log(`runtime skill root: ${skillRoot}`);
console.log(`manifest: ${manifestPath}`);
console.log(`commit refs: ${[...commits].join(", ") || "none"}`);
console.log(`checked skills: ${checked.length}`);

if (missing.length) {
  console.error("missing SKILL.md files:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log("runtime skills check passed");
NODE
