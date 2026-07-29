'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HELPERS = path.join(__dirname, 'status-helpers.sh');

function git(root, args) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function run(root, sub) {
    return execFileSync('bash', [HELPERS, sub], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
    });
}

/** Parse `key=value` lines into a map; repeated keys collect into an array. */
function parse(out) {
    const map = {};
    for (const line of out.split('\n')) {
        const m = line.match(/^([a-z_]+)=([\s\S]*)$/);
        if (!m) continue;
        const [, k, v] = m;
        if (k in map) map[k] = [].concat(map[k], v);
        else map[k] = v;
    }
    return map;
}

function makeRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-status-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'test']);
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-qm', 'seed']);
    return root;
}

function writeProgress(root, body) {
    fs.writeFileSync(path.join(root, '.flow', 'session-progress.md'), body);
}

test('git-state reports branch, changed count, and last commit', () => {
    const root = makeRepo();
    fs.writeFileSync(path.join(root, 'a.txt'), 'dirty\n');

    const s = parse(run(root, 'git-state'));
    assert.strictEqual(s.branch, 'main');
    assert.strictEqual(s.changed, '1');
    assert.match(s.last, /seed$/);
});

test('git-state reports upstream=none for an untracked branch', () => {
    const root = makeRepo();
    const s = parse(run(root, 'git-state'));
    assert.strictEqual(s.upstream, 'none');
    assert.ok(!('ahead' in s), 'ahead must be omitted when there is no upstream');
});

test('git-state reports ahead/behind against a tracking branch', () => {
    const origin = makeRepo();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-status-clone-'));
    execFileSync('git', ['clone', '-q', origin, root], { stdio: 'pipe' });
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'test']);
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });

    fs.writeFileSync(path.join(root, 'local.txt'), 'x\n');
    git(root, ['add', 'local.txt']);
    git(root, ['commit', '-qm', 'local commit']);

    const s = parse(run(root, 'git-state'));
    assert.strictEqual(s.ahead, '1', 'one unpushed commit');
    assert.strictEqual(s.behind, '0');
});

test('git-state degrades to repo=none outside a git repo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-status-bare-'));
    const s = parse(run(root, 'git-state'));
    assert.strictEqual(s.repo, 'none');
});

test('progress reports missing when there is no session file', () => {
    const root = makeRepo();
    const s = parse(run(root, 'progress'));
    assert.strictEqual(s.progress, 'missing');
});

test('progress extracts goal, paused-at, verification, and open tasks', () => {
    const root = makeRepo();
    writeProgress(root, [
        '# Session: 2026-07-28',
        '',
        '## Goal',
        '',
        'Ship the status command.',
        'Second line is ignored.',
        '',
        'Paused at: 2026-07-28, tree clean.',
        '',
        'Verification: failed (npm test)',
        '',
        '## Tasks',
        '- [x] done thing',
        '- [ ] open thing one',
        '- [ ] open thing two',
        '',
    ].join('\n'));

    const s = parse(run(root, 'progress'));
    assert.strictEqual(s.progress, 'exists');
    assert.strictEqual(s.goal, 'Ship the status command.');
    assert.strictEqual(s.paused_at, '2026-07-28, tree clean.');
    assert.strictEqual(s.verification, 'failed (npm test)');
    assert.strictEqual(s.open_tasks, '2', 'completed tasks must not count');

    const tasks = [].concat(s.task);
    assert.strictEqual(tasks.length, 2);
    assert.ok(tasks.every((t) => !t.includes('done thing')), 'checked items are not open tasks');
});

test('progress caps the task list at five entries', () => {
    const root = makeRepo();
    const many = Array.from({ length: 12 }, (_, i) => `- [ ] task ${i}`);
    writeProgress(root, ['## Tasks', ...many, ''].join('\n'));

    const s = parse(run(root, 'progress'));
    assert.strictEqual(s.open_tasks, '12', 'count reflects all open tasks');
    assert.strictEqual([].concat(s.task).length, 5, 'but only five are listed');
});

test('progress does not read tasks from a later section as the goal', () => {
    const root = makeRepo();
    writeProgress(root, [
        '## Goal',
        '',
        '## Tasks',
        '- [ ] not the goal',
        '',
    ].join('\n'));

    const s = parse(run(root, 'progress'));
    assert.ok(!('goal' in s), 'an empty Goal section yields no goal, not the next heading');
});

test('all emits every section, and is read-only', () => {
    const root = makeRepo();
    writeProgress(root, '## Goal\n\nSomething.\n');
    const before = git(root, ['status', '--porcelain']);
    const head = git(root, ['rev-parse', 'HEAD']);

    const out = run(root, 'all');
    assert.match(out, /^\[git\]$/m);
    assert.match(out, /^\[progress\]$/m);
    assert.match(out, /^\[pr\]$/m);

    assert.strictEqual(git(root, ['status', '--porcelain']), before, 'must not touch the worktree');
    assert.strictEqual(git(root, ['rev-parse', 'HEAD']), head, 'must not commit');
});

test('unknown subcommand exits non-zero', () => {
    const root = makeRepo();
    assert.throws(() => run(root, 'nope'));
});
