---
description: Bootstrap a new project with .flow/config.md and CLAUDE.md tailored to your stack.
allowed-tools: Bash, Read, Edit, Glob, AskUserQuestion
---
# /flow:init

Bootstrap a project so the rest of `/flow:*` works. This drives `scripts/init.js`, which
writes `.flow/config.md` and `CLAUDE.md` and auto-detects your stack commands from files
already on disk (`package.json` scripts, `go.mod`, `Cargo.toml`, `pyproject.toml`, …). What
no manifest evidences, **you** work out from the repo in Step 4 — the user is never asked to
fill in a command by hand.

## Step 1: Ask the user

Use `AskUserQuestion`, batched where possible:

1. **workflow_mode** — `solo` or `team` (team enables feature branches and PRs).
2. **pm_backend** — `github`, `linear`, or `local` (local stores issues as files in `issues/`).
3. If `github`: ask for `pm_github_owner` and `pm_github_repo`, defaulting the suggestion to
   what `git remote get-url origin` parses to.
4. If `linear`: ask for `pm_linear_team` (the team key, e.g. `ENG`).

Do not ask about dev/lint/typecheck/build/test/format commands — the script detects what the
manifests evidence, and Step 4 has you infer the rest from the repo yourself.

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

## Step 3: Backend bootstrapping

- `pm_backend=local`: create `$CLAUDE_PROJECT_DIR/issues/` with a `.gitkeep` and a
  `README.md` explaining the format (one markdown file per issue, frontmatter with
  `status`, `priority`, `created`), if they don't already exist.
- `pm_backend=github`: run `gh auth status` and warn if the user is not logged in.
- `pm_backend=linear`: tell the user to install/configure the Linear MCP server in their
  `.claude/settings.json`.

`.flow/config.md` is **shareable project truth** and is staged normally — commit it if
collaborators should get the same stack setup. Only `.flow/local.md` is machine-private
(`private_globs` covers it), so machine-specific values belong there, not in `config.md`.

## Step 4: Fill in the stack commands the script left blank

The script only writes a command a manifest file evidences, so a script-style repo (a
`requirements.txt` and a venv, a `Makefile`, a bare `main.py`) comes back with blank
`*_cmd` fields. Those blanks are **yours to close, not the user's**. If the script's
closing lines name any, work each one out from the repo before you report anything.

Look for the evidence a manifest did not carry (`Glob`, then `Read` what looks relevant):

- **Interpreter** — `.venv/bin/python`, `venv/bin/python`, `.venv/bin/pytest`. Prefer the
  project's own interpreter over a bare `pytest`/`python` that may not be on `PATH`.
- **Tests** — `test_*.py`, `*_test.py`, `tests/`, `tox.ini`, `noxfile.py`, `*_test.go`.
- **Dev entrypoint** — `manage.py` (`python manage.py runserver`), `app.py`, `main.py`,
  `wsgi.py`/`asgi.py`, a `docker-compose.yml` service.
- **Task runner** — a `Makefile` / `justfile` / `Taskfile.yml` target wins over a
  hand-rolled command: prefer `make test` over re-deriving what `make test` already runs.
- **Lint/format** — a `.flake8`, `setup.cfg`, `.pre-commit-config.yaml`, or a linter
  pinned in `requirements*.txt`.

Then, for each command you inferred:

1. **Run it** with `Bash` before writing it down. For `test_cmd`/`lint_cmd`/`build_cmd`
   run it outright; for `dev_cmd`, `--help` or a few-second start is proof enough — never
   leave a server running.
2. If it fails, fix it or drop it. Never write a command you have not seen work.
3. Write the verified value into `$CLAUDE_PROJECT_DIR/.flow/config.md` with `Edit`,
   replacing the blank line in place: `- test_cmd:` → `- test_cmd: .venv/bin/python -m pytest`.

> Leave a field blank only when nothing in the repo supports one — a library with no dev
> server has no `dev_cmd`, and that blank is correct. Say which ones you left blank and
> why. Never end a step by telling the user to edit `.flow/config.md` themselves.

## Step 5: Report

Relay the script's output — which files were `created` / `left untouched`, and which stack
commands were detected. Then add what you inferred in Step 4: each command, the evidence it
came from, and that you verified it runs.

## Step 6: Verify the setup

Run `/flow:health` straight away rather than suggesting it. Init is exactly the point where
a wrong answer is cheapest to fix, and health is read-only.

Report only what health flags. If everything passes, one line is enough — do not reprint the
whole table on top of the Step 5 report.
