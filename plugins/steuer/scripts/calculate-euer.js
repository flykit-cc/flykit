#!/usr/bin/env node
/**
 * calculate-euer.js
 *
 * Black-box CLI: read a classified transactions JSON, convert USD to EUR via
 * ECB rates, compute totals, and emit PDF + CSV reports + an EÜR summary JSON.
 *
 * Usage:
 *   node calculate-euer.js --year 2024
 *   node calculate-euer.js --year 2024 --input ./out/steuer-2024-classified.json --output ./out
 *   node calculate-euer.js --year 2024 --include-review     # treat 'review' income as taxable
 */

require('dotenv').config({ path: process.env.STEUER_ENV || '.env' });

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const rateConverter = require('./rateConverter');
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

    // Filter income — drop non-taxable; optionally include 'review'.
    const income = data.income.filter(i => {
        if (i.classification === 'taxable') return true;
        if (i.classification === 'review' && includeReview) return true;
        return false;
    });
    const expenses = data.expenses;

    console.log(`Loaded ${income.length} taxable income items, ${expenses.length} expenses`);

    await rateConverter.prefetchRates(year);
    const convertedIncome = await rateConverter.batchConvert(income);
    const convertedExpenses = await rateConverter.batchConvert(expenses);

    const incomeTotals = totals(convertedIncome);
    const expenseTotals = totals(convertedExpenses);
    const net = incomeTotals.totalEUR - expenseTotals.totalEUR;

    const baseName = `steuer-${year}`;
    const csvPath = path.join(outputDir, `${baseName}.csv`);
    const pdfPath = path.join(outputDir, `${baseName}.pdf`);
    const summaryPath = path.join(outputDir, `${baseName}-summary.json`);

    generateCSV({ outputPath: csvPath, income: convertedIncome, expenses: convertedExpenses });
    generatePDF({
        outputPath: pdfPath,
        year,
        income: convertedIncome,
        expenses: convertedExpenses,
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
        income_count: convertedIncome.length,
        expense_count: convertedExpenses.length,
        files: { csv: csvPath, pdf: pdfPath },
    }, null, 2));

    console.log('');
    console.log(`Income (EUR):     ${incomeTotals.totalEUR.toFixed(2)}`);
    console.log(`Expenses (EUR):   ${expenseTotals.totalEUR.toFixed(2)}`);
    console.log(`Gewinn (EUR):     ${net.toFixed(2)}`);
    console.log('');
    console.log(`Wrote ${summaryPath}`);
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
