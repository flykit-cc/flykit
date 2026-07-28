'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, 'secret-guard.sh');

function runHook(input) {
    try {
        const stdout = execFileSync('bash', [HOOK], {
            encoding: 'utf8',
            input: JSON.stringify(input),
            stdio: 'pipe',
        });
        return { code: 0, stdout };
    } catch (err) {
        return { code: err.status, stdout: err.stdout, stderr: err.stderr };
    }
}

function bashCommand(command) {
    return runHook({ tool_name: 'Bash', tool_input: { command } });
}

function readFile(filePath) {
    return runHook({ tool_name: 'Read', tool_input: { file_path: filePath } });
}

// Commands that merely mention a secret glob as a substring (a jq filter,
// a grep search term, an ordinary source file whose name happens to
// contain "key") must be allowed — they don't read a secret file.
const MUST_ALLOW = [
    'cat package.json | jq .key',
    'grep -rn secret src/',
    'cat package.json | jq .key',
    'rg "api_key" --files-with-matches',
    'cat src/keyboard.ts',
    'cat src/config.ts',
];

for (const cmd of MUST_ALLOW) {
    test(`Bash allowed: ${cmd}`, () => {
        const { code } = bashCommand(cmd);
        assert.equal(code, 0, `expected allowed, got exit ${code}`);
    });
}

// Commands that actually read a secret-looking file must still be blocked.
const MUST_BLOCK = [
    'cat .env',
    'cat ~/.ssh/id_rsa',
    'grep -r . credentials.json',
    'cat config/secrets.yml',
];

for (const cmd of MUST_BLOCK) {
    test(`Bash blocked: ${cmd}`, () => {
        const { code, stderr } = bashCommand(cmd);
        assert.equal(code, 2, `expected blocked, got exit ${code}`);
        assert.match(stderr || '', /secret-guard/);
    });
}

test('Read: secret file path is blocked', () => {
    const { code } = readFile('/repo/.env');
    assert.equal(code, 2);
});

test('Read: ordinary file path is allowed', () => {
    const { code } = readFile('/repo/src/config.ts');
    assert.equal(code, 0);
});

test('Bash: command with no secret-looking tokens at all is allowed', () => {
    const { code } = bashCommand('ls -la src/');
    assert.equal(code, 0);
});

test('Bash: reading a secret through a pipeline is still blocked', () => {
    const { code } = bashCommand('cat .env | grep FOO');
    assert.equal(code, 2);
});
