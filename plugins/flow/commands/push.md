---
description: Finalize — run CI checks, close issues, update docs, commit, push (or open a PR in team mode).
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:push

Ship the work. This is the only command that pushes to a remote.

## Step 1: Load config

Read `$CLAUDE_PROJECT_DIR/.claude/config.md`. Capture `workflow_mode`, `pm_backend`, `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`.

## Step 2: Shut down agents

Same protocol as `/flow:pause` — write `/tmp/flow-session/shutdown_request` and wait briefly.

## Step 3: Run CI checks

Spawn the `ci-check` agent via the `Agent` tool. It runs the configured commands in order: `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`. Each is read from config.md — do not hardcode any command here.

If any check fails, stop. Report failures to the user and ask whether to fix now (spawn `coder`) or abort. Do not push on a failing build.

**Arm the build gate.** Before returning control, `touch "$CLAUDE_PROJECT_DIR/.build-check"`. This is a deliberate one-shot gate: the next time the session stops, `stop-check.sh` runs `build_cmd` + `test_cmd` synchronously and blocks if they fail, then removes the marker. It is the safety net that catches anything `ci-check` missed. (Routine stops stay fast — they only ever lint/format in the background.)

## Step 4: Close issues

Read the issues worked in this session from `session-progress.md`. For each:

- **github**: `gh issue close <num> --comment "Resolved by <branch> / <commit-sha>"`
- **linear**: use the Linear MCP server to transition the issue to Done
- **local**: move the issue file from `issues/` to `issues/closed/`

## Step 5: Update CLAUDE.md if structure changed

If new top-level directories, new commands, or new conventions were introduced, update `$CLAUDE_PROJECT_DIR/CLAUDE.md` to reflect them. Ask the user to confirm changes.

## Step 6: Settle session-progress.md

Do this **before** the final commit, not after. Check off the tasks completed this session, then:

- **Everything shipped** (goal accomplished, no open tasks): clear the Goal, Paused at, and Next steps sections. The `finish` helper in Step 8 will then delete the file — a shipped session must not leave a stale resume file for `/flow:continue` to pick up.
- **Open tasks remain**: keep Goal and the open tasks, refresh Next steps to reflect what shipping changed. The helper will keep the file, and the next session resumes from exactly this state.

In **team** mode, also capture the file's current content now — it drafts the PR body in Step 9 and the file may be gone by then.

## Step 7: Narrate the session (silent)

As in `/flow:pause`, write two files without printing them in chat:

- `/tmp/flow-push-title` — one-line summary of what shipped (no em-dashes).
- `/tmp/flow-push-body` — concrete bullets: what shipped, key decisions, anything deliberately left out or still open.

This becomes the session's permanent block in `session-log.md`. A session that ends in `/flow:push` never runs `/flow:pause`, so this is its only narrative record — do not skip it.

## Step 8: One-shot finish (shell)

If there were prior `wip:` commits on this branch, first ask the user whether to keep them or squash interactively (do not auto-squash). Then:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh" finish /tmp/flow-push-title /tmp/flow-push-body "<clean commit message, not wip:>"
```

This is the same helper `/flow:pause` uses. In order it: prepends the session-log block, trims-or-deletes `session-progress.md`, stages changed files one by one (never `git add -A`) behind the staged-secrets guard, commits, pushes (falling back to `push -u origin <branch>` on a first push), and refreshes the pause marker. Do not replicate any of these steps by hand.

If `finish` exits non-zero (staged secrets, push failure), surface the error verbatim and stop — don't retry.

## Step 9: Team mode — open the PR

Solo: done, go to Step 10. Team: ask via `AskUserQuestion` whether to open a PR. If yes, run `gh pr create` with the content captured in Step 6 as the body draft (or `--fill` if the user prefers).

## Step 10: Print summary

Show the user: branch, commit SHA, issues closed, whether `session-progress.md` was deleted or kept (the `trim:` line from `finish`), PR URL (if any).
