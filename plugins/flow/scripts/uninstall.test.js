'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'uninstall.js');
const { plan, stripFlowBlock } = require('./uninstall.js');

function run(target, extra = []) {
    return execFileSync('node', [SCRIPT, '--target', target, ...extra], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
}

/** A project that looks like /flow:init ran in it. */
function makeProject(opts = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-uninstall-'));
    fs.mkdirSync(path.join(root, '.flow', 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, '.flow', 'config.md'), '# flow config\n');
    fs.writeFileSync(path.join(root, '.flow', 'session-progress.md'), 'wip\n');
    fs.writeFileSync(path.join(root, '.flow', 'session-log.md'), '## history\n');
    fs.writeFileSync(path.join(root, '.flow', 'state', 'last-pause'), 'sha\n');
    if (opts.armed) fs.writeFileSync(path.join(root, '.flow', '.allow-destructive'), '1\n');
    if (opts.claudeMd) fs.writeFileSync(path.join(root, 'CLAUDE.md'), opts.claudeMd);
    if (opts.issues) {
        fs.mkdirSync(path.join(root, 'issues'), { recursive: true });
        for (const f of opts.issues) fs.writeFileSync(path.join(root, 'issues', f), 'x\n');
    }
    return root;
}

test('dry run by default — prints a plan and changes nothing', () => {
    const root = makeProject();
    const before = fs.readdirSync(path.join(root, '.flow')).sort();

    const out = run(root);
    assert.match(out, /Dry run/);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.flow')).sort(), before);
});

test('--yes removes config, progress, state and arming markers', () => {
    const root = makeProject({ armed: true });
    run(root, ['--yes']);

    assert.ok(!fs.existsSync(path.join(root, '.flow', 'config.md')));
    assert.ok(!fs.existsSync(path.join(root, '.flow', 'session-progress.md')));
    assert.ok(!fs.existsSync(path.join(root, '.flow', 'state')));
    assert.ok(!fs.existsSync(path.join(root, '.flow', '.allow-destructive')),
        'an arming marker must never survive uninstall');
});

test('--keep-progress spares the live session thread', () => {
    const root = makeProject();
    run(root, ['--yes', '--keep-progress']);

    assert.ok(fs.existsSync(path.join(root, '.flow', 'session-progress.md')),
        'the open session must survive when the user chose to keep it');
    assert.ok(!fs.existsSync(path.join(root, '.flow', 'config.md')),
        'everything else still goes');
});

test('session-progress.md is removed by default', () => {
    const root = makeProject();
    run(root, ['--yes']);
    assert.ok(!fs.existsSync(path.join(root, '.flow', 'session-progress.md')));
});

test('the plan lists session-progress as kept under --keep-progress', () => {
    const root = makeProject();
    const out = run(root, ['--keep-progress']);
    assert.match(out, /keep\s+.flow\/session-progress\.md/,
        'the dry run must show it being kept, so the choice is visible before applying');
});

test('session-log.md is kept without --purge and removed with it', () => {
    const kept = makeProject();
    run(kept, ['--yes']);
    assert.ok(fs.existsSync(path.join(kept, '.flow', 'session-log.md')),
        'history survives a plain uninstall');

    const purged = makeProject();
    run(purged, ['--yes', '--purge']);
    assert.ok(!fs.existsSync(path.join(purged, '.flow', 'session-log.md')));
});

test('a CLAUDE.md the user owns keeps its content, loses only the flow block', () => {
    const root = makeProject({
        claudeMd: '# My project\n\nReal docs.\n\n<!-- flow:begin -->\ngeneric template\n<!-- flow:end -->\n',
    });
    run(root, ['--yes']);

    const after = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(after, /Real docs\./);
    assert.ok(!after.includes('flow:begin'));
    assert.ok(!after.includes('generic template'));
});

test('a CLAUDE.md containing only the flow block is deleted', () => {
    const root = makeProject({
        claudeMd: '<!-- flow:begin -->\ngenerated\n<!-- flow:end -->\n',
    });
    run(root, ['--yes']);
    assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.md')));
});

test('a CLAUDE.md with no flow block is never touched', () => {
    const original = '# Mine\n\nNothing to do with flow.\n';
    const root = makeProject({ claudeMd: original });
    run(root, ['--yes']);
    assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), original);
});

test('issues/ is removed when empty but never when it holds files', () => {
    const withFiles = makeProject({ issues: ['1.md'] });
    run(withFiles, ['--yes']);
    assert.ok(fs.existsSync(path.join(withFiles, 'issues', '1.md')),
        'issue files must never be deleted');

    const empty = makeProject({ issues: [] });
    run(empty, ['--yes']);
    assert.ok(!fs.existsSync(path.join(empty, 'issues')));
});

test('settings.json is never touched', () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const settings = '{"hooks":{}}\n';
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), settings);

    run(root, ['--yes']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'), settings);
});

test('a project without flow reports nothing to remove', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-uninstall-bare-'));
    const out = run(root, ['--yes']);
    assert.match(out, /nothing to remove/);
});

test('stripFlowBlock leaves content lacking an end marker alone', () => {
    const broken = '# Mine\n\n<!-- flow:begin -->\nunterminated\n';
    const { text, found } = stripFlowBlock(broken);
    assert.strictEqual(found, false);
    assert.strictEqual(text, broken, 'a malformed block must not eat the rest of the file');
});

test('plan() is pure — it reports without removing anything', () => {
    const root = makeProject({ claudeMd: '# x\n<!-- flow:begin -->\ny\n<!-- flow:end -->\n' });
    const before = fs.readdirSync(root).sort();
    const actions = plan(root, {});
    assert.ok(actions.length > 0);
    assert.deepStrictEqual(fs.readdirSync(root).sort(), before);
});
