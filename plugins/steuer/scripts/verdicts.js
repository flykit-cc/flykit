/**
 * verdicts.js — the verdict map: load/save/lookup/apply.
 *
 * `verdicts-<year>.json` is the single source of truth for how a merchant
 * group is treated. One entry per merchant, written once by the model or
 * the user, applied by code forever after. See
 * ../references/tax-categories.md (and the design doc) for the codes.
 *
 * Rules, each of which prevented a real bug:
 *   - Longest key match wins; on a length tie the later map entry wins.
 *   - Absent from the map -> MISSING, reported loudly, never defaulted.
 *   - Unknown code -> throw. Dispatch is exhaustive; there is no silent else.
 */

require('./lib/bootstrap');

const fs = require('fs');

const CODES = Object.freeze({
    B: 'Business expense',
    A: 'Apportioned business expense (share required)',
    P: 'Private expense',
    V: 'Vorsorge — retirement/insurance, excluded from EÜR',
    N: 'Not an expense — internal transfer or capital movement',
    R: 'Needs user review',
    M: 'Medical expense (§33 EStG)',
    H: 'Household services (§35a EStG)',
    I: 'Taxable income',
    NI: 'Inbound, not income',
});

/**
 * Find the best-matching map entry for a group key: a case-insensitive
 * substring match, longest map key wins, later entry wins on a length tie.
 * @returns {{ mapKey: string, verdict: object } | null}
 */
function findMatch(map, key) {
    const target = String(key).toLowerCase();
    let best = null; // { mapKey, verdict, length }
    for (const mapKey of Object.keys(map)) {
        const candidate = mapKey.toLowerCase();
        if (!target.includes(candidate)) continue;
        // >= (not >) makes a later same-length entry override an earlier one,
        // since Object.keys() preserves insertion order for string keys.
        if (best === null || candidate.length >= best.length) {
            best = { mapKey, verdict: map[mapKey], length: candidate.length };
        }
    }
    return best;
}

function lookupVerdict(map, key) {
    const match = findMatch(map, key);
    return match ? match.verdict : null;
}

/**
 * Throws on a non-object verdict, an unknown code, or code 'A' without a
 * numeric share in (0, 1].
 */
function validateVerdict(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        throw new Error(`verdict must be an object, got ${JSON.stringify(v)}`);
    }
    if (!Object.prototype.hasOwnProperty.call(CODES, v.code)) {
        throw new Error(`unknown verdict code: ${JSON.stringify(v.code)}`);
    }
    if (v.code === 'A') {
        const { share } = v;
        if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0 || share > 1) {
            throw new Error(`verdict code 'A' requires a numeric share in (0,1], got ${JSON.stringify(share)}`);
        }
    }
}

/**
 * Classify every group against the verdict map.
 * @returns {{ classified: {group, verdict, mapKey}[], missing: object[] }}
 */
function applyVerdicts(groups, map) {
    const classified = [];
    const missing = [];
    for (const group of groups) {
        const match = findMatch(map, group.key);
        if (!match) {
            missing.push(group);
            continue;
        }
        validateVerdict(match.verdict);
        classified.push({ group, verdict: match.verdict, mapKey: match.mapKey });
    }
    return { classified, missing };
}

/** {} if the file doesn't exist yet; a parse error throws naming the file. */
function loadVerdicts(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`invalid JSON in verdicts file "${filePath}": ${err.message}`);
    }
}

/** Pretty-printed, insertion order preserved (JSON.stringify does this for string keys). */
function saveVerdicts(filePath, map) {
    fs.writeFileSync(filePath, JSON.stringify(map, null, 4) + '\n');
}

module.exports = {
    CODES,
    loadVerdicts,
    saveVerdicts,
    lookupVerdict,
    applyVerdicts,
    validateVerdict,
};
