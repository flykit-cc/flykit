/**
 * ECB exchange rates via the Frankfurter API.
 * Free, no auth, serves official European Central Bank reference rates.
 */

const rateCache = new Map(); // dateKey -> rate

function extractDate(dateString) {
    return dateString.split(/[T ]/)[0];
}

/**
 * Prefetch all daily ECB rates for a year in a single API call.
 * @param {number|string} year
 * @param {string} [from='USD']
 * @param {string} [to='EUR']
 */
async function prefetchRates(year, from = 'USD', to = 'EUR') {
    const url = `https://api.frankfurter.dev/v1/${year}-01-01..${year}-12-31?from=${from}&to=${to}`;
    console.log(`  Fetching ECB exchange rates for ${year} (${from} -> ${to})...`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Frankfurter API error: ${response.status}`);
    }

    const data = await response.json();
    for (const [date, rates] of Object.entries(data.rates)) {
        rateCache.set(date, rates[to]);
    }
    console.log(`  Loaded ${Object.keys(data.rates).length} daily rates from ECB`);
}

function getRate(dateString) {
    const dateKey = extractDate(dateString);
    if (rateCache.has(dateKey)) return rateCache.get(dateKey);

    // Fall back to nearest previous trading day (weekends, holidays).
    const date = new Date(dateKey);
    for (let i = 1; i <= 7; i++) {
        date.setDate(date.getDate() - 1);
        const prevKey = date.toISOString().split('T')[0];
        if (rateCache.has(prevKey)) return rateCache.get(prevKey);
    }
    console.warn(`No ECB rate found for ${dateKey}`);
    return null;
}

/**
 * Convert a list of normalized transactions to EUR.
 * Adds `amountEUR` and `rate` fields to each item.
 * EUR-denominated transactions pass through with amountEUR = amount, rate = null.
 */
async function batchConvert(transactions) {
    const results = [];
    for (const tx of transactions) {
        if (tx.currency === 'EUR') {
            results.push({ ...tx, amountEUR: tx.amount, rate: null });
            continue;
        }
        const rate = getRate(tx.date);
        if (rate != null) {
            results.push({
                ...tx,
                amountEUR: parseFloat((tx.amount * rate).toFixed(2)),
                rate: parseFloat(rate.toFixed(6)),
            });
        } else {
            results.push({ ...tx, amountEUR: null, rate: null });
        }
    }
    return results;
}

module.exports = { prefetchRates, getRate, batchConvert };
