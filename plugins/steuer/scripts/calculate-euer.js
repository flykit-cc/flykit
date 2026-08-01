#!/usr/bin/env node
/**
 * calculate-euer.js
 *
 * Black-box CLI: read a classified transactions JSON, convert USD to EUR via
 * ECB rates, apply the verdict-map codes to decide what counts toward the
 * EÜR, and emit PDF + CSV reports + a summary JSON.
 *
 * classified.json is the frozen audit artifact: parse-statements bakes each
 * group's verdict into it and asserts reconciliation against that exact
 * state. This file reads verdicts ONLY from that frozen data (group.verdict,
 * txn.verdictCode) — never re-loads the verdicts file or re-runs a lookup —
 * so the numbers here always match what the classified.json's own
 * reconciliation block describes. Edit the verdict file, re-run
 * parse-statements to re-gate and re-freeze, then calculate.
 *
 * Money-path rules (see docs/superpowers/specs/2026-07-31-steuer-correctness-core-and-validation-api-design.md):
 *   - income = groups coded I, plus legacy rows (no groupKey) with
 *     classification === 'taxable' — so 0.1.0 output still computes.
 *   - expenses = code B in full, code A at its share, applied exactly once;
 *     P/V/N/NI/M/H are excluded from the EÜR entirely.
 *   - any group still R or MISSING (verdict === null) aborts the run
 *     (exit 2), unless --include-review, which admits R groups on the
 *     income side only — MISSING always aborts, flag or not.
 *
 * Usage:
 *   node calculate-euer.js --year 2024
 *   node calculate-euer.js --year 2024 --input ./out/steuer-2024-classified.json --output ./out
 *   node calculate-euer.js --year 2024 --include-review     # admit review-flagged income
 */

require('./lib/bootstrap');
require('dotenv').config({ path: process.env.STEUER_ENV || '.env' });

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const rateConverter = require('./rateConverter');
const { validateVerdict } = require('./verdicts');
const { generatePDF } = require('./pdfGenerator');
const { generateCSV } = require('./csvGenerator');

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

function totals(transactions) {
    return {
        totalEUR: transactions.reduce((s, t) => s + (t.amountEUR || 0), 0),
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Groups are keyed by merchant key + currency (netting.js groups purely by
// key, so this also guards against a future currency-split group scheme).
function groupLookupKey(key, currency) {
    return `${key}|${currency}`;
}

/**
 * Decide, per group, whether the run may proceed. A group blocks the run if
 * its verdict is null (MISSING), or coded R without --include-review.
 * MISSING always blocks — never pardoned by the flag.
 *
 * Reads groups straight off classified.json (the frozen audit artifact) —
 * see file header. Also re-validates each group's verdict shape (unknown
 * code / bad share throws), since classified.json could have been
 * hand-edited after parse-statements wrote it.
 *
 * @returns {{ ok: true, verdictByGroupKey: Map } | { ok: false, offending: {group, label}[] }}
 */
function gateCheck(data, { includeReview = false } = {}) {
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const verdictByGroupKey = new Map();
    const missingGroups = [];
    const reviewGroups = [];

    for (const group of groups) {
        if (group.verdict == null) {
            missingGroups.push(group);
            continue;
        }
        validateVerdict(group.verdict);
        verdictByGroupKey.set(groupLookupKey(group.key, group.currency), group.verdict);
        if (group.verdict.code === 'R') reviewGroups.push(group);
    }

    const offending = [
        ...missingGroups.map(group => ({ group, label: 'MISSING' })),
        ...(includeReview ? [] : reviewGroups.map(group => ({ group, label: 'R' }))),
    ];
    if (offending.length > 0) return { ok: false, offending };
    return { ok: true, verdictByGroupKey };
}

/**
 * Split EUR-converted income/expense rows into what counts toward the EÜR
 * and what doesn't, tallying EUR sums per verdict code either way.
 *
 * Rows must already carry amountEUR (post rateConverter.batchConvert) and
 * their own bare verdictCode (txn convenience field). Code A's share comes
 * from the group, via verdictByGroupKey (gateCheck().verdictByGroupKey) —
 * looked up once per row and applied exactly once, here, and nowhere else.
 *
 * @param {object[]} incomeRows
 * @param {object[]} expenseRows
 * @param {Map} verdictByGroupKey - from gateCheck().verdictByGroupKey
 * @param {{ includeReview?: boolean }} [opts]
 */
function splitAndTally(incomeRows, expenseRows, verdictByGroupKey, { includeReview = false } = {}) {
    const included = { income: [], expenses: [] };
    const includedTallies = new Map(); // code -> { count, sumEUR } (raw, unrounded)
    const excludedTallies = new Map();

    const bump = (map, code, amountEUR) => {
        const t = map.get(code) || { count: 0, sumEUR: 0 };
        t.count += 1;
        t.sumEUR += amountEUR || 0;
        map.set(code, t);
    };

    // Verdict-coded rows are routed by their CODE, not by which array they
    // arrived in: parse-statements splits arrays by sign, so a refund credit
    // inside a B group sits income-side in classified.json — but it must
    // offset that group's expenses here, or netting is silently lost and
    // gross debits get claimed (the pre-auth overstatement bug).
    const rows = [
        ...incomeRows.map(tx => ({ tx, origin: 'income' })),
        ...expenseRows.map(tx => ({ tx, origin: 'expense' })),
    ];

    for (const { tx, origin } of rows) {
        // Rows that never moved money (or were excluded as cross-source
        // funding legs) are already accounted for by parse-statements'
        // reconciliation; they carry no verdict and never enter the EÜR.
        if (tx.dropped) continue;

        if (!tx.groupKey) {
            // Legacy 0.1.0 shape: no verdict map involved. Income falls back
            // to the keyword classifier's field; every expense counted, as it
            // always did. Amounts are positive magnitudes in legacy files.
            if (origin === 'income') {
                if (tx.classification === 'taxable') {
                    included.income.push(tx);
                    bump(includedTallies, 'I', tx.amountEUR);
                } else if (tx.classification === 'review' && includeReview) {
                    included.income.push(tx);
                    bump(includedTallies, 'R', tx.amountEUR);
                } else {
                    bump(excludedTallies, tx.classification || 'unclassified', tx.amountEUR);
                }
            } else {
                included.expenses.push(tx);
                bump(includedTallies, 'B', tx.amountEUR);
            }
            continue;
        }

        switch (tx.verdictCode) {
            case 'I':
                included.income.push(tx);
                bump(includedTallies, 'I', tx.amountEUR);
                break;
            case 'R':
                // The review flag only ever admits R on the income side.
                if (origin === 'income' && includeReview) {
                    included.income.push(tx);
                    bump(includedTallies, 'R', tx.amountEUR);
                } else {
                    bump(excludedTallies, 'R', tx.amountEUR);
                }
                break;
            case 'B':
                included.expenses.push(tx);
                bump(includedTallies, 'B', tx.amountEUR);
                break;
            case 'A': {
                const verdict = verdictByGroupKey.get(groupLookupKey(tx.groupKey, tx.currency));
                if (!verdict || typeof verdict.share !== 'number') {
                    throw new Error(`expense row in group "${tx.groupKey}" is coded A but has no share to apply — gateCheck should have caught this`);
                }
                const apportioned = { ...tx, amountEUR: (tx.amountEUR || 0) * verdict.share };
                included.expenses.push(apportioned);
                bump(includedTallies, 'A', apportioned.amountEUR);
                break;
            }
            default:
                // P, V, N, NI, M, H — never part of the EÜR.
                bump(excludedTallies, tx.verdictCode, tx.amountEUR);
        }
    }

    const by_category = {};
    for (const [code, t] of includedTallies) by_category[code] = round2(t.sumEUR);
    for (const [code, t] of excludedTallies) {
        by_category[code] = round2((by_category[code] || 0) + t.sumEUR);
    }
    const excluded = Array.from(excludedTallies, ([code, t]) => ({ code, count: t.count, sumEUR: round2(t.sumEUR) }))
        .sort((a, b) => String(a.code).localeCompare(String(b.code)));

    return { income: included.income, expenses: included.expenses, by_category, excluded };
}

async function main() {
    const args = parseArgs(process.argv);
    const config = loadConfig();

    const year = parseInt(args.year || config.default_year, 10);
    if (!year || Number.isNaN(year)) {
        console.error('Error: --year <YYYY> is required');
        process.exit(1);
    }

    const outputDir = path.resolve(args.output || config.output_dir || './output');
    fs.mkdirSync(outputDir, { recursive: true });

    const inputPath = path.resolve(args.input || path.join(outputDir, `steuer-${year}-classified.json`));
    if (!fs.existsSync(inputPath)) {
        console.error(`Error: classified input not found at ${inputPath}`);
        console.error('Run parse-statements first, or pass --input <path>.');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    const includeReview = !!args['include-review'];

    const gate = gateCheck(data, { includeReview });
    if (!gate.ok) {
        console.error(`Error: ${gate.offending.length} group(s) unresolved — cannot compute EÜR:`);
        const sorted = [...gate.offending].sort((a, b) => Math.abs(b.group.net) - Math.abs(a.group.net));
        for (const { group, label } of sorted) {
            console.error(`  ${label.padEnd(7)} ${group.key}  net ${group.net.toFixed(2)} ${group.currency || ''} ${group.direction || ''}`);
        }
        console.error('Resolve these in the verdicts file and re-run parse-statements, or pass --include-review to admit R groups on the income side.');
        process.exit(2);
    }

    console.log(`Loaded ${data.income.length} income rows, ${data.expenses.length} expense rows`);

    await rateConverter.prefetchRates(year, 'USD', 'EUR', { cacheDir: outputDir });
    const convertedIncome = await rateConverter.batchConvert(data.income);
    const convertedExpenses = await rateConverter.batchConvert(data.expenses);

    const { income, expenses, by_category, excluded } = splitAndTally(
        convertedIncome, convertedExpenses, gate.verdictByGroupKey, { includeReview }
    );

    const incomeTotals = totals(income);
    const expenseTotals = totals(expenses);
    // New-pipeline files carry SIGNED amounts (expenses negative), so Gewinn
    // is a plain signed sum — subtracting a negative total would double-count.
    // Legacy 0.1.0 files carry positive magnitudes in both arrays; their
    // original subtraction is preserved byte-for-byte.
    const net = Array.isArray(data.groups)
        ? incomeTotals.totalEUR + expenseTotals.totalEUR
        : incomeTotals.totalEUR - expenseTotals.totalEUR;

    const baseName = `steuer-${year}`;
    const csvPath = path.join(outputDir, `${baseName}.csv`);
    const pdfPath = path.join(outputDir, `${baseName}.pdf`);
    const summaryPath = path.join(outputDir, `${baseName}-summary.json`);

    generateCSV({ outputPath: csvPath, income, expenses });
    generatePDF({
        outputPath: pdfPath,
        year,
        income,
        expenses,
        incomeTotals,
        expenseTotals,
        accountInfo: config.account,
    });

    fs.writeFileSync(summaryPath, JSON.stringify({
        year,
        generated: new Date().toISOString(),
        income_total_eur: parseFloat(incomeTotals.totalEUR.toFixed(2)),
        expense_total_eur: parseFloat(expenseTotals.totalEUR.toFixed(2)),
        gewinn_eur: parseFloat(net.toFixed(2)),
        income_count: income.length,
        expense_count: expenses.length,
        by_category,
        excluded,
        files: { csv: csvPath, pdf: pdfPath },
    }, null, 2));

    console.log('');
    console.log(`Income (EUR):     ${incomeTotals.totalEUR.toFixed(2)}`);
    console.log(`Expenses (EUR):   ${expenseTotals.totalEUR.toFixed(2)}`);
    console.log(`Gewinn (EUR):     ${net.toFixed(2)}`);
    if (excluded.length > 0) {
        console.log('');
        console.log('Excluded from EÜR:');
        for (const e of excluded) console.log(`  ${e.code}: ${e.count} row(s), ${e.sumEUR.toFixed(2)} EUR`);
    }
    console.log('');
    console.log(`Wrote ${summaryPath}`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { totals, parseArgs, gateCheck, splitAndTally };
