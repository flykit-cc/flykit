# flykit — Claude Code plugin marketplace

## What this repo is

An open-source marketplace of Claude Code plugins. Users install plugins via:

```
/plugin marketplace add flykit-cc/flykit
/plugin install steuer@flykit
```

The `@flykit` suffix comes from `.claude-plugin/marketplace.json` → `name: "flykit"`. Skills become `/steuer:<skill-name>`.

## Structure

```
.claude-plugin/marketplace.json     catalog listing all plugins
plugins/
  steuer/                           first plugin (German freelancer tax filing)
    .claude-plugin/plugin.json      plugin manifest
    skills/<name>/SKILL.md          user-invoked slash commands
    scripts/                        Node.js helpers, called via ${CLAUDE_PLUGIN_ROOT}/scripts/...
      sources/                      bank-agnostic transaction source interface
    references/                     markdown docs loaded on-demand (progressive disclosure)
.github/workflows/notify-web.yml    on push, pings flykit-web Vercel deploy hook
SETUP.md                            one-time setup checklist (org, repos, secrets, DNS)
```

## Key architectural decisions

- **Skills are namespaced** — `/steuer:parse-statements`, not `/parse-statements`. Namespace = plugin.json `name`.
- **Scripts are black-box CLIs** — SKILL.md calls `node ${CLAUDE_PLUGIN_ROOT}/scripts/x.js --year 2024`. Don't inline script logic in SKILL.md.
- **Transaction sources are pluggable** — `scripts/sources/` has a contract (see `sources/README.md`). Wise is first impl; CSV-import is a stub. Adding N26/Revolut = new file, not a rewrite.
- **Secrets via .env, prefs via ~/.config** — `WISE_API_TOKEN` from `process.env` (dotenv loads project `.env`). Non-secret prefs in `~/.config/flykit/steuer/config.json`. Never store secrets in user config.
- **Sanitized** — zero personal data. Use `[YOUR_X]` placeholders in docs and references.
- **CommonJS** — all scripts use `require`/`module.exports`.

## Companion repo

The public-facing website lives at **`github.com/flykit-cc/flykit-web`** (deploys to **flykit.cc**). Locally, most contributors keep it as a sibling folder.

It's a Next.js 15 app that:
- Reads this repo's `.claude-plugin/marketplace.json` + per-plugin `web.json` sidecars via GitHub raw URLs at build time (ISR, 1 hr)
- Fetches live star count from the GitHub REST API
- Renders one page per plugin from the merged data
- Rebuilds on push to this repo via a cross-repo `workflow_dispatch` trigger (see `.github/workflows/notify-web.yml`)

`web.json` lives at `plugins/<name>/web.json` and is kept separate from `plugin.json` so the Claude Code manifest schema stays clean. The site only reads `web.json`; Claude Code only reads `plugin.json` + `marketplace.json`.

**When you touch plugin metadata or READMEs here, the website auto-updates within ~1 min.** No manual sync.

## Status

- [x] Scaffolded: marketplace + steuer plugin ported + sanitized
- [x] Cross-repo deploy hook wired
- [ ] Not yet pushed to GitHub (see `SETUP.md`)
- [ ] Vercel project not yet created
- [ ] flykit.cc DNS not yet configured

## Conventions

- `.claude/` is gitignored — contributors' personal Claude Code setup doesn't belong in project state. This repo IS the sharing mechanism for skills/commands (via plugins).
- Attribution: handle is `kaiomp`, license is MIT.
