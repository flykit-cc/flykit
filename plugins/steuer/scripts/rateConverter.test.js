/**
 * Tests for rateConverter.js — deterministic, no network.
 *
 * Exercises pure behavior:
 *  - EUR transactions bypass the rate cache entirely (pass-through).
 *  - Non-EUR transactions with no cached rate surface null amountEUR / rate.
 *  - Rounding applied on the way out.
 *
 * Run via: node --test scripts/rateConverter.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { batchConvert, getRate } = require('./rateConverter');

test('EUR transactions pass through with rate=null and amountEUR=amount', async () => {
    const tx = [{ date: '2024-06-15', currency: 'EUR', amount: 100.5, description: 'EUR in' }];
    const out = await batchConvert(tx);
    assert.equal(out.length, 1);
    assert.equal(out[0].amountEUR, 100.5);
    assert.equal(out[0].rate, null);
    assert.equal(out[0].currency, 'EUR');
    assert.equal(out[0].description, 'EUR in');
});

test('non-EUR transactions with no cached rate emit null amountEUR and null rate', async () => {
    // Cache is module-private and empty in this test run (no prefetch() called).
    const tx = [{ date: '2024-06-15', currency: 'USD', amount: 100, description: 'USD in' }];
    const out = await batchConvert(tx);
    assert.equal(out[0].amountEUR, null);
    assert.equal(out[0].rate, null);
});

test('batchConvert preserves input order and unrelated fields', async () => {
    const tx = [
        { date: '2024-01-02', currency: 'EUR', amount: 10, id: 'a' },
        { date: '2024-01-03', currency: 'EUR', amount: 20, id: 'b' },
        { date: '2024-01-04', currency: 'EUR', amount: 30, id: 'c' },
    ];
    const out = await batchConvert(tx);
    assert.deepEqual(out.map(t => t.id), ['a', 'b', 'c']);
    assert.deepEqual(out.map(t => t.amountEUR), [10, 20, 30]);
});

test('getRate returns null when nothing is cached', () => {
    assert.equal(getRate('1970-01-01'), null);
});

test('batchConvert on empty list returns empty list', async () => {
    assert.deepEqual(await batchConvert([]), []);
});

test('EUR pass-through preserves zero and negative amounts', async () => {
    const tx = [
        { date: '2024-06-15', currency: 'EUR', amount: 0 },
        { date: '2024-06-15', currency: 'EUR', amount: -42.5 },
    ];
    const out = await batchConvert(tx);
    assert.equal(out[0].amountEUR, 0);
    assert.equal(out[1].amountEUR, -42.5);
});
