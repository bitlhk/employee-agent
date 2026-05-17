#!/usr/bin/env bash
# pre-oss-scan.sh — OSS 推送前的内容级敏感扫描
#
# 用法: bash pre-oss-scan.sh <oss_build_dir>
#   返回 0 = 通过可推送
#   返回 1 = 发现敏感内容，拒绝推送
#   返回 2 = 用法错
#
# 分两层：
#   HARD  命中即 fail，无豁免  (凭证/密码/PAT/实名/服务器 IP)
#   SOFT  可按文件白名单豁免    (客户名/产品名/股票代码)
#
# 维护：新发现一个敏感模式就加到对应数组，新找到一个允许留敏感的文件就加到 SOFT_ALLOW。

set -euo pipefail

OSS_DIR="${1:-}"
if [[ -z "$OSS_DIR" || ! -d "$OSS_DIR" ]]; then
  echo "❌ 用法: bash pre-oss-scan.sh <oss_build_dir>" >&2
  exit 2
fi

echo "🔍 OSS 敏感扫描: $OSS_DIR"

INCLUDES=(--include='*.ts' --include='*.tsx' --include='*.md' --include='*.sh' --include='*.json' --include='*.js')

# ── HARD：命中即 fail ──
HARD_PATTERNS=(
  '刘承岩'                          # 对接人实名
  'Bit19830210'                     # 灵感服务器密码
  'github_pat_[A-Za-z0-9_]{20,}'    # GitHub PAT
  'sk-[A-Za-z0-9]{30,}'             # OpenAI 风格 key
  'xoxb-[A-Za-z0-9-]{20,}'          # Slack bot token
  '123\.60\.154\.110'               # 灵感/灵虾 云主机 公网 IP
  '116\.205\.111\.24'               # 灵感金牌教练 demo 公网 IP
  '116\.204\.80\.102'               # 灵感团险审核/工作台 demo 公网 IP
  '3\.16\.70\.167'                  # AWS 中转 公网 IP
)

# ── SOFT：以下文件路径后缀匹配到则豁免此类命中 ──
# 注意：SOFT_ALLOW 只豁免 SOFT_PATTERNS，HARD 永远不豁免
SOFT_ALLOW=(
  'shared/brand.ts'   # ICBC brand section 用户明确保留
  'HELP.md'           # 用户文档用公开蓝筹股做通用示例
)

SOFT_PATTERNS=(
  '工商银行|工行'
  'ICBC'
  '工银智涌|智贷通|工小审'
  '601398'
)

fail=0

scan_hard() {
  local pat="$1"
  local hits
  hits=$(grep -rnE "$pat" "$OSS_DIR" "${INCLUDES[@]}" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "❌ [HARD] 模式: $pat"
    echo "$hits" | head -10 | sed 's/^/    /'
    echo
    fail=1
  fi
}

scan_soft() {
  local pat="$1"
  local hits
  hits=$(grep -rnE "$pat" "$OSS_DIR" "${INCLUDES[@]}" 2>/dev/null || true)
  # 过滤白名单
  for allow in "${SOFT_ALLOW[@]}"; do
    hits=$(echo "$hits" | grep -vF "/$allow:" || true)
  done
  if [[ -n "$hits" ]]; then
    echo "❌ [SOFT] 模式: $pat （已豁免 ${SOFT_ALLOW[*]}）"
    echo "$hits" | head -10 | sed 's/^/    /'
    echo
    fail=1
  fi
}

for p in "${HARD_PATTERNS[@]}"; do scan_hard "$p"; done
for p in "${SOFT_PATTERNS[@]}"; do scan_soft "$p"; done

if [[ $fail -eq 0 ]]; then
  echo "✅ 扫描通过，未发现敏感内容"
  exit 0
fi

echo
echo "🚨 扫描失败，拒绝推送 OSS"
echo "   修复方案："
echo "   1) 代码里改名脱敏（推荐）"
echo "   2) 如果文件整体应公开且已确认，加入 SOFT_ALLOW 白名单"
echo "   3) 如果是新的敏感模式，加入 HARD_PATTERNS / SOFT_PATTERNS"
exit 1
