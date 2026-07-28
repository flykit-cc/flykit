#!/usr/bin/env node
/**
 * init.js — bootstrap a project for the flow plugin.
 *
 * Usage:
 *   node scripts/init.js [--target <dir>]
 *     [--workflow-mode <solo|team>]
 *     [--pm-backend <github|linear|local>]
 *     [--pm-github-owner <owner>] [--pm-github-repo <repo>]
 *     [--pm-linear-team <team>]
 *
 * Creates (idempotent — never overwrites):
 *   <target>/.claude/config.md     from references/config-template.md
 *   <target>/CLAUDE.md             from references/claude-md-template.md
 *   <target>/issues/               empty directory for local-backend issues
 *
 * Any of the flags above that are supplied get written into a freshly-created
 * config.md alongside the auto-detected stack commands. Omitted flags keep the
 * template's own default (workflow_mode/pm_backend) or come back blank
 * (pm_github_owner/pm_github_repo/pm_linear_team) — never a `{PLACEHOLDER}`.
 *
 * Each step prints "created" or "already exists, skipping".
 */

'use strict';

const { pluginRoot } = require('./lib/bootstrap');
const fs = require('fs');
const path = require('path');

const VALID_WORKFLOW_MODES = ['solo', 'team'];
const VALID_PM_BACKENDS = ['github', 'linear', 'local'];

function parseArgs(argv) {
    const args = { target: process.cwd() };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--target' || a === '-t') {
            args.target = path.resolve(argv[++i] || '.');
        } else if (a === '--workflow-mode') {
            args.workflowMode = argv[++i];
        } else if (a === '--pm-backend') {
            args.pmBackend = argv[++i];
        } else if (a === '--pm-github-owner') {
            args.pmGithubOwner = argv[++i];
        } else if (a === '--pm-github-repo') {
            args.pmGithubRepo = argv[++i];
        } else if (a === '--pm-linear-team') {
            args.pmLinearTeam = argv[++i];
        } else if (a === '--project-name') {
            args.projectName = argv[++i];
        } else if (a === '--help' || a === '-h') {
            args.help = true;
        }
    }
    return args;
}

function printHelp() {
    process.stdout.write(
        'Usage: node scripts/init.js [--target <dir>] [--workflow-mode <solo|team>]\n' +
        '         [--pm-backend <github|linear|local>] [--pm-github-owner <owner>]\n' +
        '         [--pm-github-repo <repo>] [--pm-linear-team <team>]\n' +
        '\n' +
        '  --target, -t         Project directory to initialise (default: cwd)\n' +
        '  --workflow-mode      solo or team (default: template default, solo)\n' +
        '  --pm-backend         github, linear, or local (default: template default, github)\n' +
        '  --pm-github-owner    GitHub repo owner, required when pm-backend=github\n' +
        '  --pm-github-repo     GitHub repo name, required when pm-backend=github\n' +
        '  --pm-linear-team     Linear team key, required when pm-backend=linear\n' +
        '  --project-name       Project name for CLAUDE.md (default: package.json name, else dir basename)\n' +
        '  --help, -h           Show this help\n'
    );
}

function ensureDir(dir) {
    if (fs.existsSync(dir)) {
        return { created: false, path: dir };
    }
    fs.mkdirSync(dir, { recursive: true });
    return { created: true, path: dir };
}

function copyIfMissing(src, dest) {
    if (fs.existsSync(dest)) {
        return { created: false, path: dest };
    }
    if (!fs.existsSync(src)) {
        return { created: false, path: dest, missingSource: true };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return { created: true, path: dest };
}

/**
 * Add a marked section to `dest`, creating the file if absent.
 *
 * Idempotent: a file that already contains the marker is left untouched, so
 * `init` can be re-run safely. Never rewrites content outside the markers —
 * the user's own notes are theirs.
 *
 * @returns {'created'|'appended'|'present'}
 */
function appendSection(dest, marker, body) {
    const begin = `<!-- ${marker}:begin -->`;
    const end = `<!-- ${marker}:end -->`;
    const block = `${begin}\n${body.trim()}\n${end}\n`;

    if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, block);
        return 'created';
    }

    const current = fs.readFileSync(dest, 'utf8');
    if (current.includes(begin)) return 'present';

    const sep = current.endsWith('\n') ? '\n' : '\n\n';
    fs.appendFileSync(dest, `${sep}${block}`);
    return 'appended';
}

const STACK_CMD_KEYS = ['dev_cmd', 'lint_cmd', 'typecheck_cmd', 'build_cmd', 'test_cmd', 'format_cmd'];

/**
 * Package-manager prefix for `npm run <script>`-style commands, chosen from
 * whichever lockfile is present. `npm run` is the fallback (no lockfile, or
 * a plain package-lock.json project).
 */
function pmPrefix(target) {
    if (fs.existsSync(path.join(target, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(target, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(target, 'bun.lockb'))) return 'bun';
    return 'npm run';
}

/**
 * Detect this project's stack commands by reading its manifest/config files.
 * Never invents a command that isn't evidenced by a file on disk — any key
 * that can't be detected comes back as an empty string, not a placeholder.
 */
function detectStackCommands(target) {
    const detected = {};
    for (const key of STACK_CMD_KEYS) detected[key] = '';

    const pkgPath = path.join(target, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const scripts = pkg.scripts || {};
            const prefix = pmPrefix(target);
            const scriptToKey = {
                dev: 'dev_cmd',
                lint: 'lint_cmd',
                typecheck: 'typecheck_cmd',
                'type-check': 'typecheck_cmd',
                build: 'build_cmd',
                test: 'test_cmd',
                format: 'format_cmd',
            };
            for (const [script, key] of Object.entries(scriptToKey)) {
                if (scripts[script] && !detected[key]) {
                    detected[key] = `${prefix} ${script}`;
                }
            }
        } catch (e) {
            // Malformed package.json — skip Node detection, fall through to others.
        }
    }

    let pyproject = '';
    if (fs.existsSync(path.join(target, 'pyproject.toml'))) {
        pyproject = fs.readFileSync(path.join(target, 'pyproject.toml'), 'utf8');
    }
    if (!detected.lint_cmd && (fs.existsSync(path.join(target, 'ruff.toml')) || /\[tool\.ruff\]/.test(pyproject))) {
        detected.lint_cmd = 'ruff check .';
    }
    if (!detected.test_cmd && (fs.existsSync(path.join(target, 'pytest.ini')) || /\[tool\.pytest/.test(pyproject))) {
        detected.test_cmd = 'pytest';
    }

    if (fs.existsSync(path.join(target, 'go.mod'))) {
        if (!detected.lint_cmd) detected.lint_cmd = 'go vet ./...';
        if (!detected.test_cmd) detected.test_cmd = 'go test ./...';
        if (!detected.build_cmd) detected.build_cmd = 'go build ./...';
    }

    if (fs.existsSync(path.join(target, 'Cargo.toml'))) {
        if (!detected.lint_cmd) detected.lint_cmd = 'cargo clippy';
        if (!detected.test_cmd) detected.test_cmd = 'cargo test';
        if (!detected.build_cmd) detected.build_cmd = 'cargo build --release';
    }

    return detected;
}

/**
 * Replace each `- <key>: {PLACEHOLDER}` line in a freshly-copied config.md
 * with the detected command, or a bare `- <key>:` when nothing was detected.
 */
function applyStackCommands(text, detected) {
    let out = text;
    for (const key of STACK_CMD_KEYS) {
        const value = detected[key] || '';
        const re = new RegExp(`^- ${key}:.*$`, 'm');
        out = out.replace(re, `- ${key}:${value ? ' ' + value : ''}`);
    }
    return out;
}

/**
 * Fill in the workflow/PM-backend fields of a freshly-copied config.md from
 * CLI flags. `workflow_mode`/`pm_backend` keep the template's own default
 * (`solo`/`github`) when not supplied; the backend-specific fields
 * (`pm_github_owner`, `pm_github_repo`, `pm_linear_team`) come back blank
 * rather than leaving their `{PLACEHOLDER}` behind.
 */
function applyPmFields(text, opts) {
    let out = text;
    if (opts.workflowMode) {
        out = out.replace(/^- workflow_mode:.*$/m, `- workflow_mode: ${opts.workflowMode}`);
    }
    if (opts.pmBackend) {
        out = out.replace(/^- pm_backend:.*$/m, `- pm_backend: ${opts.pmBackend}`);
    }
    const blankable = [
        ['pm_github_owner', opts.pmGithubOwner],
        ['pm_github_repo', opts.pmGithubRepo],
        ['pm_linear_team', opts.pmLinearTeam],
    ];
    for (const [key, value] of blankable) {
        const re = new RegExp(`^- ${key}:.*$`, 'm');
        out = out.replace(re, `- ${key}:${value ? ' ' + value : ''}`);
    }
    return out;
}

function readPkg(target) {
    const pkgPath = path.join(target, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
        return null; // Malformed package.json — treat as absent.
    }
}

/**
 * Detect the project's name for CLAUDE.md: an explicit override (the
 * --project-name flag) wins, then package.json's `name`, then the target
 * directory's own basename — always something real, never a placeholder.
 */
function detectProjectName(target, override) {
    if (override) return override;
    const pkg = readPkg(target);
    if (pkg && pkg.name) return pkg.name;
    return path.basename(target);
}

/**
 * Detect language + runtime from whichever manifest is on disk. Never
 * invents a claim that isn't evidenced by a file — comes back blank when
 * nothing matches.
 */
function detectLanguageRuntime(target) {
    const pkg = readPkg(target);
    if (pkg) {
        const language = fs.existsSync(path.join(target, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript';
        return { language, runtime: 'Node.js' };
    }
    if (fs.existsSync(path.join(target, 'go.mod'))) {
        return { language: 'Go', runtime: 'Go' };
    }
    if (fs.existsSync(path.join(target, 'Cargo.toml'))) {
        return { language: 'Rust', runtime: 'Rust' };
    }
    if (fs.existsSync(path.join(target, 'pyproject.toml')) || fs.existsSync(path.join(target, 'requirements.txt'))) {
        return { language: 'Python', runtime: 'Python' };
    }
    return { language: '', runtime: '' };
}

/**
 * Detect the web/service framework from a dependency or manifest string
 * that unambiguously names it. Returns '' rather than guess when nothing
 * on disk evidences a specific framework.
 */
function detectFramework(target) {
    const pkg = readPkg(target);
    if (pkg) {
        const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
        if (deps.next) return 'Next.js';
        if (deps.react) return 'React';
        if (deps.vue) return 'Vue';
        if (deps['@nestjs/core']) return 'NestJS';
        if (deps.fastify) return 'Fastify';
        if (deps.express) return 'Express';
        return '';
    }
    if (fs.existsSync(path.join(target, 'go.mod'))) {
        const goMod = fs.readFileSync(path.join(target, 'go.mod'), 'utf8');
        if (/gin-gonic\/gin/.test(goMod)) return 'Gin';
        if (/labstack\/echo/.test(goMod)) return 'Echo';
        return '';
    }
    if (fs.existsSync(path.join(target, 'Cargo.toml'))) {
        const cargo = fs.readFileSync(path.join(target, 'Cargo.toml'), 'utf8');
        if (/^actix-web/m.test(cargo)) return 'Actix';
        if (/^axum/m.test(cargo)) return 'Axum';
        if (/^rocket/m.test(cargo)) return 'Rocket';
        return '';
    }
    const pyproject = fs.existsSync(path.join(target, 'pyproject.toml'))
        ? fs.readFileSync(path.join(target, 'pyproject.toml'), 'utf8') : '';
    const requirements = fs.existsSync(path.join(target, 'requirements.txt'))
        ? fs.readFileSync(path.join(target, 'requirements.txt'), 'utf8') : '';
    const combined = `${pyproject}\n${requirements}`;
    if (/django/i.test(combined)) return 'Django';
    if (/fastapi/i.test(combined)) return 'FastAPI';
    if (/flask/i.test(combined)) return 'Flask';
    return '';
}

/**
 * Substitute the CLAUDE.md template's `{KEY}` placeholders with detected
 * values. Anything not detected — or not detectable at all, like
 * DATABASE_OR_NONE/DEPLOY_TARGET — renders as `_(not set)_`, an honest,
 * clearly-intentional marker instead of a raw `{PLACEHOLDER}`.
 */
function renderClaudeMdTemplate(text, opts) {
    const substitutions = {
        PROJECT_NAME: opts.projectName,
        PROJECT_ROOT: opts.projectRoot,
        LANGUAGE: opts.language,
        RUNTIME: opts.runtime,
        FRAMEWORK: opts.framework,
        DATABASE_OR_NONE: opts.database,
        DEPLOY_TARGET: opts.deployTarget,
    };
    let out = text;
    for (const [key, value] of Object.entries(substitutions)) {
        out = out.split(`{${key}}`).join(value || '_(not set)_');
    }
    return out;
}

function report(label, result) {
    // appendSection returns a plain 'created'|'appended'|'present' string;
    // copyIfMissing/ensureDir return a { created, path, missingSource? } object.
    if (typeof result === 'string') {
        const symbol = result === 'present' ? '·' : '+';
        process.stdout.write(`  ${symbol} ${label}: ${result}\n`);
        return;
    }
    if (result.missingSource) {
        process.stdout.write(`  ! ${label}: source template missing (${result.path})\n`);
        return;
    }
    const status = result.created ? 'created' : 'already exists, skipping';
    process.stdout.write(`  ${result.created ? '+' : '·'} ${label}: ${status}\n`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return 0;
    }

    if (args.workflowMode && !VALID_WORKFLOW_MODES.includes(args.workflowMode)) {
        process.stderr.write(`[flow init] Invalid --workflow-mode: ${args.workflowMode} (expected one of: ${VALID_WORKFLOW_MODES.join(', ')})\n`);
        return 1;
    }
    if (args.pmBackend && !VALID_PM_BACKENDS.includes(args.pmBackend)) {
        process.stderr.write(`[flow init] Invalid --pm-backend: ${args.pmBackend} (expected one of: ${VALID_PM_BACKENDS.join(', ')})\n`);
        return 1;
    }

    const target = args.target;
    if (!fs.existsSync(target)) {
        process.stderr.write(`[flow init] Target does not exist: ${target}\n`);
        return 1;
    }

    process.stdout.write(`[flow init] Initialising: ${target}\n`);

    const refDir = path.join(pluginRoot, 'references');
    const configSrc = path.join(refDir, 'config-template.md');
    const claudeSrc = path.join(refDir, 'claude-md-template.md');

    const configDest = path.join(target, '.claude', 'config.md');
    const claudeDest = path.join(target, 'CLAUDE.md');
    const issuesDir = path.join(target, 'issues');

    const configResult = copyIfMissing(configSrc, configDest);
    report('.claude/config.md', configResult);
    // Only fill in a freshly-created config.md — an existing one may already
    // hold the user's own edits, which copyIfMissing correctly left alone.
    if (configResult.created) {
        const detected = detectStackCommands(target);
        let text = fs.readFileSync(configDest, 'utf8');
        text = applyStackCommands(text, detected);
        text = applyPmFields(text, args);
        fs.writeFileSync(configDest, text);
        for (const key of STACK_CMD_KEYS) {
            if (detected[key]) {
                process.stdout.write(`  detected: ${key} = ${detected[key]}\n`);
            }
        }
        const pmFlags = [
            ['workflow_mode', args.workflowMode],
            ['pm_backend', args.pmBackend],
            ['pm_github_owner', args.pmGithubOwner],
            ['pm_github_repo', args.pmGithubRepo],
            ['pm_linear_team', args.pmLinearTeam],
        ];
        for (const [key, value] of pmFlags) {
            if (value) process.stdout.write(`  set: ${key} = ${value}\n`);
        }
    }
    // CLAUDE.md usually already exists, so append a marked section rather than
    // skipping — otherwise an existing project never receives flow's conventions.
    if (fs.existsSync(claudeSrc)) {
        const { language, runtime } = detectLanguageRuntime(target);
        const body = renderClaudeMdTemplate(fs.readFileSync(claudeSrc, 'utf8'), {
            projectName: detectProjectName(target, args.projectName),
            projectRoot: target,
            language,
            runtime,
            framework: detectFramework(target),
            database: '',
            deployTarget: '',
        });
        report('CLAUDE.md', appendSection(claudeDest, 'flow', body));
    } else {
        report('CLAUDE.md', { created: false, path: claudeSrc, missingSource: true });
    }
    report('issues/', ensureDir(issuesDir));

    process.stdout.write('\n[flow init] Done. Next: edit .claude/config.md to fill in your project commands.\n');
    return 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = {
    main, parseArgs, copyIfMissing, ensureDir, appendSection,
    detectStackCommands, applyStackCommands, applyPmFields, pmPrefix,
    detectProjectName, detectLanguageRuntime, detectFramework, renderClaudeMdTemplate,
    VALID_WORKFLOW_MODES, VALID_PM_BACKENDS,
};
