/**
 * reconcile.js
 *
 * Full-coverage assertion: every transaction row must land in exactly one
 * bucket (INCOME / NOT_INCOME / EXPENSE / INTERNAL / UNKNOWN) or be counted
 * as dropped by the filter step. The check is printed, never implied — see
 * docs/superpowers/specs/2026-07-31-steuer-correctness-core-and-validation-api-design.md.
 */

require('./lib/bootstrap');

const BUCKETS = ['INCOME', 'NOT_INCOME', 'EXPENSE', 'INTERNAL', 'UNKNOWN'];

// Exhaustive dispatch — any verdict code not listed here throws rather than
// falling into a default bucket. See verdicts.js CODES for the full set.
const CODE_TO_BUCKET = {
    I: 'INCOME',
    NI: 'NOT_INCOME',
    N: 'INTERNAL',
    B: 'EXPENSE',
    A: 'EXPENSE',
    P: 'EXPENSE',
    V: 'EXPENSE',
    R: 'EXPENSE',
    M: 'EXPENSE',
    H: 'EXPENSE',
};

function bucketFor(code) {
    const bucket = CODE_TO_BUCKET[code];
    if (!bucket) throw new Error(`unknown verdict code: ${JSON.stringify(code)}`);
    return bucket;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * @param {{ totalRows: number, droppedRows: number, classified: Array, missing: Array }} input
 * @returns {{ buckets: object, ok: boolean, line: string }}
 */
function reconcile({ totalRows, droppedRows, classified, missing }) {
    const buckets = {};
    for (const b of BUCKETS) buckets[b] = { rows: 0, sumEUR: 0 };

    for (const { group, verdict } of classified) {
        const bucket = bucketFor(verdict.code);
        buckets[bucket].rows += group.txns.length;
        buckets[bucket].sumEUR += group.net;
    }
    for (const group of missing) {
        buckets.UNKNOWN.rows += group.txns.length;
        buckets.UNKNOWN.sumEUR += group.net;
    }
    for (const b of BUCKETS) buckets[b].sumEUR = round2(buckets[b].sumEUR);

    const accounted = BUCKETS.reduce((sum, b) => sum + buckets[b].rows, 0) + droppedRows;
    const ok = accounted === totalRows;
    const delta = totalRows - accounted;
    const line = ok
        ? `row-count check: ${accounted} == ${totalRows} -> OK — every row accounted for`
        : `row-count check: ${accounted} != ${totalRows} -> MISMATCH (${delta > 0 ? `short by ${delta}` : `over by ${-delta}`})`;

    return { buckets, ok, line };
}

module.exports = { BUCKETS, bucketFor, reconcile };
