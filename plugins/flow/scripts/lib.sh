#!/usr/bin/env bash
# lib.sh — shared, sourced helpers for the flow plugin's scripts and hooks.
#
# Everything here is config-driven: values come from the *project's*
# .claude/config.md, never hardcoded to a stack. Source this from a script:
#
#   SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   . "$SOURCE_DIR/lib.sh"          # from scripts/
#   . "$SOURCE_DIR/../scripts/lib.sh"  # from hooks/
#
# All functions degrade gracefully: missing config, missing git, missing jq.

# Resolve the project root. Prefer the Claude-provided project dir, then the
# git toplevel, then the current directory. Never fails.
flow_project_root() {
    if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
        printf '%s' "$CLAUDE_PROJECT_DIR"
        return 0
    fi
    local root
    root="$(git rev-parse --show-toplevel 2>/dev/null)"
    if [ -n "$root" ]; then printf '%s' "$root"; return 0; fi
    printf '%s' "$PWD"
}

# Absolute path to the project's config.md (may not exist).
flow_config_path() {
    printf '%s/.claude/config.md' "$(flow_project_root)"
}

# Extract a `key: value` (or `- key: value`) from config.md. Strips surrounding
# quotes and backticks. Prints empty string when the key or the file is absent.
# Takes the LAST matching line so a later override wins.
flow_extract() {
    local key="$1"
    local config
    config="$(flow_config_path)"
    [ -f "$config" ] || { printf ''; return 0; }
    # The pipeline starts with `grep`, which exits 1 on no match. Under a
    # caller's `set -o pipefail` (e.g. continue-helpers.sh's
    # `PORT="$(flow_dev_port)"`) that would make a merely-unset key abort the
    # whole script. `grep` finding nothing is not an error here — it's the
    # normal "key absent" case, which callers handle by checking for an empty
    # string — so this function always returns 0 itself.
    grep -E "^[[:space:]]*(-[[:space:]]+)?${key}[[:space:]]*:" "$config" 2>/dev/null \
        | tail -n1 \
        | sed -E "s/^[[:space:]]*(-[[:space:]]+)?${key}[[:space:]]*:[[:space:]]*//" \
        | sed -E 's/[[:space:]]*$//' \
        | sed -E 's/^["'\''`]//; s/["'\''`]$//'
    return 0
}

# Space/newline-separated list of glob patterns that name secret files.
# Config key: secret_globs (space-separated). Falls back to a conservative
# default that catches env files, private keys, and common credential blobs.
flow_secret_globs() {
    local v
    v="$(flow_extract secret_globs)"
    if [ -n "$v" ]; then
        printf '%s' "$v"
    else
        printf '%s' '.env .env.* *.env *.env.* *.pem *.key id_rsa *_rsa *.p12 *.pfx *.keystore credentials.json token.json *secret* *.gpg'
    fi
}

# Build an ERE that matches any secret glob, for grepping a shell command line.
# Converts a few glob metachars to regex. Best-effort; defense-in-depth only.
flow_secret_regex() {
    local glob out=""
    for glob in $(flow_secret_globs); do
        # Escape regex specials, then translate glob * and . back.
        local re
        re="$(printf '%s' "$glob" | sed -E 's/[].[^$()+{}|\\]/\\&/g; s/\*/[^[:space:]]*/g')"
        if [ -z "$out" ]; then out="$re"; else out="$out|$re"; fi
    done
    printf '%s' "$out"
}

# Does a path match any secret glob? Returns 0 (match) / 1 (no match).
flow_path_is_secret() {
    local path="$1" glob base
    base="$(basename "$path")"
    for glob in $(flow_secret_globs); do
        # shellcheck disable=SC2254
        case "$path" in $glob|*/$glob) return 0;; esac
        # shellcheck disable=SC2254
        case "$base" in $glob) return 0;; esac
    done
    return 1
}

# The dev server's port, if the project pins one (config key: dev_port).
# Empty when unset — callers should skip port checks rather than guess.
flow_dev_port() {
    flow_extract dev_port
}

# Durable cross-session memory directory (config key: memory_path). Expands a
# leading ~ . Empty when unset, in which case memory features are skipped.
flow_memory_path() {
    local v
    v="$(flow_extract memory_path)"
    [ -z "$v" ] && { printf ''; return 0; }
    case "$v" in
        "~"|"~/"*) v="$HOME/${v#"~"/}";;
    esac
    printf '%s' "$v"
}

# Space-separated glob patterns naming paths that are private to this machine:
# work-in-progress artifacts that must never be staged or pushed. Distinct from
# secret_globs, which is about credentials. Config key: private_globs.
flow_private_globs() {
    local v
    v="$(flow_extract private_globs)"
    if [ -n "$v" ]; then
        printf '%s' "$v"
    else
        # The whole .flow directory, not just .flow/local.md — it also holds
        # the one-shot arming markers (.allow-destructive, .allow-expensive).
        # If only local.md were private, `finish`'s blanket-staging-free path
        # would still stage a marker file, handing every clone/CI run of the
        # project a standing bypass the moment it's committed once.
        printf '%s' '.claude docs/superpowers .flow'
    fi
}

# Does a path fall inside a private glob? Accepts absolute or repo-relative
# paths. Returns 0 (private) / 1 (not).
flow_path_is_private() {
    local path="$1" glob rel root
    root="$(flow_project_root)"
    rel="${path#"$root"/}"
    for glob in $(flow_private_globs); do
        # shellcheck disable=SC2254
        case "$rel" in $glob|$glob/*) return 0;; esac
    done
    return 1
}

# ERE alternation matching any private glob, for grepping a list of paths.
flow_private_regex() {
    local glob out="" re
    for glob in $(flow_private_globs); do
        re="$(printf '%s' "$glob" | sed -E 's/[].[^$()+{}|\\]/\\&/g; s/\*/[^[:space:]]*/g')"
        re="(^|/)${re}(/|$)"
        if [ -z "$out" ]; then out="$re"; else out="$out|$re"; fi
    done
    printf '%s' "$out"
}

# Comma-separated substrings naming commands that cost real money OUTSIDE the
# Claude subscription: CI minutes, cloud builds, deploys, metered backends,
# compute. Token spend is deliberately not covered — it is self-limiting.
# Config key: expensive_cmds.
flow_expensive_cmds() {
    local v
    v="$(flow_extract expensive_cmds)"
    if [ -n "$v" ]; then
        printf '%s' "$v"
    else
        printf '%s' 'terraform apply,fly deploy,flyctl deploy,vercel deploy,gh workflow run,aws ec2 run-instances,electron-builder,docker push'
    fi
}

# How much the Stop hook verifies. Config key: stop_check.
# off        — never run anything on stop
# lint       — background lint/format only (default)
# lint+build — also honour the one-shot .build-check build/test gate
flow_stop_check_mode() {
    local v
    v="$(flow_extract stop_check)"
    case "$v" in
        off|lint|lint+build) printf '%s' "$v" ;;
        *)                   printf 'lint' ;;
    esac
}

# Model name for a tier: default | critical | cheap.
# Never hardcode a model in an agent file — read the tier here instead.
flow_model_tier() {
    local tier="${1:-default}" v
    case "$tier" in
        critical) v="$(flow_extract model_critical)"; [ -z "$v" ] && v='opus' ;;
        cheap)    v="$(flow_extract model_cheap)";    [ -z "$v" ] && v='haiku' ;;
        *)        v="$(flow_extract model_default)";  [ -z "$v" ] && v='sonnet' ;;
    esac
    printf '%s' "$v"
}
