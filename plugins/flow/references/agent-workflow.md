# Agent workflow

How the `flow` plugin's agents coordinate. Read this before changing how commands spawn agents.

## The orchestrator pattern

The main Claude Code session is the **orchestrator**. It does not write code. It reads context, picks the right agent for the current phase, hands off, and decides what to do with the result.

Agents do the work. Each agent is narrow: it has one job, one input file, one output file. This keeps token budgets predictable and makes failures localized.

If you find the main agent editing source files directly, something has gone wrong — push the work into a `general-purpose` agent.

## The agent roster

`flow` ships exactly one custom agent — `reviewer` — plus the built-in agents and skills that
ship with Claude Code. Prefer the built-ins; only a custom agent definition is worth the
maintenance cost, and `reviewer`'s domain-specific checklist (BREAKS/SECURITY/MINOR, plan
adherence) earns its keep.

| Agent / skill | Input | Output | Owns |
|-------|-------|--------|------|
| `Explore` (built-in) | issue or task description, or a search query | inline report | reading code, mapping dependencies, locating symbols/patterns |
| `superpowers:writing-plans` (skill) | an investigation / requirements | a written plan | turning facts into a stepwise plan with file-level changes |
| `general-purpose` (built-in) | a plan (or a finding list) | edits on disk | implementation, including small refactors needed to land cleanly |
| `reviewer` (flow) | a diff + file list | `/tmp/flow-session/review-<bucket>.md` | classifying findings as BREAKS / SECURITY / MINOR |
| `WebSearch` (built-in tool) | a question | inline synthesis | external docs, library references, RFCs |

CI checks (lint/typecheck/build/test) and issue filing are no longer separate agents — they're
inline steps in the commands that need them (`/flow:pause land`, `/flow:audit`), reading the
commands straight from `config.md`.

## Handoff via files

Agents communicate through files in `/tmp/flow-session/`. Never via in-memory state.

Why files: agents are spawned as separate `Agent` tool calls. The orchestrator is the only thing that persists between phases. Files are the lowest-friction handoff that survives an agent finishing.

Convention:

- One file per phase
- Markdown with a clear top-level structure (each agent's prompt enforces it)
- The orchestrator is responsible for cleaning up `/tmp/flow-session/` at session boundaries (a cold `/flow:continue` clears it, `/flow:pause land` clears it after success)

## Deterministic helper layer

Commands push their *mechanics* into shell helpers under `${CLAUDE_PLUGIN_ROOT}/scripts/` so the LLM only narrates and decides. Each helper is a black-box CLI with subcommands that print results to stdout — no tokens spent on git plumbing.

- `pause-helpers.sh` — `changed-files`, `diff-since-pause`, `write-marker`/`read-marker`, `log-block`, `trim-or-delete-progress`, `drift-check`, `save-memory`, `finish`. Used by `/flow:pause` (all modes, including `land`).
- `continue-helpers.sh` — `check-progress`, `progress-age-days`, `last-log-titles`, `dev-server-state`, `deps-ok`. Used by `/flow:continue`.
- `lib.sh` — sourced by the helpers *and* the hooks; the single place that parses `.flow/config.md` (`flow_extract`, `flow_secret_globs`, `flow_dev_port`, `flow_memory_path`, …). Everything stack-specific is read here, never hardcoded.

These helpers also touch a few session-state files, all under `.flow/`: `session-log.md` (append-only dated blocks) and `state/last-pause` (the pause marker).

## Shutdown protocol

Long-running agents (typically `general-purpose` in a multi-file change) are shut down two ways, used together:

1. The orchestrator sends `shutdown_request` via `SendMessage` to a named running agent the moment it reports — this is how `/flow:autopilot` keeps the team lean.
2. As a fallback for agents that poll the filesystem, the orchestrator writes `/tmp/flow-session/shutdown_request`. A polling agent then finishes the current edit (no half-written files), flushes its handoff file, and exits cleanly.

`/flow:pause` (all modes) creates the shutdown_request file and waits up to 30 seconds before proceeding. This is best-effort — agents that don't poll will simply finish at their own pace.

> Note for autopilot: do NOT use `TeamCreate` / `TeamDelete` / `TaskCreate` / `TaskUpdate` to manage agents. They write to `~/.claude/` and reset `bypassPermissions`, which breaks `mode: "auto"` autonomy. Spawn agents directly with the `Agent` tool and shut them down with `SendMessage`.

## File ownership for parallel implementers

In Agent Team mode (and in `/flow:autopilot`), multiple `general-purpose` agents run in parallel. The hard rule: **each one owns a disjoint set of files**.

The orchestrator partitions the planned changes by file and assigns each set to one agent. No two agents may write the same file. If the plan can't be partitioned this way (e.g. a single large file needs many changes), fall back to a single agent for that file.

This rule replaces the need for any locking or merge logic. If two agents want to edit the same file, the partition was wrong — re-plan.

## Errors and retries

Agents report failure by writing an `error:` block at the top of their handoff file. The orchestrator reads this and decides:

- Recoverable (e.g. flaky test): retry the same agent once
- Unrecoverable (e.g. missing dependency): surface to the user via `AskUserQuestion`

Do not retry more than twice. Two failures from the same agent on the same input usually means the input is wrong, not the agent.

## Questions raised (mandatory report section)

Subagents can never reach the user: no dialogs, no prompts. Every agent
prompt you dispatch must instruct: "If you hit a decision only the user can
make, do NOT guess silently and do NOT try to ask — put it in a final
`## Questions raised` section (empty section if none) and, where possible,
proceed on the most reversible assumption, marking it." On receipt, the main
loop files each raised question into `.flow/questions.md` (status backlog by
default) per `references/question-protocol.md`, then presents per queue rules.
