#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

if [[ -f "${APP_ROOT}/.env" ]]; then
  set -a
  source "${APP_ROOT}/.env"
  set +a
fi

normalize_openclaw_home() {
  local raw="${1:-${HOME}}"
  raw="${raw/#\~/${HOME}}"
  if [[ "$(basename "$raw")" == ".openclaw" ]]; then
    echo "$raw"
  else
    echo "${raw}/.openclaw"
  fi
}

WORKSPACE_ROOT="$(normalize_openclaw_home "${CLAW_OPENCLAW_HOME:-${CLAW_REMOTE_OPENCLAW_HOME:-${HOME}}}")"
SHARED_SKILLS_DIR="${WORKSPACE_ROOT}/skills-shared"

cd "$APP_ROOT"

# 用 node 查数据库
agents=$(node -e '
const mysql = require("mysql2/promise");
(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute("SELECT agentId FROM claw_adoptions WHERE status = \"active\"");
  rows.forEach(r => console.log(r.agentId));
  await conn.end();
})();
')

if [[ -z "$agents" ]]; then
  echo "No active agents found"
  exit 0
fi

echo "Syncing skills for active agents..."
for agent in $agents; do
  userSkillsDir="$WORKSPACE_ROOT/workspace-$agent/skills"
  mkdir -p "$userSkillsDir"
  
  for skill in $SHARED_SKILLS_DIR/*/; do
    skillName=$(basename "$skill")
    ln -sfn "$skill" "$userSkillsDir/$skillName" 2>/dev/null && echo "  [$agent] linked: $skillName" || echo "  [$agent] failed: $skillName"
  done
done

echo "Done!"
