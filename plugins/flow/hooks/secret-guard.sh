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
        # Only trip when a *reader* command is given an argument that looks
        # like a path to a secret file. We used to grep the whole command
        # string against an unanchored secret regex, which blocked anything
        # merely *mentioning* a secret glob as a substring — `jq .key` or
        # `grep -rn secret src/` have nothing to do with reading .env/.key
        # files but got caught anyway. Instead: split the pipeline into
        # segments, and for each segment whose leading command is a known
        # reader, test its non-flag, path-shaped arguments with the same
        # anchored `flow_path_is_secret` the Read branch above already uses.
        READER_RE='^(cat|head|tail|less|more|grep|egrep|rg|od|xxd|strings|nl|awk|sed|dotenv|base64)$'
        BLOCKED=""
        # Best-effort, defense-in-depth only: split on shell list/pipe
        # separators. This is lexical, not a real shell parser — it never
        # evals the command, so command substitutions in it are never
        # executed by this check.
        while IFS= read -r SEGMENT; do
            [ -n "$SEGMENT" ] || continue
            # `read -ra` performs plain IFS word-splitting — no execution.
            read -ra WORDS <<< "$SEGMENT" || continue
            [ "${#WORDS[@]}" -gt 0 ] || continue
            CMDNAME="${WORDS[0]##*/}"
            printf '%s' "$CMDNAME" | grep -Eq "$READER_RE" || continue
            for ((i = 1; i < ${#WORDS[@]}; i++)); do
                TOK="${WORDS[$i]}"
                case "$TOK" in
                    -*) continue ;;  # option flag, not a path argument
                esac
                # Strip one layer of matching surrounding quotes left over
                # from the naive word-split.
                TOK="${TOK%\"}"; TOK="${TOK#\"}"
                TOK="${TOK%\'}"; TOK="${TOK#\'}"
                # Only test tokens that look path-shaped (has a path
                # separator or a file extension). A bare word like `secret`
                # or `api_key` is a grep pattern, not a path, and must not
                # trip the *secret* glob.
                case "$TOK" in
                    */*|*.*)
                        if flow_path_is_secret "$TOK"; then
                            BLOCKED="$TOK"
                        fi
                        ;;
                esac
            done
        done < <(printf '%s\n' "$CMD" | tr '|&;' '\n')
        if [ -n "$BLOCKED" ]; then
            printf '[flow secret-guard] Blocked: "%s" looks like a secret file (defense-in-depth).\n' "$BLOCKED" >&2
            exit 2
        fi
        ;;
esac

exit 0
