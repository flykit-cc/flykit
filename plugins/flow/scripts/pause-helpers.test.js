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

test('finish clears the shutdown_request marker so the next session does not inherit it', () => {
    const root = makeRepo();
    const sessionDir = path.join(root, '.flow', 'session');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'shutdown_request'), '1\n');
    fs.writeFileSync(path.join(root, 'src.ts'), 'export const a = 1;\n');

    runFinish(root);

    assert.ok(!fs.existsSync(path.join(sessionDir, 'shutdown_request')),
        'a stale shutdown_request makes next session\'s agents exit before doing any work');
});

test('finish consumes the narration files so a later pause cannot log stale text', () => {
    const root = makeRepo();
    const titleFile = path.join(root, '.flow', 'pause-title');
    const bodyFile = path.join(root, '.flow', 'pause-body');
    fs.writeFileSync(titleFile, 'Session one\n');
    fs.writeFileSync(bodyFile, '- did the first thing\n');

    execFileSync('bash', [HELPERS, 'finish', titleFile, bodyFile, 'chore: one', '--no-push'], {
        encoding: 'utf8', cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe',
    });

    assert.ok(!fs.existsSync(titleFile), 'pause-title must not survive into the next pause');
    assert.ok(!fs.existsSync(bodyFile), 'pause-body must not survive into the next pause');
});

test('a second finish with no fresh narration fails loudly instead of relogging the old block', () => {
    const root = makeRepo();
    const titleFile = path.join(root, '.flow', 'pause-title');
    const bodyFile = path.join(root, '.flow', 'pause-body');
    fs.writeFileSync(titleFile, 'Session one\n');
    fs.writeFileSync(bodyFile, '- did the first thing\n');
    const finish = () => execFileSync('bash', [HELPERS, 'finish', titleFile, bodyFile, 'chore: x', '--no-push'], {
        encoding: 'utf8', cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe',
    });

    finish();
    fs.writeFileSync(path.join(root, 'src.ts'), 'export const a = 1;\n');

    assert.throws(finish, /log-block needs/i);

    const log = fs.readFileSync(path.join(root, '.flow', 'session-log.md'), 'utf8');
    assert.equal(log.match(/Session one/g).length, 1,
        'the same narration must never be logged twice under two different dates');
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
    assert.equal(run(root, ['run-verification']).trim(), 'verification-passed:build+test');
});

test('run-verification never reports a pass when nothing is configured', () => {
    const root = makeRepo();
    fs.appendFileSync(path.join(root, '.flow', 'config.md'), '- build_cmd:\n- test_cmd:\n');

    const out = run(root, ['run-verification']).trim();
    assert.equal(out, 'verification-skipped:nothing-configured');
    assert.ok(!out.includes('passed'),
        'a project with nothing to run must not record a pass — that is how an unverified session ships');
});

test('run-verification names which half ran when only one is configured', () => {
    const buildOnly = makeRepo();
    fs.appendFileSync(path.join(buildOnly, '.flow', 'config.md'), '- build_cmd: true\n- test_cmd:\n');
    assert.equal(run(buildOnly, ['run-verification']).trim(), 'verification-passed:build',
        'a missing test_cmd must stay visible in the record');

    const testOnly = makeRepo();
    fs.appendFileSync(path.join(testOnly, '.flow', 'config.md'), '- build_cmd:\n- test_cmd: true\n');
    assert.equal(run(testOnly, ['run-verification']).trim(), 'verification-passed:test');
});

test('run-verification still fails on a failing test_cmd when build passes', () => {
    const root = makeRepo();
    fs.appendFileSync(path.join(root, '.flow', 'config.md'), '- build_cmd: true\n- test_cmd: false\n');
    assert.throws(() => run(root, ['run-verification']), (err) => {
        assert.equal(err.status, 1);
        assert.match(String(err.stdout), /verification-failed:test/);
        return true;
    });
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
