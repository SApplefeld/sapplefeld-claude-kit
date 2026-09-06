// Tests for plugins/claude-kit/hooks/readonly-agent-guard.js (the read-only
// contract of the kit's judgment agents).
//
// Node's built-in test runner, no framework (Node v24). The guard is spawned as a
// real child process, fed a PreToolUse payload on stdin, and asserted on by its
// exit code: 2 is a deny, 0 is an allow. Both directions are pinned for both
// classes, because each direction has an expensive failure: a guard that traps
// legitimate review work (a base-ref read, a suite run, a scratch write, a grep
// whose pattern contains a governed word) silently degrades every review, and a
// guard that lets a mutation through is the incident it exists to prevent.
//
// Two assertion rules keep a case from passing for the wrong reason. The guard
// fails open, so every allow case also asserts empty stderr: a swallowed
// exception exits 0 too, and a status-only assertion would go green on a broken
// guard. And every heuristic deny case asserts the reason text, so a deny reached
// by misclassifying an operand (a sed script read as a filename) fails here.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentLib = require('../plugins/claude-kit/hooks/kit-agent-identity-lib.js');

const GUARD = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'readonly-agent-guard.js');
const AGENTS = path.join(__dirname, '..', 'plugins', 'claude-kit', 'agents');

// A repo root on the running platform's own root (D:\repo on Windows, /repo on
// POSIX), so path classification is tested with real platform semantics. It holds
// no .git entry, which is the case the guard falls back to cwd for.
const CWD = path.resolve('/repo');
const OUTSIDE = path.resolve('/elsewhere/file');

// This repository and its test directory, for the cases that need a cwd really
// inside a git repo: the root walk and a cd target both touch the filesystem.
const REPO = path.resolve(__dirname, '..');
const REPO_SUBDIR = __dirname;

const STRICT = 'claude-kit:adversarial-reviewer';
const GATE = 'claude-kit:qa-verifier';

// Reason fragments the guard reports, so a deny is pinned to its cause.
const GIT = /a git state change \(git /;
const WRITE = /a write into the tree under review/;
const PATHMUT = /a path mutation in the tree under review/;
const BULK = /a (?:bulk|piped) (?:delete|mutation)/;
const NESTED = /inside a nested shell/;

function runGuard(payload) {
    return spawnSync(process.execPath, [GUARD], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
    });
}

function bash(agentType, command) {
    const p = { tool_name: 'Bash', tool_input: { command }, cwd: CWD };
    if (agentType !== null) p.agent_type = agentType;
    return p;
}

function assertAllowed(agentType, command) {
    const r = runGuard(bash(agentType, command));
    assert.strictEqual(r.stderr, '', `expected no stderr for ${agentType}: ${command}`);
    assert.strictEqual(r.status, 0, `expected allow for ${agentType}: ${command}`);
}

// `reason` is the fragment the denial must name. Omitted only where the case is
// about class resolution rather than about which heuristic fired.
function assertDenied(agentType, command, reason) {
    const r = runGuard(bash(agentType, command));
    assert.strictEqual(r.status, 2, `expected deny for ${agentType}: ${command}`);
    assert.match(r.stderr, /may not change the state under review/);
    if (reason) assert.match(r.stderr, reason, `wrong reason for ${agentType}: ${command}`);
}

function allowAll(agentType, commands) {
    for (const c of commands) assertAllowed(agentType, c);
}

// The same two assertions with an explicit payload cwd.
function assertAllowedAt(cwd, agentType, command) {
    const r = runGuard({ tool_name: 'Bash', agent_type: agentType, cwd, tool_input: { command } });
    assert.strictEqual(r.stderr, '', `expected no stderr at ${cwd}: ${command}`);
    assert.strictEqual(r.status, 0, `expected allow at ${cwd}: ${command}`);
}

function assertDeniedAt(cwd, agentType, command, reason) {
    const r = runGuard({ tool_name: 'Bash', agent_type: agentType, cwd, tool_input: { command } });
    assert.strictEqual(r.status, 2, `expected deny at ${cwd}: ${command}`);
    if (reason) assert.match(r.stderr, reason, `wrong reason at ${cwd}: ${command}`);
}

function denyAll(agentType, cases) {
    for (const [c, reason] of cases) assertDenied(agentType, c, reason);
}

test('all eight judgment agents resolve to the strict class, namespaced or bare', () => {
    for (const t of ['adversarial-reviewer', 'blind-reviewer', 'security-reviewer', 'council-member',
        'design-facilitator', 'consultant', 'blind-reader', 'prose-reviewer',
        'claude-kit:adversarial-reviewer',
        'claude-kit:blind-reviewer', 'claude-kit:security-reviewer', 'claude-kit:council-member',
        'claude-kit:design-facilitator', 'claude-kit:consultant', 'claude-kit:blind-reader',
        'claude-kit:prose-reviewer']) {
        assertDenied(t, 'git commit -m x', GIT);
    }
});

test('a type that merely contains a judgment agent name is not governed', () => {
    allowAll('blind-reviewer-helper', ['git commit -m x']);
    allowAll('my-adversarial-reviewer', ['git commit -m x']);
    allowAll('reviewer', ['git commit -m x']);
    allowAll('consultant-helper', ['git commit -m x']);
    allowAll('my-consultant', ['git commit -m x']);
    allowAll('blind-reader-helper', ['git commit -m x']);
    allowAll('my-prose-reviewer', ['git commit -m x']);
});

// The last case is the one that pins the *class* rather than merely pinning
// that the type is governed at all. Every other command here is denied for the
// gate class too, so a future edit that misfiled `consultant` under 'gate'
// would leave them all green while silently granting in-tree file creation,
// deletion anywhere under a bin/obj/node_modules/.vs/TestResults name at any
// depth, and package installs. `touch` on a fresh path is the discriminator:
// strict denies it, the gate class allows it deliberately for test scaffolding.
test('consultant: git state changes, tree writes, and path mutations are denied', () => {
    denyAll('claude-kit:consultant', [
        ['git commit -m x', GIT],
        ['echo findings > src/notes.md', WRITE],
        ['rm src/a.cs', PATHMUT],
        ['mv src/a.cs src/b.cs', PATHMUT],
        ['touch src/new.cs', PATHMUT],
    ]);
});

test('consultant: reads and scratch writes pass', () => {
    allowAll('claude-kit:consultant', ['git diff main...HEAD', 'git log --oneline -20',
        'rg "denyReason" plugins/', 'echo findings > .kit/consult-notes.md']);
});

test('strict class: git state mutations are denied', () => {
    for (const sub of ['add .', 'am patch', 'apply p.patch', 'cherry-pick abc',
        'checkout main', 'checkout-index -a', 'clean -fd', 'clone https://x/y', 'commit -m x',
        'filter-branch --all', 'gc', 'init', 'merge main', 'mergetool', 'mv a b', 'prune', 'pull',
        'push origin main', 'read-tree HEAD', 'rebase main', 'reset --hard', 'restore src/x',
        'revert abc', 'rm src/x', 'sparse-checkout set src', 'stash',
        'switch main', 'update-index --refresh', 'update-ref refs/heads/x abc']) {
        assertDenied(STRICT, `git ${sub}`, GIT);
    }
});

test('strict class: submodule and bisect deny only their mutating subverbs', () => {
    allowAll(STRICT, ['git submodule status', 'git submodule', 'git submodule summary',
        'git bisect log', 'git bisect view', 'git bisect visualize']);
    for (const cmd of ['git submodule update --init', 'git submodule add https://x/y sub',
        'git submodule deinit sub', 'git submodule sync', 'git submodule set-url sub https://x/z',
        'git bisect start', 'git bisect good', 'git bisect bad HEAD', 'git bisect reset',
        'git bisect run npm test']) {
        assertDenied(STRICT, cmd, /a git (?:submodule|bisect) mutation/);
    }
});

test('a git invocation asking for help is a read', () => {
    allowAll(STRICT, ['git gc --help', 'git commit -h', 'git checkout --help', 'git push --help']);
});

test('a help flag counts only immediately after the subcommand', () => {
    // Anywhere later the token can be an option's value and the command still
    // acts: git stash push -m "-h" stashes, git clean -fd -e -h deletes with -h
    // consumed as the exclude pattern, git commit -am "--help" commits.
    allowAll(STRICT, ['git stash --help', 'git clean --help']);
    denyAll(STRICT, [
        ['git stash push -m "-h"', GIT],
        ['git clean -fd -e -h', GIT],
        ['git commit -am "--help"', GIT],
    ]);
});

test('strict class: git reads are allowed', () => {
    allowAll(STRICT, ['diff', 'diff --stat HEAD~1', 'log -p', 'show HEAD', 'status --porcelain',
        'grep -n foo', 'blame src/x', 'rev-parse HEAD', 'rev-list --count HEAD', 'ls-files',
        'describe --tags', 'shortlog -sn', 'cat-file -p HEAD', 'fetch origin', 'remote -v',
        'config --get user.name', 'symbolic-ref --quiet --short HEAD'].map(s => `git ${s}`));
});

test('strict class: git merge-base is a read, not a merge', () => {
    allowAll(STRICT, ['git merge-base main HEAD', 'git merge-base --fork-point origin/main']);
});

test('strict class: branch, tag, and worktree deny only their mutating forms', () => {
    allowAll(STRICT, ['git branch', 'git branch --list', 'git branch -a', 'git branch -r',
        'git branch --contains abc', 'git tag', 'git tag -l', 'git tag --list',
        'git tag --list "*-sign*"', 'git tag --sort=-creatordate',
        'git worktree list', 'git worktree list --porcelain',
        'git worktree list ../add-review', 'git worktree list ../add', 'git worktree list add']);
    for (const cmd of ['git branch -d old', 'git branch -D old', 'git branch -m a b',
        'git branch --delete old', 'git branch --force main abc', 'git branch --set-upstream-to=origin/x',
        'git tag -d v1', 'git tag -a v1 -m x', 'git tag --delete v1',
        'git worktree add ../wt main', 'git worktree remove ../wt', 'git worktree prune']) {
        assertDenied(STRICT, cmd, /a git (?:branch|tag|worktree) mutation/);
    }
});

test('strict class: global flags between git and the subcommand do not hide a mutation', () => {
    for (const cmd of ['git -C . commit -m x', 'git --no-pager checkout main',
        'git -c user.name=x commit -m y', 'git --git-dir=.git commit -m z',
        'git --git-dir .git reset --hard']) {
        assertDenied(STRICT, cmd, GIT);
    }
    allowAll(STRICT, ['git -C . diff', 'git --no-pager log -p']);
});

test('strict class: a chained mutation behind a read is denied', () => {
    assertDenied(STRICT, 'git diff && git checkout main', GIT);
    assertDenied(STRICT, 'git status; git stash', GIT);
});

test('quoted text is not a command: a governed verb inside an argument is a read', () => {
    allowAll(STRICT, ['rg "git commit" plugins/', 'rg "the git commit flow" docs/',
        "rg 'git push' --glob '*.md'", 'rg "=> handler" src', 'rg -n "IEnumerable<string> items" src/',
        'git log --grep=checkout', 'rg "rm -rf" scripts/', 'rg "Remove-Item" plugins/',
        'echo "run git commit when ready"']);
});

test('a nested shell is judged on what it runs', () => {
    for (const cmd of ['sh -c "git commit -m x"', "bash -c 'rm src/x'",
        'bash -lc "git push origin main"', 'sh -c "echo x > src/file"',
        'eval "git reset --hard"', 'pwsh -Command "Remove-Item src/x"',
        'powershell -NoProfile -Command "Set-Content -Path src/x -Value y"']) {
        assertDenied(STRICT, cmd, NESTED);
    }
    allowAll(STRICT, ['sh -c "git diff"', 'bash -c "node --test test/x.test.js"',
        'bash scripts/verify.sh', 'sh -c "echo x > .kit/report.md"']);
});

test('cmd and iex are nested executors whose quoted payload is analyzed', () => {
    // Quoting the payload is the natural spelling for both (cmd /c "..."), and
    // the mask hides a quoted verb from command position, so only the recursion
    // sees it. The unquoted form keeps the verb in command position and is
    // caught by the outer scan, so both spellings deny.
    denyAll(STRICT, [
        ['cmd /c "git commit -m x"', NESTED],
        ['cmd /c git commit -m x', GIT],
        ['cmd.exe /c "rm README.md"', NESTED],
        ['cmd //c "git commit -m x"', NESTED],
        ['cmd /k "git push origin main"', NESTED],
        ["iex 'git commit -m x'", NESTED],
        ['iex "git push origin main"', NESTED],
        ["Invoke-Expression 'Remove-Item README.md'", NESTED],
    ]);
    allowAll(STRICT, ['cmd /c "git diff"', 'iex "git diff"']);
});

test('strict class: writes into the tree are denied', () => {
    denyAll(STRICT, [
        ['echo x > src/file', WRITE],
        ['echo x >> src/file', WRITE],
        ['echo x > "src/file"', WRITE],
        [`echo x > ${path.join(CWD, 'src', 'file')}`, WRITE],
        ['cat > docs/notes.md <<EOF', WRITE],
        ['node x.js | tee report.md', WRITE],
        ['node x.js | tee -a report.md', WRITE],
        ['node x.js | tee .kit/log src/file', WRITE],
        ["sed -i 's/a/b/' plugins/claude-kit/hooks/x.js", WRITE],
        ["sed -i 's|a|b|' src/x.cs", WRITE],
        ["sed -i 's/a/b/;s/c/d/' src/x.cs", WRITE],
        ["sed -i -e 's/a/b/' -e 's/c/d/' src/x.cs", WRITE],
        ["sed --in-place 's/a/b/' src/x", WRITE],
    ]);
});

test('strict class: a redirect that is not a repo path is allowed', () => {
    allowAll(STRICT, ['node --test test/x.test.js 2>&1 | tail -20', 'dotnet test 2>/dev/null',
        'node x.js > /dev/null', 'node x.js > NUL', 'echo x > .kit/report.md', 'echo x > .kit\\report.md',
        `echo x > ${path.join(CWD, '.kit', 'report.md')}`, `echo x > ${OUTSIDE}`,
        'echo x > $SCRATCH/out.txt', 'echo x > %TEMP%\\out.txt', 'echo x > ~/notes.md',
        'node x.js | tee .kit/log.txt', "sed -n '1,20p' src/x.cs"]);
});

test('the repo root and its ancestors are inside the tree under review', () => {
    denyAll(STRICT, [
        ['rm -rf .', PATHMUT],
        ['rm -rf ./', PATHMUT],
        ['rm -rf ..', PATHMUT],
        ['rm -rf ../..', PATHMUT],
        [`rm -rf ${CWD}`, PATHMUT],
        ['Remove-Item -Recurse -Force .', PATHMUT],
        ['Remove-Item -Recurse -Force ..', PATHMUT],
    ]);
    allowAll(STRICT, [`rm -rf ${OUTSIDE}`, `rm -rf ${path.resolve('/elsewhere')}`]);
});

test('strict class: a move deletes its source, so both operands count', () => {
    denyAll(STRICT, [
        ['mv src/tracked.cs .kit/keep.cs', PATHMUT],
        ['mv src/tracked.cs /elsewhere/keep.cs', PATHMUT],
        ['mv src/a src/b', PATHMUT],
        ['Move-Item src/a.txt .kit/a.txt', PATHMUT],
        ['Rename-Item src/a.js b.js', PATHMUT],
    ]);
    // A copy leaves its source in place, so only the destination counts.
    allowAll(STRICT, ['cp plugins/claude-kit/hooks/x.js .kit/x.js',
        'Copy-Item -Path src/a.txt -Destination .kit/a.txt', 'Copy-Item src/a.txt .kit/a.txt',
        `cp src/a.txt ${OUTSIDE}`]);
});

test('strict class: file mutation commands are denied in the tree, allowed into .kit/', () => {
    denyAll(STRICT, [
        ['rm src/x', PATHMUT],
        ['rm -rf obj', PATHMUT],
        ['rmdir src/empty', PATHMUT],
        ['touch src/x.cs', PATHMUT],
        ['chmod +x scripts/run.sh', PATHMUT],
        ['cp plugins/claude-kit/hooks/x.js plugins/claude-kit/hooks/y.js', PATHMUT],
    ]);
    allowAll(STRICT, ['rm -rf .kit/tmp', `rm ${OUTSIDE}`, `chmod 755 ${OUTSIDE}`, 'ls -la src',
        'cat src/x', 'rg pattern plugins/']);
});

test('bulk delete idioms are denied for both classes', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['find . -name "*.js" -delete', BULK],
            ['find src -type f -delete', BULK],
            ['find . -name "*.cs" -exec sed -i "s/a/b/" {} +', BULK],
            ['find . -type f -exec rm {} \\;', BULK],
            ['find . -type d -execdir rmdir {} \\;', BULK],
            ['git ls-files | xargs rm', BULK],
            ['git ls-files | xargs -n 1 rm', BULK],
            ['rg -l foo | xargs sed -i "s/a/b/"', BULK],
            // A git verb piped through xargs is still in command position, so the
            // git heuristic names this one first.
            ['git ls-files | xargs git rm', GIT],
        ]);
        allowAll(agent, ['find . -name "*.js" -print', 'find src -type f | head -5',
            'git ls-files | xargs grep -l TODO', 'rg -l foo | xargs wc -l']);
    }
});

test('a lockfile-rewriting install is denied to both classes; npm ci is the gate-runner\'s', () => {
    for (const agent of [STRICT, GATE]) {
        for (const cmd of ['npm install', 'npm install --save-dev x', 'pnpm add x',
            'yarn install', 'npm update', 'npm --prefix . install', 'npm -C . install']) {
            assertDenied(agent, cmd, /a package-manager mutation/);
        }
        allowAll(agent, ['npm test', 'npm run test', 'npm run build', 'pnpm test',
            'node --test test/x.test.js', 'dotnet build', 'dotnet test', 'prettier --check .']);
    }
    assertDenied(STRICT, 'npm ci', /a package-manager mutation \(npm ci\)/);
    assertAllowed(GATE, 'npm ci');
});

test('package-manager verb aliases and bare installs carry the same policy', () => {
    for (const agent of [STRICT, GATE]) {
        // npm i is the most common spelling of install; yarn 1 and pnpm install
        // when run with no verb at all.
        for (const cmd of ['npm i', 'npm i lodash', 'npm in x', 'npm ins x', 'npm inst x',
            'npm up', 'npm upgrade', 'pnpm i', 'pnpm up', 'yarn add x', 'yarn up x',
            'yarn', 'pnpm', 'yarn --frozen-lockfile']) {
            assertDenied(agent, cmd, /a package-manager mutation/);
        }
        allowAll(agent, ['yarn --version', 'pnpm -v', 'npm view lodash', 'npm ls']);
    }
});

test('formatters are denied for both classes', () => {
    for (const agent of [STRICT, GATE]) {
        for (const cmd of ['dotnet format', 'dotnet format --severity warn', 'prettier -w src',
            'prettier --write .']) {
            assertDenied(agent, cmd, /a formatter run/);
        }
        allowAll(agent, ['dotnet build', 'dotnet test', 'prettier --check .']);
    }
});

test('formatter package scripts are denied; check-only formatter passes are not', () => {
    for (const agent of [STRICT, GATE]) {
        for (const cmd of ['npm run format', 'npm run fmt', 'npm run lint:fix',
            'npm run lint -- --fix', 'pnpm run format', 'yarn run fmt']) {
            assertDenied(agent, cmd, /a formatter run/);
        }
        // A lint that only checks stays open, and so does a check-only
        // dotnet format: both are legitimate gate steps that write nothing.
        allowAll(agent, ['npm run lint', 'npm run format:check',
            'dotnet format --verify-no-changes', 'dotnet format --check',
            'dotnet format --verify-no-changes --severity warn']);
    }
});

test('GitHub state mutations are denied for both classes', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['gh pr merge 1', /a pull-request mutation \(gh pr merge\)/],
            ['gh pr close 1', /a pull-request mutation/],
            ['gh pr edit 1 --title x', /a pull-request mutation/],
            ['gh pr comment 1 --body x', /a pull-request mutation/],
            ['gh pr review 1 --approve', /a pull-request mutation/],
            ['gh pr ready 1', /a pull-request mutation/],
            ['gh release create v1', /a release mutation/],
            ['gh api -X POST /repos/x/y/issues', /a write API call \(gh api POST\)/],
            ['gh api --method DELETE /repos/x/y/git/refs/heads/z', /a write API call \(gh api DELETE\)/],
        ]);
        allowAll(agent, ['gh pr view 1', 'gh pr diff 1', 'gh pr list', 'gh pr list --search "merge"',
            'gh run list', 'gh api /repos/x/y/pulls/1', 'gh api -X GET /repos/x/y']);
    }
});

test('a gh flag value does not shift the command group out of view', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['gh -R owner/name pr merge 1', /a pull-request mutation \(gh pr merge\)/],
            ['gh --repo owner/name pr merge 1', /a pull-request mutation/],
            ['gh --hostname github.example.com pr close 1', /a pull-request mutation/],
            ['gh -R owner/name release create v1', /a release mutation/],
            ['gh api -XPOST /repos/x/y', /a write API call \(gh api POST\)/],
            ['gh api -X=POST /repos/x/y', /a write API call \(gh api POST\)/],
            ['gh -R owner/name api -X PATCH /repos/x/y', /a write API call \(gh api PATCH\)/],
        ]);
        allowAll(agent, ['gh -R owner/name pr view 1', 'gh --repo owner/name pr diff 1',
            'gh pr list --json number,title', 'gh -R owner/name api -XGET /repos/x/y']);
    }
});

test('gh api with a field flag and no explicit method is a write (POST is its default)', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['gh api repos/o/r/issues/1/comments -f body=hi', /a write API call/],
            ['gh api repos/o/r -F key=1', /a write API call/],
            ['gh api repos/o/r --field key=1', /a write API call/],
            ['gh api repos/o/r --raw-field key=1', /a write API call/],
            ['gh api repos/o/r --input body.json', /a write API call/],
        ]);
        allowAll(agent, ['gh api repos/o/r', 'gh api -X GET repos/o/r -f q=1',
            'gh api --method GET repos/o/r --field per_page=100']);
    }
});

test('outward gh verbs beyond pr and release are denied for both classes', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['gh repo delete o/r --yes', /a repository mutation \(gh repo delete\)/],
            ['gh repo edit o/r --visibility private', /a repository mutation/],
            ['gh repo rename newname', /a repository mutation/],
            ['gh repo archive o/r', /a repository mutation/],
            ['gh workflow run ci.yml', /a workflow mutation \(gh workflow run\)/],
            ['gh workflow enable ci.yml', /a workflow mutation/],
            ['gh workflow disable ci.yml', /a workflow mutation/],
            ['gh secret set TOKEN', /a secret mutation \(gh secret set\)/],
            ['gh secret delete TOKEN', /a secret mutation/],
            ['gh variable set NAME', /a variable mutation/],
            ['gh variable delete NAME', /a variable mutation/],
            ['gh issue close 1', /an issue mutation \(gh issue close\)/],
            ['gh issue edit 1 --title x', /an issue mutation/],
            ['gh issue comment 1 --body x', /an issue mutation/],
            ['gh issue delete 1', /an issue mutation/],
        ]);
        allowAll(agent, ['gh repo view o/r', 'gh workflow list', 'gh workflow view ci.yml',
            'gh secret list', 'gh variable list', 'gh issue list', 'gh issue view 1']);
    }
});

test('strict class: PowerShell writers into the tree are denied', () => {
    denyAll(STRICT, [
        ['Set-Content -Path src/file -Value x', PATHMUT],
        ['Out-File -FilePath src\\file', PATHMUT],
        ['Out-File -Encoding utf8 src/file', PATHMUT],
        ['Add-Content src/file "text"', PATHMUT],
        ['Clear-Content src/x.js', PATHMUT],
        ['node x.js | Tee-Object -FilePath src/log.txt', PATHMUT],
        ['Remove-Item src/file', PATHMUT],
        ['Remove-Item src', PATHMUT],
        ['Remove-Item -Force -Recurse src/dir', PATHMUT],
        ['Remove-Item -Recurse -Force test', PATHMUT],
        ['New-Item -Path src/file -ItemType File', PATHMUT],
        ['Copy-Item a.txt src/b.txt', PATHMUT],
        ['Copy-Item -Path .kit/a.txt -Destination src/b.txt', PATHMUT],
    ]);
});

test('strict class: the PowerShell aliases carry the same policy as their cmdlets', () => {
    denyAll(STRICT, [
        ['ri -Recurse -Force plugins', PATHMUT],
        ['del plugins\\claude-kit\\hooks\\x.js', PATHMUT],
        ['erase src/x.js', PATHMUT],
        ['rd src/empty', PATHMUT],
        ['mi src/a src/b', PATHMUT],
        ['move src/a src/b', PATHMUT],
        ['ren src/a.js b.js', PATHMUT],
        ['rni src/a.js b.js', PATHMUT],
        ['ac -Path src/file -Value x', PATHMUT],
        ['clc src/file', PATHMUT],
        ['ni -Path src/file -ItemType File', PATHMUT],
        ['cpi a.txt src/b.txt', PATHMUT],
        ['copy a.txt src/b.txt', PATHMUT],
    ]);
    allowAll(STRICT, ['ri .kit/tmp', `del ${OUTSIDE}`, 'cpi src/a.txt .kit/a.txt',
        'ac -Path .kit/log.md -Value x']);
});

test('a PowerShell pipeline into a destructive cmdlet is a bulk mutation', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['Get-ChildItem plugins -Recurse | Remove-Item', BULK],
            ['gci -Recurse | Remove-Item -Force', BULK],
            ['Get-ChildItem src | ri -Force', BULK],
            ['Get-ChildItem src | Rename-Item -NewName x', BULK],
        ]);
        allowAll(agent, ['Get-ChildItem plugins -Recurse', 'Get-ChildItem src | Select-Object Name',
            'Get-ChildItem src | Measure-Object']);
    }
});

test('strict class: PowerShell writers outside the tree are allowed', () => {
    allowAll(STRICT, ['Set-Content -Path .kit/report.md -Value x', `Out-File -FilePath ${OUTSIDE}`,
        `Out-File -Encoding utf8 ${OUTSIDE}`, `Remove-Item ${OUTSIDE}`, 'Remove-Item .kit/tmp',
        'Get-Content src/file', 'Select-String -Pattern x -Path src/*']);
});

test('gate-runner: builds, suites, and its own output are allowed', () => {
    allowAll(GATE, ['dotnet build', 'dotnet test', 'npm test', 'npm ci',
        'rm -rf obj', 'rm -rf bin obj', 'rm -rf node_modules', 'rm -rf TestResults',
        'Remove-Item -Recurse -Force obj', 'touch src/x.cs', 'cp src/a src/b',
        'New-Item -Path src/fixture.json -ItemType File',
        'dotnet test --logger trx 2>&1 | tail -40', 'echo x > .kit/qa.md',
        'dotnet build > obj/build.log', 'dotnet test > TestResults/run.txt',
        'Out-File -FilePath obj/build.log']);
});

test('the build-output allowance is the gate-runner class alone', () => {
    denyAll(STRICT, [
        ['dotnet build > obj/build.log', WRITE],
        ['rm -rf obj', PATHMUT],
    ]);
});

test('the gate-runner may create but not overwrite', () => {
    // cp overwrites an existing destination by default, and -Force truncates
    // whatever the target holds, so the creating allowance stops where content
    // would be destroyed. README.md exists at the repo root.
    assertDeniedAt(REPO, GATE, 'cp .kit/x.md README.md', PATHMUT);
    assertDeniedAt(REPO, GATE, 'Copy-Item .kit/a.txt README.md', PATHMUT);
    assertDenied(GATE, 'New-Item -Path README.md -Force -ItemType File', PATHMUT);
    assertDenied(GATE, 'Copy-Item -Path .kit/a.txt -Destination src/b.txt -Force', PATHMUT);
    // A new file, a no-clobber copy, and scratch stay the gate-runner's.
    assertAllowedAt(REPO, GATE, 'cp .kit/x.md .kit/y.md');
    assertAllowedAt(REPO, GATE, 'cp -n .kit/x.md README.md');
    assertAllowedAt(REPO, GATE, 'cp .kit/x.md no-such-file-here.md');
    assertAllowedAt(REPO, GATE, 'New-Item -Path no-such-file-here.json -ItemType File');
});

test('gate-runner: destroying tracked content and changing git state are denied', () => {
    denyAll(GATE, [
        ['git commit -m x', GIT],
        ['git checkout main', GIT],
        ['git stash', GIT],
        ['git branch -D old', /a git branch mutation/],
        ['echo x > src/file', WRITE],
        ["sed -i 's/a/b/' src/x", WRITE],
        ['node x.js | tee src/log.txt', WRITE],
        ['Set-Content -Path src/file -Value x', PATHMUT],
        ['rm -rf src', PATHMUT],
        ['rm src/x.cs', PATHMUT],
        ['mv src/a src/b', PATHMUT],
        ['Remove-Item -Recurse -Force src', PATHMUT],
        ['Rename-Item src/a.js b.js', PATHMUT],
        ['rm -rf .', PATHMUT],
        ['sh -c "git commit -m x"', NESTED],
    ]);
});

test('containment is judged against the git root, not the payload cwd', () => {
    // The payload cwd is a real subdirectory of a real git repo, so the root walk
    // finds the repo above it and a relative path back out stays in the tree.
    assertDeniedAt(REPO_SUBDIR, STRICT, 'rm ../README.md', PATHMUT);
    assertDeniedAt(REPO_SUBDIR, STRICT, 'rm ../plugins/claude-kit/hooks/docs-write-guard.js', PATHMUT);
    assertDeniedAt(REPO_SUBDIR, STRICT, 'sed -i s/a/b/ ../plugins/claude-kit/hooks/docs-write-guard.js', WRITE);
    assertDeniedAt(REPO_SUBDIR, STRICT, `rm ${path.join(REPO, 'README.md')}`, PATHMUT);
    assertDeniedAt(REPO_SUBDIR, STRICT, 'rm x.log', PATHMUT);
    assertAllowedAt(REPO_SUBDIR, STRICT, 'rm ../.kit/scratch.md');
    assertAllowedAt(REPO_SUBDIR, STRICT, `rm ${OUTSIDE}`);
    assertAllowedAt(REPO_SUBDIR, STRICT, 'git diff -- ../plugins');
});

// Drive-letter spellings exist only where paths carry a drive letter.
test('alternate absolute spellings of an in-tree path are the same path', { skip: !/^[A-Za-z]:\\/.test(REPO) }, () => {
    // The Git-Bash form /<drive>/<rest> is what pwd prints inside the Bash
    // tool, so it names in-tree files with no evasive intent; the \\?\ prefix
    // is the extended-length spelling of the same drive path.
    const gitBash = `/${REPO[0].toLowerCase()}${REPO.slice(2).replace(/\\/g, '/')}/README.md`;
    assertDeniedAt(REPO, STRICT, `rm ${gitBash}`, PATHMUT);
    assertDeniedAt(REPO, STRICT, `Remove-Item \\\\?\\${path.join(REPO, 'README.md')}`, PATHMUT);
    // An 8.3 short name and a UNC share spelling of an in-tree path are
    // accepted misses: placing them needs filesystem round-trips.
    assertAllowedAt(REPO, STRICT, `rm \\\\localhost\\${REPO[0].toLowerCase()}\\README.md`);
});

test('a directory switch inside the command moves the base for relative operands', () => {
    assertDeniedAt(REPO, STRICT, 'cd test && rm ../README.md', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'cd .kit && rm ../README.md', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'cd test && echo x > ../README.md', WRITE);
    assertDeniedAt(REPO, STRICT, 'pushd test; rm ../README.md', PATHMUT);
    // .kit/ is writable from anywhere. A switch target routed through a
    // variable falls back to the payload cwd, from which ../README.md resolves
    // outside the tree, so the allow below is the operand's own placement
    // rather than a disarmed check.
    assertAllowedAt(REPO, STRICT, 'cd test && echo x > ../.kit/report.md');
    assertAllowedAt(REPO, STRICT, 'cd $TARGET && rm ../README.md');
});

test('a literal switch target that does not resolve still gets the path check', () => {
    // A failed literal cd cannot move the shell out of the tree: with ; the
    // shell does not move at all, and with && an earlier command in the chain
    // may create the directory before the switch runs, so both candidate bases
    // are judged instead of skipping the containment check. A target the guard
    // cannot read at all falls back to the payload cwd rather than skipping it.
    assertDeniedAt(REPO, STRICT, 'mkdir -p tmp && cd tmp && rm ../README.md', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'cd nosuchdir; rm README.md', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'cd nosuchdir; echo x > README.md', WRITE);
    assertDeniedAt(REPO, STRICT, 'cd no-such-directory && rm ../README.md', PATHMUT);
    assertDeniedAt(REPO, GATE, 'cd bin; rm -rf ../plugins', PATHMUT);
});

test('a governed command keeps its identity when pathed, suffixed, or escaped', () => {
    denyAll(STRICT, [
        ['\\git commit -m x', GIT],
        ['/usr/bin/git commit -m x', GIT],
        ['git.exe commit -m x', GIT],
        ['./node_modules/.bin/prettier --write .', /a formatter run/],
        ['dotnet-format', /a formatter run/],
        ['/bin/rm -rf src', PATHMUT],
        ['/bin/sh -c "git commit -m x"', NESTED],
    ]);
    // A verb split by quoting or assembled through a variable stays allowed, as
    // the accepted-misses comment records.
    allowAll(STRICT, ['"git" commit -m x', "g'i't commit -m x", 'git${IFS}commit',
        '/usr/bin/git diff', 'git.exe log -p']);
});

test('escaped quotes do not hide a mutation', () => {
    denyAll(STRICT, [
        ['sh -c "sh -c \\"git commit\\""', NESTED],
        ['echo \\" ; git commit -m x', GIT],
        ['echo \\"quoted\\" && rm src/x', PATHMUT],
    ]);
});

test('a top-level backslash escapes any character, the single quote included', () => {
    // Bash reads a top-level \' as a literal quote; a masker that only honors
    // " \ $ ` there opens a phantom span that blanks the rest of the command
    // while the shell runs it.
    denyAll(STRICT, [
        [String.raw`echo \' ; git commit -m x`, GIT],
        [String.raw`echo \' && rm -rf plugins`, PATHMUT],
        [String.raw`echo \' ; rm -rf .`, PATHMUT],
    ]);
    // Inside a double-quoted span only " \ $ ` are escapable, so a Windows
    // separator survives the quoting and the operand still classifies in-tree.
    assertDenied(STRICT, String.raw`Set-Content -Path "src\file" -Value x`, PATHMUT);
});

test('a nested executor beyond a shell is judged the same way', () => {
    denyAll(STRICT, [
        ['claude -p "git commit -m x"', NESTED],
        ['claude --print "rm -rf src"', NESTED],
        ['bash <<< "git commit -m x"', NESTED],
        ['pwsh -EncodedCommand ZwBpAHQA', /an encoded command/],
        ['powershell -enc ZwBpAHQA', /an encoded command/],
    ]);
    allowAll(STRICT, ['claude -p "review the diff and report"', 'bash <<< "git diff"']);
});

test('a >| redirect is still a redirect', () => {
    assertDenied(STRICT, 'echo x >| plugins/x.js', WRITE);
    assertAllowed(STRICT, 'echo x >| .kit/report.md');
});

test('truncate empties a file, so it is a destructive command', () => {
    for (const agent of [STRICT, GATE]) {
        assertDenied(agent, 'truncate -s 0 plugins/x.js', PATHMUT);
        assertAllowed(agent, 'truncate -s 0 .kit/log.txt');
    }
});

test('the gate-runner allowance covers no commonly tracked directory', () => {
    denyAll(GATE, [
        ['rm -rf dist', PATHMUT],
        ['rm -rf coverage', PATHMUT],
        ['rm -rf docs', PATHMUT],
        ['rm package-lock.json', PATHMUT],
    ]);
    allowAll(GATE, ['rm -rf bin', 'rm -rf obj', 'rm -rf .vs', 'rm -rf TestResults', 'rm -rf node_modules']);
});

test('ungoverned agent types allow a command a strict agent is denied', () => {
    for (const t of ['claude-kit:implementer-opus', 'claude-kit:implementer-sonnet', 'claude',
        'claude-kit:docs-curator', 'general-purpose', 'Explore', 'some-unknown-type']) {
        assertAllowed(t, 'git commit -m x');
    }
});

test('an absent agent type allows (main session)', () => {
    assertAllowed(null, 'git commit -m x');
});

test('unparseable payload fails open', () => {
    const r = spawnSync(process.execPath, [GUARD], { input: 'not json', encoding: 'utf8' });
    assert.strictEqual(r.stderr, '');
    assert.strictEqual(r.status, 0);
});

test('a payload with no command fails open', () => {
    const r = runGuard({ tool_name: 'Bash', agent_type: STRICT, cwd: CWD, tool_input: {} });
    assert.strictEqual(r.stderr, '');
    assert.strictEqual(r.status, 0);
});

test('a payload with no cwd keeps the path-independent heuristics only', () => {
    const noCwd = command => runGuard({ tool_name: 'Bash', agent_type: STRICT, tool_input: { command } });
    const reasons = [
        ['git commit -m x', GIT],
        ['gh pr merge 1', /a pull-request mutation \(gh pr merge\)/],
        ['dotnet format', /a formatter run/],
        ['npm install', /a package-manager mutation/],
    ];
    for (const [command, reason] of reasons) {
        const r = noCwd(command);
        assert.strictEqual(r.status, 2, `expected deny without a cwd: ${command}`);
        assert.match(r.stderr, reason, `wrong reason without a cwd: ${command}`);
    }
    for (const command of ['echo x > src/file', 'rm -rf src']) {
        const r = noCwd(command);
        assert.strictEqual(r.stderr, '', `expected no stderr without a cwd: ${command}`);
        assert.strictEqual(r.status, 0, `a path cannot be placed without a cwd: ${command}`);
    }
});

test('camelCase and subagent_type identity fields resolve too', () => {
    for (const field of ['agentType', 'subagent_type', 'subagentType']) {
        const p = { tool_name: 'Bash', cwd: CWD, tool_input: { command: 'git commit -m x' } };
        p[field] = STRICT;
        assert.strictEqual(runGuard(p).status, 2, `expected deny via ${field}`);
    }
});

test('a git alias defined on the command line denies, since the real subcommand sits in the value', () => {
    // git runs an alias as its subcommand, so `-c alias.<name>=<value>` moves the
    // invocation's real verb out of the token this scan reads and into a config
    // value: `git -c alias.x='!git push' x` pushes, and the payload need not even
    // be a shell escape, since the bare `alias.p=push` spelling reaches the same
    // verb. The value is data to the shell and a command to git, which is why the
    // quote mask correctly treats it as data and why that alone cannot bound it.
    for (const cmd of [
        "git -c alias.x='!git push' x",
        "git -c alias.d='!rm -rf src' d",
        'git -c alias.p=push p',
        "git --config-env=alias.x=EVIL x",
    ]) {
        const r = runGuard(bash(STRICT, cmd));
        assert.strictEqual(r.status, 2, `expected deny for ${cmd}`);
        assert.match(r.stderr, /git alias/, `expected the alias reason for ${cmd}`);
    }
    // The condition is the alias key, so an ordinary -c assignment still allows and
    // the case cannot pass by denying every -c invocation. Both are read commands
    // whose config value merely contains a word that also names a subcommand, which
    // is the false denial the quote mask removed and must stay removed.
    for (const cmd of [
        "git -c core.pager='less push' log",
        "git --git-dir='x push' status",
    ]) {
        assert.strictEqual(runGuard(bash(STRICT, cmd)).status, 0, `expected allow for ${cmd}`);
    }
});

test('the denial names the agent and the correct moves', () => {
    const r = runGuard(bash(STRICT, 'git checkout main'));
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /claude-kit:adversarial-reviewer/);
    assert.match(r.stderr, /a git state change \(git checkout\)/);
    assert.match(r.stderr, /final message/);
    assert.match(r.stderr, /\.kit\//);
    assert.match(r.stderr, /orchestrator/);
});

test('a deny reason ships no sentinel bytes: an unresolvable target is named, not dumped', () => {
    // A destructive command's operand that is entirely a substitution span rides
    // through the segment as the guard's sentinel bytes, and a reason that
    // interpolates them verbatim hands the agent raw control characters where
    // the shell saw $(...) text. The deny stands; the reason names the span as
    // the unresolved substitution it is.
    const r = runGuard(bash(STRICT, 'rm $(mktemp)'));
    assert.strictEqual(r.status, 2, 'expected deny for rm $(mktemp)');
    assert.ok(!/[\x00-\x08\x0b-\x1f]/.test(r.stderr), 'the reason must carry no raw control bytes');
    assert.match(r.stderr, /unresolved substitution/);
});

test('the encoded-command flag is a PowerShell spelling, not bash flag bundling', () => {
    // -ec is how bash bundles -e -c, so the check is scoped to a PowerShell
    // invocation. A bundled bash payload is still judged on what it runs.
    allowAll(STRICT, ["bash -ec 'git diff | head'", "sh -ec 'rg foo src'", 'bash -e -c "git log"']);
    denyAll(STRICT, [
        ['pwsh -EncodedCommand aGk=', /an encoded command/],
        ['powershell -enc aGk=', /an encoded command/],
        ['pwsh -ec aGk=', /an encoded command/],
        ["bash -ec 'git commit -m x'", NESTED],
    ]);
});

test('a newline ends a command, so the next line is not an operand of this one', () => {
    // Without the line break in the segment cut, the gate class's canonical clean
    // reads "dotnet" as an operand of rm, and a strict agent tidying its own
    // scratch reads "rg" the same way. Both are routine, so the over-block would
    // land on day one.
    allowAll(GATE, ['rm -rf obj\ndotnet build', 'rm -rf bin\r\ndotnet test']);
    allowAll(STRICT, ['rm .kit/tmp.md\nrg pattern plugins/', 'cat src/a\nls src']);
    // A mutation on any line is still caught.
    denyAll(STRICT, [
        ['git log\ngit checkout main', GIT],
        ['rg foo src\nrm src/x.cs', PATHMUT],
    ]);
});

test('naming a ref to create is a mutation, filtering on one is a read', () => {
    denyAll(STRICT, [
        ['git branch scratch-branch', /a git branch creation/],
        ['git branch feature/x main', /a git branch creation/],
        ['git tag v9.9.9', /a git tag creation/],
        ['git tag -u KEYID v1', /a git tag mutation/],
    ]);
    allowAll(STRICT, ['git branch', 'git branch --list', 'git branch -a', 'git branch -r',
        'git branch -v', 'git branch --contains abc', 'git branch --merged main',
        'git branch --points-at HEAD', 'git branch --sort=-committerdate',
        'git tag', 'git tag -l', 'git tag --list "v*"', 'git tag --contains abc',
        'git tag --points-at HEAD', 'git tag --sort=-creatordate']);
});

test('the modern bisect aliases mutate like the ones they replace', () => {
    denyAll(STRICT, [
        ['git bisect new', /a git bisect mutation/],
        ['git bisect old', /a git bisect mutation/],
    ]);
    allowAll(STRICT, ['git bisect log', 'git bisect view', 'git bisect terms']);
});

test('the dotnet project mutators are package mutations for both classes', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            ['dotnet add package Newtonsoft.Json', /a package-manager mutation \(dotnet add\)/],
            ['dotnet remove package Foo', /a package-manager mutation \(dotnet remove\)/],
            ['dotnet new classlib -o src/Foo', /a package-manager mutation \(dotnet new\)/],
        ]);
        allowAll(agent, ['dotnet build', 'dotnet test', 'dotnet restore', 'dotnet --version']);
    }
});

test('a writable directory counts at any depth, not only at the repo root', () => {
    // .kit/ is gitignored wherever it sits, and a solution's build output lives at
    // src/<project>/obj as readily as at obj.
    assertAllowedAt(REPO_SUBDIR, STRICT, 'echo x > .kit/notes.md');
    allowAll(STRICT, ['echo x > src/Foo/.kit/notes.md']);
    allowAll(GATE, ['rm -rf src/Foo/obj', 'rm -rf src/Foo/bin', 'echo x > src/Foo/obj/build.log']);
    // The allowance is still scoped to those names.
    denyAll(GATE, [['rm -rf src/Foo/Models', PATHMUT]]);
    denyAll(STRICT, [['rm -rf src/Foo/obj', PATHMUT]]);
});

test('cp reads its destination from -t when the invocation carries one', () => {
    allowAll(STRICT, ['cp -t .kit src/a.cs', 'cp --target-directory=.kit src/a.cs',
        'cp src/a.cs .kit/a.cs']);
    denyAll(STRICT, [
        ['cp -t src/Models .kit/a.cs', PATHMUT],
        ['cp --target-directory=src .kit/a.cs', PATHMUT],
    ]);
});

test('the governed agents are granted no file-writing tool', () => {
    for (const name of ['adversarial-reviewer', 'blind-reviewer', 'security-reviewer',
        'council-member', 'design-facilitator', 'consultant', 'qa-verifier',
        'blind-reader', 'prose-reviewer']) {
        const text = fs.readFileSync(path.join(AGENTS, `${name}.md`), 'utf8');
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        assert.ok(fm, `${name}.md has no frontmatter`);
        const line = /^tools:[ \t]*(.+)$/m.exec(fm[1]);
        assert.ok(line, `${name}.md declares no tools list`);
        const granted = line[1].split(',').map(s => s.trim());
        // NotebookEdit belongs in this list for the same reason the other three
        // do: hooks.json matches the guard on Bash and PowerShell only, so any
        // file-writing tool granted here writes outside the guard's scope
        // entirely and the shell denylist never sees it.
        for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
            assert.ok(!granted.includes(tool), `${name}.md grants ${tool}, so the guard's shell-only scope no longer covers it`);
        }
    }
});

// These agents' effort is a literal committed skills cite as load-bearing:
// executing-work's reviewer-effort table names each per-section reviewer's
// frontmatter effort as what keeps its fable dispatch off the Workflow route
// (low for the code and document pairs, medium for the security reviewer),
// and the consult skill says the same of the consultant at high. Reverting one
// of these lines would leave the whole suite green while the gate silently
// moved a notch and the skills asserted a value no longer true, which is the
// same gap the third doctrine-parity test closes for the doctrine's own grant.
test('the reviewers and the consultant pin the effort the skills cite as their frontmatter default', () => {
    const pinned = { 'adversarial-reviewer': 'low', 'blind-reviewer': 'low', 'blind-reader': 'low', 'prose-reviewer': 'low', 'security-reviewer': 'medium', consultant: 'high' };
    for (const [name, effort] of Object.entries(pinned)) {
        const text = fs.readFileSync(path.join(AGENTS, `${name}.md`), 'utf8');
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        assert.ok(fm, `${name}.md has no frontmatter`);
        const line = /^effort:[ \t]*(\S+)[ \t]*$/m.exec(fm[1]);
        assert.ok(line, `${name}.md declares no effort, so it inherits the session's and the `
            + 'skills\' "frontmatter default" claim is no longer true of it');
        assert.strictEqual(line[1], effort, `${name}.md pins effort ${line[1]}, but `
            + `the dispatching skills name \`${effort}\` as this agent's `
            + 'frontmatter default; change the skills too, or restore the pin');
    }
});

// A command or process substitution inside a double-quoted span is live code the
// shell runs, not data, so it is scanned exactly as the unquoted spelling is. The
// whole-span mask would otherwise blank it and let a mutation ride through inside
// quotes.
test('a substitution inside double quotes is scanned as live code, not masked', () => {
    denyAll(STRICT, [
        ['echo "$(git commit -m x)"', GIT],
        ['echo $(git commit -m x)', GIT],
        ['echo "wrapped $(git push origin main) here"', GIT],
        ['echo "`git commit -m x`"', GIT],
        ['echo "$(rm -rf src)"', PATHMUT],
        ['printf "%s" "$(gh pr merge 1)"', /a pull-request mutation/],
    ]);
    // A read inside the substitution stays a read, and a substitution-free quoted
    // argument is still literal text.
    allowAll(STRICT, ['echo "$(git diff)"', 'echo "$(git log --oneline -5)"',
        'echo "run git commit when ready"', 'rg "git push" docs/']);
});

// The interior of a double-quoted substitution is scanned as its own command, but
// the SPAN it sits in stays blanked in the copy the segmenter cuts on, so a `)`
// closing a substitution nested in an operand does not truncate the operand list.
// Every one of these denies at the base ref, allows on the pre-fix round-3
// worktree, and denies again after the fix.
test('a substitution in an operand does not truncate the scan at its closing paren', () => {
    denyAll(STRICT, [
        ['git -C "$(pwd)" commit -m x', GIT],
        ['gh -R "$(echo o/n)" pr merge 1 --squash', /a pull-request mutation/],
        ['sh -c "$(true) git commit -m y"', GIT],
        ['npm --prefix "$(pwd)" install lodash', /a package-manager mutation/],
        ['cp "$(echo /tmp/a)" README.md', PATHMUT],
    ]);
});

// The substitution scan matches only what bash actually runs inside double quotes.
// A process substitution <( is a literal string there. A $(( opener is arithmetic
// only where the span is confidently one parenthesized group, its inner ( matching
// the ) before the outer close, so echo "$((1 > 2))" runs no command and passes,
// while echo "$((git push) )", whose inner ( closes before that outer ) because a
// space splits the two, holds more than one thing inside $(...) and bash reparses
// it as a command substitution wrapping a subshell, so it is scanned and denies. A
// governed verb inside a nested quoted phrase is data the inner command prints, so
// scanning it is a false deny on text no shell runs.
test('the substitution scan follows bash: <( is literal, $(( arithmetic is one parenthesized group, inner quotes re-mask', () => {
    allowAll(STRICT, [
        'echo "cmp: diff <(git stash list) f"',
        'echo "$((1 > 2))"',
        'echo "$(( (1 + 2) * 3 ))"',
        "echo \"$(printf %s 'run git commit later')\"",
    ]);
    // The live spellings still deny, matching the unquoted form. The doubled-paren
    // bash runs as a command substitution denies with them, and a write hidden the
    // same way denies on its target rather than passing as arithmetic.
    denyAll(STRICT, [
        ['echo "$(git commit -m x)"', GIT],
        ['cat <(git commit -m x)', GIT],
        ['echo "$((git push) )"', GIT],
        ['echo "$((echo x > README.md) )"', WRITE],
    ]);
});

// A raw control character other than tab or newline has no place in a governed
// command, and the guard's own masking sentinels (NUL and \x01) are control
// characters, so an input carrying one could forge a sentinel and truncate an
// operand list where the shell reads no boundary. rm <0x01> README.md removes the
// file in a real shell while the segmenter, whose separator set holds \x01, cuts the
// operand list at the byte. A bare carriage return is the same primitive: bash reads
// it as an ordinary word character, so rm <CR>README.md removes the file while a
// segmenter cutting on \r drops the operand. Both are refused at the boundary. A
// CRLF between two commands is a line break, normalized to a newline, so it passes.
test('a raw control character, a bare carriage return among them, is rejected at the boundary', () => {
    assertDenied(STRICT, 'rm \x01 README.md', /a control character/);
    assertDenied(STRICT, 'rm \x00 README.md', /a control character/);
    assertDenied(GATE, 'echo x\x01 > .kit/o', /a control character/);
    // A bare carriage return, spaced or glued and mid-token, is the truncation
    // primitive and denies. The plain spellings deny too, so the reason text (not
    // the status) is the discriminator that the return, not the verb, refused it.
    denyAll(STRICT, [
        ['rm \r README.md', /a control character/],
        ['rm \rREADME.md', /a control character/],
        ['git \rpush', /a control character/],
    ]);
    // Tab and newline are ordinary and still pass, and a CRLF between commands is a
    // line break normalized to a newline rather than a bare return.
    allowAll(GATE, ['rm -rf obj\ndotnet build', 'rm -rf bin\r\ndotnet test']);
    allowAll(STRICT, ['echo x > .kit/o\t# note']);
});

// An unquoted backtick opens a command substitution bash runs, so a governed verb
// after one is scanned in command position. A governed subcommand that is the last
// token before the closing tick had glued the tick onto itself (push`) and slipped
// the whole-token comparison; the segmenter cuts on the closing tick, so the
// subcommand tokenizes and denies. A backtick read still allows, which pins the cut
// to the tick rather than to the verb.
const BT = String.fromCharCode(96);
test('a governed verb inside an unquoted backtick substitution denies, a read allows', () => {
    denyAll(STRICT, [
        ['echo ' + BT + 'git push' + BT, GIT],
        ['echo ' + BT + 'git pull' + BT, GIT],
        ['echo ' + BT + 'git stash' + BT, GIT],
    ]);
    allowAll(STRICT, ['echo ' + BT + 'git diff' + BT, 'echo ' + BT + 'git log --oneline' + BT]);
});

// A masked substitution span standing between a verb and its positional
// subcommand is a token boundary the scan steps over, exactly as target
// resolution steps over one in an operand: the span's expansion is unknowable,
// so the next real token is read as the subcommand the shell may run. Without
// the skip, the opaque span itself reads as the subcommand, matches nothing,
// and a git with an unreadable subcommand falls through to allow. The treatment
// is uniform across every positional-subcommand reader, not a git special case,
// so the gh and npm spellings pin the same skip in their own scans.
test('a substitution span before a positional subcommand is stepped over, not read as it', () => {
    denyAll(STRICT, [
        ['git $(true) push', GIT],
        ['git ' + BT + 'true' + BT + ' push', GIT],
        ['gh $(true) pr merge 1 --squash', /a pull-request mutation/],
        ['npm $(true) install lodash', /a package-manager mutation/],
    ]);
    // A read after the span stays a read, which pins the skip to reading the
    // next real token rather than denying on the span itself.
    allowAll(STRICT, ['git $(true) status', 'git ' + BT + 'true' + BT + ' diff']);
});

// Reason fragments for the fail-closed denials the guard raises where it cannot
// resolve what the shell will run. Each names the ambiguity as its ground, so an
// operator reading a false denial can tell it from a resolved mutation.
const UNRESOLVED_SUB = /an unresolved command substitution/;
const UNRESOLVED_CMD = /the guard cannot resolve/;

// A command substitution the shell runs, nested past the depth the guard recurses
// into, is text the guard has declined to scan: echo $(echo $(echo $(git push)))
// buries its innermost command one level beyond the bound, where maskQuoted has
// blanked the verb out of the masked copy and no heuristic can see it. Under the
// fail-closed rule that is unresolved rather than absent, so it denies rather than
// riding through. The two-deep cases prove a substitution within the bound is
// still scanned, not blanket-denied.
test('a command substitution nested past the guard depth denies as unresolved', () => {
    denyAll(STRICT, [
        ['echo $(echo $(echo $(git push origin main)))', UNRESOLVED_SUB],
        ['echo $(echo $(echo $(rm -rf src)))', UNRESOLVED_SUB],
        // An arithmetic span at the bound reaches the same deny: it is blanked with
        // its own substitution collected, so the collection the depth check reads is
        // not empty and the verb inside cannot ride through as arithmetic.
        ['echo $(echo $(echo $(( $(git push origin main) ))))', UNRESOLVED_SUB],
    ]);
    // Affects the gate class the same way: a hidden push leaves no file delta for
    // the tree-state backstop, which is the miss the direct scan exists to close.
    assertDenied(GATE, 'echo $(echo $(echo $(git push origin main)))', UNRESOLVED_SUB);
    // Two levels deep is within the bound, so the substitution is still scanned: a
    // read there stays a read and a mutation still denies through the scan, not
    // through the depth cutoff.
    allowAll(STRICT, ['echo $(echo $(git diff))']);
    assertDenied(STRICT, 'echo $(echo $(git commit -m x))', GIT);
});

// The depth bound fails closed for EVERY construct it leaves unexpanded, not one
// construct at a time. A substitution wrapper consumes a depth increment the
// executor recursion was sized without, so an executor payload arriving at the
// bound inside substitution wrappers is text the guard declined to scan exactly
// as a too-deep substitution is, and it can carry the byte-identical git or gh
// verbs whose mutation leaves no file delta for the tree-state backstop. The
// exhaustion check reads the same two collectors the in-bound recursion drains,
// so whatever remains unexpanded at the bound denies as unresolved.
test('an unexpanded nested executor at the depth bound denies instead of dropping', () => {
    denyAll(STRICT, [
        ['$($(eval "git push"))', UNRESOLVED_SUB],
        ['$($(sh -c "git commit -m x"))', UNRESOLVED_SUB],
        ['$($(eval "gh pr merge 1"))', UNRESOLVED_SUB],
        ['$(sh -c "sh -c \\"git push\\"")', UNRESOLVED_SUB],
        ['$(sh -c "eval \\"git push\\"")', UNRESOLVED_SUB],
        ['$($(eval "rm README.md"))', UNRESOLVED_SUB],
        // Three plain executors deep reaches the bound with a payload still
        // unexpanded, so the structural form closes this spelling too.
        ['bash -c "bash -c \\"bash -c \\\\\\"git push\\\\\\"\\""', UNRESOLVED_SUB],
    ]);
    // The in-bound spellings still deny through the scan rather than through the
    // bound, so the bound is not doing the scanner's work.
    assertDenied(STRICT, 'sh -c "sh -c \\"git push\\""', NESTED);
    assertDenied(STRICT, 'echo $(echo $(echo $(git push origin main)))', UNRESOLVED_SUB);
    // An executor whose flags carry no payload leaves nothing unexpanded, so
    // ordinary depth-2 text is not blanket-denied.
    allowAll(STRICT, ['echo $(echo $(bash scripts/verify.sh))']);
});

// $(( opens arithmetic only where the span is confidently one parenthesized group,
// its inner ( matching the ) before the outer close. $((cmd);(cmd)) and
// $((cmd)&&(cmd)) hold more than one group, and bash reparses them as a command
// substitution wrapping a subshell list, which it runs. The guard treats every
// ambiguous $(( as a command substitution to be collected and scanned, so the verb
// inside denies. These allow on the pre-fix worktree, which classified the span as
// arithmetic by the accident of its closing )) and blanked it without scanning.
test('an ambiguous $(( is a command substitution bash runs, not arithmetic', () => {
    denyAll(STRICT, [
        ['$((git push origin main);(true))', GIT],
        ['$((git push origin main)&&(true))', GIT],
        ['$((true)||(git push origin main))', GIT],
        ['$((true);(git push origin main))', GIT],
        ['$((echo x > README.md);(true))', WRITE],
    ]);
    // A confidently arithmetic span holding no substitution runs no command and
    // still passes, so the fix does not over-block genuine arithmetic. The span
    // that does hold one is the case below.
    allowAll(STRICT, ['echo "$((1 + 2))"', 'echo "$((1 > 2))"', 'echo "$(( (1 + 2) * 3 ))"']);
});

// A governed verb split from its command across a substitution boundary is
// unresolvable, not absent. git $(true)push leaves a subcommand token of span
// bytes glued to push that the shell resolves to whatever the substitution prints,
// so the guard denies rather than matching no mutation name and falling through.
// These are the readers that test the position themselves, knowing which token they
// are about to read; the block below pins the chokepoint that covers every other
// name position in the file, since the same evasion reaches each. All allow on the
// pre-fix worktree.
test('a governed verb spliced onto a substitution span denies as unresolvable', () => {
    denyAll(STRICT, [
        ['git $(true)push origin main', UNRESOLVED_CMD],
        ['git ' + BT + 'true' + BT + 'push origin main', UNRESOLVED_CMD],
        ['gh pr $(true)merge 1 --squash', UNRESOLVED_CMD],
        ['git worktree $(true)add ../wt main', UNRESOLVED_CMD],
        ['npm $(true)install lodash', UNRESOLVED_CMD],
        ['dotnet $(true)add package Foo', UNRESOLVED_CMD],
    ]);
});

// A substitution the shell runs stands the word after it in command position, the
// same as a separator or a backtick does: $(true)git is git run fresh once the
// substitution expands. The command-position prefix class admits the span sentinel
// so the verb is seen at all; the pre-fix class did not, so the leading-span
// spellings were never recognised and allowed.
test('a substitution standing before a governed verb puts it in command position', () => {
    denyAll(STRICT, [
        ['$(true)git push origin main', GIT],
        ['$(true)gh pr merge 1', /a pull-request mutation/],
        ['$(true)npm install lodash', /a package-manager mutation/],
    ]);
    // A read after the leading substitution stays a read, so the sentinel opens a
    // command position without denying on the substitution itself.
    allowAll(STRICT, ['$(true)git diff', '$(true)git status']);
});

// A substitution glued to the right of a governed name (git$(true) push) closes
// the name's word the way a space does: the shell resolves git$(true) to git when
// the substitution prints nothing, so it runs git push. The command-position
// trailing boundary admits the span, so the name is matched; the span then rides
// on as the leading token of the segment, where a full-span operand token is
// stepped over and the real subcommand is read. So a name-glued mutation denies on
// the subcommand it resolves to, while a name-glued read (git$(true) diff) stays a
// read, since denying it would trap review work the shell runs as a read. The
// mutation spellings allow on the pre-fix worktree. A substitution that splits the
// name itself (g$(x)it) leaves no whole name to match and stays the documented
// assembly miss, exactly as the quoting-split "git" commit and g'i't commit do.
test('a substitution glued to the right of a governed name is still command position', () => {
    denyAll(STRICT, [
        ['git$(true) push origin main', GIT],
        ['git$(true) commit -m x', GIT],
        ['gh$(true) pr merge 1', /a pull-request mutation/],
        ['npm$(true) install lodash', /a package-manager mutation/],
    ]);
    assertDenied(GATE, 'git$(true) push origin main', GIT);
    // A name-glued read stays the read the shell resolves it to.
    allowAll(STRICT, ['git$(true) diff', 'git$(true) status']);
    // A substitution splitting the name itself is the accepted assembly miss, not
    // this case, and stays allowed alongside its quoting-split siblings above.
    allowAll(STRICT, ['g$(x)it commit -m x']);
});

// Bash expands a command substitution standing in an arithmetic operand before it
// evaluates anything, and whatever quoting surrounds it: $(( $(cmd) )) and
// $(( '$(cmd)' )) both run cmd, and the arithmetic error that follows comes after
// the run. So an arithmetic span is blanked but never left unscanned. Every span
// below is CONFIDENTLY arithmetic, its inner ( matching the ) before the outer
// close, which is what discriminates these from the ambiguous shapes above: a guard
// that scans only the ambiguous ones blanks each of these whole and allows it, which
// is how they stand on the pre-fix worktree. The deny lands on the substitution's own
// verb rather than on the shape, which is what the reason text pins.
test('a command substitution inside arithmetic is scanned, the arithmetic around it is not', () => {
    denyAll(STRICT, [
        ['echo $(($(git push origin main)))', GIT],
        ['echo $(( 1 + $(git push origin main) ))', GIT],
        ['true && echo $(($(git push origin main)))', GIT],
        ['echo $(( ' + BT + 'git push origin main' + BT + ' ))', GIT],
        ['echo "$(($(git commit -m x)))"', GIT],
        ["echo $(( '$(git push origin main)' ))", GIT],
        ['echo $(($(rm -rf src)))', PATHMUT],
    ]);
    // Genuine arithmetic runs no command and still passes, because the text around
    // the operands is arithmetic rather than shell syntax. $((1 > 2)) is the case
    // that proves it: read as command text, its > is a redirect writing a file
    // named 2, so a scan of the whole interior denies it. The last case pins the
    // other direction, that the interior is genuinely scanned and a read there
    // stays a read.
    allowAll(STRICT, ['echo $((1 + 2))', 'echo $(( (1 + 2) * 3 ))', 'echo $((1 > 2))',
        'echo "$((1 + 2))"', 'echo $(( $(git rev-list --count HEAD) + 1 ))']);
});

// A backslash standing immediately before a newline joins the two lines into one,
// so the shell reads no boundary there and `git \<newline>push` runs git push.
// Left as a boundary it ends the operand list where the shell does not, and every
// positional-subcommand reader loses its subcommand. The allow cases are the
// discriminator rather than a decoration: the same two lines without the backslash
// really are two commands, and a doubled backslash escapes the backslash rather
// than the line, so both leave the newline the separator the shell reads. All the
// deny cases allow on the pre-fix worktree.
test('a backslash before a newline continues the line rather than ending the command', () => {
    denyAll(STRICT, [
        ['git \\\npush origin main', GIT],
        ['gh pr \\\nmerge 1 --squash', /a pull-request mutation/],
        ['npm \\\ninstall lodash', /a package-manager mutation/],
        ['dotnet \\\nnew console', /a package-manager mutation/],
        ['git ls-files | xargs \\\nrm', BULK],
        // The operand list continues too, not only the subcommand, and here the
        // reason text is the discriminator rather than the status: cut at the
        // newline, the trailing backslash is itself an operand that resolves above
        // the repo root and denies as an ancestor, so the case is pinned to the
        // target the shell actually passes.
        ['rm -rf \\\nsrc', /a path mutation in the tree under review \(rm src\)/],
    ]);
    allowAll(STRICT, ['git \\\nstatus --short', 'git\npush origin main', 'git \\\\\npush origin main']);
});

// The shell concatenates a substitution spliced into a token with the literal bytes
// around it, so `$(true)rm -$(true)i -$(true)delete` reaches the executor as
// `rm -i -delete`. The token's value is whatever the substitution prints, so every
// equality test the guard makes against it fails, and matching nothing is the
// fail-open direction. A spliced token standing where the guard reads a NAME
// therefore denies, at one chokepoint over every governed invocation rather than at
// a test each reader remembers to make: the cases below span the flag scans (sed,
// find, git, gh) and the verb scans (xargs, npm) alike, and each carries a real
// mutation the reader would have caught had the token resolved. All allow on the
// pre-fix worktree.
test('a spliced substitution in a name position denies at every reader, not at six of them', () => {
    denyAll(STRICT, [
        ['git ls-files | xargs $(true)rm', UNRESOLVED_CMD],
        ["find . -name '*.md' -$(true)delete", UNRESOLVED_CMD],
        ["sed -$(true)i 's/a/b/' README.md", UNRESOLVED_CMD],
        ['git -$(true)C . push', UNRESOLVED_CMD],
        ['npm run $(true)format', UNRESOLVED_CMD],
        ['gh -$(true)R o/n pr merge 1', UNRESOLVED_CMD],
        // The -exec verb takes a destination outside the tree, so the case reaches
        // the verb reader rather than denying on the operand the spliced verb
        // stands before: with `{}` there, the rm the span puts in command position
        // carries an in-tree target and the path scan answers first.
        [`find . -name '*.md' -exec $(true)rm ${OUTSIDE} ;`, UNRESOLVED_CMD],
    ]);
    // An operand is not a name: a ref, a pathspec, or a scratch path carrying a
    // substitution is resolved rather than compared against a list, and ordinary
    // review work spells refs and scratch paths exactly this way.
    allowAll(STRICT, [
        'git log --oneline $(git merge-base main HEAD)..HEAD',
        'git diff $(git merge-base main HEAD)..HEAD',
        'rm -rf .kit/$(date +%s)',
        'git $(true) status',
    ]);
});

// A nested executor receives the payload its own assembly rule produces, and the
// analysis has to read that text rather than the argument list the guard finds
// convenient. eval and iex join every operand with a space, so `eval "git" "push"`
// runs git push; cmd takes the whole tail after /c the same way; and adjacent
// quoted runs are one word, so `sh -c "git"" push"` hands sh a single payload and
// `git "pu""sh"` names one subcommand. Read one token at a time instead, every one
// of these is a bare verb with no subcommand and allows, which is how they stand on
// the pre-fix worktree.
test('a nested payload is judged as the executor assembles it, joined and concatenated', () => {
    denyAll(STRICT, [
        ['eval "git" "push"', GIT],
        ['iex "git" "push"', GIT],
        ['cmd /c "git" "push"', GIT],
        ['sh -c "git"" push"', GIT],
        ['bash -c "rm"" -rf src"', PATHMUT],
        ['bash <<< "git"" push"', GIT],
        ['git "pu""sh" origin main', GIT],
    ]);
    // Joining is what the executor does rather than an extra reach of the guard's,
    // so a read assembled the same way stays a read.
    allowAll(STRICT, ['eval "git" "status"', 'cmd /c "git" "status"', 'sh -c "git status"',
        'bash <<< "git diff"', 'git "sta""tus"']);
});

// A heredoc body is data the receiving command reads on stdin, not shell syntax,
// so a > inside one is a comparison or an arrow rather than a redirect, and a
// governed verb inside one is a word the sink copies rather than a command. The
// guard blanks a body's > operators and, where the WHOLE command is one simple
// data-sink heredoc write, masks the body outright so its prose reaches a scratch
// file untouched. That exemption is a whole-command shape recognizer, and it
// holds only when every one of these is true (the same enumeration the guard's
// heredocExemption comment carries):
//   1. one cat or tee owns one heredoc whose delimiter is quoted;
//   2. one > or >> redirect with no descriptor prefix, or one tee file operand,
//      is the only destination;
//   3. that destination resolves inside the class's writable set or outside
//      the git root entirely;
//   4. the terminator is matched by bash's own rule (a line equal to the
//      delimiter for <<, leading tabs stripped for <<-);
//   5. nothing but whitespace follows the terminator;
//   6. the intro line carries no excluded construct (a second <<, a separator, a
//      pipe, a further redirect, a subshell or brace group, a command or process
//      substitution, a backslash continuation, an unquoted #, or an unbalanced
//      quote).
// Two conditions bound the application rather than the intro shape: the exemption
// runs only at the top level (denyReason's depth 0), since below it the body is a
// payload another command was handed; and a cat sink takes no stray file operand,
// since the sink then reads that file and the body is not what it writes.
// The deny cases below carry most of the weight: a body outside the shape is a
// command wherever it sits, and each condition is discriminated by a deny case
// that is a valid exemption in every respect but the one it names, so disabling
// that one condition turns the case green. The proof is a grant-style mutant
// matrix (each condition made to pass, not each line deleted, since the shape
// checks are layered and a single deletion is backstopped by another) in the
// section's verification report. Body text never reaches the decision, so a stray
// apostrophe among the prose cannot blank the mask.

test('a quoted heredoc body carrying > is data rather than a redirect', () => {
    // The owner is not a data sink, so the body is not exempt, but its > operators
    // are still blanked: a comparison in a script written through a heredoc is not
    // a write.
    allowAll(STRICT, ["node <<'EOF'\nconst f = (a) => a > 1;\nconsole.log(f(2) >= 1);\nEOF"]);
});

// A body a data sink writes to a writable path is text the shell never runs, so
// the verbs a review report quotes are operands of cat or tee rather than
// commands. These are the allow cases, one per accepted shape.

test('a report naming governed verbs reaches a writable path through cat and tee', () => {
    allowAll(STRICT, [
        "cat > .kit/review.md <<'EOF'\ngit push origin main is a mutation the orchestrator must run\nrm -rf bin obj clears the build output before the gate\nEOF",
        "tee .kit/review.md <<'EOF'\ngit push origin main is a mutation the orchestrator must run\nrm -rf bin obj clears the build output before the gate\nEOF",
        "cat >> .kit/notes.md <<'EOF'\ngit reset --hard is what the fix reverts\nEOF",
        "cat > .kit/o <<\"EOF\"\ngh pr merge would land it early\nEOF",
    ]);
    // The dash form strips leading tabs from its terminator, exactly as bash does.
    allowAll(STRICT, ["cat > .kit/o <<-'EOF'\n\tgit push notes for the report\n\tEOF"]);
});

test('the gate class writes a heredoc report into its build-output directories', () => {
    allowAll(GATE, [
        "tee bin/out.log <<'EOF'\ngit push origin main is a mutation\nEOF",
        "cat > obj/report.txt <<'EOF'\nrm -rf bin obj is the clean step\nEOF",
    ]);
    // The strict class writes only .kit/, so the same target denies for it.
    assertDenied(STRICT, "cat > bin/out.log <<'EOF'\ngit commit -m x\nEOF", GIT);
});

// Each deny case below misses exactly one condition, named in its title, and the
// mutant matrix in the section's verification report grants that one condition
// and watches the case go green. Every case carries a writable destination where
// the destination is not itself the thing under test, so it reaches and fails the
// condition it names rather than failing the destination check first.

test('condition 1, the owner is a data sink: a non-sink owner keeps the body scanned', () => {
    assertDenied(STRICT, "node > .kit/o <<'EOF'\ngit commit -m x\nEOF", GIT);
});

test('condition 1, a quoted or variable owner is not the literal cat or tee', () => {
    denyAll(STRICT, [
        ["\"cat\" > .kit/o <<'EOF'\ngit commit -m x\nEOF", GIT],
        ["$CAT > .kit/o <<'EOF'\ngit commit -m x\nEOF", GIT],
    ]);
});

test('condition 2, the delimiter is quoted: an unquoted heredoc still expands and stays scanned', () => {
    denyAll(STRICT, [
        ["cat > .kit/o <<EOF\ngit commit -m x\nEOF", GIT],
        ['cat > .kit/o <<EOF\n$(git commit -m x)\nEOF', GIT],
    ]);
    // The desyncing and empty delimiter spellings bash reads differently are not
    // the shape either. The split-delimiter spelling (<<'E'OF, whose delimiter
    // bash assembles as EOF) is among them: heredocBodies names it as a
    // spelling it refuses to read as an introduction, so the body stays scanned.
    denyAll(STRICT, [
        ["cat > .kit/o <<'EOF'X\ngit commit -m x\nEOFX", GIT],
        ["cat > .kit/o <<''\ngit commit -m x\n", GIT],
        ["cat > .kit/o <<'E'OF\ngit commit -m x\nEOF", GIT],
    ]);
});

test('condition 3, a destination is required: a bare sink terminating nowhere nameable stays scanned', () => {
    // cat with no redirect names no destination, so its stdout goes nowhere the
    // guard can follow to a resting place; the body stays scanned exactly as a
    // command line is.
    assertDenied(STRICT, "cat <<'EOF'\ngit commit -m x\nEOF", GIT);
});

test('condition 3, the destination is writable or out of tree: a sink writing into the tree stays scanned', () => {
    assertDenied(STRICT, "cat > src/report.md <<'EOF'\ngit commit -m x\nEOF", GIT);
    // The write into the tree denies on its own account once the body is scanned.
    assertDenied(STRICT, "cat > src/notes.md <<'EOF'\nplain prose\nEOF", WRITE);
});

test('condition 3, an out-of-tree destination is a positive placement: the report reaches /tmp', () => {
    // The guard already treats an out-of-root write as no mutation of the tree
    // under review (echo hi > /tmp/review.md allows), so the heredoc spelling of
    // the same write mirrors it: a reviewer's report aimed at the session
    // scratchpad or /tmp is not blocked by its own subject matter.
    // The out-of-tree path is spelled with forward slashes: on the intro line a
    // top-level backslash is bash's escape character, so a backslashed spelling
    // would hand the sink a different operand than the path it names.
    allowAll(STRICT, [
        "cat > /tmp/review.md <<'EOF'\ngit push origin main is a mutation the orchestrator must run\nEOF",
        `cat > ${OUTSIDE.replace(/\\/g, '/')} <<'EOF'\nrm -rf bin obj is the clean step\nEOF`,
    ]);
    // An in-tree tracked destination still refuses the shape, and a destination
    // the guard cannot resolve still leaves the body scanned: outside is a
    // positive placement, never a failure to place.
    assertDenied(STRICT, "cat > README.md <<'EOF'\ngit push origin main\nEOF", GIT);
    assertDenied(STRICT, "cat > $DEST/review.md <<'EOF'\ngit commit -m x\nEOF", GIT);
});

test('condition 4, the redirect carries no descriptor prefix', () => {
    denyAll(STRICT, [
        ["cat 1> .kit/o <<'EOF'\ngit commit -m x\nEOF", GIT],
        ["cat 0<> .kit/o <<'EOF'\ngit commit -m x\nEOF", GIT],
    ]);
});

test('condition 5, the terminator exists by bash rule', () => {
    // No terminator line, so the body is not bounded by the shape.
    assertDenied(STRICT, "cat > .kit/o <<'EOF'\ngit commit -m x", GIT);
    // A terminator bash does not accept (leading space for <<) is not a terminator
    // here either, and a live command sits past it.
    assertDenied(STRICT, "cat > .kit/o <<'EOF'\nbody\n  EOF\ngit commit -m x", GIT);
});

test('condition 5, a here-string is not a heredoc introduction and disarms nothing', () => {
    assertDenied(STRICT, 'grep -q docs <<< "$out"\necho hi > README.md', WRITE);
});

test('condition 6, nothing follows the terminator: a command after it stays scanned', () => {
    // The whole point of a single simple command: a body written to a writable
    // path and then run by a command after the terminator (sh .kit/o) must not be
    // masked, or the write plus the execute is a bypass.
    denyAll(STRICT, [
        ["cat > .kit/o <<'EOF'\ngit push origin main\nEOF\nsh .kit/o", GIT],
        ["cat > .kit/o <<'EOF'\nbody\nEOF\ngit commit -m x", GIT],
    ]);
});

test('condition 6, the intro line carries no pipe, separator, second heredoc, or further redirect', () => {
    // tee writes to a writable path and to stdout, so a consumer of that stdout
    // executes the body; the pipe keeps the body scanned. A separator, a second
    // heredoc, or a further redirect (a second destination) likewise takes the
    // command out of the single-simple-command shape.
    denyAll(STRICT, [
        ["tee .kit/o <<'EOF' | python\ngit commit -m x\nEOF", GIT],
        ["tee .kit/o <<'EOF' ; ls\ngit push --force origin main\nEOF", GIT],
        ["tee .kit/o <<'EOF' && git commit -m x\nbody\nEOF", GIT],
        ["cat > .kit/o <<'EOF' <<'ZZ'\ngit commit -m x\nEOF\nZZ", GIT],
        ["cat > .kit/o > .kit/o2 <<'EOF'\ngit commit -m x\nEOF", GIT],
    ]);
});

// The excluded-construct condition closes every bypass either review round
// verified. Each moves the thing that makes the body live (a second introduction,
// a substitution, a consumer of the sink's stdout, a descriptor trick) out of the
// single-simple-command shape, and each runs in a real shell.

test('a subshell consuming the sink output stays scanned, stray apostrophe and all', () => {
    // The sink's stdout is consumed by a subshell or pipe, an excluded construct,
    // so the body is scanned as command text. The apostrophe in the body is a
    // literal there, not a shell quote, so it neither blanks the mask nor lets the
    // shape decision pass vacuously.
    denyAll(STRICT, [
        ["( tee .kit/o <<'EOF'\ncan't stop the report\ngit push --force origin main\nEOF\n) | sh", GIT],
        ["(cat <<'EOF'\ngit commit -m x\nEOF\n)|bash", GIT],
        ["{ ( cat <<'EOF'\ngit commit -m x\nEOF\n) ; } | sh", GIT],
        ["f() ( cat <<'EOF'\ngit commit -m x\nEOF\n)\nf | sh", GIT],
        ["( cat <<'EOF'\ngit commit -m x\nEOF\n) > .kit/o && sh .kit/o", GIT],
        ["( cat <<'EOF'\ngh pr merge 1 --squash\nEOF\n) | sh", /a pull-request mutation/],
    ]);
});

test('a pipe consuming the sink output stays scanned, whatever the consumer', () => {
    // The reach test is positive, not a list of known consumers, so a consumer the
    // executor list never named is refused for the same reason a shell is.
    denyAll(STRICT, [
        ["tee .kit/o <<'EOF' | sh\ndon't stop\ngit push --force origin main\nEOF", GIT],
        ["cat <<'EOF' | source /dev/stdin\ngit commit -m x\nEOF", GIT],
        ["cat <<'EOF' | . /dev/stdin\ngit commit -m x\nEOF", GIT],
        ["cat <<'EOF' | \"sh\"\ngit commit -m x\nEOF", GIT],
        ["cat <<'EOF' | $SHELL\ngit commit -m x\nEOF", GIT],
        ["cat <<'EOF' | python\ngit commit -m x\nEOF", GIT],
    ]);
});

test('a substitution reaching the operator, on any physical line, stays scanned', () => {
    denyAll(STRICT, [
        ["eval $(\ncat <<'EOF'\ngit commit -m x\nEOF\n)", GIT],
        ['eval `\ncat <<\'EOF\'\ngit commit -m x\nEOF\n`', GIT],
        [". <(cat <<'EOF'\ngit commit -m x\nEOF\n)", GIT],
        ["x=$(cat <<'EOF'\ngit commit -m x\nEOF\n)", GIT],
        ["cat > .kit/o <<'EOF' $(git commit -m x)\nbody\nEOF", GIT],
        // The substitution is scanned as live code, so a heredoc it carries is
        // read directly rather than masked: the verb in its body denies.
        ["eval \"$(cat <<'EOF'\ngit commit -m x\nEOF\n)\"", GIT],
    ]);
});

test('a heredoc into a nested shell is code, and stays governed', () => {
    denyAll(STRICT, [
        ["bash <<'EOF'\ngit commit -m x\nEOF", GIT],
        ["sh -c \"cat <<'EOF'\ngit commit -m x\nEOF\" | sh", GIT],
    ]);
});

test('a nested introduction inside a body opens no span of its own', () => {
    // The first terminator ends the body, so a second introduction inside it opens
    // nothing and the live lines after the real terminator stay scanned.
    denyAll(STRICT, [
        ["cat <<'EOF'\ncat <<'ZZ'\nEOF\ngit push --force origin main\nZZ", GIT],
        ["tee .kit/o <<\"EOF\"\ncat <<'ZZ'\nEOF\ngit push --force origin main\nZZ", GIT],
        ["cat <<-'EOF'\ncat <<'ZZ'\nEOF\ngh pr merge 1 --squash\nZZ", /a pull-request mutation/],
    ]);
});

test('a comment-position introduction opens no body, so its lines stay scanned', () => {
    denyAll(STRICT, [
        ["# <<'A'\ngit commit -am pwn\nA", GIT],
        ["# cat <<'EOF'\ngit commit -am pwn\nEOF", GIT],
        ["# note; cat <<'EOF'\ngit commit -am pwn\nEOF", GIT],
    ]);
});

test('an unquoted heredoc body still expands, so it stays scanned', () => {
    assertDenied(STRICT, 'cat <<EOF\n$(git commit -m x)\nEOF', GIT);
});

test('the redirect on a heredoc intro line is outside the body and still denies', () => {
    assertDenied(STRICT, "cat > README.md <<'EOF'\nhello\nEOF", WRITE);
    assertDenied(STRICT, "cat <<'EOF' \\\n> README.md\nhi\nEOF", WRITE);
});

test('a blanked body redirect still ends an operand list', () => {
    assertDenied(STRICT, "# <<'A'\ncp /etc/hosts README.md > /dev/null", PATHMUT);
    assertDenied(STRICT, "# <<'A'\ngit branch pwned > --list", /a git branch creation/);
});

// The stray-operand and depth conditions each get an isolating case: the command
// is a valid exemption in every respect but the one named, so granting that one
// condition (and only that one) turns it green in the mutant matrix.

test('a stray file operand to cat keeps the body scanned', () => {
    // cat reads .kit/x and the heredoc rides stdin, written nowhere the guard can
    // follow to a resting place, so the sink is not writing the body and the body
    // stays scanned. .kit/x is writable, so the destination is not what refuses it.
    assertDenied(STRICT, "cat .kit/x <<'EOF'\ngit commit -m x\nEOF", GIT);
});

test('the data-sink exemption applies only at the top level, not to a nested payload', () => {
    // The heredoc write sits inside a substitution, so it is a payload the outer
    // command was handed; what consumes it is outside this string. .kit/o is
    // writable and the shape is otherwise exact, so only the depth-0 restriction
    // keeps the body scanned.
    assertDenied(STRICT, "echo \"$(cat > .kit/o <<'EOF'\ngit commit -m x\nEOF\n)\"", GIT);
});

test('a heredoc delimiter carrying a bare carriage return is refused, not masked past', () => {
    // The terminator-desync regression: bash accepts a body line as the terminator
    // that the guard, reading the delimiter with a trailing \r attached, does not,
    // so the guard's terminator lands on a later line and masks the git push bash
    // runs between the two. The bare return is refused at the boundary, so the
    // command denies before any body is masked. .kit/review.md is writable, so the
    // destination is not what refuses it.
    const CR = '\r';
    assertDenied(STRICT,
        "cat > .kit/review.md <<'EOF" + CR + "'\nharmless report line\nEOF" + CR
        + "\ngit push origin main\nEOF" + CR + CR + "\n",
        /a control character/);
});

// The operand-posture sites, settled together: where the guard cannot read a
// value the command author chose, each site takes the judgment its own failure
// direction earns rather than one shared posture. A cd target falls back to the
// payload cwd, since an empty candidate list disarms every path check for the
// whole command; a redirect's descriptor prefix is read as an operand and
// denies, which is the priced false denial the withdrawal restored; the
// spellings whose value is fixed before the shell runs ($PWD, ${PWD}, %CD%, a
// home-relative path) resolve; and a destructive cmdlet fed by an enumerating
// pipeline is the bulk idiom whatever its operand looks like. Every other
// variable-built operand stays an allow, deliberately, backstopped by the
// tree-state bracket the orchestrator runs around a review round.

test('an unresolvable cd target falls back to the payload cwd rather than disarming the path checks', () => {
    // Each deny here is red without the fallback: effectiveDirs returned no
    // candidate for these targets, and the write, mutation, and overwrite
    // checks iterate candidates, so the cd prefix turned all three off while
    // the same command without it denies. The fallback restores the payload-cwd
    // baseline rather than the directory the shell is actually in, so where a
    // readable switch earlier in the chain already left the tree (cd C:/Users
    // && cd $FOO && rm README.md) it can deny an operand the shell resolves
    // elsewhere; that cost leans toward denial and is the price of keeping the
    // checks armed.
    assertDeniedAt(REPO, STRICT, 'cd $PWD && rm -rf src', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'cd $PWD; echo pwned > README.md', WRITE);
    assertDeniedAt(REPO, STRICT, 'cd - && rm -rf src', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'cd "" && rm -rf src', PATHMUT);
    // A read under the same prefix stays a read, and an operand that resolves
    // outside the tree from the fallback base stays allowed.
    assertAllowedAt(REPO, STRICT, 'cd $PWD && rg foo docs/');
    assertAllowedAt(REPO, STRICT, 'cd "$TMP" && cat x');
});

test("a descriptor prefix beside a redirect denies, and the false denial is the priced side", () => {
    // A redirect cuts the segment the operand scan reads, so the descriptor
    // digits glued to the operator are read as an operand and deny. That is a
    // false denial: bash hands rm one operand here, not two. It is kept
    // deliberately, and this case pins the reason rather than the spelling.
    // Stripping the digits was tried and withdrawn, because it empties the
    // operand list wherever they are the only operand, and the words bash
    // hands the command past the redirect target sit in a segment this scan
    // cannot see, so the strip turned four real in-tree destructions into
    // allows while removing one visible false denial.
    denyAll(STRICT, [
        ['rm .kit/x 2>&1', PATHMUT],
        ['node x.js | tee .kit/log 2>&1', WRITE],
    ]);
    // The destructions the strip admitted, each denying again. Every one of
    // these removes a tracked file when bash runs it, and each names an
    // operand the strip would have dropped along with the digits.
    denyAll(STRICT, [
        ['rm 2>/dev/null README.md', PATHMUT],
        ['rm -rf 2>&1 src', PATHMUT],
        ['mv 2>/dev/null README.md /tmp/x', PATHMUT],
        ['rm .kit/a 2>/dev/null README.md', PATHMUT],
    ]);
    // The controls, so the denials above are not the whole instrument saying
    // no: the same commands without a redirect discriminate in both
    // directions, and a word merely ending in digits stays an operand.
    allowAll(STRICT, ['rm .kit/x', 'node x.js | tee .kit/log']);
    assertDenied(STRICT, 'rm file2>/dev/null', PATHMUT);
    assertDenied(STRICT, 'rm README.md', PATHMUT);
});

test('the resolvable operand subset: $PWD, ${PWD}, %CD%, and a home path resolve before the shell runs', () => {
    // Each names a value fixed before the shell runs, so "cannot place" was
    // the wrong answer: $PWD spells the tree under review through a variable.
    assertDeniedAt(REPO, STRICT, 'rm $PWD/README.md', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'rm ${PWD}/README.md', PATHMUT);
    assertDeniedAt(REPO, STRICT, 'del %CD%/README.md', PATHMUT);
    // Home sits outside the repo, so a home-relative path is a confirmed
    // out-of-tree allow rather than an unplaceable one.
    assertAllowedAt(REPO, STRICT, 'rm ~/scratch/x');
    // The subset is exact: a variable that merely starts with PWD is another
    // variable, and every other variable stays unplaceable and allowed,
    // deliberately, backstopped by the tree-state bracket.
    assertAllowedAt(REPO, STRICT, 'rm $PWDX/README.md');
    assertAllowedAt(REPO, STRICT, 'rm $FOO/README.md');
});

test('a destructive cmdlet fed by an enumerating pipeline is a bulk mutation, pipeline variable or none', () => {
    for (const agent of [STRICT, GATE]) {
        denyAll(agent, [
            // The $_-shaped operand defeated the no-path-operand branch while
            // the items still came from the enumeration upstream.
            ['Get-ChildItem | ForEach-Object { Remove-Item $_ }', BULK],
            ['gci | % { ri $_ }', BULK],
            ['Get-ChildItem . | Sort-Object | ForEach-Object { Remove-Item $_ }', BULK],
            // The operand-free shape stays covered by the original branch.
            ['Get-ChildItem . -Recurse | Remove-Item', BULK],
        ]);
        // An enumeration into a non-mutating consumer is a read.
        allowAll(agent, ['Get-ChildItem . -Recurse | Select-Object Name']);
    }
    // A standalone destructive cmdlet with the same unresolvable operand has no
    // enumeration feeding it items, which is what scopes the predicate to the
    // bulk idiom rather than to every variable operand.
    allowAll(STRICT, ['Remove-Item $x']);
    // An enumeration in an earlier statement is not this pipeline's upstream:
    // the separator bounds the stage walk.
    allowAll(STRICT, ['ls .kit; sort | Remove-Item $x']);
});

test('a piped destructive cmdlet is the bulk idiom whatever its upstream, with no writable-set carve-out', () => {
    // A carve-out that read the enumerating upstream and allowed the class its
    // own cleanup was built and withdrawn, and the withdrawal is what this case
    // pins. It twice admitted a delete it did not bound. Once because the
    // upstream named what it READ rather than what it emitted, so
    // Get-Content .kit/list.txt named a writable file whose lines name any path
    // at all. And once because an intermediate stage replaced the items after
    // the check had already passed on the stage that opened the pipe, so
    // gci .kit | ForEach-Object { 'README.md' } | Remove-Item reached a tracked
    // file from a writable enumeration. What a pipe actually feeds a destructive
    // cmdlet is not readable from the stage that opens it, so the idiom denies
    // whole for both classes and the false denial is priced rather than hidden.
    denyAll(GATE, [
        ['Get-ChildItem obj -Recurse | ForEach-Object { Remove-Item $_.FullName }', BULK],
        ['Get-ChildItem obj -Recurse | Remove-Item', BULK],
        ['gci bin -Recurse | ri -Force', BULK],
        ['Get-Content obj/gen.txt | Remove-Item', BULK],
        ['Get-ChildItem src -Recurse | Remove-Item', BULK],
        ['Get-ChildItem | ForEach-Object { Remove-Item $_ }', BULK],
        ["gci obj | ForEach-Object { 'README.md' } | Remove-Item", BULK],
    ]);
    denyAll(STRICT, [
        ['Get-ChildItem .kit | ForEach-Object { Remove-Item $_ }', BULK],
        ['Get-Content .kit/list.txt | Remove-Item', BULK],
        ["gci .kit | ForEach-Object { 'README.md' } | Remove-Item", BULK],
        ['Get-Item obj | Remove-Item', BULK],
        ['Get-ChildItem obj -Recurse | Remove-Item', BULK],
    ]);
    // The cost is bounded, which is why the denial is priced rather than a hole
    // in the charter: each class's direct spelling of the same cleanup still
    // allows, so the grant survives in the form that names its own target.
    allowAll(GATE, ['Remove-Item obj -Recurse -Force', 'ri bin -Recurse -Force']);
    allowAll(STRICT, ['Remove-Item .kit/x -Recurse']);
});

// The read-only seats are enumerated in one place, the shared classifier, and an
// enumeration says nothing about a member nobody named. The agent definitions
// carry a machine-readable marker of the same class: a `tools:` frontmatter line
// granting no file-writing tool. Deriving the set from that marker is the
// structural pin over the class's shape, and it is what catches a read-only
// reviewer added to agents/ that the classifier does not know: that seat would
// receive store-authored text at its dispatch AND be allowed to mutate the tree
// it is reviewing.
//
// The derivation asserts membership of the GOVERNED set rather than equality
// with the strict one. qa-verifier is read-only by its tools and is deliberately
// classed `gate`: it runs the build and the suite, which is a wider grant than a
// judgment seat's, so the boundary is real rather than an omission.
test('every read-only agent definition is a governed seat, derived from the definitions themselves', () => {
    const WRITERS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
    const derived = [];
    for (const file of fs.readdirSync(AGENTS).filter((n) => n.endsWith('.md'))) {
        const text = fs.readFileSync(path.join(AGENTS, file), 'utf8');
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        assert.ok(fm, `${file} has no frontmatter`);
        const line = /^tools:[ \t]*(.+)$/m.exec(fm[1]);
        if (!line) continue;                       // a definition granting the session's own tools
        const granted = line[1].split(',').map((s) => s.trim());
        if (WRITERS.some((t) => granted.includes(t))) continue;
        derived.push(path.basename(file, '.md'));
    }
    assert.ok(derived.length >= 8,
        'the derivation must find the read-only definitions, got: ' + derived.join(', '));
    for (const name of derived) {
        const cls = agentLib.reviewAgentClass('claude-kit:' + name);
        assert.ok(cls !== null, `${name}.md grants no file-writing tool, so it is a read-only seat, `
            + 'and no policy class governs it: add it to reviewAgentClass');
        if (name !== 'qa-verifier') {
            assert.strictEqual(cls, 'strict', `${name}.md is a read-only judgment seat and must `
                + 'classify strict, not ' + cls);
        }
    }
    // The two positive controls on the other side of the line, so the derivation
    // above cannot pass by classifying everything.
    assert.strictEqual(agentLib.reviewAgentClass('claude-kit:qa-verifier'), 'gate');
    assert.strictEqual(agentLib.reviewAgentClass('claude-kit:implementer-opus'), null);
});

// The guard reads its policy class out of a shared library at the deny path, and
// a plugin cache can supply a library that loads while exporting nothing the
// caller wants: a partially updated or rolled-back cache is that shape. Allowing
// is the contract there, the guard failing open in front of every command a
// governed seat runs, so what a screen has to add is VISIBILITY: without it the
// call through an undefined export throws into the file-level catch and every
// tree-mutating command for every read-only seat is allowed in silence.
test('a classifier library missing its export allows the command and names the gap on stderr', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-guard-lib-'));
    try {
        fs.copyFileSync(GUARD, path.join(dir, 'readonly-agent-guard.js'));
        // The library loads and exports its other readings, which is what makes
        // this the skew case rather than the absent-library one the require's
        // own catch already answers.
        fs.writeFileSync(path.join(dir, 'kit-agent-identity-lib.js'),
            "'use strict';\nmodule.exports = { agentIdentity: () => null };\n", 'utf8');
        const res = spawnSync(process.execPath, [path.join(dir, 'readonly-agent-guard.js')], {
            input: JSON.stringify({
                tool_name: 'Bash',
                tool_input: { command: 'git commit -m x' },
                cwd: CWD,
                agent_type: STRICT
            }),
            encoding: 'utf8'
        });
        assert.strictEqual(res.status, 0,
            'a guard that cannot classify allows, which is this guard\'s documented contract');
        assert.match(res.stderr, /reviewAgentClass/,
            'the degraded state names the export it could not find, got: ' + JSON.stringify(res.stderr));
        assert.strictEqual(res.stderr.trim().split(/\r?\n/).length, 1,
            'the degraded state is one line, not a stack trace: ' + JSON.stringify(res.stderr));
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    // The control, withheld from the stub above: the same payload against the
    // library as shipped denies, so the allow is the missing export rather than
    // a payload the guard was never going to judge.
    assertDenied(STRICT, 'git commit -m x', GIT);
});
