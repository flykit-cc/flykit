# `.claude/config.md` template

This file lives at `.claude/config.md` in your project. The `flow` plugin's commands and agents read it to learn how to run things in your stack.

It is intentionally markdown — easy to read, easy to edit by hand. Values go after the colon on each line. Comments start with `<!--` or `>` blockquotes and are ignored.

This file is **private by default** — `private_globs` includes `.claude`, so flow will not
stage it. If you want it shared with collaborators, narrow `private_globs` (see SETUP.md).

---

## Workflow

> How sessions ship work.

- workflow_mode: solo

`solo` commits straight to the working branch and pushes/ff-merges on `/flow:pause land`. `team` works on a feature branch (created when the session starts, e.g. by `/flow:continue`) and opens a PR on `/flow:pause land`.

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

---

## Dev server

> Optional. The port your dev server listens on. `/flow:continue` uses it to detect
> whether the server is already running (reuse) vs. the port is taken by another
> project (start on a different port). Leave blank to skip the port check.

- dev_port:

---

## Durable memory

> Optional. Absolute (or `~`-prefixed) path to this project's cross-session memory
> directory. When set, `/flow:pause` auto-writes ≤4 memory candidates per pause and
> keeps a `MEMORY.md` index there; `/flow:autopilot` records audit history there.
> Leave blank to disable all memory features.
> Tip: Claude Code derives a per-project slug from the repo's absolute path, e.g.
> `~/.claude/projects/-Users-you-Documents-GitHub-yourrepo/memory`.

- memory_path:

---

## Secret protection

> Optional. Space-separated glob patterns naming files that must never be read,
> written, or committed. The same list guards the file-protection (write),
> secret-guard (Read tool + shell `cat`/`grep`/…), and pause `finish` commit hooks.
> Defaults to a conservative set covering env files, private keys, and common
> credential blobs.

- secret_globs: .env .env.* *.env *.env.* *.pem *.key id_rsa *_rsa *.p12 *.pfx *.keystore credentials.json token.json *secret* *.gpg

---

## Orphan-process reaping

> Optional. When `true`, the `post-bash-reap` PostToolUse hook kills the direct
> subprocess descendants of each Bash tool call (cleans up stray dev servers,
> scanners, docker exec, etc.). OFF by default — enable only if you do NOT rely on
> backgrounding a long-running process from inside a single tool call.

- reap_orphans: false

---

## Private files

> Optional. Space-separated globs naming paths that are private to your machine and
> must never be staged or pushed, even though they live in the repo. Distinct from
> `secret_globs` (credentials): these are work-in-progress artifacts — your own notes,
> plans, and local Claude configuration.
> Defaults to `.claude docs/superpowers .flow`.

- private_globs: .claude docs/superpowers .flow

---

## Model tiers

> Optional. Which model each class of work runs on. Agents read these instead of
> pinning a model, so a weak model never lands on correctness-critical code.
> `critical` covers security, auth, money paths, migrations, and fail-closed logic.

- model_default:  sonnet
- model_critical: opus
- model_cheap:    haiku

---

## Stop-time verification

> Optional. How much the Stop hook runs when Claude finishes a turn.
> `off` — nothing. `lint` — background lint/format only (default).
> `lint+build` — also honour the one-shot build/test gate armed by `/flow:pause land`.
> Builds and test suites cost time, disk, and sometimes money; keep this at `lint`
> unless you want the heavier gate.

- stop_check: lint

---

## Drift-check tuning

> Optional. `/flow:pause`'s `drift-check` flags likely-missing doc updates. These
> keys tune its heuristics; all have sane generic defaults, so most projects leave
> them blank.

- schema_glob: *schema*
- docs_glob: docs/
- route_pattern:

`schema_glob` matches data-model files (warns if they change without a docs/spec change).
`docs_glob` is where specs/docs live. `route_pattern` is an extended-regex matching newly
added route/endpoint declarations; the default covers common Express/Nest/Flask/Convex
shapes — override it for your framework if needed.
