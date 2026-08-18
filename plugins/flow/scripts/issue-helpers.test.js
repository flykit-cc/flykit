'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HELPERS = path.join(__dirname, 'issue-helpers.sh');

function run(args, env = {}) {
    return execFileSync('bash', [HELPERS, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: 'pipe',
    }).trim();
}

test('version-check reports the installed version from the plugin manifest', () => {
    const out = run(['version-check']);
    const installed = require('../.claude-plugin/plugin.json').version;
    assert.match(out, new RegExp(`installed=${installed.replace(/\./g, '\\.')}\\b`),
        `expected installed=${installed} in: ${out}`);
});

test('version-check always emits a status the caller can branch on', () => {
    const out = run(['version-check']);
    assert.match(out, /status=(current|behind|ahead|unknown)\b/, out);
});

test('version-check degrades to unknown instead of failing when the network is unreachable', () => {
    // Reporting a bug must never be blocked by being offline.
    const out = run(['version-check'], {
        FLOW_MARKETPLACE_URL: 'https://127.0.0.1:9/nope.json',
    });
    assert.match(out, /latest=unknown status=unknown/, out);
});

test('dupe-search says no-gh rather than failing when gh is unavailable', () => {
    // PATH must point at a directory that EXISTS but has no gh in it. Pointing it
    // at a nonexistent path also hides bash from execFileSync's own lookup, so the
    // spawn dies with ENOENT before the script runs and the test proves nothing.
    // /bin/bash is absolute for the same reason.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-nogh-'));
    const out = execFileSync('/bin/bash', [HELPERS, 'dupe-search', 'continue deletes handoffs'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: emptyDir },
        stdio: 'pipe',
    }).trim();
    assert.strictEqual(out, 'no-gh');
});

test('an unknown subcommand exits non-zero', () => {
    assert.throws(() => run(['not-a-subcommand']));
});
