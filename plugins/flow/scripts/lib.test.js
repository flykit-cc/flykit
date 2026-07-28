'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, 'lib.sh');

/** Make a temp project root containing .claude/config.md with `body`. */
function makeProject(body) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-lib-'));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), body);
    return root;
}

/** Source lib.sh with CLAUDE_PROJECT_DIR=root and run `snippet`. */
function sh(root, snippet) {
    return execFileSync('bash', ['-c', `set -u; . ${JSON.stringify(LIB)}; ${snippet}`], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    }).trim();
}

/** Run `snippet` for its exit status only. */
function shStatus(root, snippet) {
    try {
        execFileSync('bash', ['-c', `set -u; . ${JSON.stringify(LIB)}; ${snippet}`], {
            encoding: 'utf8',
            env: { ...process.env, CLAUDE_PROJECT_DIR: root },
            stdio: 'pipe',
        });
        return 0;
    } catch (e) {
        return e.status;
    }
}

test('flow_private_globs falls back to a default when unset', () => {
    const root = makeProject('# empty\n');
    const out = sh(root, 'flow_private_globs');
    assert.match(out, /\.claude/);
    assert.match(out, /docs\/superpowers/);
});

test('flow_private_globs reads the configured value', () => {
    const root = makeProject('- private_globs: notes secrets-wip\n');
    assert.equal(sh(root, 'flow_private_globs'), 'notes secrets-wip');
});

test('flow_path_is_private matches a directory and its contents', () => {
    const root = makeProject('# empty\n');
    assert.equal(shStatus(root, `flow_path_is_private "${root}/.claude/config.md"`), 0);
    assert.equal(shStatus(root, `flow_path_is_private "${root}/docs/superpowers/plans/a.md"`), 0);
    assert.equal(shStatus(root, `flow_path_is_private "${root}/src/index.ts"`), 1);
});

test('flow_path_is_private accepts repo-relative paths', () => {
    const root = makeProject('# empty\n');
    assert.equal(shStatus(root, 'flow_path_is_private ".claude/settings.json"'), 0);
    assert.equal(shStatus(root, 'flow_path_is_private "src/index.ts"'), 1);
});

test('flow_path_is_private does not treat a glob as a substring match', () => {
    const root = makeProject('# empty\n');
    assert.equal(shStatus(root, 'flow_path_is_private "my.claudex"'), 1);
});

test('flow_private_regex matches private paths under grep -E', () => {
    const root = makeProject('# empty\n');
    const re = sh(root, 'flow_private_regex');
    const hit = execFileSync('bash', ['-c',
        `printf '%s\\n' 'docs/superpowers/x.md' 'src/a.ts' | grep -cE ${JSON.stringify(re)} || true`],
        { encoding: 'utf8' }).trim();
    assert.equal(hit, '1');
});

test('flow_private_regex matches only whole path segments, not substrings', () => {
    const root = makeProject('# empty\n');
    const re = sh(root, 'flow_private_regex');
    const lines = [
        'docs/superpowers/plan.md',   // MUST match: nested inside the glob
        '.claude/config.md',          // MUST match: glob at path start
        'my.claudex',                 // MUST NOT match: substring of a longer segment
        'src/.claudex/a.ts',          // MUST NOT match: same, mid-path
        'notdocs/superpowers/a.md',   // MUST NOT match: glob is a suffix of a longer segment
    ];
    const matched = execFileSync('bash', ['-c',
        `printf '%s\\n' ${lines.map(l => JSON.stringify(l)).join(' ')} | grep -E ${JSON.stringify(re)} || true`],
        { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assert.deepEqual(matched.sort(), ['.claude/config.md', 'docs/superpowers/plan.md'].sort());
});

// 10. Arming markers (.flow/.allow-destructive, .flow/.allow-expensive) must
// be private by default, so `finish` never stages a committed standing
// bypass into the repo (previously only .flow/local.md was covered).
test('flow_path_is_private covers the whole .flow directory by default', () => {
    const root = makeProject('# empty\n');
    assert.equal(shStatus(root, 'flow_path_is_private ".flow/.allow-destructive"'), 0);
    assert.equal(shStatus(root, 'flow_path_is_private ".flow/.allow-expensive"'), 0);
    assert.equal(shStatus(root, 'flow_path_is_private ".flow/local.md"'), 0);
});

test('flow_stop_check_mode defaults to lint and rejects junk', () => {
    assert.equal(sh(makeProject('# empty\n'), 'flow_stop_check_mode'), 'lint');
    assert.equal(sh(makeProject('- stop_check: nonsense\n'), 'flow_stop_check_mode'), 'lint');
    assert.equal(sh(makeProject('- stop_check: off\n'), 'flow_stop_check_mode'), 'off');
    assert.equal(sh(makeProject('- stop_check: lint+build\n'), 'flow_stop_check_mode'), 'lint+build');
});

test('flow_model_tier falls back per tier and honours config', () => {
    const empty = makeProject('# empty\n');
    assert.equal(sh(empty, 'flow_model_tier default'), 'sonnet');
    assert.equal(sh(empty, 'flow_model_tier critical'), 'opus');
    assert.equal(sh(empty, 'flow_model_tier cheap'), 'haiku');

    const set = makeProject('- model_default: sonnet\n- model_critical: opus\n- model_cheap: haiku\n');
    assert.equal(sh(set, 'flow_model_tier critical'), 'opus');
});

// 9. flow_extract must not return non-zero for a missing key — under
// `set -euo pipefail` (as continue-helpers.sh uses), a non-zero return from
// a bare `VAR="$(flow_extract key)"` aborts the whole script.
test('flow_extract returns 0 (success) when the key is missing', () => {
    const root = makeProject('# empty\n');
    const status = shStatus(root, 'set -euo pipefail; PORT="$(flow_extract dev_port)"; echo "ok:$PORT"');
    assert.equal(status, 0, 'a missing key must not abort a pipefail caller');
});

test('no agent file pins a model in frontmatter', () => {
    const agentsDir = path.join(__dirname, '..', 'agents');
    const offenders = [];
    for (const file of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(agentsDir, file), 'utf8');
        const fm = text.split('---')[1] || '';
        if (/^model:/m.test(fm)) offenders.push(file);
    }
    assert.deepEqual(offenders, [],
        `agents must read model tiers from config, not pin a model: ${offenders.join(', ')}`);
});
