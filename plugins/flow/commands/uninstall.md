---
description: Remove the files /flow:init created, so you can start clean or re-init. Dry-run by default.
allowed-tools: Bash, Read
---
# /flow:uninstall

Removes flow's project files. Pair it with `/flow:init` to regenerate a stale config after a
plugin upgrade — `init` never overwrites what already exists, so removing first is the only
way to pick up template changes.

This does **not** uninstall the plugin itself. For that, use `/plugin uninstall flow@flykit`.

## Step 1: Show the plan

Always run this first. It changes nothing.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js" --target "$CLAUDE_PROJECT_DIR"
```

Print the plan as-is and let the user read it before doing anything.

## Step 2: Apply, once the user confirms

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js" --target "$CLAUDE_PROJECT_DIR" --yes
```

Add `--purge` only if the user explicitly asks to drop the session history as well.

## What it touches

| Path | What happens |
|---|---|
| `.flow/config.md`, `.flow/local.md`, `.flow/session-progress.md` | removed |
| `.flow/state/`, `.flow/.allow-*` | removed — arming markers are one-shot grants and must not survive |
| `.flow/session-log.md` | **kept** unless `--purge`; append-only history, the one file here that cannot be regenerated |
| `CLAUDE.md` | only the `<!-- flow:begin -->…<!-- flow:end -->` block is stripped; the rest is yours. The file is deleted only if flow created it and it holds nothing else |
| `issues/` | removed only when empty — issue files are never deleted |

It never touches `.claude/settings.json`. Flow does not manage that file, so if a hook there
is broken it is a leftover from an older flow version and has to be edited by hand.

## After

Re-running `/flow:init` rebuilds `.flow/config.md` from the current template with your stack
re-detected. Anything you had customised in the old config is gone — mention that before
applying if the config looks hand-edited.
