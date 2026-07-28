#!/usr/bin/env bash
# auto-lint.sh
# PostToolUse hook for Write|Edit. Runs format_cmd and lint_cmd from
# .claude/config.md against the file that was just touched. Non-blocking:
# always exits 0; reports findings on stderr.
#
# This hook only runs commands known to accept a single file path argument
# (per-file linters/formatters like eslint, prettier, gofmt). Commands that
# don't — test runners, cargo/go subcommands, package-manager script
# wrappers like `npm run lint` — are skipped here and left to
# stop-check.sh, which runs format_cmd/lint_cmd bare (no file args) once
# over all changed files at the end of the turn. Do not "fix" this by
# appending the file path to those commands too; it breaks them.

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

# Decide whether a configured command accepts a single trailing file path
# argument. Looks at the tool name — the first word after unwrapping a
# leading npx/pnpm-exec/yarn-dlx/bunx runner and stripping any path prefix
# (e.g. ./node_modules/.bin/eslint -> eslint) — against a fixed allowlist.
# Package-manager script runners (npm run, plain pnpm/yarn/bun) and
# Cargo/Go subcommands are always rejected, even if a later word happens
# to match the allowlist, since they don't take a file arg the way we'd
# append it here.
accepts_file_path() {
    local cmd="$1"
    local w1 w2
    w1=$(printf '%s' "$cmd" | awk '{print $1}')
    w2=$(printf '%s' "$cmd" | awk '{print $2}')

    case "$w1" in
        npx|bunx)
            w1="$w2"
            ;;
        pnpm)
            if [ "$w2" = "exec" ]; then
                w1=$(printf '%s' "$cmd" | awk '{print $3}')
            else
                return 1
            fi
            ;;
        yarn)
            if [ "$w2" = "dlx" ]; then
                w1=$(printf '%s' "$cmd" | awk '{print $3}')
            else
                return 1
            fi
            ;;
        npm|bun|make|cargo|go)
            return 1
            ;;
    esac

    local tool="${w1##*/}"
    case "$tool" in
        eslint|prettier|biome|stylelint|ruff|black|isort|flake8|rubocop|standardrb|gofmt|goimports|shellcheck|shfmt|clang-format|php-cs-fixer|swiftformat|swiftlint|dartfmt|ktlint)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

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

if [ -n "$FORMAT_CMD" ] && accepts_file_path "$FORMAT_CMD"; then
    FORMAT_CMD=$(maybe_fix "$FORMAT_CMD")
    run_cmd "format" "$FORMAT_CMD"
fi

if [ -n "$LINT_CMD" ] && accepts_file_path "$LINT_CMD"; then
    LINT_CMD=$(maybe_fix "$LINT_CMD")
    run_cmd "lint" "$LINT_CMD"
fi

exit 0
