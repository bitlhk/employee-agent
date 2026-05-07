#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
shift || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${LINGGAN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
REPORT_ROOT="${UPGRADE_SMOKE_REPORT_ROOT:-$ROOT/docs/testing/reports/openclaw-upgrade}"
PM2_LOG_ROOT="${PM2_LOG_ROOT:-${HOME}/.pm2/logs}"
RUN_ID=""
FULL=0
ADOPT_ID="${OPENCLAW_CONTRACT_AGENT:-lgc-ofnmjm4joj}"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-openclaw-upgrade-smoke.sh pre  [--run-id=UPG-...] [--full]
  scripts/run-openclaw-upgrade-smoke.sh post --run-id=UPG-... [--full]

Purpose:
  Capture an OpenClaw/Lingxia compatibility baseline before upgrade and compare
  the post-upgrade state against it.

Notes:
  - This script covers backend contracts, data baselines, and critical logs.
  - Browser release smoke is still required separately for UI/chat validation.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#--run-id=}" ;;
    --full) FULL=1 ;;
    --adoptId=*) ADOPT_ID="${arg#--adoptId=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[UPGRADE-SMOKE] unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

if [[ "$MODE" != "pre" && "$MODE" != "post" ]]; then
  usage
  exit 2
fi

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="UPG-$(date +%Y%m%d-%H%M%S)"
fi

cd "$ROOT"
mkdir -p "$REPORT_ROOT/$RUN_ID"

PHASE_DIR="$REPORT_ROOT/$RUN_ID/$MODE"
mkdir -p "$PHASE_DIR"

log() {
  echo "[UPGRADE-SMOKE] $*"
}

run_capture() {
  local name="$1"
  shift
  log "running $name"
  set +e
  "$@" >"$PHASE_DIR/$name.out" 2>"$PHASE_DIR/$name.err"
  local status=$?
  set -e
  echo "$status" >"$PHASE_DIR/$name.status"
  if [[ "$status" -ne 0 ]]; then
    log "$name failed with status=$status"
    tail -60 "$PHASE_DIR/$name.err" || true
    return "$status"
  fi
}

capture_openclaw_version() {
  {
    echo "time=$(date -Is)"
    echo "run_id=$RUN_ID"
    echo "phase=$MODE"
    echo "root=$ROOT"
    if command -v openclaw >/dev/null 2>&1; then
      echo "openclaw_version=$(openclaw --version 2>&1 || true)"
      echo "openclaw_bin=$(which openclaw 2>/dev/null || true)"
      echo "openclaw_realpath=$(readlink -f "$(which openclaw)" 2>/dev/null || true)"
    else
      echo "openclaw_version=not-found"
    fi
    echo "lingxia_git=$(git rev-parse --short HEAD 2>/dev/null || true)"
  } >"$PHASE_DIR/openclaw-version.txt"
}

capture_skill_summary() {
  if command -v jq >/dev/null 2>&1 && [[ -f data/skill-registry.json ]]; then
    jq -S '{
      total: length,
      states: ([.[] | .state] | group_by(.) | map({state: .[0], count: length})),
      sources: ([.[] | .source.kind] | group_by(.) | map({source: .[0], count: length})),
      warnings: ([.[] | select((.scan.warnings // []) | length > 0)] | length)
    }' data/skill-registry.json >"$PHASE_DIR/skill-registry-summary.json"
  else
    echo '{"error":"skill registry unavailable"}' >"$PHASE_DIR/skill-registry-summary.json"
  fi
}

capture_critical_logs() {
  mapfile -t LOG_FILES < <(
    find "$PM2_LOG_ROOT" -maxdepth 1 -type f \
      \( -name 'linggan-claw*.log' -o -name 'hi-agent*.log' -o -name 'agent-kernel*.log' \) \
      ! -name '*__*.log' \
      2>/dev/null | sort
  )

  if [[ "${#LOG_FILES[@]}" -eq 0 ]]; then
    echo "pm2 log files not found" >"$PHASE_DIR/critical-logs.txt"
    echo "0" >"$PHASE_DIR/critical-logs.count"
    return
  fi

  tail -n 12000 "${LOG_FILES[@]}" 2>/dev/null \
    | grep -E 'CRON-LEGACY|CRON-RUNS-LEGACY|using legacy notify fallback|Unsupported channel|CRON-ORPHAN|VERSION-DOWNGRADE|thinking|<think|recover.*failed|send failed|sync_failed|ERROR|Error' \
    | tail -120 >"$PHASE_DIR/critical-logs.txt" || true

  wc -l <"$PHASE_DIR/critical-logs.txt" | tr -d ' ' >"$PHASE_DIR/critical-logs.count"
}

capture_all() {
  capture_openclaw_version
  capture_skill_summary
  capture_critical_logs

  local readiness_mode="--fast"
  if [[ "$FULL" -eq 1 ]]; then
    readiness_mode="--full"
  fi

  run_capture "readiness" scripts/check-openclaw-upgrade-readiness.sh "$readiness_mode"
  run_capture "cron-orphans" pnpm tsx scripts/scan-cron-orphans.ts
  run_capture "skill-migrate-dry-run" pnpm tsx scripts/migrate-existing-skills.ts --dry-run --all-adopts --classify-runtime-only=builtin-allowlist
}

compare_file() {
  local rel="$1"
  local pre="$REPORT_ROOT/$RUN_ID/pre/$rel"
  local post="$REPORT_ROOT/$RUN_ID/post/$rel"
  if [[ ! -f "$pre" || ! -f "$post" ]]; then
    echo "[WARN] missing comparison target: $rel"
    return 0
  fi
  if diff -u "$pre" "$post" >"$REPORT_ROOT/$RUN_ID/diff-${rel//\//_}.txt"; then
    echo "[PASS] unchanged: $rel"
    return 0
  fi
  echo "[WARN] changed: $rel (see $REPORT_ROOT/$RUN_ID/diff-${rel//\//_}.txt)"
  return 0
}

post_decision() {
  local fail=0

  echo
  log "comparison for $RUN_ID"
  compare_file "skill-registry-summary.json"
  compare_file "cron-orphans.out"
  compare_file "skill-migrate-dry-run.out"

  local critical_count
  critical_count="$(cat "$PHASE_DIR/critical-logs.count" 2>/dev/null || echo 0)"
  if [[ "$critical_count" != "0" ]]; then
    echo "[WARN] post-upgrade critical log hits: $critical_count"
    echo "       inspect: $PHASE_DIR/critical-logs.txt"
  else
    echo "[PASS] post-upgrade critical log hits: 0"
  fi

  for status_file in "$PHASE_DIR"/*.status; do
    [[ -e "$status_file" ]] || continue
    local status
    status="$(cat "$status_file")"
    if [[ "$status" != "0" ]]; then
      echo "[FAIL] $(basename "$status_file" .status) failed with status=$status"
      fail=1
    fi
  done

  echo
  if [[ "$fail" -eq 0 ]]; then
    echo "[UPGRADE-SMOKE] backend gate passed."
    echo "[UPGRADE-SMOKE] Next: run browser release smoke, then observe 24h logs."
  else
    echo "[UPGRADE-SMOKE] backend gate failed. Do not keep upgrade without investigation."
    exit 1
  fi
}

if [[ "$MODE" == "post" && ! -d "$REPORT_ROOT/$RUN_ID/pre" ]]; then
  echo "[UPGRADE-SMOKE] missing pre baseline: $REPORT_ROOT/$RUN_ID/pre" >&2
  exit 2
fi

log "run_id=$RUN_ID phase=$MODE full=$FULL"
capture_all

if [[ "$MODE" == "pre" ]]; then
  echo
  echo "[UPGRADE-SMOKE] pre baseline captured: $REPORT_ROOT/$RUN_ID/pre"
  echo "[UPGRADE-SMOKE] After upgrading OpenClaw, run:"
  echo "  scripts/run-openclaw-upgrade-smoke.sh post --run-id=$RUN_ID$( [[ "$FULL" -eq 1 ]] && echo " --full" )"
else
  post_decision
fi
