#!/usr/bin/env node
/**
 * parse-statements.js
 *
 * Black-box CLI: fetch a year of transactions from a source, classify income,
 * and write the result to disk for a downstream calculate-euer step.
 *
 * Usage:
 *   node parse-statements.js --year 2024
 *   node parse-statements.js --year 2024 --source wise --profile all|personal|business
 *   node parse-statements.js --year 2024 --source csv-import --file ./tx.csv
 *   node parse-statements.js --year 2024 --manual-expenses ./extra.json
 *   node parse-statements.js --year 2024 --output ./out
 */

require('./lib/bootstrap');
require('dotenv').config({ path: process.env.STEUER_ENV || '.env' });

const fs = require('fs');
const path = require('path');
const { loadConfig, ensureWiseToken } = require('./lib/config');
const { classifyIncome } = require('./classifier');

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

async function main() {
    const args = parseArgs(process.argv);
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

    if (args['manual-expenses']) {
        const manualPath = path.resolve(args['manual-expenses']);
        const manual = loadManualExpenses(manualPath);
        expenses.push(...manual);
        console.log(`  Merged ${manual.length} manual expenses from ${manualPath}`);
    }

    const classifiedIncome = classifyIncome(income);

    const outPath = path.join(outputDir, `steuer-${year}-classified.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        year,
        source: sourceName,
        generated: new Date().toISOString(),
        income: classifiedIncome,
        expenses,
    }, null, 2));

    const review = classifiedIncome.filter(i => i.classification === 'review').length;
    const taxable = classifiedIncome.filter(i => i.classification === 'taxable').length;
    const notTaxable = classifiedIncome.filter(i => i.classification === 'not_taxable').length;

    console.log('');
    console.log(`Wrote ${outPath}`);
    console.log(`  Income — taxable: ${taxable}, not taxable: ${notTaxable}, review: ${review}`);
    console.log(`  Expenses: ${expenses.length}`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { loadManualExpenses, normalizeManualEntry, parseArgs };
