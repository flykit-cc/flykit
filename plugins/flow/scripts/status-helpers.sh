#!/usr/bin/env bash
# status-helpers.sh — deterministic shell work for /flow:status.
#
# Read-only by contract: nothing here writes to the repo, stages, pushes, or
# spawns an agent. /flow:status answers "where am I / what's running / what
# next" without restoring anything — it is the read that /flow:continue was
# being misused for.
#
# Usage:
#   status-helpers.sh git-state   # branch/ahead/behind/changed/last, one key=value per line
#   status-helpers.sh progress    # goal, paused-at, verification, open tasks from session-progress.md
#   status-helpers.sh pr-state    # open PR + CI for this branch (needs gh; degrades to unavailable)
#   status-helpers.sh all         # all of the above, each under a [section] header

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SOURCE_DIR/lib.sh"

REPO_ROOT="$(flow_project_root)"
PROGRESS="$REPO_ROOT/.flow/session-progress.md"

# Is this a git repo at all? Everything git-flavoured checks this first so the
# command still works in a plain directory.
in_git() {
    git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

git_state() {
    if ! in_git; then
        echo "repo=none"
        return 0
    fi

    local branch upstream counts behind ahead changed last
    branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    echo "branch=$branch"

    # Ahead/behind needs a tracking branch. A detached HEAD or an unpushed
    # local branch has none — say so rather than print a misleading 0/0.
    upstream="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    if [ -n "$upstream" ]; then
        # --left-right --count prints "<behind>\t<ahead>" for upstream...HEAD.
        if counts="$(git -C "$REPO_ROOT" rev-list --left-right --count "$upstream...HEAD" 2>/dev/null)"; then
            behind="$(printf '%s' "$counts" | awk '{print $1}')"
            ahead="$(printf '%s' "$counts" | awk '{print $2}')"
            echo "upstream=$upstream"
            echo "ahead=${ahead:-0}"
            echo "behind=${behind:-0}"
        fi
    else
        echo "upstream=none"
    fi

    # Uncommitted paths, tracked and untracked.
    changed="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    echo "changed=${changed:-0}"

    last="$(git -C "$REPO_ROOT" log -1 --format='%h %s' 2>/dev/null || true)"
    [ -n "$last" ] && echo "last=$last"

    return 0
}

progress_state() {
    if [ ! -f "$PROGRESS" ]; then
        echo "progress=missing"
        return 0
    fi
    echo "progress=exists"

    # Age in days, so the caller can flag a stale session.
    local now mtime
    now=$(date +%s)
    if mtime=$(stat -f %m "$PROGRESS" 2>/dev/null); then :; else mtime=$(stat -c %Y "$PROGRESS" 2>/dev/null || echo "$now"); fi
    echo "age_days=$(( (now - mtime) / 86400 ))"

    # The Goal section: first non-empty prose line under `## Goal`.
    local goal
    goal="$(awk '
        /^## +Goal/ { in_goal = 1; next }
        /^## / { in_goal = 0 }
        in_goal && NF { print; exit }
    ' "$PROGRESS" 2>/dev/null || true)"
    [ -n "$goal" ] && echo "goal=$goal"

    # Single-line facts the pause command writes verbatim.
    local paused verification
    paused="$(grep -m1 -E '^Paused at:' "$PROGRESS" 2>/dev/null | sed -E 's/^Paused at:[[:space:]]*//' || true)"
    [ -n "$paused" ] && echo "paused_at=$paused"

    verification="$(grep -m1 -E '^Verification:' "$PROGRESS" 2>/dev/null | sed -E 's/^Verification:[[:space:]]*//' || true)"
    [ -n "$verification" ] && echo "verification=$verification"

    # Open tasks only — `- [ ]`, never `- [x]`. Capped so a long backlog can't
    # flood the status read.
    local open_count
    open_count="$(grep -c -E '^[[:space:]]*- \[ \]' "$PROGRESS" 2>/dev/null || true)"
    echo "open_tasks=${open_count:-0}"
    grep -E '^[[:space:]]*- \[ \]' "$PROGRESS" 2>/dev/null | head -5 | sed 's/^/task=/' || true

    return 0
}

pr_state() {
    if ! in_git; then
        echo "pr=unavailable"
        return 0
    fi
    if ! command -v gh >/dev/null 2>&1; then
        echo "pr=unavailable"
        return 0
    fi
    # A network call on a read-only status command, so bound it: a slow or
    # unauthenticated gh must never hang the status read. `timeout` is GNU and
    # ships as `gtimeout` from coreutils on macOS; when neither exists we still
    # run gh, since a missing timeout is not a reason to drop the PR check.
    local runner=() out
    if command -v timeout >/dev/null 2>&1; then
        runner=(timeout 5)
    elif command -v gtimeout >/dev/null 2>&1; then
        runner=(gtimeout 5)
    fi
    # `${runner[@]+...}` guards the empty-array case: under `set -u`, bash 3.2
    # (the macOS default) treats a bare "${runner[@]}" on an empty array as an
    # unbound variable and aborts.
    if ! out="$(${runner[@]+"${runner[@]}"} gh pr view --json number,title,state,statusCheckRollup 2>/dev/null)"; then
        # No PR for this branch, not authenticated, or timed out — all of which
        # are "nothing to report" for a status read, not an error.
        echo "pr=none"
        return 0
    fi
    [ -z "$out" ] && { echo "pr=none"; return 0; }

    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$out" | jq -r '
            "pr=#\(.number) \(.title)",
            "pr_state=\(.state)",
            "pr_checks=\(
                if (.statusCheckRollup // []) | length == 0 then "none"
                else
                    ((.statusCheckRollup // []) | map(.conclusion // .state // "PENDING")) as $c
                    | if   ($c | map(select(. == "FAILURE" or . == "ERROR")) | length) > 0 then "failing"
                      elif ($c | map(select(. == "SUCCESS")) | length) == ($c | length)    then "passing"
                      else "pending" end
                end
            )"
        ' 2>/dev/null || echo "pr=unavailable"
    else
        # No jq: report that a PR exists without pretending to parse checks.
        echo "pr=open"
        echo "pr_checks=unknown"
    fi

    return 0
}

cmd="${1:-}"

case "$cmd" in
  git-state) git_state ;;
  progress)  progress_state ;;

  all)
    echo "[git]";      git_state
    echo "[progress]"; progress_state
    echo "[pr]";       pr_state
    ;;

  *)
    echo "unknown subcommand: $cmd" >&2
    exit 1
    ;;
esac
