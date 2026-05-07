#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

read_env() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
  fi
}

expand_home() {
  local value="$1"
  if [[ "$value" == "~" ]]; then
    printf '%s\n' "$HOME"
  elif [[ "$value" == "~/"* ]]; then
    printf '%s/%s\n' "$HOME" "${value#~/}"
  else
    printf '%s\n' "$value"
  fi
}

normalize_openclaw_home() {
  local raw="$1"
  raw="$(expand_home "$raw")"
  if [[ -z "$raw" ]]; then
    raw="$HOME"
  fi
  if [[ "$(basename "$raw")" == ".openclaw" ]]; then
    printf '%s\n' "$raw"
  else
    printf '%s/.openclaw\n' "$raw"
  fi
}

ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; exit 1; }

[[ -f "$ENV_FILE" ]] || fail ".env not found at ${ENV_FILE}"

command -v node >/dev/null 2>&1 && ok "node: $(node --version)" || fail "node is not installed"
command -v pnpm >/dev/null 2>&1 && ok "pnpm: $(pnpm --version)" || fail "pnpm is not installed"
command -v openclaw >/dev/null 2>&1 && ok "openclaw: $(openclaw --version 2>/dev/null | head -1)" || fail "openclaw is not installed"

RAW_HOME="$(read_env CLAW_OPENCLAW_HOME)"
if [[ -z "$RAW_HOME" ]]; then
  RAW_HOME="$(read_env CLAW_REMOTE_OPENCLAW_HOME)"
fi
OC_HOME="$(normalize_openclaw_home "$RAW_HOME")"
OC_JSON="$(read_env CLAW_OPENCLAW_JSON)"
if [[ -z "$OC_JSON" ]]; then
  OC_JSON="${OC_HOME}/openclaw.json"
else
  OC_JSON="$(expand_home "$OC_JSON")"
fi

[[ -d "$OC_HOME" ]] || fail "OpenClaw home does not exist: ${OC_HOME}"
ok "OpenClaw home: ${OC_HOME}"

[[ -f "$OC_JSON" ]] || fail "openclaw.json not found: ${OC_JSON}"
ok "OpenClaw config: ${OC_JSON}"

ENV_TOKEN="$(read_env CLAW_GATEWAY_TOKEN)"
[[ -n "$ENV_TOKEN" ]] || fail "CLAW_GATEWAY_TOKEN is empty in .env"

python3 - "$OC_JSON" "$ENV_TOKEN" <<'PY'
import json
import sys

path, env_token = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    cfg = json.load(f)
token = str(((cfg.get("gateway") or {}).get("auth") or {}).get("token") or "")
bind = str((cfg.get("gateway") or {}).get("bind") or "")
origins = ((cfg.get("gateway") or {}).get("controlUi") or {}).get("allowedOrigins") or []
if not token:
    print("[FAIL] gateway.auth.token is empty in openclaw.json")
    sys.exit(1)
if token != env_token:
    print("[FAIL] CLAW_GATEWAY_TOKEN does not match openclaw.json gateway.auth.token")
    sys.exit(1)
print("[OK] gateway token matches")
if bind and bind != "lan":
    print(f"[WARN] gateway.bind is {bind!r}; lan is recommended for browser gateway access")
else:
    print("[OK] gateway bind is lan or unspecified")
print(f"[OK] allowed origins: {len(origins)} configured")
PY

PORT="$(read_env CLAW_GATEWAY_PORT)"
PORT="${PORT:-18789}"
HOST="$(read_env CLAW_REMOTE_HOST)"
HOST="${HOST:-127.0.0.1}"

if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://${HOST}:${PORT}/health" || true)"
  if [[ "$code" == "200" ]]; then
    ok "OpenClaw gateway health: http://${HOST}:${PORT}/health"
  else
    warn "OpenClaw gateway health did not return 200 on http://${HOST}:${PORT}/health (code=${code})"
  fi
else
  warn "curl not installed; skipped gateway health check"
fi

ok "local OpenClaw node check completed"
