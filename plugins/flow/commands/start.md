---
description: Begin a session — load issues, pick work, choose a mode, route through the agent pipeline.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:start

Begin a focused work session. Load context, pick an issue (or several), pick a mode, then hand off to agents.

## Step 1: Load context

Read `$CLAUDE_PROJECT_DIR/.claude/config.md` and `$CLAUDE_PROJECT_DIR/CLAUDE.md`. If `.claude/config.md` is missing, tell the user to run `/flow:init` first and stop.

Parse the config fields: `workflow_mode`, `pm_backend`, `dev_cmd`, `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`, `format_cmd`, and any pm_* fields.

## Step 2: Load open issues

Based on `pm_backend`:

- **github**: `gh issue list --state open --limit 50 --json number,title,labels,url`
- **linear**: use the Linear MCP server's list-issues tool, filtered to `pm_linear_team`
- **local**: list files in `$CLAUDE_PROJECT_DIR/issues/` and read frontmatter

Show the user the list as a numbered table.

## Step 3: Pick work

Use `AskUserQuestion` to let the user pick one or more issues, or to type a freeform task description if nothing fits. Confirm the selection.

## Step 4: Branch (team mode only)

If `workflow_mode=team`:

```bash
git checkout -b "$(echo "<issue-title>" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
```

Use the issue number/title for the slug. Skip if already on a non-default branch.

## Step 5: Create session-progress.md

Write `$CLAUDE_PROJECT_DIR/session-progress.md` with:

```markdown
# Session: <date>

## Issues
- #<num> <title>

## Plan
(filled by architect)

## Phase
investigating

## Notes
```

## Step 6: Pick a mode

Use `AskUserQuestion`:

- **Autopilot** — agents run end-to-end, ask only on blocking decisions
- **Interactive** — pause for review between phases
- **Agent Team** — spawn parallel coders for independent sub-tasks

## Step 7: Route to agents

Spawn agents in sequence via the `Agent` tool. Hand off via `/tmp/flow-session/<phase>.md` (each agent reads the previous file, writes the next):

1. **investigator** — map the relevant code, write `/tmp/flow-session/investigation.md`
2. **architect** — turn investigation into a plan, write `/tmp/flow-session/plan.md`, update session-progress.md
3. **coder** — execute the plan (one coder in Autopilot/Interactive; multiple in Agent Team mode, one per file group)
4. **reviewer** — check the diff, write `/tmp/flow-session/review.md`

In Interactive mode, stop after each phase and confirm with the user before proceeding.

In Autopilot mode, only stop when an agent reports a blocking question.

In Agent Team mode, enforce the file-ownership rule: each coder writes a disjoint set of files. See `${CLAUDE_PLUGIN_ROOT}/references/agent-workflow.md`.

## Step 8: Hand off to /flow:push

When the reviewer reports clean, tell the user: "Ready to ship — run `/flow:push`."
