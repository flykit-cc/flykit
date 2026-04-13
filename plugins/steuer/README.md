# steuer

> German freelancer tax filing for Claude Code. Fetch transactions from your bank, classify them with AI, calculate the EÜR, and walk through ELSTER step by step.

This plugin is for Freiberufler (German self-employed professionals — §18 EStG) who want to prepare their annual tax return without doing all the data wrangling by hand. It currently supports [Wise](https://wise.com) as a transaction source, with a generic CSV importer for everything else, and a clean extension point for adding more banks.

## What you end up with

After running the three skills for a given year, your working directory contains:

| File | What it is |
|------|------------|
| `steuer-<YEAR>-classified.json` | Every transaction, labelled `taxable` / `not_taxable` / `review`. Edit by hand if needed. |
| `steuer-<YEAR>.pdf` | Formatted EÜR report with totals, ready for the Finanzamt. |
| `steuer-<YEAR>.csv` | Every row with its EUR equivalent and ECB rate. |
| `steuer-<YEAR>-summary.json` | Totals + Gewinn + ELSTER field map. |

Plus an interactive ELSTER walkthrough: you paste a screenshot of each form page, the plugin tells you which value goes in each field.

## Privacy

The plugin runs locally inside your Claude Code session. There are no flykit servers, no telemetry, nothing phones home. Wise API calls go directly from your machine to `api.wise.com`; ECB rates come from the public Frankfurter API. Your bank token lives in a local `.env` file and never leaves your machine.

## Prerequisites

- Node.js >= 18
- `npm` on your `PATH` (the plugin installs its own dependencies on first run)

## Installation

In Claude Code:

```
/plugin marketplace add flykit-cc/flykit
/plugin install steuer@flykit
```

First invocation of any `/steuer:*` skill installs npm dependencies automatically. Subsequent runs are instant.

## Where to run it

Steuer acts on your current working directory — it reads config from there and writes reports back to the same place. You don't need a "steuer project" or a repo; just pick a folder where you want your tax data to live:

```bash
mkdir -p ~/taxes/2024 && cd ~/taxes/2024
claude
# inside Claude Code:
/steuer:parse-statements 2024
```

## Transaction source: Wise API or CSV

Two ways to get transactions in. Pick one per run with `--source`; default is Wise.

| | Wise API (default) | CSV import |
|---|---|---|
| How | Plugin calls `api.wise.com` with your read-only token | You export a CSV from your bank's UI and point the plugin at it |
| Coverage | Full year, all profiles, incl. third-party deposits (e.g. Deel wiring money in), card payments, direct debits | Whatever the export includes — usually just transfers |
| Setup | One token, pasted once into `.env` | Re-export every time you re-run |
| Account types | Personal Wise accounts only (see below) | Any bank that exports CSV |

**Why the Wise API beats the CSV.** Wise's standard CSV export omits activity that isn't a transfer out of your balance — including inbound third-party payouts (payroll platforms, client bank wires), card spend, and direct debits. The API sees all of it. If you only use CSV, you will silently miss income and expenses.

**Current Wise limitation.** The client works with personal Wise accounts (where SCA/PSD2 is not enforced on the API). Business accounts have SCA complications that this client does not currently handle. Patches welcome.

**CSV fallback.** Useful if you're on a non-Wise bank or want to feed in a one-off statement. See `scripts/sources/csv-import.js` for the accepted columns (`date`, `description`, `amount`, `currency`).

## Setup

Create a `.env` file in the directory you run Claude Code from:

```ini
# Required if you use the Wise source
WISE_API_TOKEN=your_token_here

# Optional — printed in the PDF report header
ACCOUNT_NAME=Your Name
ACCOUNT_BANK=Your Bank
```

**Getting a Wise token.** [wise.com → Settings → API tokens](https://wise.com/settings/account). Read-only scope is enough — the plugin never writes to Wise. The token stays in your local `.env`; it's read by `process.env.WISE_API_TOKEN` on your machine and used only to call `api.wise.com` directly.

**More PDF-header fields are on the way.** Issue [#13](https://github.com/flykit-cc/flykit/issues/13) tracks wiring up `ACCOUNT_ROUTING`, `ACCOUNT_NUMBER`, `ACCOUNT_TYPE`, and `ACCOUNT_BANK_ADDRESS` for the PDF header. Until that lands, don't bother setting them — they have no effect.

Optional non-secret preferences (default year, source, output dir) can live in `~/.config/flykit/steuer/config.json`:

```json
{
  "default_year": 2025,
  "default_source": "wise",
  "output_dir": "./output"
}
```

## Usage

The three skills form a pipeline:

1. **parse** — fetch raw transactions, classify income, write a JSON blob.
2. **review** (manual) — open the JSON, fix anything the classifier wasn't sure about.
3. **calculate** — convert currencies, aggregate, emit the PDF / CSV / summary.

Then `elster-guide` reads the summary and walks you through the forms.

### 1. `/steuer:parse-statements [year]`

Fetches a year of transactions from the configured source and classifies each income item as `taxable`, `not_taxable`, or `review`. Expenses pass through unchanged. The skill prompts you to resolve ambiguous items interactively.

Output: `./output/steuer-<YEAR>-classified.json`

This file is the single source of truth for the next step. Edit it by hand if you disagree with any classification — the calculator reads whatever's on disk.

### 2. `/steuer:calculate-euer [year]`

Reads the classified JSON, fetches daily ECB rates (Frankfurter API), converts every USD row to EUR, groups expenses into EÜR categories, and writes:

- `./output/steuer-<YEAR>.pdf` — formatted report for the Finanzamt
- `./output/steuer-<YEAR>.csv` — every row with its EUR equivalent and rate
- `./output/steuer-<YEAR>-summary.json` — totals, Gewinn, and ELSTER field map

Pass `--include-review` to treat any income still flagged `review` as taxable.

### 3. `/steuer:elster-guide [year]`

Walks you through filling in each ELSTER form. You paste a screenshot or text of the page; the skill identifies the form, looks up your numbers in the summary JSON, and tells you exactly which value goes in each field.

## Architecture

```
plugins/steuer/
├── skills/                   Skill definitions (what users invoke)
│   ├── parse-statements/SKILL.md
│   ├── calculate-euer/SKILL.md
│   └── elster-guide/SKILL.md
├── scripts/
│   ├── sources/              Bank-agnostic transaction sources
│   │   ├── wise.js
│   │   ├── csv-import.js
│   │   └── README.md         Source contract — read this to add a new bank
│   ├── rateConverter.js      ECB rates via Frankfurter
│   ├── classifier.js         Rule-based income classifier
│   ├── pdfGenerator.js       PDF report
│   ├── csvGenerator.js       CSV report
│   ├── parse-statements.js   CLI for the parse-statements skill
│   ├── calculate-euer.js     CLI for the calculate-euer skill
│   └── lib/config.js         Config loader
└── references/               Generic reference docs (no personal data)
    ├── tax-categories.md
    ├── ecb-methodology.md
    └── elster-fields.md
```

### Adding a new bank source

1. Create `scripts/sources/<bankname>.js`.
2. Export `async function fetchTransactions({ year, ...opts })` returning `{ income: [], expenses: [] }`.
3. Each transaction: `{ date, description, amount, currency, source, raw }` (positive `amount`, `date` = `YYYY-MM-DD`).
4. See `scripts/sources/README.md` for the full contract.
5. Wire it up by passing `--source <bankname>` to the CLI scripts.

## Tax disclaimer

This plugin is a tool, not tax advice. It automates data collection, currency conversion, and form-field lookup, but it does not replace a Steuerberater. Always verify your numbers against the actual ELSTER form and consult a tax professional for anything non-obvious. The maintainer is not responsible for filing errors, penalties, or audit outcomes.

The plugin does **not** store personal data (StNr, IdNr, name, address, bank details). Keep those in a private file outside the plugin.

## License

[MIT](./LICENSE)
