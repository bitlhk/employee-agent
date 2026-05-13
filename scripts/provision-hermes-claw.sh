#!/bin/bash
# Provision a Hermes-runtime claw for a linggan user.
#
# Usage: provision-hermes-claw.sh <profile_name> <userId>
# Example: provision-hermes-claw.sh lihongkun 2
#
# Effect:
#   1) Creates a new Hermes profile at $HERMES_HOME_ROOT/profiles/<profile_name>
#   2) Allocates next free port starting at 8644
#   3) Writes per-profile hermes-http.env with that port
#   4) Enables systemd hermes-http@<profile_name> service
#   5) INSERT INTO claw_adoptions row with adoptId=lgh-<profile_name>
#   6) curl /health to verify
#
# Rollback (if step N fails):
#   systemctl disable --now hermes-http@<profile_name>
#   rm -rf $HERMES_HOME_ROOT/profiles/<profile_name>
#   DELETE FROM claw_adoptions WHERE adoptId='lgh-<profile_name>'

set -euo pipefail

PROFILE="${1:-}"
USER_ID="${2:-}"

if [[ -z "$PROFILE" || -z "$USER_ID" ]]; then
  echo "Usage: $0 <profile_name> <userId>"
  echo "Example: $0 lihongkun 2"
  exit 1
fi

if ! [[ "$PROFILE" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]]; then
  echo "ERROR: profile name must match [a-z0-9][a-z0-9_-]{0,63}"
  exit 1
fi

if ! [[ "$USER_ID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: userId must be a positive integer"
  exit 1
fi

ADOPT_ID="lgh-${PROFILE}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${APP_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

if [[ -f "${APP_ROOT}/.env" ]]; then
  set -a
  source "${APP_ROOT}/.env"
  set +a
fi

HERMES_ROOT="${HERMES_ROOT:-${HOME}/hermes-agent}"
HERMES_HOME_ROOT="${HERMES_HOME_ROOT:-${HOME}/.hermes}"
PROFILE_DIR="${HERMES_HOME_ROOT}/profiles/${PROFILE}"

DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL not found in ${APP_ROOT}/.env"
  exit 1
fi

# Parse MySQL URL into host/port/user/pass/db
DB_HOST=$(python3 -c "import urllib.parse as u; r=u.urlparse('$DB_URL'); print(r.hostname)")
DB_PORT=$(python3 -c "import urllib.parse as u; r=u.urlparse('$DB_URL'); print(r.port or 3306)")
DB_USER=$(python3 -c "import urllib.parse as u; r=u.urlparse('$DB_URL'); print(r.username)")
DB_PASS=$(python3 -c "import urllib.parse as u; r=u.urlparse('$DB_URL'); print(u.unquote(r.password))")
DB_NAME=$(python3 -c "import urllib.parse as u; r=u.urlparse('$DB_URL'); print(r.path.lstrip('/'))")

mysql_cmd() {
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -sNe "$1" 2>/dev/null
}

# Preflight checks
echo "=== Preflight checks ==="
if mysql_cmd "SELECT 1 FROM claw_adoptions WHERE adoptId='$ADOPT_ID'" | grep -q 1; then
  echo "ERROR: adoptId '$ADOPT_ID' already exists in DB"
  exit 1
fi

if ! mysql_cmd "SELECT 1 FROM users WHERE id=$USER_ID" | grep -q 1; then
  echo "ERROR: userId $USER_ID not found in users table"
  exit 1
fi

if [[ -d "$PROFILE_DIR" ]]; then
  echo "ERROR: profile dir already exists: $PROFILE_DIR"
  exit 1
fi

USERNAME=$(mysql_cmd "SELECT COALESCE(name, email, CONCAT('user#',id)) FROM users WHERE id=$USER_ID")
echo "user = $USERNAME (id=$USER_ID)"

# Allocate next port
MAX_PORT=$(mysql_cmd "SELECT COALESCE(MAX(hermes_port), 8643) FROM claw_adoptions")
PORT=$((MAX_PORT + 1))
if [[ "$PORT" -lt 8644 ]]; then PORT=8644; fi
echo "allocated port = $PORT"

# 1) Create Hermes profile
echo "=== 1) hermes profile create $PROFILE ==="
cd "$HERMES_ROOT"
HERMES_HOME="$HERMES_HOME_ROOT" ./venv/bin/hermes profile create "$PROFILE"
if [[ ! -d "$PROFILE_DIR" ]]; then
  echo "ERROR: profile create did not produce $PROFILE_DIR"
  exit 1
fi

# 1.5) Apply canonical template (glm-5.1 + docker terminal sandbox)
# 2026-04-20: replaces the old `hermes profile create --clone` path, which
# inherited the stale default config (DeepSeek-only, no docker sandbox).
# Template: ${APP_ROOT}/configs/hermes-profile-template.yaml
echo "=== 1.5) apply canonical template ==="
cp "${APP_ROOT}/configs/hermes-profile-template.yaml" "$PROFILE_DIR/config.yaml"
HERMES_API_ENV_SOURCE="${HERMES_API_ENV_SOURCE:-${HERMES_HOME_ROOT}/profiles/lihongkun/.env}"
if [[ -f "$HERMES_API_ENV_SOURCE" ]]; then
  grep "^HUAWEI_MAAS_API_KEY=" "$HERMES_API_ENV_SOURCE" >> "$PROFILE_DIR/.env" || true
else
  echo "WARN: HERMES_API_ENV_SOURCE not found, skip HUAWEI_MAAS_API_KEY copy: $HERMES_API_ENV_SOURCE"
fi
echo "  wrote $PROFILE_DIR/config.yaml (glm-5.1 + docker sandbox)"
echo "  appended HUAWEI_MAAS_API_KEY to $PROFILE_DIR/.env"

# 2) Write per-profile env (port)
echo "=== 2) write $PROFILE_DIR/hermes-http.env ==="
echo "HERMES_HTTP_PORT=$PORT" > "$PROFILE_DIR/hermes-http.env"
cat "$PROFILE_DIR/hermes-http.env"

# Ensure DEEPSEEK_API_KEY + HERMES_HTTP_KEY inherit from root .env
# (we deliberately don't re-copy the whole .env to keep secrets in one place;
# EnvironmentFile= in the systemd unit loads ${HERMES_HOME_ROOT}/.env first.)

# 3) Enable + start systemd service
echo "=== 3) systemctl enable --now hermes-http@$PROFILE ==="
systemctl daemon-reload
systemctl enable --now "hermes-http@${PROFILE}"
sleep 2
systemctl status "hermes-http@${PROFILE}" --no-pager | head -5

echo "=== 3.5) systemctl enable --now hermes-cron@$PROFILE.timer (P0.3a addition 2026-04-20) ==="
systemctl enable --now "hermes-cron@${PROFILE}.timer"
systemctl is-active "hermes-cron@${PROFILE}.timer"

# 4) Health probe
echo "=== 4) curl /health ==="
HEALTH=$(curl -sS -m 5 "http://127.0.0.1:${PORT}/health" || echo "FAILED")
echo "$HEALTH"
if ! echo "$HEALTH" | grep -q '"ok":true'; then
  echo "ERROR: health probe failed for port $PORT"
  systemctl stop "hermes-http@${PROFILE}"
  exit 1
fi

# 5) INSERT DB row
echo "=== 5) INSERT claw_adoptions row ==="
ENTRY_URL="/claw/${ADOPT_ID}"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" 2>/dev/null <<SQL
INSERT INTO claw_adoptions
  (adoptId, agentId, userId, status, permissionProfile, hermes_port, ttlDays, entryUrl)
VALUES
  ('${ADOPT_ID}', 'hermes:${PROFILE}', ${USER_ID}, 'active', 'internal', ${PORT}, 365, '${ENTRY_URL}');
SQL

mysql_cmd "SELECT adoptId, agentId, userId, status, permissionProfile, hermes_port FROM claw_adoptions WHERE adoptId='$ADOPT_ID'"

echo ""
echo "=============================================="
echo "✓ Provisioned: adoptId=$ADOPT_ID port=$PORT user=$USERNAME"
echo "  profile_dir: $PROFILE_DIR"
echo "  systemd:     hermes-http@${PROFILE}.service"
echo "  http:        http://127.0.0.1:${PORT}/chat/stream"
echo "  next login:  user will see a new Hermes claw card at /claw home"
echo "=============================================="
