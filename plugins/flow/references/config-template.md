# `.claude/config.md` template

This file lives at `.claude/config.md` in your project. The `flow` plugin's commands and agents read it to learn how to run things in your stack.

It is intentionally markdown — easy to read, easy to edit by hand. Values go after the colon on each line. Comments start with `<!--` or `>` blockquotes and are ignored.

Keep this file in version control. It is project-wide truth, not a personal preference.

---

## Workflow

> How sessions ship work.

- workflow_mode: solo

`solo` commits straight to the working branch and pushes on `/flow:push`. `team` creates a feature branch on `/flow:start` and opens a PR on `/flow:push`.

---

## Project management backend

> Where issues live.

- pm_backend: github

One of `github`, `linear`, `local`.

- pm_github_owner: {OWNER}
- pm_github_repo: {REPO}

Required when `pm_backend: github`. The plugin uses these to resolve `gh issue` calls.

- pm_linear_team: {TEAM_KEY}

Required when `pm_backend: linear`. The Linear team key, e.g. `ENG`.

When `pm_backend: local`, issues live as markdown files in `./issues/` and no extra fields are needed.

---

## Stack commands

> The plugin never assumes a stack. Tell it how to run things here.
> Leave a value blank to skip that step.

- dev_cmd: {COMMAND_TO_START_DEV_SERVER}
- lint_cmd: {COMMAND_TO_LINT}
- typecheck_cmd: {COMMAND_TO_TYPECHECK_OR_BLANK}
- build_cmd: {COMMAND_TO_BUILD_PRODUCTION}
- test_cmd: {COMMAND_TO_RUN_TESTS}
- format_cmd: {COMMAND_TO_FORMAT_CODE}

Examples (replace with your own — these are illustrative, not defaults):

- e.g. dev_cmd: `<your-package-manager> run dev`
- e.g. lint_cmd: `<your-linter>`
- e.g. test_cmd: `<your-test-runner>`

---

## Known pitfalls

> Optional. Path to a file (relative to project root) that lists patterns reviewers and `/flow:audit` should always check.
> Defaults to `CLAUDE.md`.

- known_pitfalls_path: CLAUDE.md

See the plugin's `references/known-pitfalls.md` for how to grow this list over time.
