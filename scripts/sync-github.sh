#!/bin/bash
# 一键同步开源版到 GitHub（通过华为云新加坡中转）
# 流程：build-oss 生成干净代码 → 敏感扫描 → scp 到新加坡 OSS 仓 → 增量 commit + push
#
# 用法:
#   bash scripts/sync-github.sh "chore: update copy"
#   bash scripts/sync-github.sh --deploy-sg-test "chore: update copy"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OSS_DIR="/tmp/linggan-oss-build"
RELAY_HOST="111.119.236.165"
RELAY_USER="ubuntu"
RELAY_KEY="${RELAY_KEY:-/root/.ssh/KeyPair-SG.pem}"
RELAY_OSS_DIR="${RELAY_OSS_DIR:-/home/ubuntu/employee-agent-oss}"
LEGACY_RELAY_OSS_DIR="${LEGACY_RELAY_OSS_DIR:-/home/ubuntu/linggan-claw-oss}"
RELAY_TEST_DIR="${RELAY_TEST_DIR:-/home/ubuntu/linggan-claw}"
TAR_FILE="/tmp/linggan-oss-package.tar.gz"

DEPLOY_SG_TEST=0
if [[ "${1:-}" == "--deploy-sg-test" ]]; then
  DEPLOY_SG_TEST=1
  shift
fi

MSG=${1:-"update: $(date +"%Y-%m-%d %H:%M")"}

quote_for_remote() {
  printf "%q" "$1"
}

REMOTE_MSG="$(quote_for_remote "$MSG")"

echo "🧭 Source git state:"
cd "$SRC_DIR"
echo "   branch: $(git branch --show-current 2>/dev/null || echo unknown)"
echo "   commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "   working tree: dirty (will build from current files)"
else
  echo "   working tree: clean"
fi

echo "📦 Step 1: 从主版本生成开源版..."
bash "$SCRIPT_DIR/build-oss.sh" "$OSS_DIR"

echo ""
echo "🔍 Step 1.5: 敏感内容扫描（兜底）..."
bash "$SCRIPT_DIR/pre-oss-scan.sh" "$OSS_DIR"

echo ""
echo "📦 Step 2: 打包脱敏代码..."
cd "$OSS_DIR"
# 打包时排除 .git（build-oss 生成的临时 git 不需要）
tar czf "$TAR_FILE" --exclude='.git' .
SIZE=$(du -sh "$TAR_FILE" | cut -f1)
echo "   包大小: $SIZE"

echo ""
echo "📤 Step 3: 传输到中转服务器 ($RELAY_HOST)..."
scp -i "$RELAY_KEY" -o StrictHostKeyChecking=no "$TAR_FILE" "${RELAY_USER}@${RELAY_HOST}:/tmp/linggan-oss-package.tar.gz"

echo ""
echo "🚀 Step 4: 在中转服务器上增量 commit + push..."
ssh -i "$RELAY_KEY" -o StrictHostKeyChecking=no "${RELAY_USER}@${RELAY_HOST}" \
  "if [ ! -d '$RELAY_OSS_DIR' ] && [ -d '$LEGACY_RELAY_OSS_DIR' ]; then RELAY_OSS_DIR='$LEGACY_RELAY_OSS_DIR'; else RELAY_OSS_DIR='$RELAY_OSS_DIR'; fi; cd \$RELAY_OSS_DIR && bash receive-and-push.sh /tmp/linggan-oss-package.tar.gz $REMOTE_MSG"

if [[ "$DEPLOY_SG_TEST" -eq 1 ]]; then
  echo ""
  echo "🧪 Step 5: 部署新加坡测试环境..."
  ssh -i "$RELAY_KEY" -o StrictHostKeyChecking=no "${RELAY_USER}@${RELAY_HOST}" \
    "cd '$RELAY_TEST_DIR' \
      && git fetch origin main \
      && if [ -n \"\$(git status --porcelain)\" ]; then echo '❌ 新加坡测试目录有未提交改动，拒绝自动部署' >&2; git status --short; exit 1; fi \
      && LOCAL=\$(git rev-parse HEAD) \
      && REMOTE=\$(git rev-parse origin/main) \
      && if [ \"\$LOCAL\" != \"\$REMOTE\" ] && ! git merge-base --is-ancestor \"\$LOCAL\" \"\$REMOTE\"; then echo '❌ 新加坡测试目录不是 origin/main 的祖先，拒绝自动部署' >&2; git status --short --branch; exit 1; fi \
      && git pull --ff-only origin main \
      && pnpm run check \
      && pnpm run build \
      && pm2 restart linggan-claw --update-env \
      && echo \"✅ 新加坡测试部署: \$(git rev-parse --short HEAD)\""
else
  echo ""
  echo "ℹ️  未部署新加坡测试环境；如需同步测试机，重新运行时加 --deploy-sg-test"
fi

# 清理临时文件
rm -f "$TAR_FILE"
rm -rf "$OSS_DIR"

echo ""
echo "✅ 同步完成: https://github.com/bitlhk/employee-agent"
