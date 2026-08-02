// plugins/flow/scripts/questions-helpers.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'questions-helpers.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-'));
const write = (name, content) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
};
const run = (...args) => {
    const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });
    return { out: r.stdout.trim(), code: r.status };
};

const VALID = `## Q1
status: open
issue: #12
asks: cache per-user or global?
context: the settings loader is stuck on this.
  A per-user cache doubles memory.

## Q2
status: backlog
issue: -
asks: rename the config key?

## Q3
status: answered
asks: which region?
answer: eu-central-1
applied: abc1234

## Q4
status: answered
asks: keep the old endpoint?
answer: no, drop it
applied:

## Q5
status: assumed
asks: log format?
answer: json, single line
applied: -
`;

test('validate: valid file with blanks + indented continuation', () => {
    const r = run('validate', write('valid.md', VALID));
    assert.equal(r.out, 'ok');
    assert.equal(r.code, 0);
});

test('validate: missing file says absent, exit 0', () => {
    const r = run('validate', path.join(tmp, 'nope.md'));
    assert.equal(r.out, 'absent');
    assert.equal(r.code, 0);
});

test('validate: unindented stray line is UNPARSEABLE with line number', () => {
    const r = run('validate', write('stray.md', '## Q1\nstatus: open\nasks: x?\noops free text\n'));
    assert.match(r.out, /^UNPARSEABLE: line 4:/);
    assert.equal(r.code, 1);
});

test('validate: bad status value is UNPARSEABLE', () => {
    const r = run('validate', write('badstatus.md', '## Q1\nstatus: opened\nasks: x?\n'));
    assert.match(r.out, /UNPARSEABLE: line 2/);
    assert.equal(r.code, 1);
});

test('validate: UNPARSEABLE output is exactly one line, no trailing "ok"', () => {
    const r = run('validate', write('strayexact.md', '## Q1\nstatus: open\nasks: x?\noops free text\n'));
    assert.equal(r.out, 'UNPARSEABLE: line 4: unexpected unindented line');
});

test('counts: invalid file prints only the UNPARSEABLE line, exit 1', () => {
    const r = run('counts', write('badcounts.md', 'garbage at column zero\n'));
    assert.equal(r.out, 'UNPARSEABLE: line 1: unexpected unindented line');
    assert.equal(r.code, 1);
});

test('counts: full breakdown incl. pending_apply (empty applied, not dash)', () => {
    const r = run('counts', write('valid2.md', VALID));
    assert.equal(r.out, 'open=1 backlog=1 answered=2 assumed=1 retired=0 pending_apply=1');
});

test('state-line: shows open/backlog and flags pending apply', () => {
    const r = run('state-line', write('valid3.md', VALID));
    assert.equal(r.out, 'questions: 1 open · 1 backlog · 1 answered-not-applied');
});

test('state-line: absent file emits nothing', () => {
    const r = run('state-line', path.join(tmp, 'nope2.md'));
    assert.equal(r.out, '');
    assert.equal(r.code, 0);
});

test('state-line: invalid file emits the loud line, exit 0', () => {
    const r = run('state-line', write('bad.md', 'garbage at column zero\n'));
    assert.equal(r.out, 'questions.md UNPARSEABLE — queue unreliable, fix .flow/questions.md');
    assert.equal(r.code, 0);
});

test('top-open: prints exactly the first open block', () => {
    const r = run('top-open', write('valid4.md', VALID));
    assert.match(r.out, /^## Q1\n/);
    assert.match(r.out, /cache per-user or global\?/);
    assert.ok(!r.out.includes('## Q2'));
});

test('wip-limit: reads config value, defaults to 3', () => {
    assert.equal(run('wip-limit', write('cfg.md', '- question_wip: 5\n')).out, '5');
    assert.equal(run('wip-limit', write('cfg2.md', '- question_wip:\n')).out, '3');
    assert.equal(run('wip-limit', path.join(tmp, 'nocfg.md')).out, '3');
});
