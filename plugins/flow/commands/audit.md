---
description: Scan the codebase for smells, security holes, stale docs, and dead code; file selected findings as issues.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:audit

Find problems that nobody opened a ticket for. This is proactive — run it monthly or before a milestone.

## Step 1: Load config

Read `$CLAUDE_PROJECT_DIR/.flow/config.md` and `$CLAUDE_PROJECT_DIR/CLAUDE.md`. Note the `pm_backend` and `known_pitfalls_path`.

## Step 2: Spawn Explore

Spawn the built-in `Explore` agent (breadth: "very thorough"). Brief it to scan for:

- Code smells (god objects, deep nesting, duplicated logic)
- Security holes (hardcoded secrets, unsafe deserialization, missing auth checks, SQL injection)
- Stale docs (CLAUDE.md or README claiming things that no longer exist)
- Dead code (unreferenced exports, unreachable branches, unused dependencies)
- Drift from documented patterns (violations of the project's known pitfalls list)

Output goes to `/tmp/flow-session/audit.md`, one finding per entry, each with: `title`, `severity` (High/Medium/Low), `path:line`, `evidence`, `suggested fix`.

## Step 3: Dedup against existing issues

Load currently open issues from the configured `pm_backend`. For each finding, check if the title or evidence overlaps an open issue. Drop duplicates.

## Step 4: Present findings

Show the user a table grouped by severity. Use `AskUserQuestion` to let them select which findings to file as issues (multi-select).

## Step 5: File issues

For each selected finding, write a clean issue body yourself — title (imperative, under ~70 chars), context, evidence (`path:line`), suggested fix, acceptance criteria — then create it on the configured `pm_backend`. Search first and skip if a similar open issue already exists.

- **github**: `gh issue create --title ... --body ... --label audit`
- **linear**: use Linear MCP create-issue
- **local**: write a new file in `$CLAUDE_PROJECT_DIR/issues/`

## Step 6: Summary

Print: total findings, filed, skipped (already tracked), dropped by user.
