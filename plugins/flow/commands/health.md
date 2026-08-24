---
description: Verify your workflow setup — config, hooks, required commands, PM backend connectivity.
allowed-tools: Bash, Read, Edit, Glob, Grep
---
# /flow:health

Sanity check. Run this after `/flow:init` and any time `/flow:*` commands feel broken.

Diagnostic, not a repair tool: report what is wrong and where the fix is, and change nothing —
with one exception, a blank `*_cmd` in config.md, which you fill in yourself (Check 1).

## Checks

Run each check and collect the result. Print a table at the end.

### 1. Config file

- Does `$CLAUDE_PROJECT_DIR/.flow/config.md` exist?
- Does it parse? (frontmatter or key:value lines as defined in the template)
- Are required fields present: `workflow_mode`, `pm_backend`, `dev_cmd`, `lint_cmd`, `build_cmd`, `test_cmd`?

A `*_cmd` key that is present but **blank** is your work, not the user's. Do not report it as
"fill this in yourself" — that is exactly the chore `/flow:init` Step 3 exists to remove.
Infer it from the repo, verify it runs, and write it in, following
`${CLAUDE_PLUGIN_ROOT}/references/stack-command-inference.md`. Report it as `FIXED` with the
command you wrote. Only a key you inferred and could *not* verify — or one with genuinely
conflicting evidence — is worth raising with the user, and then with a recommendation, not an
open question. A key that is blank because the project has no such step is `OK`, not a
finding; say so in the note.

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

Also check `jq` specifically — it is not a `*_cmd`, so the loop above misses it:

```bash
command -v jq >/dev/null 2>&1 && echo "jq: ok" || echo "jq: MISSING"
```

If it is missing, report it as a **failure, not a warning**, and say plainly what it costs: all three hooks (`secret-guard`, `file-protection`, `auto-lint`) exit early without it, so secret-read blocking, write protection, and auto-lint are **silently disabled**. Nothing else in flow surfaces this — a user would otherwise believe they are protected when they are not. Fix: `brew install jq` / `apt install jq`.

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
config.md                      FIXED     test_cmd was blank -> .venv/bin/pytest (23 passed)
CLAUDE.md freshness            STALE     last touched 124 days ago
hooks                          OK        2 wired
commands on PATH               FAIL      `<missing>` not found
pm backend                     OK
git                            OK
```

End with a one-line summary: `N/M checks passed`. If anything failed, point at the fix (`/flow:init`, install missing tool, etc.) — and where the fix is something you can do, such as a blank `*_cmd`, do it rather than prescribe it.
