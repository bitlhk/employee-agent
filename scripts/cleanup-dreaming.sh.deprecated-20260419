#!/bin/bash
# cleanup-dreaming.sh
#
# OpenClaw dreaming 每天凌晨3点往 memory/*.md 写大量元数据
# agent 会当成对话上下文读取，导致"说梦话"
# 本脚本剥离 dreaming 垃圾，保留有用内容
# dreaming 原始数据在 .dreams/ 目录有完整备份

WORKSPACE_BASE="/root/.openclaw/workspace"
CLAW_BASE="/root/.openclaw/workspace-lingganclaw"

cleanup_memory_dir() {
  local memdir="$1"
  [ -d "$memdir" ] || return

  for f in "$memdir"/*.md; do
    [ -f "$f" ] || continue

    dreaming_lines=$(grep -cE 'openclaw:dreaming|^- Candidate:|^  - confidence:|^  - evidence:|^  - recalls:|^  - status: staged|^## Light Sleep|^## REM Sleep|^## Deep Sleep|^### Reflections|^### Possible Lasting' "$f" 2>/dev/null || echo 0)

    if [ "$dreaming_lines" -gt 5 ]; then
      cp "$f" "$f.pre-clean"

      grep -vE 'openclaw:dreaming|^- Candidate:|^  - confidence:|^  - evidence:|^  - recalls:|^  - status: staged|^## Light Sleep|^## REM Sleep|^## Deep Sleep|^### Reflections|^### Possible Lasting' "$f" | sed '/^$/N;/^\n$/d' > "$f.tmp"

      mv "$f.tmp" "$f"
      remaining=$(wc -l < "$f")
      echo "[cleanup] $(basename "$f"): removed $dreaming_lines dreaming lines, $remaining remaining"
    fi
  done
}

echo "[cleanup-dreaming] $(date) starting..."

cleanup_memory_dir "$WORKSPACE_BASE/memory"

for d in "$CLAW_BASE"/trial_*/memory; do
  cleanup_memory_dir "$d"
done

echo "[cleanup-dreaming] done"
