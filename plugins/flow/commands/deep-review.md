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
git diff --name-only
git diff --cached --name-only
```

Union all three file lists. The committed range alone is not enough: autopilot's Phase 2 never commits mid-sprint (it only stages/commits later, in Phase 4's `finish`), so a deep-review called from autopilot must also see the working tree's unstaged and staged changes, not just what's already committed.

If the first command fails (no upstream), ask the user for a base ref via `AskUserQuestion` (unattended: see exception below).

If the union of all three is empty, tell the user there is nothing to review and stop. This is the only legitimate empty-scope case — genuinely nothing changed anywhere.

**Exception — unattended/non-interactive invocation** (e.g. delegated from `/flow:autopilot`, which never prompts after launch): do not call `AskUserQuestion` at all, in this step or any other in this command.
- Here (no upstream): fall back to the last 20 commits (`HEAD~20`, or the earliest ancestor if the branch is shorter) as the base instead of asking.
- Step 5 (still not clean after 3 iterations): stop the fix loop and report the remaining BREAKS/SECURITY items instead of asking how to proceed — let the caller decide.
- Step 6 (pitfalls append): skip the question — auto-append recurring findings to `known_pitfalls_path` without asking.

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

1. Spawn a `general-purpose` agent with the unresolved BREAKS + SECURITY items and instructions to fix exactly those, nothing more.
2. After it reports done, re-run reviewers (Step 3) over only the files it touched.
3. Re-synthesize.
4. Cap at 3 iterations. If still not clean, stop and ask the user how to proceed (unattended: see exception in Step 1 — report instead of asking).

MINOR items are not blocking. Print them at the end as a list the user can decide to address now or defer.

## Step 6: Append to known pitfalls

If any BREAK or SECURITY finding represents a recurring pattern, ask the user whether to append it to the project's known pitfalls file (`known_pitfalls_path` from config.md, default `CLAUDE.md`) — unattended: see exception in Step 1 — auto-append instead of asking. See `${CLAUDE_PLUGIN_ROOT}/references/known-pitfalls.md` for the pattern.

## Step 7: Done

Print final status. Suggest `/flow:pause land` if everything is clean and the user is ready to ship.
