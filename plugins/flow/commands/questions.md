---
description: Answer, inspect, or edit the open-question queue (.flow/questions.md)
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---
# /flow:questions

Work the queue in `.flow/questions.md`. Mechanics live in `${CLAUDE_PLUGIN_ROOT}/scripts/questions-helpers.sh`; the full queue contract — WIP limit, promotion order, how a question gets presented — lives in `${CLAUDE_PLUGIN_ROOT}/references/question-protocol.md`. Read its `## Queue rules` and `## Presenting a question` sections before Step 1; this command narrates, it doesn't restate those rules.

| Invocation | What happens |
|---|---|
| `/flow:questions` | answer a round: up to `question_wip` open questions, one dialog at a time |
| `/flow:questions list` | table of open + backlog + answered-not-applied |
| `/flow:questions list all` | same, plus answered (applied) / assumed / retired |
| `/flow:questions reopen Q<n>` | set that question back to `open` |
| `/flow:questions retire Q<n> <reason>` | set that question to `retired` |

## Step 0: State (shell, no LLM)

```bash
HELPERS="${CLAUDE_PLUGIN_ROOT}/scripts/questions-helpers.sh"
FILE="$CLAUDE_PROJECT_DIR/.flow/questions.md"
"$HELPERS" state-line "$FILE"
"$HELPERS" counts "$FILE"
```

- **`state-line` starts with `questions.md UNPARSEABLE`:** the file is broken. Run `"$HELPERS" validate "$FILE"` to get the offending line number and reason, show that line to the user, help them fix it, then stop — never guess a count or proceed on a broken file.
- **`counts` are all zero** (file absent or has no question blocks yet): print "No questions filed." and stop.

Otherwise branch on the invocation below.

## Default (no args): answer a round

Up to `"$HELPERS" wip-limit "$CLAUDE_PROJECT_DIR/.flow/config.md"` questions, oldest first, **one fully settled before the next briefing starts**:

1. `"$HELPERS" top-open "$FILE"` — the oldest still-open block (re-run this each time; promotion in step 5 can change what's next).
2. Follow `## Presenting a question` in `${CLAUDE_PLUGIN_ROOT}/references/question-protocol.md`: a briefing turn built from that block's `asks` / `context` / `options` / `recommendation`, ending on the handoff line ("Ready to pick? Reply anything and I'll open the options.") with no tool call after it — that's what makes it render. Never put the briefing and the dialog in the same message; that's the one failure mode this protocol exists to prevent.
3. Next turn, after the user replies: open the `AskUserQuestion` dialog, carrying the `Q<n>` id — unless the reply already answered or redirected the question, in which case skip the dialog entirely.
4. Write `answer:` on the block immediately (Write/Edit), set `status: answered`.
5. Promote the top backlog question into the freed slot, per `## Queue rules` in the same reference.
6. Rebuild the pointer task now (see below) — after every question this round, not just at the end.

Stop the round when the WIP-limit count of dialogs is used up, no open questions remain, or the user wants to stop.

## `list` / `list all`

Read `$FILE` directly and print one compact line per question — id, status, issue, asks:

```
Q3  open     #41  cache per-user or global?
Q5  backlog  -    retry policy for the sync job?
```

Plain `list`: `open`, `backlog`, and `answered` blocks with an empty/missing `applied:` (answered-not-applied). `list all`: adds already-applied `answered` blocks, `assumed`, and `retired`.

## `reopen Q<n>`

Edit that block: `status: open`. If open questions would then exceed `"$HELPERS" wip-limit`, first evict the newest currently-open block (highest `Q<n>` among `status: open`) to `status: backlog` — the reopened question always gets the slot. Confirm in one line, e.g. `Q4 reopened (Q9 moved to backlog to stay under the WIP limit).`

## `retire Q<n> <reason>`

Edit that block: `status: retired`, `retired-because: <reason>`. If the block was `status: open`, promote the top backlog question into the freed slot, per `## Queue rules` in `${CLAUDE_PLUGIN_ROOT}/references/question-protocol.md` — same as the answer flow.

## End of every invocation: rebuild the pointer task

**If `TaskCreate`/`TaskList` are not available in this session, skip this section entirely and say so once** — e.g. "no pointer task: task tools unavailable here." The queue file is the source of truth and stays correct without it; the pointer is a convenience mirror. Do not fake it with a message that looks like a task, and do not fail the command. What must never happen is silence: a user who relies on the pointer to remember open questions would otherwise assume there are none.


```bash
"$HELPERS" counts "$FILE"
"$HELPERS" top-open "$FILE"
```

`TaskList` to find the existing pointer task — subject starts with `Q` and contains `· +`. Compute the target subject from the current top open question and open count, per spec: `Q<n>: <asks> · +<open-count minus 1> open` (e.g. `Q7: cache per-user or global? · +2 open`).

- Found: `TaskUpdate` its subject to match.
- Missing, and at least one question is open: `TaskCreate` it.
- Zero open questions remain: mark the pointer task completed instead.
