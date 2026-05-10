#!/usr/bin/env bash
set -euo pipefail

export SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:15180}"
export SMOKE_ADOPT_ID="${SMOKE_ADOPT_ID:-lgc-ofnmjm4joj}"
export SMOKE_REPORT_DIR="${SMOKE_REPORT_DIR:-tests/smoke/lingxia/reports}"

node tests/smoke/lingxia/playwright-runner.mjs
