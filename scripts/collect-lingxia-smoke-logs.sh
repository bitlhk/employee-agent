#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
RUN_ID="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${LINGGAN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
STATE_DIR="${SMOKE_STATE_DIR:-/tmp/lingxia-smoke}"
LOG_DIR="${SMOKE_LOG_DIR:-/tmp/lingxia-smoke-logs}"
PM2_LOG_ROOT="${PM2_LOG_ROOT:-${HOME}/.pm2/logs}"

if [[ -z "$ACTION" || -z "$RUN_ID" ]]; then
  echo "Usage: $0 start|finish SMOKE-RUN-ID" >&2
  exit 2
fi

mkdir -p "$STATE_DIR" "$LOG_DIR"

STATE_FILE="$STATE_DIR/$RUN_ID.env"
OUT_FILE="$LOG_DIR/$RUN_ID.log"

critical_pattern='CRON-LEGACY|CRON-RUNS-LEGACY|using legacy notify fallback|Unsupported channel|CRON-ORPHAN|CRON-DELIVERY|CRON-WATCHER|CHAT-DEDUP|VERSION-DOWNGRADE|SKILL-REGISTRY|SKILL-RECONCILE|SKILL-MARKET|thinking|<think|recover.*failed|send failed|auth_failed|channel_unreachable|sync_failed|ERROR|Error'

current_log_files() {
  find "$PM2_LOG_ROOT" -maxdepth 1 -type f \
    \( -name 'linggan-claw*.log' -o -name 'hi-agent*.log' -o -name 'agent-kernel*.log' \) \
    ! -name '*__*.log' \
    2>/dev/null | sort
}

case "$ACTION" in
  start)
    {
      echo "RUN_ID=$RUN_ID"
      echo "START_ISO=$(date -Is)"
      echo "START_EPOCH=$(date +%s)"
      echo "ROOT=$ROOT"
    } > "$STATE_FILE"

    {
      echo "== Lingxia smoke log window start =="
      cat "$STATE_FILE"
      echo
      echo "== Baseline =="
      cd "$ROOT"
      openclaw --version || true
      git rev-parse --short HEAD 2>/dev/null || true
      echo
      echo "== Backend readiness fast =="
      scripts/check-openclaw-upgrade-readiness.sh || true
      echo
      echo "== Marker =="
      echo "[SMOKE][$RUN_ID] start $(date -Is)"
    } > "$OUT_FILE"

    echo "$OUT_FILE"
    ;;

  finish)
    if [[ ! -f "$STATE_FILE" ]]; then
      echo "Missing smoke state file: $STATE_FILE" >&2
      exit 1
    fi

    # shellcheck disable=SC1090
    source "$STATE_FILE"

    {
      echo
      echo "== Lingxia smoke log window finish =="
      echo "RUN_ID=$RUN_ID"
      echo "START_ISO=$START_ISO"
      echo "FINISH_ISO=$(date -Is)"
      echo

      echo "== Current PM2 critical lines =="
      mapfile -t files < <(current_log_files)
      if [[ "${#files[@]}" -gt 0 ]]; then
        tail -n 12000 "${files[@]}" 2>/dev/null | grep -E "$critical_pattern" | tail -200 || true
      else
        echo "No current PM2 log files found."
      fi
      echo

      echo "== Backend readiness fast after smoke =="
      cd "$ROOT"
      scripts/check-openclaw-upgrade-readiness.sh || true
      echo

      echo "== Summary hints =="
      echo "Inspect critical lines above. Expected: no thinking leak, no unsupported channel, no legacy fallback, no unexpected send/auth failures."
    } >> "$OUT_FILE"

    echo "$OUT_FILE"
    ;;

  *)
    echo "Unknown action: $ACTION" >&2
    exit 2
    ;;
esac
