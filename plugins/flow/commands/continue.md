---
description: Resume the last session from .flow/session-progress.md exactly where you left off.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:continue

Resume an interrupted session. Mechanics live in `${CLAUDE_PLUGIN_ROOT}/scripts/continue-helpers.sh`.

## Step 1: Mechanical checks (shell, no LLM)

```bash
HELPERS="${CLAUDE_PLUGIN_ROOT}/scripts/continue-helpers.sh"
HELPERS_PAUSE="${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh"
"$HELPERS" check-progress     # exists | exists:stale-blocks=<n> | missing
"$HELPERS" progress-age-days  # 0 if missing
"$HELPERS" dev-server-state   # running:<pid> | port-taken:<cwd> | free | no-port
"$HELPERS" deps-ok            # ok | missing
```

Also read `$CLAUDE_PROJECT_DIR/.flow/config.md` and `$CLAUDE_PROJECT_DIR/CLAUDE.md`.

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
- **`exists:stale-blocks=<n>`:** the file has more than one Goal or more than one `Paused at` — a past pause appended instead of rewriting, so the newest state is buried and the status-line parsers are reading the oldest Goal. Read the **whole** file, identify the most recent block (usually last), and **rewrite the file with `Write`** down to current state only: one Goal, the still-open tasks, one `Paused at`, one `Next steps`, the latest `Verification:` line. Move nothing to `.flow/session-log.md` — the historical blocks were already logged there at their own pause; if the log is genuinely missing them, say so rather than reconstructing it. Say in the recap that you trimmed it and from how many blocks. Then continue as `exists` below.
- **`exists`:** read `.flow/session-progress.md` — note Goal, open Tasks, Paused at, Next steps, and the `Verification:` line if present. If it is anything other than a clean `passed (build+test)` — `not run`, `skipped (…)`, `passed (build only…)`, or `failed (test_cmd)` — surface that one line in the recap and offer to run `"$HELPERS_PAUSE" run-verification` now (from `${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh`). If `progress-age-days > 7`, also run `"$HELPERS" last-log-titles` and surface the last 3 session titles (headlines only; don't read the log body).

## Step 3: Restore agent handoff files

Check `$CLAUDE_PROJECT_DIR/.flow/session/` for `investigation.md`, `plan.md`, `review*.md`. If any are missing but the phase implies they existed, ask whether to regenerate or proceed without them.

**Never trust a handoff without checking its age first** — a `plan.md` from a previous session reads exactly like the current one, and an agent will implement against it:

```bash
"$HELPERS" stale-handoffs      # names any handoff older than .flow/state/last-pause
```

Anything it names predates the last pause and is spent. Delete those files (`rm`) and say which ones in the recap; regenerate the phase if the work still needs them. Only files it does *not* name count as this session's.

## Step 4: Dependencies

If `deps-ok` returned `missing`, run the project's install command (infer from `dev_cmd`'s package manager, e.g. the `install` subcommand). If unsure, ask once.

## Step 5: Dev server

Based on `dev-server-state` (uses `dev_port` from config):

- **`running:<pid>`** — reuse, don't restart; note the PID.
- **`port-taken:<cwd>`** — the port belongs to another project; start the dev server on a different port and note it.
- **`free`** — start `dev_cmd` in the background; confirm it came up.
- **`no-port`** — `dev_port` isn't set (or `lsof` is unavailable); start `dev_cmd` only if the work needs it.

## Step 6: Summarise + pick where to start

Print a tight recap (Goal, open tasks, Paused at, Next, dev URL, and last sessions if age > 7 days).

Include the questions state: run `${CLAUDE_PLUGIN_ROOT}/scripts/questions-helpers.sh state-line "$CLAUDE_PROJECT_DIR/.flow/questions.md"` and print its output in the recap (skip silently if empty; if UNPARSEABLE, print it loudly and offer to fix the file before anything else). Retire any question whose `issue:` is now closed (`gh issue view <n> --json state` when pm_backend is github) with `retired-because: issue closed`. Rebuild the pointer task from the file (see `${CLAUDE_PLUGIN_ROOT}/references/question-protocol.md` → Chores).

If open questions exist, END the recap turn with the top question's briefing (from `${CLAUDE_PLUGIN_ROOT}/scripts/questions-helpers.sh top-open`, following `${CLAUDE_PLUGIN_ROOT}/references/question-protocol.md` → Presenting a question) closing with its handoff line — the dialog comes only in the next turn, after the user replies. NEVER put a dialog in the recap turn itself.

Only when no open questions are pending a briefing does the turn continue past the recap: if the next step is unambiguous, just start. If there are 2–4 plausible next moves, don't open the dialog in this turn — end it with the recap plus a one-line handoff (e.g. "Several plausible next moves — reply and I'll show the options."); open `AskUserQuestion` with a recommendation next turn, after the user replies. Route the chosen phase through the appropriate agent: `Explore` to map code, `general-purpose` to implement, `reviewer` to check a diff — see `${CLAUDE_PLUGIN_ROOT}/references/agent-workflow.md`.

## Step 7: Leave the file alone

Do **not** append a resume note, a timestamp, or anything else to `.flow/session-progress.md`. It holds current state only; `/flow:pause` rewrites it wholesale at the end of the session and `.flow/session-log.md` carries the dated history. Appending here is exactly how the file grows until a resume reads a stale block.
