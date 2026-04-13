/**
 * PDF report generator for German tax filings.
 *
 * Produces a two-section report:
 *   1. Income table (Date, Description, original currency, EUR)
 *   2. Expense table (Date, Description, EUR)
 *   3. Summary (totals + net) with ECB methodology disclaimer
 */

require('./lib/bootstrap');

const PDFDocument = require('pdfkit');
const fs = require('fs');

const PAGE_MARGIN = 40;
const FOOTER_RESERVE = 100;
const ROW_HEIGHT = 15;
const ROW_PADDING = 5;

const INCOME_COLS = { date: 80, description: 180, orig: 80, eur: 80 };
const INCOME_WIDTH = INCOME_COLS.date + INCOME_COLS.description + INCOME_COLS.orig + INCOME_COLS.eur;

const EXPENSE_COLS = { date: 80, description: 260, eur: 80 };
const EXPENSE_WIDTH = EXPENSE_COLS.date + EXPENSE_COLS.description + EXPENSE_COLS.eur;

function generatePDF({ outputPath, year, income, expenses, incomeTotals, expenseTotals, accountInfo = {} }) {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' });
    doc.pipe(fs.createWriteStream(outputPath));

    // Header
    if (accountInfo.name) {
        doc.fontSize(14).text(accountInfo.name, { align: 'center' });
    }
    doc.fontSize(12).text(`Tax Year: ${year}`, { align: 'center' });
    doc.moveDown();

    if (accountInfo.bank) {
        doc.fontSize(9);
        doc.text(`Bank: ${accountInfo.bank}`);
        doc.moveDown();
    }

    if (income.length > 0) {
        drawSectionHeader(doc, 'Income (Einnahmen) — converted to EUR');
        drawIncomeTable(doc, income, incomeTotals);
        doc.moveDown(2);
    }

    if (expenses.length > 0) {
        if (doc.y > doc.page.height - 200) doc.addPage();
        drawSectionHeader(doc, 'Expenses (Ausgaben)');
        drawExpenseTable(doc, expenses, expenseTotals);
        doc.moveDown(2);
    }

    if (doc.y > doc.page.height - 180) doc.addPage();

    doc.fontSize(11).font('Helvetica-Bold').text('Summary', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica');

    const incEUR = incomeTotals.totalEUR.toFixed(2);
    const expEUR = expenseTotals.totalEUR.toFixed(2);
    const netEUR = (incomeTotals.totalEUR - expenseTotals.totalEUR).toFixed(2);

    doc.text(`Total Income (EUR):     ${incEUR}`);
    doc.text(`Total Expenses (EUR):   ${expEUR}`);
    doc.font('Helvetica-Bold').text(`Net (EUR):              ${netEUR}`);
    doc.font('Helvetica');

    doc.moveDown(3);
    const disclaimer = `Disclaimer: Currency conversions in this document were generated programmatically using the European Central Bank (ECB) daily reference rates via the Frankfurter API. Each transaction was converted using the ECB rate for its date. For weekends and holidays where the ECB does not publish a rate, the nearest previous trading day's rate was used. This document is an automated calculation and does not constitute tax advice.`;
    doc.fontSize(6).text(disclaimer, { align: 'justify', width: INCOME_WIDTH });

    doc.end();
    console.log(`PDF saved to ${outputPath}`);
}

function drawSectionHeader(doc, title) {
    doc.fontSize(11).font('Helvetica-Bold').text(title, { align: 'center', underline: true });
    doc.moveDown(0.5);
}

function drawLine(doc, y, width) {
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + width, y).stroke();
}

function drawIncomeHeader(doc) {
    const y = doc.y;
    const x = PAGE_MARGIN;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Date', x, y, { width: INCOME_COLS.date });
    doc.text('Description', x + INCOME_COLS.date, y, { width: INCOME_COLS.description });
    doc.text('Original', x + INCOME_COLS.date + INCOME_COLS.description, y, { width: INCOME_COLS.orig, align: 'right' });
    doc.text('EUR', x + INCOME_COLS.date + INCOME_COLS.description + INCOME_COLS.orig, y, { width: INCOME_COLS.eur, align: 'right' });
    drawLine(doc, y + ROW_HEIGHT, INCOME_WIDTH);
    doc.y = y + ROW_HEIGHT + ROW_PADDING;
}

function drawIncomeRow(doc, date, desc, orig, eur) {
    const y = doc.y;
    const x = PAGE_MARGIN;
    doc.fontSize(7).font('Helvetica');
    doc.text(date, x, y, { width: INCOME_COLS.date });
    doc.text(desc, x + INCOME_COLS.date, y, { width: INCOME_COLS.description, ellipsis: true });
    doc.text(orig, x + INCOME_COLS.date + INCOME_COLS.description, y, { width: INCOME_COLS.orig, align: 'right' });
    doc.text(eur, x + INCOME_COLS.date + INCOME_COLS.description + INCOME_COLS.orig, y, { width: INCOME_COLS.eur, align: 'right' });
    drawLine(doc, y + ROW_HEIGHT, INCOME_WIDTH);
    doc.y = y + ROW_HEIGHT + ROW_PADDING;
}

function drawIncomeTable(doc, transactions, totals) {
    drawIncomeHeader(doc);
    for (const tx of transactions) {
        if (doc.y > doc.page.height - FOOTER_RESERVE) {
            doc.addPage();
            drawIncomeHeader(doc);
        }
        const origStr = tx.amount != null ? `${Number(tx.amount).toFixed(2)} ${tx.currency || ''}` : '';
        const eurStr = tx.amountEUR != null ? Number(tx.amountEUR).toFixed(2) : 'N/A';
        drawIncomeRow(doc, tx.date, tx.description || '', origStr, eurStr);
    }

    if (doc.y > doc.page.height - FOOTER_RESERVE) doc.addPage();
    const y = doc.y;
    const x = PAGE_MARGIN;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('TOTAL', x, y, { width: INCOME_COLS.date + INCOME_COLS.description });
    doc.text('', x + INCOME_COLS.date + INCOME_COLS.description, y, { width: INCOME_COLS.orig, align: 'right' });
    doc.text(totals.totalEUR.toFixed(2), x + INCOME_COLS.date + INCOME_COLS.description + INCOME_COLS.orig, y, { width: INCOME_COLS.eur, align: 'right' });
    doc.lineWidth(1.5);
    drawLine(doc, y + ROW_HEIGHT, INCOME_WIDTH);
    doc.lineWidth(1);
    doc.y = y + ROW_HEIGHT + ROW_PADDING;
}

function drawExpenseHeader(doc) {
    const y = doc.y;
    const x = PAGE_MARGIN;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Date', x, y, { width: EXPENSE_COLS.date });
    doc.text('Description', x + EXPENSE_COLS.date, y, { width: EXPENSE_COLS.description });
    doc.text('EUR', x + EXPENSE_COLS.date + EXPENSE_COLS.description, y, { width: EXPENSE_COLS.eur, align: 'right' });
    drawLine(doc, y + ROW_HEIGHT, EXPENSE_WIDTH);
    doc.y = y + ROW_HEIGHT + ROW_PADDING;
}

function drawExpenseRow(doc, date, desc, eur) {
    const y = doc.y;
    const x = PAGE_MARGIN;
    doc.fontSize(7).font('Helvetica');
    doc.text(date, x, y, { width: EXPENSE_COLS.date });
    doc.text(desc, x + EXPENSE_COLS.date, y, { width: EXPENSE_COLS.description, ellipsis: true });
    doc.text(eur, x + EXPENSE_COLS.date + EXPENSE_COLS.description, y, { width: EXPENSE_COLS.eur, align: 'right' });
    drawLine(doc, y + ROW_HEIGHT, EXPENSE_WIDTH);
    doc.y = y + ROW_HEIGHT + ROW_PADDING;
}

function drawExpenseTable(doc, transactions, totals) {
    drawExpenseHeader(doc);
    for (const tx of transactions) {
        if (doc.y > doc.page.height - FOOTER_RESERVE) {
            doc.addPage();
            drawExpenseHeader(doc);
        }
        const eurStr = tx.amountEUR != null ? Number(tx.amountEUR).toFixed(2) : 'N/A';
        drawExpenseRow(doc, tx.date, tx.description || '', eurStr);
    }

    if (doc.y > doc.page.height - FOOTER_RESERVE) doc.addPage();
    const y = doc.y;
    const x = PAGE_MARGIN;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('TOTAL', x, y, { width: EXPENSE_COLS.date + EXPENSE_COLS.description });
    doc.text(totals.totalEUR.toFixed(2), x + EXPENSE_COLS.date + EXPENSE_COLS.description, y, { width: EXPENSE_COLS.eur, align: 'right' });
    doc.lineWidth(1.5);
    drawLine(doc, y + ROW_HEIGHT, EXPENSE_WIDTH);
    doc.lineWidth(1);
    doc.y = y + ROW_HEIGHT + ROW_PADDING;
}

module.exports = { generatePDF };
