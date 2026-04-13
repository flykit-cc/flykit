# Contributing to flykit

Thanks for your interest in flykit! This guide covers how to add a new plugin, work on an existing one, develop locally, and submit changes.

## Plugin contents

A Claude Code plugin can bundle any mix of the following. flykit plugins typically lead with skills, but the other types are fair game.

- **Skills** (`skills/<name>/SKILL.md`) — user-invoked slash commands. Exposed as `/<plugin>:<skill>`. See https://docs.claude.com/en/docs/claude-code/skills
- **Slash commands** (`commands/<name>.md`) — lightweight prompt templates, no YAML body required. See https://docs.claude.com/en/docs/claude-code/slash-commands
- **Subagents** (`agents/<name>.md`) — specialized personas Claude can delegate to. See https://docs.claude.com/en/docs/claude-code/sub-agents
- **Hooks** (`hooks/hooks.json`) — shell commands that fire on lifecycle events (PreToolUse, PostToolUse, etc.). See https://docs.claude.com/en/docs/claude-code/hooks
- **MCP servers** (`.mcp.json` or referenced from `plugin.json`) — external tool servers over the Model Context Protocol. See https://docs.claude.com/en/docs/claude-code/mcp

For the full plugin manifest schema, see https://docs.claude.com/en/docs/claude-code/plugins.

## Repository layout

```
flykit/
├── .claude-plugin/
│   └── marketplace.json     # Marketplace manifest — lists every plugin
├── plugins/
│   └── <plugin-name>/       # One directory per plugin
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── skills/
│       ├── scripts/
│       ├── references/
│       └── README.md
├── README.md
├── CONTRIBUTING.md          # You are here
└── LICENSE
```

## Adding a new plugin

1. **Pick a name.** Lowercase, hyphen-separated, no `flykit-` prefix (the marketplace name supplies that context).

2. **Create the directory:**

   ```
   plugins/<your-plugin>/
   ├── .claude-plugin/plugin.json
   ├── skills/<skill-name>/SKILL.md
   ├── scripts/                       (if your plugin runs scripts)
   ├── references/                    (if your plugin has long reference docs)
   ├── README.md
   ├── web.json                       (display metadata for flykit.cc)
   └── LICENSE                        (MIT recommended)
   ```

3. **Write `plugin.json`** with `name`, `version`, `description`, `author`, `license`, and `keywords`. See `plugins/steuer/.claude-plugin/plugin.json` for an example.

4. **Add an entry** to `.claude-plugin/marketplace.json` under `plugins`:

   ```json
   {
     "name": "<your-plugin>",
     "description": "...",
     "source": "./plugins/<your-plugin>",
     "version": "0.1.0",
     "category": "...",
     "keywords": ["..."],
     "license": "MIT"
   }
   ```

5. **Write `web.json`** (alongside `plugin.json`'s directory, at the plugin root). This is what [flykit.cc](https://flykit.cc) renders — it's separate from `plugin.json` so the Claude Code schema stays clean. See `plugins/steuer/web.json` for the full shape. Required fields:

   ```json
   {
     "displayName": "Your Plugin",
     "author": "your-github-handle",
     "authorUrl": "https://github.com/your-handle",
     "categories": ["Category A", "Category B"],
     "tagline": "One-line pitch — shown in cards and hero.",
     "description": "2–4 sentences. Shown on the plugin detail page.",
     "features": ["Feature one", "Feature two", "..."],
     "useCases": ["Who this is for — one line each", "..."],
     "skills": [
       { "name": "skill-name", "description": "What it does." }
     ],
     "sources": [
       { "label": "External API", "url": "https://..." }
     ]
   }
   ```

   Stars + repo URL are fetched live from GitHub at build time — no need to maintain them here.

6. **Write at least one skill.** Each skill is a Markdown file with YAML frontmatter:

   ```yaml
   ---
   name: my-skill
   description: One sentence describing what it does and when to trigger it.
   argument-hint: [optional-args]
   allowed-tools: Bash, Read, Write
   ---
   ```

   The body is a prompt for Claude — explain the task, the steps, and how to invoke any scripts. **Always reference scripts via `${CLAUDE_PLUGIN_ROOT}`**, never relative paths.

7. **Make scripts black-box CLIs.** Each script should be runnable in isolation, e.g.:

   ```bash
   node scripts/my-script.js --year 2024 --output ./out
   ```

   Read configuration from `process.env` and from `~/.config/flykit/<plugin>/config.json`. Print clear error messages when required config is missing.

8. **Sanitize.** No personal data, no real client / merchant names, no credentials. The repo is public.

## Working on an existing plugin

Most contributions are incremental — fixing a bug, adding a skill to an existing plugin, or extending one of its pluggable interfaces.

- **Debug locally.** Clone the repo and load the plugin directory directly (see [Local development](#local-development) below). Turn on `--debug` to see hook, MCP, and skill resolution logs. Run scripts in isolation with `node plugins/<plugin>/scripts/<script>.js` to reproduce issues without the Claude Code layer in the way.
- **Add a new skill / command / agent.** Drop a new file under the relevant directory (`skills/<name>/SKILL.md`, `commands/<name>.md`, `agents/<name>.md`). No manifest change needed — Claude Code discovers them by convention. Bump `version` in `plugin.json` and the matching entry in `marketplace.json`.
- **Extend a pluggable abstraction.** Some plugins expose internal contracts so new backends can be added without rewriting the plugin. The canonical example is steuer's transaction-source interface: see `plugins/steuer/scripts/sources/README.md` for the shape and a walkthrough of adding a new source. Follow the same pattern (small adapter, one file, documented contract) when introducing similar seams in other plugins.
- **Don't forget the README.** If user-facing behavior changes, update the plugin's `README.md` — the flykit.cc site renders directly from it.

## Local development

Clone the repo first:

```bash
git clone https://github.com/flykit-cc/flykit.git
cd flykit
```

**Option A — load a single plugin directory for one session.** Use the `--plugin-dir` flag (repeatable):

```bash
claude --plugin-dir ./plugins/<your-plugin>
```

**Option B — add the whole repo as a local marketplace.** This mirrors how end-users install from GitHub, but points at your working copy:

```
# inside Claude Code
/plugin marketplace add /absolute/path/to/flykit
/plugin install <your-plugin>@flykit
```

Re-run `/plugin marketplace update flykit` after you edit `marketplace.json` or a plugin manifest.

**Validate manifests** before opening a PR:

```bash
claude plugin validate ./plugins/<your-plugin>
claude plugin validate ./.claude-plugin/marketplace.json
```

Inside Claude Code, your skills will appear under `/<plugin>:<skill-name>`. Iterate, test, repeat. Add `--debug` for verbose resolution logs.

For pure script changes, you can run the scripts directly with Node, outside Claude Code:

```bash
node plugins/<your-plugin>/scripts/<script>.js --year 2024
```

## Code style

- **JavaScript**: CommonJS (Node 20+), 4-space indent, single quotes, trailing semicolons.
- **Markdown**: ATX headers (`#`), tables for structured data, fenced code blocks with language tags.
- **JSON**: 2-space indent.
- **No emojis** in code, comments, or docs unless the user explicitly asked for them.
- **No personal data** anywhere — sanitize before pushing.

## Pull requests

1. Fork the repo and create a feature branch off `main`.
2. Make your changes. Keep PRs focused — one plugin or one bug fix at a time.
3. Update `marketplace.json` and bump the plugin's `version` if you changed plugin code.
4. Update the plugin's `README.md` if user-facing behavior changed.
5. Open a PR with a clear description: what changed, why, and how you tested it.
6. The maintainer reviews and merges. The site at flykit.cc redeploys automatically via GitHub Actions on merge to `main`.

## Reporting issues

File issues at https://github.com/flykit-cc/flykit/issues. Include:
- Plugin name and version
- Claude Code version
- Steps to reproduce
- Expected vs actual behavior

## Code of conduct

Be kind. Assume good intent. No harassment, no discrimination. The maintainer reserves the right to remove contributions or contributors that violate this in spirit.
