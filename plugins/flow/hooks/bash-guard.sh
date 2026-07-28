#!/usr/bin/env bash
# bash-guard.sh
# PreToolUse hook for Bash. Two independent, fail-closed denylists:
#
#   1. External cost — commands that bill money OUTSIDE the Claude subscription:
#      CI minutes, cloud builds, deploys, metered backends, compute. Token spend
#      is NOT covered: it is capped by the plan and stops on its own.
#
#   2. Irreversible actions — blanket staging, hard resets, recursive
#      force-deletes. Reversible work needs no approval; this gates the rest.
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

# Collapse runs of whitespace to a single space and strip quote characters, so
# `fly   deploy`, `"fly" deploy`, and `fly deploy` all compare equal. Newlines
# are translated to a sentinel byte first (not collapsed with other
# whitespace) so patterns — which never contain a newline — can never match
# across a line boundary; otherwise `echo fly` + `deploy something` on
# adjacent lines would falsely join into "fly deploy". Never mutate $COMMAND
# itself — the block message must show what the user typed.
normalize() {
    printf '%s' "$1" | tr -d "\"'" | tr '\n\r' '\001\001' | tr -s ' \t' ' '
}

NORM_COMMAND="$(normalize "$COMMAND")"

# ---- 1. External cost -----------------------------------------------------
EXPENSIVE_CMDS="$(flow_expensive_cmds)"
IFS=','
for pattern in $EXPENSIVE_CMDS; do
    # Trim surrounding whitespace.
    pattern="${pattern#"${pattern%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [ -n "$pattern" ] || continue
    NORM_PATTERN="$(normalize "$pattern")"
    [ -n "$NORM_PATTERN" ] || continue
    case "$NORM_COMMAND" in
        *"$NORM_PATTERN"*)
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

# ---- 2. Irreversible actions ----------------------------------------------
# The line the user draws is reversibility, not permission: proceed freely on
# reversible work, gate anything that destroys state or sweeps up files that
# were deliberately parked. Blanket staging is how private paths once reached a
# public remote.
# Matched with anchored regexes, not glob substrings: a `case` pattern of
# *"git add ."* also matches `git add .gitignore`, which is a named path and
# perfectly safe. The argument must be the WHOLE token.
#
# Matched against NORM_COMMAND (quotes stripped, so `git "add" -A` is caught),
# not raw $COMMAND. But normalize() turns newlines into the sentinel byte
# \001, not a character in [[:space:]] — so every boundary class below adds
# the sentinel alongside [:space:], or a command on line 2 of a multi-line
# script would slip past the leading anchor.
SENTINEL=$'\001'
DESTRUCTIVE_REASON=""
matches() { printf '%s' "$NORM_COMMAND" | grep -qE "$1"; }

if matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+add[$SENTINEL[:space:]]+(-A|--all|-u|\\.)([$SENTINEL[:space:]]|\$)"; then
    DESTRUCTIVE_REASON="blanket staging sweeps up files you parked — stage named paths instead"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+commit[$SENTINEL[:space:]]+(-[a-zA-Z]*a[a-zA-Z]*|--all)([$SENTINEL[:space:]]|\$)"; then
    DESTRUCTIVE_REASON="\`git commit -a\` stages every tracked change — stage named paths instead"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+reset[$SENTINEL[:space:]]+.*--hard"; then
    DESTRUCTIVE_REASON="\`git reset --hard\` discards uncommitted work irreversibly"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+checkout[$SENTINEL[:space:]]+--[$SENTINEL[:space:]]"; then
    DESTRUCTIVE_REASON="this discards uncommitted changes to those paths irreversibly"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+restore[$SENTINEL[:space:]]+(--staged[$SENTINEL[:space:]]+)?[^-]"; then
    DESTRUCTIVE_REASON="this discards uncommitted changes to those paths irreversibly"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])rm[$SENTINEL[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])"; then
    DESTRUCTIVE_REASON="recursive force-delete is irreversible"
fi

if [ -n "$DESTRUCTIVE_REASON" ]; then
    if consume_marker '.allow-destructive'; then
        exit 0
    fi
    block "$DESTRUCTIVE_REASON" \
"Command: $COMMAND

Reversible work needs no approval; this is not reversible.

To allow it once:
  mkdir -p .flow && touch .flow/.allow-destructive"
fi

exit 0
