/**
 * Tests for parse-statements.js — manual-expenses loader.
 *
 * Run via: node --test scripts/parse-statements.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadManualExpenses, normalizeManualEntry } = require('./parse-statements');

function tmpFile(contents) {
    const p = path.join(os.tmpdir(), `manual-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, contents);
    return p;
}

test('loadManualExpenses: file not found throws', () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist-xyz.json');
    assert.throws(() => loadManualExpenses(missing), /not found/);
});

test('loadManualExpenses: malformed JSON throws', () => {
    const p = tmpFile('{not json');
    assert.throws(() => loadManualExpenses(p), /invalid JSON/);
    fs.unlinkSync(p);
});

test('loadManualExpenses: non-array top level throws', () => {
    const p = tmpFile(JSON.stringify({ date: '2024-01-01' }));
    assert.throws(() => loadManualExpenses(p), /must contain a JSON array/);
    fs.unlinkSync(p);
});

test('normalizeManualEntry: missing field throws', () => {
    assert.throws(
        () => normalizeManualEntry({ date: '2024-01-01', description: 'x', amount: 5 }, 0),
        /missing field "currency"/
    );
});

test('normalizeManualEntry: unsupported currency throws', () => {
    assert.throws(
        () => normalizeManualEntry({ date: '2024-01-01', description: 'x', amount: 5, currency: 'GBP' }, 0),
        /not supported/
    );
});

test('normalizeManualEntry: non-positive amount throws', () => {
    assert.throws(
        () => normalizeManualEntry({ date: '2024-01-01', description: 'x', amount: 0, currency: 'EUR' }, 0),
        /positive number/
    );
    assert.throws(
        () => normalizeManualEntry({ date: '2024-01-01', description: 'x', amount: -1, currency: 'EUR' }, 0),
        /positive number/
    );
});

test('normalizeManualEntry: bad date throws', () => {
    assert.throws(
        () => normalizeManualEntry({ date: 'Jan 1 2024', description: 'x', amount: 5, currency: 'EUR' }, 0),
        /invalid date/
    );
});

test('loadManualExpenses: happy path normalizes all fields and tags source=manual', () => {
    const data = [
        { date: '2024-03-15', description: 'Cash receipt', amount: 12.4, currency: 'EUR' },
        { date: '2024-04-02', description: 'USD cab', amount: 30, currency: 'usd', note: 'preserved' },
    ];
    const p = tmpFile(JSON.stringify(data));
    const out = loadManualExpenses(p);
    fs.unlinkSync(p);

    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
        date: '2024-03-15',
        description: 'Cash receipt',
        amount: 12.4,
        currency: 'EUR',
        source: 'manual',
        raw: data[0],
    });
    assert.equal(out[1].currency, 'USD');
    assert.equal(out[1].source, 'manual');
    assert.deepEqual(out[1].raw, data[1]);
});

test('merging manual expenses preserves existing and appends new', () => {
    const existing = [{ date: '2024-01-01', description: 'wise tx', amount: 50, currency: 'EUR', source: 'wise', raw: {} }];
    const data = [{ date: '2024-06-01', description: 'cash', amount: 10, currency: 'EUR' }];
    const p = tmpFile(JSON.stringify(data));
    const manual = loadManualExpenses(p);
    fs.unlinkSync(p);

    const merged = [...existing, ...manual];
    assert.equal(merged.length, 2);
    assert.equal(merged[0].source, 'wise');
    assert.equal(merged[1].source, 'manual');
});
