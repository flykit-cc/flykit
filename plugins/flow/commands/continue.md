---
description: Resume the last session from session-progress.md exactly where you left off.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:continue

Resume an interrupted session. Mechanics live in `${CLAUDE_PLUGIN_ROOT}/scripts/continue-helpers.sh`.

## Step 1: Mechanical checks (shell, no LLM)

```bash
HELPERS="${CLAUDE_PLUGIN_ROOT}/scripts/continue-helpers.sh"
HELPERS_PAUSE="${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh"
"$HELPERS" check-progress     # exists | missing
"$HELPERS" progress-age-days  # 0 if missing
"$HELPERS" dev-server-state   # running:<pid> | port-taken:<cwd> | free | no-port
"$HELPERS" deps-ok            # ok | missing
```

Also read `$CLAUDE_PROJECT_DIR/.claude/config.md` and `$CLAUDE_PROJECT_DIR/CLAUDE.md`.

## Step 2: Branch on progress state

- **`missing`:** no saved session — this is a cold start. Ask the user what to work on (freeform; if `pm_backend` is configured and they'd rather pick from open issues, list them first via `gh issue list` / Linear MCP / `issues/` frontmatter, per `pm_backend`). If `workflow_mode: team` and you're still on the default branch, cut a feature branch now — `git checkout -b "$(echo "<goal-or-issue-title>" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"` — so `/flow:pause land` has something to push and PR later; skip if already on a non-default branch. Once you have a goal, write `$CLAUDE_PROJECT_DIR/session-progress.md`:

  ```markdown
  # Session: <date>

  ## Goal
  <what the user described>

  ## Tasks
  - [ ] <first concrete step>

  ## Phase
  investigating
  ```

  Then continue straight into the work — do not stop to ask about mode or issue triage; those are decided inline as the session unfolds, not up front.
- **`exists`:** read `session-progress.md` — note Goal, open Tasks, Paused at, Next steps, and the `Verification:` line if present. If it says anything other than `passed` (e.g. `not run` or `failed (test_cmd)`), surface that one line in the recap and offer to run `"$HELPERS_PAUSE" run-verification` now (from `${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh`). If `progress-age-days > 7`, also run `"$HELPERS" last-log-titles` and surface the last 3 session titles (headlines only; don't read the log body).

## Step 3: Restore agent handoff files

Check `/tmp/flow-session/` for `investigation.md`, `plan.md`, `review.md`. If any are missing but the phase implies they existed, ask whether to regenerate or proceed without them.

## Step 4: Dependencies

If `deps-ok` returned `missing`, run the project's install command (infer from `dev_cmd`'s package manager, e.g. the `install` subcommand). If unsure, ask once.

## Step 5: Dev server

Based on `dev-server-state` (uses `dev_port` from config):

- **`running:<pid>`** — reuse, don't restart; note the PID.
- **`port-taken:<cwd>`** — the port belongs to another project; start the dev server on a different port and note it.
- **`free`** — start `dev_cmd` in the background; confirm it came up.
- **`no-port`** — `dev_port` isn't set (or `lsof` is unavailable); start `dev_cmd` only if the work needs it.

## Step 6: Summarise + pick where to start

Print a tight recap (Goal, open tasks, Paused at, Next, dev URL, and last sessions if age > 7 days). If the next step is unambiguous, just start. If there are 2–4 plausible next moves, use `AskUserQuestion` with a recommendation. Route the chosen phase through the appropriate agent: `Explore` to map code, `general-purpose` to implement, `reviewer` to check a diff — see `${CLAUDE_PLUGIN_ROOT}/references/agent-workflow.md`.

## Step 7: Note the resume

Append a `Resumed at <timestamp>` note to `session-progress.md` so history is auditable.
