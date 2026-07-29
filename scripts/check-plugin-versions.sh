#!/usr/bin/env bash
# check-plugin-versions.sh — guard the plugin version fields.
#
# Why this exists: a plugin install is keyed by *version*, not by commit sha.
# `/plugin update` compares the marketplace version against the installed one,
# so shipping a change without bumping the version makes the update a silent
# no-op — users keep running the old code and nothing reports an error. That
# happened once already (flow 0.2.0, 2026-07-28) and cost a session to diagnose.
#
# Two checks:
#   1. consistency — marketplace.json, plugin.json, and package.json (when
#      present) must all declare the same version for a given plugin.
#   2. bump — if any file under plugins/<name>/ changed since <ref>, then
#      plugins/<name>/.claude-plugin/plugin.json must declare a new version.
#
# Usage:
#   check-plugin-versions.sh                # consistency only
#   check-plugin-versions.sh --since <ref>  # consistency + bump-required
#
# Exits non-zero on any failure. Prints GitHub Actions ::error annotations when
# running under Actions, plain text otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MARKETPLACE=".claude-plugin/marketplace.json"
SINCE=""
FAILURES=0

while [ $# -gt 0 ]; do
    case "$1" in
        --since) SINCE="${2:-}"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }
[ -f "$MARKETPLACE" ] || { echo "$MARKETPLACE not found" >&2; exit 2; }

# Emit an error that GitHub Actions renders inline on the offending file.
fail() {
    local file="$1" msg="$2"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        echo "::error file=${file}::${msg}"
    else
        echo "FAIL  ${file}: ${msg}"
    fi
    FAILURES=$((FAILURES + 1))
}

json_version() {
    # Print the .version of a json file, or empty if the file or key is absent.
    [ -f "$1" ] || { printf ''; return 0; }
    jq -r '.version // empty' "$1" 2>/dev/null || printf ''
}

# ---------------------------------------------------------------- consistency

while IFS= read -r name; do
    market_v="$(jq -r --arg n "$name" '.plugins[] | select(.name == $n) | .version // empty' "$MARKETPLACE")"
    manifest="plugins/$name/.claude-plugin/plugin.json"
    pkg="plugins/$name/package.json"

    if [ ! -f "$manifest" ]; then
        fail "$MARKETPLACE" "plugin '$name' is listed but $manifest is missing"
        continue
    fi

    manifest_v="$(json_version "$manifest")"

    if [ -z "$market_v" ]; then
        fail "$MARKETPLACE" "plugin '$name' has no version field"
    elif [ -z "$manifest_v" ]; then
        fail "$manifest" "no version field"
    elif [ "$market_v" != "$manifest_v" ]; then
        fail "$manifest" "version '$manifest_v' does not match marketplace.json's '$market_v' for plugin '$name'. Both must match or /plugin update installs the wrong thing."
    else
        echo "ok    $name: $manifest_v"
    fi

    # package.json is optional (it exists for plugins that have tests), but when
    # it is there it must not drift from the manifest.
    if [ -f "$pkg" ]; then
        pkg_v="$(json_version "$pkg")"
        if [ -n "$pkg_v" ] && [ -n "$manifest_v" ] && [ "$pkg_v" != "$manifest_v" ]; then
            fail "$pkg" "version '$pkg_v' does not match $manifest's '$manifest_v'"
        fi
    fi
done < <(jq -r '.plugins[].name' "$MARKETPLACE")

# ------------------------------------------------------------- bump required

if [ -n "$SINCE" ]; then
    if ! git rev-parse --verify "$SINCE" >/dev/null 2>&1; then
        echo "warn  base ref '$SINCE' not found — skipping the bump check" >&2
    else
        while IFS= read -r name; do
            manifest="plugins/$name/.claude-plugin/plugin.json"
            [ -f "$manifest" ] || continue

            # Did anything in this plugin change? Exclude nothing: a docs-only
            # change still ships to users through the plugin cache.
            changed="$(git diff --name-only "$SINCE"...HEAD -- "plugins/$name/" || true)"
            [ -z "$changed" ] && continue

            old_v="$(git show "$SINCE:$manifest" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)"
            new_v="$(json_version "$manifest")"

            # A brand-new plugin has no previous version to compare against.
            if [ -z "$old_v" ]; then
                echo "ok    $name: new plugin at $new_v"
                continue
            fi

            if [ "$old_v" = "$new_v" ]; then
                count="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
                fail "$manifest" "plugin '$name' has $count changed file(s) since $SINCE but the version is still '$old_v'. Bump it — /plugin update compares versions, not commits, so users will silently keep the old build."
            else
                echo "ok    $name: bumped $old_v -> $new_v"
            fi
        done < <(jq -r '.plugins[].name' "$MARKETPLACE")
    fi
fi

# ------------------------------------------------------------------- summary

if [ "$FAILURES" -gt 0 ]; then
    echo
    echo "$FAILURES version problem(s) found."
    exit 1
fi

echo
echo "Plugin versions are consistent."
