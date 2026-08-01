#!/usr/bin/env node
/**
 * parse-statements.js
 *
 * Black-box CLI: fetch a year of transactions from a source, run the
 * filter -> overlap -> net -> verdicts -> reconcile pipeline, and write the
 * result to disk for a downstream calculate-euer step.
 *
 * Usage:
 *   node parse-statements.js --year 2024
 *   node parse-statements.js --year 2024 --source wise --profile all|personal|business
 *   node parse-statements.js --year 2024 --source csv-import --file ./tx.csv
 *   node parse-statements.js --year 2024 --manual-expenses ./extra.json
 *   node parse-statements.js --year 2024 --output ./out
 *   node parse-statements.js --year 2024 --verdicts ./verdicts-2024.json
 *   node parse-statements.js --year 2024 --source-label paypal --prefer-source wise
 */

require('./lib/bootstrap');
require('dotenv').config({ path: process.env.STEUER_ENV || '.env' });

const fs = require('fs');
const path = require('path');
const { loadConfig, ensureWiseToken } = require('./lib/config');
const { classifyIncome } = require('./classifier');
const { groupKey, filterMoved, netGroups } = require('./netting');
const { loadVerdicts, saveVerdicts, applyVerdicts } = require('./verdicts');
const { detectOverlap } = require('./overlap');
const { reconcile } = require('./reconcile');

const MANUAL_ALLOWED_CURRENCIES = new Set(['EUR', 'USD']);
const MANUAL_REQUIRED_FIELDS = ['date', 'description', 'amount', 'currency'];

function loadManualExpenses(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`--manual-expenses file not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`--manual-expenses: invalid JSON in ${filePath}: ${err.message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`--manual-expenses: ${filePath} must contain a JSON array`);
    }
    return parsed.map((entry, idx) => normalizeManualEntry(entry, idx));
}

function normalizeManualEntry(entry, idx) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`--manual-expenses entry ${idx}: must be an object`);
    }
    for (const f of MANUAL_REQUIRED_FIELDS) {
        if (entry[f] === undefined || entry[f] === null || entry[f] === '') {
            throw new Error(`--manual-expenses entry ${idx}: missing field "${f}"`);
        }
    }
    const date = String(entry.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
        throw new Error(`--manual-expenses entry ${idx}: invalid date "${entry.date}" (expected YYYY-MM-DD)`);
    }
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`--manual-expenses entry ${idx}: amount must be a positive number`);
    }
    const currency = String(entry.currency).toUpperCase();
    if (!MANUAL_ALLOWED_CURRENCIES.has(currency)) {
        throw new Error(
            `--manual-expenses entry ${idx}: currency "${entry.currency}" not supported (use EUR or USD)`
        );
    }
    return {
        date,
        description: String(entry.description),
        amount,
        currency,
        source: 'manual',
        raw: entry,
    };
}

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) { args[key] = true; }
            else { args[key] = next; i++; }
        }
    }
    return args;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Groups+nets txns per merchant *and* currency, so a pre-auth and its
 * reversal (always same-currency) still net together while a merchant
 * charged in two currencies gets two separate groups instead of netting.js's
 * documented mixed-currency ponytail (summing raw amounts across currencies).
 *
 * netting.js's groupKey() only reads merchant/payee/payer/description, so we
 * fold currency into a throwaway `merchant` field on a clone, let netGroups()
 * group by that composite, then split the composite back into the plain
 * merchant key + a `currency` field and swap the clones back out for the
 * original txn references (so `group.txns` holds the real objects, not the
 * composite-keyed clones).
 *
 * @param {object[]} txns - signed amounts (expense negative, income positive)
 * @param {{ flagThreshold?: number }} [opts]
 * @returns {Array} netting.js Group[] plus a `currency` field on each group
 */
function netByMerchantAndCurrency(txns, opts) {
    const originalByClone = new Map();
    const keyed = txns.map((txn) => {
        const clone = { ...txn, merchant: `${groupKey(txn)}|${txn.currency}` };
        originalByClone.set(clone, txn);
        return clone;
    });

    return netGroups(keyed, opts).map((group) => {
        const sep = group.key.lastIndexOf('|');
        return {
            ...group,
            key: group.key.slice(0, sep),
            currency: group.key.slice(sep + 1).toUpperCase(),
            txns: group.txns.map((t) => originalByClone.get(t)),
        };
    });
}

/**
 * Refuses to write a verdict map with fewer keys than the one already on
 * disk, unless `force` is set — guards against a run accidentally wiping
 * out verdicts a human already wrote.
 */
function saveVerdictsGuarded(filePath, map, { force = false } = {}) {
    const existing = loadVerdicts(filePath);
    const existingCount = Object.keys(existing).length;
    const newCount = Object.keys(map).length;
    if (newCount < existingCount && !force) {
        throw new Error(
            `refusing to shrink verdicts file "${filePath}": had ${existingCount} verdicts, ` +
            `would write ${newCount}. Pass --force to override.`
        );
    }
    saveVerdicts(filePath, map);
}

/**
 * The `MISSING (n groups): …` block the skill layer parses, sorted by
 * |net| descending so the biggest unresolved amounts surface first.
 */
function formatMissingBlock(missingGroups) {
    const sorted = [...missingGroups].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    const lines = [`MISSING (${sorted.length} groups):`];
    for (const g of sorted) {
        lines.push(`  ${g.currency} ${g.net.toFixed(2)} ${g.direction}  ${g.key}  (${g.txns.length} txns)`);
    }
    return lines.join('\n');
}

function groupForOutput(group, status, verdict, mapKey) {
    return {
        key: group.key,
        currency: group.currency,
        direction: group.direction,
        gross: round2(group.gross),
        net: round2(group.net),
        credits: round2(group.credits),
        flagged: group.flagged,
        status,
        // Full verdict object (not just the code) — calculate-euer reads
        // share/category off this directly and never re-reads the verdicts file.
        verdict: verdict || null,
        mapKey: mapKey || null,
        txnCount: group.txns.length,
    };
}

async function main(argv = process.argv) {
    const args = parseArgs(argv);
    const config = loadConfig();

    const year = parseInt(args.year || config.default_year, 10);
    if (!year || Number.isNaN(year)) {
        console.error('Error: --year <YYYY> is required');
        process.exit(1);
    }

    const sourceName = args.source || config.default_source || 'wise';
    const outputDir = path.resolve(args.output || config.output_dir || './output');
    fs.mkdirSync(outputDir, { recursive: true });

    let source;
    try {
        source = require(`./sources/${sourceName}`);
    } catch (err) {
        console.error(`Error: unknown source "${sourceName}".`);
        console.error('Available: wise, csv-import (or add your own under scripts/sources/).');
        process.exit(1);
    }

    if (sourceName === 'wise') ensureWiseToken();

    const profile = args.profile || config.default_profile || 'all';
    const { VALID_PROFILE_VALUES } = require('./sources/wise');
    if (sourceName === 'wise' && !VALID_PROFILE_VALUES.includes(profile) && !/^\d+$/.test(String(profile))) {
        console.error(
            `Error: invalid --profile value "${profile}". Valid choices: ${VALID_PROFILE_VALUES.join(', ')}.`
        );
        process.exit(1);
    }

    console.log(`Fetching transactions for ${year} from "${sourceName}"...`);
    const sourceOpts = { year, profile };
    if (args.file) sourceOpts.file = args.file;

    const { income, expenses } = await source.fetchTransactions(sourceOpts);
    console.log(`  Income: ${income.length}, Expenses: ${expenses.length}`);

    // Overlap markers are literal source names (see overlap.js namesSource) —
    // this lets e.g. a PayPal CSV import be labeled "paypal" so it matches
    // "PAYPAL *..." card descriptions, without changing the source module.
    if (args['source-label']) {
        const label = String(args['source-label']);
        for (const t of income) t.source = label;
        for (const t of expenses) t.source = label;
        console.log(`  Source label override: "${label}"`);
    }

    if (args['manual-expenses']) {
        const manualPath = path.resolve(args['manual-expenses']);
        const manual = loadManualExpenses(manualPath);
        expenses.push(...manual);
        console.log(`  Merged ${manual.length} manual expenses from ${manualPath}`);
    }

    const verdictsPath = args.verdicts ? path.resolve(args.verdicts) : path.join(outputDir, `verdicts-${year}.json`);
    const verdictsMap = loadVerdicts(verdictsPath);
    // Creates the file (as {}) on first run; never shrinks an existing one.
    saveVerdictsGuarded(verdictsPath, verdictsMap, { force: !!args.force });

    // Income classifier keywords survive only as a suggestion — the verdict
    // map is the source of truth from here on.
    const suggestedIncome = classifyIncome(income).map(({ classification, classificationReason, ...rest }) => ({
        ...rest,
        suggestion: { classification, classificationReason },
    }));

    // Merge into one signed-amount list before filtering/grouping: sources
    // hand out unsigned amounts split into income/expenses arrays; netting.js
    // expects one list with expense negative, income positive.
    const merged = [
        ...suggestedIncome.map((t) => ({ ...t, amount: Math.abs(t.amount), _kind: 'income' })),
        ...expenses.map((t) => ({ ...t, amount: -Math.abs(t.amount), _kind: 'expense' })),
    ];

    const { kept, dropped } = filterMoved(merged);

    // Cross-source duplicates (e.g. a card's PayPal funding leg vs PayPal's
    // own itemised export) are resolved on the flat transaction list, before
    // grouping — grouping by exact description text means a recurring card
    // charge nets into one multi-txn group while an itemised export rarely
    // repeats identical text, so comparing netted *groups* would miss the
    // very case this is meant to catch. Excluded funding legs are removed
    // here so they never form a phantom group of their own.
    const { pairs, excluded } = detectOverlap(kept);
    const excludedSet = new Set(excluded);

    if (args['prefer-source']) {
        const prefer = String(args['prefer-source']);
        for (const { a, b, fundingLeg } of pairs) {
            if (fundingLeg) continue; // already resolved by namesSource()
            if (a.source === prefer && b.source !== prefer) excludedSet.add(b);
            else if (b.source === prefer && a.source !== prefer) excludedSet.add(a);
        }
    }

    const activeTxns = kept.filter((t) => !excludedSet.has(t));
    const overlapExcluded = kept.filter((t) => excludedSet.has(t));

    const groups = netByMerchantAndCurrency(activeTxns, {});
    const { classified, missing } = applyVerdicts(groups, verdictsMap);

    const totalRows = merged.length;
    const droppedRows = dropped.length + overlapExcluded.length;
    const reconciliation = reconcile({ totalRows, droppedRows, classified, missing });

    // Per-txn groupKey / verdictCode / netted, keyed by object identity —
    // `merged`, `dropped`, group.txns and overlapExcluded all share the same
    // txn references, so a Map keyed on the object works without re-parsing.
    const txnInfo = new Map();
    for (const txn of dropped) {
        txnInfo.set(txn, { groupKey: groupKey(txn), verdictCode: null, netted: false, dropped: true });
    }
    for (const txn of overlapExcluded) {
        txnInfo.set(txn, { groupKey: groupKey(txn), verdictCode: null, netted: false, dropped: true });
    }
    function recordGroup(group, verdictCode) {
        const netted = group.txns.length > 1;
        for (const txn of group.txns) {
            txnInfo.set(txn, { groupKey: group.key, verdictCode, netted, dropped: false });
        }
    }
    for (const { group, verdict } of classified) recordGroup(group, verdict.code);
    for (const group of missing) recordGroup(group, null);

    function finalize(txn) {
        const { _kind, ...rest } = txn;
        return { ...rest, ...txnInfo.get(txn) };
    }
    const outputIncome = merged.filter((t) => t._kind === 'income').map(finalize);
    const outputExpenses = merged.filter((t) => t._kind === 'expense').map(finalize);

    const outputGroups = [
        ...classified.map(({ group, verdict, mapKey }) => groupForOutput(group, 'classified', verdict, mapKey)),
        ...missing.map((group) => groupForOutput(group, 'missing', null, null)),
    ];

    const outPath = path.join(outputDir, `steuer-${year}-classified.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        year,
        source: sourceName,
        generated: new Date().toISOString(),
        income: outputIncome,
        expenses: outputExpenses,
        groups: outputGroups,
        reconciliation,
    }, null, 2));

    console.log('');
    console.log(`Wrote ${outPath}`);
    console.log(`Wrote ${verdictsPath}`);
    console.log(`  Dropped (no money moved): ${dropped.length}`);
    console.log(`  Overlap: ${pairs.length} pair(s) detected, ${overlapExcluded.length} funding leg(s) excluded`);
    console.log('');
    console.log(reconciliation.line);
    console.log(formatMissingBlock(missing));
}

if (require.main === module) {
    main().catch(err => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    loadManualExpenses,
    normalizeManualEntry,
    parseArgs,
    netByMerchantAndCurrency,
    saveVerdictsGuarded,
    formatMissingBlock,
    main,
};
