#!/usr/bin/env bash
# 手动更新存量 agent 的权限套餐
# 用法: bash update-agent-profile.sh <agent-id> <starter|plus|internal>
# 示例: bash update-agent-profile.sh trial_lgc-ofnmjm4joj plus

set -euo pipefail

AGENT_ID="${1:-}"
PROFILE="${2:-starter}"

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

OPENCLAW_HOME="$(normalize_openclaw_home "${CLAW_OPENCLAW_HOME:-${CLAW_REMOTE_OPENCLAW_HOME:-${HOME}}}")"
OPENCLAW_JSON="${OPENCLAW_HOME}/openclaw.json"

if [[ -z "$AGENT_ID" ]]; then
  echo "用法: $0 <agent-id> <starter|plus|internal>"
  exit 1
fi

if [[ ! "$PROFILE" =~ ^(starter|plus|internal)$ ]]; then
  echo "ERROR: profile 必须是 starter / plus / internal"
  exit 1
fi

echo "备份 openclaw.json..."
cp "$OPENCLAW_JSON" "$OPENCLAW_JSON.bak-$(date +%s)"

python3 - "$OPENCLAW_JSON" "$AGENT_ID" "$PROFILE" <<'PY'
import json, sys
path, agent_id, profile = sys.argv[1], sys.argv[2], sys.argv[3]
profile_map = {
    "starter": {
        "profile": "messaging",
        "allow": ["web_search", "web_fetch", "read"],
        "deny": ["exec","process","write","edit","cron","gateway","browser","nodes"],
        "fs": {"workspaceOnly": True}
    },
    "plus": {
        "profile": "coding",
        "deny": ["gateway","nodes","browser","cron","sessions_spawn"],
        "fs": {"workspaceOnly": True}
    },
    "internal": {"profile": "full"}
}
tools_cfg = profile_map.get(profile, profile_map["starter"])
with open(path) as f:
    d = json.load(f)
found = False
for a in d.get("agents", {}).get("list", []):
    if a.get("id") == agent_id:
        old = a.get("tools", {})
        a["tools"] = tools_cfg
        found = True
        print(f"  旧配置: {old}")
        print(f"  新配置: {tools_cfg}")
        break
if not found:
    print(f"ERROR: agent '{agent_id}' 不在 openclaw.json 里")
    sys.exit(1)
with open(path, "w") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print(f"OK: {agent_id} => {profile}")
PY

echo "完成！需要 reload openclaw gateway 生效（如有必要）"
