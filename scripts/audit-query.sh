#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
LOG_DETAIL="${LOG_DETAIL:-${APP_ROOT}/logs/claw-exec-detail.log}"
LOG_REQ="${LOG_REQ:-${APP_ROOT}/logs/claw-exec.log}"

ADOPT_ID="${ADOPT_ID:-}"
USER_ID="${USER_ID:-}"
EVENT="${EVENT:-}"
SINCE_MINUTES="${SINCE_MINUTES:-0}"
LIMIT="${LIMIT:-50}"
FILE="${FILE:-detail}" # detail|req|both

FILTER_PY=$(cat <<'PY'
import json,sys,datetime
adopt=sys.argv[1]
user=sys.argv[2]
event=sys.argv[3]
since_min=int(sys.argv[4])
limit=int(sys.argv[5])
now=datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc)
out=[]
for line in sys.stdin:
    line=line.strip()
    if not line:
        continue
    try:
        d=json.loads(line)
    except Exception:
        continue
    if adopt and str(d.get("adoptId",""))!=adopt:
        continue
    if user and str(d.get("userId",""))!=user:
        continue
    if event and str(d.get("event",""))!=event:
        continue
    if since_min>0:
        ts=d.get("ts")
        try:
            t=datetime.datetime.fromisoformat(str(ts).replace("Z","+00:00"))
            if (now-t).total_seconds() > since_min*60:
                continue
        except Exception:
            pass
    out.append(d)
for d in out[-limit:]:
    print(json.dumps(d,ensure_ascii=False))
PY
)

run_one(){
  local file="$1"
  local title="$2"
  if [ ! -f "$file" ]; then
    echo "$title: <missing $file>"
    return
  fi
  echo "===== $title ====="
  python3 -c "$FILTER_PY" "$ADOPT_ID" "$USER_ID" "$EVENT" "$SINCE_MINUTES" "$LIMIT" < "$file"
}

case "$FILE" in
  detail) run_one "$LOG_DETAIL" "DETAIL" ;;
  req) run_one "$LOG_REQ" "REQUEST" ;;
  both) run_one "$LOG_REQ" "REQUEST"; run_one "$LOG_DETAIL" "DETAIL" ;;
  *) echo "FILE must be detail|req|both"; exit 1 ;;
esac
