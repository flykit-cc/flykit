#!/usr/bin/env bash
# stop-check.sh — Stop hook.
# Fast feedback by default, heavy verification only at deliberate gates:
#   * lint_cmd + format_cmd run in a BACKGROUNDED subshell, append to a rotated
#     .stop-check.log, and never block (exit 0 immediately).
#   * build_cmd + test_cmd run SYNCHRONOUSLY and CAN block, but ONLY when a
#     .build-check marker exists. /flow:pause land arms that marker as a one-shot
#     gate, and only when the project sets stop_check: lint+build;
#     this hook consumes (removes) it so the gate fires exactly once.
# Fails open: no config, no git, or jq missing => exit 0.

set -u

INPUT=$(cat 2>/dev/null || true)

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/lib.sh
. "$SOURCE_DIR/../scripts/lib.sh"

# Recursion guard: if this Stop was itself triggered by a previous Stop-hook
# continuation, do nothing (prevents infinite self-continue loops).
if command -v jq >/dev/null 2>&1; then
    if [ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
        exit 0
    fi
    WORK_DIR=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
fi
[ -z "${WORK_DIR:-}" ] && WORK_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$WORK_DIR}"
CONFIG="$PROJECT_DIR/.claude/config.md"
[ -f "$CONFIG" ] || exit 0
git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

LINT_CMD="$(flow_extract lint_cmd)"
FORMAT_CMD="$(flow_extract format_cmd)"
BUILD_CMD="$(flow_extract build_cmd)"
TEST_CMD="$(flow_extract test_cmd)"

BUILD_FLAG="$PROJECT_DIR/.build-check"

STOP_MODE="$(flow_stop_check_mode)"
if [ "$STOP_MODE" = "off" ]; then
    rm -f "$BUILD_FLAG"             # never leave a stale marker to fire later
    exit 0
fi

# ---- Synchronous, blocking build/test gate (only when armed) --------------
# Builds and test suites cost time, disk, and sometimes money, so the gate runs
# only when the project opts in with `stop_check: lint+build`. The marker is
# consumed either way, so a stale one never fires later.
if [ -f "$BUILD_FLAG" ]; then
    rm -f "$BUILD_FLAG"            # one-shot: consume the marker
    [ "$STOP_MODE" = "lint+build" ] || BUILD_CMD="" TEST_CMD=""
    GATE_OUT=""
    GATE_FAIL=0
    for pair in "build:$BUILD_CMD" "test:$TEST_CMD"; do
        label="${pair%%:*}"; cmd="${pair#*:}"
        [ -n "$cmd" ] || continue
        if ! out=$(cd "$PROJECT_DIR" && eval "$cmd" 2>&1); then
            GATE_FAIL=1
            GATE_OUT="${GATE_OUT}
--- ${label} failed ---
$(printf '%s\n' "$out" | grep -iE '(error|fail|✖)' | head -10)
"
        fi
    done
    if [ "$GATE_FAIL" -ne 0 ]; then
        REASON="Build/test gate failed (armed by /flow:pause land):${GATE_OUT}"
        if command -v jq >/dev/null 2>&1; then
            jq -n --arg msg "$REASON" '{"decision":"block","reason":$msg}'
        else
            printf '[flow stop-check] %s\n' "$REASON" >&2
            exit 2
        fi
        exit 0
    fi
fi

# ---- Background, non-blocking lint/format on changed files ------------------
[ -n "$LINT_CMD$FORMAT_CMD" ] || exit 0

CHANGED=$(
    git -C "$PROJECT_DIR" diff --name-only HEAD 2>/dev/null
    git -C "$PROJECT_DIR" diff --name-only --cached 2>/dev/null
    git -C "$PROJECT_DIR" ls-files --others --exclude-standard 2>/dev/null
)
CHANGED=$(printf '%s\n' "$CHANGED" | grep -v '^$' | sort -u)
[ -z "$CHANGED" ] && exit 0

LOG="$PROJECT_DIR/.claude/.stop-check.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
# Rotate at ~50KB to bound growth.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 50000 ]; then
    tail -c 30000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# Detached: never blocks the Stop event.
(
    {
        echo "=== stop-check $(date '+%Y-%m-%d %H:%M:%S') ==="
        if [ -n "$FORMAT_CMD" ]; then
            echo "[format] $FORMAT_CMD"
            (cd "$PROJECT_DIR" && eval "$FORMAT_CMD" 2>&1) | tail -15
        fi
        if [ -n "$LINT_CMD" ]; then
            echo "[lint] $LINT_CMD"
            (cd "$PROJECT_DIR" && eval "$LINT_CMD" 2>&1) | grep -iE '(error|warn|✖)' | head -20
        fi
        echo ""
    } >>"$LOG" 2>&1
) >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
