#!/usr/bin/env bash
# post-bash-reap.sh — PostToolUse hook for Bash.
# Reaps orphan subprocesses left behind by a Bash tool call (dev servers,
# scanners, docker exec, etc.). Opt-in: only acts when the project sets
#   reap_orphans: true
# in .claude/config.md. OFF by default so a deliberately backgrounded dev
# server started inside a tool call is not killed unexpectedly.
#
# Claude Code sets CLAUDE_HOOK_TARGET_PID to the PID that ran the tool; we
# terminate that process's direct descendants only.
set -u

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/lib.sh
. "$SOURCE_DIR/../scripts/lib.sh"

[ "$(flow_extract reap_orphans)" = "true" ] || exit 0
[ -n "${CLAUDE_HOOK_TARGET_PID:-}" ] || exit 0

descendants=$(pgrep -P "$CLAUDE_HOOK_TARGET_PID" 2>/dev/null || true)
if [ -n "$descendants" ]; then
    echo "$descendants" | xargs kill -TERM 2>/dev/null || true
    sleep 1
    echo "$descendants" | xargs kill -KILL 2>/dev/null || true
fi
exit 0
