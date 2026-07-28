---
description: Pause cleanly — shut down agents, decide on build/test verification, save state + memory, run drift-check, commit and (by default) push. "local" skips push; "land" runs CI checks, closes issues, and ships — ff-merging in solo mode, opening a PR in team mode.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, SendMessage, AskUserQuestion
---
# /flow:pause

Stop work cleanly so it can be resumed with `/flow:continue`. The mechanics live in `${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh`; this command only narrates and decides.

| Invocation | What happens |
|---|---|
| `/flow:pause` | save state + commit + push current branch |
| `/flow:pause local` | save state + commit, **no push** |
| `/flow:pause land` | save state + run CI checks + commit + push + close issues, then: **solo** — rebase onto the default branch, ff-merge, delete branch; **team** — open a PR |

Flags are space-separated args. `local` and `land` are mutually exclusive (land implies push). `land` is the only mode that ships — it's where CI checks and issue closing apply. Every invocation (including plain `pause`) asks whether to run build/test verification first, per `stop_check` in `.flow/config.md` (see Step 4). Whether `land` ff-merges or opens a PR depends on `workflow_mode`.

## Step 1: Load config

Read `$CLAUDE_PROJECT_DIR/.flow/config.md`. Capture `workflow_mode`, `pm_backend` (+ `pm_*`), `memory_path`, `known_pitfalls_path`, `stop_check`. If the invocation is `land`, also capture `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`.

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

**No-op fast-exit:** if `changed-files` is empty, `.flow/session-progress.md` has no open tasks, and nothing meaningful happened this session, print `Nothing to pause — working tree clean, no session state to save.` and stop.

## Step 4: Verification decision

Deciding whether to run `build_cmd` + `test_cmd` is a human decision, made here at pause time — not something a background hook fires blindly. Resolve it:

```bash
"$HELPERS" verification-mode    # ask | always | never
```

- **`always`** — run verification now (Step 4a), no prompt.
- **`never`** — skip, no prompt. Record `Verification: not run` for Step 9.
- **`ask` (default, incl. unset)** — ask via `AskUserQuestion`, with a recommendation based on the invocation: for `land`, recommend **Run build + test** (about to ship); for plain `/flow:pause` and `/flow:pause local`, recommend **Skip** (a checkpoint is not a ship). Options:
  - `Run build + test`
  - `Skip`
  - `Always run (save to config)` — also run now, and persist the choice: `"$HELPERS" set-verification-mode always` (so future pauses never ask again).

**Exception — unattended/non-interactive invocation** (e.g. delegated from `/flow:autopilot`, which never prompts after launch): do not call `AskUserQuestion` at all. Treat an unset/`ask` `stop_check` as `always` for this call only — run verification without asking. `always`/`never` behave exactly as above either way.

### Step 4a: Run verification (if the decision was to run it)

```bash
"$HELPERS" run-verification    # runs build_cmd + test_cmd; exits non-zero on failure
```

- **Passes:** record `Verification: passed` for Step 9. Continue.
- **Fails:** report the failure concisely (which command, key error lines). Never silently pause on a failing build.
  - **Plain `pause`/`pause local`:** ask whether to fix now or pause anyway (a checkpoint may legitimately save broken WIP). If "pause anyway", record `Verification: failed (<build_cmd|test_cmd>)` for Step 9.
  - **`land`:** ask whether to fix now or abort landing — do not land on a failing build. If aborted, record `Verification: failed (<build_cmd|test_cmd>)` for Step 9 and stop before Step 9 (finish).

## Step 5: `land` only — run remaining CI checks

Run each non-empty command directly, from `$CLAUDE_PROJECT_DIR`, in order — `lint_cmd`, `typecheck_cmd` (build/test were handled by Step 4):

```bash
[ -n "$lint_cmd" ] && eval "$lint_cmd"
[ -n "$typecheck_cmd" ] && eval "$typecheck_cmd"
```

If either fails, stop. Report the failures to the user and ask whether to fix now or abort. Do not land on a failing lint/typecheck. Skip this step entirely for plain `/flow:pause` and `/flow:pause local` — those are checkpoints, not ships.

## Step 6: Narrate + memory candidates (main agent, silent)

The main agent holds the conversation; subagents don't — so do this directly, and do NOT print the narration in chat:

- **Body:** concrete bullets of what was done this session, cross-checked against `diff-since-pause`. Write to `/tmp/flow-pause-body` via the Write tool.
- **Title:** a one-line session title (no em-dashes). Write to `/tmp/flow-pause-title`.
- **Memory candidates** (only if `memory_path` is set): durable cross-session rules — architecture decisions, external-API gotchas, surprising findings. **Cap at 4.** Skip ephemeral single-file edits and anything already in memory.

## Step 7: Auto-save memory — do NOT ask

If `memory_path` is set and there are candidates: read its `MEMORY.md` index (small, one Read), dedup each candidate (`new` / `duplicate` / `extends`), then **write the memory files and update `MEMORY.md` directly**. Never gate this behind an approval question — work that was actually done is worth remembering; asking is pure friction. The only filter is relevance. Then:

```bash
"$HELPERS" save-memory "<memory_path>/MEMORY.md" <written-file>...
```

If `memory_path` is unset, skip memory entirely.

## Step 8: `land` only — update CLAUDE.md if structure changed

If new top-level directories, new commands, or new conventions were introduced this session, update `$CLAUDE_PROJECT_DIR/CLAUDE.md` to reflect them. Ask the user to confirm changes. Skip for plain `pause`/`pause local`.

## Step 9: Settle .flow/session-progress.md

Do this **before** the final commit, not after. Check off the tasks completed this session, then:

- **`land`, everything shipped** (goal accomplished, no open tasks): clear the Goal, Paused at, and Next steps sections. The `finish` helper in Step 10 will then delete the file — a landed session must not leave a stale resume file for `/flow:continue` to pick up.
- **Open tasks remain, or this is plain `pause`/`pause local`**: keep Goal and the open tasks, refresh `Paused at` and `Next steps`. The helper will keep the file, and the next session resumes from exactly this state.

Also write the verification outcome from Step 4/4a as its own line, e.g. `Verification: passed`, `Verification: not run`, or `Verification: failed (test_cmd)`. `/flow:continue` surfaces anything other than `passed` on resume.

**`land` + `workflow_mode: team`:** capture the file's current content now, before trimming — it drafts the PR body in Step 10.5, and the file may be gone by then.

## Step 10: One-shot finish (shell)

If `land` and there were prior `wip:` commits on this branch, first ask the user whether to keep them or squash interactively (do not auto-squash).

```bash
"$HELPERS" finish /tmp/flow-pause-title /tmp/flow-pause-body "chore: <title>" $MODE_FLAG $CLOSE_ARG
```

- `$MODE_FLAG`: `--no-push` for `local`; for `land`, `--land` when `workflow_mode: solo` (ff-merge onto the default branch), **empty** when `workflow_mode: team` (push the feature branch only — Step 10.5 opens a PR instead of merging); empty otherwise. Never pass `--land` in team mode: the helper's `--land` path always rebases and ff-merges onto the default branch unconditionally, which would bypass review.
- `$CLOSE_ARG` (only with `land`, and only if this branch closes exactly one issue): `--close "<token>"` where `<token>` is the backend's close keyword you construct from `pm_backend` — e.g. `Closes #42` (github/local) or `Closes ENG-7` (linear). The script never guesses tracker prefixes; you supply the exact token. If the session touched more than one issue, leave `$CLOSE_ARG` empty and close all of them explicitly in Step 11 instead — the commit-message trailer only auto-closes one.

If `finish` exits non-zero (staged secrets, push/land failure), surface the error verbatim and stop — don't retry.

## Step 10.5: `land` + `workflow_mode: team` only — open the PR

Solo mode already shipped via the ff-merge in Step 10 — skip this step entirely. In team mode, `finish` only pushed the feature branch; open the PR now:

```bash
gh pr create --title "<title>" --body "<PR body>" --fill-first
```

Draft the PR body from the `.flow/session-progress.md` content captured in Step 9 (Goal, what shipped, key decisions) plus the `/tmp/flow-pause-body` narration. For a non-github `pm_backend`, use the backend's equivalent (e.g. note in the report that Linear/local tracking has no PR concept and the branch was pushed for manual review). Print the PR URL in the final report.

## Step 11: `land` only — close issues

Read the issues worked in this session from `.flow/session-progress.md` (captured before Step 9 trimmed it). For each one not already closed by the commit-message trailer in Step 10, close it explicitly using the commit hash `finish` reported:

- **github**: `gh issue close <num> --comment "Resolved by <branch> / <commit-sha>"`
- **linear**: use the Linear MCP server to transition the issue to Done
- **local**: move the issue file from `issues/` to `issues/closed/`

Skip this step for plain `pause`/`pause local` — only `land` ships and closes issues.

## Step 12: Report

Parse the `commit:` / `push:` / `land:` / `trim:` lines from `finish` and print a tight report (Goal, Progress, Verification, Memory n written, Commit, Push, Land if set, PR URL if `land` + team mode, Issues closed if `land`, Drift warnings if any, Next step). Include drift-check warnings verbatim if it flagged anything — informational, non-blocking.
