'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'auto-lint.sh');

function makeRepo(configBody) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-autolint-'));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), configBody);
    return root;
}

function runHook(root, filePath, extraPathDir) {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    if (extraPathDir) {
        env.PATH = `${extraPathDir}:${env.PATH}`;
    }
    return execFileSync('bash', [HOOK], {
        encoding: 'utf8',
        input: JSON.stringify({ tool_input: { file_path: filePath } }),
        env,
        stdio: 'pipe',
    });
}

// Writes a marker file recording that it ran, plus the args it received,
// so tests can observe whether/how the configured command was invoked.
function fakeCmd(root, name) {
    const bin = path.join(root, name);
    fs.writeFileSync(
        bin,
        '#!/usr/bin/env bash\n' +
            `echo "$@" > "${path.join(root, name + '.ran')}"\n`
    );
    fs.chmodSync(bin, 0o755);
    return bin;
}

// Puts a fake binary of the given name on its own PATH dir (so a command
// like `go vet ./...` resolves to our stub instead of failing with
// "command not found", which would otherwise mask whether the hook tried
// to run it).
function fakeCmdOnPath(root, name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-autolint-bin-'));
    fs.writeFileSync(
        path.join(dir, name),
        '#!/usr/bin/env bash\n' + `echo "$@" > "${path.join(root, name + '.ran')}"\n`
    );
    fs.chmodSync(path.join(dir, name), 0o755);
    return dir;
}

test('lint_cmd: eslint runs with the file path appended', () => {
    const root = makeRepo('- lint_cmd: eslint\n');
    const bin = fakeCmd(root, 'eslint');
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), `- lint_cmd: ${bin}\n`);
    const target = path.join(root, 'f.js');
    fs.writeFileSync(target, '// hi\n');

    runHook(root, target);

    const marker = path.join(root, 'eslint.ran');
    assert.ok(fs.existsSync(marker), 'eslint should have run');
    assert.match(fs.readFileSync(marker, 'utf8'), /--fix/, 'eslint is a known auto-fixer');
    assert.match(fs.readFileSync(marker, 'utf8'), new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('lint_cmd: go vet ./... does not run', () => {
    const root = makeRepo('- lint_cmd: go vet ./...\n');
    const binDir = fakeCmdOnPath(root, 'go');
    const target = path.join(root, 'f.go');
    fs.writeFileSync(target, 'package main\n');

    runHook(root, target, binDir);

    assert.equal(fs.existsSync(path.join(root, 'go.ran')), false, 'go must not have run');
});

test('lint_cmd: cargo clippy does not run', () => {
    const root = makeRepo('- lint_cmd: cargo clippy\n');
    const binDir = fakeCmdOnPath(root, 'cargo');
    const target = path.join(root, 'f.rs');
    fs.writeFileSync(target, 'fn main() {}\n');

    runHook(root, target, binDir);

    assert.equal(fs.existsSync(path.join(root, 'cargo.ran')), false, 'cargo must not have run');
});

test('lint_cmd: npm run lint does not run', () => {
    const root = makeRepo('- lint_cmd: npm run lint\n');
    const binDir = fakeCmdOnPath(root, 'npm');
    const target = path.join(root, 'f.js');
    fs.writeFileSync(target, '// hi\n');

    runHook(root, target, binDir);

    assert.equal(fs.existsSync(path.join(root, 'npm.ran')), false, 'npm must not have run');
});

test('lint_cmd: ./node_modules/.bin/eslint runs with the file path (path prefix stripped)', () => {
    const root = makeRepo('');
    fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
    const bin = path.join(root, 'node_modules', '.bin', 'eslint');
    fs.writeFileSync(
        bin,
        '#!/usr/bin/env bash\n' + `echo "$@" > "${path.join(root, 'eslint.ran')}"\n`
    );
    fs.chmodSync(bin, 0o755);
    fs.writeFileSync(
        path.join(root, '.claude', 'config.md'),
        '- lint_cmd: ./node_modules/.bin/eslint\n'
    );
    const target = path.join(root, 'f.js');
    fs.writeFileSync(target, '// hi\n');

    runHook(root, target);

    assert.ok(fs.existsSync(path.join(root, 'eslint.ran')), 'eslint should have run via its path prefix');
});

test('blank lint_cmd does nothing and exits 0', () => {
    const root = makeRepo('- lint_cmd:\n');
    const target = path.join(root, 'f.js');
    fs.writeFileSync(target, '// hi\n');

    assert.doesNotThrow(() => runHook(root, target));
});
