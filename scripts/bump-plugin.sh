#!/usr/bin/env bash
# bump-plugin.sh — bump a plugin's version across the three files that must agree.
#
# This is a flykit-repo tool, deliberately NOT part of the flow plugin: most
# projects have no plugin versions to bump, so shipping this behaviour inside
# flow would impose a marketplace concern on every repo that installs it.
#
# Usage:
#   bump-plugin.sh <plugin> patch|minor|major   # explicit level
#   bump-plugin.sh <plugin> --from-commit <msg> # infer from a conventional commit
#   bump-plugin.sh <plugin> --from-staged       # infer from staged commits vs origin/main
#   ... add --dry-run to print the new version without writing
#
# Conventional-commit mapping (matches CONTRIBUTING.md):
#   BREAKING CHANGE / type!  -> major
#   feat                     -> minor
#   anything else            -> patch
#
# Writes:
#   plugins/<plugin>/.claude-plugin/plugin.json
#   plugins/<plugin>/package.json          (only when it exists)
#   .claude-plugin/marketplace.json        (that plugin's entry)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MARKETPLACE=".claude-plugin/marketplace.json"
PLUGIN=""
LEVEL=""
MESSAGE=""
DRY_RUN=0

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

[ $# -ge 1 ] || usage 2
PLUGIN="$1"; shift
case "$PLUGIN" in -h|--help) usage 0 ;; esac

while [ $# -gt 0 ]; do
    case "$1" in
        patch|minor|major) LEVEL="$1"; shift ;;
        --from-commit)     MESSAGE="${2:-}"; shift 2 ;;
        --from-staged)
            # Commits on HEAD that origin/main doesn't have yet.
            MESSAGE="$(git log --format='%B' origin/main..HEAD 2>/dev/null || true)"
            shift ;;
        --dry-run)         DRY_RUN=1; shift ;;
        -h|--help)         usage 0 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }

MANIFEST="plugins/$PLUGIN/.claude-plugin/plugin.json"
PKG="plugins/$PLUGIN/package.json"
[ -f "$MANIFEST" ] || { echo "no such plugin: $PLUGIN ($MANIFEST not found)" >&2; exit 2; }

# Infer the level from a conventional-commit message when not given explicitly.
if [ -z "$LEVEL" ]; then
    if [ -z "$MESSAGE" ]; then
        echo "give a level (patch|minor|major) or --from-commit/--from-staged" >&2
        exit 2
    fi
    # `!` before the colon, or a BREAKING CHANGE footer, means major.
    if printf '%s' "$MESSAGE" | grep -qE '^[a-z]+(\([^)]*\))?!:' \
       || printf '%s' "$MESSAGE" | grep -q 'BREAKING CHANGE'; then
        LEVEL=major
    elif printf '%s' "$MESSAGE" | grep -qE '^feat(\([^)]*\))?:'; then
        LEVEL=minor
    else
        LEVEL=patch
    fi
    echo "inferred level: $LEVEL"
fi

CURRENT="$(jq -r '.version' "$MANIFEST")"
case "$CURRENT" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) echo "current version is not semver: $CURRENT" >&2; exit 2 ;;
esac

MAJOR="${CURRENT%%.*}"
REST="${CURRENT#*.}"
MINOR="${REST%%.*}"
PATCH="${REST#*.}"

case "$LEVEL" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
esac
NEXT="$MAJOR.$MINOR.$PATCH"

echo "$PLUGIN: $CURRENT -> $NEXT ($LEVEL)"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "(dry run — nothing written)"
    exit 0
fi

# write_json <file> <jq-args...> — the trailing args are the filter and any
# --arg bindings, forwarded to jq verbatim. Writes via a temp file so a jq
# failure can never leave a truncated manifest behind.
write_json() {
    local file="$1"; shift
    local tmp="${file}.tmp.$$"
    if jq --indent 2 "$@" "$file" > "$tmp"; then
        mv "$tmp" "$file"
    else
        rm -f "$tmp"
        echo "failed to update $file" >&2
        exit 1
    fi
}

write_json "$MANIFEST" --arg v "$NEXT" '.version = $v'
echo "  updated $MANIFEST"

if [ -f "$PKG" ]; then
    write_json "$PKG" --arg v "$NEXT" '.version = $v'
    echo "  updated $PKG"
fi

write_json "$MARKETPLACE" --arg n "$PLUGIN" --arg v "$NEXT" \
    '.plugins = (.plugins | map(if .name == $n then .version = $v else . end))'
echo "  updated $MARKETPLACE"

# The guard is the source of truth on whether the three files now agree.
"$REPO_ROOT/scripts/check-plugin-versions.sh"
