# flow

A Claude Code plugin that turns ad-hoc coding sessions into a disciplined, multi-agent workflow: investigate, plan, implement, review, ship.

## Install

```
/plugin marketplace add flykit-cc/flykit
/plugin install flow@flykit
```

Then, inside any project:

```
/flow:init
```

This creates `.claude/config.md` (project-level config) and `CLAUDE.md` (project memory) from templates, plus an `issues/` directory for the local PM backend.

## Commands

| Command              | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `/flow:init`         | One-time setup. Drops config and memory templates into the project.     |
| `/flow:start`        | Begin a focused work session against a goal or issue.                   |
| `/flow:continue`     | Resume an in-progress session from `session-progress.md`.               |
| `/flow:pause`        | Snapshot current state to `session-progress.md` so you can stop safely. |
| `/flow:push`         | Stage, summarise, and push the session's changes.                       |
| `/flow:audit`        | Dry-run review: lint, typecheck, security pass without shipping.        |
| `/flow:cleanup`      | Tidy stray branches, stale session files, and `/tmp/flow-session/`.     |
| `/flow:health`       | Inspect the project's flow setup and report missing pieces.             |
| `/flow:deep-review`  | Spawn the reviewer agent with extra rigor on the working diff.          |
| `/flow:flawz`        | Pressure-test a plan/spec/design for real flaws before you act on it.   |
| `/flow:autopilot`    | Autonomous multi-sprint loop: agent team, deep-review, push, repeat.    |

## Agents

| Agent          | Model  | Role                                                                   |
| -------------- | ------ | ---------------------------------------------------------------------- |
| `investigator` | sonnet | Trace a problem to its root cause; produce an investigation report.    |
| `architect`    | opus   | Turn an investigation into a precise, ordered implementation plan.     |
| `coder`        | sonnet | Execute the plan exactly. No scope creep.                              |
| `reviewer`     | sonnet | Review the diff: BREAKS / SECURITY / MINOR. Plan-adherence check.      |
| `scout`        | haiku  | Cheap, fast code search. Returns precise file:line hits.               |
| `issuer`       | opus   | Create issues in GitHub / Linear / local. Gated on user approval.      |
| `websearch`    | sonnet | External research with cited sources.                                  |
| `ci-check`     | haiku  | Run lint + typecheck + build from config.md. Reports failures only.    |

Agents communicate through files in `/tmp/flow-session/` (e.g. `investigation.md`, `plan.md`). Each agent is spawned with no conversation history — its instructions are self-contained.

## How `config.md` works

`flow` reads project-specific settings from `$CLAUDE_PROJECT_DIR/.claude/config.md`. Fields:

| Field                  | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `workflow_mode`        | `solo` or `team`                                       |
| `pm_backend`           | `github`, `linear`, or `local`                         |
| `pm_github_owner`      | GitHub org/user (if `pm_backend: github`)              |
| `pm_github_repo`       | GitHub repo name                                       |
| `pm_linear_team`       | Linear team key (if `pm_backend: linear`)              |
| `dev_cmd`              | Project's dev/server command                           |
| `lint_cmd`             | Linter command                                         |
| `typecheck_cmd`        | Type-checker command                                   |
| `build_cmd`            | Build command                                          |
| `test_cmd`             | Test command                                           |
| `format_cmd`           | Formatter command                                      |
| `known_pitfalls_path`  | Path (relative to project root) to a pitfalls doc      |
| `dev_port`             | Dev server port (lets `/flow:continue` detect a running server) |
| `memory_path`          | Cross-session memory dir (`/flow:pause` auto-saves here) |
| `secret_globs`         | Space-separated globs for files the hooks must never read/write/commit |
| `reap_orphans`         | `true` to enable the orphan-subprocess reaper (default off) |
| `schema_glob` / `docs_glob` / `route_pattern` | Optional drift-check heuristics tuning |

Hooks and helper scripts read these values. Nothing is hardcoded — `flow` adapts to your stack. See `references/config-template.md` for the full annotated template.

### `config.md` is private by default

`.claude/config.md` is how the same globally-installed plugin adapts to each repo's stack, but flow's default `private_globs` includes `.claude`, so `/flow:pause` will not stage it. Treat it as personal machine setup: sync it outside git if you want it on your other machines.

If you deliberately want to share stack settings with collaborators, narrow `private_globs` and commit `config.md` yourself — see `SETUP.md`.

## Hooks

| Hook                | When                       | What                                                                  |
| ------------------- | -------------------------- | --------------------------------------------------------------------- |
| `session-context`   | UserPromptSubmit           | Surfaces branch + dirty file count + current goal.                    |
| `auto-lint`         | PostToolUse (Write/Edit)   | Runs `format_cmd` + `lint_cmd` on the touched file.                   |
| `post-bash-reap`    | PostToolUse (Bash)         | Opt-in (`reap_orphans: true`): reaps orphan subprocesses after Bash.  |
| `file-protection`   | PreToolUse (Write/Edit)    | Blocks writes to env files, lockfiles, `.git/`, and `secret_globs`.   |
| `secret-guard`      | PreToolUse (Read/Bash)     | Blocks reading secret files via the Read tool or shell `cat`/`grep`.  |
| `stop-check`        | Stop                       | Background lint/format by default; synchronous build/test gate only when `/flow:push` armed `.build-check`. |

Most hooks fail open when `.claude/config.md` is missing, so `flow` is safe to install even before you run `/flow:init` — `stop-check` exits immediately if the config file is absent. The Stop hook checks the `stop_hook_active` flag Claude Code passes in its input (not a file) as a recursion guard, so a self-continuing session never loops.

Gating expensive or destructive commands (deploys, `terraform apply`, `rm -rf`, ...) is handled by Claude Code's native `permissions.ask`, not a flow hook — see "Approval for costly or destructive commands" in `SETUP.md`.

The lifecycle commands push their mechanics into deterministic shell helpers under `scripts/` (`pause-helpers.sh`, `continue-helpers.sh`, sharing `lib.sh` for config parsing), so the LLM only narrates and decides. `/flow:pause` auto-saves cross-session memory (when `memory_path` is set) and runs a non-blocking doc `drift-check`. `/flow:push` ends a session through the same `finish` helper as `/flow:pause`: it writes the session's block to `session-log.md`, then deletes `session-progress.md` only when nothing is left in flight (open tasks keep the file, so the next session resumes them).

## Learn more

- [SETUP.md](./SETUP.md) — post-install walkthrough and troubleshooting.
- `references/` — deeper docs (loaded on demand by commands).

## License

MIT — see repo root.
