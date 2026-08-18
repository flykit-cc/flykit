---
description: Remove the files /flow:init created, so you can start clean or re-init. Dry-run by default.
allowed-tools: Bash, Read, AskUserQuestion
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

## Step 2: Ask about the two files that cannot be regenerated

Everything else here is rebuilt by `/flow:init`. These two are not, so ask with
`AskUserQuestion` rather than deciding for the user — batch both into one call.

Only ask about a file that the Step 1 plan actually listed. Skip the question entirely when
the file doesn't exist.

1. **`.flow/session-progress.md`** — the live thread of whatever they were working on.
   - *Delete it* — starting fresh, the saved session is finished or stale
   - *Keep it (recommended if a session is open)* — passes `--keep-progress`

   If the plan shows the file exists, read its `## Goal` line first and quote it in the
   question, so the choice is about real work rather than an abstract filename.

2. **`.flow/session-log.md`** — append-only history of every past session.
   - *Keep it (recommended)* — the default; it is the one file here with no way back
   - *Delete it too* — passes `--purge`, which removes `session-log.md` **and** `questions.md`

## Step 3: Apply

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js" --target "$CLAUDE_PROJECT_DIR" --yes \
  [--keep-progress] [--purge]
```

Pass only the flags the answers call for.

## What it touches

| Path | What happens |
|---|---|
| `.flow/config.md`, `.flow/local.md` | removed — `/flow:init` rebuilds both |
| `.flow/session-progress.md` | removed unless `--keep-progress`; **always ask first** |
| `.flow/state/`, `.flow/.allow-*` | removed — arming markers are one-shot grants and must not survive |
| `.flow/session-log.md` | **kept** unless `--purge`; append-only history, the one file here that cannot be regenerated |
| `.flow/questions.md` | **kept** unless `--purge`; answered decisions and their rationale, equally unregenerable |
| `CLAUDE.md` | only the `<!-- flow:begin -->…<!-- flow:end -->` block is stripped; the rest is yours. The file is deleted only if flow created it and it holds nothing else |
| `issues/` | removed only when empty — issue files are never deleted |

It never touches `.claude/settings.json`. Flow does not manage that file, so if a hook there
is broken it is a leftover from an older flow version and has to be edited by hand.

## After

Re-running `/flow:init` rebuilds `.flow/config.md` from the current template with your stack
re-detected. Anything you had customised in the old config is gone — mention that before
applying if the config looks hand-edited.
