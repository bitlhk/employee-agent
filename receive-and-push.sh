#!/bin/bash
# receive-and-push.sh — 接收 123 的脱敏包，增量 commit + push 到 GitHub
# 用法: bash receive-and-push.sh /path/to/oss-package.tar.gz ["commit message"]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OSS_DIR="$SCRIPT_DIR"
TAR_FILE="${1:-}"
MSG="${2:-"update: $(date +"%Y-%m-%d %H:%M")"}"

if [[ -z "$TAR_FILE" || ! -f "$TAR_FILE" ]]; then
  echo "❌ 用法: bash receive-and-push.sh <oss-package.tar.gz> [commit message]"
  exit 1
fi

echo "📦 接收脱敏包: $TAR_FILE"
echo "📁 OSS 仓库: $OSS_DIR"

cd "$OSS_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ OSS 仓库存在未提交改动，拒绝覆盖。请先处理：" >&2
  git status --short >&2
  exit 1
fi

git fetch origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [[ "$LOCAL" != "$REMOTE" ]]; then
  if git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    git pull --ff-only origin main
  else
    echo "❌ OSS 仓库本地分支与 origin/main 分叉，拒绝自动推送" >&2
    git status --short --branch >&2
    exit 1
  fi
fi

# 解压并校验脱敏包
TMP_EXTRACT="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_EXTRACT"
}
trap cleanup EXIT
tar xzf "$TAR_FILE" -C "$TMP_EXTRACT"

# Accept either a flat package or a package wrapped in a single top-level
# directory. Refuse nested git metadata so a packaging mistake cannot replace
# the repository with an embedded checkout.
SRC_DIR="$TMP_EXTRACT"
top_count="$(find "$TMP_EXTRACT" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
if [[ "$top_count" == "1" ]]; then
  only_entry="$(find "$TMP_EXTRACT" -mindepth 1 -maxdepth 1 -print -quit)"
  if [[ -d "$only_entry" ]]; then
    SRC_DIR="$only_entry"
  fi
fi
if find "$SRC_DIR" -name .git -type d -print -quit | grep -q .; then
  echo "❌ 脱敏包包含 .git 目录，拒绝导入，避免嵌套仓库/误删。" >&2
  exit 1
fi
if [[ ! -f "$SRC_DIR/package.json" || ! -d "$SRC_DIR/server" || ! -d "$SRC_DIR/client" ]]; then
  echo "❌ 脱敏包结构异常，缺少 package.json/server/client，拒绝导入。" >&2
  find "$SRC_DIR" -maxdepth 2 -mindepth 1 | sed -n '1,40p' >&2
  exit 1
fi

# 保护 .git 和这个脚本自身
echo "🔄 同步文件（保留 .git 历史）..."
# 先清理除 .git 和 receive-and-push.sh 之外的所有文件
find . -maxdepth 1 -not -name '.git' -not -name '.' -not -name 'receive-and-push.sh' -exec rm -rf {} +
rsync -a "$SRC_DIR"/ "$OSS_DIR"/

# git 增量提交
echo "📝 生成增量 commit..."
git add -A

if git diff --cached --quiet; then
  echo "ℹ️  没有变更，跳过 commit"
else
  git commit -m "$MSG"
  NEW_COMMIT="$(git rev-parse --short HEAD)"
  echo "📤 推送到 GitHub..."
  git push origin main
  echo ""
  echo "✅ 推送完成: $NEW_COMMIT"
  git log --oneline -3
fi

echo ""
echo "🔗 https://github.com/bitlhk/employee-agent"
