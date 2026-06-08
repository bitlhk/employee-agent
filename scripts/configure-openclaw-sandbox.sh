#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

enabled="${OPENCLAW_SANDBOX_ENABLED:-${CLAW_OPENCLAW_SANDBOX_ENABLED:-true}}"
required="${OPENCLAW_SANDBOX_REQUIRED:-false}"
if [[ "$enabled" == "false" || "$enabled" == "0" || "$enabled" == "off" ]]; then
  echo "  OpenClaw sandbox: disabled by OPENCLAW_SANDBOX_ENABLED=$enabled"
  exit 0
fi

OPENCLAW_HOME_DIR="${CLAW_OPENCLAW_HOME:-${CLAW_REMOTE_OPENCLAW_HOME:-$HOME}}"
OC_DOTDIR="${OPENCLAW_HOME_DIR%/.openclaw}/.openclaw"
OC_CONFIG="${CLAW_OPENCLAW_JSON:-$OC_DOTDIR/openclaw.json}"
SANDBOX_IMAGE="${OPENCLAW_SANDBOX_IMAGE:-openclaw-sandbox:bookworm-slim}"
SANDBOX_NETWORK="${OPENCLAW_SANDBOX_NETWORK:-none}"
SANDBOX_MEMORY="${OPENCLAW_SANDBOX_MEMORY:-256m}"
SANDBOX_CPUS="${OPENCLAW_SANDBOX_CPUS:-0.5}"
SANDBOX_PIDS_LIMIT="${OPENCLAW_SANDBOX_PIDS_LIMIT:-50}"
SANDBOX_WORKSPACE_ACCESS="${OPENCLAW_SANDBOX_WORKSPACE_ACCESS:-rw}"
SANDBOX_SECCOMP_PROFILE="${OPENCLAW_SANDBOX_SECCOMP_PROFILE:-$OC_DOTDIR/seccomp-lingxia.json}"
SANDBOX_SECCOMP_TEMPLATE="${OPENCLAW_SANDBOX_SECCOMP_TEMPLATE:-$ROOT_DIR/configs/openclaw-seccomp-lingxia.json}"
SANDBOX_AUTO_BUILD="${OPENCLAW_SANDBOX_AUTO_BUILD:-true}"
SANDBOX_REBUILD="${OPENCLAW_SANDBOX_REBUILD:-false}"
NATIVE_SANDBOX_IMAGE="openclaw-sandbox:bookworm-slim"
NATIVE_SANDBOX_PROFILE="openclaw-native"

warn() { echo "  [WARN] $*" >&2; }
fail_or_warn() {
  if [[ "$required" == "true" || "$required" == "1" ]]; then
    echo "  [FAIL] $*" >&2
    exit 1
  fi
  warn "$*"
}
is_truthy() {
  case "${1:-}" in
    true|1|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}
build_native_sandbox_image() {
  if [[ "$SANDBOX_IMAGE" != "$NATIVE_SANDBOX_IMAGE" ]]; then
    fail_or_warn "auto-build only supports the OpenClaw native image tag ($NATIVE_SANDBOX_IMAGE), got: $SANDBOX_IMAGE"
    return 1
  fi

  echo "  OpenClaw sandbox: building native image ($SANDBOX_IMAGE)"
  docker build -t "$SANDBOX_IMAGE" - <<'DOCKERFILE'
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
LABEL ai.linggan.sandbox.profile="openclaw-native"
RUN sed -i \
  -e 's|https://deb.debian.org/debian|http://mirrors.huaweicloud.com/debian|g' \
  -e 's|https://deb.debian.org/debian-security|http://mirrors.huaweicloud.com/debian-security|g' \
  -e 's|https://security.debian.org/debian-security|http://mirrors.huaweicloud.com/debian-security|g' \
  -e 's|http://deb.debian.org/debian|http://mirrors.huaweicloud.com/debian|g' \
  -e 's|http://deb.debian.org/debian-security|http://mirrors.huaweicloud.com/debian-security|g' \
  -e 's|http://security.debian.org/debian-security|http://mirrors.huaweicloud.com/debian-security|g' \
  /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash ca-certificates curl git jq python3 ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox
CMD ["sleep", "infinity"]
DOCKERFILE
}

if [[ ! -f "$OC_CONFIG" ]]; then
  fail_or_warn "OpenClaw config not found: $OC_CONFIG"
  exit 0
fi

mkdir -p "$OC_DOTDIR"
if [[ ! -f "$SANDBOX_SECCOMP_PROFILE" && -f "$SANDBOX_SECCOMP_TEMPLATE" ]]; then
  cp "$SANDBOX_SECCOMP_TEMPLATE" "$SANDBOX_SECCOMP_PROFILE"
  chmod 0644 "$SANDBOX_SECCOMP_PROFILE" 2>/dev/null || true
  echo "  OpenClaw sandbox seccomp: installed $SANDBOX_SECCOMP_PROFILE"
fi

python3 - "$OC_CONFIG" "$SANDBOX_IMAGE" "$SANDBOX_NETWORK" "$SANDBOX_MEMORY" "$SANDBOX_CPUS" "$SANDBOX_PIDS_LIMIT" "$SANDBOX_WORKSPACE_ACCESS" "$SANDBOX_SECCOMP_PROFILE" <<'PY'
import json
import sys
from pathlib import Path

path, image, network, memory, cpus, pids_limit, workspace_access, seccomp_profile = sys.argv[1:]
cfg_path = Path(path)
cfg = json.loads(cfg_path.read_text())

agents = cfg.setdefault("agents", {})
defaults = agents.setdefault("defaults", {})
docker = {
    "image": image,
    "network": network,
    "readOnlyRoot": True,
    "memory": memory,
    "cpus": float(cpus),
    "pidsLimit": int(pids_limit),
}
if seccomp_profile:
    docker["seccompProfile"] = seccomp_profile

defaults["sandbox"] = {
    "mode": "all",
    "scope": "agent",
    "workspaceAccess": workspace_access,
    "docker": docker,
}

tools = cfg.setdefault("tools", {})
sandbox = tools.setdefault("sandbox", {})
sandbox_tools = sandbox.setdefault("tools", {})
also_allow = sandbox_tools.get("alsoAllow")
if not isinstance(also_allow, list):
    also_allow = []
for item in (
    "web_search",
    "web_fetch",
    "bundle-mcp",
    "managed_browser_open",
    "managed_browser_extract",
    "managed_browser_snapshot",
    "managed_browser_screenshot",
):
    if item not in also_allow:
        also_allow.append(item)
sandbox_tools["alsoAllow"] = also_allow

cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
PY

echo "  OpenClaw sandbox: enabled in $OC_CONFIG"

if ! command -v docker >/dev/null 2>&1; then
  fail_or_warn "docker command not found; sandbox containers cannot start"
  exit 0
fi

if ! docker version >/dev/null 2>&1; then
  fail_or_warn "current user cannot access Docker; add the service user to the docker group and restart PM2/session"
  exit 0
fi

image_exists=false
if docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1; then
  image_exists=true
fi

image_profile=""
if [[ "$image_exists" == "true" ]]; then
  image_profile="$(docker image inspect "$SANDBOX_IMAGE" --format '{{ index .Config.Labels "ai.linggan.sandbox.profile" }}' 2>/dev/null || true)"
fi

if [[ "$image_exists" == "false" ]]; then
  if is_truthy "$SANDBOX_AUTO_BUILD"; then
    build_native_sandbox_image || exit 0
  else
    fail_or_warn "sandbox image not found: $SANDBOX_IMAGE"
    exit 0
  fi
elif is_truthy "$SANDBOX_REBUILD" || { [[ "$SANDBOX_IMAGE" == "$NATIVE_SANDBOX_IMAGE" ]] && [[ "$image_profile" != "$NATIVE_SANDBOX_PROFILE" ]] && is_truthy "$SANDBOX_AUTO_BUILD"; }; then
  build_native_sandbox_image || exit 0
fi

echo "  OpenClaw sandbox: docker image ready ($SANDBOX_IMAGE)"
