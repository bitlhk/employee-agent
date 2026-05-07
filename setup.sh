#!/usr/bin/env bash
set -euo pipefail

# LingganClaw 一键配置脚本
# 用法: bash setup.sh

echo ""
echo "  🦐 LingganClaw 灵虾 — 初始化配置"
echo "  ─────────────────────────────────"
echo ""

ENV_FILE=".env"
SKIP_ENV=""

if [[ -f "$ENV_FILE" ]]; then
  echo "⚠️  检测到已有 .env 文件。"
  read -rp "覆盖？(y/N) " overwrite
  if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
    echo "跳过 .env 生成，继续后续步骤..."
    SKIP_ENV=true
  fi
fi

gen_secret() { openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64; }
gen_hex() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p; }

# ── Step 1: 生成 .env ──────────────────────────────────────────────
if [[ "$SKIP_ENV" != "true" ]]; then
  echo "📝 Step 1/4: 配置环境变量"
  echo ""

  read -rp "  应用端口 [5180]: " PORT
  PORT=${PORT:-5180}

  echo ""
  echo "  访问方式:"
  echo "    1. 本机访问 (localhost)"
  echo "    2. 内网 IP 访问"
  echo "    3. 域名访问"
  read -rp "  选择 [1]: " ACCESS_MODE
  ACCESS_MODE=${ACCESS_MODE:-1}

  case $ACCESS_MODE in
    2)
      read -rp "  内网 IP: " LAN_IP
      FRONTEND_URL="http://${LAN_IP}:${PORT}"
      CORS_ORIGIN="http://${LAN_IP}:${PORT}"
      COOKIE_DOMAIN=""
      DEMO_DOMAIN=""
      ;;
    3)
      read -rp "  域名 (如 ai.company.com): " DOMAIN
      FRONTEND_URL="https://${DOMAIN}"
      CORS_ORIGIN="https://${DOMAIN}"
      COOKIE_DOMAIN=".${DOMAIN}"
      DEMO_DOMAIN="demo.${DOMAIN}"
      ;;
    *)
      FRONTEND_URL="http://localhost:${PORT}"
      CORS_ORIGIN="http://localhost:${PORT}"
      COOKIE_DOMAIN=""
      DEMO_DOMAIN=""
      ;;
  esac

  echo ""
  echo "  数据库:"
  echo "    1. Docker Compose 自带 MySQL"
  echo "    2. 使用已有的 MySQL"
  read -rp "  选择 [1]: " DB_MODE
  DB_MODE=${DB_MODE:-1}

  MYSQL_ROOT_PASSWORD=""
  if [[ "$DB_MODE" == "2" ]]; then
    read -rp "  MySQL 地址 [localhost]: " DB_HOST
    DB_HOST=${DB_HOST:-localhost}
    read -rp "  MySQL 端口 [3306]: " DB_PORT
    DB_PORT=${DB_PORT:-3306}
    read -rp "  MySQL 用户 [linggan]: " DB_USER
    DB_USER=${DB_USER:-linggan}
    read -rsp "  MySQL 密码: " DB_PASS
    echo ""
    read -rp "  数据库名 [linggan]: " DB_NAME
    DB_NAME=${DB_NAME:-linggan}
    DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  else
    DEFAULT_PWD=$(gen_hex 12)
    MYSQL_ROOT_PASSWORD="$DEFAULT_PWD"
    DATABASE_URL="mysql://root:${DEFAULT_PWD}@db:3306/linggan"
    echo "  MySQL 密码已自动生成"
  fi

  JWT_SECRET=$(gen_secret)
  TENANT_SECRET=$(gen_hex 32)
  INTERNAL_API_KEY=$(gen_hex 32)
  GW_TOKEN=$(gen_hex 24)

  {
    echo "# ── LingganClaw 配置（由 setup.sh 生成）──"
    echo "PORT=$PORT"
    echo "NODE_ENV=production"
    echo ""
    echo "# 访问"
    echo "FRONTEND_URL=$FRONTEND_URL"
    echo "CORS_ORIGIN=$CORS_ORIGIN"
    echo "COOKIE_DOMAIN=$COOKIE_DOMAIN"
    echo ""
    echo "# 数据库"
    echo "DATABASE_URL=$DATABASE_URL"
    [[ -n "$MYSQL_ROOT_PASSWORD" ]] && echo "MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD"
    echo ""
    echo "# 认证与安全"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "TENANT_SECRET=$TENANT_SECRET"
    echo "INTERNAL_API_KEY=$INTERNAL_API_KEY"
    echo "# 独立部署默认关闭注册邮箱验证码；配置 SMTP 后可改为 true"
    echo "EMAIL_VERIFICATION_REQUIRED=false"
    echo ""
    echo "# OpenClaw"
    echo "CLAW_PROVISION_MODE=local-script"
    echo "CLAW_CHAT_MODE=local-openclaw"
    echo "CLAW_OPENCLAW_HOME=$HOME"
    echo "CLAW_REMOTE_OPENCLAW_HOME=$HOME"
    echo "CLAW_GATEWAY_PORT=18789"
    echo "CLAW_GATEWAY_TOKEN=$GW_TOKEN"
    echo "CLAW_REMOTE_HOST=127.0.0.1"
    echo "HERMES_HOME=$HOME/.hermes"
    echo "LINGXIA_INTERNAL_BASE_URL=http://127.0.0.1:$PORT"
    echo ""
    echo "# 灵虾路由"
    [[ -n "$DEMO_DOMAIN" ]] && echo "LINGGAN_CLAW_BASE_DOMAIN=$DEMO_DOMAIN"
    [[ -n "$DEMO_DOMAIN" ]] && echo "DEMO_ROUTE_DOMAIN=$DEMO_DOMAIN"
    [[ -n "$COOKIE_DOMAIN" ]] && echo "LINGGAN_CLAW_ENTRY_SCHEME=https" || echo "LINGGAN_CLAW_ENTRY_SCHEME=http"
    echo ""
    echo "# 平台记忆（需要 DEEPSEEK_API_KEY）"
    echo "MEMORY_ENABLED=true"
    echo "MEMORY_EXTRACT_INTERVAL=5"
    echo "# DEEPSEEK_API_KEY="
    echo ""
    echo "# 沙箱"
    echo "SANDBOX_IMAGE=python:3.11-slim"
    echo "SANDBOX_MEMORY=256m"
    echo "SANDBOX_CPUS=0.5"
    echo "SANDBOX_PIDS_LIMIT=50"
    echo "SANDBOX_TMPFS_SIZE=50m"
    echo "SANDBOX_EXEC_TIMEOUT_MS=10000"
    echo "SANDBOX_MAX_OUTPUT_BYTES=65536"
    echo "SANDBOX_MAX_GLOBAL=5"
    echo "SANDBOX_MAX_PER_USER=2"
  } > "$ENV_FILE"

  echo ""
  echo "  ✅ .env 已生成"
fi

# ── Step 2: 检测 OpenClaw ─────────────────────────────────────────
echo ""
echo "📝 Step 2/4: 检测 OpenClaw"

if command -v openclaw >/dev/null 2>&1; then
  OC_VERSION=$(openclaw --version 2>/dev/null | head -1)
  echo "  ✅ 检测到 OpenClaw: $OC_VERSION"

  GW_TOKEN=$(grep "^CLAW_GATEWAY_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "")
  CORS_URL=$(grep "^FRONTEND_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "")
  OC_HOME="${HOME}/.openclaw"
  OC_CONFIG="$OC_HOME/openclaw.json"

  if [[ -f "$OC_CONFIG" && -n "$GW_TOKEN" ]]; then
    echo "  正在同步灵虾配置到 OpenClaw..."

    python3 << PYEOF
import json, sys
try:
    with open("$OC_CONFIG") as f:
        cfg = json.load(f)

    changed = False

    # Token
    gw = cfg.setdefault("gateway", {})
    auth = gw.setdefault("auth", {})
    if auth.get("token") != "$GW_TOKEN":
        auth["token"] = "$GW_TOKEN"
        auth["mode"] = "token"
        changed = True
        print("    - Gateway Token: 已同步")

    # Bind
    if gw.get("bind") != "lan":
        gw["bind"] = "lan"
        changed = True
        print("    - bind: 已设为 lan")

    # AllowedOrigins
    origins = gw.setdefault("controlUi", {}).setdefault("allowedOrigins", [])
    for url in ["$CORS_URL", "http://localhost:5180", "http://127.0.0.1:5180"]:
        if url and url not in origins:
            origins.append(url)
            changed = True
            print(f"    - allowedOrigins: 添加 {url}")

    if changed:
        with open("$OC_CONFIG", "w") as f:
            json.dump(cfg, f, indent=2)
        print("  ✅ OpenClaw 配置已更新")
    else:
        print("  ✅ OpenClaw 配置已是最新")
except Exception as e:
    print(f"  ⚠️  配置同步失败: {e}")
PYEOF
  elif [[ ! -f "$OC_CONFIG" ]]; then
    echo "  未找到配置文件，请先运行: openclaw setup"
    echo "  然后重新运行本脚本"
  fi
else
  echo "  ❌ 未检测到 OpenClaw"
  echo ""
  echo "  灵虾的主聊天功能依赖 OpenClaw，请先安装:"
  echo "    npm install -g openclaw"
  echo "    openclaw setup"
  echo ""
  echo "  安装后重新运行本脚本，将自动配置。"
  echo "  详见: docs/DEPLOY.md"
fi

# ── Step 3: 安装依赖 ──────────────────────────────────────────────
echo ""
echo "📝 Step 3/4: 安装依赖"

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  echo "  ✅ 依赖已安装"
else
  echo "  ⚠️  未检测到 pnpm: npm install -g pnpm"
fi

if [[ ! -f "ecosystem.config.cjs" && -f "ecosystem.config.cjs.example" ]]; then
  cp ecosystem.config.cjs.example ecosystem.config.cjs
  echo "  ✅ 已生成 PM2 配置 ecosystem.config.cjs"
fi

# ── Step 4: 数据库迁移 ────────────────────────────────────────────
echo ""
echo "📝 Step 4/4: 数据库迁移"

DB_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "")
if [[ "$DB_URL" == *"@db:"* ]]; then
  echo "  Docker Compose 数据库，请先: docker compose up -d db"
  echo "  然后运行: pnpm db:push"
else
  if command -v pnpm >/dev/null 2>&1; then
    if pnpm db:push 2>/dev/null; then
      echo "  ✅ 数据库迁移完成"
    else
      echo "  ⚠️  迁移失败，请检查 DATABASE_URL"
    fi
  fi
fi

# ── 完成 ──────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────"
echo "  🦐 灵虾初始化完成！"
echo "  ─────────────────────────────────"
echo ""
echo "  启动方式："
echo "    Docker:  docker compose up -d"
echo "    手动:    pnpm build && pnpm start"
echo "    PM2:     pm2 start ecosystem.config.cjs"
echo ""
echo "  访问: $(grep '^FRONTEND_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo 'http://localhost:5180')"
echo "  创建首个管理员: pnpm tsx scripts/init-admin.ts --email=admin@example.com --password='请换成强密码' --name='Admin'"
echo ""
