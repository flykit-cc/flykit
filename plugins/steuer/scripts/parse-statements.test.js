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

const {
    loadManualExpenses,
    normalizeManualEntry,
    netByMerchantAndCurrency,
    saveVerdictsGuarded,
    formatMissingBlock,
    main,
} = require('./parse-statements');
const { loadVerdicts } = require('./verdicts');

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

// --- netByMerchantAndCurrency: net within one currency ----------------------

test('netByMerchantAndCurrency: same merchant, two currencies -> two groups, netted separately', () => {
    const txns = [
        { description: 'Example Vendor', amount: -20, currency: 'EUR', source: 'wise', date: '2024-01-01', raw: {} },
        { description: 'Example Vendor', amount: -20, currency: 'EUR', source: 'wise', date: '2024-01-02', raw: {} },
        { description: 'Example Vendor', amount: 18, currency: 'EUR', source: 'wise', date: '2024-01-03', raw: {} },
        { description: 'Example Vendor', amount: -30, currency: 'USD', source: 'wise', date: '2024-01-04', raw: {} },
    ];

    const groups = netByMerchantAndCurrency(txns);
    assert.equal(groups.length, 2);

    const eur = groups.find(g => g.currency === 'EUR');
    const usd = groups.find(g => g.currency === 'USD');
    assert.equal(eur.key, 'example vendor');
    assert.equal(usd.key, 'example vendor');
    assert.equal(eur.net, 22); // |-20 -20 +18| = 22, not summed with the USD leg
    assert.equal(usd.net, 30);
    // Original txn references come back out, not the composite-keyed clones.
    assert.equal(eur.txns.every(t => t.merchant === undefined), true);
    assert.equal(eur.txns[0].description, 'Example Vendor');
});

// --- saveVerdictsGuarded: shrink guard ---------------------------------------

function tmpVerdictsPath(name) {
    return path.join(os.tmpdir(), `verdicts-guard-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

test('saveVerdictsGuarded: creates the file with {} when absent', () => {
    const p = tmpVerdictsPath('new.json');
    saveVerdictsGuarded(p, {});
    assert.deepEqual(loadVerdicts(p), {});
    fs.unlinkSync(p);
});

test('saveVerdictsGuarded: refuses to shrink an existing map without --force', () => {
    const p = tmpVerdictsPath('shrink.json');
    saveVerdictsGuarded(p, { a: { code: 'B' }, b: { code: 'P' } });
    assert.throws(() => saveVerdictsGuarded(p, { a: { code: 'B' } }), /refusing to shrink/);
    // The file on disk must still hold both entries after the refused write.
    assert.deepEqual(Object.keys(loadVerdicts(p)), ['a', 'b']);
    fs.unlinkSync(p);
});

test('saveVerdictsGuarded: --force allows shrinking', () => {
    const p = tmpVerdictsPath('force.json');
    saveVerdictsGuarded(p, { a: { code: 'B' }, b: { code: 'P' } });
    saveVerdictsGuarded(p, { a: { code: 'B' } }, { force: true });
    assert.deepEqual(Object.keys(loadVerdicts(p)), ['a']);
    fs.unlinkSync(p);
});

// --- formatMissingBlock: sorted by |net| desc --------------------------------

test('formatMissingBlock: sorts groups by |net| descending regardless of input order', () => {
    const groups = [
        { key: 'small merchant', currency: 'EUR', net: 12, direction: 'out', txns: [1] },
        { key: 'big merchant', currency: 'EUR', net: 999.5, direction: 'out', txns: [1, 2] },
        { key: 'mid merchant', currency: 'USD', net: 200, direction: 'in', txns: [1] },
    ];
    const block = formatMissingBlock(groups);
    const lines = block.split('\n');

    assert.equal(lines[0], 'MISSING (3 groups):');
    assert.match(lines[1], /big merchant/);
    assert.match(lines[2], /mid merchant/);
    assert.match(lines[3], /small merchant/);
});

test('formatMissingBlock: zero groups still prints the header', () => {
    assert.equal(formatMissingBlock([]), 'MISSING (0 groups):');
});

// --- main(): end-to-end against csv-import fixtures, tmp output dir ---------

function tmpDir(name) {
    const p = path.join(os.tmpdir(), `parse-statements-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
    fs.mkdirSync(p, { recursive: true });
    return p;
}

test('main(): writes classified.json with groups + reconciliation, verdicts file, MISSING block', async () => {
    const outDir = tmpDir('out');
    const csvPath = path.join(outDir, 'tx.csv');
    fs.writeFileSync(csvPath,
        'date,description,amount,currency\n' +
        '2024-02-01,Example Client GmbH,1000.00,EUR\n' +
        '2024-03-01,Unmapped Vendor,50.00,EUR\n'
    );
    const verdictsPath = path.join(outDir, 'verdicts-2024.json');
    fs.writeFileSync(verdictsPath, JSON.stringify({ 'example client': { code: 'I' } }));

    const originalLog = console.log;
    const logged = [];
    console.log = (...a) => logged.push(a.join(' '));
    try {
        await main([
            'node', 'parse-statements.js',
            '--year', '2024',
            '--source', 'csv-import',
            '--file', csvPath,
            '--output', outDir,
            '--verdicts', verdictsPath,
        ]);
    } finally {
        console.log = originalLog;
    }

    const classifiedPath = path.join(outDir, 'steuer-2024-classified.json');
    const written = JSON.parse(fs.readFileSync(classifiedPath, 'utf8'));

    assert.equal(written.year, 2024);
    assert.ok(Array.isArray(written.groups));
    assert.ok(written.groups.length >= 2);
    assert.ok(written.reconciliation);
    assert.equal(typeof written.reconciliation.ok, 'boolean');
    assert.match(written.reconciliation.line, /row-count check/);

    const classifiedGroup = written.groups.find(g => g.key === 'example client gmbh');
    assert.equal(classifiedGroup.status, 'classified');
    assert.deepEqual(classifiedGroup.verdict, { code: 'I' });
    assert.equal(classifiedGroup.mapKey, 'example client');
    const missingGroup = written.groups.find(g => g.key === 'unmapped vendor');
    assert.equal(missingGroup.status, 'missing');
    assert.equal(missingGroup.verdict, null);
    assert.equal(missingGroup.mapKey, null);

    // Every income txn carries groupKey / verdictCode / netted.
    for (const t of written.income) {
        assert.ok('groupKey' in t);
        assert.ok('verdictCode' in t);
        assert.equal(typeof t.netted, 'boolean');
    }

    const output = logged.join('\n');
    assert.match(output, /row-count check.*OK/);
    assert.match(output, /MISSING \(1 groups\):/);
    assert.match(output, /unmapped vendor/);
});

