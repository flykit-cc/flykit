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

Hooks (auto-lint, stop-check, file-protection) read these values. Nothing is hardcoded — `flow` adapts to your stack.

## Hooks

| Hook                | When                       | What                                                 |
| ------------------- | -------------------------- | ---------------------------------------------------- |
| `session-context`   | UserPromptSubmit           | Surfaces branch + dirty file count + current goal.   |
| `auto-lint`         | PostToolUse (Write/Edit)   | Runs `format_cmd` + `lint_cmd` on the touched file.  |
| `file-protection`   | PreToolUse (Write/Edit)    | Blocks edits to env files, lockfiles, `.git/`, etc.  |
| `stop-check`        | Stop                       | Runs `lint_cmd` + `typecheck_cmd` before returning.  |

All hooks fail open when `.claude/config.md` is missing, so `flow` is safe to install even before you run `/flow:init`.

## Learn more

- [SETUP.md](./SETUP.md) — post-install walkthrough and troubleshooting.
- `references/` — deeper docs (loaded on demand by commands).

## License

MIT — see repo root.
