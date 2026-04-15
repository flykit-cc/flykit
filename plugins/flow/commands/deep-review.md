---
description: Fan out parallel reviewers over the current diff, then loop fixes until BREAKS and SECURITY are zero.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---
# /flow:deep-review

Thorough review of the current diff against the base branch. Multiple reviewers in parallel, then a fix loop.

## Step 1: Determine scope

Run:

```bash
git diff --name-only $(git merge-base HEAD origin/HEAD)..HEAD
```

If that fails (no upstream), ask the user for a base ref via `AskUserQuestion`.

If the diff is empty, tell the user there is nothing to review and stop.

## Step 2: Partition files

Group changed files into 2-4 buckets by directory or feature area. Aim for roughly equal weight per bucket. One reviewer per bucket.

## Step 3: Spawn reviewers in parallel

For each bucket, spawn a `reviewer` agent via the `Agent` tool with the file list and the diff for those files. Brief each reviewer to classify findings as:

- **BREAKS** — bugs, regressions, broken builds, broken tests
- **SECURITY** — auth holes, injection, leaked secrets, unsafe deserialization, missing input validation
- **MINOR** — style, naming, small refactors, doc nits

Each reviewer writes to `/tmp/flow-session/review-<bucket>.md`.

## Step 4: Synthesize

Read all `review-*.md` files. Merge into a single report at `/tmp/flow-session/review.md`, deduped, grouped by category, sorted by severity.

Print a summary to the user: counts per category and the top items.

## Step 5: Fix loop

While `BREAKS` count > 0 or `SECURITY` count > 0:

1. Spawn a `coder` agent with the unresolved BREAKS + SECURITY items.
2. After it reports done, re-run reviewers (Step 3) over only the files it touched.
3. Re-synthesize.
4. Cap at 3 iterations. If still not clean, stop and ask the user how to proceed.

MINOR items are not blocking. Print them at the end as a list the user can decide to address now or defer.

## Step 6: Append to known pitfalls

If any BREAK or SECURITY finding represents a recurring pattern, ask the user whether to append it to the project's known pitfalls file (`known_pitfalls_path` from config.md, default `CLAUDE.md`). See `${CLAUDE_PLUGIN_ROOT}/references/known-pitfalls.md` for the pattern.

## Step 7: Done

Print final status. Suggest `/flow:push` if everything is clean and the user is ready to ship.
