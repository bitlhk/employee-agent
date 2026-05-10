#!/usr/bin/env bash

append_openclaw_default_path() {
  export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/bin:$PATH"
}

resolve_openclaw_bin() {
  local candidate=""
  local search_paths=()

  append_openclaw_default_path

  if [[ -n "${OPENCLAW_BIN:-}" ]]; then
    search_paths+=("$OPENCLAW_BIN")
  fi

  search_paths+=(
    "$HOME/.npm-global/bin/openclaw"
    "$HOME/.local/bin/openclaw"
    "$HOME/bin/openclaw"
    "/usr/local/bin/openclaw"
    "/usr/bin/openclaw"
  )

  for candidate in "${search_paths[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v openclaw >/dev/null 2>&1; then
    command -v openclaw
    return 0
  fi

  return 1
}

