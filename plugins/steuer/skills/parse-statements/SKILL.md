---
name: parse-statements
description: Parse bank transactions, net pre-auth/reversals per merchant, and classify each group via the verdict map. Triggered when the user runs /steuer:parse-statements or asks to categorize their transactions for German tax filing.
argument-hint: [year]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Parse Bank Statements

You are classifying bank transactions for a German freelancer's Steuererklärung. The script fetches a year of transactions, filters out rows that never moved money, nets each merchant group against its own reversals, and looks each group up in the verdict map. Your job is to resolve everything the script reports `MISSING` — by deciding it yourself when you can, or asking the user when you can't — until every row is accounted for.

## Step 1: Determine the Tax Year

If `$ARGUMENTS` contains a year (4-digit, e.g. `2024`), use it.

Otherwise, ask via `AskUserQuestion`:
- header: "Tax Year"
- question: "Which tax year should I parse statements for?"
- options: "2024", "2025", "Other"

If "Other", ask the user to type the year.

## Step 2: Run the Parser

Run the parser script in a Bash call:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/parse-statements.js --year <YEAR> --output ./output
```

This runs the full pipeline — filter (drop rows that moved no money) → net (per-merchant group, offsetting reversals against holds) → overlap (cross-source duplicates) → verdicts (look up each group in the verdict map) → reconcile (assert every row landed somewhere) — and writes:

- `./output/steuer-<YEAR>-classified.json` — `{ year, source, income, expenses, groups, reconciliation }`. Every transaction carries `groupKey`, `verdictCode` (`null` until resolved), and `netted`. Every group carries `key`, `currency`, `direction`, `gross`, `net`, `credits`, `flagged`, `status` (`classified` or `missing`), and `verdict`.
- `./output/verdicts-<YEAR>.json` — the verdict map (created empty on first run; never overwritten with fewer entries than it already has — pass `--force` if you genuinely need to shrink it).

The console output always ends with the reconcile line and the MISSING block:

```
row-count check: 1816 == 1816 -> OK — every row accounted for
MISSING (3 groups):
  USD 480.00 out  example rideshare inc  (6 txns)
  EUR 120.00 in   example marketplace gmbh  (2 txns)
  EUR 19.99 out   example gym  (1 txns)
```

`MISSING` is already sorted by `|net|` descending — biggest unresolved amount first. If the count is 0 and the reconcile line says `OK`, skip to Step 5.

### Other flags

- `--profile <all|personal|business>` (Wise only, default `all`).
- `--manual-expenses <path>` — merge a JSON array of `{ date, description, amount, currency }` extra expenses (`currency` must be `EUR` or `USD`, `amount` positive).
- `--source-label <name>` — relabel this run's `source` field (e.g. a PayPal CSV import labeled `paypal` so it matches `PAYPAL *...` card descriptions during overlap detection).
- `--prefer-source <name>` — when overlap detection finds the same spend in two sources, keep the named source's row and exclude the other.
- `--verdicts <path>` — verdict file location (default `<output>/verdicts-<YEAR>.json`).
- `--force` — allow writing a verdict map with fewer entries than the one on disk.

If the script fails because `WISE_API_TOKEN` is missing, tell the user to:
1. Copy `${CLAUDE_PLUGIN_ROOT}/.env.example` to `.env` in the project root.
2. Add their token from https://wise.com/settings/account.
3. Re-run the skill.

## Step 3: Resolve Every MISSING Group

Work the MISSING list **largest `|net|` first** — that's the order the script already printed it in. For each group:

1. **Decide it yourself if you can.** Read the merchant/description text and, if the transactions are attached, their `raw` fields (payment reference, counterparty). If it's unambiguous — an obvious SaaS tool, an obvious grocery store, an obvious client payment — write the verdict straight into `verdicts-<YEAR>.json` yourself. Don't ask the user something you can already tell from the data.
2. **Ask if you can't.** Anything genuinely ambiguous goes to the user via `AskUserQuestion`, **one group at a time** (not batched — each question needs room for the full amount + consequence). Every option must state:
   - the EUR (or original-currency) amount and direction,
   - the tax consequence in plain terms ("deductible, reduces Gewinn by ~€X" / "not deductible, no EÜR effect" / "excluded, needs a Steuerberater"),
   - the payment reference, quoted, if any transaction in the group has one.

   Example shape:
   - header: "Classify: example rideshare inc"
   - question: "example rideshare inc — $480.00 out across 6 txns (netted from pre-auth holds + fare). Ref: \"TRIP-88213\". How should this be treated?"
   - options: "Business travel (B) — fully deductible", "Private (P) — not deductible", "Apportioned (A) — partial business use", "Needs research (R) — park it, ask later"

3. **Save immediately.** The moment a verdict is decided — by you or by the user — write it into `verdicts-<YEAR>.json` before moving to the next group. Read the file, add the entry, write the whole object back pretty-printed (4-space indent, trailing newline) so the shrink-guard and formatting stay consistent with what the script itself writes. Never batch answers to write once at the end — a crash or interrupt would lose everything decided so far.

Also glance at any `flagged: true` group even if it's not MISSING — that flag means the netting itself is uncertain (a partial reversal well below the hold amount), so its `verdict` deserves a second look before you trust the number.

### Verdict map schema

`verdicts-<YEAR>.json` is a flat object. Each key is a lowercase substring that must appear in the group's `key` (merchant, falling back to payee/payer/description) — it doesn't need to be the full string, just specific enough not to catch merchants it shouldn't. **Longest matching key wins; on a length tie, the later entry in the file wins** — so don't rely on ordering to disambiguate two keys of the same length; make the key itself specific instead.

```json
{
  "example hosting gmbh": { "code": "B", "category": "Hosting" },
  "example coworking":    { "code": "A", "category": "Arbeitsplatz", "share": 0.5 },
  "example gym":          { "code": "P" },
  "example rideshare inc": { "code": "R" }
}
```

- `code` — one of the ten below. Unknown code throws (fail closed).
- `category` — free-text label for the audit trail and the EÜR line (see `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` for suggested names). Optional but recommended.
- `share` — **required** for code `A`, a number in `(0, 1]`. The apportioned fraction is applied once, here — don't also ask about it later.

| Code | Meaning |
|------|---------|
| `B`  | Business expense — fully deductible |
| `A`  | Apportioned business expense — deductible at `share` |
| `P`  | Private expense — excluded, no EÜR effect |
| `V`  | Vorsorge (retirement/insurance) — excluded from EÜR, handled elsewhere on the ESt |
| `N`  | Not an expense — internal transfer or capital movement |
| `R`  | Needs user review — parked, blocks `calculate-euer` unless `--include-review` |
| `M`  | Medical expense (§33 EStG) |
| `H`  | Household services (§35a EStG) |
| `I`  | Taxable income |
| `NI` | Inbound money that isn't income (e.g. a refund, a loan) |

**Never give an issuer or payment-processor name its own category** (e.g. a bare `"paypal"` or `"stripe"` entry). Those strings appear inside many unrelated merchants' descriptions — a category on the issuer name silently swallows every one of them the next time this runs. Key on the actual merchant instead.

## Step 4: Re-run Until Clean

Re-run the Step 2 command. It re-loads the verdict map, re-classifies, and re-reconciles. Repeat Steps 3–4 until:

- the reconcile line says `-> OK — every row accounted for`, and
- the `MISSING` block shows `(0 groups)`.

Only then move to Step 5. Don't offer `calculate-euer` while either condition is unmet — it will refuse to run anyway (see the `calculate-euer` skill).

## Step 5: Summary

Read `./output/steuer-<YEAR>-classified.json` and print a clean recap from `reconciliation.buckets`:
- Income (`INCOME` bucket): row count, sum
- Not taxable inbound (`NOT_INCOME`): row count
- Expenses (`EXPENSE`): row count, sum
- Internal/transfers (`INTERNAL`): row count
- Confirm `UNKNOWN` is 0 (it should be, per Step 4)

Then suggest the next step: "Run `/steuer:calculate-euer <YEAR>` to convert to EUR and generate the EÜR report."

## Reference Files

- `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` — German EÜR category mapping (use for the `category` field above)
- `${CLAUDE_PLUGIN_ROOT}/scripts/sources/README.md` — how transaction sources work
