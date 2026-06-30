#!/usr/bin/env bash
# secret-guard.sh — PreToolUse hook for Read|Bash.
# Defense-in-depth READ protection for secret files (file-protection.sh covers
# writes). Blocks:
#   * the Read tool opening a secret/.env/key file
#   * a Bash command that pipes a secret file through cat/grep/etc.
# Secret patterns come from config.md (secret_globs) with a sane default.
# Exit 2 = block; exit 0 = allow. Fails open when jq is missing.

set -u

command -v jq >/dev/null 2>&1 || exit 0

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/lib.sh
. "$SOURCE_DIR/../scripts/lib.sh"

INPUT=$(cat 2>/dev/null || true)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL" in
    Read)
        FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
        [ -n "$FILE_PATH" ] || exit 0
        if flow_path_is_secret "$FILE_PATH"; then
            printf '[flow secret-guard] Read blocked: "%s" looks like a secret file.\n' "$FILE_PATH" >&2
            exit 2
        fi
        ;;
    Bash)
        CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
        [ -n "$CMD" ] || exit 0
        SECRET_RE="$(flow_secret_regex)"
        [ -n "$SECRET_RE" ] || exit 0
        # Only trip when a *reader* command targets a secret-looking path.
        READER_RE='(^|[^[:alnum:]])(cat|head|tail|less|more|grep|egrep|rg|od|xxd|strings|nl|awk|sed|dotenv|base64)([^[:alnum:]]|$)'
        if printf '%s' "$CMD" | grep -Eq "$READER_RE" && printf '%s' "$CMD" | grep -Eq "$SECRET_RE"; then
            echo '[flow secret-guard] Blocked: reading secret/.env files via shell is disabled (defense-in-depth).' >&2
            exit 2
        fi
        ;;
esac

exit 0
