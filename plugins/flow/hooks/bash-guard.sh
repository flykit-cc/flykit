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
# Scope limit: this hook only ever sees the literal string handed to the Bash
# tool. It cannot see git commands run inside flow's own helper scripts as
# child processes — e.g. pause-helpers.sh's `finish` calling `git add -- "$f"`
# internally never passes through here at all. That is by design: those
# scripts have their own narrower guards (finish stages named paths one at a
# time and refuses to commit staged secrets or private paths) rather than
# needing an `.allow-destructive` carve-out. Do not add a speculative arming
# step to the pause path "just in case" — the marker is one-shot and consumed
# only by a matching command, so if nothing in that path ever matches (as is
# the case today), it never gets consumed: it persists on disk as a standing
# bypass token that silently waves through the next unrelated destructive
# command, in any later session. If `finish` ever does grow a destructive
# call, arm the marker immediately before that specific call so it is
# consumed there — not speculatively at the top of the path.
#
# Matched against NORM_COMMAND (quotes stripped, so `git "add" -A` is caught),
# not raw $COMMAND. But normalize() turns newlines into the sentinel byte
# \001, not a character in [[:space:]] — so every boundary class below adds
# the sentinel alongside [:space:], or a command on line 2 of a multi-line
# script would slip past the leading anchor.
SENTINEL=$'\001'
# Token boundary within a single statement: space, or the newline sentinel
# (a real newline is a statement break too — see for_each_statement below —
# but a command can itself still contain the sentinel, e.g. a line-continued
# `rm -r \` \n `-f build`, so boundary matching still needs to accept it).
B="[$SENTINEL[:space:]]"
DESTRUCTIVE_REASON=""
matches() { printf '%s' "$NORM_COMMAND" | grep -qE "$1"; }

# Run $2 once per statement in $NORM_COMMAND, passing that one statement as
# $1 to it; returns 0 (destructive) as soon as any call does. Splitting on
# every real statement separator — ; & | and the newline sentinel — before
# correlating flags is what rm/restore need: two independent existence
# checks run against the *whole* command (e.g. "has an -r flag somewhere"
# and "has an -f flag somewhere") can each be satisfied by a *different*
# statement, e.g. `rm -r dir; docker rm -f container` — unrelated commands,
# neither one destructive on its own. Worse, the same shortcut can produce a
# false NEGATIVE: `git restore a.ts; git restore --staged b.ts` would read
# as "restore invoked, and --staged present somewhere" and wrongly allow the
# first (genuinely destructive) restore. Scoping to one statement at a time
# closes both directions.
for_each_statement() {
    local checker="$1" stmt
    while IFS= read -r stmt; do
        [ -n "$stmt" ] || continue
        if "$checker" "$stmt"; then
            return 0
        fi
    done < <(printf '%s\n' "$NORM_COMMAND" | tr "$SENTINEL;&|" '\n\n\n\n')
    return 1
}

# `rm -r -f build`: recursive and force given as separate tokens, not fused
# into one flag cluster like `-rf`. Within one statement, both a token
# matching an r-flag and a token matching an f-flag must be present —
# order and position (before/after the path) don't matter.
_rm_stmt_destructive() {
    printf '%s' "$1" | grep -qE '(^| )rm( |$)' || return 1
    printf '%s' "$1" | grep -qE '(^| )-[a-zA-Z]*[rR][a-zA-Z]*( |$)' || return 1
    printf '%s' "$1" | grep -qE '(^| )-[a-zA-Z]*f[a-zA-Z]*( |$)'
}
rm_is_destructive() { for_each_statement _rm_stmt_destructive; }

# `git checkout .` discards every uncommitted change in the tree — as
# destructive as `reset --hard`. `git checkout -- <path>` and
# `git checkout <ref> -- <path>` (one leading ref/branch token, not a flag)
# restore specific paths from the index/ref and are just as irreversible.
# Plain `git checkout <branch>` / `git checkout -b <new>` (no `.` argument,
# no `--`) is switching branches — reversible, routine, must stay allowed.
checkout_is_destructive() {
    matches "(^|[;&|]|$B)git${B}+checkout${B}+\\.($B|\$)" && return 0
    matches "(^|[;&|]|$B)git${B}+checkout(${B}+[^$SENTINEL[:space:]-][^$SENTINEL[:space:]]*)?${B}+--($B|\$)"
}

# `git restore` only touches the working tree — and is therefore not
# reversible on its own — when the change actually lands there. Default (no
# --staged) writes to the tree: BLOCK. --staged alone only unstages, tree
# untouched: ALLOW. --staged --worktree (or --worktree alone) writes to the
# tree regardless of --staged: BLOCK. Scoped per-statement (see
# for_each_statement) so one restore's --staged can't paper over a different,
# genuinely destructive restore elsewhere in a compound command.
_restore_stmt_destructive() {
    printf '%s' "$1" | grep -qE '(^| )git( )+restore( )+[^ ]' || return 1
    if printf '%s' "$1" | grep -qE '(^| )git( )+restore.*--worktree( |$)'; then
        return 0
    fi
    ! printf '%s' "$1" | grep -qE '(^| )git( )+restore.*--staged( |$)'
}
restore_is_destructive() { for_each_statement _restore_stmt_destructive; }

if matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+add[$SENTINEL[:space:]]+(-A|--all|-u|\\.)([$SENTINEL[:space:]]|\$)"; then
    DESTRUCTIVE_REASON="blanket staging sweeps up files you parked — stage named paths instead"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+commit[$SENTINEL[:space:]]+(-[a-zA-Z]*a[a-zA-Z]*|--all)([$SENTINEL[:space:]]|\$)"; then
    DESTRUCTIVE_REASON="\`git commit -a\` stages every tracked change — stage named paths instead"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])git[$SENTINEL[:space:]]+reset[$SENTINEL[:space:]]+.*--hard"; then
    DESTRUCTIVE_REASON="\`git reset --hard\` discards uncommitted work irreversibly"
elif checkout_is_destructive; then
    DESTRUCTIVE_REASON="this discards uncommitted changes to those paths irreversibly"
elif restore_is_destructive; then
    DESTRUCTIVE_REASON="this discards uncommitted changes to those paths irreversibly"
elif matches "(^|[;&|]|[$SENTINEL[:space:]])rm[$SENTINEL[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])" || rm_is_destructive; then
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
