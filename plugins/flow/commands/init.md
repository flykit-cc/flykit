---
description: Bootstrap a new project with .flow/config.md and CLAUDE.md tailored to your stack.
allowed-tools: Bash, Read, Edit, Glob, Grep, AskUserQuestion
---
# /flow:init

Bootstrap a project so the rest of `/flow:*` works. This drives `scripts/init.js`, which
writes `.flow/config.md` and `CLAUDE.md` and auto-detects your stack commands from files
already on disk (`package.json` scripts, `go.mod`, `Cargo.toml`, `pyproject.toml`,
`requirements*.txt`, a `Makefile`, …). Anything a manifest does not declare, **you** work out
from the repo in Step 3 — the user is only ever asked the questions in Step 1.

## Step 1: Ask the user

Use `AskUserQuestion`, batched where possible:

1. **workflow_mode** — `solo` or `team` (team enables feature branches and PRs).
2. **pm_backend** — `github`, `linear`, or `local` (local stores issues as files in `issues/`).
3. If `github`: ask for `pm_github_owner` and `pm_github_repo`, defaulting the suggestion to
   what `git remote get-url origin` parses to.
4. If `linear`: ask for `pm_linear_team` (the team key, e.g. `ENG`).

Do not ask about dev/lint/typecheck/build/test/format commands — the script detects what the
manifests declare and Step 3 works out the rest from the repo.

For the project name, don't ask by default — the script infers it from `package.json`'s
`name` field, falling back to the directory basename. Only ask via `AskUserQuestion` if
that default looks wrong (empty, `.`, or a generic scaffold name like `app`/`my-app`/
`untitled`/`src`), and pass the corrected value as `--project-name`.

## Step 2: Run the script

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/init.js \
  --workflow-mode <answer> \
  --pm-backend <answer> \
  [--pm-github-owner <answer>] [--pm-github-repo <answer>] \
  [--pm-linear-team <answer>] [--project-name <answer, only if asked>]
```

Omit a flag entirely rather than passing an empty string. Safe to re-run: the script never
overwrites an existing `.flow/config.md`, and it leaves an existing `CLAUDE.md` **strictly
alone** — a project that already documents itself does not get a generic template appended
over the top of it. Only an absent `CLAUDE.md` is seeded from the template.

Because nothing is overwritten, editing a template in a plugin update does *not* reach a
project that was already initialised. To pick up template changes, run `/flow:uninstall`
first, then `/flow:init` again.

## Step 3: Fill in what detection missed

The script ends by naming every key it could not fill:

```
[flow init] Done. Stack commands still blank: dev_cmd, build_cmd, format_cmd
```

That list is **yours to finish, not the user's**. A repo with a venv, a `tests/test_*.py` and
an `app.py` has a test command and a dev command; they are simply not declared in a manifest.
Telling the user to "edit `.flow/config.md` to fill in your project commands" hands back a
chore you can complete in one pass.

For each blank key, follow `${CLAUDE_PLUGIN_ROOT}/references/stack-command-inference.md`:
find the evidence (entrypoints, test files, linter configs, `.github/workflows/`), prefer the
project's own environment (`.venv/bin/pytest`, not a bare `pytest`), **run the command to
verify it works**, then write it into the matching `- <key>:` line with `Edit`. Leave a key
blank only when the project genuinely has nothing to run for it, and say which and why.

Nothing here is overwritten by the script, so this step works the same on a re-run against an
already-initialised project whose commands were left blank.

Ask the user only when the evidence genuinely conflicts — two test runners and nothing in the
repo picking between them. Never ask for a command you could have found and verified.

## Step 4: Backend bootstrapping

- `pm_backend=local`: create `$CLAUDE_PROJECT_DIR/issues/` with a `.gitkeep` and a
  `README.md` explaining the format (one markdown file per issue, frontmatter with
  `status`, `priority`, `created`), if they don't already exist.
- `pm_backend=github`: run `gh auth status` and warn if the user is not logged in.
- `pm_backend=linear`: tell the user to install/configure the Linear MCP server in their
  `.claude/settings.json`.

`.flow/config.md` is **shareable project truth** and is staged normally — commit it if
collaborators should get the same stack setup. Only `.flow/local.md` is machine-private
(`private_globs` covers it), so machine-specific values belong there, not in `config.md`.

## Step 5: Report

Relay the script's output verbatim — which files were `created` / `left untouched`, and
which stack commands were detected. Then add what Step 3 produced: each command you inferred,
how you verified it, and any key you deliberately left blank.

## Step 6: Verify the setup

Run `/flow:health` straight away rather than suggesting it. Init is exactly the point where
a wrong answer is cheapest to fix, and health only diagnoses — the one thing it repairs is a
blank `*_cmd`, which Step 3 should already have left nothing to do.

Report only what health flags. If everything passes, one line is enough — do not reprint the
whole table on top of the Step 5 report.
