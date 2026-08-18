# Question protocol

Rules for `.flow/questions.md` — the WIP-limited question queue. Read this
before asking the user anything, filing a question from an agent report, or
touching `/flow:continue`, `/flow:pause`, `/flow:questions`.

Compact state and a stub of these rules are injected every session via the
SessionStart/UserPromptSubmit hooks (plain stdout, never `systemMessage` —
the hook must reach Claude's context, not just the user's screen). This file
is the full version those hooks point to.

## File format

One block per question in `.flow/questions.md`:

```
## Q<n>
status: open | backlog | answered | assumed | retired
issue: #<gh-issue> | -
asks: <the question, one line>
context: <what's stuck / why this matters — may be several lines;
  continuation lines MUST be indented two spaces>
options: <A: consequence; B: consequence>       (optional)
recommendation: <option + why in one clause>     (optional)
answer: <the user's answer, verbatim-ish>        (filled when answered)
applied: <commit-hash | file-path | spec-updated | ->  (proof the answer landed;
  `-` = answer required no change (valid, not flagged); EMPTY = not yet
  applied — flagged loudly by /flow:pause)
retired-because: <one line>                      (only for retired)
```

- IDs are monotonic (`Q1, Q2, …`), never reused.
- Blank lines are always allowed, anywhere in the file.
- Continuation lines (e.g. a multi-line `context:`) MUST be indented two
  spaces — that's what keeps counting dumb: any unindented line is always
  either a known key, a `## Q<n>` header, or blank, never free text.
- Counting is `grep -c '^status: open'`.
- `applied: -` means the answer required no code/doc change — valid and
  terminal, never flagged. Empty or missing `applied:` on an `answered`
  block means not yet applied — flagged loudly by `/flow:pause`.
- **Write timing:** `answer:` is written the same turn the user gives it —
  never batched to pause time (a crash must not eat a given answer).
  `applied:` is set the moment the change lands (commit hash, file path, or
  `spec-updated`). `/flow:pause` only audits these two fields; it never
  backfills them.
- **Fail loud:** any unindented line that isn't a known key, a `## Q<n>`
  header, or blank makes the whole file UNPARSEABLE. Every hook and command
  touchpoint must emit `questions.md UNPARSEABLE — queue unreliable, fix
  .flow/questions.md` instead of exiting quietly or guessing a count. Broken
  must never look like fine.
- The file is private by default (`.flow/` is local-only in this repo's
  convention). A project that shares `.flow/` may commit it — that's the
  project's call, not this protocol's.

## Queue rules

- **WIP limit:** at most `question_wip` blocks may have `status: open` at
  once. Config key lives in `.flow/config.md`, default **3**.
- **Entry:** a new question always enters as `backlog` — unless a WIP slot
  is free (opens directly) or answering it would invalidate work in
  progress right now (jumps the queue; the open question it displaces
  returns to the top of backlog).
- **Promotion:** when an open question is answered or retired, promote the
  highest-priority backlog question. Priority order: architecture forks >
  only-user-knows facts > scope > taste.
- **Taste questions are never asked.** Claude decides, records `status:
  assumed`; the user can override any time by editing the file or just
  saying so.
- **Never re-ask.** Check the file before asking anything — `answered` is
  settled unless the user reopens it.
- **Retirement:** a question whose issue closed or whose premise died is
  set to `retired` with `retired-because`. Happens at flow touchpoints
  (`continue`, `pause`, `questions` command) — never live, mid-work.
- **One on screen:** regardless of how many questions are open, show the
  user exactly one dialog at a time.
- **All blocked:** if every workable thread is blocked on open questions,
  stop and say exactly: "All remaining work waits on these N answers."

## Presenting a question

Text emitted in the same assistant message as a following tool call may
never render in the Claude Code UI. A dialog preceded by "briefing" text in
one message can arrive naked — the briefing exists only in the session log,
never on screen. Design around this, never against it.

**Default — two turns, never one:**

1. **Turn ends with the briefing as final text** (no tool call after it —
   that's what guarantees it renders). Single topic: this question only.
   Full formatting freedom — headers, tables, examples, whatever makes it
   clearest. As simple as it can be, no jargon. Always closes with the
   handoff line: "Ready to pick? Reply anything and I'll open the options."
2. **Next turn, after the user replies:** open the dialog. It self-recaps,
   as insurance against the briefing having been skimmed or missed:
   - `question` field: the decision restated in 1–2 plain sentences.
   - Each option's `description`: that option's concrete consequence.
   - `preview`: comparison detail when useful.
   - Recommended option listed first, suffixed "(Recommended)".
   - The dialog carries its `Q<n>` id so the file can be cross-checked.
   - **Unless the reply already answers or redirects the question** — then
     skip the dialog entirely: write `answer:` immediately (per File
     format's write-timing rule) and move on. Never re-ask what the
     briefing reply already settled.

**Exception — trivial questions** (obvious default, plain yes/no): skip the
briefing turn, go straight to a self-explanatory dialog.

**Never** put the briefing text and the dialog in the same message — that
reproduces the invisible-briefing bug this protocol exists to avoid.

## Subagents

- Subagents run in the background and cannot reach the user; hooks don't
  fire inside them. **Subagents never ask the user** — dispatch templates
  (`agent-workflow.md`, `agents/reviewer.md`) state this explicitly.
- Every agent report includes a **"Questions raised"** section (empty is
  fine; omitting the section is not).
- The main loop files whatever's in that section into `questions.md` on
  receipt — `backlog` by default — then presents per the Queue rules above.
- **Unattended modes (`/flow:autopilot`) file only, never present.**
  Autopilot bans `AskUserQuestion` after launch and has no one to brief;
  filed questions wait for the next interactive session.

## Chores

- **Pointer task:** requires `TaskCreate`/`TaskList`, which not every session has.
  When they are missing, skip the pointer and say so once — never silently.
  `.flow/questions.md` is the source of truth; the task is a mirror.
- **Pointer task:** exactly one task exists for the queue, rebuilt from the
  file — never trusted as storage. Title: `Q<n>: <asks> · +<N> open` (the
  top open question's `asks`, plus the count of remaining open questions).
  Refreshed by every flow command that touches the queue; recreated at
  session start if missing. The file is the memory; the task is the
  display.
- **`/flow:continue`:** recap line ("Questions: 2 open · 5 answered · 4
  assumed"); rebuild the pointer task; retire questions whose issues closed
  meanwhile. If open questions exist, the recap turn ends with the top
  question's briefing + handoff line (see Presenting a question — never a
  dialog in the recap turn itself; the dialog follows the user's reply).
- **`/flow:pause`:** update the questions line in `session-progress.md`;
  flag any `answered` block with empty `applied:` loudly; retire questions
  whose issues it closes; refresh the pointer task.
- **`/flow:questions`:** answer a round now (up to `question_wip` dialogs,
  one at a time); list the queue; reopen an answered question; retire or
  edit entries conversationally.
