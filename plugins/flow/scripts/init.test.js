'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { copyIfMissing, ensureDir, appendSection, parseArgs, main } = require('./init');

function mkSandbox() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-test-'));
}

// Existing tests below drive init via `main()` directly (mutating process.argv);
// runInit follows that same convention rather than shelling out to a subprocess.
function runInit(target) {
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', target];
    try {
        return main();
    } finally {
        process.argv = origArgv;
    }
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

        // config.md still uses copyIfMissing: mutate it and ensure second run leaves it alone.
        const configDest = path.join(sandbox, '.claude', 'config.md');
        if (fs.existsSync(configDest)) {
            fs.writeFileSync(configDest, 'USER EDIT');
        }
        // CLAUDE.md now uses appendSection: an existing file without the flow marker
        // gets the section appended (not skipped), so it is preserved but NOT left
        // byte-for-byte identical — that's the whole point of Task 7.
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
            const claudeText = fs.readFileSync(claudeDest, 'utf8');
            assert.match(claudeText, /^USER EDIT/, 'existing CLAUDE.md content preserved at the top');
            assert.match(claudeText, /<!-- flow:begin -->/, 'flow section appended since no marker was present');
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

test('init appends the flow section to an existing CLAUDE.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# My project\n\nExisting notes.\n');

    runInit(target);

    const text = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.match(text, /# My project/, 'existing content must be preserved');
    assert.match(text, /<!-- flow:begin -->/, 'flow section must be appended');
});

test('init is idempotent on CLAUDE.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# My project\n');

    runInit(target);
    runInit(target);

    const text = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    const count = (text.match(/<!-- flow:begin -->/g) || []).length;
    assert.equal(count, 1, 'the flow section must appear exactly once');
});

// Direct unit tests for appendSection: these pin down the exact behaviour that
// the end-to-end init tests above only exercise indirectly.

test('appendSection: creates the file (and parent dir) when absent', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'nested', 'CLAUDE.md');
    const result = appendSection(dest, 'flow', 'Some flow conventions.');
    assert.equal(result, 'created');
    const text = fs.readFileSync(dest, 'utf8');
    assert.equal(text, '<!-- flow:begin -->\nSome flow conventions.\n<!-- flow:end -->\n');
});

test('appendSection: appends to an existing file that lacks the marker', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes\n\nKeep this.\n');
    const result = appendSection(dest, 'flow', 'Flow body.');
    assert.equal(result, 'appended');
    const text = fs.readFileSync(dest, 'utf8');
    assert.match(text, /^# Notes\n\nKeep this\.\n/, 'original content stays untouched at the top');
    assert.match(text, /<!-- flow:begin -->\nFlow body\.\n<!-- flow:end -->\n$/, 'block appended at the end');
});

test('appendSection: does not glue the block onto a file missing a trailing newline', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes with no trailing newline');
    appendSection(dest, 'flow', 'Flow body.');
    const text = fs.readFileSync(dest, 'utf8');
    assert.doesNotMatch(text, /newline<!--/, 'block must not be glued onto the last line');
    assert.match(text, /# Notes with no trailing newline\n/);
});

test('appendSection: is a no-op ("present") when the marker already exists, leaving content untouched', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes\n\n<!-- flow:begin -->\nOld body.\n<!-- flow:end -->\n');
    const result = appendSection(dest, 'flow', 'New body that should NOT appear.');
    assert.equal(result, 'present');
    const text = fs.readFileSync(dest, 'utf8');
    assert.equal(text, '# Notes\n\n<!-- flow:begin -->\nOld body.\n<!-- flow:end -->\n', 'file left byte-for-byte untouched');
    assert.doesNotMatch(text, /New body/, 'must not overwrite with new body when marker is already present');
});
