'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HELPERS = path.join(__dirname, 'continue-helpers.sh');

/** A temp project root with a .flow dir, no git needed for check-progress. */
function makeRepo(progressBody) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-continue-'));
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', 'config.md'), '# config\n');
    if (progressBody !== undefined) {
        fs.writeFileSync(path.join(root, '.flow', 'session-progress.md'), progressBody);
    }
    return root;
}

function checkProgress(root) {
    return execFileSync('bash', [HELPERS, 'check-progress'], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
    }).trim();
}

test('missing file reports missing', () => {
    assert.strictEqual(checkProgress(makeRepo()), 'missing');
});

test('a single-state file is clean', () => {
    const body = [
        '# Session',
        '',
        '## Goal',
        'Ship the thing.',
        '',
        '## Tasks',
        '- [ ] one open task',
        '',
        'Paused at: 2026-08-12',
        'Verification: passed (build+test)',
        '',
    ].join('\n');
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists');
});

test('a long but non-duplicated file is still clean — size is not the signal', () => {
    const body = '# Session\n\n## Goal\nShip it.\n\nPaused at: 2026-08-12\n'
        + '- [ ] task\n'.repeat(400);
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists');
});

test('two Goal sections are flagged as stale blocks', () => {
    const body = [
        '## Goal',
        'Old goal from three sessions ago.',
        'Paused at: 2026-07-01',
        '',
        '## Goal',
        'The current goal.',
        'Paused at: 2026-08-12',
        '',
    ].join('\n');
    const out = checkProgress(makeRepo(body));
    assert.match(out, /^exists:stale-blocks=\d+$/, `got ${out}`);
    // 2 goals + 2 paused lines.
    assert.strictEqual(out, 'exists:stale-blocks=4');
});

test('a duplicated Paused at alone is enough to flag', () => {
    const body = '## Goal\nOne goal.\n\nPaused at: 2026-07-01\n\nPaused at: 2026-08-12\n';
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists:stale-blocks=3');
});

function staleHandoffs(root) {
    return execFileSync('bash', [HELPERS, 'stale-handoffs'], {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
    }).trim();
}

/** Write a handoff file, backdating it relative to the pause marker if asked. */
function handoff(root, name, { stale }) {
    const dir = path.join(root, '.flow', 'session');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, `# ${name}\n`);
    if (stale) {
        const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        fs.utimesSync(p, old, old);
    }
    return p;
}

/** The pause marker, whose mtime is the session boundary handoffs are judged against. */
function markPause(root) {
    const dir = path.join(root, '.flow', 'state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'last-pause'), 'abc123 main 2026-08-12T00:00:00Z\n');
}

test('a handoff written before the last pause is reported stale', () => {
    const root = makeRepo();
    handoff(root, 'plan.md', { stale: true });
    markPause(root);

    assert.strictEqual(staleHandoffs(root), 'plan.md');
});

test('a handoff written after the last pause is current, not stale', () => {
    const root = makeRepo();
    markPause(root);
    handoff(root, 'plan.md', { stale: false });

    assert.strictEqual(staleHandoffs(root), '');
});

test('the shutdown_request marker is never reported as a stale handoff', () => {
    const root = makeRepo();
    handoff(root, 'shutdown_request', { stale: true });
    markPause(root);

    assert.strictEqual(staleHandoffs(root), '');
});

test('with no pause marker yet, nothing is judged stale', () => {
    const root = makeRepo();
    handoff(root, 'plan.md', { stale: true });

    assert.strictEqual(staleHandoffs(root), '');
});

test('bold Paused at survives the markdown the pause step actually writes', () => {
    const body = '## Goal\nOne goal.\n\n**Paused at:** 2026-07-01\n\n**Paused at:** 2026-08-12\n';
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists:stale-blocks=3');
});
