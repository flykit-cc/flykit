/**
 * Generate a CSV report of classified, EUR-converted transactions.
 *
 * Input transactions follow the normalized shape produced by sources/*,
 * augmented with `amountEUR` and optional `rate` from rateConverter.batchConvert.
 */

const { parse } = require('json2csv');
const fs = require('fs');

function generateCSV({ outputPath, income, expenses }) {
    const rows = [];

    for (const tx of income) rows.push(formatRow(tx, 'INCOME'));
    for (const tx of expenses) rows.push(formatRow(tx, 'EXPENSE'));

    const incomeTotalEUR = income.reduce((s, t) => s + (t.amountEUR || 0), 0);
    const expenseTotalEUR = expenses.reduce((s, t) => s + (t.amountEUR || 0), 0);

    if (income.length > 0) {
        rows.push({
            Type: 'INCOME TOTAL',
            Date: '', Description: '', Currency: 'EUR',
            Amount: '', 'EUR Equivalent': incomeTotalEUR.toFixed(2), 'Exchange Rate': '',
        });
    }
    if (expenses.length > 0) {
        rows.push({
            Type: 'EXPENSE TOTAL',
            Date: '', Description: '', Currency: 'EUR',
            Amount: '', 'EUR Equivalent': expenseTotalEUR.toFixed(2), 'Exchange Rate': '',
        });
    }
    rows.push({
        Type: 'NET',
        Date: '', Description: '', Currency: 'EUR',
        Amount: '', 'EUR Equivalent': (incomeTotalEUR - expenseTotalEUR).toFixed(2), 'Exchange Rate': '',
    });

    fs.writeFileSync(outputPath, parse(rows));
    console.log(`CSV saved to ${outputPath}`);
}

function formatRow(tx, type) {
    return {
        Type: type,
        Date: tx.date,
        Description: tx.description || '',
        Currency: tx.currency || 'EUR',
        Amount: tx.amount != null ? Number(tx.amount).toFixed(2) : '',
        'EUR Equivalent': tx.amountEUR != null ? Number(tx.amountEUR).toFixed(2) : 'N/A',
        'Exchange Rate': tx.rate != null ? Number(tx.rate).toFixed(6) : '',
    };
}

module.exports = { generateCSV };
