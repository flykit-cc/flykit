---
description: Run format and lint with auto-fix; report what remains.
allowed-tools: Bash, Read, Grep
---
# /flow:cleanup

Mechanical cleanup. No agents, no decisions — just run the configured tools.

## Step 1: Load config

Read `$CLAUDE_PROJECT_DIR/.claude/config.md`. Capture `format_cmd` and `lint_cmd`. If either is empty, skip that step.

## Step 2: Run formatter

Run `format_cmd` exactly as configured. Capture stdout and stderr. Most formatters write in place — that is fine, do not commit.

## Step 3: Run linter with auto-fix

Run `lint_cmd` as configured. If the project's linter supports an auto-fix flag and the configured command does not include it, ask the user whether to re-run with auto-fix. Do not assume a flag name.

## Step 4: Report

Print:

- Files changed by the formatter (use `git diff --stat`)
- Lint errors remaining (count + first ~20 with file:line)
- Lint warnings remaining (count only)

## Step 5: Suggest next step

If errors remain, suggest `/flow:start` to fix them as a small task, or just spawn a `coder` agent inline if the user agrees.

Do not commit. Do not push.
