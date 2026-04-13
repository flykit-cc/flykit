<div align="center">

<img src="./assets/logo.svg" width="64" height="64" alt="flykit" />

# flykit

**Open-source [Claude Code](https://docs.claude.com/en/docs/claude-code) plugins for real-world workflows.**

[![MIT License](https://img.shields.io/github/license/flykit-cc/flykit?style=flat-square&labelColor=111&color=000)](./LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin_marketplace-000?style=flat-square&labelColor=111)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Stars](https://img.shields.io/github/stars/flykit-cc/flykit?style=flat-square&labelColor=111&color=27c93f)](https://github.com/flykit-cc/flykit/stargazers)
[![flykit.cc](https://img.shields.io/badge/flykit.cc-live-27c93f?style=flat-square&labelColor=111)](https://flykit.cc)

<br/>

<a href="https://flykit.cc">
  <img src="https://flykit.cc/opengraph-image.png" alt="flykit — Claude Code plugins for real-world workflows" width="720" />
</a>

</div>

---

A marketplace of small, focused plugins that turn Claude Code into a useful assistant for the things you actually do — taxes, paperwork, recurring chores. Each plugin is self-contained: skills, scripts, reference docs, MIT-licensed.

## Install

In Claude Code, add the marketplace:

```
/plugin marketplace add flykit-cc/flykit
```

Then install any plugin from it:

```
/plugin install steuer@flykit
```

## Plugins

| Plugin | What it does |
|---|---|
| [**steuer**](./plugins/steuer) | German freelancer tax filing — fetch transactions from Wise, classify with Claude, calculate the EÜR, walk through ELSTER. |
| _more coming_ | Got a workflow worth automating? Open an issue or see [CONTRIBUTING.md](./CONTRIBUTING.md). |

## How it works

flykit is a standard Claude Code [plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins). Each plugin is a directory under [`plugins/`](./plugins) containing its manifest, skills, scripts, and references.

Each plugin also has a [`web.json`](./plugins/steuer/web.json) sidecar — that's what [flykit.cc](https://flykit.cc) renders (tagline, features, skills, sources). The site fetches `marketplace.json` + each `web.json` + live star count at build time.

**Pushes to `main` auto-publish to [flykit.cc](https://flykit.cc) within about a minute.**

```
  plugins/<name>/             flykit.cc
  ├── .claude-plugin/         ├── marketplace fetch  (build time + 1h ISR)
  │   └── plugin.json ─────────► Claude Code
  ├── skills/
  ├── scripts/
  ├── web.json ───────────────► flykit.cc renderer
  └── README.md
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Adding a new plugin (full checklist)
- Working on existing plugins — debugging locally, adding skills/commands/agents, extending pluggable interfaces (e.g., steuer's [transaction-source contract](./plugins/steuer/scripts/sources/README.md))
- Code style + PR checklist

The [flykit.cc](https://flykit.cc) frontend lives in a separate repo: [`flykit-cc/flykit-web`](https://github.com/flykit-cc/flykit-web). Design, copy, and layout PRs go there.

## License

[MIT](./LICENSE) © [kaiomp](https://github.com/kaiomp)
