---
description: Report a flow bug or feature request as a GitHub issue on flykit-cc/flykit, from any project. Checks first whether you are on an old version.
allowed-tools: Bash, AskUserQuestion
---
# /flow:issue

File a report about **flow itself** from inside whatever project you are working in. `/flow:issue continue` scopes it to a command; with no argument, infer the command from the conversation.

This reports on flow, not on the current project — the target repo is always `flykit-cc/flykit`, never the user's git remote.

## Step 1: Version check — before anything else

```bash
HELPERS="${CLAUDE_PLUGIN_ROOT}/scripts/issue-helpers.sh"
"$HELPERS" version-check     # installed=<v> latest=<v|unknown> status=<current|behind|ahead|unknown>
```

- **`status=behind`** — STOP and say so plainly: "You are on `<installed>`, latest is `<latest>`. This may already be fixed." Offer `/plugin update` (then `/reload-plugins`) and ask whether to update first or file anyway. Filing a report against a version that is already superseded is the most common way this command wastes everyone's time.
- **`status=current` / `ahead` / `unknown`** — continue. Never block on `unknown`; being offline is not a reason to lose a bug report.

## Step 2: Check for duplicates

Build a short query from the symptom (not the whole complaint) and search:

```bash
"$HELPERS" dupe-search "continue deletes handoffs"
```

- Output lines `#<n> <title>` — show them and ask whether this is the same issue. If it is, stop and point at it; adding a comment there beats a duplicate.
- Output `no-gh` — `gh` is missing or unauthenticated. Say so, skip to Step 3, and note at the end that the body must be pasted into GitHub by hand.

## Step 3: Draft the report

Build the body from **structured fields only**. Never paste conversation transcript and then try to scrub it — omit by construction instead.

Mark every field you inferred with `^ assumed — correct me` on its own line. Multiple uncertainties are marked assumptions, NOT a sequence of questions. Ask at most ONE question, and only when the draft genuinely cannot be written without the answer.

```
Version:  0.5.6 (latest 0.5.9)
Command:  /flow:continue

What happened:
  Deleted 3 of 8 handoff files in .flow/session/ without asking.

What I expected:
  With no .flow/state/last-pause there is no boundary to date handoffs
  against, so it should not delete any of them.
  ^ assumed — correct me

Repro:
  A project that ran agents but never completed a /flow:pause.
  ^ assumed — correct me
```

**Never include:** absolute paths (`/Users/<name>/...`), the current project's name or git remote, branch names, client or employer names, code from the current project, or anything from a `.env`/credential file. If a detail is load-bearing but identifying, describe its *shape* ("a repo with no pause marker"), not the thing itself.

## Step 4: Show it and confirm

Print the exact final title and body — the literal text that will be posted, not a summary of it. Then use `AskUserQuestion` with three options: **File it**, **Edit first**, **Cancel**.

Never run `gh issue create` without that confirmation. Posting is public and irreversible, and it posts under the user's own GitHub account.

## Step 5: File

```bash
gh issue create --repo flykit-cc/flykit \
  --title "<title>" \
  --label "flow,<bug|enhancement>" \
  --body "<body>"
```

`--label` takes a comma-separated list — that is the form `gh`'s own help documents.

Print the issue URL. If `dupe-search` returned `no-gh`, skip this step and print the body for manual pasting instead.
