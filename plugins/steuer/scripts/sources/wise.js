/**
 * Wise transaction source.
 *
 * Implements the flykit/steuer transaction source contract:
 *   fetchTransactions({ year, profile }) -> { income: [], expenses: [] }
 *
 * Each transaction is normalized to:
 *   { date, description, amount, currency, source, raw }
 *
 * Requires WISE_API_TOKEN in the environment.
 */

const API_BASE = 'https://api.wise.com';
const MAX_RETRIES = 3;

// Activity types we care about for tax reporting.
const INCOME_TYPES = new Set(['TRANSFER', 'BALANCE_CASHBACK']);
const EXPENSE_TYPES = new Set(['TRANSFER', 'CARD_PAYMENT', 'DIRECT_DEBIT_TRANSACTION', 'CASH_WITHDRAWAL']);
// Skip: INTERBALANCE (internal conversion), CARD_CHECK (auth hold)

function getToken() {
    const token = process.env.WISE_API_TOKEN;
    if (!token) {
        throw new Error(
            'WISE_API_TOKEN not set.\n' +
            'Add it to your project .env file (see plugins/steuer/.env.example).\n' +
            'Get a token at: https://wise.com/settings/account → API tokens'
        );
    }
    return token;
}

async function wiseRequest(endpoint, retries = 0) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Wise API ${response.status}: ${body}`);
        }
        return await response.json();
    } catch (error) {
        if (retries < MAX_RETRIES && error.cause) {
            const delay = Math.pow(2, retries) * 1000;
            console.warn(`Network error, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return wiseRequest(endpoint, retries + 1);
        }
        throw error;
    }
}

async function getProfiles() {
    const profiles = await wiseRequest('/v1/profiles');
    return profiles.map(p => {
        const name = p.details && p.details.firstName
            ? `${p.details.firstName} ${p.details.lastName}`
            : (p.details && p.details.name) || 'Unknown';
        return { id: p.id, type: p.type, name };
    });
}

// Fetch activities for a date range, chunking by half-month to stay under the 100-item API limit.
async function getActivities(profileId, startDate, endDate) {
    const chunks = buildDateChunks(startDate, endDate);
    const seen = new Set();
    const all = [];

    for (const [since, until] of chunks) {
        const url = `/v1/profiles/${profileId}/activities?since=${since}T00:00:00Z&until=${until}T00:00:00Z&size=100`;
        const res = await wiseRequest(url);
        for (const a of (res.activities || [])) {
            if (!seen.has(a.id)) {
                seen.add(a.id);
                all.push(a);
            }
        }
    }
    return all.filter(a => a.status === 'COMPLETED');
}

function buildDateChunks(startDate, endDate) {
    const chunks = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);

    let current = new Date(start);
    while (current < end) {
        const y = current.getFullYear();
        const m = current.getMonth();
        if (current.getDate() <= 15) {
            const chunkEnd = new Date(y, m, 16);
            chunks.push([fmt(current), fmt(chunkEnd < end ? chunkEnd : end)]);
            current = chunkEnd;
        } else {
            const chunkEnd = new Date(y, m + 1, 1);
            chunks.push([fmt(current), fmt(chunkEnd < end ? chunkEnd : end)]);
            current = chunkEnd;
        }
    }
    return chunks;
}

function fmt(d) {
    return d.toISOString().split('T')[0];
}

function parseAmount(amountStr) {
    if (!amountStr) return null;
    const clean = amountStr.replace(/<[^>]+>/g, '').trim();
    const match = clean.match(/[+-]?\s*([\d,]+\.?\d*)\s+([A-Z]{3})/);
    if (!match) return null;
    return {
        amount: parseFloat(match[1].replace(/,/g, '')),
        currency: match[2],
    };
}

function cleanTitle(title) {
    return (title || '').replace(/<[^>]+>/g, '').trim();
}

function isPositiveAmount(amountStr) {
    if (!amountStr) return false;
    const clean = amountStr.replace(/<[^>]+>/g, '').trim();
    return clean.startsWith('+');
}

function categorizeActivities(activities, selfNames = []) {
    const income = [];
    const expenses = [];
    const selfSet = new Set(selfNames.map(n => n.toLowerCase().trim()));

    for (const a of activities) {
        const description = cleanTitle(a.title);
        let parsed = parseAmount(a.primaryAmount);
        if (!parsed) continue;

        // For non-EUR/non-USD currencies, prefer secondaryAmount.
        if (parsed.currency !== 'EUR' && parsed.currency !== 'USD' && a.secondaryAmount) {
            const secondary = parseAmount(a.secondaryAmount);
            if (secondary) parsed = secondary;
        }

        // Skip transfers between own accounts.
        if (a.type === 'TRANSFER' && selfSet.has(description.toLowerCase().trim())) continue;

        const { amount, currency } = parsed;
        const positive = isPositiveAmount(a.primaryAmount);
        const date = (a.createdOn || '').split('T')[0];

        const tx = {
            date,
            description,
            amount,
            currency,
            source: 'wise',
            raw: { id: a.id, type: a.type, profileType: a._profileType || null },
        };

        if (positive && INCOME_TYPES.has(a.type)) {
            income.push(tx);
        } else if (!positive && EXPENSE_TYPES.has(a.type)) {
            expenses.push(tx);
        }
    }

    income.sort((a, b) => a.date.localeCompare(b.date));
    expenses.sort((a, b) => a.date.localeCompare(b.date));
    return { income, expenses };
}

/**
 * Main entry point matching the source contract.
 *
 * @param {Object} opts
 * @param {number} opts.year - Tax year (e.g. 2024)
 * @param {string} [opts.profile] - 'all' | 'personal' | 'business' | profile ID
 * @returns {Promise<{ income: Array, expenses: Array }>}
 */
async function fetchTransactions({ year, profile = 'all' } = {}) {
    if (!year) throw new Error('fetchTransactions: year is required');

    const allProfiles = await getProfiles();
    const profiles = (!profile || profile === 'all')
        ? allProfiles
        : allProfiles.filter(p => p.type === profile || String(p.id) === String(profile));

    if (profiles.length === 0) {
        throw new Error(`No matching Wise profile found for: ${profile}`);
    }

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const activities = [];

    for (const p of profiles) {
        console.log(`  Fetching activities for ${p.name} (${p.type})...`);
        const a = await getActivities(p.id, startDate, endDate);
        for (const item of a) {
            item._profileType = p.type;
            item._profileName = p.name;
        }
        activities.push(...a);
        console.log(`    ${a.length} activities from ${p.type} account`);
    }

    const selfNames = profiles.length > 1
        ? [...new Set(allProfiles.map(p => p.name))]
        : [];

    return categorizeActivities(activities, selfNames);
}

module.exports = {
    fetchTransactions,
    // Lower-level helpers exposed for testing / advanced use.
    getProfiles,
    getActivities,
    categorizeActivities,
    wiseRequest,
};
