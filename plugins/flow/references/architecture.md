# Architecture: how the plugin and your project layer together

The `flow` plugin is a **workflow backbone**. It does not know your stack. Your project's `.claude/` directory tells it everything stack-specific.

## The two layers

```
~/.claude/plugins/flow/             (the plugin — this repo)
  commands/                          slash commands (/flow:*)
  agents/                            agent definitions
  hooks/                             optional lifecycle hooks
  references/                        docs loaded on demand
  scripts/                           helper scripts called via ${CLAUDE_PLUGIN_ROOT}

<your-project>/.claude/              (your project — written by /flow:init)
  config.md                          workflow + stack commands
  settings.json                      Claude Code settings, hook overrides, MCP servers
  CLAUDE.md  (lives at project root) instructions to Claude in this repo

<your-project>/                      (your project's own state)
  CLAUDE.md                          project instructions (template-seeded, then grows)
  session-progress.md                created by /flow:start, removed by /flow:push (solo)
  issues/                            only when pm_backend = local
```

## Who owns what

**Plugin owns:**

- The set of commands (`/flow:init`, `/flow:start`, etc.)
- The agent roster and how they hand off
- The templates for `config.md` and `CLAUDE.md`
- The handoff convention (`/tmp/flow-session/*.md`)

**Your project owns:**

- The actual values in `config.md` (which dev/lint/test commands to run)
- Whether to wire optional hooks and which
- Which MCP servers to configure
- The contents of `CLAUDE.md` (the template is a starting point, not the truth)
- The `Known Pitfalls` list — append-only, grown over time

The plugin reads from your project. Your project does not reach into the plugin. If you find yourself wanting to fork the plugin to change a command, first ask whether the change belongs in `config.md` or `settings.json` instead.

## Why `.claude/config.md` and not `.claude/settings.json`?

`settings.json` is owned by Claude Code itself — hooks, permissions, MCP servers, env vars. It has a strict schema.

`config.md` is owned by this plugin and is intentionally markdown so:

- Humans edit it without worrying about JSON syntax
- It can carry inline comments and explanations
- Values are descriptive (commands like `npm run build`) where JSON would feel cramped

Two files, two owners, no schema collision.

## Why `CLAUDE.md` lives at the project root

Claude Code reads `CLAUDE.md` from the project root automatically on every session. Putting it under `.claude/` would hide it. Some projects also keep a top-level `README.md` for humans and a `CLAUDE.md` for the AI — that's fine; they serve different audiences.

## Updating the plugin

Plugin updates ship via the marketplace. Your project's `.claude/config.md` and `CLAUDE.md` are unaffected — they are yours. If a plugin update changes the template, `/flow:init` will offer to merge or skip when you re-run it; it never silently overwrites.
