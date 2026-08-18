#!/usr/bin/env node
/**
 * uninstall.js — remove the files `/flow:init` created from a project.
 *
 * Usage:
 *   node scripts/uninstall.js [--target <dir>] [--yes] [--keep-progress] [--purge]
 *
 * Safe by default: with no --yes it prints the plan and changes nothing, so
 * `uninstall` then `init` is a reliable way to regenerate a stale config.
 *
 * Removes:
 *   .flow/config.md, .flow/local.md
 *   .flow/session-progress.md — unless --keep-progress
 *   .flow/state/ and the one-shot arming markers (.flow/.allow-*)
 *   the <!-- flow:begin -->…<!-- flow:end --> block in CLAUDE.md
 *   issues/  — only when empty; never deletes issue files
 *
 * Keeps unless --purge (durable state: history and answered decisions):
 *   .flow/session-log.md — append-only history, expensive to lose and cheap
 *   to keep. It is the one file here that cannot be regenerated.
 *
 * Never touches: .claude/settings.json (flow does not manage it), anything
 * outside the target, or a CLAUDE.md with no flow block.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { target: process.cwd(), yes: false, purge: false, keepProgress: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--target' || a === '-t') args.target = path.resolve(argv[++i] || '.');
        else if (a === '--yes' || a === '-y') args.yes = true;
        else if (a === '--purge') args.purge = true;
        else if (a === '--keep-progress') args.keepProgress = true;
        else if (a === '--help' || a === '-h') args.help = true;
    }
    return args;
}

function printHelp() {
    process.stdout.write(
        'Usage: node scripts/uninstall.js [--target <dir>] [--yes] [--keep-progress] [--purge]\n' +
        '\n' +
        '  --target, -t      Project directory (default: cwd)\n' +
        '  --yes, -y         Actually remove; without it, only prints the plan\n' +
        '  --keep-progress   Keep .flow/session-progress.md (your live session thread)\n' +
        '  --purge           Also delete .flow/session-log.md and .flow/questions.md\n' +
        '  --help, -h        Show this help\n'
    );
}

const FLOW_BEGIN = '<!-- flow:begin -->';
const FLOW_END = '<!-- flow:end -->';

/**
 * Strip the marked flow block from CLAUDE.md content.
 * @returns {{ text: string, found: boolean, onlyFlow: boolean }}
 *   onlyFlow is true when the block was the entire file — i.e. init created
 *   it, so there is nothing of the user's to preserve.
 */
function stripFlowBlock(content) {
    const start = content.indexOf(FLOW_BEGIN);
    if (start === -1) return { text: content, found: false, onlyFlow: false };
    const endIdx = content.indexOf(FLOW_END, start);
    if (endIdx === -1) return { text: content, found: false, onlyFlow: false };

    const text = (content.slice(0, start) + content.slice(endIdx + FLOW_END.length))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { text: text ? text + '\n' : '', found: true, onlyFlow: text === '' };
}

/** Is this directory empty (so it is safe to remove)? */
function isEmptyDir(dir) {
    try {
        return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
    } catch (e) {
        return false;
    }
}

/**
 * Build the list of actions for `target`, without performing any of them.
 * Each action is { kind, path, note? } where kind is
 * 'remove-file' | 'remove-dir' | 'edit-claude-md' | 'remove-claude-md'.
 */
function plan(target, opts = {}) {
    const actions = [];
    const flowDir = path.join(target, '.flow');

    const files = ['config.md', 'local.md'];
    // session-progress.md is the live thread of whatever you were doing. It is
    // cheap to keep and irreplaceable if you were mid-task, so the caller has
    // to decide explicitly rather than losing it as a side effect.
    if (!opts.keepProgress) files.push('session-progress.md');
    // questions.md holds answered decisions and their rationale — durable state
    // like the log, not a live thread. Removing it as a side effect of uninstall
    // would throw away the record of why things were decided, so it takes the
    // same explicit --purge as the log.
    if (opts.purge) files.push('session-log.md', 'questions.md');
    for (const name of files) {
        const p = path.join(flowDir, name);
        if (fs.existsSync(p)) actions.push({ kind: 'remove-file', path: p });
    }

    if (opts.keepProgress && fs.existsSync(path.join(flowDir, 'session-progress.md'))) {
        actions.push({
            kind: 'keep',
            path: path.join(flowDir, 'session-progress.md'),
            note: 'your current session thread',
        });
    }

    // Arming markers are one-shot grants; leaving one behind would hand the
    // next session a standing bypass.
    if (fs.existsSync(flowDir)) {
        for (const name of fs.readdirSync(flowDir)) {
            if (name.startsWith('.allow-')) {
                actions.push({ kind: 'remove-file', path: path.join(flowDir, name) });
            }
        }
    }

    const stateDir = path.join(flowDir, 'state');
    if (fs.existsSync(stateDir)) actions.push({ kind: 'remove-dir', path: stateDir });

    if (!opts.purge && fs.existsSync(path.join(flowDir, 'questions.md'))) {
        actions.push({
            kind: 'keep',
            path: path.join(flowDir, 'questions.md'),
            note: 'answered decisions and open questions — use --purge to delete',
        });
    }

    if (!opts.purge && fs.existsSync(path.join(flowDir, 'session-log.md'))) {
        actions.push({
            kind: 'keep',
            path: path.join(flowDir, 'session-log.md'),
            note: 'append-only history — use --purge to delete',
        });
    }

    const claudeMd = path.join(target, 'CLAUDE.md');
    if (fs.existsSync(claudeMd)) {
        const { found, onlyFlow } = stripFlowBlock(fs.readFileSync(claudeMd, 'utf8'));
        if (found && onlyFlow) {
            actions.push({ kind: 'remove-claude-md', path: claudeMd, note: 'created by flow, contains nothing else' });
        } else if (found) {
            actions.push({ kind: 'edit-claude-md', path: claudeMd, note: 'remove the flow block, keep your content' });
        }
    }

    const issues = path.join(target, 'issues');
    if (isEmptyDir(issues)) {
        actions.push({ kind: 'remove-dir', path: issues, note: 'empty' });
    } else if (fs.existsSync(issues)) {
        actions.push({ kind: 'keep', path: issues, note: 'not empty — your issue files are left alone' });
    }

    return actions;
}

function apply(actions) {
    for (const a of actions) {
        switch (a.kind) {
            case 'remove-file':
                fs.rmSync(a.path, { force: true });
                break;
            case 'remove-dir':
                fs.rmSync(a.path, { recursive: true, force: true });
                break;
            case 'remove-claude-md':
                fs.rmSync(a.path, { force: true });
                break;
            case 'edit-claude-md': {
                const { text } = stripFlowBlock(fs.readFileSync(a.path, 'utf8'));
                fs.writeFileSync(a.path, text);
                break;
            }
            default:
                break; // 'keep' is informational
        }
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return 0;
    }
    if (!fs.existsSync(args.target)) {
        process.stderr.write(`[flow uninstall] Target does not exist: ${args.target}\n`);
        return 1;
    }

    const actions = plan(args.target, { purge: args.purge, keepProgress: args.keepProgress });
    const changes = actions.filter((a) => a.kind !== 'keep');

    process.stdout.write(`[flow uninstall] ${args.target}\n`);
    if (actions.length === 0) {
        process.stdout.write('  nothing to remove — flow was not initialised here\n');
        return 0;
    }

    const labels = {
        'remove-file': 'remove',
        'remove-dir': 'remove dir',
        'remove-claude-md': 'remove',
        'edit-claude-md': 'edit',
        keep: 'keep',
    };
    for (const a of actions) {
        const rel = path.relative(args.target, a.path) || a.path;
        process.stdout.write(`  ${labels[a.kind].padEnd(10)} ${rel}${a.note ? `  (${a.note})` : ''}\n`);
    }

    if (!args.yes) {
        process.stdout.write(`\n[flow uninstall] Dry run — nothing changed. Re-run with --yes to apply.\n`);
        return 0;
    }

    apply(actions);
    process.stdout.write(`\n[flow uninstall] Removed ${changes.length} item(s). Run /flow:init to set up again.\n`);
    return 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { main, parseArgs, plan, apply, stripFlowBlock, isEmptyDir };
