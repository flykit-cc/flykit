---
name: parse-statements
description: Parse bank transactions and classify them as taxable income, deductible expenses, or personal. Triggered when the user runs /steuer:parse-statements or asks to categorize their transactions for German tax filing.
argument-hint: [year]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Parse Bank Statements

You are classifying bank transactions for a German freelancer's Steuererklärung. Fetch a year of transactions from the configured source (default: Wise), classify each one, and write the result to disk for the next step in the pipeline.

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

This will:
1. Fetch transactions from the configured source (Wise by default).
2. Apply rule-based classification (`taxable`, `not_taxable`, `review`).
3. Write `./output/steuer-<YEAR>-classified.json` with all items.

If the script fails because `WISE_API_TOKEN` is missing, tell the user to:
1. Copy `${CLAUDE_PLUGIN_ROOT}/.env.example` to `.env` in the project root.
2. Add their token from https://wise.com/settings/account.
3. Re-run the skill.

## Step 3: Review Flagged Items

Read `./output/steuer-<YEAR>-classified.json` and find items where `classification === "review"`.

If there are 1-10 review items, present them in batches via `AskUserQuestion` (max 4 per call):
- header: "Classify"
- question: "[Description] — [amount] [currency] on [date]. How should this be classified?"
- options: "Business Income (taxable)", "Personal (not taxable)", "Skip — needs research"

If there are >10, summarize the patterns first ("12 entries from PayPal, 3 from unknown German names") and ask whether to bulk-classify by group or go through them one by one.

After collecting answers, update the JSON file in place by setting `classification` and `classificationReason` on each reviewed item.

## Step 4: Summary

Print a clean recap:
- Taxable income: count, total
- Not taxable: count
- Expenses: count, total
- Items still flagged for review (if any)

Then suggest the next step: "Run `/steuer:calculate-euer <YEAR>` to convert to EUR and generate the EÜR report."

## Reference Files

- `${CLAUDE_PLUGIN_ROOT}/references/tax-categories.md` — German EÜR category mapping
- `${CLAUDE_PLUGIN_ROOT}/scripts/sources/README.md` — how transaction sources work
