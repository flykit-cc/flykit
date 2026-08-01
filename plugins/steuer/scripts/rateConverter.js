/**
 * ECB exchange rates fetched directly from the ECB Data Portal (SDMX csvdata).
 * Free, no auth, serves official European Central Bank reference rates.
 *
 * Series D.{from}.{to}.SP00.A quotes {from} per 1 {to} (e.g. D.USD.EUR.SP00.A
 * is USD per 1 EUR). Converting an amount in {from} to {to} therefore DIVIDES
 * by the rate — the opposite of the old Frankfurter-based multiply.
 */

require('./lib/bootstrap');

const fs = require('fs');
const path = require('path');

const rateCache = new Map(); // dateKey -> rate

function extractDate(dateString) {
    return dateString.split(/[T ]/)[0];
}

/**
 * Split one CSV line into fields, honouring double-quoted fields
 * (with "" as an escaped quote). Good enough for SDMX csvdata output.
 */
function parseCsvLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            fields.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    fields.push(cur);
    return fields;
}

/**
 * Parse ECB SDMX csvdata text into [dateString, rate] pairs.
 * Looks up TIME_PERIOD / OBS_VALUE by header name so column order/extra
 * columns don't matter. Exported so tests can exercise it without network.
 */
function parseEcbCsv(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const header = parseCsvLine(lines[0]);
    const timeIdx = header.indexOf('TIME_PERIOD');
    const valueIdx = header.indexOf('OBS_VALUE');
    if (timeIdx === -1 || valueIdx === -1) {
        throw new Error('ECB CSV missing TIME_PERIOD or OBS_VALUE column');
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        const date = fields[timeIdx];
        const rate = parseFloat(fields[valueIdx]);
        if (date && Number.isFinite(rate)) rows.push([date, rate]);
    }
    return rows;
}

/**
 * Prefetch all daily ECB rates for a year in a single API call.
 * @param {number|string} year
 * @param {string} [from='USD']
 * @param {string} [to='EUR']
 * @param {{cacheDir?: string}} [options] - when cacheDir is set, reads
 *   ecb-{from}-{to}-{year}.csv from it if present (no network), and writes
 *   it after a successful fetch so future runs are offline.
 */
async function prefetchRates(year, from = 'USD', to = 'EUR', { cacheDir } = {}) {
    const cachePath = cacheDir ? path.join(cacheDir, `ecb-${from}-${to}-${year}.csv`) : null;

    let text;
    if (cachePath && fs.existsSync(cachePath)) {
        text = fs.readFileSync(cachePath, 'utf8');
        console.log(`  Loaded ECB exchange rates for ${year} (${from} -> ${to}) from cache`);
    } else {
        const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${from}.${to}.SP00.A?startPeriod=${year}-01-01&endPeriod=${year}-12-31&format=csvdata`;
        console.log(`  Fetching ECB exchange rates for ${year} (${from} -> ${to})...`);

        const response = await fetch(url, {
            headers: { 'User-Agent': 'flykit-steuer (https://github.com/flykit-cc/flykit)' },
        });
        if (!response.ok) {
            throw new Error(`ECB API error: ${response.status}`);
        }
        text = await response.text();

        if (cachePath) {
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(cachePath, text);
        }
    }

    const rows = parseEcbCsv(text);
    for (const [date, rate] of rows) {
        rateCache.set(date, rate);
    }
    console.log(`  Loaded ${rows.length} daily rates from ECB`);
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
 *
 * The cached rate is {from} per 1 EUR (see module header), so converting to
 * EUR DIVIDES: amountEUR = amount / rate.
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
                amountEUR: parseFloat((tx.amount / rate).toFixed(2)),
                rate: parseFloat(rate.toFixed(6)),
            });
        } else {
            results.push({ ...tx, amountEUR: null, rate: null });
        }
    }
    return results;
}

module.exports = { prefetchRates, getRate, batchConvert, parseEcbCsv };
