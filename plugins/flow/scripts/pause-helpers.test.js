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
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), '# config\n');
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
