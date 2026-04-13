---
name: calculate-euer
description: Calculate the EÜR (Einnahmen-Überschuss-Rechnung) from classified transactions — convert USD to EUR via ECB rates, group expenses into German tax categories, and produce numbers ready for ELSTER. Triggered by /steuer:calculate-euer or when the user asks to compute their EÜR / Gewinn.
argument-hint: [year]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Calculate EÜR

You are computing the official EÜR numbers for ELSTER from previously classified transactions. The classifier already separated income from expenses; your job is to convert currencies, group by EÜR category, and produce a clean summary.

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
2. Fetch ECB rates for the year (single Frankfurter API call).
3. Convert all USD income/expenses to EUR.
4. Compute totals.
5. Write:
   - `./output/steuer-<YEAR>.csv` — all rows with EUR equivalents
   - `./output/steuer-<YEAR>.pdf` — formatted report for the Finanzamt
   - `./output/steuer-<YEAR>-summary.json` — totals and Gewinn

## Step 4: Group Expenses by EÜR Category

Read `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` to understand the mapping.

For each expense in `./output/steuer-<YEAR>-classified.json`, suggest an EÜR category based on the description:
- SaaS / cloud / domains / AI tools → `edv_kosten` (Zeile 56 / KZ 159)
- Internet / phone (apply business-use percentage) → `telekommunikation` (Zeile 52 / KZ 155)
- IHK, GEMA, business insurance → `beitraege_gebuehren` / `versicherungen` (Zeile 53 / KZ 156)
- Contractor / freelancer payouts → `fremdleistungen` (Zeile 30 / KZ 110)
- Hardware under 800 EUR net → `gwg_equipment` (Zeile 35 / KZ 146)
- Marketing / ads → `marketing` (Zeile 56 / KZ 159)
- Bank fees, misc → `sonstige` (Zeile 65 / KZ 168)

Use `AskUserQuestion` for ambiguous merchants (max 4 per call).

## Step 5: Apply Partial Deductions

Some categories aren't 100% deductible. Defaults:
- Internet: 40% business use
- Phone: 30% business use

Confirm via `AskUserQuestion`:
- header: "Deductions"
- question: "Internet defaults to 40% business, phone to 30%. Keep these or change?"
- options: "Keep defaults", "Change percentages"

## Step 6: Optional Add-ons

Ask via `AskUserQuestion`:
- header: "Homeoffice-Pauschale"
- question: "Claim the Homeoffice-Pauschale (up to 1,260 EUR/year)?"
- options: "Yes, claim it", "No"

## Step 7: Save Final Summary

Update `./output/steuer-<YEAR>-summary.json` with:
- `income_total_eur`
- `expense_total_eur` per category
- `gewinn_eur` (income minus expenses)
- ELSTER field map (which Zeile/KZ each total goes to)

Also write `./output/steuer-<YEAR>-summary.md` — a human-readable table of totals, ready to cross-reference with ELSTER. Use the field reference in `${CLAUDE_PLUGIN_ROOT}/references/elster-fields.md`.

## Step 8: Recap & Next Step

Print:
- Total income (EUR)
- Total expenses by category (EUR)
- **Gewinn**
- File paths produced (PDF, CSV, summary)

Then suggest: "Run `/steuer:elster-guide <YEAR>` to walk through the ELSTER forms field by field."

## Reference Files

- `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` — category definitions
- `${CLAUDE_PLUGIN_ROOT}/references/ecb-methodology.md` — how rates are sourced
- `${CLAUDE_PLUGIN_ROOT}/references/elster-fields.md` — Zeile / KZ mapping
