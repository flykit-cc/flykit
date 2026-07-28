'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    copyIfMissing, ensureDir, appendSection, parseArgs, main,
    detectStackCommands, applyStackCommands, applyPmFields, pmPrefix,
} = require('./init');

function mkSandbox() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-test-'));
}

// Existing tests below drive init via `main()` directly (mutating process.argv);
// runInit follows that same convention rather than shelling out to a subprocess.
function runInit(target, extraArgs = []) {
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', target, ...extraArgs];
    try {
        return main();
    } finally {
        process.argv = origArgv;
    }
}

test('parseArgs: default target is cwd', () => {
    const args = parseArgs([]);
    assert.equal(args.target, process.cwd());
});

test('parseArgs: --target honored', () => {
    const args = parseArgs(['--target', '/tmp/foo']);
    assert.equal(args.target, path.resolve('/tmp/foo'));
});

test('parseArgs: -t short flag honored', () => {
    const args = parseArgs(['-t', '/tmp/bar']);
    assert.equal(args.target, path.resolve('/tmp/bar'));
});

test('ensureDir: creates missing dir', () => {
    const sandbox = mkSandbox();
    const dir = path.join(sandbox, 'issues');
    const res = ensureDir(dir);
    assert.equal(res.created, true);
    assert.equal(fs.existsSync(dir), true);
});

test('ensureDir: idempotent — second call does not "create"', () => {
    const sandbox = mkSandbox();
    const dir = path.join(sandbox, 'issues');
    ensureDir(dir);
    const res2 = ensureDir(dir);
    assert.equal(res2.created, false);
});

test('copyIfMissing: copies template when dest is absent', () => {
    const sandbox = mkSandbox();
    const src = path.join(sandbox, 'src.md');
    const dest = path.join(sandbox, 'sub', 'dest.md');
    fs.writeFileSync(src, 'hello');
    const res = copyIfMissing(src, dest);
    assert.equal(res.created, true);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'hello');
});

test('copyIfMissing: never overwrites an existing file', () => {
    const sandbox = mkSandbox();
    const src = path.join(sandbox, 'src.md');
    const dest = path.join(sandbox, 'dest.md');
    fs.writeFileSync(src, 'NEW');
    fs.writeFileSync(dest, 'KEEP');
    const res = copyIfMissing(src, dest);
    assert.equal(res.created, false);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'KEEP');
});

test('copyIfMissing: reports missing source gracefully', () => {
    const sandbox = mkSandbox();
    const src = path.join(sandbox, 'does-not-exist.md');
    const dest = path.join(sandbox, 'dest.md');
    const res = copyIfMissing(src, dest);
    assert.equal(res.created, false);
    assert.equal(res.missingSource, true);
});

test('main: idempotent — running twice produces same files, no overwrite', () => {
    const sandbox = mkSandbox();
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', sandbox];

    try {
        const code1 = main();
        assert.equal(code1, 0);

        // Files we expect to exist regardless of whether templates were present.
        const issuesDir = path.join(sandbox, 'issues');
        assert.equal(fs.existsSync(issuesDir), true, 'issues/ created');

        // config.md still uses copyIfMissing: mutate it and ensure second run leaves it alone.
        const configDest = path.join(sandbox, '.claude', 'config.md');
        if (fs.existsSync(configDest)) {
            fs.writeFileSync(configDest, 'USER EDIT');
        }
        // CLAUDE.md now uses appendSection: an existing file without the flow marker
        // gets the section appended (not skipped), so it is preserved but NOT left
        // byte-for-byte identical — that's the whole point of Task 7.
        const claudeDest = path.join(sandbox, 'CLAUDE.md');
        if (fs.existsSync(claudeDest)) {
            fs.writeFileSync(claudeDest, 'USER EDIT');
        }

        const code2 = main();
        assert.equal(code2, 0);

        if (fs.existsSync(configDest)) {
            assert.equal(fs.readFileSync(configDest, 'utf8'), 'USER EDIT', 'config preserved');
        }
        if (fs.existsSync(claudeDest)) {
            const claudeText = fs.readFileSync(claudeDest, 'utf8');
            assert.match(claudeText, /^USER EDIT/, 'existing CLAUDE.md content preserved at the top');
            assert.match(claudeText, /<!-- flow:begin -->/, 'flow section appended since no marker was present');
        }
    } finally {
        process.argv = origArgv;
    }
});

test('main: --target honored', () => {
    const sandbox = mkSandbox();
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', sandbox];
    try {
        const code = main();
        assert.equal(code, 0);
        assert.equal(fs.existsSync(path.join(sandbox, 'issues')), true);
    } finally {
        process.argv = origArgv;
    }
});

test('main: nonexistent target returns non-zero', () => {
    const origArgv = process.argv;
    process.argv = ['node', 'init.js', '--target', '/tmp/flow-does-not-exist-xyz-' + Date.now()];
    try {
        const code = main();
        assert.notEqual(code, 0);
    } finally {
        process.argv = origArgv;
    }
});

test('init appends the flow section to an existing CLAUDE.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# My project\n\nExisting notes.\n');

    runInit(target);

    const text = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.match(text, /# My project/, 'existing content must be preserved');
    assert.match(text, /<!-- flow:begin -->/, 'flow section must be appended');
});

test('init is idempotent on CLAUDE.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# My project\n');

    runInit(target);
    runInit(target);

    const text = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    const count = (text.match(/<!-- flow:begin -->/g) || []).length;
    assert.equal(count, 1, 'the flow section must appear exactly once');
});

// Direct unit tests for appendSection: these pin down the exact behaviour that
// the end-to-end init tests above only exercise indirectly.

test('appendSection: creates the file (and parent dir) when absent', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'nested', 'CLAUDE.md');
    const result = appendSection(dest, 'flow', 'Some flow conventions.');
    assert.equal(result, 'created');
    const text = fs.readFileSync(dest, 'utf8');
    assert.equal(text, '<!-- flow:begin -->\nSome flow conventions.\n<!-- flow:end -->\n');
});

test('appendSection: appends to an existing file that lacks the marker', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes\n\nKeep this.\n');
    const result = appendSection(dest, 'flow', 'Flow body.');
    assert.equal(result, 'appended');
    const text = fs.readFileSync(dest, 'utf8');
    assert.match(text, /^# Notes\n\nKeep this\.\n/, 'original content stays untouched at the top');
    assert.match(text, /<!-- flow:begin -->\nFlow body\.\n<!-- flow:end -->\n$/, 'block appended at the end');
});

test('appendSection: does not glue the block onto a file missing a trailing newline', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes with no trailing newline');
    appendSection(dest, 'flow', 'Flow body.');
    const text = fs.readFileSync(dest, 'utf8');
    assert.doesNotMatch(text, /newline<!--/, 'block must not be glued onto the last line');
    assert.match(text, /# Notes with no trailing newline\n/);
});

test('appendSection: is a no-op ("present") when the marker already exists, leaving content untouched', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes\n\n<!-- flow:begin -->\nOld body.\n<!-- flow:end -->\n');
    const result = appendSection(dest, 'flow', 'New body that should NOT appear.');
    assert.equal(result, 'present');
    const text = fs.readFileSync(dest, 'utf8');
    assert.equal(text, '# Notes\n\n<!-- flow:begin -->\nOld body.\n<!-- flow:end -->\n', 'file left byte-for-byte untouched');
    assert.doesNotMatch(text, /New body/, 'must not overwrite with new body when marker is already present');
});

// --- Stack-command detection (Task: init auto-detects stack commands) ---

test('pmPrefix: pnpm-lock.yaml selects pnpm', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'pnpm-lock.yaml'), '');
    assert.equal(pmPrefix(sandbox), 'pnpm');
});

test('pmPrefix: yarn.lock selects yarn', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'yarn.lock'), '');
    assert.equal(pmPrefix(sandbox), 'yarn');
});

test('pmPrefix: bun.lockb selects bun', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'bun.lockb'), '');
    assert.equal(pmPrefix(sandbox), 'bun');
});

test('pmPrefix: defaults to "npm run" when no lockfile is present', () => {
    const sandbox = mkSandbox();
    assert.equal(pmPrefix(sandbox), 'npm run');
});

test('detectStackCommands: pnpm project maps lint/test/build/dev scripts by exact key', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({
        scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build', dev: 'vite' },
    }));

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.lint_cmd, 'pnpm lint');
    assert.equal(detected.test_cmd, 'pnpm test');
    assert.equal(detected.build_cmd, 'pnpm build');
    assert.equal(detected.dev_cmd, 'pnpm dev');
    assert.equal(detected.typecheck_cmd, '', 'no typecheck script present, must stay blank');
    assert.equal(detected.format_cmd, '', 'no format script present, must stay blank');
});

test('detectStackCommands: yarn project uses "yarn <script>" with no "run"', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'yarn.lock'), '');
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({
        scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit' },
    }));

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.lint_cmd, 'yarn lint');
    assert.equal(detected.typecheck_cmd, 'yarn typecheck');
});

test('detectStackCommands: npm project (no lockfile) uses "npm run <script>"', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({
        scripts: { format: 'prettier --write .' },
    }));

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.format_cmd, 'npm run format');
});

test('detectStackCommands: type-check (hyphenated) script also maps to typecheck_cmd', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({
        scripts: { 'type-check': 'tsc --noEmit' },
    }));

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.typecheck_cmd, 'npm run type-check');
});

test('detectStackCommands: Go project fills lint/test/build with go tooling', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'go.mod'), 'module example.com/foo\n');

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.lint_cmd, 'go vet ./...');
    assert.equal(detected.test_cmd, 'go test ./...');
    assert.equal(detected.build_cmd, 'go build ./...');
    assert.equal(detected.dev_cmd, '', 'go has no dev-server convention, must stay blank');
});

test('detectStackCommands: Rust project fills lint/test/build with cargo tooling', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'Cargo.toml'), '[package]\nname = "foo"\n');

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.lint_cmd, 'cargo clippy');
    assert.equal(detected.test_cmd, 'cargo test');
    assert.equal(detected.build_cmd, 'cargo build --release');
});

test('detectStackCommands: Python project with ruff.toml and pytest.ini', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'ruff.toml'), 'line-length = 100\n');
    fs.writeFileSync(path.join(sandbox, 'pytest.ini'), '[pytest]\n');

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.lint_cmd, 'ruff check .');
    assert.equal(detected.test_cmd, 'pytest');
});

test('detectStackCommands: Python project with pyproject.toml [tool.ruff]/[tool.pytest]', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\n');

    const detected = detectStackCommands(sandbox);
    assert.equal(detected.lint_cmd, 'ruff check .');
    assert.equal(detected.test_cmd, 'pytest');
});

test('detectStackCommands: nothing detectable — every key present but blank', () => {
    const sandbox = mkSandbox();
    const detected = detectStackCommands(sandbox);
    for (const key of ['dev_cmd', 'lint_cmd', 'typecheck_cmd', 'build_cmd', 'test_cmd', 'format_cmd']) {
        assert.ok(Object.prototype.hasOwnProperty.call(detected, key), `${key} must be present`);
        assert.equal(detected[key], '', `${key} must be blank, not a placeholder`);
    }
});

test('applyStackCommands: fills placeholder lines with detected values, leaves rest blank', () => {
    const template = [
        '- dev_cmd: {COMMAND_TO_START_DEV_SERVER}',
        '- lint_cmd: {COMMAND_TO_LINT}',
        '- typecheck_cmd: {COMMAND_TO_TYPECHECK_OR_BLANK}',
        '- build_cmd: {COMMAND_TO_BUILD_PRODUCTION}',
        '- test_cmd: {COMMAND_TO_RUN_TESTS}',
        '- format_cmd: {COMMAND_TO_FORMAT_CODE}',
    ].join('\n');

    const detected = {
        dev_cmd: 'pnpm dev', lint_cmd: 'pnpm lint', typecheck_cmd: '',
        build_cmd: 'pnpm build', test_cmd: 'pnpm test', format_cmd: '',
    };
    const out = applyStackCommands(template, detected);

    assert.match(out, /^- dev_cmd: pnpm dev$/m);
    assert.match(out, /^- lint_cmd: pnpm lint$/m);
    assert.match(out, /^- typecheck_cmd:$/m, 'blank value leaves no trailing space or placeholder');
    assert.match(out, /^- format_cmd:$/m);
    assert.doesNotMatch(out, /\{/, 'no placeholder braces must survive');
});

test('main: end-to-end — pnpm project gets detected commands written into .claude/config.md, no placeholders', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
        scripts: { lint: 'eslint .', test: 'vitest run' },
    }));

    runInit(target);

    const configText = fs.readFileSync(path.join(target, '.claude', 'config.md'), 'utf8');
    assert.match(configText, /^- lint_cmd: pnpm lint$/m);
    assert.match(configText, /^- test_cmd: pnpm test$/m);
    assert.doesNotMatch(configText, /\{COMMAND_TO/, 'no unfilled placeholders must remain');
});

test('main: end-to-end — project with nothing detectable gets blank keys, no placeholders', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));

    runInit(target);

    const configText = fs.readFileSync(path.join(target, '.claude', 'config.md'), 'utf8');
    assert.match(configText, /^- lint_cmd:$/m);
    assert.match(configText, /^- test_cmd:$/m);
    assert.doesNotMatch(configText, /\{COMMAND_TO/, 'no unfilled placeholders must remain');
});

test('main: end-to-end — re-running init does not touch an already-filled-in config.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const configDest = path.join(target, '.claude', 'config.md');
    fs.writeFileSync(configDest, 'USER EDITED CONFIG');

    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));
    runInit(target);

    assert.equal(fs.readFileSync(configDest, 'utf8'), 'USER EDITED CONFIG', 'existing user config must never be rewritten');
});

// --- CLI flags for workflow_mode / pm_backend (init.md drives init.js) ---

test('applyPmFields: leaves workflow_mode/pm_backend at template default when not supplied', () => {
    const template = [
        '- workflow_mode: solo',
        '- pm_backend: github',
        '- pm_github_owner: {OWNER}',
        '- pm_github_repo: {REPO}',
        '- pm_linear_team: {TEAM_KEY}',
    ].join('\n');

    const out = applyPmFields(template, {});
    assert.match(out, /^- workflow_mode: solo$/m);
    assert.match(out, /^- pm_backend: github$/m);
    assert.match(out, /^- pm_github_owner:$/m, 'blank, not left as {OWNER}');
    assert.match(out, /^- pm_github_repo:$/m);
    assert.match(out, /^- pm_linear_team:$/m);
    assert.doesNotMatch(out, /\{/, 'no placeholder braces must survive');
});

test('applyPmFields: writes supplied values, never a placeholder brace', () => {
    const template = [
        '- workflow_mode: solo',
        '- pm_backend: github',
        '- pm_github_owner: {OWNER}',
        '- pm_github_repo: {REPO}',
        '- pm_linear_team: {TEAM_KEY}',
    ].join('\n');

    const out = applyPmFields(template, {
        workflowMode: 'team',
        pmBackend: 'linear',
        pmGithubOwner: 'flykit-cc',
        pmGithubRepo: 'flykit',
        pmLinearTeam: 'ENG',
    });
    assert.match(out, /^- workflow_mode: team$/m);
    assert.match(out, /^- pm_backend: linear$/m);
    assert.match(out, /^- pm_github_owner: flykit-cc$/m);
    assert.match(out, /^- pm_github_repo: flykit$/m);
    assert.match(out, /^- pm_linear_team: ENG$/m);
});

test('main: --workflow-mode and --pm-backend land in a freshly-written config.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target, ['--workflow-mode', 'team', '--pm-backend', 'local']);

    const configText = fs.readFileSync(path.join(target, '.claude', 'config.md'), 'utf8');
    assert.match(configText, /^- workflow_mode: team$/m);
    assert.match(configText, /^- pm_backend: local$/m);
});

test('main: --pm-github-owner/--pm-github-repo/--pm-linear-team land in config.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target, [
        '--pm-backend', 'github',
        '--pm-github-owner', 'flykit-cc',
        '--pm-github-repo', 'flykit',
    ]);

    const configText = fs.readFileSync(path.join(target, '.claude', 'config.md'), 'utf8');
    assert.match(configText, /^- pm_github_owner: flykit-cc$/m);
    assert.match(configText, /^- pm_github_repo: flykit$/m);
});

test('main: omitted PM flags produce no {PLACEHOLDER} text', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const configText = fs.readFileSync(path.join(target, '.claude', 'config.md'), 'utf8');
    assert.doesNotMatch(configText, /\{OWNER\}|\{REPO\}|\{TEAM_KEY\}/, 'no unfilled PM placeholders must remain');
});

test('main: invalid --workflow-mode exits non-zero and writes nothing', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    const code = runInit(target, ['--workflow-mode', 'bogus']);
    assert.notEqual(code, 0);
    assert.equal(fs.existsSync(path.join(target, '.claude', 'config.md')), false, 'nothing should be written on validation failure');
});

test('main: invalid --pm-backend exits non-zero and writes nothing', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    const code = runInit(target, ['--pm-backend', 'jira']);
    assert.notEqual(code, 0);
    assert.equal(fs.existsSync(path.join(target, '.claude', 'config.md')), false, 'nothing should be written on validation failure');
});

test('main: re-running with new PM flags never touches an already-filled-in config.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const configDest = path.join(target, '.claude', 'config.md');
    fs.writeFileSync(configDest, 'USER EDITED CONFIG');

    runInit(target, ['--workflow-mode', 'team', '--pm-backend', 'linear', '--pm-linear-team', 'ENG']);

    assert.equal(fs.readFileSync(configDest, 'utf8'), 'USER EDITED CONFIG', 'existing user config must never be rewritten by PM flags either');
});
