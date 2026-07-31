---
description: Autonomous multi-sprint loop — pick issues, spawn a parallel agent team, deep-review, push, repeat; self-generate work via audit when issues run out.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, SendMessage
---
# /flow:autopilot

Fully autonomous development loop. Picks issues, spawns a non-overlapping agent team, implements, reviews, pushes, and repeats — until stopped or the codebase is clean. Built on the built-in `Explore` and `general-purpose` agents, the `reviewer` agent, the `superpowers:writing-plans` skill, and the file-ownership contract in `${CLAUDE_PLUGIN_ROOT}/references/agent-workflow.md`.

## Usage

```
/flow:autopilot            # ask config once, then run autonomously
/flow:autopilot 12 14 19   # start with specific issue numbers (skip selection)
```

## Step 0: Load config and context

Read `$CLAUDE_PROJECT_DIR/.flow/config.md` and `$CLAUDE_PROJECT_DIR/CLAUDE.md`. If `.flow/config.md` is missing, tell the user to run `/flow:init` and stop.

Capture: `workflow_mode`, `pm_backend` (+ `pm_*`), `lint_cmd`, `typecheck_cmd`, `build_cmd`, `test_cmd`, `format_cmd`, `known_pitfalls_path` (default `CLAUDE.md`), `memory_path`.

Read the project's **Known Pitfalls** from `known_pitfalls_path`. Keep the full section in context — you will inject it verbatim into every agent spawn.

## Core principle

**AskUserQuestion is used ONCE, at launch, for configuration. After that, NEVER again.** No "should I proceed?", no confirmations, no approval gates. This is autopilot.

- Blocked by an external dependency (needs a VPS, API key, paid service, or a business decision)? **Skip the issue**, file a `blocked` ticket on the configured `pm_backend`, continue with the rest. Never write placeholder/stub code to "close" an issue.
- Uncertain about implementation? Make the best call autonomously.
- Permission denied? Adjust approach, don't re-ask.

## Phase 0: Setup

1. `git status --short` and `git branch --show-current`.
   - Uncommitted changes: fix any obvious breakage, then commit them as a clean revert point.
   - Determine the default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (fallback `main`).
   - `solo` mode: work on the default branch; `git pull` for a clean base.
   - `team` mode: each sprint gets its own feature branch (created in Phase 2); start from an up-to-date default branch.
2. **AskUserQuestion** — ask both questions below in a single prompt. This is the only AskUserQuestion in the whole flow.

   **Q1 "Model"** (header `Model`): `Dynamic — auto-pick per agent (Recommended)` / `All Opus` / `All Sonnet (fast)`.
   **Q2 "Review"** (header `Review`): `Deep review before every push (Recommended)` / `Skip reviews (fast, risky)`.

3. If issue numbers were passed as arguments, use them and skip Phase 1. Otherwise auto-pick (Phase 1).

## Phase 1: Issue selection (auto-pick)

1. Load open issues from `pm_backend`:
   - **github**: `gh issue list --state open --limit 100 --json number,title,labels,body`
   - **linear**: Linear MCP list-issues, filtered to `pm_linear_team`
   - **local**: read frontmatter of files in `$CLAUDE_PROJECT_DIR/issues/`
2. **Batch a sprint** with judgment: prioritize by label weight (high > medium > low), group interdependent issues into one sprint, and identify what can run in parallel (different parts of the codebase).
3. **Plan the team**: decide how many `general-purpose` implementers and how to split work. Small issues can share one; large features get their own.
4. **Plan file ownership**: every implementer gets a STRICT, non-overlapping set of files it may create or modify. No two implementers touch the same file. If two issues share files, they go to the same implementer. This replaces all locking — see `agent-workflow.md`.
5. Write the sprint plan to `$CLAUDE_PROJECT_DIR/session-progress.md` and proceed immediately (no approval).

## Phase 2: Implementation

1. **Claim issues**: github → `gh issue edit <n> --add-assignee @me`; linear → assign via MCP; local → add `status: in-progress` to the file.
2. **team mode only**: check out the default branch and pull, then cut the sprint branch from it — `git checkout <default> && git pull && git checkout -b flow/sprint-<n>-<slug>`. Branch from the default branch every sprint, not from the previous sprint's (possibly still-open-PR) branch — `/flow:pause land` doesn't merge in team mode, so the previous branch may not be in `<default>` yet.
3. **Run the pipeline per issue group.** For each group, drive flow's normal chain via the `Agent` tool, handing off through `/tmp/flow-session/`:
   - **`Explore`** — map the relevant code, write findings to `/tmp/flow-session/investigation-<group>.md`
   - **`superpowers:writing-plans`** skill — turn the investigation into an ordered plan, write it to `/tmp/flow-session/plan-<group>.md`
   - then spawn the **`general-purpose` agents in parallel** (one per file-ownership set) to implement the plan.
4. **Every implementer spawn prompt MUST include, verbatim:**
   - The issue text (`gh issue view <n>` / MCP / local file) and the plan.
   - Its file-ownership list and: *"You have full permission to read, write, and edit any file in your ownership list. Do not touch files outside it — another agent owns them. Do not ask for confirmation, do not wait for approval. Just do the work."*
   - The **entire** Known Pitfalls section copied from `known_pitfalls_path` — all of it, every time. It is cheap and prevents the most common bugs. Do NOT filter it.
   - The instruction to end its report with exactly one status line — `STATUS: DONE`, `STATUS: BLOCKED` (external dependency, explain), or `STATUS: PLAN_MISMATCH` (plan diverges from reality, explain) — so the orchestrator can route the result per Step 6.
   - Spawn with **`mode: "auto"`** so agents auto-accept edits and never prompt.
5. **Do NOT use `TeamCreate` / `TeamDelete` / `TaskCreate` / `TaskUpdate`.** They write to `~/.claude/` and reset `bypassPermissions` to `acceptEdits`. Use direct `Agent` spawns only.
6. **Monitor and assist** (orchestrator does these directly — the only code the orchestrator writes is small cross-agent integration glue):
   - Lint/format issues surface via Phase 2 step 8's explicit `lint_cmd`/`typecheck_cmd` run; fix errors it reports without waiting for the agent to finish.
   - Implementer reports `BLOCKED` → skip that issue, file a `blocked` ticket with the reason, move on.
   - Implementer reports `PLAN_MISMATCH` / needs context → resolve autonomously via `SendMessage`; if truly impossible, skip and file a ticket.
7. **Shut down each agent the moment it finishes** — send `shutdown_request` via `SendMessage` (also written to `/tmp/flow-session/shutdown_request` per the protocol). Idle agents waste resources and clutter the terminal.
8. **Fix cross-agent integration issues** (orchestrator, small glue only): registries/index files that need every new entry, import wiring, migration ordering. Then run `lint_cmd` + `typecheck_cmd` and fix failures.

## Phase 3: Deep review (unless "Skip reviews" was chosen)

Run **`/flow:deep-review`** over the sprint diff. Do NOT duplicate its logic here — delegate. It fans out parallel `reviewer` agents (BREAKS / SECURITY / MINOR), synthesizes, runs the fix loop until zero BREAKS and zero SECURITY, verifies with `test_cmd`, and appends recurring findings to `known_pitfalls_path`. It auto-proceeds without prompting when called from autopilot.

## Phase 4: Push

Delegate to **`/flow:pause land`** (it runs CI checks, closes issues, and pushes; then in `solo` mode — already on the default branch — it's just a commit and push, while in `team` mode it opens a PR on the sprint branch Phase 2 created, without merging). If it reports an unfixable failure, fix it autonomously (or skip the offending change and file a ticket) — never ship broken code, never force-push, never `--no-verify`.

`/flow:pause land`'s verification decision (its Step 4) normally asks via `AskUserQuestion` when `stop_check` is unset or `ask` — autopilot can never answer that, so this delegation must never hit it. Per that step's unattended-invocation exception, autopilot treats an unset/`ask` `stop_check` as `always`: verification runs automatically, no question asked. `always`/`never` in config are honoured as configured, also without prompting.

**`verification-skipped:nothing-configured` halts the loop.** Step 4 tells an interactive `land` to stop and ask before shipping an unverified repo, and autopilot cannot answer that question either. So it takes the fail-closed branch: stop the run, leave the work committed but unlanded, and report that neither `build_cmd` nor `test_cmd` is set in `.flow/config.md`. An autonomous loop must not ship code it has no way to check — a human choosing to skip verification is a decision, a robot skipping it is an accident. Configure at least one command, or run `/flow:pause land` by hand.

**`team` mode:** the sprint branch stays open as a PR — Phase 5 loops back to Phase 1 without merging it. The next sprint's branch (Phase 2 step 2) is cut from the same point Phase 0 started from, not from the unmerged PR, so sprints stay independent and reviewable rather than stacking.

## Phase 5: Cleanup and loop

1. Clear `/tmp/flow-session/*` per `agent-workflow.md`. Do not touch `.flow/session-progress.md` — `/flow:pause land` already settled it (deleted if the sprint shipped everything, kept if tasks remain).
2. **File tickets** for problems discovered during the sprint that were out of scope (tag `blocked` if they need a user decision).
3. **Capture learnings** (only if `memory_path` is set): if the sprint produced durable cross-session knowledge, write a short memory file under `memory_path` and update its `MEMORY.md` index. Skip routine work.
4. Output the **Sprint report** (format below).
5. Re-check open issues. If non-blocked issues remain → **Phase 1** (next sprint). If only blocked issues or none remain → **Phase 6**.

## Phase 6: Audit-driven discovery

When actionable issues run out, generate more work by auditing — a self-sustaining loop with a guard against runaway churn.

1. **Escalation guard** (only if `memory_path` is set and an audit-history file exists there): read the per-audit finding counts. If the last **5 consecutive** audits show strictly increasing counts (e.g. 5 → 7 → 8 → 10 → 12), STOP and report: *"Audit finding count is trending up (X → … → Z over 5 audits). Stopping autopilot — human review recommended."* Fewer than 5 entries → skip the check (not enough data).
2. **Run `/flow:audit`** in autopilot mode, overriding two behaviors: (a) **skip the user-selection gate** — file every actionable finding automatically; (b) **cross-reference** open issues and the audit history so you never file a duplicate. Everything else follows `/flow:audit` as-is. Record the finding count to the audit-history memory file (if `memory_path` set).
3. **Evaluate:**
   - 0 new actionable issues → STOP: *"Audit found no new issues. Codebase is clean. Autopilot complete."*
   - All new issues need external dependencies → STOP with a final summary.
   - Actionable issues created → loop back to **Phase 1**.

## When to stop

- Audit finds 0 new actionable issues (clean).
- All remaining issues need external dependencies (sprint loop AND audit loop exhausted).
- Escalation guard tripped (5 consecutive rising audit counts).
- The user manually stops.

## Sprint report format

```
## Sprint {n} complete
Issues closed:    #X, #Y, #Z
Files changed:    {count}
Review findings:  {n} BREAKS fixed, {n} SECURITY fixed
New tickets:      #A, #B (discovered during work)
Skipped/blocked:  #C — reason
Remaining open:   {count}
Status:           Continuing to sprint {n+1}... / All issues done / Running audit...
```

After an audit cycle:

```
## Audit cycle {n}
Audit trend:    {prev counts} → {current} (healthy/warning)
New tickets:    #{first}–#{last} ({count})
Actionable:     {count} now
Blocked:        {count} need external deps
Status:         Continuing to sprint... / Codebase clean — autopilot complete / Escalation guard — stopping
```

## Rules

- **Orchestrator never writes feature code** — it coordinates agents and does only small integration glue (registries, imports, migration order, lint).
- **Strict file ownership** — no two implementers touch the same file in a sprint. If you can't partition cleanly, give the shared file to a single implementer.
- **Fresh agents per sprint** — never reuse agents across sprints. `shutdown_request` every agent as soon as it reports.
- **Inject the full Known Pitfalls into every spawn.**
- **Never** force-push, skip hooks, `git add -A` (stage by name; exclude secrets and `/tmp/flow-session/`), or write fake code to close a ticket.
- All issue/PM operations go through `pm_backend` — never hardcode `gh` when the backend is linear or local.
