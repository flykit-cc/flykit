'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    copyIfMissing, ensureDir, appendSection, parseArgs, main, doneMessage,
    detectStackCommands, applyStackCommands, applyPmFields, pmPrefix,
    detectProjectName, detectLanguageRuntime, detectFramework, renderClaudeMdTemplate,
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

// main() reports through process.stdout; the assertions about *what it tells whom*
// need that text, so swap the sink for the duration of the (synchronous) call.
function captureStdout(fn) {
    const original = process.stdout.write;
    let captured = '';
    process.stdout.write = (chunk) => {
        captured += chunk;
        return true;
    };
    try {
        fn();
    } finally {
        process.stdout.write = original;
    }
    return captured;
}

function runInitCapturing(target, extraArgs = []) {
    let code;
    const output = captureStdout(() => {
        code = runInit(target, extraArgs);
    });
    return { code, output };
}

function blankDetection(overrides = {}) {
    const detected = {
        dev_cmd: '', lint_cmd: '', typecheck_cmd: '',
        build_cmd: '', test_cmd: '', format_cmd: '',
    };
    return Object.assign(detected, overrides);
}

test('parseArgs: target defaults to cwd and both flag spellings resolve to absolute', () => {
    assert.equal(parseArgs([]).target, process.cwd());
    assert.equal(parseArgs(['--target', '/tmp/foo']).target, path.resolve('/tmp/foo'));
    assert.equal(parseArgs(['-t', '/tmp/bar']).target, path.resolve('/tmp/bar'));
});

test('ensureDir: creates the dir once, then reports it already existed', () => {
    const dir = path.join(mkSandbox(), 'issues');
    assert.equal(ensureDir(dir).created, true);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(ensureDir(dir).created, false, 're-running init must not re-report a create');
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

        // issues/ belongs to the `local` backend only; the default is github,
        // so an unflagged init must not create it.
        const issuesDir = path.join(sandbox, 'issues');
        assert.equal(fs.existsSync(issuesDir), false, 'issues/ not created for the default github backend');

        // config.md still uses copyIfMissing: mutate it and ensure second run leaves it alone.
        const configDest = path.join(sandbox, '.flow', 'config.md');
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
            assert.equal(fs.readFileSync(claudeDest, 'utf8'), 'USER EDIT',
                'an existing CLAUDE.md is left byte-for-byte alone, marker or not');
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
        assert.equal(fs.existsSync(path.join(sandbox, '.flow', 'config.md')), true,
            'config lands under the target, not the cwd');
    } finally {
        process.argv = origArgv;
    }
});

test('main: issues/ is created for the local backend and only that one', () => {
    const local = mkSandbox();
    runInit(local, ['--pm-backend', 'local']);
    assert.equal(fs.existsSync(path.join(local, 'issues')), true,
        'the local backend stores issues as files and needs the directory');

    for (const backend of ['github', 'linear']) {
        const sandbox = mkSandbox();
        runInit(sandbox, ['--pm-backend', backend]);
        assert.equal(fs.existsSync(path.join(sandbox, 'issues')), false,
            `${backend} tracks issues remotely — issues/ would be dead weight`);
    }
});

test('generated config.md carries no template-only scaffolding', () => {
    const sandbox = mkSandbox();
    runInit(sandbox);
    const text = fs.readFileSync(path.join(sandbox, '.flow', 'config.md'), 'utf8');

    assert.ok(!text.includes('template-only'), 'the markers themselves must be gone');
    assert.ok(!/^# .*template/im.test(text), 'the generated file is not "a template"');
    assert.ok(!text.includes('e.g. dev_cmd'), 'illustrative examples must not sit under real values');
    assert.match(text, /^- workflow_mode:/m, 'the actual settings survive');
});

test('stripTemplateOnly removes marked regions and leaves the rest', () => {
    const { stripTemplateOnly } = require('./init');
    const input = 'keep me\n<!-- template-only:begin -->\ndrop me\n<!-- template-only:end -->\nkeep me too\n';
    const out = stripTemplateOnly(input);
    assert.ok(!out.includes('drop me'));
    assert.match(out, /keep me/);
    assert.match(out, /keep me too/);
});

test('readPmBackend reads the project choice from config.md, defaulting to github', () => {
    const { readPmBackend } = require('./init');
    const sandbox = mkSandbox();
    const cfg = path.join(sandbox, 'config.md');

    assert.equal(readPmBackend(cfg), 'github', 'a missing config falls back to the template default');
    fs.writeFileSync(cfg, '- pm_backend: local\n');
    assert.equal(readPmBackend(cfg), 'local');
    fs.writeFileSync(cfg, '- pm_backend: nonsense\n');
    assert.equal(readPmBackend(cfg), 'github', 'an invalid value must not be trusted');
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

test('init leaves an existing CLAUDE.md byte-for-byte untouched', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    const original = '# My project\n\nExisting notes that describe this repo accurately.\n';
    fs.writeFileSync(path.join(target, 'CLAUDE.md'), original);

    runInit(target);

    const text = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.equal(text, original,
        'a project that already documents itself must not receive a generic template that contradicts it');
});

test('init creates CLAUDE.md from the template only when none exists', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const dest = path.join(target, 'CLAUDE.md');
    assert.equal(fs.existsSync(dest), true, 'an absent CLAUDE.md is worth seeding');
    const text = fs.readFileSync(dest, 'utf8');
    assert.match(text, /<!-- flow:begin -->/);

    // Second run must not duplicate it — now covered by the "already exists" path.
    runInit(target);
    const count = (fs.readFileSync(dest, 'utf8').match(/<!-- flow:begin -->/g) || []).length;
    assert.equal(count, 1, 'the flow section must appear exactly once');
});

// Direct unit tests for appendSection: these pin down the exact behaviour that
// the end-to-end init tests above only exercise indirectly.

test('appendSection: creates the file (and parent dir) when absent', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'nested', 'CLAUDE.md');
    const result = appendSection(dest, 'flow', 'Some flow conventions.');
    assert.equal(result.status, 'created');
    const text = fs.readFileSync(dest, 'utf8');
    assert.equal(text, '<!-- flow:begin -->\nSome flow conventions.\n<!-- flow:end -->\n');
});

test('appendSection: appends to an existing file that lacks the marker', () => {
    const sandbox = mkSandbox();
    const dest = path.join(sandbox, 'CLAUDE.md');
    fs.writeFileSync(dest, '# Notes\n\nKeep this.\n');
    const result = appendSection(dest, 'flow', 'Flow body.');
    assert.equal(result.status, 'appended');
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
    assert.equal(result.status, 'present');
    const text = fs.readFileSync(dest, 'utf8');
    assert.equal(text, '# Notes\n\n<!-- flow:begin -->\nOld body.\n<!-- flow:end -->\n', 'file left byte-for-byte untouched');
    assert.doesNotMatch(text, /New body/, 'must not overwrite with new body when marker is already present');
});

// --- Stack-command detection (Task: init auto-detects stack commands) ---

test('pmPrefix: each lockfile selects its package manager', () => {
    // bun.lock is Bun 1.2+'s default (text); bun.lockb is the legacy binary one.
    // Both are still in the wild, so both must map to bun.
    const cases = [
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
        ['bun.lock', 'bun'],
        ['bun.lockb', 'bun'],
        [null, 'npm run'],
    ];
    for (const [lockfile, expected] of cases) {
        const sandbox = mkSandbox();
        if (lockfile) fs.writeFileSync(path.join(sandbox, lockfile), '');
        assert.equal(pmPrefix(sandbox), expected, `${lockfile || 'no lockfile'} should select ${expected}`);
    }
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

test('main: end-to-end — pnpm project gets detected commands written into .flow/config.md, no placeholders', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
        scripts: { lint: 'eslint .', test: 'vitest run' },
    }));

    runInit(target);

    const configText = fs.readFileSync(path.join(target, '.flow', 'config.md'), 'utf8');
    assert.match(configText, /^- lint_cmd: pnpm lint$/m);
    assert.match(configText, /^- test_cmd: pnpm test$/m);
    assert.doesNotMatch(configText, /\{COMMAND_TO/, 'no unfilled placeholders must remain');
});

test('main: end-to-end — project with nothing detectable gets blank keys, no placeholders', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));

    runInit(target);

    const configText = fs.readFileSync(path.join(target, '.flow', 'config.md'), 'utf8');
    assert.match(configText, /^- lint_cmd:$/m);
    assert.match(configText, /^- test_cmd:$/m);
    assert.doesNotMatch(configText, /\{COMMAND_TO/, 'no unfilled placeholders must remain');
});

test('main: end-to-end — re-running init does not touch an already-filled-in config.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const configDest = path.join(target, '.flow', 'config.md');
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

    const configText = fs.readFileSync(path.join(target, '.flow', 'config.md'), 'utf8');
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

    const configText = fs.readFileSync(path.join(target, '.flow', 'config.md'), 'utf8');
    assert.match(configText, /^- pm_github_owner: flykit-cc$/m);
    assert.match(configText, /^- pm_github_repo: flykit$/m);
});

test('main: omitted PM flags produce no {PLACEHOLDER} text', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const configText = fs.readFileSync(path.join(target, '.flow', 'config.md'), 'utf8');
    assert.doesNotMatch(configText, /\{OWNER\}|\{REPO\}|\{TEAM_KEY\}/, 'no unfilled PM placeholders must remain');
});

test('main: invalid --workflow-mode exits non-zero and writes nothing', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    const code = runInit(target, ['--workflow-mode', 'bogus']);
    assert.notEqual(code, 0);
    assert.equal(fs.existsSync(path.join(target, '.flow', 'config.md')), false, 'nothing should be written on validation failure');
});

test('main: invalid --pm-backend exits non-zero and writes nothing', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    const code = runInit(target, ['--pm-backend', 'jira']);
    assert.notEqual(code, 0);
    assert.equal(fs.existsSync(path.join(target, '.flow', 'config.md')), false, 'nothing should be written on validation failure');
});

// --- CLAUDE.md template substitution (regression: /flow:init used to leave raw {PLACEHOLDERS}) ---

test('detectProjectName: reads name from package.json when present', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'my-cool-app' }));
    assert.equal(detectProjectName(sandbox), 'my-cool-app');
});

test('detectProjectName: falls back to directory basename when no package.json', () => {
    const sandbox = mkSandbox();
    assert.equal(detectProjectName(sandbox), path.basename(sandbox));
});

test('detectProjectName: --project-name override wins over package.json', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'my-cool-app' }));
    assert.equal(detectProjectName(sandbox, 'custom-name'), 'custom-name');
});

test('detectLanguageRuntime: package.json + tsconfig.json = TypeScript on Node.js', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), '{}');
    fs.writeFileSync(path.join(sandbox, 'tsconfig.json'), '{}');
    const { language, runtime } = detectLanguageRuntime(sandbox);
    assert.equal(language, 'TypeScript');
    assert.equal(runtime, 'Node.js');
});

test('detectLanguageRuntime: package.json alone = JavaScript on Node.js', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), '{}');
    const { language, runtime } = detectLanguageRuntime(sandbox);
    assert.equal(language, 'JavaScript');
    assert.equal(runtime, 'Node.js');
});

test('detectLanguageRuntime: go.mod = Go', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'go.mod'), 'module example.com/foo\n');
    const { language, runtime } = detectLanguageRuntime(sandbox);
    assert.equal(language, 'Go');
    assert.equal(runtime, 'Go');
});

test('detectLanguageRuntime: Cargo.toml = Rust', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'Cargo.toml'), '[package]\nname = "foo"\n');
    const { language, runtime } = detectLanguageRuntime(sandbox);
    assert.equal(language, 'Rust');
    assert.equal(runtime, 'Rust');
});

test('detectLanguageRuntime: pyproject.toml = Python', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'pyproject.toml'), '[project]\nname = "foo"\n');
    const { language, runtime } = detectLanguageRuntime(sandbox);
    assert.equal(language, 'Python');
    assert.equal(runtime, 'Python');
});

test('detectLanguageRuntime: bare directory, nothing detectable, comes back blank', () => {
    const sandbox = mkSandbox();
    const { language, runtime } = detectLanguageRuntime(sandbox);
    assert.equal(language, '');
    assert.equal(runtime, '');
});

test('detectFramework: package.json dependency on next => Next.js', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } }));
    assert.equal(detectFramework(sandbox), 'Next.js');
});

test('detectFramework: no evidence returns blank, not a guess', () => {
    const sandbox = mkSandbox();
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ dependencies: {} }));
    assert.equal(detectFramework(sandbox), '');
});

test('renderClaudeMdTemplate: fills evidenced fields and marks the rest _(not set)_', () => {
    const template = [
        '# {PROJECT_NAME}',
        '- Language: {LANGUAGE}',
        '- Framework: {FRAMEWORK}',
        '- Runtime: {RUNTIME}',
        '{PROJECT_ROOT}/',
    ].join('\n');

    const out = renderClaudeMdTemplate(template, {
        projectName: 'my-app',
        projectRoot: '/path/to/my-app',
        language: 'TypeScript',
        runtime: 'Node.js',
        framework: '',
    });

    assert.match(out, /^# my-app$/m);
    assert.match(out, /^- Language: TypeScript$/m);
    assert.match(out, /^- Framework: _\(not set\)_$/m);
    assert.match(out, /^- Runtime: Node\.js$/m);
    assert.match(out, /^\/path\/to\/my-app\/$/m);
    assert.doesNotMatch(out, /\{[A-Z_]+\}/, 'no raw placeholder must survive');
});

test('main: end-to-end — CLAUDE.md has zero {UPPERCASE} placeholders for a Node+TypeScript project', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'ts-app' }));
    fs.writeFileSync(path.join(target, 'tsconfig.json'), '{}');

    runInit(target);

    const claudeText = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claudeText, /\{[A-Z_]+\}/, 'no raw {PLACEHOLDER} must remain');
    assert.match(claudeText, /# ts-app/);
    assert.match(claudeText, /Language: TypeScript/);
    assert.match(claudeText, /Runtime: Node\.js/);
});

test('main: end-to-end — CLAUDE.md has zero {UPPERCASE} placeholders for a Go project', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'go.mod'), 'module example.com/foo\n');

    runInit(target);

    const claudeText = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claudeText, /\{[A-Z_]+\}/, 'no raw {PLACEHOLDER} must remain');
    assert.match(claudeText, /Language: Go/);
});

test('main: end-to-end — CLAUDE.md has zero {UPPERCASE} placeholders for a bare directory with no manifest', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));

    runInit(target);

    const claudeText = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claudeText, /\{[A-Z_]+\}/, 'no raw {PLACEHOLDER} must remain');
    assert.match(claudeText, new RegExp(`# ${path.basename(target)}`));
    assert.match(claudeText, /Language: _\(not set\)_/);
    assert.match(claudeText, /Framework: _\(not set\)_/);
});

test('main: --project-name overrides both package.json name and directory basename', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'from-package-json' }));

    runInit(target, ['--project-name', 'from-flag']);

    const claudeText = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.match(claudeText, /# from-flag/);
    assert.doesNotMatch(claudeText, /from-package-json/);
});

test('main: re-running init never touches an already-filled-in CLAUDE.md (marker already present)', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const claudeDest = path.join(target, 'CLAUDE.md');
    const firstRun = fs.readFileSync(claudeDest, 'utf8');

    runInit(target, ['--project-name', 'should-not-apply']);

    assert.equal(fs.readFileSync(claudeDest, 'utf8'), firstRun, 'CLAUDE.md must be untouched on re-run');
});

test('main: re-running with new PM flags never touches an already-filled-in config.md', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const configDest = path.join(target, '.flow', 'config.md');
    fs.writeFileSync(configDest, 'USER EDITED CONFIG');

    runInit(target, ['--workflow-mode', 'team', '--pm-backend', 'linear', '--pm-linear-team', 'ENG']);

    assert.equal(fs.readFileSync(configDest, 'utf8'), 'USER EDITED CONFIG', 'existing user config must never be rewritten by PM flags either');
});


// --- The closing message never hands the user homework the agent can do (issue #20) ---

test('doneMessage: nothing detected — directs the AGENT to infer the commands, not the user', () => {
    const message = doneMessage(blankDetection());

    assert.match(message, /No stack commands were detected/);
    assert.match(message, /agent, not the user/,
        'the work is addressed to whoever can actually do it');
    assert.match(message, /verify/i, 'an inferred command is worthless unverified');
    assert.doesNotMatch(message, /edit \.flow\/config\.md to fill in/,
        'the old "edit it yourself" punt must be gone');
    assert.doesNotMatch(message, /by hand/);
});

test('doneMessage: partial detection — names exactly the keys still blank', () => {
    const message = doneMessage(blankDetection({ lint_cmd: 'ruff check .', test_cmd: 'pytest' }));

    assert.match(message, /Not detected from manifests: dev_cmd, typecheck_cmd, build_cmd, format_cmd/);
    assert.doesNotMatch(message, /lint_cmd/, 'a detected key is not outstanding work');
    assert.doesNotMatch(message, /test_cmd/);
    assert.match(message, /agent, not the user/);
});

test('doneMessage: everything detected — plain done, no follow-up work', () => {
    const message = doneMessage(blankDetection({
        dev_cmd: 'pnpm dev', lint_cmd: 'pnpm lint', typecheck_cmd: 'pnpm typecheck',
        build_cmd: 'pnpm build', test_cmd: 'pnpm test', format_cmd: 'pnpm format',
    }));

    assert.match(message, /Every stack command was detected/);
    assert.doesNotMatch(message, /agent, not the user/, 'nothing is outstanding, so ask for nothing');
});

test('doneMessage: config.md already existed — nothing was detected, so nothing is owed', () => {
    const message = doneMessage(null);

    assert.equal(message, '[flow init] Done.\n');
});

test('main: script-style Python repo — output tells the agent to fill the blanks in, never the user', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    // requirements.txt + a venv + a runnable test file: plenty for an agent to work
    // from, but no manifest the script itself reads. This is the issue's repro.
    fs.writeFileSync(path.join(target, 'requirements.txt'), 'requests\n');
    fs.mkdirSync(path.join(target, 'venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(target, 'test_thing.py'), 'def test_thing():\n    assert True\n');

    const { code, output } = runInitCapturing(target, ['--pm-backend', 'local']);

    assert.equal(code, 0);
    assert.match(output, /No stack commands were detected/);
    assert.match(output, /agent, not the user/);
    assert.doesNotMatch(output, /edit \.flow\/config\.md to fill in/,
        'the user must never be handed the config file as homework');
    assert.doesNotMatch(output, /by hand/);

    // The detection invariant itself is unchanged: blanks stay blank on disk.
    const configText = fs.readFileSync(path.join(target, '.flow', 'config.md'), 'utf8');
    assert.match(configText, /^- test_cmd:$/m);
    assert.doesNotMatch(configText, /\{COMMAND_TO/);
});

test('main: fully-detected project keeps the plain detected-command output', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    fs.writeFileSync(path.join(target, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
        scripts: {
            dev: 'vite', lint: 'eslint .', typecheck: 'tsc --noEmit',
            build: 'vite build', test: 'vitest run', format: 'prettier --write .',
        },
    }));

    const { output } = runInitCapturing(target);

    assert.match(output, /detected: lint_cmd = pnpm lint/, 'the per-key detection lines are unchanged');
    assert.match(output, /Every stack command was detected/);
    assert.doesNotMatch(output, /agent, not the user/, 'nothing was left blank, so ask for nothing');
});

test('main: re-run over an existing config.md asks for no follow-up work', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-init-'));
    runInit(target);

    const { output } = runInitCapturing(target);

    assert.match(output, /\[flow init\] Done\./);
    assert.doesNotMatch(output, /agent, not the user/,
        're-running detects nothing, and an existing config is the user\'s own — leave it be');
    assert.doesNotMatch(output, /No stack commands were detected/);
});
