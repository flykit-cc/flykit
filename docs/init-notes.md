# `plugins/flow/scripts/init.js` — architecture notes

## Purpose

Bootstraps a project so the rest of the `/flow:*` commands work. It writes
`.flow/config.md` and (only when absent) `CLAUDE.md`, filling them from the
plugin's templates plus stack facts detected from files already on disk.

Two rules shape the whole file: it is **idempotent** (nothing existing is ever
overwritten, so `/flow:init` is safe to re-run) and it records **evidence only**
(a command or language is written only when a manifest on disk proves it;
otherwise the key comes back blank, never a `{PLACEHOLDER}`).

## Main components

| Group | Functions | Role |
| --- | --- | --- |
| CLI | `parseArgs`, `printHelp`, `main` | Flag parsing, validation against `VALID_WORKFLOW_MODES` / `VALID_PM_BACKENDS`, orchestration |
| Filesystem | `ensureDir`, `copyIfMissing`, `appendSection` | Create-if-missing primitives; `appendSection` guards on an HTML marker pair |
| Project detection | `detectProjectName`, `detectLanguageRuntime`, `detectFramework`, `readPkg` | Facts for the `CLAUDE.md` template |
| Stack detection | `detectStackCommands` + helpers (`pmPrefix`, `readRequirements`, `requires`, `venvBin`, `pyTool`, `pyRunner`, `readMakeTargets`) | Infer the six `STACK_CMD_KEYS` from package.json / pyproject / go.mod / Cargo.toml / Makefile |
| Templating | `applyStackCommands`, `applyPmFields`, `renderClaudeMdTemplate`, `stripTemplateOnly` | Substitute placeholders; drop `template-only` regions |
| Reporting | `report`, `readStackCommands`, `missingStackCommands`, `reportMissingStackCommands` | Per-step `+`/`·` lines and the closing to-do list |

## Control flow

```
main()
 ├─ parseArgs → --help? print & exit 0
 ├─ validate --workflow-mode / --pm-backend, check target exists  → exit 1 on error
 ├─ copyIfMissing(references/config-template.md → <target>/.flow/config.md)
 │    └─ if freshly created:
 │         detectStackCommands → applyStackCommands
 │                             → applyPmFields (CLI flags)
 │                             → stripTemplateOnly → write back
 ├─ CLAUDE.md: exists → leave strictly alone
 │              absent → render template (name/root/language/runtime/framework)
 │                       and appendSection(marker "flow")
 ├─ readPmBackend(config.md) === 'local' → ensureDir(<target>/issues/)
 └─ reportMissingStackCommands(config.md) → exit 0
```

Detection precedence inside `detectStackCommands`: package.json scripts, then
Python, Go, Rust, and Makefile targets **last** — a real manifest describes the
stack better than the `make` wrapper around it. A key is only filled if still
blank, so earlier sources win.

## Key dependencies

- `./lib/bootstrap` — supplies `pluginRoot`, ensuring the plugin's
  `node_modules` exist before anything is required.
- Node built-ins `fs` and `path` only; no third-party runtime deps.
- Templates `references/config-template.md` and `references/claude-md-template.md`.

## Fit within the plugin

`plugins/flow/commands/init.md` is the `/flow:init` command that drives this
script: it asks the user for `workflow_mode` and `pm_backend` (and the PM
identifiers), passes them as flags, then acts on the closing "stack commands
still blank" list by inferring and verifying those commands itself. The
resulting `.flow/config.md` is the config every other `/flow:*` command reads.
`scripts/uninstall.js` is the inverse operation; `scripts/init.test.js` covers
the exported surface — hence the wide `module.exports` at the bottom.

— 👾
