/**
 * Tests for verdicts.js — verdict map load/lookup/apply.
 *
 * Run via: node --test scripts/verdicts.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    CODES,
    loadVerdicts,
    saveVerdicts,
    lookupVerdict,
    applyVerdicts,
    validateVerdict,
} = require('./verdicts');

function tmpPath(name) {
    return path.join(os.tmpdir(), `verdicts-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

// --- CODES -----------------------------------------------------------

test('CODES is frozen and covers the documented set', () => {
    assert.ok(Object.isFrozen(CODES));
    assert.deepEqual(
        Object.keys(CODES).sort(),
        ['A', 'B', 'H', 'I', 'M', 'N', 'NI', 'P', 'R', 'V'].sort()
    );
});

// --- lookupVerdict: longest-match + tie-break -------------------------

test('lookupVerdict: longest key wins over a shorter substring match', () => {
    const map = {
        'example coworking': { code: 'A', share: 0.5 },
        'example coworking berlin': { code: 'B' },
    };
    const v = lookupVerdict(map, 'EXAMPLE COWORKING BERLIN GMBH');
    assert.equal(v.code, 'B');
});

test('lookupVerdict: equal-length keys — later entry in the map wins', () => {
    const map = {
        'example gym': { code: 'P', category: 'first' },
        'example gxm': { code: 'M', category: 'second' },
    };
    // Neither key is a substring of the other and both are the same length;
    // construct a target that both match via a synthetic combined string.
    const target = 'example gym example gxm';
    // 'example gym' matches (appears verbatim); 'example gxm' also matches.
    const v = lookupVerdict(map, target);
    assert.equal(v.category, 'second');
});

test('lookupVerdict: case-insensitive substring match', () => {
    const map = { 'example hosting gmbh': { code: 'B' } };
    const v = lookupVerdict(map, 'EXAMPLE HOSTING GMBH INVOICE 123');
    assert.equal(v.code, 'B');
});

test('lookupVerdict: no match returns null', () => {
    const map = { 'example hosting gmbh': { code: 'B' } };
    assert.equal(lookupVerdict(map, 'unrelated merchant'), null);
});

// --- applyVerdicts -----------------------------------------------------

test('applyVerdicts: unmapped group goes to missing, not classified', () => {
    const groups = [{ key: 'unmapped merchant', gross: 10, net: 10 }];
    const { classified, missing } = applyVerdicts(groups, {});
    assert.equal(classified.length, 0);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].key, 'unmapped merchant');
});

test('applyVerdicts: mapped group is classified with group, verdict, mapKey', () => {
    const group = { key: 'example hosting gmbh', gross: 42, net: 42 };
    const map = { 'example hosting': { code: 'B', category: 'Hosting' } };
    const { classified, missing } = applyVerdicts([group], map);
    assert.equal(missing.length, 0);
    assert.equal(classified.length, 1);
    assert.equal(classified[0].group, group);
    assert.equal(classified[0].verdict, map['example hosting']);
    assert.equal(classified[0].mapKey, 'example hosting');
});

test('applyVerdicts: unknown code in the map throws (exhaustive dispatch)', () => {
    const groups = [{ key: 'example merchant' }];
    const map = { 'example merchant': { code: 'X' } };
    assert.throws(() => applyVerdicts(groups, map), /unknown verdict code/);
});

// --- validateVerdict -----------------------------------------------------

test('validateVerdict: throws on unknown code', () => {
    assert.throws(() => validateVerdict({ code: 'X' }), /unknown verdict code/);
});

test('validateVerdict: non-object throws', () => {
    assert.throws(() => validateVerdict('B'), /verdict must be an object/);
    assert.throws(() => validateVerdict(null), /verdict must be an object/);
});

test('validateVerdict: code A requires numeric share in (0,1]', () => {
    assert.throws(() => validateVerdict({ code: 'A' }), /share/);
    assert.throws(() => validateVerdict({ code: 'A', share: 0 }), /share/);
    assert.throws(() => validateVerdict({ code: 'A', share: 1.5 }), /share/);
    assert.throws(() => validateVerdict({ code: 'A', share: 'half' }), /share/);
    assert.doesNotThrow(() => validateVerdict({ code: 'A', share: 1 }));
    assert.doesNotThrow(() => validateVerdict({ code: 'A', share: 0.5 }));
});

test('validateVerdict: non-A codes do not require a share', () => {
    assert.doesNotThrow(() => validateVerdict({ code: 'B' }));
    assert.doesNotThrow(() => validateVerdict({ code: 'P' }));
});

// --- loadVerdicts / saveVerdicts -----------------------------------------

test('loadVerdicts: missing file returns {}', () => {
    const p = tmpPath('missing.json');
    assert.deepEqual(loadVerdicts(p), {});
});

test('loadVerdicts: malformed JSON throws naming the file', () => {
    const p = tmpPath('bad.json');
    fs.writeFileSync(p, '{not json');
    assert.throws(() => loadVerdicts(p), new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    fs.unlinkSync(p);
});

test('saveVerdicts + loadVerdicts: roundtrip preserves insertion order', () => {
    const p = tmpPath('roundtrip.json');
    const map = {};
    map['example hosting gmbh'] = { code: 'B', category: 'Hosting' };
    map['example gym'] = { code: 'P' };
    map['example coworking'] = { code: 'A', category: 'Arbeitsplatz', share: 0.5 };

    saveVerdicts(p, map);
    const loaded = loadVerdicts(p);
    fs.unlinkSync(p);

    assert.deepEqual(Object.keys(loaded), Object.keys(map));
    assert.deepEqual(loaded, map);
});

test('saveVerdicts: pretty-printed (multi-line, indented)', () => {
    const p = tmpPath('pretty.json');
    saveVerdicts(p, { 'example gym': { code: 'P' } });
    const raw = fs.readFileSync(p, 'utf8');
    fs.unlinkSync(p);

    assert.ok(raw.includes('\n'));
    assert.ok(raw.includes('    '));
});
