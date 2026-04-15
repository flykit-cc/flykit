---
description: Resume the last session from session-progress.md exactly where you left off.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:continue

Resume an interrupted session.

## Step 1: Locate state

Read `$CLAUDE_PROJECT_DIR/session-progress.md`. If missing, tell the user there is no session to continue and suggest `/flow:start`.

Also read `$CLAUDE_PROJECT_DIR/.claude/config.md` and `$CLAUDE_PROJECT_DIR/CLAUDE.md`.

## Step 2: Show summary

Print a short recap to the user:

- Issues in flight
- Last completed phase
- Current phase
- Any notes from the previous session

## Step 3: Restore agent handoff files

Check `/tmp/flow-session/` for `investigation.md`, `plan.md`, `review.md`. If any are missing but the phase implies they existed, ask the user whether to regenerate or proceed without them.

## Step 4: Confirm continuation point

Use `AskUserQuestion` to confirm: "Resume at `<phase>`?" with options to resume, restart the current phase, or jump to a different phase.

## Step 5: Resume

Spawn the appropriate agent for the chosen phase via the `Agent` tool. Same agent contract as `/flow:start`.

## Step 6: Update session-progress.md

Append a "Resumed at <timestamp>" note so the history is auditable.
