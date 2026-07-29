# {PROJECT_NAME}

## What This Is

> One paragraph: what this project does, who it's for, and why it exists. Replace this with your own.

## Stack

> Languages, frameworks, key libraries, runtime targets. Keep it short — link out for details.

- Language: {LANGUAGE}
- Framework: {FRAMEWORK}
- Runtime: {RUNTIME}
- Database: {DATABASE_OR_NONE}
- Deploy target: {DEPLOY_TARGET}

## Structure

> Map the directories that matter here — the ones a newcomer would guess wrong.
> Skip the obvious ones. Delete this section if the layout is self-evident.

```
{PROJECT_ROOT}/
  .flow/
    config.md           workflow + stack commands (read by /flow:*)
    local.md            machine-local overrides, never committed
  CLAUDE.md             this file
```

## Commands

The exact commands live in `.flow/config.md`. Use those, not hardcoded scripts.

| What | Field in `.flow/config.md` |
|------|------------------------------|
| Start dev | `dev_cmd` |
| Lint | `lint_cmd` |
| Typecheck | `typecheck_cmd` |
| Build | `build_cmd` |
| Test | `test_cmd` |
| Format | `format_cmd` |

If a command is missing, run `/flow:init` to set it.

## Key Patterns

> How this codebase prefers to do things. Add to this section as patterns emerge — each one saves a round of code review.

- (empty — fill in as you go)

## Coding Principles

- **Einstein** — make it as simple as possible, but no simpler.
- **DRY** — three uses, then extract. Two uses is a coincidence.
- **Boring is good** — prefer the well-known solution unless the problem is genuinely novel.
- **Comments explain why, not what** — if the code needs a comment to explain what it does, rewrite it.
- **Small functions, small files** — if it doesn't fit on one screen, split it.

## Slash Commands (provided by the `flow` plugin)

| Command | Purpose |
|---------|---------|
| `/flow:init` | Bootstrap `.flow/config.md` and `CLAUDE.md` |
| `/flow:uninstall` | Remove the files `/flow:init` created |
| `/flow:continue` | Resume the last session, or start a new one if none exists |
| `/flow:status` | Read-only "where am I / what's running / what next" |
| `/flow:pause` | Save WIP and shut down agents cleanly; `land` also closes issues, ships, and merges |
| `/flow:audit` | Scan for smells, security holes, stale docs, dead code |
| `/flow:cleanup` | Run formatter and linter with auto-fix |
| `/flow:health` | Verify workflow setup |
| `/flow:deep-review` | Parallel reviewers + fix loop on the current diff |
| `/flow:flawz` | Pressure-test a plan or design for real flaws before acting on it |
| `/flow:autopilot` | Autonomous multi-sprint loop: agent team, deep-review, ship, repeat |

## Agents

| Agent | Role |
|-------|------|
| reviewer | Classify findings: BREAKS / SECURITY / MINOR |

Other phases (investigation, planning, implementation, search) route through Claude Code's
built-in `Explore` and `general-purpose` agents, or the `superpowers:writing-plans` skill —
see the plugin's `references/agent-workflow.md`.

## Known Pitfalls

> Patterns this codebase has been bitten by. Reviewers and `/flow:audit` check against these.
> Append to this list whenever `/flow:deep-review` surfaces a recurring issue.

- (empty — fill in as the team learns)
