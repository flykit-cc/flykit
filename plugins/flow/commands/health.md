---
description: Verify your workflow setup — config, hooks, required commands, PM backend connectivity.
allowed-tools: Bash, Read, Glob, Grep
---
# /flow:health

Sanity check. Run this after `/flow:init` and any time `/flow:*` commands feel broken.

## Checks

Run each check and collect the result. Print a table at the end.

### 1. Config file

- Does `$CLAUDE_PROJECT_DIR/.claude/config.md` exist?
- Does it parse? (frontmatter or key:value lines as defined in the template)
- Are required fields present: `workflow_mode`, `pm_backend`, `dev_cmd`, `lint_cmd`, `build_cmd`, `test_cmd`?

### 2. CLAUDE.md freshness

- Does `$CLAUDE_PROJECT_DIR/CLAUDE.md` exist?
- Last modified more than 90 days ago? Flag as stale.
- Does it reference commands or paths that no longer exist? Spot-check the Stack and Structure sections.

### 3. Hook wiring

- Does `$CLAUDE_PROJECT_DIR/.claude/settings.json` exist?
- Are the flow plugin's hooks (if any) present in its `hooks` array?
- Print the list of currently wired hooks.

### 4. Required commands

For each non-empty `*_cmd` in config.md, take the first token and check it is on `PATH` (`command -v <token>`). Report missing.

### 5. PM backend connectivity

- **github**: `gh auth status` — pass if logged in
- **linear**: check that a Linear MCP server is configured in `.claude/settings.json`
- **local**: check that `$CLAUDE_PROJECT_DIR/issues/` exists and is readable

### 6. Git state

- Is the repo a git repo? (`git rev-parse --is-inside-work-tree`)
- Is there an `origin` remote?
- Are there uncommitted changes? (informational only)

## Output

Print a table:

```
CHECK                          STATUS    NOTE
config.md                      OK
CLAUDE.md freshness            STALE     last touched 124 days ago
hooks                          OK        2 wired
commands on PATH               FAIL      `<missing>` not found
pm backend                     OK
git                            OK
```

End with a one-line summary: `N/M checks passed`. If anything failed, point at the fix (`/flow:init`, install missing tool, etc.).
