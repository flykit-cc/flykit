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
# The two gates are independent: waiving one (via its own one-shot marker)
# never waives the other. `.allow-expensive` only consumes itself and falls
# through to rule set 2 — it does not exit early — so a command that is both
# expensive and irreversible (e.g. `fly deploy && git add -A && rm -rf
# node_modules`) still needs `.allow-destructive` too.
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
    # A backslash immediately followed by a newline is shell line
    # continuation: both characters are removed entirely (not replaced by a
    # space) before anything else runs, so `rm -r \`+newline+`-f build`
    # normalizes the same as the one-line `rm -r -f build` it actually is.
    # Order relative to quote-stripping doesn't matter, but this MUST happen
    # before the newline->sentinel mapping below, or the continued line would
    # be split into two statements by for_each_statement.
    # bash 3.2 (macOS's shipped /bin/bash) fails to expand an inline $'...'
    # ANSI-C-quoted pattern inside a `${var//pattern/repl}` substitution — it
    # must be pre-expanded into its own variable first. That variable then
    # has to be quoted at the point of use, too: unquoted, its backslash is
    # itself a glob escape character, which would make the pattern match a
    # bare newline (escaped-to-itself) instead of backslash-then-newline.
    local cont=$'\\\n'
    local s="${1//"$cont"/}"
    printf '%s' "$s" | tr -d "\"'" | tr '\n\r' '\001\001' | tr -s ' \t' ' '
}

NORM_COMMAND="$(normalize "$COMMAND")"

# ---- 1. External cost -----------------------------------------------------
EXPENSIVE_CMDS="$(flow_expensive_cmds)"
EXPENSIVE_MATCH=""
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
            EXPENSIVE_MATCH="$pattern"
            break
            ;;
    esac
done
unset IFS

# A match only waives THIS gate — it must fall through to rule set 2 below,
# not exit. (See the file header: the two gates are independent.)
if [ -n "$EXPENSIVE_MATCH" ] && ! consume_marker '.allow-expensive'; then
    block "\"$EXPENSIVE_MATCH\" costs real money outside your Claude subscription." \
"Command: $COMMAND

This bills independently of your plan — CI minutes, cloud build time, deploys,
metered backends, or compute left running.

To allow it once:
  mkdir -p .flow && touch .flow/.allow-expensive

To stop guarding it, edit \`expensive_cmds\` in .claude/config.md."
fi

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
# Token boundary: space, or the newline sentinel. A real newline is a
# statement break (see for_each_statement below), and the per-statement
# checkers it drives never see a sentinel — normalize() already joins any
# backslash-continued line back into one before the newline gets mapped to
# the sentinel at all. The sentinel still belongs in this class because the
# top-level `matches()` checks below run against the *whole*, unsplit
# NORM_COMMAND, where it legitimately sits between two genuine
# newline-separated statements — e.g. `echo hi`+newline+`git add -A` — and
# the leading anchor needs to treat that as a boundary too.
B="[$SENTINEL[:space:]]"
DESTRUCTIVE_REASON=""
matches() { printf '%s' "$NORM_COMMAND" | grep -qE "$1"; }

# Optional git global options between `git` and the subcommand — e.g. this
# plugin's own `git -C "$REPO_ROOT" ...` house style (scripts/pause-helpers.sh
# uses it ~20 times, so it's exactly the form a model is primed to emit), or
# `-c key=val`, `--git-dir=...`, `--work-tree=...`. Without this, any global
# option welds itself between `git` and the subcommand and breaks every rule
# below that expects them adjacent.
GIT_OPT="(${B}+-C${B}+[^$SENTINEL[:space:]]+|${B}+-c${B}+[^$SENTINEL[:space:]]+|${B}+--git-dir=[^$SENTINEL[:space:]]+|${B}+--work-tree=[^$SENTINEL[:space:]]+)"
GIT_PREFIX="git(${GIT_OPT})*${B}+"

# `rm`, or a path-qualified invocation like `/bin/rm` — accept an optional
# directory prefix ending in `/` before the bare command name.
RM_CMD="([^$SENTINEL[:space:];&|]*/)?rm"

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
# order and position (before/after the path) don't matter. Long options
# (`--recursive`, `--force`) can't fuse into a short cluster, so they're
# alternated in as their own whole-token match.
_rm_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^| )${RM_CMD}( |\$)" || return 1
    printf '%s' "$1" | grep -qE '(^| )(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)( |$)' || return 1
    printf '%s' "$1" | grep -qE '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force)( |$)'
}
rm_is_destructive() { for_each_statement _rm_stmt_destructive; }

# `git checkout .` discards every uncommitted change in the tree — as
# destructive as `reset --hard`. `git checkout -- <path>` and
# `git checkout <ref> -- <path>` (one leading ref/branch token, not a flag)
# restore specific paths from the index/ref and are just as irreversible.
# `git checkout -f`/`--force` discards every uncommitted modification too —
# strictly worse than `checkout .`. Plain `git checkout <branch>` /
# `git checkout -b <new>` (no `.` argument, no `--`, no force flag) is
# switching branches — reversible, routine, must stay allowed. Scoped
# per-statement like rm/restore/reset (see for_each_statement) so the
# trailing-boundary class no longer has to omit `;&|`.
_checkout_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}checkout($B|\$)" || return 1
    if printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}checkout${B}\\.($B|\$)"; then
        return 0
    fi
    if printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}checkout(${B}[^$SENTINEL[:space:]-][^$SENTINEL[:space:]]*)?${B}--($B|\$)"; then
        return 0
    fi
    printf '%s' "$1" | grep -qE "($B)(-[a-zA-Z]*f[a-zA-Z]*|--force)($B|\$)"
}
checkout_is_destructive() { for_each_statement _checkout_stmt_destructive; }

# `git switch --discard-changes` is `checkout -f`'s equivalent under the
# newer `switch` subcommand.
_switch_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}switch($B|\$)" || return 1
    printf '%s' "$1" | grep -qE "($B)--discard-changes($B|\$)"
}
switch_is_destructive() { for_each_statement _switch_stmt_destructive; }

# `git restore` only touches the working tree — and is therefore not
# reversible on its own — when the change actually lands there. Default (no
# --staged) writes to the tree: BLOCK. --staged alone only unstages, tree
# untouched: ALLOW. --staged --worktree (or --worktree alone) writes to the
# tree regardless of --staged: BLOCK. Scoped per-statement (see
# for_each_statement) so one restore's --staged can't paper over a different,
# genuinely destructive restore elsewhere in a compound command.
_restore_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}restore${B}[^$SENTINEL[:space:]]" || return 1
    if printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}restore.*--worktree($B|\$)"; then
        return 0
    fi
    ! printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}restore.*--staged($B|\$)"
}
restore_is_destructive() { for_each_statement _restore_stmt_destructive; }

# `git reset --hard` discards uncommitted work irreversibly, with the flag
# in either position (`--hard` before or after the ref). Bare `.*` between
# `reset` and `--hard` (the original brief's pattern) reaches across
# statement separators — `git reset --soft HEAD; echo --hard` doesn't touch
# reset at all, but `.*` doesn't know that and blocks it anyway. Scoped
# per-statement like rm/restore so a `--hard` in a different statement (or a
# commit message, once quotes are stripped) can't trigger this.
_reset_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}reset($B|\$)" || return 1
    printf '%s' "$1" | grep -qE "($B)--hard($B|\$)"
}
reset_is_destructive() { for_each_statement _reset_stmt_destructive; }

# `git add -A`/`--all`/`-u`/`--update`/`.` all stage a blanket set of files
# rather than named paths. Cluster-matched (`-Av`, `-uv`, `-v -A`, ...) and
# scanned across every arg — not just an exact first-position token — the
# same way the sibling commit rule already is. Scoped per-statement like
# add/commit/checkout/restore/reset (see for_each_statement) so the trailing
# boundary no longer omits `;&|`.
_add_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}add($B|\$)" || return 1
    printf '%s' "$1" | grep -qE "($B)(-[a-zA-Z]*[Au][a-zA-Z]*|--all|--update|\\.)($B|\$)"
}
add_is_destructive() { for_each_statement _add_stmt_destructive; }

# `git commit -a`/`--all` stages every tracked change. Same cluster-match /
# scan-all-args / statement-scoping treatment as `add` above.
_commit_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}commit($B|\$)" || return 1
    printf '%s' "$1" | grep -qE "($B)(-[a-zA-Z]*a[a-zA-Z]*|--all)($B|\$)"
}
commit_is_destructive() { for_each_statement _commit_stmt_destructive; }

# `git clean` refuses to run at all without one of -f/-n/-i (git enforces
# `clean.requireForce`), so an f-flag is the signal to gate on. -n (dry-run)
# and -i (interactive) both make it safe even combined with -f: -n never
# deletes anything, -i prompts before each removal. `-fd`/`-fdx` sweeps up
# untracked *and* ignored files recursively — exactly the "sweeps up files
# you parked" case this rule set exists for, and it would delete `.flow/`
# session state.
_clean_stmt_destructive() {
    printf '%s' "$1" | grep -qE "(^|$B)${GIT_PREFIX}clean($B|\$)" || return 1
    printf '%s' "$1" | grep -qE "($B)(-[a-zA-Z]*f[a-zA-Z]*|--force)($B|\$)" || return 1
    ! printf '%s' "$1" | grep -qE "($B)(-[a-zA-Z]*[ni][a-zA-Z]*|--dry-run|--interactive)($B|\$)"
}
clean_is_destructive() { for_each_statement _clean_stmt_destructive; }

if add_is_destructive; then
    DESTRUCTIVE_REASON="blanket staging sweeps up files you parked — stage named paths instead"
elif commit_is_destructive; then
    DESTRUCTIVE_REASON="\`git commit -a\` stages every tracked change — stage named paths instead"
elif reset_is_destructive; then
    DESTRUCTIVE_REASON="\`git reset --hard\` discards uncommitted work irreversibly"
elif checkout_is_destructive; then
    DESTRUCTIVE_REASON="this discards uncommitted changes to those paths irreversibly"
elif switch_is_destructive; then
    DESTRUCTIVE_REASON="\`git switch --discard-changes\` discards uncommitted changes irreversibly"
elif restore_is_destructive; then
    DESTRUCTIVE_REASON="this discards uncommitted changes to those paths irreversibly"
elif clean_is_destructive; then
    DESTRUCTIVE_REASON="recursive force-delete of untracked (and possibly ignored) files is irreversible"
elif matches "(^|[;&|]|$B)${RM_CMD}${B}+(-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])" || rm_is_destructive; then
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
