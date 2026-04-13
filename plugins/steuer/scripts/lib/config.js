/**
 * Config loader for the steuer plugin.
 *
 * Non-secret preferences live in:
 *   ~/.config/flykit/steuer/config.json
 *
 * Secrets (API tokens) live in process.env, loaded from the project's .env
 * file via dotenv. Callers should `require('dotenv').config()` before invoking
 * any source that needs credentials.
 *
 * Config schema (all optional):
 *   {
 *     "default_year": 2024,
 *     "default_profile": "all",
 *     "default_source": "wise",
 *     "output_dir": "./output",
 *     "account": {
 *       "name": "...",
 *       "bank": "..."
 *     }
 *   }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'flykit', 'steuer');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
    default_year: new Date().getFullYear() - 1,
    default_profile: 'all',
    default_source: 'wise',
    output_dir: path.join(process.cwd(), 'output'),
    account: {
        name: process.env.ACCOUNT_NAME || '',
        bank: process.env.ACCOUNT_BANK || '',
    },
};

function readConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
        console.warn(`Warning: ${CONFIG_PATH} is not valid JSON, ignoring. (${err.message})`);
        return {};
    }
}

function loadConfig() {
    const file = readConfig();
    return {
        ...DEFAULTS,
        ...file,
        account: { ...DEFAULTS.account, ...(file.account || {}) },
    };
}

function configPath() {
    return CONFIG_PATH;
}

function ensureWiseToken() {
    if (!process.env.WISE_API_TOKEN) {
        console.error('');
        console.error('=================================================================');
        console.error('  WISE_API_TOKEN is not set.');
        console.error('');
        console.error('  Setup steps:');
        console.error('    1. Get a token: https://wise.com/settings/account → API tokens');
        console.error('    2. Copy plugins/steuer/.env.example to your project root as .env');
        console.error('    3. Paste the token: WISE_API_TOKEN=...');
        console.error('    4. Re-run this command');
        console.error('=================================================================');
        console.error('');
        process.exit(1);
    }
}

module.exports = { loadConfig, configPath, ensureWiseToken, CONFIG_DIR, CONFIG_PATH };
