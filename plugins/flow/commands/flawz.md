---
description: Hostile-but-honest flaw hunt on a plan, spec, design, or reasoning (not code diffs — that's /flow:deep-review). Real flaws only, no invention. If clean, say so and proceed; if flawed, recommend fixes.
allowed-tools: Bash, Read, Glob, Grep, WebSearch, WebFetch, AskUserQuestion
---
# /flow:flawz

Pressure-test a **plan, spec, design, or piece of reasoning** for *real* flaws before acting on it. This is the pre-implementation counterpart to `/flow:deep-review` (which reviews code diffs). Use it after writing a plan/spec, after proposing a design, or on any argument about to be committed to.

## Three rules override everything

1. **Don't invent flaws to look thorough.** A manufactured concern wastes more of the user's time than "nothing to fix." Style/wording preferences are not flaws.
2. **Prove it's a real flaw, not a preference.** A flaw makes the thing *wrong, unsafe, fail-open, contradictory, or unbuildable as written* — not merely "could be different." Point to the exact section and state the concrete failure it causes.
3. **If clean, say "no real flaws" and proceed.** Don't pad to look diligent. Honesty beats theatre.

## What counts as a real flaw (for plans/specs/designs)

- **Fail-open / unsafe default** — a path where the safe/secure behavior is *not* the default, or a misconfiguration silently disables a guard.
- **Underspecified critical detail** — the one place precision matters most is left vague (e.g. matching/scoping/auth semantics), so a reasonable implementer could build it wrong.
- **Internal contradiction** — two sections disagree; the architecture doesn't match the stated behavior.
- **Wrong/unstated assumption** — the design assumes something about the system that isn't true (verify against the actual code when checkable).
- **Missing case that changes the design** — an input/state/failure mode the design must handle but doesn't (empty, malformed, boundary, concurrent, out-of-order).
- **Scope/altitude mismatch** — a "single" spec that's really several subsystems, or a deliverable with no testable gate.
- **Conflated concerns** — a runtime concern treated as static (or vice-versa), so the stated mechanism can't actually enforce it.

Not flaws: naming, wording, section order, "could add later," hypothetical futures the design explicitly defers.

## Process

1. **Read the target in full** — the plan/spec/design (the most recent one in the conversation unless a path/section is named). Read any referenced code/CLAUDE.md/`.flow/config.md` when a claim is checkable — verify assumptions against reality rather than trusting the prose.
2. **Hunt** — walk each section asking: where does this fail open? what's the one under-specified detail an implementer would get wrong? what case is missing? does anything contradict? is any assumption actually false?
3. **Verify each candidate — and research anything uncertain, don't assert from memory.** Before listing a flaw (or clearing an assumption), confirm it against a real source: local `--help`/code/`grep` for tool flags and repo behavior, and **WebSearch/WebFetch for external facts you're not certain of** (third-party tool footprints/requirements, pricing, API shapes, current versions, library behavior). Model knowledge is stale for fast-moving tools; an unverified assumption that clears a real flaw — or invents a fake one — is exactly the failure this command exists to prevent. If a load-bearing fact can't be verified, say so and mark it for build-time confirmation rather than asserting it. Discard preferences.
4. **Self-check** — "Have I hunted a while and found nothing? Then report 'no real flaws' and stop." Don't manufacture a finding to justify the call.

## Report (tight, no padding)

```
## Flaw hunt: <target>

🔴 <one-line> — <exact section>
<the concrete failure it causes> → <recommendation>

🟡 <one-line> — <section>
<smaller but real; impact + recommendation>

No-flaw list (checked, fine): <sections/assumptions you verified and cleared>

Verdict: <N real flaws — recommend folding fixes in before proceeding> | <no real flaws — proceed>
```

If zero real flaws: say so plainly and give the go-ahead. If flaws exist: recommend incorporating the fixes, then continue (re-spec / re-plan / proceed) per the user's call.

## Plain-language pass (after the technical report)

Right after the report above, restate each flaw in **everyday language** — one or two sentences, no jargon, spelling out the concrete consequence a non-expert would grasp ("if X, then Y breaks and Z happens"). Keep the technical report; this is additive, so the user can grasp what each flaw *means* without parsing the detail.

```
## In plain terms
- 🔴 <flaw in one plain sentence — what actually goes wrong and why it matters>
- 🟡 <same, plainer>
```

## Then ask the user (AskUserQuestion)

If **zero real flaws**: skip the question — give the go-ahead and proceed. The plain-language pass is moot with nothing to fix.

If flaws exist: use the **AskUserQuestion tool** for the decision (not a plain-text prompt). Offer these options (recommended first):
- **Fold all in** — apply every fix to the plan/spec, then continue.
- **Fold some in** — the user picks which; they can name them, or use multiSelect over the flaws.
- **Proceed as-is** — change nothing, continue.
- **Discuss first** — talk through a flaw before deciding.

## After the user decides
- **Fold fixes in** → apply to the plan/spec, then note what changed.
- **Proceed as-is** → proceed; don't re-litigate.
