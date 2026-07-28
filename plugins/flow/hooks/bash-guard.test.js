'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'bash-guard.sh');

function makeProject(configBody) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-guard-'));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'config.md'), configBody);
    return root;
}

/** Returns {status, stderr}. status 2 = blocked, 0 = allowed. */
function runGuard(root, command) {
    try {
        execFileSync('bash', [HOOK], {
            encoding: 'utf8',
            input: JSON.stringify({ tool_input: { command } }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: root },
            stdio: 'pipe',
        });
        return { status: 0, stderr: '' };
    } catch (e) {
        return { status: e.status, stderr: String(e.stderr) };
    }
}

test('blocks a default expensive command', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'fly deploy --app prod');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fly deploy/);
});

test('allows an ordinary command', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'npm run dev').status, 0);
});

test('honours a project-configured list', () => {
    const root = makeProject('- expensive_cmds: pnpm turbo build\n');
    assert.equal(runGuard(root, 'pnpm turbo build --filter=web').status, 2);
    assert.equal(runGuard(root, 'fly deploy').status, 0, 'config replaces the default list');
});

test('the arming marker allows once, then is consumed', () => {
    const root = makeProject('# empty\n');
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', '.allow-expensive'), '');

    assert.equal(runGuard(root, 'fly deploy').status, 0, 'armed run is allowed');
    assert.equal(fs.existsSync(path.join(root, '.flow', '.allow-expensive')), false,
        'marker must be consumed');
    assert.equal(runGuard(root, 'fly deploy').status, 2, 'next run is blocked again');
});

test('blocks the same command with extra internal whitespace', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'fly   deploy   --app prod');
    assert.equal(r.status, 2, 'runs of whitespace must not defeat the match');
});

test('blocks the same command wrapped in quotes', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, '"fly" deploy --app prod');
    assert.equal(r.status, 2, 'quoting a token must not defeat the match');
});

test('does not treat a hyphenated token as the two-word pattern it resembles', () => {
    const root = makeProject('# empty\n');
    // "docker-push" contains the words "docker" and "push" but is a single
    // hyphenated npm-script name, not the spaced phrase "docker push" that
    // the default list guards. If normalize() ever grew a bug that treated
    // punctuation like "-" as whitespace (a plausible broadening when
    // "sanitizing" a command string), this would wrongly collapse to
    // "docker push" and block an unrelated script. Confirmed by injecting
    // exactly that bug locally: it flips this case to blocked.
    assert.equal(runGuard(root, 'npm run docker-push').status, 0);
});

test('documents the accepted trade-off: quoting the pattern still blocks', () => {
    const root = makeProject('# empty\n');
    // Not a real invocation — just a string containing the phrase — but
    // quote-stripping makes "fly deploy" a contiguous substring after
    // normalisation. This is intentional (see fix-round-1 report): a false
    // positive here costs one arming-marker touch, a false negative costs
    // real external spend, so we accept over-matching quoted text.
    assert.equal(runGuard(root, 'echo "fly deploy"').status, 2);
});

test('does not join adjacent lines into a false-positive match', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'echo fly\ndeploy something');
    assert.equal(r.status, 0, 'neither line alone is a deploy invocation');
});

test('does not join two unrelated single-word lines into a match', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'fly\ndeploy');
    assert.equal(r.status, 0, 'these are two separate commands, not "fly deploy"');
});

test('still blocks when a later line genuinely contains the pattern', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'cd app\nfly deploy');
    assert.equal(r.status, 2, 'line 2 really is a deploy invocation');
});

test('blocks blanket staging', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git add -A').status, 2);
    assert.equal(runGuard(root, 'git add .').status, 2);
    assert.equal(runGuard(root, 'git add -u').status, 2);
    assert.equal(runGuard(root, 'git commit -am "wip"').status, 2);
});

test('allows staging a named path', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git add src/index.ts').status, 0);
    assert.equal(runGuard(root, 'git add -- src/a.ts src/b.ts').status, 0);
});

test('blocks destructive commands', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git reset --hard HEAD~1').status, 2);
    assert.equal(runGuard(root, 'git checkout -- src/a.ts').status, 2);
    assert.equal(runGuard(root, 'git restore src/a.ts').status, 2);
    assert.equal(runGuard(root, 'rm -rf build').status, 2);
});

test('allows ordinary git and rm', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git status').status, 0);
    assert.equal(runGuard(root, 'git reset --soft HEAD~1').status, 0);
    assert.equal(runGuard(root, 'rm build/tmp.txt').status, 0);
});

test('the destructive marker allows once, then is consumed', () => {
    const root = makeProject('# empty\n');
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', '.allow-destructive'), '');

    assert.equal(runGuard(root, 'git add -A').status, 0);
    assert.equal(fs.existsSync(path.join(root, '.flow', '.allow-destructive')), false);
    assert.equal(runGuard(root, 'git add -A').status, 2);
});

test('blocks a quoted form that only matches after normalization', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git "add" -A').status, 2);
});

test('blocks a destructive command on a later line after normalization', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'echo hi\ngit add -A').status, 2);
});

test('fails open when jq is unavailable', () => {
    const root = makeProject('# empty\n');
    // A PATH of '/nonexistent' would also hide bash itself, so execFileSync
    // would fail with ENOENT (no exit status) rather than exercising the hook.
    // Build a PATH that has the shell utilities but no jq.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-nojq-'));
    for (const tool of ['bash', 'grep', 'sed', 'cat', 'rm', 'printf', 'git', 'basename', 'dirname']) {
        const real = execFileSync('bash', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).trim();
        if (real) fs.symlinkSync(real, path.join(binDir, tool));
    }

    let status = 0;
    try {
        execFileSync(path.join(binDir, 'bash'), [HOOK], {
            encoding: 'utf8',
            input: JSON.stringify({ tool_input: { command: 'fly deploy' } }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: binDir },
            stdio: 'pipe',
        });
    } catch (e) { status = e.status; }
    assert.equal(status, 0, 'must fail open, not block, when jq is missing');
});
