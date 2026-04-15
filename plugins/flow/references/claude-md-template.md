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

```
{PROJECT_ROOT}/
  src/                  application code
  tests/                test suites
  scripts/              one-off and CI scripts
  .claude/
    config.md           workflow + stack commands (read by /flow:*)
    settings.json       Claude Code settings, hooks, MCP servers
  CLAUDE.md             this file
```

Adjust to match the actual layout once it stabilizes.

## Commands

The exact commands live in `.claude/config.md`. Use those, not hardcoded scripts.

| What | Field in `.claude/config.md` |
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
| `/flow:init` | Bootstrap `.claude/config.md` and `CLAUDE.md` |
| `/flow:start` | Begin a session, pick an issue, route to agents |
| `/flow:continue` | Resume an interrupted session |
| `/flow:pause` | Save WIP and shut down agents cleanly |
| `/flow:push` | Run CI checks, close issues, commit, push |
| `/flow:audit` | Scan for smells, security holes, stale docs, dead code |
| `/flow:cleanup` | Run formatter and linter with auto-fix |
| `/flow:health` | Verify workflow setup |
| `/flow:deep-review` | Parallel reviewers + fix loop on the current diff |

## Agents

| Agent | Role |
|-------|------|
| investigator | Map relevant code; produce a fact sheet |
| architect | Turn investigation into a plan |
| coder | Execute the plan |
| reviewer | Classify findings: BREAKS / SECURITY / MINOR |
| scout | Wide-scope search across the codebase |
| issuer | Write a clean issue from a finding |
| websearch | Pull external docs and references |
| ci-check | Run lint / typecheck / build / test from `config.md` |

See the plugin's `references/agent-workflow.md` for how they hand off.

## Known Pitfalls

> Patterns this codebase has been bitten by. Reviewers and `/flow:audit` check against these.
> Append to this list whenever `/flow:deep-review` surfaces a recurring issue.

- (empty — fill in as the team learns)
