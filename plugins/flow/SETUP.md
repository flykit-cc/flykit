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

## 5. (Optional) Tune the pause-time verification prompt

Every `/flow:pause` invocation — including plain checkpoints, not just `land` — asks whether to run `build_cmd` + `test_cmd` before committing. This is a question asked at the moment a human is already deciding to pause, not something a background hook fires blindly.

By default (`stop_check: ask`), it prompts each time via `AskUserQuestion`, recommending **Run build + test** for `/flow:pause land` (you're about to ship) and **Skip** for a plain `/flow:pause`/`/flow:pause local` (a checkpoint isn't a ship). Answering "Always run (save to config)" writes `stop_check: always` so it never asks again.

You can set this ahead of time in `.claude/config.md`:

```
stop_check: always   # run build_cmd + test_cmd every pause, no prompt
stop_check: never    # never run them, no prompt
stop_check: ask       # default — prompt each time
```

If verification runs and fails, `/flow:pause` reports the failure and asks whether to fix now or proceed anyway (a checkpoint may save broken WIP; `land` instead asks fix-now-or-abort, since it never ships on a failing build). Either way, the outcome — `passed` / `not run` / `failed (...)` — is written to `session-progress.md` as a `Verification:` line, and `/flow:continue` surfaces it on the next resume if it isn't `passed`.

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

### `gh` / Linear errors during issue filing or closing
- `gh`: run `gh auth login` once. Confirm with `gh auth status`.
- Linear: ensure the Linear MCP is configured at the user or project level.

### `npm install` runs every time I invoke a script
- That means `node_modules` is being deleted between runs. Check that `${CLAUDE_PLUGIN_ROOT}` is stable across sessions and not on a tmpfs.
- `flow` itself has no runtime dependencies, so this is unlikely unless you fork and add deps.
