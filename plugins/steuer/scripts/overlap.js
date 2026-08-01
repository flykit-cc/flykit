/**
 * overlap.js
 *
 * Cross-source duplicate detection: the same spend can appear once as a
 * card charge and again as an itemised entry from the payment processor's
 * own export (e.g. a PayPal funding leg on a card statement vs the PayPal
 * itemised transaction). This module flags candidate pairs and, where one
 * side's description names the other side's source, marks that side as the
 * funding leg to exclude — the itemised transaction is always kept, and
 * both sides are never excluded.
 */

require('./lib/bootstrap');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function daysApart(dateA, dateB) {
    return Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime()) / ONE_DAY_MS;
}

function sameCents(amountA, amountB) {
    return Math.round(Math.abs(amountA) * 100) === Math.round(Math.abs(amountB) * 100);
}

function namesSource(description, source) {
    if (!source) return false;
    return String(description || '').toLowerCase().includes(String(source).toLowerCase());
}

/**
 * @param {Array} txns - normalized transactions (see sources/README.md)
 * @param {{ windowDays?: number }} [opts]
 * @returns {{ pairs: Array<{a, b, fundingLeg}>, excluded: Array }}
 */
function detectOverlap(txns, { windowDays = 3 } = {}) {
    const pairs = [];
    const excluded = [];

    // ponytail: O(n²) pairwise scan — fine at the thousands-of-rows scale
    // this plugin runs at; bucket by currency+cents first if that changes.
    for (let i = 0; i < txns.length; i++) {
        for (let j = i + 1; j < txns.length; j++) {
            const a = txns[i];
            const b = txns[j];

            if (a.source === b.source) continue;
            if (a.currency !== b.currency) continue;
            if (!sameCents(a.amount, b.amount)) continue;
            if (daysApart(a.date, b.date) > windowDays) continue;

            // Check a first so at most one side is ever marked funding leg —
            // never both, even if both descriptions happen to name the other.
            let fundingLeg = null;
            if (namesSource(a.description, b.source)) {
                fundingLeg = a;
                excluded.push(a);
            } else if (namesSource(b.description, a.source)) {
                fundingLeg = b;
                excluded.push(b);
            }

            pairs.push({ a, b, fundingLeg });
        }
    }

    return { pairs, excluded };
}

module.exports = { detectOverlap };
