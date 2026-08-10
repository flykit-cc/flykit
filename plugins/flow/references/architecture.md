# Architecture: how the plugin and your project layer together

The `flow` plugin is a **workflow backbone**. It does not know your stack. Your project's `.flow/` directory tells it everything stack-specific.

## The two layers

```
~/.claude/plugins/flow/             (the plugin — this repo)
  commands/                          slash commands (/flow:*)
  agents/                            agent definitions
  hooks/                             optional lifecycle hooks
  references/                        docs loaded on demand
  scripts/                           helper scripts called via ${CLAUDE_PLUGIN_ROOT}

<your-project>/.flow/                (written by /flow:init, removed by /flow:uninstall)
  config.md                          workflow + stack commands — SHAREABLE, commit it
  local.md                           machine-local overrides — private, never committed
  session-progress.md                created by /flow:continue (cold start); settled on
                                     /flow:pause land — deleted when everything shipped,
                                     kept while tasks remain
  session-log.md                     dated session blocks, newest first (written by
                                     /flow:pause, all modes)
  state/last-pause                   pause marker (HEAD/branch/timestamp)
  .allow-*                           one-shot arming markers, never committed

<your-project>/
  CLAUDE.md                          yours. Seeded from the template only when absent;
                                     an existing one is never touched
  .claude/settings.json              Claude Code settings, hooks, MCP servers — flow
                                     does NOT manage this file
  issues/                            only when pm_backend = local
```

`.flow/config.md` is deliberately **shareable project truth**: commit it and collaborators get the same stack setup. Everything else under `.flow/` is session state or machine-local — the default `private_globs` keeps `local.md` and the arming markers out of commits. Durable cross-session memory lives outside the repo at `memory_path` (see config-template.md).

## Who owns what

**Plugin owns:**

- The set of commands (`/flow:init`, `/flow:continue`, etc.)
- The agent roster and how they hand off
- The templates for `config.md` and `CLAUDE.md`
- The handoff convention (`.flow/session/*.md`)

**Your project owns:**

- The actual values in `config.md` (which dev/lint/test commands to run)
- Whether to wire optional hooks and which
- Which MCP servers to configure
- The contents of `CLAUDE.md` (the template is a starting point, not the truth)
- The `Known Pitfalls` list — append-only, grown over time

The plugin reads from your project. Your project does not reach into the plugin. If you find yourself wanting to fork the plugin to change a command, first ask whether the change belongs in `config.md` or `settings.json` instead.

## Why `.flow/config.md` and not `.claude/settings.json`?

`settings.json` is owned by Claude Code itself — hooks, permissions, MCP servers, env vars. It has a strict schema.

`config.md` is owned by this plugin and is intentionally markdown so:

- Humans edit it without worrying about JSON syntax
- It can carry inline comments and explanations
- Values are descriptive (commands like `npm run build`) where JSON would feel cramped

Two files, two owners, no schema collision.

## Why `CLAUDE.md` lives at the project root

Claude Code reads `CLAUDE.md` from the project root automatically on every session. Putting it under `.claude/` would hide it. Some projects also keep a top-level `README.md` for humans and a `CLAUDE.md` for the AI — that's fine; they serve different audiences.

## Updating the plugin

Plugin updates ship via the marketplace. Your project's `.flow/config.md` and `CLAUDE.md` are unaffected — they are yours, and `/flow:init` never overwrites a file that exists.

The flip side: because nothing is overwritten, **a template change in a plugin update does not reach a project that was already initialised**. Re-running `/flow:init` will report `already exists, skipping` and change nothing. To adopt a new template, run `/flow:uninstall` first (it asks before dropping session state), then `/flow:init` again — and expect to re-apply any hand edits to `config.md`.
