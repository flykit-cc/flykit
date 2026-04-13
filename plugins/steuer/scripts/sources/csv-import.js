/**
 * Generic CSV transaction source (placeholder / minimal implementation).
 *
 * Reads a CSV file with at least these columns:
 *   date         ISO date (YYYY-MM-DD)
 *   description  Counterparty / merchant text
 *   amount       Signed decimal — positive for income, negative for expense
 *   currency     ISO 4217 code (EUR, USD, ...)
 *
 * Returns the same { income, expenses } shape as other sources.
 *
 * Most banks export richer columns. Add bank-specific adapters in this file or
 * create a new source under scripts/sources/<bankname>.js.
 */

require('../lib/bootstrap');

const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
    // Minimal CSV split — handles double-quoted fields containing commas.
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (c === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out.map(s => s.trim());
}

function readCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];
    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    return lines.slice(1).map(line => {
        const cells = parseCsvLine(line);
        const row = {};
        headers.forEach((h, i) => { row[h] = cells[i]; });
        return row;
    });
}

/**
 * @param {Object} opts
 * @param {number} opts.year - Tax year filter
 * @param {string} opts.file - Absolute path to CSV file
 */
async function fetchTransactions({ year, file } = {}) {
    if (!file) throw new Error('csv-import: `file` option is required (absolute path to CSV).');
    if (!fs.existsSync(file)) throw new Error(`CSV file not found: ${file}`);

    const rows = readCsv(path.resolve(file));
    const income = [];
    const expenses = [];

    for (const row of rows) {
        const date = row.date;
        if (!date) continue;
        if (year && !date.startsWith(String(year))) continue;

        const amount = parseFloat((row.amount || '').replace(/,/g, ''));
        if (Number.isNaN(amount)) continue;

        const tx = {
            date,
            description: row.description || '',
            amount: Math.abs(amount),
            currency: (row.currency || 'EUR').toUpperCase(),
            source: 'csv',
            raw: row,
        };

        if (amount >= 0) income.push(tx);
        else expenses.push(tx);
    }

    income.sort((a, b) => a.date.localeCompare(b.date));
    expenses.sort((a, b) => a.date.localeCompare(b.date));
    return { income, expenses };
}

module.exports = { fetchTransactions };
