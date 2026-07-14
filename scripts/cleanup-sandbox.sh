#!/bin/bash
# 清理超过12小时的 trial sandbox 容器（保留 main 容器）
# 由 cron 每小时执行

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
LOG="${SANDBOX_CLEANUP_LOG:-${APP_ROOT}/logs/sandbox-cleanup.log}"
THRESHOLD_HOURS=12

mkdir -p "$(dirname "$LOG")"

count=0
for cid in $(docker ps -q --filter "name=openclaw-sbx-agent-trial_"); do
  created=$(docker inspect -f '{{.Created}}' "$cid" 2>/dev/null)
  if [ -z "$created" ]; then continue; fi
  
  created_ts=$(date -d "$created" +%s 2>/dev/null)
  now_ts=$(date +%s)
  age_hours=$(( (now_ts - created_ts) / 3600 ))
  
  if [ "$age_hours" -ge "$THRESHOLD_HOURS" ]; then
    name=$(docker inspect -f '{{.Name}}' "$cid" | sed 's/^\///')
    docker rm -f "$cid" >/dev/null 2>&1
    echo "$(date -Iseconds) removed $name (age=${age_hours}h)" >> "$LOG"
    count=$((count + 1))
  fi
done

if [ "$count" -gt 0 ]; then
  echo "$(date -Iseconds) cleaned $count sandbox containers" >> "$LOG"
fi
