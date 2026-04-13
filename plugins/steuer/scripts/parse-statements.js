#!/usr/bin/env node
/**
 * parse-statements.js
 *
 * Black-box CLI: fetch a year of transactions from a source, classify income,
 * and write the result to disk for a downstream calculate-euer step.
 *
 * Usage:
 *   node parse-statements.js --year 2024
 *   node parse-statements.js --year 2024 --source wise --profile all
 *   node parse-statements.js --year 2024 --source csv-import --file ./tx.csv
 *   node parse-statements.js --year 2024 --output ./out
 */

require('dotenv').config({ path: process.env.STEUER_ENV || '.env' });

const fs = require('fs');
const path = require('path');
const { loadConfig, ensureWiseToken } = require('./lib/config');
const { classifyIncome } = require('./classifier');

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

    console.log(`Fetching transactions for ${year} from "${sourceName}"...`);
    const sourceOpts = { year };
    if (args.profile) sourceOpts.profile = args.profile;
    if (args.file) sourceOpts.file = args.file;

    const { income, expenses } = await source.fetchTransactions(sourceOpts);
    console.log(`  Income: ${income.length}, Expenses: ${expenses.length}`);

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

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
