#!/usr/bin/env bash
# continue-helpers.sh — deterministic shell work for /flow:continue.
# Stack-agnostic: dev port and commands come from .flow/config.md.
#
# Usage:
#   continue-helpers.sh check-progress      # exists | missing
#   continue-helpers.sh progress-age-days   # integer days since session-progress.md mtime
#   continue-helpers.sh last-log-titles     # last 3 dated titles from session-log.md
#   continue-helpers.sh dev-server-state    # running:<pid> | port-taken:<cwd> | free | no-port
#   continue-helpers.sh deps-ok             # ok | missing   (alias: node-modules-ok)

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SOURCE_DIR/lib.sh"

REPO_ROOT="$(flow_project_root)"
PROGRESS="$REPO_ROOT/session-progress.md"
LOG="$REPO_ROOT/session-log.md"

cmd="${1:-}"

case "$cmd" in
  check-progress)
    [ -f "$PROGRESS" ] && echo "exists" || echo "missing"
    ;;

  progress-age-days)
    if [ ! -f "$PROGRESS" ]; then echo "0"; exit 0; fi
    NOW=$(date +%s)
    if MTIME=$(stat -f %m "$PROGRESS" 2>/dev/null); then :; else MTIME=$(stat -c %Y "$PROGRESS" 2>/dev/null || echo "$NOW"); fi
    echo $(( (NOW - MTIME) / 86400 ))
    ;;

  last-log-titles)
    [ -f "$LOG" ] || { echo ""; exit 0; }
    grep -E '^## [0-9]{4}-' "$LOG" | head -3
    ;;

  dev-server-state)
    # Needs a pinned port (config: dev_port) and lsof. Without either we can't
    # tell, so we say so rather than guess.
    PORT="$(flow_dev_port)"
    if [ -z "$PORT" ]; then echo "no-port"; exit 0; fi
    if ! command -v lsof >/dev/null 2>&1; then echo "no-port"; exit 0; fi
    PID=$(lsof -ti:"$PORT" 2>/dev/null | head -1 || true)
    if [ -z "$PID" ]; then echo "free"; exit 0; fi
    CWD=$(lsof -p "$PID" 2>/dev/null | awk '$4 == "cwd" {print $9}')
    case "$CWD" in
      "$REPO_ROOT"*) echo "running:$PID" ;;
      *)             echo "port-taken:$CWD" ;;
    esac
    ;;

  deps-ok|node-modules-ok)
    # Best-effort, layout-tolerant. Only JS projects have a checkable install
    # dir; for everything else we report "ok" (nothing to verify here).
    PKG=$(find "$REPO_ROOT" -maxdepth 2 -name package.json -not -path '*/node_modules/*' 2>/dev/null | head -1)
    if [ -z "$PKG" ]; then echo "ok"; exit 0; fi
    PKG_DIR=$(dirname "$PKG")
    if { [ -d "$PKG_DIR/node_modules" ] && [ -n "$(ls -A "$PKG_DIR/node_modules" 2>/dev/null)" ]; } \
       || { [ -d "$REPO_ROOT/node_modules" ] && [ -n "$(ls -A "$REPO_ROOT/node_modules" 2>/dev/null)" ]; }; then
      echo "ok"
    else
      echo "missing"
    fi
    ;;

  *)
    echo "unknown subcommand: $cmd" >&2
    exit 1
    ;;
esac
