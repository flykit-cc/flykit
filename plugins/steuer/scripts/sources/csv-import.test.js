/**
 * Tests for csv-import.js — BOM stripping and per-row currency.
 *
 * Run via: node --test scripts/sources/csv-import.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchTransactions } = require('./csv-import');

function tmpCsv(contents) {
    const p = path.join(os.tmpdir(), `csv-import-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    fs.writeFileSync(p, contents);
    return p;
}

test('fetchTransactions: strips a UTF-8 BOM before parsing headers', async () => {
    // A BOM'd first header ("﻿date") would corrupt row.date lookups,
    // silently dropping every row (each row requires row.date to be kept).
    const csv = '﻿date,description,amount,currency\n' +
        '2024-03-15,Example Client GmbH,500.00,EUR\n';
    const p = tmpCsv(csv);
    const { income } = await fetchTransactions({ year: 2024, file: p });
    fs.unlinkSync(p);

    assert.equal(income.length, 1);
    assert.equal(income[0].date, '2024-03-15');
    assert.equal(income[0].amount, 500);
    assert.equal(income[0].currency, 'EUR');
});

test('fetchTransactions: reads the currency column per row, not just the first', async () => {
    const csv = 'date,description,amount,currency\n' +
        '2024-01-10,Example Client US,200.00,USD\n' +
        '2024-01-11,Example Client DE,150.00,EUR\n' +
        '2024-01-12,Example Vendor UK,-40.00,GBP\n';
    const p = tmpCsv(csv);
    const { income, expenses } = await fetchTransactions({ year: 2024, file: p });
    fs.unlinkSync(p);

    assert.equal(income.length, 2);
    assert.equal(income[0].currency, 'USD');
    assert.equal(income[1].currency, 'EUR');
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].currency, 'GBP');
});
