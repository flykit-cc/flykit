/**
 * Tests for classifier.js — rule-based income classifier.
 *
 * Run via: node --test scripts/classifier.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIncome, applyRules } = require('./classifier');

test('classifies insurance reimbursements as not_taxable', () => {
    const items = [{ description: 'AOK VERSICHERUNG ERSTATTUNG' }];
    const out = classifyIncome(items);
    assert.equal(out[0].classification, 'not_taxable');
    assert.equal(out[0].classificationReason, 'Insurance reimbursement');
});

test('classifies government/tax refunds as not_taxable', () => {
    const items = [{ description: 'FINANZAMT STEUER RUECKERSTATTUNG' }];
    const out = classifyIncome(items);
    assert.equal(out[0].classification, 'not_taxable');
    assert.equal(out[0].classificationReason, 'Government / tax refund');
});

test('classifies legal-entity suffixes as taxable with captured entity', () => {
    const items = [{ description: 'ACME GmbH payment for invoice 42' }];
    const out = classifyIncome(items);
    assert.equal(out[0].classification, 'taxable');
    assert.match(out[0].classificationReason, /legal entity: GmbH/);
});

test('classifies known freelancer platforms as taxable', () => {
    const items = [{ description: 'TOPTAL LLC payout' }];
    const out = classifyIncome(items);
    // Legal-entity rule (LLC) fires before platform rule — still taxable.
    assert.equal(out[0].classification, 'taxable');
    assert.match(out[0].classificationReason, /LLC|Toptal/);
});

test('flags BALANCE_CASHBACK as review', () => {
    const items = [{ description: 'Wise cashback credit', raw: { type: 'BALANCE_CASHBACK' } }];
    const out = classifyIncome(items);
    assert.equal(out[0].classification, 'review');
    assert.equal(out[0].classificationReason, 'Cashback — verify if taxable');
});

test('falls through to review for unmatched descriptions', () => {
    const items = [{ description: 'Random unknown deposit' }];
    const out = classifyIncome(items);
    assert.equal(out[0].classification, 'review');
    assert.match(out[0].classificationReason, /Unclassified/);
});

test('applyRules preserves original item fields', () => {
    const items = [{ description: 'STADTWERKE Strom Guthaben', amount: 123.45, id: 'tx-1' }];
    const out = applyRules(require('./classifier').INCOME_RULES, items);
    assert.equal(out[0].amount, 123.45);
    assert.equal(out[0].id, 'tx-1');
    assert.equal(out[0].classification, 'not_taxable');
});

test('handles empty input', () => {
    assert.deepEqual(classifyIncome([]), []);
});
