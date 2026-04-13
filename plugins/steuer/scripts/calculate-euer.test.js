/**
 * Tests for pure helpers in calculate-euer.js.
 *
 * main() is guarded by require.main === module, so requiring this file
 * doesn't trigger CLI execution (no dotenv, no fs, no network).
 *
 * Run via: node --test scripts/calculate-euer.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { totals, parseArgs } = require('./calculate-euer');

test('totals sums amountEUR across transactions', () => {
    const tx = [
        { amountEUR: 100.5 },
        { amountEUR: 200.25 },
        { amountEUR: 50 },
    ];
    assert.equal(totals(tx).totalEUR, 350.75);
});

test('totals treats missing / null amountEUR as zero', () => {
    const tx = [
        { amountEUR: 100 },
        { amountEUR: null },
        {},
        { amountEUR: 50 },
    ];
    assert.equal(totals(tx).totalEUR, 150);
});

test('totals on empty list is 0', () => {
    assert.equal(totals([]).totalEUR, 0);
});

test('parseArgs parses --key value pairs', () => {
    const args = parseArgs(['node', 'script', '--year', '2024', '--output', './out']);
    assert.equal(args.year, '2024');
    assert.equal(args.output, './out');
});

test('parseArgs treats bare flags as boolean true', () => {
    const args = parseArgs(['node', 'script', '--include-review', '--year', '2024']);
    assert.equal(args['include-review'], true);
    assert.equal(args.year, '2024');
});

test('parseArgs returns empty object when no flags given', () => {
    assert.deepEqual(parseArgs(['node', 'script']), {});
});
