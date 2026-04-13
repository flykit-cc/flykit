# Transaction Sources

A "source" is a small adapter that fetches transactions from a bank, payment
processor, or file format and normalizes them to a common shape.

The rest of the plugin (rate conversion, classification, PDF/CSV generation)
is bank-agnostic — it only sees normalized transactions.

## Contract

Every source exports a single async function:

```js
async function fetchTransactions(options) {
    return { income: [...], expenses: [...] };
}
```

Each transaction is an object with this shape:

```js
{
    date: '2024-03-15',         // ISO date string (YYYY-MM-DD)
    description: 'ACME Corp',   // Human-readable counterparty / merchant
    amount: 2240.00,            // Always positive; sign is implicit (income vs expense)
    currency: 'USD',            // ISO 4217 currency code
    source: 'wise',             // Identifier of the source that produced this row
    raw: { /* original */ }     // Optional: source-specific metadata
}
```

Sources MUST sort `income` and `expenses` ascending by `date`.

## Available sources

| File | Purpose | Required options |
|------|---------|------------------|
| `wise.js` | Wise (TransferWise) Activities API | `year`, optional `profile` ('all' \| 'personal' \| 'business' \| ID) |
| `csv-import.js` | Generic CSV import | `year`, `file` (absolute path) |

## Adding a new source

1. Create `scripts/sources/<name>.js`.
2. Export `fetchTransactions(opts)` returning the normalized shape above.
3. Add an entry to this README.
4. (Optional) Wire it up in `scripts/parse-statements.js` so the skill can
   select it via a `--source <name>` flag.

Sources should:
- Read credentials from `process.env` (use clear error messages when missing).
- Handle pagination internally.
- Filter to the requested year before returning.
- Be runnable in isolation: `node -e "require('./wise').fetchTransactions({year:2024}).then(console.log)"`.
