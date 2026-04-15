---
description: Bootstrap a new project with .claude/config.md and CLAUDE.md tailored to your stack.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---
# /flow:init

Bootstrap a project so the rest of `/flow:*` works. You write two files into the user's project: `.claude/config.md` (machine-read settings) and `CLAUDE.md` (instructions for Claude in this repo).

## Step 1: Read the templates

Read both templates from the plugin:

- `${CLAUDE_PLUGIN_ROOT}/references/config-template.md`
- `${CLAUDE_PLUGIN_ROOT}/references/claude-md-template.md`

## Step 2: Detect existing files

Check if `$CLAUDE_PROJECT_DIR/.claude/config.md` or `$CLAUDE_PROJECT_DIR/CLAUDE.md` already exist. If so, ask via `AskUserQuestion` whether to overwrite, merge, or skip each.

## Step 3: Ask the user

Use `AskUserQuestion` for each of the following. Take answers in one batch where possible.

1. **workflow_mode** — `solo` or `team` (team enables feature branches and PRs).
2. **pm_backend** — `github`, `linear`, or `local` (local stores issues as files in `issues/`).
3. If `github`: ask for `pm_github_owner` and `pm_github_repo` (default to parsing `git remote get-url origin`).
4. If `linear`: ask for `pm_linear_team` (the team key, e.g. `ENG`).
5. **dev_cmd** — command to start the dev server (e.g. the user's equivalent of a "run" script).
6. **lint_cmd** — linter (e.g. their lint script).
7. **typecheck_cmd** — type checker, or empty string if none.
8. **build_cmd** — production build.
9. **test_cmd** — test runner.
10. **format_cmd** — formatter with auto-fix.

Do not suggest specific tools. Let the user supply commands for their stack.

## Step 4: Write `.claude/config.md`

Substitute the answers into the template. Write to `$CLAUDE_PROJECT_DIR/.claude/config.md`. Create the `.claude/` directory if missing.

## Step 5: Write `CLAUDE.md`

Substitute project name (ask if needed; default to the basename of `$CLAUDE_PROJECT_DIR`) and the chosen commands into the CLAUDE.md template. Write to `$CLAUDE_PROJECT_DIR/CLAUDE.md`.

## Step 6: Backend bootstrapping

- If `pm_backend=local`: create `$CLAUDE_PROJECT_DIR/issues/` with a `.gitkeep` and a `README.md` explaining the format (one markdown file per issue, frontmatter with `status`, `priority`, `created`).
- If `pm_backend=github`: run `gh auth status` and warn if the user is not logged in.
- If `pm_backend=linear`: tell the user to install/configure the Linear MCP server in their `.claude/settings.json`.

## Step 7: Confirm

Print a short summary: which files were written, what was skipped, and recommend `/flow:health` as the next command.
