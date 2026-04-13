# steuer

> German freelancer tax filing for Claude Code. Fetch transactions from your bank, classify them with AI, calculate the EÜR, and walk through ELSTER step by step.

This plugin is for Freiberufler (German self-employed professionals — §18 EStG) who want to prepare their annual tax return without doing all the data wrangling by hand. It currently supports [Wise](https://wise.com) as a transaction source, with a generic CSV importer for everything else, and a clean extension point for adding more banks.

## Installation

In Claude Code:

```
/plugin marketplace add flykit-cc/flykit
/plugin install steuer@flykit
```

That's it. The first time you invoke any `/steuer:*` skill, the plugin installs its npm dependencies automatically (requires Node.js >= 18 with `npm` on your `PATH`). Subsequent runs are instant.

## Where to run it

Steuer acts on your current working directory — it reads your bank exports from there and writes reports back to the same place. You don't need a "steuer project" or a repo; just pick a folder where you want your tax data to live:

```bash
mkdir -p ~/taxes/2024 && cd ~/taxes/2024
# drop your Wise CSV here, then:
claude
# inside Claude Code:
/steuer:parse-statements 2024
```

Every skill works the same way — whatever directory you launched Claude Code from is what the plugin operates on.

## Setup

Create a `.env` file in your project root (the directory you run Claude Code from):

```ini
# Required if you use the Wise source
WISE_API_TOKEN=your_token_here

# Optional — printed in the PDF report header
ACCOUNT_NAME=Your Name
ACCOUNT_BANK=Your Bank
```

Get a Wise token at [wise.com → Settings → API tokens](https://wise.com/settings/account).

The `.env.example` file in this plugin shows all supported variables.

Optional preferences (default year, source, output dir) can live in `~/.config/flykit/steuer/config.json`:

```json
{
  "default_year": 2025,
  "default_source": "wise",
  "output_dir": "./output"
}
```

## Usage

The plugin exposes three skills you invoke as slash commands:

### 1. `/steuer:parse-statements [year]`

Fetches a year of transactions from the configured source and classifies each one as `taxable`, `not_taxable`, or `review`. Asks you to confirm the ambiguous ones interactively.

Output: `./output/steuer-<YEAR>-classified.json`

### 2. `/steuer:calculate-euer [year]`

Reads the classified file, converts USD to EUR via daily ECB rates (Frankfurter API), groups expenses by EÜR category, and produces:

- `./output/steuer-<YEAR>.pdf` — formatted report for the Finanzamt
- `./output/steuer-<YEAR>.csv` — raw rows with EUR equivalents
- `./output/steuer-<YEAR>-summary.json` — totals + Gewinn
- `./output/steuer-<YEAR>-summary.md` — human-readable summary

### 3. `/steuer:elster-guide [year]`

Walks you through filling in each ELSTER form. You paste a screenshot or text of the page; the skill tells you exactly which value goes in each field, looking up your numbers from the EÜR summary.

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
