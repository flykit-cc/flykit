#!/usr/bin/env bash
# stop-check.sh
# Stop hook: before Claude returns control to the user, run lint + typecheck
# (and optionally build) if source files have changed this session.
# Exit 2 blocks the stop and surfaces errors to the model for follow-up.

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CONFIG="$PROJECT_DIR/.claude/config.md"

# No config -> non-blocking.
[ -f "$CONFIG" ] || exit 0

# Need git for diff detection.
if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Any uncommitted source changes? (Cheap proxy for "did this session edit code".)
CHANGED=$(git -C "$PROJECT_DIR" diff --name-only 2>/dev/null; \
          git -C "$PROJECT_DIR" diff --name-only --staged 2>/dev/null)
if [ -z "$CHANGED" ]; then
    exit 0
fi

extract_cmd() {
    local key="$1"
    grep -E "^[[:space:]]*(-[[:space:]]+)?${key}[[:space:]]*:" "$CONFIG" 2>/dev/null \
        | tail -n1 \
        | sed -E "s/^[[:space:]]*(-[[:space:]]+)?${key}[[:space:]]*:[[:space:]]*//" \
        | sed -E 's/[[:space:]]*$//' \
        | sed -E 's/^["'\'']//; s/["'\'']$//'
}

LINT_CMD=$(extract_cmd "lint_cmd")
TYPECHECK_CMD=$(extract_cmd "typecheck_cmd")
BUILD_CMD=$(extract_cmd "build_cmd")

FAIL=0
ERR_OUT=""

run_check() {
    local label="$1"
    local cmd="$2"
    [ -n "$cmd" ] || return 0
    local out
    if ! out=$(cd "$PROJECT_DIR" && eval "$cmd" 2>&1); then
        FAIL=1
        ERR_OUT="${ERR_OUT}
--- ${label} failed ---
$(printf '%s\n' "$out" | tail -n 50)
"
    fi
}

run_check "lint" "$LINT_CMD"
run_check "typecheck" "$TYPECHECK_CMD"

if [ -f "$PROJECT_DIR/.build-check" ]; then
    run_check "build" "$BUILD_CMD"
fi

if [ "$FAIL" -ne 0 ]; then
    printf '[flow stop-check] Pre-stop checks failed:\n%s\n' "$ERR_OUT" >&2
    exit 2
fi

exit 0
