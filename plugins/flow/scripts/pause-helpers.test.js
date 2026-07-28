'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HELPERS = path.join(__dirname, 'pause-helpers.sh');

function git(root, args) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** A temp git repo with one commit, a flow config, and staged-able files. */
function makeRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-pause-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'test']);
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', 'config.md'), '# config\n');
    fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-qm', 'seed']);
    return root;
}

function runFinish(root) {
    const titleFile = path.join(root, '.t');
    const bodyFile = path.join(root, '.b');
    fs.writeFileSync(titleFile, 'Test session\n');
    fs.writeFileSync(bodyFile, 'body\n');
    return execFileSync('bash', [HELPERS, 'finish', titleFile, bodyFile, 'chore: test', '--no-push'], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
    });
}

test('finish does not stage private paths', () => {
    const root = makeRepo();
    fs.writeFileSync(path.join(root, 'src.ts'), 'export const a = 1;\n');
    fs.mkdirSync(path.join(root, 'docs', 'superpowers'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'superpowers', 'plan.md'), 'private\n');

    runFinish(root);

    const committed = git(root, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n');
    assert.ok(committed.includes('src.ts'), 'public file should be committed');
    assert.ok(!committed.some((f) => f.startsWith('docs/superpowers/')),
        'private file must not be committed');
});

test('finish aborts when a private path is already staged', () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}\n');
    git(root, ['add', '-f', '.claude/settings.json']);

    assert.throws(() => runFinish(root), (err) => {
        assert.equal(err.status, 2);
        assert.match(String(err.stderr), /private/i);
        return true;
    });
});

function run(root, args) {
    return execFileSync('bash', [HELPERS, ...args], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
    });
}

test('verification-mode defaults to ask and reflects config', () => {
    const root = makeRepo();
    assert.equal(run(root, ['verification-mode']).trim(), 'ask');

    fs.appendFileSync(path.join(root, '.flow', 'config.md'), '- stop_check: never\n');
    assert.equal(run(root, ['verification-mode']).trim(), 'never');
});

test('set-verification-mode persists the choice into config.md', () => {
    const root = makeRepo();
    const out = run(root, ['set-verification-mode', 'always']);
    assert.match(out, /stop_check set to always/);
    const config = fs.readFileSync(path.join(root, '.flow', 'config.md'), 'utf8');
    assert.match(config, /stop_check:\s*always/);
    assert.equal(run(root, ['verification-mode']).trim(), 'always');

    // Re-running with a different value replaces rather than duplicating the line.
    run(root, ['set-verification-mode', 'never']);
    const config2 = fs.readFileSync(path.join(root, '.flow', 'config.md'), 'utf8');
    assert.equal((config2.match(/stop_check\s*:/g) || []).length, 1);
    assert.equal(run(root, ['verification-mode']).trim(), 'never');
});

test('set-verification-mode rejects an unknown value', () => {
    const root = makeRepo();
    assert.throws(() => run(root, ['set-verification-mode', 'bogus']));
});

test('run-verification reports pass when build_cmd/test_cmd succeed', () => {
    const root = makeRepo();
    fs.appendFileSync(path.join(root, '.flow', 'config.md'), '- build_cmd: true\n- test_cmd: true\n');
    assert.equal(run(root, ['run-verification']).trim(), 'verification-passed');
});

test('run-verification reports failure and exits non-zero when build_cmd fails', () => {
    const root = makeRepo();
    fs.appendFileSync(path.join(root, '.flow', 'config.md'), '- build_cmd: false\n- test_cmd: true\n');
    assert.throws(() => run(root, ['run-verification']), (err) => {
        assert.equal(err.status, 1);
        assert.match(String(err.stdout), /verification-failed:build/);
        return true;
    });
});
