#!/usr/bin/env bash
# issue-helpers.sh — deterministic shell work for /flow:issue.
#
# Deliberately depends on nothing inside .flow/: this command has to work when
# flow itself is misbehaving, which is exactly when someone wants to report a bug.
#
# Usage:
#   issue-helpers.sh version-check          # installed=<v> latest=<v|unknown> status=<...>
#   issue-helpers.sh dupe-search <query>    # "#<n> <title>" lines, or "no-gh"

set -uo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SOURCE_DIR/../.claude-plugin/plugin.json"
REPO="flykit-cc/flykit"
MARKETPLACE_URL="${FLOW_MARKETPLACE_URL:-https://raw.githubusercontent.com/flykit-cc/flykit/main/.claude-plugin/marketplace.json}"

cmd="${1:-}"

case "$cmd" in
  version-check)
    # Read the manifest next to this script rather than parsing the plugin path:
    # a local/dev install is not under cache/flykit/flow/<version>/.
    INSTALLED=$(node -p "require('$MANIFEST').version" 2>/dev/null || echo "unknown")
    [ -n "$INSTALLED" ] || INSTALLED="unknown"

    LATEST=$(curl -fsSL --max-time 5 "$MARKETPLACE_URL" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).plugins.find(p=>p.name==="flow");process.stdout.write(p&&p.version?p.version:"unknown")}catch(e){process.stdout.write("unknown")}})' 2>/dev/null)
    [ -n "$LATEST" ] || LATEST="unknown"

    if [ "$INSTALLED" = "unknown" ] || [ "$LATEST" = "unknown" ]; then
      STATUS="unknown"
    elif [ "$INSTALLED" = "$LATEST" ]; then
      STATUS="current"
    else
      # sort -V orders semver correctly (0.5.9 before 0.5.10); if the installed
      # version sorts first it is the older one.
      OLDEST=$(printf '%s\n%s\n' "$INSTALLED" "$LATEST" | sort -V | head -1)
      if [ "$OLDEST" = "$INSTALLED" ]; then STATUS="behind"; else STATUS="ahead"; fi
    fi

    echo "installed=$INSTALLED latest=$LATEST status=$STATUS"
    ;;

  dupe-search)
    QUERY="${2:-}"
    command -v gh >/dev/null 2>&1 || { echo "no-gh"; exit 0; }
    gh auth status >/dev/null 2>&1 || { echo "no-gh"; exit 0; }
    gh issue list --repo "$REPO" --state open --search "$QUERY" \
      --json number,title --limit 5 \
      --template '{{range .}}#{{.number}} {{.title}}{{"\n"}}{{end}}' 2>/dev/null || true
    ;;

  *)
    echo "unknown subcommand: $cmd" >&2
    exit 1
    ;;
esac
