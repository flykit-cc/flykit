---
name: calculate-euer
description: Calculate the EÜR (Einnahmen-Überschuss-Rechnung) from verdict-classified transactions — convert USD to EUR via ECB rates and total by verdict code. Refuses to run while any group is unresolved. Triggered by /steuer:calculate-euer or when the user asks to compute their EÜR / Gewinn.
argument-hint: [year]
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Calculate EÜR

You are computing the official EÜR numbers for ELSTER from a classified transactions file. Every group's verdict (business expense, apportioned, private, income, ...) was already decided during `parse-statements` — this step just converts currencies and totals what the verdict map already resolved.

## Step 1: Determine the Tax Year

If `$ARGUMENTS` contains a year, use it. Otherwise ask via `AskUserQuestion`:
- header: "Tax Year"
- question: "Which tax year should I calculate the EÜR for?"
- options: "2024", "2025", "Other"

## Step 2: Verify Classified Data Exists

Check whether `./output/steuer-<YEAR>-classified.json` exists.

If not, tell the user: "I need classified transactions first. Run `/steuer:parse-statements <YEAR>` and then come back."

## Step 3: Run the Calculator

Run the calculator script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/calculate-euer.js --year <YEAR> --output ./output
```

This will:
1. Read `./output/steuer-<YEAR>-classified.json`.
2. **Gate check first.** If any group's verdict is still `null` (MISSING) or coded `R`, the script refuses to run: it exits with status 2 and prints every offending group, e.g. `MISSING   example rideshare inc  net 480.00 USD out`. **MISSING always blocks**, no matter what flags are passed. If you see this, tell the user: "Some groups are still unresolved — run `/steuer:parse-statements <YEAR>` again to finish classifying them." Do not attempt to work around this yourself.
3. Fetch ECB reference rates for the year directly from the ECB data API (cached to `./output/ecb-USD-EUR-<YEAR>.csv`, so re-runs are offline).
4. Convert every non-EUR row to EUR.
5. Total by verdict code: income = code `I` groups; expenses = code `B` in full and code `A` at its stored `share` (applied once, already baked into the verdict — nothing to re-ask here); `P`/`V`/`N`/`NI`/`M`/`H` are excluded from the EÜR entirely.
6. Write:
   - `./output/steuer-<YEAR>.csv` — every row with its EUR equivalent and ECB rate
   - `./output/steuer-<YEAR>.pdf` — formatted report for the Finanzamt
   - `./output/steuer-<YEAR>-summary.json` — totals, `by_category` (EUR sum per verdict code), and `excluded` (what was left out and why)

### `--include-review`

Pass `--include-review` to admit `R`-coded groups **on the income side only** — this does not touch MISSING groups, and does not admit `R` on the expense side. Use it only if the user explicitly wants to file with review items still open (rare — normally go back and resolve them instead):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/calculate-euer.js --year <YEAR> --output ./output --include-review
```

## Step 4: Categories Are Already Set — Don't Re-Ask

Expense categorization and apportionment (the `A` share) were decided once, per merchant, in the verdict map during `parse-statements` — do not ask the user again here for business-use percentages or per-expense categories. If a category or share looks wrong, the fix is: edit `./output/verdicts-<YEAR>.json`, re-run `parse-statements` to re-gate and re-freeze `classified.json`, then re-run this script. See `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` for the category vocabulary used in the verdict map.

## Step 5: Homeoffice-Pauschale (optional, not transaction-based)

This is a flat allowance, not derived from any bank transaction, so the script never computes it. Ask via `AskUserQuestion`:
- header: "Homeoffice-Pauschale"
- question: "Claim the Homeoffice-Pauschale (up to 1,260 EUR/year)?"
- options: "Yes, claim it", "No"

If yes, note the amount separately when you present the summary (Step 6) — it is not written into `steuer-<YEAR>-summary.json`, since that file mirrors exactly what the script computed from transactions. Carry it forward as a plain note for `/steuer:elster-guide`.

## Step 6: Recap & Next Step

Read `./output/steuer-<YEAR>-summary.json` and present:
- Total income (EUR)
- Total expenses (EUR), broken down by `by_category`
- **Gewinn**
- `excluded` block, if non-empty (what was left out and why — usually private/Vorsorge/internal)
- Homeoffice-Pauschale note, if claimed in Step 5
- File paths produced (PDF, CSV, summary JSON)

Then suggest: "Run `/steuer:elster-guide <YEAR>` to walk through the ELSTER forms field by field."

## PDF Header Env Vars

The generated PDF header renders any of `ACCOUNT_NAME`, `ACCOUNT_BANK`, `ACCOUNT_BANK_ADDRESS`, `ACCOUNT_TYPE`, `ACCOUNT_ROUTING`, and `ACCOUNT_NUMBER` that are set in the user's `.env`. Only fields that are set appear; no blank lines are emitted. If none are set the header block is omitted. If the user wants a richer header, tell them to add the relevant `ACCOUNT_*` vars to their `.env` and re-run.

## Reference Files

- `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` — category definitions
- `${CLAUDE_PLUGIN_ROOT}/references/ecb-methodology.md` — how rates are sourced
- `${CLAUDE_PLUGIN_ROOT}/references/elster-fields.md` — Zeile / KZ mapping
