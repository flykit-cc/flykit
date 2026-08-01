/**
 * Tests for netting.js — grouping, drop-no-money filtering, per-group netting.
 *
 * Run via: node --test scripts/netting.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { groupKey, filterMoved, netGroups } = require('./netting');

test('netGroups: pre-auth holds net to the real fare and flag past the threshold', () => {
    // Three -20 pre-auth holds against one ride, two of them released as
    // credits — the real fare is 24.50, but naive summing of debits would
    // report 60.00 spent.
    const txns = [
        { merchant: 'ride-hail-x', amount: -20.00, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'ride-hail-x', amount: -20.00, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'ride-hail-x', amount: -20.00, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'ride-hail-x', amount: 18.50, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'ride-hail-x', amount: 17.00, currency: 'EUR', source: 'wise', raw: {} },
    ];

    const groups = netGroups(txns);
    assert.equal(groups.length, 1);
    const [g] = groups;
    assert.equal(g.key, 'ride-hail-x');
    assert.equal(g.gross, 60);
    assert.equal(g.credits, 35.5);
    assert.equal(g.net, 24.5);
    assert.equal(g.direction, 'out');
    assert.equal(g.flagged, true);
});

test('netGroups: a partial reversal below the flag threshold is not flagged', () => {
    // 10% refunded on a 100.00 charge — well under the default 0.2 threshold.
    const txns = [
        { merchant: 'example-hosting-gmbh', amount: -100.00, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'example-hosting-gmbh', amount: 10.00, currency: 'EUR', source: 'wise', raw: {} },
    ];

    const [g] = netGroups(txns);
    assert.equal(g.gross, 100);
    assert.equal(g.credits, 10);
    assert.equal(g.net, 90);
    assert.equal(g.direction, 'out');
    assert.equal(g.flagged, false);
});

test('netGroups: a mixed group summing positive nets to direction "in"', () => {
    // A small debit outweighed by a larger credit — e.g. a merchant refund
    // exceeding a prior partial charge.
    const txns = [
        { merchant: 'example-refund-shop', amount: -5.00, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'example-refund-shop', amount: 50.00, currency: 'EUR', source: 'wise', raw: {} },
    ];

    const [g] = netGroups(txns);
    assert.equal(g.net, 45);
    assert.equal(g.direction, 'in');
    assert.equal(g.flagged, false);
});

test('filterMoved: drops zero-amount rows', () => {
    const txns = [
        { merchant: 'example-hosting-gmbh', amount: 0, currency: 'EUR', source: 'wise', raw: {} },
        { merchant: 'example-hosting-gmbh', amount: -12, currency: 'EUR', source: 'wise', raw: {} },
    ];

    const { kept, dropped } = filterMoved(txns);
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].amount, 0);
});

test('filterMoved: drops rows with raw.balanceImpact "Memo"', () => {
    const txns = [
        { merchant: 'example-hosting-gmbh', amount: -5, currency: 'EUR', source: 'wise', raw: { balanceImpact: 'Memo' } },
        { merchant: 'example-hosting-gmbh', amount: -5, currency: 'EUR', source: 'wise', raw: {} },
    ];

    const { kept, dropped } = filterMoved(txns);
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].raw.balanceImpact, 'Memo');
});

test('filterMoved: drops CANCELLED, DECLINED and REFUNDED_PREAUTH rows', () => {
    const txns = [
        { merchant: 'example-hosting-gmbh', amount: -5, currency: 'EUR', source: 'wise', raw: { status: 'CANCELLED' } },
        { merchant: 'example-hosting-gmbh', amount: -5, currency: 'EUR', source: 'wise', raw: { status: 'DECLINED' } },
        { merchant: 'example-hosting-gmbh', amount: -5, currency: 'EUR', source: 'wise', raw: { status: 'REFUNDED_PREAUTH' } },
        { merchant: 'example-hosting-gmbh', amount: -5, currency: 'EUR', source: 'wise', raw: { status: 'COMPLETED' } },
    ];

    const { kept, dropped } = filterMoved(txns);
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 3);
});

test('groupKey: throws when a transaction has no grouping key', () => {
    assert.throws(
        () => groupKey({ amount: -5, currency: 'EUR', raw: {} }),
        /transaction has no grouping key/
    );
});

test('groupKey: falls back through payee, payer, description', () => {
    assert.equal(groupKey({ merchant: ' Example Hosting GmbH ' }), 'example hosting gmbh');
    assert.equal(groupKey({ payee: ' Example Payee ' }), 'example payee');
    assert.equal(groupKey({ payer: ' Example Payer ' }), 'example payer');
    assert.equal(groupKey({ description: ' Example Description ' }), 'example description');
});
