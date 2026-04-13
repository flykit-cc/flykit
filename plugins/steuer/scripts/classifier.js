/**
 * Rule-based income/expense classifier for German tax reporting.
 *
 * Tags each item with:
 *   classification: 'taxable' | 'not_taxable' | 'review'
 *   classificationReason: human-readable explanation
 *
 * Rules are intentionally generic — extend them for your own merchants/clients.
 * See ../references/tax-categories.md for category guidance.
 */

require('./lib/bootstrap');

const INCOME_RULES = [
    // --- NOT TAXABLE ---
    {
        // Common German health insurers + generic insurance keywords.
        test: (item) => /VERSICHERUNG|VERS\.|KRANKENKASSE|\bAOK\b|\bDAK\b|BARMER|TECHNIKER\s*KRANKENKASSE|HUK[-\s]?COBURG|ALLIANZ/i.test(item.description),
        classification: 'not_taxable',
        reason: 'Insurance reimbursement',
    },
    {
        test: (item) => /FINANZAMT|BUNDESZENTRALAMT|STEUER\s*RUECK/i.test(item.description),
        classification: 'not_taxable',
        reason: 'Government / tax refund',
    },
    {
        test: (item) => /STADTWERKE|VATTENFALL|E\.ON|GASAG|ENERCITY/i.test(item.description) ||
                        /STROM.*(?:AUSZAHLUNG|GUTHABEN|RUECKZAHLUNG)/i.test(item.description),
        classification: 'not_taxable',
        reason: 'Utility credit / refund',
    },

    // --- TAXABLE (business indicators) ---
    {
        // Legal-entity suffixes — strongly suggest business income.
        test: (item) => /\b(Inc\.?|LLC|Ltd\.?|GmbH|gGmbH|GbR|UG|AG|Corp\.?|S\.?[Aa]\.?|B\.?V\.?|SARL|OY|AB)\b/i.test(item.description),
        classification: 'taxable',
        reason: (item) => {
            const m = item.description.match(/\b(Inc\.?|LLC|Ltd\.?|GmbH|gGmbH|GbR|UG|AG|Corp\.?|S\.?[Aa]\.?|B\.?V\.?|SARL|OY|AB)\b/i);
            return `Business (legal entity: ${m[0]})`;
        },
    },
    {
        // Common freelancer / contractor platforms (extend with your own).
        test: (item) => /\b(Toptal|Upwork|Fiverr|Andela|Stripe|PayPal\s+Business)\b/i.test(item.description),
        classification: 'taxable',
        reason: (item) => {
            const m = item.description.match(/\b(Toptal|Upwork|Fiverr|Andela|Stripe|PayPal\s+Business)\b/i);
            return `Business (platform: ${m[0]})`;
        },
    },

    // --- REVIEW ---
    {
        test: (item) => item.raw && item.raw.type === 'BALANCE_CASHBACK',
        classification: 'review',
        reason: 'Cashback — verify if taxable',
    },
];

function applyRules(rules, items) {
    return items.map((item) => {
        for (const rule of rules) {
            if (rule.test(item)) {
                const reason = typeof rule.reason === 'function' ? rule.reason(item) : rule.reason;
                return { ...item, classification: rule.classification, classificationReason: reason };
            }
        }
        return { ...item, classification: 'review', classificationReason: 'Unclassified — please review' };
    });
}

function classifyIncome(items) {
    return applyRules(INCOME_RULES, items);
}

module.exports = { classifyIncome, applyRules, INCOME_RULES };
