#!/usr/bin/env node
/**
 * init.js — bootstrap a project for the flow plugin.
 *
 * Usage:
 *   node scripts/init.js [--target <dir>]
 *
 * Creates (idempotent — never overwrites):
 *   <target>/.claude/config.md     from references/config-template.md
 *   <target>/CLAUDE.md             from references/claude-md-template.md
 *   <target>/issues/               empty directory for local-backend issues
 *
 * Each step prints "created" or "already exists, skipping".
 */

'use strict';

const { pluginRoot } = require('./lib/bootstrap');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { target: process.cwd() };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--target' || a === '-t') {
            args.target = path.resolve(argv[++i] || '.');
        } else if (a === '--help' || a === '-h') {
            args.help = true;
        }
    }
    return args;
}

function printHelp() {
    process.stdout.write(
        'Usage: node scripts/init.js [--target <dir>]\n' +
        '\n' +
        '  --target, -t   Project directory to initialise (default: cwd)\n' +
        '  --help, -h     Show this help\n'
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

    report('.claude/config.md', copyIfMissing(configSrc, configDest));
    // CLAUDE.md usually already exists, so append a marked section rather than
    // skipping — otherwise an existing project never receives flow's conventions.
    if (fs.existsSync(claudeSrc)) {
        report('CLAUDE.md', appendSection(claudeDest, 'flow', fs.readFileSync(claudeSrc, 'utf8')));
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

module.exports = { main, parseArgs, copyIfMissing, ensureDir, appendSection };
