const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'questions-hook.sh');

function runIn(dir, mode) {
    const r = spawnSync('bash', [SCRIPT, mode], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    return { out: r.stdout, code: r.status };
}

function projectWith(questionsContent) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qhk-'));
    fs.mkdirSync(path.join(dir, '.flow'));
    if (questionsContent !== null) {
        fs.writeFileSync(path.join(dir, '.flow', 'questions.md'), questionsContent);
    }
    return dir;
}

const ONE_OPEN = '## Q1\nstatus: open\nasks: which cache?\n';

test('session-start: emits rules even with no questions file', () => {
    const r = runIn(projectWith(null), 'session-start');
    assert.equal(r.code, 0);
    assert.match(r.out, /\[flow question queue\]/);
    assert.match(r.out, /question-protocol\.md/);
    assert.match(r.out, /Questions raised/);
});

test('session-start: includes live state when file exists', () => {
    const r = runIn(projectWith(ONE_OPEN), 'session-start');
    assert.match(r.out, /questions: 1 open · 0 backlog/);
});

test('prompt: silent when file absent', () => {
    const r = runIn(projectWith(null), 'prompt');
    assert.equal(r.out.trim(), '');
    assert.equal(r.code, 0);
});

test('prompt: one-liner when file exists, no systemMessage JSON', () => {
    const r = runIn(projectWith(ONE_OPEN), 'prompt');
    assert.match(r.out, /questions: 1 open · 0 backlog — new questions are filed in \.flow\/questions\.md first/);
    assert.ok(!r.out.includes('systemMessage'));
});

test('prompt: passes through the loud UNPARSEABLE line', () => {
    const r = runIn(projectWith('garbage line\n'), 'prompt');
    assert.match(r.out, /UNPARSEABLE — queue unreliable/);
    assert.equal(r.code, 0);
});

test('unknown mode exits 0 silently (never block a prompt)', () => {
    const r = runIn(projectWith(null), 'bogus');
    assert.equal(r.code, 0);
});
