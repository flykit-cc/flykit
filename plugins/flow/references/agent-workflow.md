# Agent workflow

How the `flow` plugin's agents coordinate. Read this before changing how commands spawn agents.

## The orchestrator pattern

The main Claude Code session is the **orchestrator**. It does not write code. It reads context, picks the right agent for the current phase, hands off, and decides what to do with the result.

Agents do the work. Each agent is narrow: it has one job, one input file, one output file. This keeps token budgets predictable and makes failures localized.

If you find the main agent editing source files directly, something has gone wrong — push the work into a `coder` agent.

## The eight agents

| Agent | Input | Output | Owns |
|-------|-------|--------|------|
| investigator | issue or task description | `/tmp/flow-session/investigation.md` | reading code, mapping dependencies, listing relevant files |
| architect | investigation.md | `/tmp/flow-session/plan.md` | turning facts into a stepwise plan with file-level changes |
| coder | plan.md (or a finding list) | edits on disk | implementation, including small refactors needed to land cleanly |
| reviewer | a diff + file list | `/tmp/flow-session/review-<bucket>.md` | classifying findings as BREAKS / SECURITY / MINOR |
| scout | a search query | `/tmp/flow-session/scout.md` | wide-scope codebase search when the investigator's scope is too narrow |
| issuer | a finding | issue created on the configured PM backend | writing clean, well-scoped tickets |
| websearch | a question | `/tmp/flow-session/websearch.md` | external docs, library references, RFCs |
| ci-check | config.md commands | exit code + stdout/stderr summary | running lint, typecheck, build, test |

## Handoff via files

Agents communicate through files in `/tmp/flow-session/`. Never via in-memory state.

Why files: agents are spawned as separate `Agent` tool calls. The orchestrator is the only thing that persists between phases. Files are the lowest-friction handoff that survives an agent finishing.

Convention:

- One file per phase
- Markdown with a clear top-level structure (each agent's prompt enforces it)
- The orchestrator is responsible for cleaning up `/tmp/flow-session/` at session boundaries (`/flow:start` clears it, `/flow:push` clears it after success)

## Deterministic helper layer

Commands push their *mechanics* into shell helpers under `${CLAUDE_PLUGIN_ROOT}/scripts/` so the LLM only narrates and decides. Each helper is a black-box CLI with subcommands that print results to stdout — no tokens spent on git plumbing.

- `pause-helpers.sh` — `changed-files`, `diff-since-pause`, `write-marker`/`read-marker`, `log-block`, `trim-or-delete-progress`, `drift-check`, `save-memory`, `finish`. Used by `/flow:pause`.
- `continue-helpers.sh` — `check-progress`, `progress-age-days`, `last-log-titles`, `dev-server-state`, `deps-ok`. Used by `/flow:continue`.
- `lib.sh` — sourced by the helpers *and* the hooks; the single place that parses `.claude/config.md` (`flow_extract`, `flow_secret_globs`, `flow_dev_port`, `flow_memory_path`, …). Everything stack-specific is read here, never hardcoded.

These helpers also touch a few machine-local state files (all under the project, all gitignore-worthy): `session-log.md` (append-only dated blocks), `.claude/state/last-pause` (the pause marker), `.claude/.stop-check.log` (background lint output), and `.build-check` (the one-shot build-gate marker armed by `/flow:push`).

## Shutdown protocol

Long-running agents (typically `coder` in a multi-file change) are shut down two ways, used together:

1. The orchestrator sends `shutdown_request` via `SendMessage` to a named running agent the moment it reports — this is how `/flow:autopilot` keeps the team lean.
2. As a fallback for agents that poll the filesystem, the orchestrator writes `/tmp/flow-session/shutdown_request`. A polling agent then finishes the current edit (no half-written files), flushes its handoff file, and exits cleanly.

`/flow:pause` and `/flow:push` create the shutdown_request file and wait up to 30 seconds before proceeding. This is best-effort — agents that don't poll will simply finish at their own pace.

> Note for autopilot: do NOT use `TeamCreate` / `TeamDelete` / `TaskCreate` / `TaskUpdate` to manage agents. They write to `~/.claude/` and reset `bypassPermissions`, which breaks `mode: "auto"` autonomy. Spawn agents directly with the `Agent` tool and shut them down with `SendMessage`.

## File ownership for parallel coders

In Agent Team mode, multiple `coder` agents run in parallel. The hard rule: **each coder owns a disjoint set of files**.

The orchestrator partitions the planned changes by file and assigns each set to one coder. No two coders may write the same file. If the plan can't be partitioned this way (e.g. a single large file needs many changes), fall back to a single coder for that file.

This rule replaces the need for any locking or merge logic. If two coders want to edit the same file, the partition was wrong — re-plan.

## Errors and retries

Agents report failure by writing an `error:` block at the top of their handoff file. The orchestrator reads this and decides:

- Recoverable (e.g. flaky test): retry the same agent once
- Unrecoverable (e.g. missing dependency): surface to the user via `AskUserQuestion`

Do not retry more than twice. Two failures from the same agent on the same input usually means the input is wrong, not the agent.
