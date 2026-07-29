---
description: Read-only "where am I / what's running / what next" — git state, in-flight agents, PR/CI, current goal. Restores nothing.
allowed-tools: Bash, Read, TaskList
---
# /flow:status

A **read**, not a restore. Use it mid-session when you've lost the thread: what's running,
where the branch is, what's next. It never writes, never stages, never spawns an agent.

If the session actually needs restoring after a break, that's `/flow:continue`. If you're
wrapping up, that's `/flow:pause`.

## Step 1: Mechanical facts (shell, no LLM)

```bash
HELPERS="${CLAUDE_PLUGIN_ROOT}/scripts/status-helpers.sh"
"$HELPERS" all
```

One `key=value` per line, under `[git]` / `[progress]` / `[pr]` headers:

| Key | Meaning |
|---|---|
| `repo=none` | not a git repo — skip every git line below |
| `branch`, `last` | current branch, last commit |
| `upstream=none` | branch has no tracking branch (nothing pushed yet) |
| `ahead`, `behind` | commits vs upstream; only present when `upstream` is set |
| `changed` | count of uncommitted paths |
| `progress` | `exists` / `missing` |
| `age_days` | days since `.flow/session-progress.md` was touched |
| `goal`, `paused_at`, `verification` | first line of each, verbatim |
| `open_tasks`, `task` | open-task count, then up to 5 of them |
| `pr`, `pr_state`, `pr_checks` | `none` / `unavailable` when there's no PR or no `gh` |

## Step 2: In-flight work

Call `TaskList` for background tasks and agents. For each, note its status and how long it
has been running. This is the half of "what's running" that the shell cannot see.

Nothing running and nothing uncommitted means the session is idle, not broken — say so
plainly rather than inventing work.

## Step 3: Print the status

Keep it to a dozen lines. Lead with whatever is most likely to need action, and omit rows
that have nothing to report — a clean line is noise.

```
Goal      Ship the status command
Branch    main · 2 ahead, 0 behind · 4 uncommitted
Running   2 agents (reviewer 4m, general-purpose 1m)
PR        #12 open · checks failing
Tasks     3 open — wire the CI check, update README, bump version
Next      CI is red on #12; that blocks the merge.
```

Flag these when they apply, each in one line:

- `behind > 0` — the branch is behind; a rebase or pull comes before more work.
- `verification` is anything other than `passed` — surface it verbatim and offer
  `${CLAUDE_PLUGIN_ROOT}/scripts/pause-helpers.sh run-verification`.
- `age_days > 7` — the saved session is stale; its "next steps" may be obsolete.
- `pr_checks=failing` — that outranks whatever else was planned.

## Step 4: Suggest one next action

End with a single recommended next step and the reason, in one line. Suggest — do not start
it. Acting on it is a separate, explicit request; this command's contract is that running it
never changes anything.
