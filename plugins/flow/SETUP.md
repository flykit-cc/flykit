# flow — Setup

This is the post-install walkthrough. It assumes you have already run:

```
/plugin install flow@flykit
```

## 1. Initialise your project

From inside the project you want flow to manage:

```
/flow:init
```

This creates (without overwriting anything that already exists):

- `.claude/config.md` — project-specific settings flow reads from.
- `CLAUDE.md` — project memory loaded into every Claude Code session.
- `issues/` — local issue store (only used if `pm_backend: local`).

If a file already exists, init prints `already exists, skipping` and moves on.

## 2. Fill in `.claude/config.md`

Open `.claude/config.md` and replace the placeholders. Minimum useful set:

```
workflow_mode: solo
pm_backend: local

dev_cmd:        <your dev server command>
lint_cmd:       <your linter, e.g. eslint .>
typecheck_cmd:  <your type checker>
build_cmd:      <your build command>
test_cmd:       <your test command>
format_cmd:     <your formatter, e.g. prettier --write>
```

Leave a field blank if it does not apply to your project — hooks will skip it.

If you use GitHub Issues:

```
pm_backend: github
pm_github_owner: <your-org-or-user>
pm_github_repo:  <repo-name>
```

If you use Linear:

```
pm_backend: linear
pm_linear_team: <TEAM_KEY>
```

(Linear support requires the Linear MCP to be configured separately.)

## 3. Keep `.claude/config.md` out of version control

flow treats `.claude/` as **private by default** — see `private_globs` in your config. It
is your personal setup, not project truth, and `/flow:pause` will refuse to stage anything
matching `private_globs` so it cannot reach a remote by accident.

If you want the file to travel between your own machines, sync it outside git.

If you deliberately want to share stack settings with collaborators, narrow the default:

```
private_globs: .claude/settings.local.json docs/superpowers .flow
```

Then commit `.claude/config.md` yourself. flow will no longer block it.

## 4. (Optional) Enable strict file protection

`file-protection.sh` is on by default and blocks writes to env files, lockfiles, `.git/`, `node_modules/`, and `.claude/settings.local.json`. To customise, edit `${CLAUDE_PLUGIN_ROOT}/hooks/file-protection.sh` (or fork the plugin).

## 5. (Optional) Enable the build/test gate on stop

By default (`stop_check: lint`), the Stop hook only runs `lint_cmd` + `format_cmd`, in the background, and never blocks — it just appends to `.claude/.stop-check.log`.

To also get a blocking `build_cmd` + `test_cmd` gate, set in `.claude/config.md`:

```
stop_check: lint+build
```

With this set, `/flow:pause land` arms a one-shot marker (`.build-check`) each time it runs; the next Stop event consumes it, runs build + test synchronously, and blocks on failure. You never touch `.build-check` yourself — `/flow:pause land` creates it, and the hook always removes it after one check, whether or not the gate is armed. Leaving `stop_check` at `lint` (or setting it to `off`) means `/flow:pause land` never arms the marker, so build/test never run — a stale `.build-check` from an old flow version is deleted unused rather than firing.

## 6. Approval for costly or destructive commands

flow doesn't gate these itself — use Claude Code's native `permissions.ask` in `.claude/settings.local.json`. It prompts you before a matching command runs and remembers your answer (moves it into `permissions.allow`), so you're only asked once. Two categories worth covering: commands that **cost money** outside your Claude subscription (CI minutes, cloud builds, deploys, metered compute), and commands that **destroy work irreversibly** (hard resets, force-cleans, blanket staging, recursive deletes).

```json
{
  "permissions": {
    "ask": [
      "Bash(fly deploy:*)",
      "Bash(flyctl deploy:*)",
      "Bash(vercel deploy:*)",
      "Bash(terraform apply:*)",
      "Bash(gh workflow run:*)",
      "Bash(aws ec2 run-instances:*)",
      "Bash(docker push:*)",
      "Bash(electron-builder:*)",
      "Bash(git reset --hard:*)",
      "Bash(git checkout --force:*)",
      "Bash(git clean -f:*)",
      "Bash(git add -A:*)",
      "Bash(git add .:*)",
      "Bash(rm -rf:*)"
    ]
  }
}
```

Add your own project's expensive or destructive commands (e.g. a slow native build) to the list. Note: flow's own `/flow:pause` (all modes, including `land`) is unaffected either way — `pause-helpers.sh` stages files individually by name (never `git add -A`) and aborts if anything matching `private_globs` is staged, so private files reaching a remote was never this hook's job to prevent.

## 7. Verify

Run a quick health check:

```
/flow:health
```

It reports:
- whether `.claude/config.md` is present and parseable,
- which commands are configured vs missing,
- whether the PM backend is reachable.

## Troubleshooting

### Hooks aren't firing
- Confirm the plugin is enabled: `/plugin list` should show `flow` as active.
- Hooks live at `${CLAUDE_PLUGIN_ROOT}/hooks/`. Check `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` is valid JSON.
- `auto-lint` and `file-protection` need `jq` on PATH. Install it (`brew install jq`, `apt install jq`, etc.). Without it, the hook fails open — it will not block anything.
- Check Claude Code's hook logs for any non-zero exits.

### `.claude/config.md` is missing
- Re-run `/flow:init`. It is safe — existing files are preserved.
- If you deleted it on purpose: hooks fail open (silent no-op), so the plugin simply does nothing until config is back.

### `auto-lint` is too noisy or too slow
- Set `lint_cmd` and `format_cmd` to commands that target a single file efficiently.
- Or temporarily comment out the `PostToolUse` block in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json`.

### `stop-check` is blocking me from finishing
- `lint_cmd`/`format_cmd` run in the background and never block — if you're blocked, it's the build/test gate, which only runs when `stop_check: lint+build` and only right after `/flow:pause land` armed it.
- Fix the `build_cmd`/`test_cmd` failures it reports — that's the point.
- The gate is one-shot: it already consumed its marker, so simply stopping again won't re-trigger it. It only fires again after the next `/flow:pause land`.
- If a check is fundamentally wrong for your project, set the relevant `*_cmd` to blank in `.claude/config.md`, or drop `stop_check` back to `lint`.

### `gh` / Linear errors during issue filing or closing
- `gh`: run `gh auth login` once. Confirm with `gh auth status`.
- Linear: ensure the Linear MCP is configured at the user or project level.

### `npm install` runs every time I invoke a script
- That means `node_modules` is being deleted between runs. Check that `${CLAUDE_PLUGIN_ROOT}` is stable across sessions and not on a tmpfs.
- `flow` itself has no runtime dependencies, so this is unlikely unless you fork and add deps.
