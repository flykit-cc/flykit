# Contributing

This repo holds one file: `.claude-plugin/marketplace.json`. Every plugin on it
lives in its own repo, so almost all contribution happens somewhere else.

## Fixing or extending an existing plugin

Open the issue or pull request in that plugin's repo, not here.

| Plugin | Repo |
|---|---|
| flow | [flykit-cc/flow](https://github.com/flykit-cc/flow) |
| steuer | [flykit-cc/steuer](https://github.com/flykit-cc/steuer) |

## Adding a plugin

1. **Build it in your own repo.** A Claude Code plugin needs
   `.claude-plugin/plugin.json` at the root, declaring at least `name`,
   `version`, `description`, `author` and `license`.

2. **Add a `web.json`** at the root if you want a page on flykit.cc. It carries
   the display copy: `displayName`, `author`, `authorUrl`, `categories`,
   `tagline`, `description`, `features`, `useCases`, `skills`, `sources`.

3. **Open a PR here** adding one entry to `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "your-plugin",
     "description": "One line, shown in /plugin.",
     "source": { "source": "github", "repo": "you/your-plugin" },
     "version": "0.1.0",
     "category": "productivity",
     "keywords": ["..."],
     "license": "MIT"
   }
   ```

   The `version` here must match the `version` in your repo's `plugin.json`. CI
   fetches your repo and fails the PR if they disagree.

## Releasing a new version

An install is keyed by **version**, not by commit. `/plugin update` compares the
manifest version against the installed one, so shipping a change without bumping
makes the update a silent no-op — users keep running the old code and nothing
reports an error. That happened once, on flow 0.2.0, and cost a session to find.

So every release is two steps:

1. Bump `version` in your plugin repo's `.claude-plugin/plugin.json` (and
   `package.json` if you have one, keeping them equal).
2. Open a PR here bumping the same number in `marketplace.json`.

CI checks that every entry's source repo exists, carries a `plugin.json`, and
declares the version this manifest claims.

## Not a Claude Code plugin?

DeepSeek Harness plugins, standalone tools and native apps are not listed here.
They live in their own repos and are listed on flykit.cc — open an issue on
[flykit-cc/flykit-web](https://github.com/flykit-cc/flykit-web) to add one to the
catalog.

MIT licensed. By contributing you agree your work ships under the same licence.
