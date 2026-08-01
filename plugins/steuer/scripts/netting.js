/**
 * netting.js
 *
 * Groups transactions by merchant (falling back to payee, then payer, then
 * description) and nets each group's debits against its own credits, so
 * pre-authorisation holds and partial reversals don't inflate reported spend.
 *
 * Expects txns.amount to be **signed** (expense negative, income positive) —
 * unlike the sources/* contract, which hands out unsigned amounts split into
 * income/expenses arrays. Callers combine and sign amounts before this stage.
 */

require('./lib/bootstrap');

// Statuses that reserved/moved no real money — pre-auth holds that never
// settled, or were reversed before settlement.
const NO_MONEY_STATUSES = ['CANCELLED', 'DECLINED', 'REFUNDED_PREAUTH'];

/**
 * @param {object} txn
 * @returns {string} lowercase, trimmed grouping key
 */
function groupKey(txn) {
    const candidate = txn.merchant || txn.payee || txn.payer || txn.description;
    const key = candidate == null ? '' : String(candidate).trim().toLowerCase();
    if (!key) {
        throw new Error('transaction has no grouping key: ' + JSON.stringify(txn));
    }
    return key;
}

/**
 * Drops rows that never moved money: zero-amount rows, memo/informational
 * rows, and holds that were cancelled/declined/reversed before settling.
 *
 * @param {object[]} txns
 * @returns {{ kept: object[], dropped: object[] }}
 */
function filterMoved(txns) {
    const kept = [];
    const dropped = [];
    for (const txn of txns) {
        const status = txn.raw && txn.raw.status;
        const isNoMove = txn.amount === 0 ||
            (txn.raw && txn.raw.balanceImpact === 'Memo') ||
            NO_MONEY_STATUSES.includes(status);
        (isNoMove ? dropped : kept).push(txn);
    }
    return { kept, dropped };
}

/**
 * Groups txns by groupKey() and nets each group's signed amounts.
 *
 * ponytail: assumes every txn in a group shares one currency — mixed-currency
 * groups (e.g. a merchant charged in both EUR and USD) sum raw amounts as-is.
 * Convert to a common currency before netting if that turns out to happen.
 *
 * @param {object[]} txns - signed amounts (expense negative, income positive)
 * @param {{ flagThreshold?: number }} [opts]
 * @returns {Array<{ key: string, txns: object[], gross: number, net: number, credits: number, direction: 'in'|'out', flagged: boolean }>}
 */
function netGroups(txns, { flagThreshold = 0.2 } = {}) {
    const byKey = new Map();
    for (const txn of txns) {
        const key = groupKey(txn);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(txn);
    }

    return Array.from(byKey, ([key, groupTxns]) => {
        let sum = 0;
        let gross = 0;
        let credits = 0;
        for (const txn of groupTxns) {
            sum += txn.amount;
            if (txn.amount < 0) gross += -txn.amount;
            else credits += txn.amount;
        }
        const net = Math.abs(sum);
        const direction = sum < 0 ? 'out' : 'in';
        // gross > 0 guard avoids a divide-by-zero on credit-only (income) groups.
        const flagged = credits > 0 && gross > 0 && (gross - net) / gross > flagThreshold;
        return { key, txns: groupTxns, gross, net, credits, direction, flagged };
    });
}

module.exports = { groupKey, filterMoved, netGroups };
