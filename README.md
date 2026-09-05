<div align="center">

<img src="./assets/logo.svg" width="64" height="64" alt="flykit" />

# flykit

**Open-source plugins and tools for AI coding agents — [Claude Code](https://docs.claude.com/en/docs/claude-code) and [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh).**

[![MIT License](https://img.shields.io/github/license/flykit-cc/flykit?style=flat-square&labelColor=111&color=000)](./LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin_marketplace-000?style=flat-square&labelColor=111)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Stars](https://img.shields.io/github/stars/flykit-cc/flykit?style=flat-square&labelColor=111&color=27c93f)](https://github.com/flykit-cc/flykit/stargazers)
[![flykit.cc](https://img.shields.io/badge/flykit.cc-live-27c93f?style=flat-square&labelColor=111)](https://flykit.cc)

<br/>

<a href="https://flykit.cc">
  <img src="https://flykit.cc/opengraph-image.png" alt="flykit — plugins and tools for AI coding agents" width="720" />
</a>

</div>

---

A collection of small, focused plugins and tools for AI coding agents — the things you actually do: taxes, paperwork, dev workflow, recurring chores, and the cockpit you drive your agents from. Everything here is self-contained and MIT-licensed.

flykit spans two ecosystems today:

| Ecosystem | What lives here | How it is listed |
|---|---|---|
| **Claude Code** | Plugins installed through the flykit marketplace, plus standalone companion tools | [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) (plugins), [`tools.json`](./tools.json) (tools) |
| **DeepSeek Harness (dsh)** | Harness plugins, each in its own repo | [`tools.json`](./tools.json) |

## Claude Code plugins

In Claude Code, add the marketplace:

```
/plugin marketplace add flykit-cc/flykit
```

Then install any plugin from it:

```
/plugin install steuer@flykit
```

| Plugin | What it does |
|---|---|
| [**flow**](./plugins/flow) | A stack-agnostic dev workflow — session lifecycle (`continue` / `status` / `pause`), parallel deep reviews, and an autonomous autopilot loop. Reads your stack from a per-repo `.flow/config.md`. |
| [**steuer**](./plugins/steuer) | German freelancer tax filing — fetch transactions from Wise, classify with Claude, calculate the EÜR, walk through ELSTER. |

## Claude Code tools

Standalone — not marketplace plugins, installed on their own.

| Tool | What it does |
|---|---|
| [**ghostcode**](https://github.com/flykit-cc/ghostcode) | Ghostty launcher for Claude Code — project picker, per-project tints, model/provider/mode switcher. |

## DeepSeek Harness plugins

| Plugin | What it does |
|---|---|
| [**dsh-claude-live**](https://github.com/flykit-cc/dsh-claude-live) | Run Claude Code as a subagent inside DeepSeek Harness, with its steps streaming live into the session view. `dsh plugin --profile web add dsh-claude-live` |
| [**dsh-flykit**](https://github.com/flykit-cc/dsh-flykit) | flykit for DeepSeek Harness — explorer with live file watch, agent terminals (Claude Code, Pi, Codex), DSH agent tools, searchable model picker, Claude usage bars and a status line. `dsh plugin --profile web add github:flykit-cc/dsh-flykit` |

Got something worth adding? Open an issue or see [CONTRIBUTING.md](./CONTRIBUTING.md).

## How it works

Two manifests, deliberately separate:

- [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) is the **Claude Code marketplace contract**. Claude Code reads it directly and only understands Claude Code plugins, so nothing from another ecosystem ever goes in it. Each plugin is a directory under [`plugins/`](./plugins) containing its manifest, skills, scripts, and references.
- [`tools.json`](./tools.json) is the **ecosystem-neutral registry** for everything that is not a marketplace plugin: standalone Claude Code tools and dsh plugins alike. Each entry carries an `ecosystem` field (`claude-code` or `dsh`), lives in its own repo, and points at a `web.json` sidecar under [`tools/`](./tools).

Every entry in either manifest also has a `web.json` sidecar — [`plugins/<name>/web.json`](./plugins/steuer/web.json) for marketplace plugins, [`tools/<slug>/web.json`](./tools/dsh-flykit/web.json) for tools.json entries. That's what [flykit.cc](https://flykit.cc) renders (tagline, features, skills, sources). The site fetches `marketplace.json` + `tools.json` + each `web.json` + live star count at build time.

**Pushes to `main` auto-publish to [flykit.cc](https://flykit.cc) within about a minute.**

```
  plugins/<name>/                     flykit.cc
  ├── .claude-plugin/                 ├── marketplace fetch  (build time + 1h ISR)
  │   └── plugin.json ─────────────────► Claude Code
  ├── skills/
  ├── scripts/
  ├── web.json ───────────────────────► flykit.cc renderer
  └── README.md

  tools.json ───────────────────────► flykit.cc registry fetch
  └── entry.web ──► tools/<slug>/web.json ──► flykit.cc renderer
                    (the tool itself lives in its own repo:
                     a dsh plugin installs with dsh plugin --profile web add)
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Adding a new Claude Code marketplace plugin (full checklist)
- Adding a `tools.json` entry — a standalone tool or a plugin for another ecosystem, dsh included
- Working on existing plugins — debugging locally, adding skills/commands/agents, extending pluggable interfaces (e.g., steuer's [transaction-source contract](./plugins/steuer/scripts/sources/README.md))
- Code style + PR checklist

The [flykit.cc](https://flykit.cc) frontend lives in a separate repo: [`flykit-cc/flykit-web`](https://github.com/flykit-cc/flykit-web). Design, copy, and layout PRs go there.

## License

[MIT](./LICENSE) © [kaiomp](https://github.com/kaiomp)
