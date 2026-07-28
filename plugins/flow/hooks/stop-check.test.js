'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'stop-check.sh');

function makeRepo(configBody) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-stop-'));
    execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), configBody);
    return root;
}

function runHook(root) {
    return execFileSync('bash', [HOOK], {
        encoding: 'utf8',
        input: JSON.stringify({ cwd: root, stop_hook_active: false }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
    });
}

test('a failing build gate does not block when stop_check is lint', () => {
    // build_cmd deliberately fails; with stop_check=lint it must be ignored.
    const root = makeRepo('- stop_check: lint\n- build_cmd: false\n');
    fs.writeFileSync(path.join(root, '.build-check'), '');

    const out = runHook(root);

    assert.ok(!out.includes('"decision"'), 'must not emit a block decision');
    assert.equal(fs.existsSync(path.join(root, '.build-check')), false,
        'stale marker must still be consumed');
});

test('a failing build gate blocks when stop_check is lint+build', () => {
    const root = makeRepo('- stop_check: lint+build\n- build_cmd: false\n');
    fs.writeFileSync(path.join(root, '.build-check'), '');

    const out = runHook(root);

    assert.match(out, /"decision"\s*:\s*"block"/);
});
