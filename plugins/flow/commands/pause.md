---
description: Pause cleanly — shut down agents, save state + memory, run drift-check, commit and (by default) push. "local" skips push; "land" ff-merges a feature branch.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, SendMessage
---
# /flow:pause

Stop work cleanly so it can be resumed with `/flow:continue`. The mechanics live in `${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh`; this command only narrates and decides.

| Invocation | What happens |
|---|---|
| `/flow:pause` | save state + commit + push current branch |
| `/flow:pause local` | save state + commit, **no push** |
| `/flow:pause land` | save state + commit + push + rebase onto the default branch + ff-merge + delete branch |

Flags are space-separated args. `local` and `land` are mutually exclusive (land implies push).

## Step 1: Load config

Read `$CLAUDE_PROJECT_DIR/.claude/config.md`. Capture `workflow_mode`, `pm_backend` (+ `pm_*`), `memory_path`, `known_pitfalls_path`.

## Step 2: Shut down running agents

If background agents are running, send `shutdown_request` (via `SendMessage` and by writing `/tmp/flow-session/shutdown_request`). Wait up to 30s for them to flush their handoff files. See `${CLAUDE_PLUGIN_ROOT}/references/agent-workflow.md`.

## Step 3: Mechanical prep (shell, no LLM)

```bash
HELPERS="${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh"
"$HELPERS" changed-files       # uncommitted paths
"$HELPERS" diff-since-pause    # commits since the last pause marker
"$HELPERS" read-marker         # for the report
"$HELPERS" drift-check         # heuristic doc-drift warnings (non-blocking)
```

**No-op fast-exit:** if `changed-files` is empty, `session-progress.md` has no open tasks, and nothing meaningful happened this session, print `Nothing to pause — working tree clean, no session state to save.` and stop.

## Step 4: Narrate + memory candidates (main agent, silent)

The main agent holds the conversation; subagents don't — so do this directly, and do NOT print the narration in chat:

- **Body:** concrete bullets of what was done this session, cross-checked against `diff-since-pause`. Write to `/tmp/flow-pause-body` via the Write tool.
- **Title:** a one-line session title (no em-dashes). Write to `/tmp/flow-pause-title`.
- **Memory candidates** (only if `memory_path` is set): durable cross-session rules — architecture decisions, external-API gotchas, surprising findings. **Cap at 4.** Skip ephemeral single-file edits and anything already in memory.

## Step 5: Auto-save memory — do NOT ask

If `memory_path` is set and there are candidates: read its `MEMORY.md` index (small, one Read), dedup each candidate (`new` / `duplicate` / `extends`), then **write the memory files and update `MEMORY.md` directly**. Never gate this behind an approval question — work that was actually done is worth remembering; asking is pure friction. The only filter is relevance. Then:

```bash
"$HELPERS" save-memory "<memory_path>/MEMORY.md" <written-file>...
```

If `memory_path` is unset, skip memory entirely.

## Step 6: Trim session-progress.md

Edit `session-progress.md` to check off done tasks, refresh `Paused at` and `Next steps`. Preserve Goal and open tasks. Don't rewrite from scratch.

## Step 7: One-shot finish (shell)

Before running `finish`, arm the destructive-action marker. `finish` itself stages files one at a time and commits without `-a`, so it doesn't trip `bash-guard.sh` today — but `land` rebases and force-pushes, and this keeps the pause path future-proof against that gate without needing a per-command carve-out:

```bash
mkdir -p "$CLAUDE_PROJECT_DIR/.flow" && touch "$CLAUDE_PROJECT_DIR/.flow/.allow-destructive"
"$HELPERS" finish /tmp/flow-pause-title /tmp/flow-pause-body "chore: <title>" $MODE_FLAG $CLOSE_ARG
```

The marker is one-shot — the hook consumes it on the first matching command. Since `finish` runs as a single Bash-tool invocation, `bash-guard.sh` only ever sees that one command string, not the git calls `finish` makes internally — arming here is a no-op today but keeps the door shut if `finish` grows a destructive call later.

- `$MODE_FLAG`: `--no-push` for `local`, `--land` for `land`, empty otherwise.
- `$CLOSE_ARG` (only with `land`, and only if this branch closes an issue): `--close "<token>"` where `<token>` is the backend's close keyword you construct from `pm_backend` — e.g. `Closes #42` (github/local) or `Closes ENG-7` (linear). The script never guesses tracker prefixes; you supply the exact token.

If `finish` exits non-zero (staged secrets, push/land failure), surface the error verbatim and stop — don't retry.

## Step 8: Report

Parse the `commit:` / `push:` / `land:` / `trim:` lines from `finish` and print a tight report (Goal, Progress, Memory n written, Commit, Push, Land if set, Drift warnings if any, Next step). Include drift-check warnings verbatim if it flagged anything — informational, non-blocking.
