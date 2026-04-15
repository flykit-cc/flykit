/**
 * bootstrap.js
 *
 * Ensures the flow plugin's npm dependencies are installed before any
 * script tries to require them. Required at the top of every script in
 * plugins/flow/scripts/.
 *
 * Design:
 *   - Fast path: a single fs.statSync check on node_modules (~ms).
 *   - Cold path: run `npm install` synchronously from the plugin root,
 *     stream output to the user, exit non-zero on failure.
 *   - Idempotent: subsequent requires are no-ops once node_modules exists.
 *   - Zero dependencies: pure Node (fs, path, child_process).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// This file lives at plugins/flow/scripts/lib/bootstrap.js.
// Plugin root is two levels up.
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const NODE_MODULES = path.join(PLUGIN_ROOT, 'node_modules');
const PACKAGE_JSON = path.join(PLUGIN_ROOT, 'package.json');

function alreadyInstalled() {
    try {
        return fs.statSync(NODE_MODULES).isDirectory();
    } catch (_) {
        return false;
    }
}

function hasDependencies() {
    try {
        const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
        const deps = Object.keys(pkg.dependencies || {}).length;
        const devDeps = Object.keys(pkg.devDependencies || {}).length;
        return deps + devDeps > 0;
    } catch (_) {
        return false;
    }
}

function run() {
    if (alreadyInstalled()) return;

    if (!fs.existsSync(PACKAGE_JSON)) return;

    // No deps declared -> nothing to install.
    if (!hasDependencies()) return;

    process.stderr.write(
        '[flow] First run detected — installing npm dependencies...\n' +
        `[flow] This happens once. Target: ${PLUGIN_ROOT}\n`
    );

    const result = spawnSync(
        'npm',
        ['install', '--no-audit', '--no-fund', '--no-progress'],
        {
            cwd: PLUGIN_ROOT,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        }
    );

    if (result.error) {
        process.stderr.write(
            `[flow] Failed to spawn npm: ${result.error.message}\n` +
            '[flow] Is Node.js >= 18 installed with npm on PATH?\n'
        );
        process.exit(1);
    }

    if (result.status !== 0) {
        process.stderr.write(
            `[flow] npm install exited with code ${result.status}.\n` +
            `[flow] Try running it manually: cd "${PLUGIN_ROOT}" && npm install\n`
        );
        process.exit(result.status || 1);
    }

    process.stderr.write('[flow] Dependencies installed.\n');
}

run();

module.exports = { pluginRoot: PLUGIN_ROOT };
