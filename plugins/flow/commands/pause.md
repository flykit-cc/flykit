---
description: Pause cleanly — shut down agents, save state + memory, run drift-check, commit and (by default) push. "local" skips push; "land" runs CI checks, closes issues, ff-merges a feature branch onto the default branch, and is the only mode that ships.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, SendMessage
---
# /flow:pause

Stop work cleanly so it can be resumed with `/flow:continue`. The mechanics live in `${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh`; this command only narrates and decides.

| Invocation | What happens |
|---|---|
| `/flow:pause` | save state + commit + push current branch |
| `/flow:pause local` | save state + commit, **no push** |
| `/flow:pause land` | save state + run CI checks + commit + push + close issues + rebase onto the default branch + ff-merge + delete branch |

Flags are space-separated args. `local` and `land` are mutually exclusive (land implies push). `land` is the only mode that ships — it's where CI checks, issue closing, and the build-gate arming below apply.

## Step 1: Load config

Read `$CLAUDE_PROJECT_DIR/.claude/config.md`. Capture `workflow_mode`, `pm_backend` (+ `pm_*`), `memory_path`, `known_pitfalls_path`. If the invocation is `land`, also capture `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`, `stop_check`.

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

## Step 4: `land` only — run CI checks

Run each non-empty command directly, from `$CLAUDE_PROJECT_DIR`, in order — `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`:

```bash
[ -n "$lint_cmd" ] && eval "$lint_cmd"
[ -n "$typecheck_cmd" ] && eval "$typecheck_cmd"
[ -n "$build_cmd" ] && eval "$build_cmd"
[ -n "$test_cmd" ] && eval "$test_cmd"
```

If any fails, stop. Report the failures to the user and ask whether to fix now or abort. Do not land on a failing build. Skip this step entirely for plain `/flow:pause` and `/flow:pause local` — those are checkpoints, not ships.

## Step 5: Narrate + memory candidates (main agent, silent)

The main agent holds the conversation; subagents don't — so do this directly, and do NOT print the narration in chat:

- **Body:** concrete bullets of what was done this session, cross-checked against `diff-since-pause`. Write to `/tmp/flow-pause-body` via the Write tool.
- **Title:** a one-line session title (no em-dashes). Write to `/tmp/flow-pause-title`.
- **Memory candidates** (only if `memory_path` is set): durable cross-session rules — architecture decisions, external-API gotchas, surprising findings. **Cap at 4.** Skip ephemeral single-file edits and anything already in memory.

## Step 6: Auto-save memory — do NOT ask

If `memory_path` is set and there are candidates: read its `MEMORY.md` index (small, one Read), dedup each candidate (`new` / `duplicate` / `extends`), then **write the memory files and update `MEMORY.md` directly**. Never gate this behind an approval question — work that was actually done is worth remembering; asking is pure friction. The only filter is relevance. Then:

```bash
"$HELPERS" save-memory "<memory_path>/MEMORY.md" <written-file>...
```

If `memory_path` is unset, skip memory entirely.

## Step 7: `land` only — update CLAUDE.md if structure changed

If new top-level directories, new commands, or new conventions were introduced this session, update `$CLAUDE_PROJECT_DIR/CLAUDE.md` to reflect them. Ask the user to confirm changes. Skip for plain `pause`/`pause local`.

## Step 8: Settle session-progress.md

Do this **before** the final commit, not after. Check off the tasks completed this session, then:

- **`land`, everything shipped** (goal accomplished, no open tasks): clear the Goal, Paused at, and Next steps sections. The `finish` helper in Step 9 will then delete the file — a landed session must not leave a stale resume file for `/flow:continue` to pick up.
- **Open tasks remain, or this is plain `pause`/`pause local`**: keep Goal and the open tasks, refresh `Paused at` and `Next steps`. The helper will keep the file, and the next session resumes from exactly this state.

## Step 9: One-shot finish (shell)

If `land` and there were prior `wip:` commits on this branch, first ask the user whether to keep them or squash interactively (do not auto-squash).

```bash
"$HELPERS" finish /tmp/flow-pause-title /tmp/flow-pause-body "chore: <title>" $MODE_FLAG $CLOSE_ARG
```

- `$MODE_FLAG`: `--no-push` for `local`, `--land` for `land`, empty otherwise.
- `$CLOSE_ARG` (only with `land`, and only if this branch closes exactly one issue): `--close "<token>"` where `<token>` is the backend's close keyword you construct from `pm_backend` — e.g. `Closes #42` (github/local) or `Closes ENG-7` (linear). The script never guesses tracker prefixes; you supply the exact token. If the session touched more than one issue, leave `$CLOSE_ARG` empty and close all of them explicitly in Step 10 instead — the commit-message trailer only auto-closes one.

If `finish` exits non-zero (staged secrets, push/land failure), surface the error verbatim and stop — don't retry.

## Step 10: `land` only — close issues

Read the issues worked in this session from `session-progress.md` (captured before Step 8 trimmed it). For each one not already closed by the commit-message trailer in Step 9, close it explicitly using the commit hash `finish` reported:

- **github**: `gh issue close <num> --comment "Resolved by <branch> / <commit-sha>"`
- **linear**: use the Linear MCP server to transition the issue to Done
- **local**: move the issue file from `issues/` to `issues/closed/`

Skip this step for plain `pause`/`pause local` — only `land` ships and closes issues.

## Step 11: Report

Parse the `commit:` / `push:` / `land:` / `trim:` lines from `finish` and print a tight report (Goal, Progress, Memory n written, Commit, Push, Land if set, Issues closed if `land`, Drift warnings if any, Next step). Include drift-check warnings verbatim if it flagged anything — informational, non-blocking.
