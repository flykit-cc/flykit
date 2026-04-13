# flykit

> Open-source [Claude Code](https://docs.claude.com/en/docs/claude-code) plugins for everyday workflows.

flykit is a marketplace of small, focused plugins that turn Claude Code into a useful assistant for things you actually do — taxes, paperwork, recurring chores. Each plugin is a self-contained set of skills, scripts, and reference docs.

Live at **[flykit.cc](https://flykit.cc)**.

## Installation

In Claude Code, add the marketplace:

```
/plugin marketplace add flykit-cc/flykit
```

Then install a plugin:

```
/plugin install steuer@flykit
```

## Plugins

| Plugin | What it does |
|--------|--------------|
| **steuer** | German freelancer tax filing — fetch transactions from your bank, classify income/expenses, calculate the EÜR, and walk through ELSTER step by step. |
| _more coming_ | Got an idea? See [CONTRIBUTING.md](./CONTRIBUTING.md). |

## How it works

flykit follows the standard Claude Code [plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins) format. The marketplace manifest lives at [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) and each plugin is a directory under [`plugins/`](./plugins) with its own manifest, skills, scripts, and references.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a plugin, develop locally, and submit changes.

## License

[MIT](./LICENSE) © kaiomp
