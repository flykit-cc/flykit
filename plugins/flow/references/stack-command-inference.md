# Inferring stack commands

`scripts/init.js` fills `.flow/config.md`'s `*_cmd` keys from manifests it can read —
`package.json` scripts, `go.mod`, `Cargo.toml`, `pyproject.toml`, `requirements*.txt`, a
`Makefile`. That covers most repos. It does not cover a repo whose commands are real but
undeclared: a script-style Python project with a venv, a `tests/test_*.py`, and an `app.py`
has a test command and a dev command, just not written down anywhere a parser can find.

For those, init prints the keys it could not fill:

```
[flow init] Done. Stack commands still blank: dev_cmd, build_cmd, format_cmd
```

That line is addressed to the **agent**, not the user. Everything init leaves blank is
discoverable by looking at the repo for a minute, and asking the user to go and edit a
config file by hand is handing back homework that the agent can finish in one pass.

## The procedure

For each blank key: find the evidence, form the command, run it, write it down.

### 1. Find the evidence

| Key | Where the answer usually is |
| --- | --- |
| `dev_cmd` | An entrypoint (`app.py`, `main.py`, `manage.py`, `server.js`, `cmd/*/main.go`); a `Procfile`; a `docker-compose.yml` service command; a `Dockerfile` `CMD`; the README's "run it" section |
| `test_cmd` | `test_*.py` / `*_test.py` / `tests/`, `*.test.js`, `*_test.go`; a test runner in `requirements*.txt`; the test step of a CI workflow under `.github/workflows/` |
| `lint_cmd` | A linter config (`.flake8`, `.eslintrc*`, `ruff.toml`, `.golangci.yml`); a linter in the dependency list; the CI lint step |
| `typecheck_cmd` | `mypy.ini`, `tsconfig.json`, a type checker in the dependency list |
| `build_cmd` | A build config (`setup.py`, `Dockerfile`, `vite.config.*`), or nothing — plenty of projects have no build |
| `format_cmd` | A formatter in the dependency list or its config (`.prettierrc`, `[tool.black]`) |

CI workflows are the strongest evidence of all: they are commands the project already runs
in a clean checkout, and they are usually correct.

### 2. Prefer the project's own environment

A repo with a virtualenv wants `.venv/bin/pytest`, not a bare `pytest` resolved against
whatever happens to be on `PATH`. Same for `node_modules/.bin/`. Write the command the way
this project runs it, and keep the path relative to the project root.

### 3. Verify before writing

A command that was never run is a guess. Run each one and check it does what the key claims:

- `test_cmd`, `lint_cmd`, `typecheck_cmd`, `format_cmd` — run it. Real findings (failing
  tests, lint errors) mean the command works; that is a pass. Only "command not found",
  "no such file", "unknown option", or "no tests ran" mean the command is wrong.
- `build_cmd` — run it if it is cheap. If it is slow or writes artifacts, verify the tool
  resolves (`<tool> --version`) and say in the report that the full build was not run.
- `dev_cmd` — never leave a server running. Check the entrypoint exists and the interpreter
  resolves (`.venv/bin/python --version`, `node --version`), or start it and stop it once it
  is listening. Record the port in `dev_port` while you are there.

Fix and re-run what fails. Do not write a command that did not survive this step.

### 4. Write it into `.flow/config.md`

Edit the `- <key>: <command>` lines in place. Do not rewrite the rest of the file — the
values around them are the user's.

Leave a key blank only when the project genuinely has nothing to run for it (no build step,
no formatter). A blank means "skip that step", so it must be a decision, not a shrug. Say
which keys you left blank and why.

### 5. Report

One block, in the init/health report:

```
Inferred and verified:
  test_cmd: .venv/bin/pytest        (23 passed)
  dev_cmd:  .venv/bin/python app.py (starts, listens on 5000)
Left blank: build_cmd (no build step), format_cmd (no formatter in requirements.txt)
```

Ask the user only when the evidence genuinely conflicts — two test runners, two entrypoints,
and nothing in the repo picks between them. "I could not be bothered to look" is not a
conflict.
