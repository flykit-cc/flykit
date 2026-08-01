# ECB Exchange Rate Methodology

The steuer plugin converts foreign-currency income and expenses to EUR using **European Central Bank (ECB) daily reference rates**, fetched directly from the [ECB Data Portal API](https://data-api.ecb.europa.eu) (the authoritative source) and cached on disk next to your data so re-runs work offline.

## Why ECB rates?

The ECB publishes a single daily reference rate for major currencies vs EUR around 16:00 CET. These rates are:

- **Free and public** — no API key required.
- **Authoritative** — the de-facto standard for EU/German tax filings.
- **Defensible to the Finanzamt** — far more credible than scraped FX data.
- **Stable** — published once per trading day, no intra-day variation to argue about.

The Bundesfinanzministerium also publishes monthly reference rates (Umsatzsteuer-Umrechnungskurse) for VAT purposes. For income tax (EÜR / Einnahmeprinzip), per-day ECB rates are the conservative, defensible choice.

## How conversion works in this plugin

1. **Bulk prefetch.** A single ECB Data Portal call fetches the entire year of daily rates (cached to `ecb-USD-EUR-{year}.csv` in your output directory):

   ```
   https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod={year}-01-01&endPeriod={year}-12-31&format=csvdata
   ```

2. **Per-transaction lookup.** For each transaction dated `YYYY-MM-DD`, look up the ECB rate for that date.

3. **Weekend / holiday fallback.** The ECB does not publish rates on weekends or TARGET2 holidays. When a date has no rate, the plugin walks backwards up to 7 days to find the nearest previous trading day. This is the approach accepted by most German Finanzämter for cash-basis (Zufluss) accounting.

4. **Convert.** The ECB series quotes **USD per 1 EUR**, so the conversion divides: `EUR amount = original USD amount ÷ rate_for_date`. (Example: $10 at a rate of 1.25 USD/EUR → €8.00.)

5. **Round.** EUR amounts are rounded to 2 decimal places. The exchange rate used is stored alongside the converted value (audit trail).

## Audit trail

The CSV report includes an "Exchange Rate" column for every converted transaction, so the Finanzamt (or your Steuerberater) can verify any given conversion against the ECB's published history.

The PDF report includes a methodology disclaimer on the summary page.

## Currencies other than USD

The plugin defaults to USD → EUR. To support other currencies, change the `from` parameter when calling `prefetchRates(year, from, to)` in `scripts/rateConverter.js`. The ECB publishes daily reference rates for ~30 major currencies.

## Limitations

- The ECB does NOT publish rates for every world currency. Currencies outside the ECB's reference list need an alternative source (e.g. the Bundesbank, oanda, or your bank's actual conversion rate at the time of the transaction).
- For VAT (Umsatzsteuer) purposes specifically, you may need to use the BMF monthly average rates instead. Consult your Steuerberater if in doubt.
