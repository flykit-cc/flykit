#!/usr/bin/env bash
# pause-helpers.sh — deterministic shell work for /flow:pause.
# Each subcommand prints its result to stdout; the LLM only narrates.
# Stack-agnostic: anything stack-specific is read from .claude/config.md.
#
# Usage:
#   pause-helpers.sh changed-files                 # uncommitted paths (one per line)
#   pause-helpers.sh diff-since-pause              # commits since last pause marker
#   pause-helpers.sh write-marker                  # record HEAD/branch/timestamp
#   pause-helpers.sh read-marker                   # echo the previous marker (or empty)
#   pause-helpers.sh log-block <title-file> <body-file>   # prepend dated block to session-log.md
#   pause-helpers.sh trim-or-delete-progress       # drop session-progress.md if nothing in flight
#   pause-helpers.sh report                        # branch + last commit, for the chat report
#   pause-helpers.sh drift-check                   # heuristic doc-drift warnings (non-blocking)
#   pause-helpers.sh save-memory <index> <file>... # append memory files + refresh index
#   pause-helpers.sh finish <title-file> <body-file> <commit-msg> [--no-push|--land] [--close <token>]

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SOURCE_DIR/lib.sh"

REPO_ROOT="$(flow_project_root)"
STATE_DIR="$REPO_ROOT/.claude/state"
MARKER="$STATE_DIR/last-pause"
PROGRESS="$REPO_ROOT/session-progress.md"
LOG="$REPO_ROOT/session-log.md"

SECRET_RE="$(flow_secret_regex)"
PRIVATE_RE="$(flow_private_regex)"

mkdir -p "$STATE_DIR" 2>/dev/null || true

cmd="${1:-}"
shift || true

case "$cmd" in
  changed-files)
    git -C "$REPO_ROOT" diff --name-only HEAD 2>/dev/null
    git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null
    git -C "$REPO_ROOT" ls-files --others --exclude-standard 2>/dev/null
    ;;

  diff-since-pause)
    if [ -f "$MARKER" ]; then
      LAST_HASH=$(awk '{print $1}' "$MARKER")
      if git -C "$REPO_ROOT" cat-file -e "$LAST_HASH" 2>/dev/null; then
        git -C "$REPO_ROOT" log --oneline "$LAST_HASH..HEAD" 2>/dev/null
      else
        echo "(marker hash $LAST_HASH not found; showing last 5 commits)"
        git -C "$REPO_ROOT" log --oneline -5 2>/dev/null
      fi
    else
      echo "(no prior pause marker; showing last 5 commits)"
      git -C "$REPO_ROOT" log --oneline -5 2>/dev/null
    fi
    ;;

  write-marker)
    HASH=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "no-git")
    BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "no-git")
    TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '%s %s %s\n' "$HASH" "$BRANCH" "$TS" > "$MARKER"
    echo "marker written: $HASH $BRANCH $TS"
    ;;

  read-marker)
    [ -f "$MARKER" ] && cat "$MARKER" || echo ""
    ;;

  log-block)
    TITLE_FILE="${1:-}"; BODY_FILE="${2:-}"
    [ -f "$TITLE_FILE" ] && [ -f "$BODY_FILE" ] || { echo "log-block needs <title-file> <body-file>" >&2; exit 1; }
    DATE=$(date -u +%Y-%m-%d)
    TITLE=$(head -1 "$TITLE_FILE" | sed 's/^[# ]*//')
    NEW=$(mktemp)
    {
      printf '## %s · %s\n\n' "$DATE" "$TITLE"
      cat "$BODY_FILE"
      printf '\n'
      [ -f "$LOG" ] && cat "$LOG"
    } > "$NEW"
    mv "$NEW" "$LOG"
    echo "log-block prepended: $DATE · $TITLE"
    ;;

  trim-or-delete-progress)
    if [ ! -f "$PROGRESS" ]; then echo "no-progress-file"; exit 0; fi
    # Open tasks are unchecked markdown checkboxes.
    OPEN_TASKS=$(grep -cE '^[[:space:]]*- \[ \]' "$PROGRESS" 2>/dev/null || true)
    HAS_GOAL=$(awk '/^#+ *Goal/{flag=1; next} /^#+ /{flag=0} flag && NF{print; exit}' "$PROGRESS")
    HAS_PAUSED=$(awk '/^#+ *Paused/{flag=1; next} /^#+ /{flag=0} flag && NF{print; exit}' "$PROGRESS")
    if [ "${OPEN_TASKS:-0}" -eq 0 ] && [ -z "$HAS_GOAL" ] && [ -z "$HAS_PAUSED" ]; then
      rm -f "$PROGRESS"
      echo "session-progress.md deleted (nothing in flight)"
    else
      echo "session-progress.md kept (open=${OPEN_TASKS:-0}, goal=${HAS_GOAL:+y}, paused=${HAS_PAUSED:+y})"
    fi
    ;;

  report)
    BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "(no-git)")
    HASH=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "")
    printf 'branch=%s hash=%s\n' "$BRANCH" "$HASH"
    ;;

  drift-check)
    # Heuristic, shell-only drift detector. Non-blocking; false positives are
    # expected. Generic heuristics, tunable via config.md keys (all optional):
    #   schema_glob    (default *schema*)      — data-model files
    #   docs_glob      (default docs/)         — where specs/docs live
    #   route_pattern  (ERE, sane default)     — added route declarations
    #   memory_path                            — durable memory dir + MEMORY.md index
    #   known_pitfalls_path (default CLAUDE.md)
    set +eo pipefail

    SCHEMA_GLOB="$(flow_extract schema_glob)"; [ -z "$SCHEMA_GLOB" ] && SCHEMA_GLOB='*schema*'
    DOCS_GLOB="$(flow_extract docs_glob)";     [ -z "$DOCS_GLOB" ]   && DOCS_GLOB='docs/'
    ROUTE_PAT="$(flow_extract route_pattern)"
    [ -z "$ROUTE_PAT" ] && ROUTE_PAT='(\.(get|post|put|delete|patch)\(|@(Get|Post|Put|Delete|Patch|Route)\(|http\.route|httpAction|router\.(get|post|put|delete|patch)|app\.(get|post|put|delete|patch)|@app\.route)'
    PITFALLS_PATH="$(flow_extract known_pitfalls_path)"; [ -z "$PITFALLS_PATH" ] && PITFALLS_PATH='CLAUDE.md'
    MEM_DIR="$(flow_memory_path)"

    if [ -f "$MARKER" ]; then
      LAST_HASH=$(awk '{print $1}' "$MARKER")
      git -C "$REPO_ROOT" cat-file -e "$LAST_HASH" 2>/dev/null || LAST_HASH="HEAD~1"
    else
      LAST_HASH="HEAD~1"
    fi

    CHANGED=$(git -C "$REPO_ROOT" diff --name-only "$LAST_HASH"..HEAD 2>/dev/null; \
              git -C "$REPO_ROOT" diff --name-only HEAD 2>/dev/null; \
              git -C "$REPO_ROOT" ls-files --others --exclude-standard 2>/dev/null)
    CHANGED=$(printf '%s\n' "$CHANGED" | grep -v '^$' | sort -u)

    [ -z "$CHANGED" ] && { echo "no-drift-check (no changes)"; exit 0; }

    WARNINGS=""
    DOCS_CHANGED=$(printf '%s\n' "$CHANGED" | grep -E "$DOCS_GLOB|spec" || true)

    # 1. Data-model/schema changed without a spec/doc update?
    # shellcheck disable=SC2254
    SCHEMA_CHANGED=$(printf '%s\n' "$CHANGED" | grep -iE "$(printf '%s' "$SCHEMA_GLOB" | sed 's/\*/.*/g')" || true)
    if [ -n "$SCHEMA_CHANGED" ] && [ -z "$DOCS_CHANGED" ]; then
      WARNINGS="$WARNINGS\n- Schema/data-model files changed but no docs/spec change. If tables/columns were added or altered, update the data-model docs."
    fi

    # 2. New route/endpoint added without a doc mention?
    NEW_ROUTES=$(git -C "$REPO_ROOT" diff "$LAST_HASH"..HEAD 2>/dev/null | grep -E '^\+' | grep -E "$ROUTE_PAT" | head -5)
    if [ -n "$NEW_ROUTES" ] && [ -z "$DOCS_CHANGED" ]; then
      WARNINGS="$WARNINGS\n- New route(s)/endpoint(s) added but no docs changed. Consider documenting them:\n$(printf '%s\n' "$NEW_ROUTES" | sed 's/^/    /')"
    fi

    # 3. Project memory file (CLAUDE.md / known_pitfalls) changed but no memory entry?
    if [ -n "$MEM_DIR" ] && [ -d "$MEM_DIR" ] && [ -f "$MARKER" ]; then
      PITFALLS_CHANGED=$(printf '%s\n' "$CHANGED" | grep -F "$PITFALLS_PATH" || true)
      MEMORY_CHANGED=$(find "$MEM_DIR" -name '*.md' -newer "$MARKER" 2>/dev/null | head -1)
      if [ -n "$PITFALLS_CHANGED" ] && [ -z "$MEMORY_CHANGED" ]; then
        WARNINGS="$WARNINGS\n- $PITFALLS_PATH changed but no memory entry added/updated. New durable rules usually need both."
      fi
    fi

    # 4. New memory file but MEMORY.md index not updated?
    if [ -n "$MEM_DIR" ] && [ -d "$MEM_DIR" ] && [ -f "$MARKER" ]; then
      NEW_MEM=$(find "$MEM_DIR" -name '*.md' -not -name 'MEMORY.md' -newer "$MARKER" 2>/dev/null)
      MEM_INDEX_CHANGED=$(find "$MEM_DIR" -name 'MEMORY.md' -newer "$MARKER" 2>/dev/null)
      if [ -n "$NEW_MEM" ] && [ -z "$MEM_INDEX_CHANGED" ]; then
        WARNINGS="$WARNINGS\n- New memory file(s) but MEMORY.md index not updated:\n$(printf '%s\n' "$NEW_MEM" | sed 's|.*/|    |')"
      fi
    fi

    if [ -z "$WARNINGS" ]; then
      echo "drift-check: clean"
    else
      echo "drift-check: warnings (non-blocking)"
      printf '%b\n' "$WARNINGS"
    fi
    ;;

  save-memory)
    # save-memory <index-file> <memory-file>...
    # The LLM has already written the memory files and (optionally) updated the
    # index; this subcommand only reports what landed and touches them so the
    # drift-check "newer than marker" probe sees them. No-op if memory unset.
    MEM_DIR="$(flow_memory_path)"
    if [ -z "$MEM_DIR" ]; then echo "memory disabled (no memory_path in config)"; exit 0; fi
    mkdir -p "$MEM_DIR" 2>/dev/null || true
    COUNT=0
    for f in "$@"; do
      [ -f "$f" ] || continue
      touch "$f" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    done
    echo "memory saved: $COUNT file(s) under $MEM_DIR"
    ;;

  finish)
    # <title-file> <body-file> <commit-msg> [--no-push|--land] [--close <token>]
    TITLE_FILE="${1:-}"; BODY_FILE="${2:-}"; COMMIT_MSG="${3:-}"
    shift 3 2>/dev/null || true
    if [ -z "$TITLE_FILE" ] || [ -z "$BODY_FILE" ] || [ -z "$COMMIT_MSG" ]; then
      echo "finish needs <title-file> <body-file> <commit-msg> [--no-push|--land] [--close <token>]" >&2
      exit 1
    fi
    NO_PUSH=0; LAND=0; CLOSE_TOKEN=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --no-push) NO_PUSH=1 ;;
        --land)    LAND=1 ;;
        --close)   shift; CLOSE_TOKEN="${1:-}" ;;
      esac
      shift || true
    done

    # On --land, append the caller-supplied close token (e.g. "Closes #42" or
    # "Closes ENS-7"). The command layer knows pm_backend and constructs it; we
    # stay stack-agnostic and never parse tracker prefixes here.
    if [ "$LAND" -eq 1 ] && [ -n "$CLOSE_TOKEN" ]; then
      COMMIT_MSG="$COMMIT_MSG"$'\n\n'"$CLOSE_TOKEN"
    fi

    "$0" log-block "$TITLE_FILE" "$BODY_FILE" >/dev/null
    TRIM_RESULT=$("$0" trim-or-delete-progress)

    # Stage uncommitted files individually (never `git add -A`), skipping paths
    # the project marks private. Private paths are work-in-progress artifacts
    # that live in the repo but must never reach a remote.
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if flow_path_is_private "$f"; then
        echo "skipped (private): $f" >&2
        continue
      fi
      git -C "$REPO_ROOT" add -- "$f"
    done < <( { git -C "$REPO_ROOT" diff --name-only HEAD; git -C "$REPO_ROOT" ls-files --others --exclude-standard; } 2>/dev/null )

    # Sensitive-file guard.
    if [ -n "$SECRET_RE" ] && git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null | grep -qE "$SECRET_RE"; then
      echo "FINISH ABORTED: staged secrets detected. Run \`git reset\` and check .gitignore." >&2
      exit 2
    fi

    # Private-file guard. Catches anything staged before finish ran — the exact
    # path by which .claude/ and docs/superpowers/ once reached a public remote.
    if [ -n "$PRIVATE_RE" ] && git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null | grep -qE "$PRIVATE_RE"; then
      echo "FINISH ABORTED: private paths are staged. Run \`git reset\` — these must never be pushed." >&2
      git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null | grep -E "$PRIVATE_RE" | sed 's/^/  /' >&2
      exit 2
    fi

    if git -C "$REPO_ROOT" diff --cached --quiet 2>/dev/null; then
      COMMIT_INFO="(no changes to commit)"
    else
      git -C "$REPO_ROOT" commit -m "$COMMIT_MSG" >/dev/null
      COMMIT_HASH=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
      COMMIT_INFO="$COMMIT_HASH $COMMIT_MSG"
    fi

    PUSH_INFO=""
    CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "")
    if [ "$NO_PUSH" -eq 1 ]; then
      PUSH_INFO="skipped (--no-push)"
    elif [ "$COMMIT_INFO" = "(no changes to commit)" ]; then
      PUSH_INFO="skipped (nothing to push)"
    elif [ -z "$CURRENT_BRANCH" ]; then
      PUSH_INFO="PUSH FAILED: no current branch (detached HEAD?)"
    else
      if git -C "$REPO_ROOT" push 2>&1 | tail -1 > /tmp/flow-pause-push.log; then
        PUSH_INFO="pushed: $(cat /tmp/flow-pause-push.log)"
      elif git -C "$REPO_ROOT" push -u origin "$CURRENT_BRANCH" 2>&1 | tail -1 > /tmp/flow-pause-push.log; then
        PUSH_INFO="pushed (new upstream): $(cat /tmp/flow-pause-push.log)"
      else
        PUSH_INFO="PUSH FAILED: $(cat /tmp/flow-pause-push.log)"
      fi
    fi

    # land = rebase onto the default branch, ff-merge, delete branch.
    LAND_INFO="skipped (no --land flag)"
    if [ "$LAND" -eq 1 ]; then
      FEATURE_BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "")
      DEFAULT_BRANCH=$(git -C "$REPO_ROOT" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
      [ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
      if [ -z "$FEATURE_BRANCH" ] || [ "$FEATURE_BRANCH" = "$DEFAULT_BRANCH" ]; then
        LAND_INFO="skipped (not on a feature branch)"
      elif ! git -C "$REPO_ROOT" fetch origin "$DEFAULT_BRANCH" 2>/dev/null; then
        LAND_INFO="LAND FAILED: could not fetch origin/$DEFAULT_BRANCH"
      elif ! git -C "$REPO_ROOT" rebase "origin/$DEFAULT_BRANCH" 2>&1 | tail -3 > /tmp/flow-pause-land.log; then
        git -C "$REPO_ROOT" rebase --abort 2>/dev/null
        LAND_INFO="LAND FAILED (rebase conflict): $(cat /tmp/flow-pause-land.log)"
      else
        git -C "$REPO_ROOT" push --force-with-lease 2>/dev/null || true
        git -C "$REPO_ROOT" checkout "$DEFAULT_BRANCH" 2>/dev/null
        if git -C "$REPO_ROOT" merge --ff-only "$FEATURE_BRANCH" 2>&1 | tail -1 > /tmp/flow-pause-land.log; then
          git -C "$REPO_ROOT" push 2>/dev/null
          git -C "$REPO_ROOT" branch -d "$FEATURE_BRANCH" 2>/dev/null
          git -C "$REPO_ROOT" push origin --delete "$FEATURE_BRANCH" 2>/dev/null || true
          LAND_INFO="landed: $FEATURE_BRANCH -> $DEFAULT_BRANCH, branch deleted"
        else
          LAND_INFO="LAND FAILED (ff-merge): $(cat /tmp/flow-pause-land.log)"
        fi
      fi
    fi

    "$0" write-marker >/dev/null

    cat <<REPORT
finish-ok
commit:$COMMIT_INFO
push:$PUSH_INFO
land:$LAND_INFO
trim:$TRIM_RESULT
REPORT
    ;;

  *)
    echo "unknown subcommand: $cmd" >&2
    echo "see header of $0 for usage" >&2
    exit 1
    ;;
esac
