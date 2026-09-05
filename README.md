<div align="center">

<img src="./assets/logo.svg" width="64" height="64" alt="flykit" />

# flykit plugins

**The Claude Code plugin marketplace for [flykit](https://flykit.cc).**

[![MIT License](https://img.shields.io/github/license/flykit-cc/plugins?style=flat-square&labelColor=111&color=000)](./LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin_marketplace-000?style=flat-square&labelColor=111)](https://docs.claude.com/en/docs/claude-code/plugins)
[![flykit.cc](https://img.shields.io/badge/flykit.cc-live-27c93f?style=flat-square&labelColor=111)](https://flykit.cc)

<br/>

<a href="https://flykit.cc">
  <img src="https://flykit.cc/opengraph-image" alt="flykit — a cockpit for agentic development" width="720" />
</a>

</div>

---

This repo is a menu, not a kitchen. It holds one file — the marketplace manifest —
and every plugin on it lives in its own repo.

## Install

```
claude /plugin marketplace add flykit-cc/plugins
/plugin install flow@flykit
```

One `marketplace add`, ever. After that, `/plugin` lists everything here.

## What is on the menu

| Plugin | What it does | Repo |
|---|---|---|
| **flow** | An AI dev workflow: session lifecycle, orchestrated agents, deep reviews, in any repo | [flykit-cc/flow](https://github.com/flykit-cc/flow) |
| **steuer** | German freelancer tax filing: fetch, classify, calculate the EÜR, file via ELSTER | [flykit-cc/steuer](https://github.com/flykit-cc/steuer) |

Issues and pull requests belong in the plugin's own repo. This one only tracks
the manifest.

## Not a Claude Code plugin?

The rest of flykit lives elsewhere, because it installs a different way.

- **[dsh-flykit](https://github.com/flykit-cc/dsh-flykit)** — the cockpit: turns the DeepSeek Harness web UI into a workspace with agent terminals, a file explorer and a model picker
- **[dsh-claude-live](https://github.com/flykit-cc/dsh-claude-live)** — run Claude Code as a subagent inside DeepSeek Harness
- **[ghostcode](https://github.com/flykit-cc/ghostcode)** — Ghostty launcher for Claude Code
- **[uisper](https://github.com/flykit-cc/uisper)** — native, fully local dictation for macOS

The full catalog, with screenshots, is at [flykit.cc](https://flykit.cc).

## Adding a plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md). The short version: your plugin lives in
your repo, and this manifest gains one entry pointing at it.

MIT licensed.
