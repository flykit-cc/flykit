/**
 * Tests for overlap.js — cross-source duplicate detection.
 *
 * Run via: node --test scripts/overlap.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectOverlap } = require('./overlap');

test('funding leg excluded, itemised transaction kept', () => {
    const txns = [
        { date: '2024-03-15', description: 'PAYPAL *EXAMPLESHOP', amount: 49.99, currency: 'EUR', source: 'card' },
        { date: '2024-03-16', description: 'Exampleshop', amount: 49.99, currency: 'EUR', source: 'paypal' },
    ];
    const { pairs, excluded } = detectOverlap(txns);
    assert.equal(pairs.length, 1);
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].source, 'card');
    assert.equal(pairs[0].fundingLeg.source, 'card');
});

test('ambiguous duplicate is reported but neither side excluded', () => {
    const txns = [
        { date: '2024-03-15', description: 'Example Shop Ltd', amount: 49.99, currency: 'EUR', source: 'card' },
        { date: '2024-03-16', description: 'Example Shop Ltd', amount: 49.99, currency: 'EUR', source: 'paypal' },
    ];
    const { pairs, excluded } = detectOverlap(txns);
    assert.equal(pairs.length, 1);
    assert.equal(excluded.length, 0);
    assert.equal(pairs[0].fundingLeg, null);
});

test('never excludes both sides even when both descriptions name each other source', () => {
    const txns = [
        { date: '2024-01-01', description: 'WISE TRANSFER PAYMENT', amount: 30, currency: 'EUR', source: 'card' },
        { date: '2024-01-01', description: 'CARD FUNDING REF', amount: 30, currency: 'EUR', source: 'wise' },
    ];
    const { excluded } = detectOverlap(txns);
    assert.equal(excluded.length, 1);
});

test('same-source rows are never paired', () => {
    const txns = [
        { date: '2024-03-15', description: 'Example Shop', amount: 49.99, currency: 'EUR', source: 'card' },
        { date: '2024-03-15', description: 'Example Shop', amount: 49.99, currency: 'EUR', source: 'card' },
    ];
    const { pairs, excluded } = detectOverlap(txns);
    assert.equal(pairs.length, 0);
    assert.equal(excluded.length, 0);
});

test('different currencies are not paired', () => {
    const txns = [
        { date: '2024-03-15', description: 'Example Shop', amount: 49.99, currency: 'EUR', source: 'card' },
        { date: '2024-03-15', description: 'Example Shop', amount: 49.99, currency: 'USD', source: 'paypal' },
    ];
    const { pairs } = detectOverlap(txns);
    assert.equal(pairs.length, 0);
});

test('amounts one cent apart are not paired', () => {
    const txns = [
        { date: '2024-03-15', description: 'Example Shop', amount: 49.99, currency: 'EUR', source: 'card' },
        { date: '2024-03-15', description: 'Example Shop', amount: 50.00, currency: 'EUR', source: 'paypal' },
    ];
    const { pairs } = detectOverlap(txns);
    assert.equal(pairs.length, 0);
});

test('window boundary: exactly windowDays apart is included', () => {
    const txns = [
        { date: '2024-03-01', description: 'Example Shop', amount: 20, currency: 'EUR', source: 'card' },
        { date: '2024-03-04', description: 'Example Shop', amount: 20, currency: 'EUR', source: 'paypal' }, // 3 days
    ];
    const { pairs } = detectOverlap(txns, { windowDays: 3 });
    assert.equal(pairs.length, 1);
});

test('window boundary: windowDays + 1 apart is excluded from candidates', () => {
    const txns = [
        { date: '2024-03-01', description: 'Example Shop', amount: 20, currency: 'EUR', source: 'card' },
        { date: '2024-03-05', description: 'Example Shop', amount: 20, currency: 'EUR', source: 'paypal' }, // 4 days
    ];
    const { pairs } = detectOverlap(txns, { windowDays: 3 });
    assert.equal(pairs.length, 0);
});
