/**
 * Tests for wise.js — profile filter logic (pure, no network).
 *
 * Run via: node --test scripts/sources/wise.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filterProfiles } = require('./wise');

const SAMPLE = [
    { id: 1, type: 'personal', name: 'Jane Doe' },
    { id: 2, type: 'business', name: 'Acme Ltd' },
];

test('filterProfiles: "all" returns every profile', () => {
    assert.deepEqual(filterProfiles(SAMPLE, 'all'), SAMPLE);
});

test('filterProfiles: default (undefined) returns every profile', () => {
    assert.deepEqual(filterProfiles(SAMPLE), SAMPLE);
});

test('filterProfiles: "personal" filters correctly', () => {
    const out = filterProfiles(SAMPLE, 'personal');
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'personal');
});

test('filterProfiles: "business" filters correctly', () => {
    const out = filterProfiles(SAMPLE, 'business');
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'business');
});

test('filterProfiles: empty result throws with available-profiles text', () => {
    const personalOnly = [{ id: 1, type: 'personal', name: 'Jane Doe' }];
    assert.throws(
        () => filterProfiles(personalOnly, 'business'),
        (err) =>
            /No Wise profile matched --profile=business/.test(err.message) &&
            /Available profiles: personal \(Jane Doe\)/.test(err.message)
    );
});

test('filterProfiles: invalid profile value errors listing valid choices', () => {
    assert.throws(
        () => filterProfiles(SAMPLE, 'bogus'),
        /Invalid --profile value "bogus"\. Valid choices: all, personal, business\./
    );
});

test('filterProfiles: numeric profile id matches by id', () => {
    const out = filterProfiles(SAMPLE, '2');
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 2);
});
