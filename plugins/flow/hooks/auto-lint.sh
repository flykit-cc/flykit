#!/usr/bin/env bash
# auto-lint.sh
# PostToolUse hook for Write|Edit. Runs format_cmd and lint_cmd from
# .claude/config.md against the file that was just touched. Non-blocking:
# always exits 0; reports findings on stderr.

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CONFIG="$PROJECT_DIR/.claude/config.md"

# Need jq to parse tool input.
if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

INPUT=$(cat 2>/dev/null || true)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Skip if file is outside project dir.
case "$FILE_PATH" in
    "$PROJECT_DIR"/*) ;;
    *) exit 0 ;;
esac

# Skip if file no longer exists (e.g. deletion).
[ -f "$FILE_PATH" ] || exit 0

# Skip if no config.
[ -f "$CONFIG" ] || exit 0

# Extract a value from config.md. Format expected:
#   key: value
# or in a code block. Take the last non-empty line matching `key:`.
extract_cmd() {
    local key="$1"
    grep -E "^[[:space:]]*(-[[:space:]]+)?${key}[[:space:]]*:" "$CONFIG" 2>/dev/null \
        | tail -n1 \
        | sed -E "s/^[[:space:]]*(-[[:space:]]+)?${key}[[:space:]]*:[[:space:]]*//" \
        | sed -E 's/[[:space:]]*$//' \
        | sed -E 's/^["'\'']//; s/["'\'']$//'
}

FORMAT_CMD=$(extract_cmd "format_cmd")
LINT_CMD=$(extract_cmd "lint_cmd")

# Heuristic: append --fix only to known auto-fixers.
maybe_fix() {
    local cmd="$1"
    case "$cmd" in
        *eslint*|*ruff*|*biome*|*stylelint*|*standardrb*|*rubocop*)
            printf '%s --fix' "$cmd"
            ;;
        *)
            printf '%s' "$cmd"
            ;;
    esac
}

run_cmd() {
    local label="$1"
    local cmd="$2"
    [ -n "$cmd" ] || return 0
    # Run with the file appended. Many formatters accept a path arg.
    local out
    out=$(cd "$PROJECT_DIR" && eval "$cmd \"$FILE_PATH\"" 2>&1) || {
        printf '[flow auto-%s] %s\n' "$label" "$cmd $FILE_PATH" >&2
        printf '%s\n' "$out" | head -n 20 >&2
    }
}

if [ -n "$FORMAT_CMD" ]; then
    FORMAT_CMD=$(maybe_fix "$FORMAT_CMD")
    run_cmd "format" "$FORMAT_CMD"
fi

if [ -n "$LINT_CMD" ]; then
    LINT_CMD=$(maybe_fix "$LINT_CMD")
    run_cmd "lint" "$LINT_CMD"
fi

exit 0
