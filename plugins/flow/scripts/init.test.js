'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { copyIfMissing, ensureDir, parseArgs, main } = require('./init');

function mkSandbox() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-test-'));
}

test('parseArgs: default target is cwd', () => {
    const args = parseArgs([]);
    assert.equal(args.target, process.cwd());
});

test('parseArgs: --target honored', () => {
    const args = parseArgs(['--target', '/tmp/foo']);
    assert.equal(args.target, path.resolve('/tmp/foo'));
});

test('parseArgs: -t short flag honored', () => {
    const args = parseArgs(['-t', '/tmp/bar']);
    assert.equal(args.target, path.resolve('/tmp/bar'));
});

test('ensureDir: creates missing dir', () => {
    const sandbox = mkSandbox();
    const dir = path.join(sandbox, 'issues');
    const res = ensureDir(dir);
    assert.equal(res.created, true);
    assert.equal(fs.existsSync(dir), true);
});

test('ensureDir: idempotent — second call does not "create"', () => {
    const sandbox = mkSandbox();
    const dir = path.join(sandbox, 'issues');
    ensureDir(dir);
    const res2 = ensureDir(dir);
    assert.equal(res2.created, false);
});

test('copyIfMissing: copies template when dest is absent', () => {
    const sandbox = mkSandbox();
    const src = path.join(sandbox, 'src.md');
    const dest = path.join(sandbox, 'sub', 'dest.md');
    fs.writeFileSync(src, 'hello');
    const res = copyIfMissing(src, dest);
    assert.equal(res.created, true);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'hello');
});

test('copyIfMissing: never overwrites an existing file', () => {
    const sandbox = mkSandbox();
    const src = path.join(sandbox, 'src.md');
    const dest = path.join(sandbox, 'dest.md');
    fs.writeFileSync(src, 'NEW');
    fs.writeFileSync(dest, 'KEEP');
    const res = copyIfMissing(src, dest);
    assert.equal(res.created, false);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'KEEP');
});

test('copyIfMissing: reports missing source gracefully', () => {
    const sandbox = mkSandbox();
    const src = path.join(sandbox, 'does-not-exist.md');
    const dest = path.join(sandbox, 'dest.md');
    const res = copyIfMissing(src, dest);
    assert.equal(res.created, false);
    assert.equal(res.missingSource, true);
});

test('main: idempotent — running twice produces same files, no overwrite', () => {
    const sandbox = mkSandbox();
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', sandbox];

    try {
        const code1 = main();
        assert.equal(code1, 0);

        // Files we expect to exist regardless of whether templates were present.
        const issuesDir = path.join(sandbox, 'issues');
        assert.equal(fs.existsSync(issuesDir), true, 'issues/ created');

        // If config was copied, mutate it and ensure second run leaves it alone.
        const configDest = path.join(sandbox, '.claude', 'config.md');
        if (fs.existsSync(configDest)) {
            fs.writeFileSync(configDest, 'USER EDIT');
        }
        const claudeDest = path.join(sandbox, 'CLAUDE.md');
        if (fs.existsSync(claudeDest)) {
            fs.writeFileSync(claudeDest, 'USER EDIT');
        }

        const code2 = main();
        assert.equal(code2, 0);

        if (fs.existsSync(configDest)) {
            assert.equal(fs.readFileSync(configDest, 'utf8'), 'USER EDIT', 'config preserved');
        }
        if (fs.existsSync(claudeDest)) {
            assert.equal(fs.readFileSync(claudeDest, 'utf8'), 'USER EDIT', 'CLAUDE.md preserved');
        }
    } finally {
        process.argv = origArgv;
    }
});

test('main: --target honored', () => {
    const sandbox = mkSandbox();
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', sandbox];
    try {
        const code = main();
        assert.equal(code, 0);
        assert.equal(fs.existsSync(path.join(sandbox, 'issues')), true);
    } finally {
        process.argv = origArgv;
    }
});

test('main: nonexistent target returns non-zero', () => {
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', '/tmp/flow-does-not-exist-xyz-' + Date.now()];
    try {
        const code = main();
        assert.notEqual(code, 0);
    } finally {
        process.argv = origArgv;
    }
});
