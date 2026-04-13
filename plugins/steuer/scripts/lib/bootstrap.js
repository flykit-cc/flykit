/**
 * bootstrap.js
 *
 * Ensures the steuer plugin's npm dependencies are installed before any
 * script tries to require them. Required at the top of every script in
 * plugins/steuer/scripts/.
 *
 * Design:
 *   - Fast path: a single fs.statSync check on node_modules (~ms).
 *   - Cold path: run `npm install` synchronously from the plugin root,
 *     stream output to the user, exit non-zero on failure.
 *   - Idempotent: subsequent requires are no-ops once node_modules exists.
 *   - Zero dependencies: pure Node (fs, path, child_process).
 *
 * Why not a plugin lifecycle hook? Claude Code has no post-install event
 * (as of 2026-04). SessionStart fires every session; doing it lazily at
 * first script invocation is cheaper and more contained.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// This file lives at plugins/steuer/scripts/lib/bootstrap.js.
// Plugin root is two levels up.
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const NODE_MODULES = path.join(PLUGIN_ROOT, 'node_modules');
const PACKAGE_JSON = path.join(PLUGIN_ROOT, 'package.json');

function alreadyInstalled() {
    // Cheap stat: if node_modules exists as a directory, assume deps are present.
    // A corrupt install is rare and recoverable by `rm -rf node_modules` +
    // re-invoking — we optimise for the common case.
    try {
        return fs.statSync(NODE_MODULES).isDirectory();
    } catch (_) {
        return false;
    }
}

function run() {
    if (alreadyInstalled()) return;

    if (!fs.existsSync(PACKAGE_JSON)) {
        // Nothing to install — plugin has no package.json. Treat as success.
        return;
    }

    process.stderr.write(
        '[steuer] First run detected — installing npm dependencies...\n' +
        `[steuer] This happens once. Target: ${PLUGIN_ROOT}\n`
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
            `[steuer] Failed to spawn npm: ${result.error.message}\n` +
            '[steuer] Is Node.js >= 18 installed with npm on PATH?\n'
        );
        process.exit(1);
    }

    if (result.status !== 0) {
        process.stderr.write(
            `[steuer] npm install exited with code ${result.status}.\n` +
            `[steuer] Try running it manually: cd "${PLUGIN_ROOT}" && npm install\n`
        );
        process.exit(result.status || 1);
    }

    process.stderr.write('[steuer] Dependencies installed.\n');
}

run();

module.exports = { pluginRoot: PLUGIN_ROOT };
