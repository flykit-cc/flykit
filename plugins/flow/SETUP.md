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

## 3. (Optional) Enable strict file protection

`file-protection.sh` is on by default and blocks writes to env files, lockfiles, `.git/`, `node_modules/`, and `.claude/settings.local.json`. To customise, edit `${CLAUDE_PLUGIN_ROOT}/hooks/file-protection.sh` (or fork the plugin).

## 4. (Optional) Enable build-on-stop

`stop-check.sh` runs lint + typecheck before Claude returns control. To also run `build_cmd` on stop, create an empty marker:

```
touch .build-check
```

Remove it to disable. This is opt-in because builds are slow.

## 5. Verify

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
- `auto-lint` and `file-protection` need `jq` on PATH. Install it (`brew install jq`, `apt install jq`, etc.).
- Check Claude Code's hook logs for any non-zero exits.

### `.claude/config.md` is missing
- Re-run `/flow:init`. It is safe — existing files are preserved.
- If you deleted it on purpose: hooks fail open (silent no-op), so the plugin simply does nothing until config is back.

### `auto-lint` is too noisy or too slow
- Set `lint_cmd` and `format_cmd` to commands that target a single file efficiently.
- Or temporarily comment out the `PostToolUse` block in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json`.

### `stop-check` is blocking me from finishing
- Fix the lint/typecheck errors it reports — that's the point.
- For a one-off bypass: leave the session and return; the hook re-runs on the next stop only if files changed.
- If a check is fundamentally wrong for your project, set the relevant `*_cmd` to blank in `.claude/config.md`.

### `gh` / Linear errors from `issuer`
- `gh`: run `gh auth login` once. Confirm with `gh auth status`.
- Linear: ensure the Linear MCP is configured at the user or project level.

### `npm install` runs every time I invoke a script
- That means `node_modules` is being deleted between runs. Check that `${CLAUDE_PLUGIN_ROOT}` is stable across sessions and not on a tmpfs.
- `flow` itself has no runtime dependencies, so this is unlikely unless you fork and add deps.
