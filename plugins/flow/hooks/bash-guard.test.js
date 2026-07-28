'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'bash-guard.sh');

function makeProject(configBody) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-guard-'));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), configBody);
    return root;
}

/** Returns {status, stderr}. status 2 = blocked, 0 = allowed. */
function runGuard(root, command) {
    try {
        execFileSync('bash', [HOOK], {
            encoding: 'utf8',
            input: JSON.stringify({ tool_input: { command } }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: root },
            stdio: 'pipe',
        });
        return { status: 0, stderr: '' };
    } catch (e) {
        return { status: e.status, stderr: String(e.stderr) };
    }
}

test('blocks a default expensive command', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'fly deploy --app prod');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fly deploy/);
});

test('allows an ordinary command', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'npm run dev').status, 0);
});

test('honours a project-configured list', () => {
    const root = makeProject('- expensive_cmds: pnpm turbo build\n');
    assert.equal(runGuard(root, 'pnpm turbo build --filter=web').status, 2);
    assert.equal(runGuard(root, 'fly deploy').status, 0, 'config replaces the default list');
});

test('the arming marker allows once, then is consumed', () => {
    const root = makeProject('# empty\n');
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', '.allow-expensive'), '');

    assert.equal(runGuard(root, 'fly deploy').status, 0, 'armed run is allowed');
    assert.equal(fs.existsSync(path.join(root, '.flow', '.allow-expensive')), false,
        'marker must be consumed');
    assert.equal(runGuard(root, 'fly deploy').status, 2, 'next run is blocked again');
});

test('blocks the same command with extra internal whitespace', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'fly   deploy   --app prod');
    assert.equal(r.status, 2, 'runs of whitespace must not defeat the match');
});

test('blocks the same command wrapped in quotes', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, '"fly" deploy --app prod');
    assert.equal(r.status, 2, 'quoting a token must not defeat the match');
});

test('still allows an ordinary command after normalisation', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'echo "hello   world"').status, 0);
});

test('fails open when jq is unavailable', () => {
    const root = makeProject('# empty\n');
    // A PATH of '/nonexistent' would also hide bash itself, so execFileSync
    // would fail with ENOENT (no exit status) rather than exercising the hook.
    // Build a PATH that has the shell utilities but no jq.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-nojq-'));
    for (const tool of ['bash', 'grep', 'sed', 'cat', 'rm', 'printf', 'git', 'basename', 'dirname']) {
        const real = execFileSync('bash', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).trim();
        if (real) fs.symlinkSync(real, path.join(binDir, tool));
    }

    let status = 0;
    try {
        execFileSync(path.join(binDir, 'bash'), [HOOK], {
            encoding: 'utf8',
            input: JSON.stringify({ tool_input: { command: 'fly deploy' } }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: binDir },
            stdio: 'pipe',
        });
    } catch (e) { status = e.status; }
    assert.equal(status, 0, 'must fail open, not block, when jq is missing');
});
