#!/usr/bin/env bash
# bash-guard.sh
# PreToolUse hook for Bash. Two independent, fail-closed denylists:
#
#   1. External cost — commands that bill money OUTSIDE the Claude subscription:
#      CI minutes, cloud builds, deploys, metered backends, compute. Token spend
#      is NOT covered: it is capped by the plan and stops on its own.
#
#   2. Irreversible actions (added in the next task).
#
# Fails OPEN when jq is missing or no command can be read. Fails CLOSED (exit 2)
# on a positive match. Arming markers under .flow/ are one-shot: consumed on use.

set -u

if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/lib.sh
. "$SOURCE_DIR/../scripts/lib.sh"

INPUT=$(cat 2>/dev/null || true)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$COMMAND" ] || exit 0

PROJECT_DIR="$(flow_project_root)"

# Consume a one-shot arming marker. Returns 0 if it existed (and removes it).
consume_marker() {
    local marker="$PROJECT_DIR/.flow/$1"
    if [ -f "$marker" ]; then
        rm -f "$marker"
        return 0
    fi
    return 1
}

block() {
    printf '[flow bash-guard] BLOCKED: %s\n\n%s\n' "$1" "$2" >&2
    exit 2
}

# ---- 1. External cost -----------------------------------------------------
EXPENSIVE_CMDS="$(flow_expensive_cmds)"
IFS=','
for pattern in $EXPENSIVE_CMDS; do
    # Trim surrounding whitespace.
    pattern="${pattern#"${pattern%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [ -n "$pattern" ] || continue
    case "$COMMAND" in
        *"$pattern"*)
            unset IFS
            if consume_marker '.allow-expensive'; then
                exit 0
            fi
            block "\"$pattern\" costs real money outside your Claude subscription." \
"Command: $COMMAND

This bills independently of your plan — CI minutes, cloud build time, deploys,
metered backends, or compute left running.

To allow it once:
  mkdir -p .flow && touch .flow/.allow-expensive

To stop guarding it, edit \`expensive_cmds\` in .claude/config.md."
            ;;
    esac
done
unset IFS

exit 0
