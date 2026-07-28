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

// -- fix-round-1: separated rm flags, `git checkout .`/`<ref> -- <path>`, and
// the `git restore --staged` false positive.

test('blocks rm with recursive and force flags given separately', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'rm -r -f build').status, 2);
    assert.equal(runGuard(root, 'rm -f -r build').status, 2);
    assert.equal(runGuard(root, 'rm build -r -f').status, 2);
});

test('blocks git checkout of the whole tree', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git checkout .').status, 2);
});

test('blocks git checkout <ref> -- <path>', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git checkout main -- src/a.ts').status, 2);
});

test('allows ordinary branch switching', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git checkout feature-x').status, 0);
    assert.equal(runGuard(root, 'git checkout -b new-branch').status, 0);
});

test('allows git restore --staged (unstage only, worktree untouched)', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git restore --staged src/a.ts').status, 0);
});

test('blocks git restore --staged --worktree (touches the tree too)', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git restore --staged --worktree src/a.ts').status, 2);
});

test('blocks git restore --worktree', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git restore --worktree src/a.ts').status, 2);
});

// -- fix-round-2: `git reset --hard` must be scoped per statement like
// rm/restore, not matched with a bare `.*` that can reach across `;`.

test('does not block --hard text in an unrelated later statement', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git reset --soft HEAD; echo --hard').status, 0);
});

test('blocks genuine git reset --hard forms', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git reset --hard').status, 2);
    assert.equal(runGuard(root, 'git reset --hard HEAD~1').status, 2);
    assert.equal(runGuard(root, 'git reset HEAD~1 --hard').status, 2);
});

test('allows non-hard reset forms', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git reset --soft HEAD~1').status, 0);
    assert.equal(runGuard(root, 'git reset --mixed').status, 0);
    assert.equal(runGuard(root, 'git reset').status, 0);
});

test('allows --hard mentioned inside a commit message', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git commit -m "use --hard carefully"').status, 0);
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

// -- final-review fixes: each item below reproduces a bypass found on the
// branch's final review, against an empty config (no arming markers).

// 1. `.allow-expensive` must not waive rule set 2 (irreversible actions).
test('allow-expensive does not waive the destructive-action gate', () => {
    const root = makeProject('# empty\n');
    fs.mkdirSync(path.join(root, '.flow'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', '.allow-expensive'), '');

    const r = runGuard(root, 'fly deploy && git add -A && rm -rf node_modules');
    assert.equal(r.status, 2, 'the destructive part must still be blocked');
    assert.equal(fs.existsSync(path.join(root, '.flow', '.allow-expensive')), false,
        'the expensive marker is still consumed by the expensive match');
});

// 2. Git global options between `git` and the subcommand (this plugin's own
// `git -C` house style) must not break the rule.
test('blocks git add -A / reset --hard / checkout -f through a -C global option', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git -C . add -A').status, 2);
    assert.equal(runGuard(root, 'git -C . reset --hard').status, 2);
    assert.equal(runGuard(root, 'git -C . checkout -f main').status, 2);
    assert.equal(runGuard(root, 'git -C . restore src/a.ts').status, 2);
    assert.equal(runGuard(root, 'git -C . commit -a -m wip').status, 2);
});

// 2. `add`/`commit` must be scoped per-statement like rm/restore/reset, not
// matched against the whole command with a trailing boundary that omits ;&|.
test('blocks git add -A / git commit -a followed by another statement', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git add -A; npm test').status, 2);
    assert.equal(runGuard(root, 'git add .&&npm test').status, 2);
    assert.equal(runGuard(root, 'git commit -am "wip"; npm test').status, 2);
});

// 3. Backslash line continuation must not split a statement in two.
test('blocks rm -rf split across a backslash line continuation', () => {
    const root = makeProject('# empty\n');
    const r = runGuard(root, 'rm -r \\\n-f build');
    assert.equal(r.status, 2, 'a line-continued rm -r -f must still be caught as one statement');
});

// 4. Long options and path-qualified rm.
test('blocks rm --recursive --force and long-option variants', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'rm --recursive --force build').status, 2);
    assert.equal(runGuard(root, 'rm --recursive -f build').status, 2);
    assert.equal(runGuard(root, 'rm -r --force build').status, 2);
});

test('blocks a path-qualified rm invocation', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, '/bin/rm -rf build').status, 2);
});

test('rm long-option fix does not regress allowed rm forms', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'rm file.txt').status, 0);
    assert.equal(runGuard(root, 'rm -i old.txt').status, 0);
});

// 5. `git checkout -f` / `--force` and `git switch --discard-changes`.
test('blocks git checkout -f / --force and git switch --discard-changes', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git checkout -f main').status, 2);
    assert.equal(runGuard(root, 'git checkout --force -- .').status, 2);
    assert.equal(runGuard(root, 'git switch --discard-changes').status, 2);
});

// 6. `git add`/`git commit` blanket flags must be cluster-matched and scanned
// across all args, not only the first token.
test('blocks git add long-option and clustered-flag forms in any position', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git add --update').status, 2);
    assert.equal(runGuard(root, 'git add -Av').status, 2);
    assert.equal(runGuard(root, 'git add -uv').status, 2);
    assert.equal(runGuard(root, 'git add -v -A').status, 2);
});

test('blocks git commit -m msg -a (blanket flag not in first position)', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git commit -m msg -a').status, 2);
});

// 7. `git clean -fd` / `-fdx` sweeps up untracked (and ignored) files.
test('blocks git clean with a force flag, allows dry-run/interactive', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git clean -fd').status, 2);
    assert.equal(runGuard(root, 'git clean -fdx').status, 2);
    assert.equal(runGuard(root, 'git clean -n').status, 0);
    assert.equal(runGuard(root, 'git clean -i').status, 0);
});

// Re-verification: nothing that currently works should regress.
test('re-verification: existing allow/block behavior is unchanged', () => {
    const root = makeProject('# empty\n');
    assert.equal(runGuard(root, 'git add -A').status, 2);
    assert.equal(runGuard(root, 'git add .').status, 2);
    assert.equal(runGuard(root, 'git add .gitignore').status, 0);
    assert.equal(runGuard(root, 'git add -- a.ts').status, 0);
    assert.equal(runGuard(root, 'git reset --hard').status, 2);
    assert.equal(runGuard(root, 'git reset --soft').status, 0);
    assert.equal(runGuard(root, 'git reset --soft HEAD; echo --hard').status, 0);
    assert.equal(runGuard(root, 'rm -rf x').status, 2);
    assert.equal(runGuard(root, 'rm build/tmp.txt').status, 0);
    assert.equal(runGuard(root, 'git restore --staged a.ts').status, 0);
    assert.equal(runGuard(root, 'git restore a.ts').status, 2);
    assert.equal(runGuard(root, 'git checkout main').status, 0);
    assert.equal(runGuard(root, 'git checkout -b x').status, 0);
    assert.equal(runGuard(root, 'fly deploy').status, 2);
    assert.equal(runGuard(root, 'npm run dev').status, 0);
    assert.equal(runGuard(root, 'npm run docker-push').status, 0);
});
