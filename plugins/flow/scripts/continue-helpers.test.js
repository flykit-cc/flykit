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

test('stacked NEXT blocks are flagged even when Goal and Paused at appear once', () => {
    // The shape actually reported from the field: the file kept one Goal and one
    // Paused at, but every session appended its own NEXT block. A resume reads the
    // first one and works from a plan several sessions old.
    const body = [
        '## Goal', 'Ship the thing.', '',
        '### NEXT (session 1)', '- old thing', '',
        '### NEXT (session 2)', '- older thing', '',
        '## Next steps', '- the current thing', '',
        'Paused at: 2026-08-12', '',
    ].join('\n');

    assert.match(checkProgress(makeRepo(body)), /^exists:stale-blocks=\d+$/);
});

test('a single Next steps section is not flagged', () => {
    const body = '## Goal\nShip it.\n\n## Next steps\n- one thing\n\nPaused at: 2026-08-12\n';
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists');
});

test('a duplicated Paused at alone is enough to flag', () => {
    const body = '## Goal\nOne goal.\n\nPaused at: 2026-07-01\n\nPaused at: 2026-08-12\n';
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists:stale-blocks=3');
});

function staleHandoffs(root) {
    return execFileSync('bash', [HELPERS, 'sweep-handoffs'], {
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

/** Files still sitting in .flow/session/ after a sweep. */
function remaining(root) {
    const d = path.join(root, '.flow', 'session');
    return fs.readdirSync(d).filter((f) => f !== 'spent').sort();
}

/** Files the sweep archived, with their content. */
function archived(root) {
    const d = path.join(root, '.flow', 'session', 'spent');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).sort();
}

test('a handoff older than the last pause is swept aside', () => {
    const root = makeRepo();
    handoff(root, 'plan.md', { stale: true });
    markPause(root);

    assert.strictEqual(staleHandoffs(root), 'plan.md');
    assert.deepStrictEqual(remaining(root), []);
    assert.deepStrictEqual(archived(root), ['plan.md']);
});

test('a handoff newer than the last pause is left in place', () => {
    const root = makeRepo();
    markPause(root);
    handoff(root, 'plan.md', { stale: false });

    assert.strictEqual(staleHandoffs(root), '');
    assert.deepStrictEqual(remaining(root), ['plan.md']);
    assert.deepStrictEqual(archived(root), []);
});

test('shutdown_request is a control marker and is never swept', () => {
    const root = makeRepo();
    handoff(root, 'shutdown_request', { stale: true });
    markPause(root);

    assert.strictEqual(staleHandoffs(root), '');
    assert.deepStrictEqual(remaining(root), ['shutdown_request']);
});

test('with no pause marker every handoff is swept — undatable means untrusted', () => {
    // A repo that never completed a pause has no boundary to date handoffs
    // against. Guessing from timestamp gaps works when they are days apart and
    // silently fails when they are hours apart, so do not guess: sweep them all
    // and let the phase regenerate. Nothing is lost, so being wrong is cheap.
    const root = makeRepo();
    handoff(root, 'plan.md', { stale: true });
    handoff(root, 'review.md', { stale: false });

    const out = staleHandoffs(root).split('\n');
    assert.strictEqual(out[0], 'no-pause-marker', 'must say why everything was swept');
    assert.deepStrictEqual(out.slice(1).sort(), ['plan.md', 'review.md']);
    assert.deepStrictEqual(remaining(root), []);
    assert.deepStrictEqual(archived(root), ['plan.md', 'review.md']);
});

test('a swept handoff is recoverable, never deleted', () => {
    const root = makeRepo();
    const p = handoff(root, 'plan.md', { stale: true });
    const body = fs.readFileSync(p, 'utf8');
    markPause(root);

    staleHandoffs(root);

    const moved = path.join(root, '.flow', 'session', 'spent', 'plan.md');
    assert.strictEqual(fs.readFileSync(moved, 'utf8'), body, 'content must survive the sweep');
});

test('no marker and only a shutdown_request sweeps nothing and says nothing', () => {
    const root = makeRepo();
    handoff(root, 'shutdown_request', { stale: true });

    assert.strictEqual(staleHandoffs(root), '');
    assert.deepStrictEqual(archived(root), []);
});

test('an empty session dir reports nothing and creates no archive', () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, '.flow', 'session'), { recursive: true });

    assert.strictEqual(staleHandoffs(root), '');
    assert.strictEqual(fs.existsSync(path.join(root, '.flow', 'session', 'spent')), false);
});

test('bold Paused at survives the markdown the pause step actually writes', () => {
    const body = '## Goal\nOne goal.\n\n**Paused at:** 2026-07-01\n\n**Paused at:** 2026-08-12\n';
    assert.strictEqual(checkProgress(makeRepo(body)), 'exists:stale-blocks=3');
});
