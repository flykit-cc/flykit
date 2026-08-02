#!/usr/bin/env bash
# questions-helpers.sh — parse/count .flow/questions.md (spec: flow question queue).
# Deliberately dumb: rigid format, awk line-scan, loud on anything unexpected.
#
# Usage:
#   questions-helpers.sh validate <file>              # ok | absent | UNPARSEABLE: line N: reason
#   questions-helpers.sh counts <file>                 # open=N backlog=N answered=N assumed=N retired=N pending_apply=N
#   questions-helpers.sh state-line <file>              # one-line summary for prompts/hooks (never blocks: exit 0)
#   questions-helpers.sh top-open <file>                # first ## Q block with status: open
#   questions-helpers.sh wip-limit <config.md>          # question_wip value, default 3

set -u

SUB="${1:-}"; FILE="${2:-}"

KEYS='status|issue|asks|context|options|recommendation|answer|applied|retired-because'
UNPARSEABLE_MSG='questions.md UNPARSEABLE — queue unreliable, fix .flow/questions.md'

validate() {
    [ -f "$1" ] || { echo "absent"; return 0; }
    awk -v keys="^(${KEYS}): ?" '
        /^$/ { next }
        /^## Q[0-9]+[[:space:]]*$/ { next }
        /^  / { next }
        $0 ~ keys {
            if ($0 ~ /^status: /) {
                v = substr($0, 9)
                if (v !~ /^(open|backlog|answered|assumed|retired)[[:space:]]*$/) {
                    printf "UNPARSEABLE: line %d: bad status \"%s\"\n", NR, v
                    bad = 1; exit 1
                }
            }
            next
        }
        { printf "UNPARSEABLE: line %d: unexpected unindented line\n", NR; bad = 1; exit 1 }
        END { if (!bad) print "ok" }
    ' "$1"
}

counts() {
    awk '
        function flush() {
            if (st != "") n[st]++
            # pending = answered with NO applied line ("unset") OR an empty
            # one; "applied: -" is a valid terminal state, never pending.
            if (st == "answered" && (ap == "unset" || ap == "")) pa++
            st = ""; ap = "unset"
        }
        BEGIN { ap = "unset" }
        /^## Q[0-9]+/ { flush(); next }
        /^status: /  { st = substr($0, 9); sub(/[[:space:]]+$/, "", st) }
        /^applied: ?/ { ap = substr($0, 10); gsub(/^[[:space:]]+|[[:space:]]+$/, "", ap) }
        END {
            flush()
            printf "open=%d backlog=%d answered=%d assumed=%d retired=%d pending_apply=%d\n", \
                n["open"], n["backlog"], n["answered"], n["assumed"], n["retired"], pa
        }
    ' "$1"
}

state_line() {
    if [ ! -f "$1" ]; then return 0; fi
    if ! validate "$1" >/dev/null 2>&1; then echo "$UNPARSEABLE_MSG"; return 0; fi
    local c; c=$(counts "$1")
    local open backlog pending
    open=$(sed -E 's/.*open=([0-9]+).*/\1/' <<<"$c")
    backlog=$(sed -E 's/.*backlog=([0-9]+).*/\1/' <<<"$c")
    pending=$(sed -E 's/.*pending_apply=([0-9]+).*/\1/' <<<"$c")
    local line="questions: ${open} open · ${backlog} backlog"
    [ "$pending" -gt 0 ] && line="${line} · ${pending} answered-not-applied"
    echo "$line"
}

top_open() {
    if [ ! -f "$1" ]; then return 0; fi
    if ! validate "$1" >/dev/null 2>&1; then echo "$UNPARSEABLE_MSG"; return 0; fi
    # Line-scan capture: buffer each Q-block, print the first whose status is
    # open, stop as soon as it's found. Blank lines inside/between blocks are
    # allowed (not paragraph-mode), so this scans line by line instead.
    awk '
        function emit() { if (open) { printf "%s", blk; found = 1 } blk = ""; open = 0 }
        /^## Q[0-9]+/ {
            emit()
            if (found) exit
            blk = $0 "\n"
            next
        }
        blk != "" {
            blk = blk $0 "\n"
            if ($0 ~ /^status: open[[:space:]]*$/) open = 1
        }
        END { if (!found) emit() }
    ' "$1"
}

wip_limit() {
    local v=""
    [ -f "${1:-}" ] && v=$(grep -m1 -E '^[[:space:]]*-?[[:space:]]*question_wip:' "$1" | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '[:space:]')
    case "$v" in (''|*[!0-9]*) echo 3 ;; (*) echo "$v" ;; esac
}

case "$SUB" in
    validate)   validate "$FILE"; exit $? ;;
    counts)     if [ -f "$FILE" ]; then
                    out=$(validate "$FILE")
                    if [ "$out" != "ok" ] && [ "$out" != "absent" ]; then echo "$out"; exit 1; fi
                    counts "$FILE"
                else
                    echo "open=0 backlog=0 answered=0 assumed=0 retired=0 pending_apply=0"
                fi ;;
    state-line) state_line "$FILE" ;;
    top-open)   top_open "$FILE" ;;
    wip-limit)  wip_limit "$FILE" ;;
    *) echo "usage: questions-helpers.sh {validate|counts|state-line|top-open|wip-limit} <file>" >&2; exit 2 ;;
esac
