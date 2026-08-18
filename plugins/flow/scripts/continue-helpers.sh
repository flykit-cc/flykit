#!/usr/bin/env bash
# continue-helpers.sh — deterministic shell work for /flow:continue.
# Stack-agnostic: dev port and commands come from .flow/config.md.
#
# Usage:
#   continue-helpers.sh check-progress      # exists | exists:stale-blocks=<n> | missing
#   continue-helpers.sh sweep-handoffs      # archive spent handoffs to .flow/session/spent/, print names
#   continue-helpers.sh progress-age-days   # integer days since .flow/session-progress.md mtime
#   continue-helpers.sh last-log-titles     # last 3 dated titles from .flow/session-log.md
#   continue-helpers.sh dev-server-state    # running:<pid> | port-taken:<cwd> | free | no-port
#   continue-helpers.sh deps-ok             # ok | missing   (alias: node-modules-ok)

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SOURCE_DIR/lib.sh"

REPO_ROOT="$(flow_project_root)"
PROGRESS="$REPO_ROOT/.flow/session-progress.md"
LOG="$REPO_ROOT/.flow/session-log.md"

cmd="${1:-}"

case "$cmd" in
  check-progress)
    if [ ! -f "$PROGRESS" ]; then echo "missing"; exit 0; fi
    # session-progress.md holds CURRENT state only — exactly one Goal and one
    # Paused-at. More than one of either means a past pause appended instead of
    # rewriting, which is how the file grows without bound and how the parsers
    # (session-context.sh, status-helpers.sh) end up reading the OLDEST goal.
    # Count sections, not lines: a long file is fine, a duplicated one is not.
    GOALS=$(grep -cE '^#+ *Goal' "$PROGRESS" 2>/dev/null || true)
    PAUSED=$(grep -cE '^#+ *Paused|^[[:space:]]*\*{0,2}Paused at' "$PROGRESS" 2>/dev/null || true)
    # Next-steps blocks stack the same way and are the shape seen in the field:
    # one Goal, one Paused at, and a NEXT section per session. A resume reads the
    # first and works from a plan several sessions old.
    NEXTS=$(grep -ciE '^#+ *next' "$PROGRESS" 2>/dev/null || true)
    # Count EXCESS blocks, not total headers. A healthy file has one of each, so
    # only the surplus is stale — reporting the sum sends a reader looking for
    # five things to delete when two are actually stale.
    STALE=0
    for N in "${GOALS:-0}" "${PAUSED:-0}" "${NEXTS:-0}"; do
      [ "$N" -gt 1 ] && STALE=$(( STALE + N - 1 ))
    done
    if [ "$STALE" -gt 0 ]; then
      echo "exists:stale-blocks=$STALE"
    else
      echo "exists"
    fi
    ;;

  sweep-handoffs)
    SESSION_DIR="$REPO_ROOT/.flow/session"
    SPENT_DIR="$SESSION_DIR/spent"
    MARKER="$REPO_ROOT/.flow/state/last-pause"
    [ -d "$SESSION_DIR" ] || exit 0
    # Without a pause marker (a repo that ran agents but never completed a pause)
    # there is no boundary to date handoffs against. Do NOT guess from timestamp
    # gaps — that happens to work when sessions are days apart and silently fails
    # when they are hours apart. Sweep everything instead: a regenerated phase
    # costs one agent run, a stale plan silently implemented costs far more.
    #
    # Sweeping moves rather than deletes, which is what makes failing closed
    # cheap enough to be the default — a wrong call is undone with one `mv`.
    HAVE_MARKER=1; [ -f "$MARKER" ] || HAVE_MARKER=0
    NAMES=""
    for f in "$SESSION_DIR"/*; do
      [ -f "$f" ] || continue
      BASE=$(basename "$f")
      # shutdown_request is a control marker, not a phase handoff.
      if [ "$BASE" = "shutdown_request" ]; then continue; fi
      if [ "$HAVE_MARKER" -eq 0 ] || [ "$f" -ot "$MARKER" ]; then
        mkdir -p "$SPENT_DIR"
        mv -f "$f" "$SPENT_DIR/$BASE"
        NAMES="${NAMES}${BASE}
"
      fi
    done
    # Only explain when something was actually swept for want of a marker.
    if [ "$HAVE_MARKER" -eq 0 ] && [ -n "$NAMES" ]; then
      echo "no-pause-marker"
    fi
    printf '%s' "$NAMES"
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
    PORT="$(flow_extract dev_port)"
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
