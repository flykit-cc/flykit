/**
 * Tests for reconcile.js — full-coverage row-count assertion.
 *
 * Run via: node --test scripts/reconcile.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BUCKETS, bucketFor, reconcile } = require('./reconcile');

// Hand-built Group fixtures (netting.js shape) — invented data only.
function group(key, txnCount, net) {
    return {
        key,
        txns: new Array(txnCount).fill(0).map(() => ({ merchant: key })),
        gross: net,
        net,
        credits: 0,
        flagged: false,
        direction: net >= 0 ? 'in' : 'out',
    };
}

test('exposes the BUCKETS list', () => {
    assert.deepEqual(BUCKETS, ['INCOME', 'NOT_INCOME', 'EXPENSE', 'INTERNAL', 'UNKNOWN']);
});

test('bucketFor maps every known code', () => {
    assert.equal(bucketFor('I'), 'INCOME');
    assert.equal(bucketFor('NI'), 'NOT_INCOME');
    assert.equal(bucketFor('N'), 'INTERNAL');
    for (const code of ['B', 'A', 'P', 'V', 'R', 'M', 'H']) {
        assert.equal(bucketFor(code), 'EXPENSE');
    }
});

test('bucketFor throws on unknown code — exhaustive dispatch, no silent else', () => {
    assert.throws(() => bucketFor('Z'), /unknown verdict code/);
});

test('counts tie -> ok true, line contains OK', () => {
    const classified = [
        { group: group('example client gmbh', 3, 100), verdict: { code: 'I' }, mapKey: 'example client gmbh' },
        { group: group('example hosting', 2, 50), verdict: { code: 'B' }, mapKey: 'example hosting' },
        { group: group('internal transfer', 1, 10), verdict: { code: 'N' }, mapKey: 'internal transfer' },
        { group: group('example insurer', 1, 5), verdict: { code: 'NI' }, mapKey: 'example insurer' },
    ];
    const missing = [group('unrecognised merchant', 4, 40)];

    const result = reconcile({ totalRows: 13, droppedRows: 2, classified, missing });

    assert.equal(result.ok, true);
    assert.match(result.line, /OK/);
    assert.equal(result.buckets.INCOME.rows, 3);
    assert.equal(result.buckets.EXPENSE.rows, 2);
    assert.equal(result.buckets.INTERNAL.rows, 1);
    assert.equal(result.buckets.NOT_INCOME.rows, 1);
    assert.equal(result.buckets.UNKNOWN.rows, 4);
});

test('missing groups land in UNKNOWN', () => {
    const missing = [group('a', 2, 20), group('b', 3, 30)];
    const result = reconcile({ totalRows: 5, droppedRows: 0, classified: [], missing });
    assert.equal(result.buckets.UNKNOWN.rows, 5);
    assert.equal(result.ok, true);
});

test('fabricated mismatch (short) -> ok false, line names the delta', () => {
    const classified = [{ group: group('example hosting', 2, 50), verdict: { code: 'B' }, mapKey: 'example hosting' }];
    const result = reconcile({ totalRows: 10, droppedRows: 0, classified, missing: [] });
    assert.equal(result.ok, false);
    assert.match(result.line, /MISMATCH/);
    assert.match(result.line, /short by 8/);
});

test('fabricated mismatch (over) -> ok false, line names the delta', () => {
    const classified = [{ group: group('example hosting', 5, 50), verdict: { code: 'B' }, mapKey: 'example hosting' }];
    const result = reconcile({ totalRows: 3, droppedRows: 0, classified, missing: [] });
    assert.equal(result.ok, false);
    assert.match(result.line, /over by 2/);
});
