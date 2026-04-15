# Known Pitfalls — the pattern

A "known pitfall" is a mistake this codebase has made before. Listing them in one place turns each repeated bug into a one-line check.

## Why this exists

Reviews catch new bugs. Known pitfalls catch the *same* bug a second time. Without a list, the same class of mistake gets re-introduced every few months by whichever contributor (human or AI) didn't see the original.

The list lives in your project, not in this plugin. Default location: `CLAUDE.md` under a `## Known Pitfalls` section. Override via `known_pitfalls_path` in `.claude/config.md`.

## How to grow the list

You don't write the list up front. You append to it.

The trigger is `/flow:deep-review`. Whenever a reviewer finds a `BREAK` or `SECURITY` finding that *feels recurring* — i.e. the kind of thing a future contributor will re-introduce — the command asks you whether to append it.

Good entries are:

- **Specific** — name the API, the function, the pattern
- **Mechanical** — phrased so a `grep` could plausibly find a violation
- **Short** — one to three lines

Bad entries are vague style preferences ("write clean code"), one-off bugs that won't recur, or duplicates of what the linter already enforces.

## Optional: mechanical enforcement

You can wire a hook (e.g. a `stop-check.sh`) that greps the diff for patterns derived from the pitfalls list and refuses to let a session end if any are present. This is opt-in and lives in your project's `.claude/settings.json`, not in this plugin.

The plugin only owns the *pattern*. Whether you enforce it mechanically is your call.

## Examples (generic, illustrative)

These are examples of the *shape* a good entry takes, not pitfalls you necessarily have:

- "String comparison of secrets must use a constant-time compare (e.g. `timingSafeEqual`). Plain `==` leaks timing info."
- "Never log full request bodies on error paths — they often contain credentials."
- "Database migrations must be idempotent. Re-running the migration suite from scratch must succeed against an already-migrated database."
- "Background jobs must set an explicit timeout. The default is 'forever', which is never what you want."

Notice each one names a concrete thing and could be checked semi-mechanically.

## What this list is not

- Not a style guide (use a formatter)
- Not a linter ruleset (use a linter)
- Not architecture docs (use `CLAUDE.md` proper)

It is a memory of past pain, expressed as guard rails for future work.
