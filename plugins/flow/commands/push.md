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

## Step 4: Close issues

Read the issues worked in this session from `session-progress.md`. For each:

- **github**: `gh issue close <num> --comment "Resolved by <branch> / <commit-sha>"`
- **linear**: use the Linear MCP server to transition the issue to Done
- **local**: move the issue file from `issues/` to `issues/closed/`

## Step 5: Update CLAUDE.md if structure changed

If new top-level directories, new commands, or new conventions were introduced, update `$CLAUDE_PROJECT_DIR/CLAUDE.md` to reflect them. Ask the user to confirm changes.

## Step 6: Final commit

Stage everything and commit with a clean message (not `wip:`). If there were prior `wip:` commits on this branch, ask the user whether to keep them or squash interactively (do not auto-squash).

## Step 7: Solo vs team

- **solo**: delete `session-progress.md`, `git push`, done.
- **team**: keep `session-progress.md` as a PR artifact, `git push -u origin <branch>`, then ask via `AskUserQuestion` whether to open a PR. If yes, run `gh pr create --fill` (or prompt for title/body if the user prefers). Use `session-progress.md` content as the PR body draft.

## Step 8: Print summary

Show the user: branch, commit SHA, issues closed, PR URL (if any).
