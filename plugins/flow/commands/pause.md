---
description: Save WIP, shut down agents cleanly, and commit a checkpoint without pushing.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---
# /flow:pause

Stop work cleanly so it can be resumed later with `/flow:continue`.

## Step 1: Shut down running agents

If any background agents are running, send a shutdown_request signal. The agents handle this by flushing their handoff file and exiting. See `${CLAUDE_PLUGIN_ROOT}/references/agent-workflow.md` for the protocol.

Concretely: write `/tmp/flow-session/shutdown_request` and wait up to 30 seconds for agents to finish writing their handoff files.

## Step 2: Update session-progress.md

Read `$CLAUDE_PROJECT_DIR/session-progress.md`. Append:

- Current phase and what was in progress
- Any blockers or open questions
- Files touched but not yet committed
- Next action when resuming

## Step 3: WIP commit (no push)

Stage and commit:

```bash
git add -A
git commit -m "wip: pause session — <one-line summary>"
```

Do **not** push. Do not delete the branch. Do not run lint/format/tests — this is a checkpoint, not a finish line.

## Step 4: Print resume instructions

Tell the user:

- The branch they are on
- The command to resume: `/flow:continue`
- Any blockers they should think about before resuming
