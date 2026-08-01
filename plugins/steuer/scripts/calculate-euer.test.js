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
const { totals, parseArgs, gateCheck, splitAndTally } = require('./calculate-euer');

// --- totals ---------------------------------------------------------------

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

// --- parseArgs --------------------------------------------------------------

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

// --- gateCheck ---------------------------------------------------------------
// Contract: groups[i] = { key, currency, net, direction, verdict: {code,...}|null, ... }

test('gateCheck: legacy file with no groups array passes trivially', () => {
    const result = gateCheck({});
    assert.equal(result.ok, true);
    assert.equal(result.verdictByGroupKey.size, 0);
});

test('gateCheck: fully resolved groups pass, verdict is the full object (incl. share)', () => {
    const data = { groups: [{ key: 'acme income co', currency: 'EUR', net: 1000, direction: 'in', verdict: { code: 'I' } }] };
    const result = gateCheck(data);
    assert.equal(result.ok, true);
    assert.equal(result.verdictByGroupKey.get('acme income co|EUR').code, 'I');
});

test('gateCheck: a group with verdict:null (MISSING) blocks even with --include-review', () => {
    const data = { groups: [{ key: 'mystery merchant', currency: 'EUR', net: 42, direction: 'out', verdict: null }] };
    const result = gateCheck(data, { includeReview: true });
    assert.equal(result.ok, false);
    assert.equal(result.offending.length, 1);
    assert.equal(result.offending[0].label, 'MISSING');
    assert.equal(result.offending[0].group.key, 'mystery merchant');
});

test('gateCheck: an R group blocks without --include-review', () => {
    const data = { groups: [{ key: 'example gym', currency: 'EUR', net: 45, direction: 'out', verdict: { code: 'R' } }] };
    const result = gateCheck(data);
    assert.equal(result.ok, false);
    assert.equal(result.offending.length, 1);
    assert.equal(result.offending[0].label, 'R');
});

test('gateCheck: an R group passes with --include-review', () => {
    const data = { groups: [{ key: 'example gym', currency: 'EUR', net: 45, direction: 'out', verdict: { code: 'R' } }] };
    const result = gateCheck(data, { includeReview: true });
    assert.equal(result.ok, true);
    assert.equal(result.verdictByGroupKey.get('example gym|EUR').code, 'R');
});

test('gateCheck: mixed MISSING + R — MISSING still blocks even though R is pardoned', () => {
    const data = {
        groups: [
            { key: 'mystery merchant', currency: 'EUR', net: 42, direction: 'out', verdict: null },
            { key: 'example gym', currency: 'EUR', net: 45, direction: 'out', verdict: { code: 'R' } },
        ],
    };
    const result = gateCheck(data, { includeReview: true });
    assert.equal(result.ok, false);
    assert.deepEqual(result.offending.map(o => o.label), ['MISSING']);
});

test('gateCheck: unknown verdict code throws (fail closed, re-validates the frozen group)', () => {
    const data = { groups: [{ key: 'weird co', currency: 'EUR', net: 10, direction: 'out', verdict: { code: 'ZZZ' } }] };
    assert.throws(() => gateCheck(data), /unknown verdict code/);
});

// --- splitAndTally: known-answer Gewinn across all codes -------------------
// groups carry the verdict (incl. share); txns carry groupKey + bare verdictCode.

function fixtureAllCodes() {
    const groups = [
        { key: 'acme income co', currency: 'EUR', net: 1000, direction: 'in', verdict: { code: 'I' } },
        { key: 'loan repayment co', currency: 'EUR', net: 250, direction: 'in', verdict: { code: 'NI' } },
        { key: 'office supplies co', currency: 'EUR', net: 200, direction: 'out', verdict: { code: 'B' } },
        { key: 'shared coworking co', currency: 'EUR', net: 300, direction: 'out', verdict: { code: 'A', share: 0.4 } },
        { key: 'private gym co', currency: 'EUR', net: 80, direction: 'out', verdict: { code: 'P' } },
        { key: 'pension provider co', currency: 'EUR', net: 150, direction: 'out', verdict: { code: 'V' } },
        { key: 'internal transfer co', currency: 'EUR', net: 500, direction: 'out', verdict: { code: 'N' } },
        { key: 'dental clinic co', currency: 'EUR', net: 60, direction: 'out', verdict: { code: 'M' } },
        { key: 'cleaning service co', currency: 'EUR', net: 90, direction: 'out', verdict: { code: 'H' } },
    ];
    const income = [
        { groupKey: 'acme income co', verdictCode: 'I', currency: 'EUR', amountEUR: 1000, date: '2024-05-01' },
        { groupKey: 'loan repayment co', verdictCode: 'NI', currency: 'EUR', amountEUR: 250, date: '2024-05-02' },
    ];
    // Expense amounts are SIGNED NEGATIVE — the real pipeline convention
    // (parse-statements emits signed rows; only legacy 0.1.0 files are
    // positive-magnitude).
    const expenses = [
        { groupKey: 'office supplies co', verdictCode: 'B', currency: 'EUR', amountEUR: -200, date: '2024-05-03' },
        { groupKey: 'shared coworking co', verdictCode: 'A', currency: 'EUR', amountEUR: -300, date: '2024-05-04' },
        { groupKey: 'private gym co', verdictCode: 'P', currency: 'EUR', amountEUR: -80, date: '2024-05-05' },
        { groupKey: 'pension provider co', verdictCode: 'V', currency: 'EUR', amountEUR: -150, date: '2024-05-06' },
        { groupKey: 'internal transfer co', verdictCode: 'N', currency: 'EUR', amountEUR: -500, date: '2024-05-07' },
        { groupKey: 'dental clinic co', verdictCode: 'M', currency: 'EUR', amountEUR: -60, date: '2024-05-08' },
        { groupKey: 'cleaning service co', verdictCode: 'H', currency: 'EUR', amountEUR: -90, date: '2024-05-09' },
    ];
    return { groups, income, expenses };
}

function round2(n) { return Math.round(n * 100) / 100; }

test('known-answer: one group per code -> exact Gewinn to the cent', () => {
    const { groups, income, expenses } = fixtureAllCodes();
    const gate = gateCheck({ groups });
    assert.equal(gate.ok, true);

    const result = splitAndTally(income, expenses, gate.verdictByGroupKey);

    const incomeEUR = totals(result.income).totalEUR;
    const expenseEUR = totals(result.expenses).totalEUR;
    // Income: only I counts (1000); NI is inbound-not-income, excluded.
    assert.equal(incomeEUR, 1000);
    // Expenses: B in full (-200) + A at its share (-300 * 0.4 = -120); every
    // other code (P, V, N, M, H) is excluded from the EÜR entirely.
    assert.equal(expenseEUR, -320);
    // Signed convention: Gewinn is a plain sum, never a subtraction.
    assert.equal(round2(incomeEUR + expenseEUR), 680);
});

test('known-answer: by_category carries EUR totals for every code seen', () => {
    const { groups, income, expenses } = fixtureAllCodes();
    const gate = gateCheck({ groups });
    const { by_category } = splitAndTally(income, expenses, gate.verdictByGroupKey);

    assert.equal(by_category.I, 1000);
    assert.equal(by_category.B, -200);
    assert.equal(by_category.A, -120);
    assert.equal(by_category.NI, 250);
    assert.equal(by_category.P, -80);
    assert.equal(by_category.V, -150);
    assert.equal(by_category.N, -500);
    assert.equal(by_category.M, -60);
    assert.equal(by_category.H, -90);
});

test('known-answer: excluded lists every non-included code with count + sumEUR', () => {
    const { groups, income, expenses } = fixtureAllCodes();
    const gate = gateCheck({ groups });
    const { excluded } = splitAndTally(income, expenses, gate.verdictByGroupKey);

    const codes = excluded.map(e => e.code);
    assert.deepEqual(codes, ['H', 'M', 'N', 'NI', 'P', 'V']); // sorted, I/B/A absent
    const p = excluded.find(e => e.code === 'P');
    assert.deepEqual(p, { code: 'P', count: 1, sumEUR: -80 });
});

// --- splitAndTally: code A share applied exactly once, read from the group -

test('splitAndTally: code A share applied exactly once (not squared, not doubled)', () => {
    const verdictByGroupKey = new Map([['coworking co|EUR', { code: 'A', share: 0.25 }]]);
    const expenses = [{ groupKey: 'coworking co', verdictCode: 'A', currency: 'EUR', amountEUR: -400 }];
    const result = splitAndTally([], expenses, verdictByGroupKey);

    assert.equal(result.expenses.length, 1);
    assert.equal(result.expenses[0].amountEUR, -100); // -400 * 0.25
    assert.equal(result.by_category.A, -100);
    assert.equal(totals(result.expenses).totalEUR, -100);
});

test('splitAndTally: multiple A-coded rows in the same group each apportioned once', () => {
    const verdictByGroupKey = new Map([['coworking co|EUR', { code: 'A', share: 0.5 }]]);
    const expenses = [
        { groupKey: 'coworking co', verdictCode: 'A', currency: 'EUR', amountEUR: -100 },
        { groupKey: 'coworking co', verdictCode: 'A', currency: 'EUR', amountEUR: -60 },
    ];
    const result = splitAndTally([], expenses, verdictByGroupKey);
    assert.equal(totals(result.expenses).totalEUR, -80); // (-100 + -60) * 0.5, each row halved once
    assert.equal(result.by_category.A, -80);
});

test('splitAndTally: A-coded expense with no matching group share throws (defensive)', () => {
    const expenses = [{ groupKey: 'unknown group', verdictCode: 'A', currency: 'EUR', amountEUR: -10 }];
    assert.throws(() => splitAndTally([], expenses, new Map()), /share/);
});

// --- splitAndTally: R on the expense side is never admitted -----------------

test('splitAndTally: R group excluded on the expense side even with --include-review', () => {
    const expenses = [{ groupKey: 'example gym', verdictCode: 'R', currency: 'EUR', amountEUR: -45 }];
    const result = splitAndTally([], expenses, new Map(), { includeReview: true });
    assert.equal(result.expenses.length, 0);
    assert.equal(result.excluded.find(e => e.code === 'R').sumEUR, -45);
});

test('splitAndTally: R group admitted on the income side only with --include-review', () => {
    const income = [{ groupKey: 'example gym', verdictCode: 'R', currency: 'EUR', amountEUR: 45 }];

    const withoutFlag = splitAndTally(income, [], new Map());
    assert.equal(withoutFlag.income.length, 0);

    const withFlag = splitAndTally(income, [], new Map(), { includeReview: true });
    assert.equal(withFlag.income.length, 1);
    assert.equal(withFlag.by_category.R, 45);
});

// --- splitAndTally: netting must survive to the totals (seam regression) ----
// Mirrors the live e2e smoke that caught two real bugs: a refund credit
// inside a B group sits INCOME-side in classified.json (parse splits arrays
// by sign) and must offset that group's expenses, and Gewinn is a signed sum.

test('regression: cross-side B credit offsets its group; Gewinn = signed sum to the cent', () => {
    const groups = [
        { key: 'example client gmbh', currency: 'EUR', net: 2500, direction: 'in', verdict: { code: 'I' } },
        { key: 'ride-hail-x', currency: 'EUR', net: 9.20, direction: 'out', verdict: { code: 'B' } },
        { key: 'example hosting ltd', currency: 'EUR', net: 30, direction: 'out', verdict: { code: 'B' } },
        { key: 'example gym', currency: 'EUR', net: 45, direction: 'out', verdict: { code: 'P' } },
    ];
    const income = [
        { groupKey: 'example client gmbh', verdictCode: 'I', currency: 'EUR', amountEUR: 2500 },
        // The pre-auth refund: positive, so parse put it income-side — but it
        // belongs to the B group and must offset, not land in `excluded`.
        { groupKey: 'ride-hail-x', verdictCode: 'B', currency: 'EUR', amountEUR: 17.20 },
        // Dropped rows (memo/funding legs) never enter the EÜR at all.
        { groupKey: 'ride-hail-x', verdictCode: null, currency: 'EUR', amountEUR: 20.00, dropped: true },
    ];
    const expenses = [
        { groupKey: 'ride-hail-x', verdictCode: 'B', currency: 'EUR', amountEUR: -20.00 },
        { groupKey: 'ride-hail-x', verdictCode: 'B', currency: 'EUR', amountEUR: -6.40 },
        { groupKey: 'example hosting ltd', verdictCode: 'B', currency: 'EUR', amountEUR: -30.00 },
        { groupKey: 'example gym', verdictCode: 'P', currency: 'EUR', amountEUR: -45.00 },
    ];

    const gate = gateCheck({ groups });
    assert.equal(gate.ok, true);
    const result = splitAndTally(income, expenses, gate.verdictByGroupKey);

    const incomeEUR = totals(result.income).totalEUR;
    const expenseEUR = totals(result.expenses).totalEUR;
    assert.equal(round2(incomeEUR), 2500);
    assert.equal(round2(expenseEUR), -39.20);            // netted, NOT -56.40 gross
    assert.equal(round2(incomeEUR + expenseEUR), 2460.80); // signed sum, NOT 2556.40
    assert.equal(result.excluded.find(e => e.code === 'B'), undefined);
    assert.deepEqual(result.excluded.map(e => e.code), ['P']); // dropped row absent too
});

// --- splitAndTally: legacy 0.1.0 shape (no groupKey) ------------------------

test('legacy: income filtered by classification, all expenses counted (0.1.0 behaviour)', () => {
    const income = [
        { classification: 'taxable', amountEUR: 500 },
        { classification: 'review', amountEUR: 50 },
        { classification: 'not_taxable', amountEUR: 30 },
    ];
    const expenses = [{ amountEUR: 120 }, { amountEUR: 30 }];

    const result = splitAndTally(income, expenses, new Map());
    assert.equal(totals(result.income).totalEUR, 500);
    assert.equal(totals(result.expenses).totalEUR, 150);
});

test('legacy: review income counted only with --include-review, mirroring current semantics', () => {
    const income = [{ classification: 'review', amountEUR: 50 }];
    const withoutFlag = splitAndTally(income, [], new Map());
    assert.equal(totals(withoutFlag.income).totalEUR, 0);

    const withFlag = splitAndTally(income, [], new Map(), { includeReview: true });
    assert.equal(totals(withFlag.income).totalEUR, 50);
});

test('legacy: gateCheck never blocks a file with no groups array', () => {
    const legacyData = { income: [{ classification: 'taxable', amountEUR: 10 }], expenses: [] };
    const gate = gateCheck(legacyData, { includeReview: false });
    assert.equal(gate.ok, true);
});
