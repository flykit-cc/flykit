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

Init asks a few questions it can't infer (workflow mode, issue backend), detects your stack
commands from `package.json` / `go.mod` / `Cargo.toml` / `pyproject.toml`, and then runs
`/flow:health` to confirm the setup.

It creates, without overwriting anything that already exists:

- `.flow/config.md` — project settings, with your stack commands already filled in.
- `CLAUDE.md` — **only if you don't have one**. An existing CLAUDE.md is left strictly alone.
- `issues/` — only when `pm_backend: local`, the one backend that reads it.

Because nothing is overwritten, re-running init on an already-initialised project changes
nothing. To pick up template changes from a plugin update, run `/flow:uninstall` first (it
asks before dropping session state), then `/flow:init` again.

## 2. Check `.flow/config.md`

Init fills these in — from your manifest where there is one, otherwise inferred from the
repo and verified to run — so most projects only need a glance. A blank value means "skip
that step": nothing in the repo supported a command there.

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

## 3. Keep `.flow/config.md` out of version control

flow treats `.claude/` as **private by default** — see `private_globs` in your config. It
is your personal setup, not project truth, and `/flow:pause` will refuse to stage anything
matching `private_globs` so it cannot reach a remote by accident.

If you want the file to travel between your own machines, sync it outside git.

If you deliberately want to share stack settings with collaborators, narrow the default:

```
private_globs: .claude/settings.local.json docs/superpowers .flow
```

Then commit `.flow/config.md` yourself. flow will no longer block it.

## 4. (Optional) Enable strict file protection

`file-protection.sh` is on by default and blocks writes to env files, lockfiles, `.git/`, `node_modules/`, and `.claude/settings.local.json`. To customise, edit `${CLAUDE_PLUGIN_ROOT}/hooks/file-protection.sh` (or fork the plugin).

## 5. (Optional) Tune the pause-time verification prompt

Every `/flow:pause` invocation decides whether to run `build_cmd` + `test_cmd` before committing — but it never blocks the pause on a prompt, because pausing is often the moment you leave the computer.

By default (`stop_check: ask`), the agent decides from session context: if the suite already ran green this session and nothing changed since, that run is reused; a plain `/flow:pause`/`/flow:pause local` otherwise skips (recorded as `Verification: not run`, surfaced on the next `/flow:continue`); a `land` otherwise runs verification — shipping wants a fresh green stamp.

You can override this in `.flow/config.md`:

```
stop_check: always   # run build_cmd + test_cmd every pause
stop_check: never    # never run them
stop_check: ask      # default — agent decides from session context
```

If verification runs and fails, a plain pause saves anyway (a checkpoint may save broken WIP) and leads its report with the failure; `land` asks fix-now-or-abort, since it never ships on a failing build. Either way, the outcome — `passed` / `not run` / `failed (...)` — is written to `.flow/session-progress.md` as a `Verification:` line, and `/flow:continue` surfaces it on the next resume if it isn't `passed`.

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
- whether `.flow/config.md` is present and parseable,
- which commands are configured vs missing,
- whether the PM backend is reachable.

## Troubleshooting

### Hooks aren't firing
- Confirm the plugin is enabled: `/plugin list` should show `flow` as active.
- Hooks live at `${CLAUDE_PLUGIN_ROOT}/hooks/`. Check `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` is valid JSON.
- **All three hooks need `jq` on PATH** — `secret-guard` (blocks reading secret files), `file-protection` (blocks writing them), and `auto-lint`. Without `jq` every one of them exits 0 immediately and does nothing, silently: you are not protected and nothing says so. Install it (`brew install jq`, `apt install jq`, etc.) and confirm with `/flow:health`, which reports a missing `jq` as a failure.
- Check Claude Code's hook logs for any non-zero exits.

### `.flow/config.md` is missing
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
