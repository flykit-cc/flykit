#!/usr/bin/env bash
# session-context.sh
# UserPromptSubmit hook: surface a one-line status of the current project.
# Outputs JSON {"systemMessage": "..."} only when state has changed since last run.
# Always exits 0 so the prompt is never blocked.

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# Bail quietly if not a git repo.
if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Cache key per project dir.
if command -v md5 >/dev/null 2>&1; then
    KEY=$(printf '%s' "$PROJECT_DIR" | md5)
elif command -v md5sum >/dev/null 2>&1; then
    KEY=$(printf '%s' "$PROJECT_DIR" | md5sum | awk '{print $1}')
else
    KEY=$(printf '%s' "$PROJECT_DIR" | tr -c 'a-zA-Z0-9' '_')
fi
CACHE_FILE="/tmp/flow-hook-cache-${KEY}"

# In a repo with no commits, `rev-parse --abbrev-ref HEAD` prints "HEAD" *and*
# exits non-zero, so a naive `|| echo "?"` appends a second line and the emitted
# systemMessage becomes invalid JSON. Take the first line only.
BRANCH=$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null | head -n1)
[ -n "$BRANCH" ] && [ "$BRANCH" != "HEAD" ] || BRANCH="(no commits)"
CHANGED=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')

GOAL=""
PROGRESS_FILE="$PROJECT_DIR/session-progress.md"
if [ -f "$PROGRESS_FILE" ]; then
    # /flow:continue writes the goal under a `## Goal` markdown heading (see
    # pause-helpers.sh's trim-or-delete-progress, which parses the same
    # shape), not a `Goal:` line — so look for the first non-empty line
    # under that heading first. Keep the old colon-form grep as a fallback
    # so session-progress.md files written before this heading format still
    # surface a goal.
    GOAL=$(awk '/^#+ *Goal/{flag=1; next} /^#+ /{flag=0} flag && NF{print; exit}' "$PROGRESS_FILE" 2>/dev/null \
        | head -c 200)
    if [ -z "$GOAL" ]; then
        # First line matching `Goal:` (case-insensitive), trimmed.
        GOAL=$(grep -i -m1 '^[[:space:]]*-\?[[:space:]]*Goal:' "$PROGRESS_FILE" 2>/dev/null \
            | sed -E 's/^[^:]*:[[:space:]]*//' | head -c 200)
    fi
fi

if [ -n "$GOAL" ]; then
    STATE="[Branch: ${BRANCH} | Changed: ${CHANGED} files | Goal: ${GOAL}]"
else
    STATE="[Branch: ${BRANCH} | Changed: ${CHANGED} files]"
fi

# Emit only on change.
LAST=""
if [ -f "$CACHE_FILE" ]; then
    LAST=$(cat "$CACHE_FILE" 2>/dev/null || true)
fi

if [ "$STATE" = "$LAST" ]; then
    exit 0
fi

printf '%s' "$STATE" > "$CACHE_FILE" 2>/dev/null || true

# Escape for JSON (quotes and backslashes).
ESCAPED=$(printf '%s' "$STATE" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"systemMessage":"%s"}\n' "$ESCAPED"
exit 0
