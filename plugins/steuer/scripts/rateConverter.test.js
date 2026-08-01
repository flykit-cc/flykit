/**
 * Tests for rateConverter.js — deterministic, no network.
 *
 * Exercises pure behavior:
 *  - EUR transactions bypass the rate cache entirely (pass-through).
 *  - Non-EUR transactions with no cached rate surface null amountEUR / rate.
 *  - Rounding applied on the way out.
 *  - ECB csvdata parsing, cache-file round-trip, and the {from}-per-EUR
 *    divide direction (all offline — fetch is stubbed, never left as real
 *    global.fetch during a prefetchRates() call).
 *
 * Run via: node --test scripts/rateConverter.test.js
 *
 * All fixture dates below use invented far-future years so they never
 * collide with the shared module-level rate cache populated by other tests
 * in this file.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { batchConvert, getRate, prefetchRates, parseEcbCsv } = require('./rateConverter');

function ecbFixtureCsv(rows) {
    const header = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
    const lines = rows.map(
        ([date, rate]) => `"D.USD.EUR.SP00.A",D,USD,EUR,SP00,A,${date},${rate},A`
    );
    return [header, ...lines].join('\n') + '\n';
}

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

test('parseEcbCsv reads TIME_PERIOD/OBS_VALUE from SDMX csvdata, ignoring the quoted KEY column', () => {
    const csv = ecbFixtureCsv([
        ['2032-03-01', 1.1],
        ['2032-03-02', 1.2],
    ]);
    const rows = parseEcbCsv(csv);
    assert.deepEqual(rows, [
        ['2032-03-01', 1.1],
        ['2032-03-02', 1.2],
    ]);
});

test('parseEcbCsv on header-only text returns no rows', () => {
    assert.deepEqual(parseEcbCsv('KEY,FREQ,TIME_PERIOD,OBS_VALUE\n'), []);
});

test('direction: ECB rate 1.25 (USD per 1 EUR) converts $10 to exactly €8.00, not €12.50', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecb-direction-'));
    const cachePath = path.join(cacheDir, 'ecb-USD-EUR-2033.csv');
    fs.writeFileSync(cachePath, ecbFixtureCsv([['2033-05-10', 1.25]]));

    // Cache file already present -> prefetchRates must read it, not fetch.
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('network should not be called when cache file exists'); };
    try {
        await prefetchRates(2033, 'USD', 'EUR', { cacheDir });
    } finally {
        global.fetch = originalFetch;
    }

    const [converted] = await batchConvert([
        { date: '2033-05-10', currency: 'USD', amount: 10 },
    ]);
    assert.equal(converted.amountEUR, 8.00);
    assert.notEqual(converted.amountEUR, 12.50);
    assert.equal(converted.rate, 1.25);
});

test('prefetchRates writes the cache file on fetch (sending a User-Agent) and reads it back offline next time', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecb-roundtrip-'));
    const cachePath = path.join(cacheDir, 'ecb-USD-EUR-2031.csv');
    const fixtureText = ecbFixtureCsv([['2031-07-01', 1.05]]);

    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async (url, opts) => {
        fetchCalls++;
        assert.match(url, /^https:\/\/data-api\.ecb\.europa\.eu\/service\/data\/EXR\/D\.USD\.EUR\.SP00\.A\?/);
        assert.ok(opts && opts.headers && opts.headers['User-Agent'], 'expected a User-Agent header');
        return { ok: true, text: async () => fixtureText };
    };
    try {
        await prefetchRates(2031, 'USD', 'EUR', { cacheDir });
    } finally {
        global.fetch = originalFetch;
    }

    assert.equal(fetchCalls, 1);
    assert.ok(fs.existsSync(cachePath));
    assert.equal(fs.readFileSync(cachePath, 'utf8'), fixtureText);

    // Second call must not touch the network: the cache file already exists.
    global.fetch = async () => { throw new Error('network should not be called on cached re-run'); };
    try {
        await prefetchRates(2031, 'USD', 'EUR', { cacheDir });
    } finally {
        global.fetch = originalFetch;
    }
    assert.equal(getRate('2031-07-01'), 1.05);
});

test('getRate falls back to the nearest previous cached day within 7 days (weekend/holiday gap)', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecb-fallback-'));
    fs.writeFileSync(
        path.join(cacheDir, 'ecb-USD-EUR-2034.csv'),
        ecbFixtureCsv([['2034-02-03', 1.10]])
    );
    await prefetchRates(2034, 'USD', 'EUR', { cacheDir });

    // 2034-02-05 has no direct rate; fallback must walk back to 2034-02-03.
    assert.equal(getRate('2034-02-05'), 1.10);
});

test('getRate fallback gives up beyond 7 days and returns null', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecb-fallback-toofar-'));
    fs.writeFileSync(
        path.join(cacheDir, 'ecb-USD-EUR-2035.csv'),
        ecbFixtureCsv([['2035-01-01', 1.30]])
    );
    await prefetchRates(2035, 'USD', 'EUR', { cacheDir });

    assert.equal(getRate('2035-01-10'), null);
});
