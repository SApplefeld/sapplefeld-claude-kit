// The operating doctrine ships as two repo copies: the source,
// plugins/claude-kit/skills/operating-instructions/SKILL.md, and the mirror,
// home/claude-kit-doctrine.md. Every doctrine edit must land in both, and a
// review pass is how the copies have historically drifted, so parity is
// enforced here mechanically.
//
// Comparison unit: the skill's body after its YAML frontmatter block, against
// the mirror's whole content. The frontmatter strip has the same semantics as
// the doctrine-refresh hook's stripFrontmatter and the doctor's
// Get-DoctrineBody (drop a leading '---'-fenced block and one blank line
// after it); it is restated here rather than imported because those two run
// against the installed machine copies and neither is loadable from a test
// (the hook module runs main() and exits on load; the doctor is PowerShell).
// This test compares the repo copies, a pair neither of them checks.
//
// Line endings are normalized to \n and trailing newlines trimmed before
// comparing, so a CRLF/LF checkout difference can never fail a parity the
// content holds. Everything else is byte-exact.
//
// A second class of test lives below the doctrine-copy pins: presence-and-
// tracking checks that do not start from a doctrine bullet at all, but from
// a committed pointer in one file (a README map entry, a skill's own prose)
// naming another. Those close the same gap the doctrine pins close, a
// deletion or drift that a diff-blind review pass would not catch, for
// pointers that live outside the doctrine copies.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Every git call in this file goes through the kit's own guarded runner rather
// than a bare spawn, and the cross-surface retire-class sweep reads the files it
// walks through the bounded reader rather than a bare readFileSync. Neither claim
// reaches further than the call it is about, and each guard is used at exactly one
// site: readFileBounded and containedRealPath are called inside that sweep and
// nowhere else in this file. Every other read here goes to fs.readFileSync
// unbounded and uncontained, whether the path is named outright or walked by a
// sweep of its own, a few of them through the readRepoFile helper and most of them
// directly, and this comment says nothing about any of those.
//
// A checkout is the hostile surface for both boundaries. The runner spawns from
// the hooks directory, so a git binary sitting in the repository under
// measurement is never the one that runs; it hands the child an environment
// with every GIT_* key stripped, so an ambient GIT_DIR cannot redirect a
// listing at another repository; and it bounds the call with a timeout and an
// output ceiling. The reader bounds what one file may pull into the process, and
// containedRealPath refuses a path that resolves outside this checkout.
const { gitRun } = require(path.join(__dirname, '..', 'plugins', 'claude-kit',
    'hooks', 'kit-git-lib.js'));
const { readFileBounded, containedRealPath } = require(path.join(__dirname, '..',
    'plugins', 'claude-kit', 'hooks', 'kit-read-lib.js'));

// The bound every git call in this file passes explicitly, wider than the shared
// runner's 4 s default for the reason the repository's size reader states at its
// own reader-wide figure: a question about a whole repository outlasts the
// per-file question a hook asks, and both calls here are that kind of question.
// The index listing runs `ls-files --error-unmatch` over one path and the sweep
// runs `ls-files` over the tracked tree, and neither reads a file: what each one
// waits on is git loading the index of a repository whose size nothing here
// bounds, on a machine whose one heavy-process slot a suite shares with whatever
// else holds it. A bind on the default is a red about git under contention rather
// than about the tree, which is the one failure neither call can report usefully.
const SWEEP_GIT_TIMEOUT_MS = 20000;

const SKILL = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
    'operating-instructions', 'SKILL.md');
const MIRROR = path.join(__dirname, '..', 'home', 'claude-kit-doctrine.md');

function stripFrontmatter(text) {
    const lines = text.split('\n');
    if ((lines[0] || '').trim() !== '---') return text;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end === -1) return text;
    return lines.slice(end + 1).join('\n').replace(/^\r?\n/, '');
}

function normalize(text) {
    // \n* rather than \n+: with \n+ the substitution only fires when a
    // trailing newline exists, so a copy saved without a final newline would
    // fail parity against identical content, which is the line-ending noise
    // this normalization exists to remove.
    return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
}

function skillBody() {
    return normalize(stripFrontmatter(fs.readFileSync(SKILL, 'utf8').replace(/^\uFEFF/, '')));
}

function mirrorBody() {
    return normalize(fs.readFileSync(MIRROR, 'utf8'));
}

// The failure this check exists to catch is a commit that omits a newly
// created file: git ls-files --error-unmatch asserts the path sits in the
// index, so an ordinary pathspec-less commit taken from this state carries
// it, and the never-added case, a file created and forgotten, reddens here
// on the machine that wrote it rather than only on some later fresh
// checkout, and this repo runs no CI to be that checkout. What it cannot
// see: a `git commit <pathspec>` that stages other paths and excludes this
// already-added one leaves the path in the index and out of HEAD, and
// nothing local catches that. Asserting against HEAD instead would close
// that gap but would also redden during the section that creates the file,
// before its commit lands, which is the normal shape of every skill-adding
// section in this repo, so the check stays scoped to the index.
// The call runs through the shared runner named at its require above, which
// answers with a status rather than throwing, so the throw this helper's callers
// rely on is raised here: an untracked path and a git that could not answer at
// all are both failures, since a reading nobody took is no evidence that the
// path sits in the index.
function assertTrackedInIndex(relPath) {
    const res = gitRun(path.join(__dirname, '..'),
        ['ls-files', '--error-unmatch', '--', relPath],
        { timeoutMs: SWEEP_GIT_TIMEOUT_MS });
    assert.ok(res, 'git could not be asked whether ' + relPath + ' sits in the '
        + 'index, so this check is silent for a reason that is not a tracked path');
    assert.strictEqual(res.status, 0, relPath + ' is not in the git index: a file '
        + 'created and never added is present for whoever wrote it and absent from '
        + 'every other checkout, and this repo runs no CI to be that checkout');
}

// One field-set derivation, shared by the claim-file pin and the
// registry-entry pin over docs/architecture.md. The token class admits a
// digit and a lowercase tail after the leading letter, wider than today's
// field names on purpose: a derivation narrower than the tokens it must
// see is how a future field such as `Retry2:` goes invisible to BOTH
// sides at once, a one-sided addition of it then passing green, which is
// the class both comparisons exist to catch.
const backtickedFieldSet = (text) => [...new Set(
    text.match(/`[A-Za-z][A-Za-z0-9-]*:`/g) || [])].sort();

test('the two doctrine copies are byte-identical (skill body vs mirror)', () => {
    assert.strictEqual(mirrorBody(), skillBody(),
        'home/claude-kit-doctrine.md has drifted from the operating-instructions '
        + 'skill body; the skill is the source, so sync the mirror to it');
});

// Whole-body identity would still pass with the memory-extension pointer
// bullet deleted from both copies, so its presence is pinned separately:
// exactly one line in each copy opens with the bullet's lead, and the two
// lines match byte for byte.
test('the memory-extension pointer bullet is present once in each copy and identical', () => {
    const lead = '- **The kit memory store has an extension layer';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one memory-extension bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one memory-extension bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
});

// Same reasoning as above, and load-bearing for a second reason: the
// executing-work and finishing-work skills both point at this bullet as the
// authorization for their Workflow reviewer dispatch. A symmetric deletion of
// the Workflow grant would pass whole-body identity while silently falsifying
// both of those committed pointers, so the grant's presence is pinned here
// rather than left to the bodies matching each other.
test('the standing-dispatch bullet is present once in each copy, identical, and carries the Workflow grant', () => {
    const lead = '- **Dispatch is requested standing';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one standing-dispatch bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one standing-dispatch bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
    assert.match(inSkill[0], /covers the Workflow tool/,
        'the standing-dispatch bullet no longer grants the Workflow tool, but '
        + 'executing-work and finishing-work both cite it as the authorization '
        + 'for their reviewer-effort dispatch; restore the grant or remove those '
        + 'pointers');
    // Matched on the requiring phrase rather than the bare field name: a rewrite
    // that mentions agentType while making it optional would pass /agentType/ and
    // still drop the condition, and this assertion is the only mechanical trace
    // over a requirement nothing else enforces (no hook matches the Workflow tool).
    assert.match(inSkill[0], /naming an `agentType` the read-only guard governs/,
        'the Workflow grant no longer requires an agentType the read-only guard '
        + 'governs, which is the condition that keeps a Workflow-dispatched '
        + 'reviewer from holding write access to the tree under review');
});

// Whole-body identity passes with the authorization bullet edited symmetrically
// in both copies, which is exactly how this bullet has been got wrong: it is the
// always-loaded rule deciding when a session may take an irreversible or outward
// action, and the flip that made commit and push the default turned four of its
// clauses load-bearing at once. Each assertion below is a bound a plausible later
// edit would drop while leaving the bullet present and grammatical. Per the
// rule that a pin over a bounded list asserts its members, the sentence scoping them to their class, and the sentence closing the set, the override set is pinned at the
// sentence that scopes it and not only at its members: re-adding Branch-and-PR to
// that list is the regression a review round actually caught, and it leaves every
// other pinned phrase in place.
test('the authorization bullet keeps its default, its override set, and its bounds in each copy', () => {
    const lead = '- **Name the rollback and stop for a yes before any irreversible or outward action.**';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one authorization bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one authorization bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
    const bullet = inSkill[0];

    // The quantifier, not just the members. Review-Only is the whole of the
    // plan-model override set; Branch-and-PR pushes to its own branch and so
    // performs the default.
    assert.match(bullet, /What overrides that default: a plan marked Review-Only, and my asking in the session to leave the work uncommitted so I can read it\./,
        'the override set no longer reads as Review-Only alone; a set that '
        + 'admits Branch-and-PR tells a session under that model to skip the '
        + 'first-green commits executing-work calls its recovery points');
    assert.match(bullet, /Branch-and-PR is not an override but an instance of it/,
        'the bullet no longer says Branch-and-PR performs the default rather '
        + 'than overriding it');
    assert.match(bullet, /the session cutting one first where the checkout sits on a trunk/,
        'Branch-and-PR no longer tells a session on a trunk to cut a feature '
        + 'branch first, so the default sentence two clauses earlier (push the '
        + 'branch you are working from) routes it into pushing the trunk, which '
        + 'is the merge gate this model exists to keep');

    // The exemption is pinned as an assignment rather than as a list of acts,
    // and the shape is the point. An enumeration of the acts a commit model
    // performs is an unpinned cross-file assertion: this test never opens
    // finishing-work or executing-work, so every act named here would carry
    // zero mechanical coverage while the pin made it look frozen. Assigning
    // the question to the owning skill has no such gap, and the floor below is
    // what keeps that assignment from handing an open category to editable
    // skill text.
    assert.match(bullet, /which acts a model performs is the owning skill's to state and never this bullet's/,
        'the exemption no longer assigns the act list to the owning skill, so '
        + 'the bullet is back to naming acts nothing here can verify');
    assert.match(bullet, /reaches nothing outside the model's own execution and no statement of a model widens it/,
        'the exemption no longer closes, so a skill widens it by restating its '
        + 'own commit model more broadly');
    assert.match(bullet, /no model reaches a deploy or a force push/,
        'the floor no longer bars a deploy and a force push, which is what stops '
        + 'the assignment from handing an open category to editable skill text');
    assert.match(bullet, /a push that triggers a deploy keeps the deploy's yes/,
        'a deploy triggered by a push no longer keeps the yes the same bullet '
        + 'still requires for a deploy');

    // The fail-open a garbled commit-model header would otherwise take: the
    // header parser whitelists three literals and reports anything else as
    // unknown, which without this clause falls through to the push default.
    assert.match(bullet, /absent or reads as none of the three the kit defines takes the ask/,
        'a plan doc whose commit model is absent or unrecognized no longer '
        + 'takes the ask, so a mistyped header silently authorizes a push');

    // The rail clause: the fail-closed half and the delegation bound. Section 1
    // built the rail on the promise that an owning skill states every surface.
    assert.match(bullet, /a grant whose owning skill names none authorizes nothing here/,
        'the standing-grant clause no longer fails closed, so a grant whose '
        + 'owning skill names no surface would authorize action here');
    assert.match(bullet, /delegation never covers a push beyond a plan's recorded commit model/,
        'the delegation bound has left the doctrine; role/SKILL.md still states '
        + 'it as an exclusion and this is the always-loaded copy of it');
    assert.match(bullet, /the rail's delegation instance names no surface this bullet gates/,
        'the delegation clause no longer states that delegation names no surface '
        + 'this bullet gates; role/SKILL.md refuses the complementary reading a '
        + 'clause bounded by the exclusion list invites');
    assert.match(bullet, /its scope being planning, scoping, sequencing and dispatching execution of sections of plans whose arming the dispatch-authority rail covers/,
        'the delegation scope has been stated wider than role/SKILL.md states '
        + 'it; role bounds dispatching to sections of plans the rail arms and '
        + 'excludes dispatch on content a message itself carries, so a bare gerund here '
        + 'tells a delegated seat the wider thing on the always-loaded surface');

    // The default itself, which this test is named for. Every clause above only
    // bounds it, so a rewrite dropping the default would leave them bounding
    // nothing while every other predicate here stayed green.
    assert.match(bullet, /Commit and push are the default: land the work on the branch you are working from and push it/,
        'the commit-and-push default has left the bullet, so the override set, '
        + 'the exemption bound and the header clause now bound a default that is '
        + 'no longer stated');

    // The rail is read at the act, off the governing skill, never off the record.
    assert.match(bullet, /read at the act rather than assumed from the record/,
        'a standing grant no longer has to be read at the act, so a record that '
        + 'has gone stale would authorize on its own');
    assert.match(bullet, /whose body can neither widen nor narrow what that skill states/,
        'the record-body-is-data clause has left the doctrine; role/SKILL.md '
        + 'states it and this is the always-loaded copy of it');

    // The opening enumeration, pinned at its closing quantifier and not only
    // at a member, on the rule that a pin over a bounded list asserts its members, the sentence scoping them, and the sentence closing the set. The quantifier
    // is what reaches every act the members do not name, and force push is
    // pinned inside the list rather than anywhere in the bullet, since dropping
    // 'push' from this enumeration must not have dropped a force push with it.
    assert.match(bullet, /Delete, overwrite, migrate, deploy, send, `pnpm patch`, force push, or any write to shared, global, or native state - including a live draft on a remote service:/,
        'the opening enumeration is no longer the exact closed set it must be. '
        + 'Pinned whole from its first member rather than at its tail, because '
        + 'the tail alone stays green when commit and push are put back into the '
        + 'list, which would have the bullet gate an act it declares the default '
        + 'three sentences later, and because the closing quantifier is what '
        + 'reaches every act the members do not name');
});

// Whole-body identity would pass with the checkpoint sentence deleted from
// BOTH copies, and three shipped surfaces lean on the doctrine carrying it:
// the chapter-boundary nudge hook, the Stop hook's hold reasons, and the
// compaction gate's operator note each reinforce a rule that the
// always-loaded layer would no longer state. A symmetric deletion would
// leave those three pointing at nothing while the suite stayed green, so the
// sentence's presence inside the chapter-close bullet is pinned here.
// The Gate duty is stated in the doctrine and discharged in the Chapter
// template, two surfaces that were pinned by two independently hand-copied
// literals linked by no shared phrase, so a reword of either left them stating
// different requirements with both assertions green. This is the one phrase
// both surfaces must word alike, and both pins below read it from here: the
// doctrine's requirement is this string in its own sentence, and the template
// asks the writer for the same thing in the same words.
const exitCodeDuty = 'the exit code read from the run itself';

// The plural is the second phrase both surfaces must word alike, for the same
// reason the exit-code duty is: a section close can run the contention lane
// beside the targeted one, so a surface admitting one lane and a surface
// admitting several state different requirements while both read as coverage.
const lanePluralDuty = 'the lane or lanes';

test('the chapter-close bullet names the compaction checkpoint in each copy', () => {
    const lead = '- **Close each section with a Chapter.**';
    for (const [label, body] of [['skill body', skillBody()], ['doctrine mirror', mirrorBody()]]) {
        const lines = body.split(/\r?\n/).filter((l) => l.startsWith(lead));
        assert.strictEqual(lines.length, 1,
            'expected exactly one chapter-close bullet in the ' + label);
        assert.ok(lines[0].includes('the compaction checkpoint is opened'),
            'the chapter-close bullet in the ' + label + ' must name the compaction '
            + 'checkpoint as part of closing a section on a leashed run');
        assert.ok(lines[0].includes('kit-compact-checkpoint.js open'),
            'the chapter-close bullet in the ' + label + ' must name the command, '
            + 'because its audience is a session that never loaded executing-work '
            + 'and so cannot follow a pointer to it');
        assert.ok(lines[0].includes(lanePluralDuty + ' that gated it with their '
            + 'counts and ' + exitCodeDuty),
            'the chapter-close bullet in the ' + label + ' must require the '
            + 'Chapter to name every lane that gated the section. Section close '
            + 'runs the targeted lane, with the contention lane beside it where '
            + 'the delta touched machine-shared state, so a Chapter that reports '
            + 'a bare green, or one lane where two ran, says nothing about how '
            + 'much of the tree that green covered, which is what a later '
            + 'collateral-red diagnosis reads');
    }
});

// The gate bullet is the third surface stating the section-close lane duty,
// and it was the one surface no pin read, which is how it kept the singular
// while the chapter-close bullet and the Chapter template both moved to the
// plural. A section close runs the targeted lane, with the contention lane
// beside it where the delta touched machine-shared state, so a bullet
// admitting one lane asks for less than the two surfaces that discharge it.
test('the gate bullet admits every lane a section close runs, in each copy', () => {
    const lead = '- **After each step, run the lane the moment calls for, and report the delta.**';
    for (const [label, body] of [['skill body', skillBody()], ['doctrine mirror', mirrorBody()]]) {
        const lines = body.split(/\r?\n/).filter((l) => l.startsWith(lead));
        assert.strictEqual(lines.length, 1,
            'expected exactly one gate bullet in the ' + label);
        assert.ok(lines[0].includes('names ' + lanePluralDuty + ' that ran'),
            'the gate bullet in the ' + label + ' no longer admits more than '
            + 'one lane at a section close, while the chapter-close bullet and '
            + 'the Chapter template both do, so the three surfaces state '
            + 'different requirements and a Chapter naming both lanes '
            + 'over-reports against this bullet while one naming a single lane '
            + 'under-reports against the other two');
    }
});

// The duty above is stated in the doctrine and discharged in the Chapter
// template, which is the field list an executing session actually fills. A
// template missing the field yields Chapters that satisfy the template and
// violate the doctrine, and nothing else in this file reads the template. The
// match is anchored to a line-leading field name so a passing mention of the
// word gate elsewhere in the skill cannot stand in for the template slot.
test('the Chapter template carries the gate field the doctrine requires', () => {
    const executingWork = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8');
    const field = executingWork.split(/\r?\n/).find((l) => l.startsWith('Gate: <'));
    assert.ok(field, 'the Chapter template in executing-work no longer carries '
        + 'a Gate field, so a Chapter written from it records no lane and the '
        + 'chapter-close bullet\'s requirement has no carrier at the point of '
        + 'writing');
    assert.ok(field.includes(lanePluralDuty + ' that ran'),
        'the Chapter template\'s Gate field no longer admits more than one '
        + 'lane, while the contention lane runs beside the targeted one at a '
        + 'section close whose delta touched machine-shared state, so a '
        + 'Chapter filled from it reports one of the two runs and reads as '
        + 'though the other never happened');
    assert.ok(field.includes(exitCodeDuty),
        'the Chapter template\'s Gate field no longer asks for ' + exitCodeDuty
        + ', the phrase the doctrine\'s chapter-close bullet states the duty '
        + 'in. The two surfaces are pinned on this one shared string so a '
        + 'reword of either reddens rather than leaving them asking for '
        + 'different things');
    assert.ok(field.includes('the code itself rather than a statement that it '
        + 'was read'),
        'the Chapter template\'s Gate field asks for an attestation rather '
        + 'than a value, so a Chapter filled from it records no exit code and '
        + 'the doctrine\'s requirement goes undischarged by its only carrier');
});

// The close gate's place in the section loop is a cross-step invariant inside
// one file, and nothing else pins it. Step 2 runs its targeted lane, step 3
// dispatches the reviewers over the state that run verified, step 4 lands
// their fixes and runs the close gate,
// and step 4's fold predicate spends that gate ("the gate you are about to run
// covers it"). A rewrite that moves the gate back beside the review round
// reads fine in isolation while leaving every review fix and every folded
// surface outside the only gate the section runs, and the fold predicate with
// no gate left that could satisfy it.
test('executing-work runs the section close gate after the review fixes', () => {
    const executingWork = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8');
    assert.ok(executingWork.includes('**This step runs the section\'s close '
        + 'gate, once the fixes and the folds are in.**'),
        'executing-work step 4 no longer names itself as the step that runs '
        + 'the section\'s close gate, so the loop schedules that gate nowhere '
        + 'and the section closes on step 2\'s pre-review run');
    assert.ok(executingWork.includes('That run is what the fold predicate '
        + 'below means by the gate you are about to run'),
        'step 4 no longer ties its close gate to the fold predicate that '
        + 'spends it, so "the gate you are about to run" has no antecedent in '
        + 'the step that states it');
});

// The two liveness bullets defer their whole operative content to
// finishing-work: the wedge hallmark, the cadence, and the windows all live
// there, and standing-watch:75 makes a committed pointer back at the doctrine
// for the probe habit. Whole-body identity would pass with either bullet
// deleted from BOTH copies, leaving that pointer aimed at nothing and the
// always-on layer silent on the one rule that keeps a session from killing a
// working agent. The deferral is what earns the pin: a rule carrying its own
// content fails visibly when deleted, where this one fails by going quiet.
test('the liveness bullets defer to finishing-work in each copy', () => {
    const leads = [
        '- **Probe a dispatched agent with a message',
        '- **No completion notification is not a stall signal',
    ];
    for (const [label, body] of [['skill body', skillBody()], ['doctrine mirror', mirrorBody()]]) {
        for (const lead of leads) {
            const lines = body.split(/\r?\n/).filter((l) => l.startsWith(lead));
            assert.strictEqual(lines.length, 1,
                'expected exactly one bullet leading "' + lead + '" in the ' + label);
            assert.ok(lines[0].includes('finishing-work'),
                'the bullet leading "' + lead + '" in the ' + label + ' must name '
                + 'finishing-work as the owner of the wedge hallmark it defers to, '
                + 'because the bullet carries none of that rule\'s content itself');
        }
    }
});

// Same green-passing deletion path as the liveness pin above, one step further
// out, and it has two ends. The outline bullet keeps only the principle and
// routes every language anchor to the style skill that owns that language's
// idioms. Four surfaces carry the rule with it: executing-work's approach read
// names the doctrine bullet outright, and the three non-haiku implementer
// charters restate it locally and route to the same style skills, because a
// subagent inherits the doctrine only where the machine's CLAUDE.md carries
// the kit import. A symmetric deletion at either end passes the whole-body
// identity check while the chain goes quiet, so both ends are asserted: the
// bullet routes, the routed-to sections exist, and the four surfaces still
// carry their clause.
test('the outline bullet routes to the style skills in each copy', () => {
    const lead = '- **When you are hunting for something in a large file';
    for (const [label, body] of [['skill body', skillBody()], ['doctrine mirror', mirrorBody()]]) {
        const lines = body.split(/\r?\n/).filter((l) => l.startsWith(lead));
        assert.strictEqual(lines.length, 1,
            'expected exactly one outline bullet in the ' + label);
        for (const skill of ['csharp-style', 'sql-style']) {
            assert.ok(lines[0].includes('skills/' + skill + '/SKILL.md'),
                'the outline bullet in the ' + label + ' must route to ' + skill
                + ' by path, because the bullet carries no language anchors of '
                + 'its own and that skill is where they live');
        }
    }
});

test('the style skills the outline bullet routes to still carry a recipe', () => {
    for (const skill of ['csharp-style', 'sql-style']) {
        const p = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
            skill, 'SKILL.md');
        assert.ok(fs.existsSync(p), skill + ' is routed to by the doctrine\'s '
            + 'outline bullet and must exist');
        assert.match(fs.readFileSync(p, 'utf8'), /^## Outlining a large file$/m,
            skill + ' must carry its Outlining section: the doctrine points at '
            + 'it by path and carries no anchors of its own, so deleting the '
            + 'section leaves that pointer aimed at nothing');
    }
});

// The gate bullet and the authoring bullet are the outline bullet's shape
// applied to testing: each keeps the principle it alone owns and routes the
// mechanics to the testing-discipline skill. That deferral is what earns a pin
// beyond whole-body identity, since a symmetric deletion from both copies
// passes identity while the standing rule stops being stated anywhere and the
// skill it routed to becomes a file nothing points at.
//
// The gate bullet is the near end for the lane rule: the doctrine names the
// moments (the targeted lane after a fix and at section close, the whole gate
// at finishing before the plan's handoff, at an install-surface push, and
// after a merge) and carries none of the lane mechanics itself, so the pointer
// is the only path from the always-loaded layer to them.
test('the gate bullet routes its lanes to the testing-discipline skill in each copy', () => {
    const lead = '- **After each step, run the lane the moment calls for';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one gate bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one gate bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
    assert.ok(inSkill[0].includes('skills/testing-discipline/SKILL.md'),
        'the gate bullet must route to testing-discipline by path, because it '
        + 'names the gate moments and carries none of the lane mechanics itself');
    // The moments are the bullet's own content rather than the skill's, so a
    // rewrite that keeps the pointer while dropping one of them leaves the
    // always-loaded layer silent on the moment it dropped: without the targeted
    // lane every fix round is priced at the whole gate again, and without one of
    // the whole-gate moments a plan hands off, a push lands on the surface its
    // consumers install from, or a finishing pass runs on a lane too narrow to
    // support the claim it makes.
    for (const [phrase, why] of [
        [/targeted lane/, 'name the targeted lane, which a fix round and a '
            + 'section close alike take'],
        [/take the targeted lane, whatever the delta touched/,
            'state the invariant that a section close and a fix round alike '
            + 'take the targeted lane whatever their delta touched, which is '
            + 'the whole of what keeps those two moments off the whole gate'],
        [/at section close whenever the section's delta touched/,
            'name section close as the contention lane\'s own moment, run '
            + 'there whenever the section\'s delta touched machine-shared '
            + 'state'],
        [/at finishing/, 'name finishing, which is one half of the whole-gate '
            + 'moment the handoff phrase below names: this half says where '
            + 'that gate runs'],
        [/before the plan's handoff/,
            'name the plan\'s handoff, the other half of that same moment, '
            + 'which says what the gate is for. Finishing and the handoff are '
            + 'one moment rather than two, and it is the one that reads the '
            + 'whole tree on every plan whatever its trunk'],
        [/before a push/, 'name a push as a whole-gate moment, bounded by the '
            + 'install-surface condition'],
        [/only where that push lands on a trunk consumers install from directly with no CI gating the merge/,
            'state the install-surface condition that bounds the pre-push whole '
            + 'gate, without which every push is priced at the whole gate again'],
        [/merge takes the whole gate/,
            'name a merge as a whole-gate moment, since the redness a clean '
            + 'merge produces sits in files neither parent changed and the '
            + 'bullet\'s closing default would otherwise price a merge at a '
            + 'lane derived from its own diff, which cannot read that redness'],
    ]) {
        assert.match(inSkill[0], phrase, 'the gate bullet must ' + why
            + '; the pointer does not carry the moments, so a reader who never '
            + 'opens the skill has only this bullet to run a gate from');
    }
    // The pins above are presence-only, and a bullet that carries both cadences
    // at once satisfies every one of them: re-adding a section-close whole gate
    // or the shared-module condition beside the sentences that replaced them
    // reads as green while the always-loaded layer names two lanes for one
    // moment, and a reader takes the wider. The two moments therefore carry
    // absence assertions as well, since their removal is the change itself.
    for (const [phrase, why] of [
        [/whole gate at section close/i,
            'section close is a targeted-lane moment, so a bullet naming it as '
            + 'a whole-gate moment prices every section close at a full suite '
            + 'again'],
        [/shared module/,
            'a fix round takes the targeted lane whatever its delta touched, so '
            + 'a shared-module condition on the bullet reinstates the clause '
            + 'that fires on essentially every fix round in a repo with widely '
            + 'imported modules'],
    ]) {
        assert.doesNotMatch(inSkill[0], phrase, 'the gate bullet states a lane '
            + 'the cadence does not have: ' + why);
    }
    // The contention lane is named here rather than left to the skill because a
    // session reading only the always-loaded layer would otherwise run the whole
    // gate before a push, skip every test whose subject is machine-shared state,
    // and report green over the one area no other lane covers.
    assert.match(inSkill[0], /contention lane/,
        'the gate bullet no longer names the contention lane beside the whole '
        + 'gate, so a doctrine-only reader pushes on a gate that skipped the '
        + 'tests covering machine-shared state');
    // Lane-scoped baselines: a delta is only a delta against the same lane, and
    // this is the assertion standing between a 12-test targeted run and a "no
    // regressions" claim diffed against a whole-gate baseline.
    assert.match(inSkill[0], /baseline recorded on that same lane/,
        'the gate bullet no longer scopes the baseline to the lane that produced '
        + 'it, which licenses diffing a targeted run against a whole-gate '
        + 'baseline and reporting the difference as no regressions');
});

// Same shape at the authoring end: the bullet keeps independence-by-
// construction and routes the cost shapes, the wall-clock capture, and the
// comparable-contention rule to the skill that owns them.
test('the authoring bullet routes its cost shapes to the testing-discipline skill in each copy', () => {
    const lead = '- **Write tests independent by construction';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one test-authoring bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one test-authoring bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
    assert.ok(inSkill[0].includes('skills/testing-discipline/SKILL.md'),
        'the test-authoring bullet must route to testing-discipline by path: the '
        + 'spawn pricing, the wall-clock capture, and the comparable-contention '
        + 'rule live in that skill and in no clause of this bullet');
});

// The box-check rule is stated in full in both the doctrine and the skill, on
// purpose: it must be reachable by a session that never loads the skill, and a
// point-of-action restatement of a doctrine-adjacent rule is sanctioned. What
// the duplication costs is drift, so the two statements are pinned together
// here, at the sentence that does the work. The class sentence is the whole
// rule: a session that read the old engine list as the boundary checked the box
// exactly as written and started its suite beside a live gate in an engine the
// list did not name.
test('the box-check bullet states the class in each copy and in the skill', () => {
    const lead = '- **One heavy process at a time is a per-machine budget';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one box-check bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one box-check bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
    assert.match(inSkill[0], /instances, not the boundary/,
        'the box-check bullet no longer closes its engine list with the class, '
        + 'so `testhost`, `dotnet`, and `node --test` read as the boundary and a '
        + 'runner in an unnamed engine is licensed to run beside your suite');
    assert.match(inSkill[0], /whatever its engine/,
        'the box-check bullet no longer states the check engine-agnostically');

    // The skill's own box-check bullet is the same rule at the point of action.
    // Both halves of the ownership condition are pinned: it covers a process
    // owned by another session and one owned by a running engine, which is the
    // half a restatement drops first, since an engine holding the box is not a
    // session anyone thinks to look for.
    const skillPath = path.join(__dirname, '..', 'plugins', 'claude-kit',
        'skills', 'testing-discipline', 'SKILL.md');
    const boxLead = '- **Check the box before any suite.**';
    const inTesting = fs.readFileSync(skillPath, 'utf8').split(/\r?\n/)
        .filter((l) => l.startsWith(boxLead));
    assert.strictEqual(inTesting.length, 1,
        'expected exactly one box-check bullet in the testing-discipline skill');
    assert.match(inTesting[0], /whatever its engine/,
        'the testing-discipline skill\'s box check no longer states the check '
        + 'engine-agnostically, while the doctrine\'s copy of the same rule does');
    assert.match(inTesting[0], /running engine/,
        'the testing-discipline skill\'s box check no longer covers a process '
        + 'owned by a running engine, which the doctrine\'s copy of the same rule '
        + 'covers; the two are the same rule at two points of action and a '
        + 'session that loads only one of them must get the same check');

    // The instrument limit itself, which the substrings above cannot reach:
    // a surface can carry the engine-agnostic class in full and still
    // present the poll as the whole check, which is the divergence that
    // leaves one copy calling sufficient what the other calls insufficient.
    // The two carriers word the limit in their own registers, so each leg is
    // pinned on the shape both hold rather than on a literal one of them
    // happens to use, and every leg carries its own negating token: a
    // pattern matching `a sample and therefore a clearance`, or matching the
    // fan-out noun in a sentence saying the poll sees it, goes quiet on the
    // one rewrite that inverts the rule it is pinning. The spellings differ
    // per file, so the neighbour leg accepts both rather than forcing one
    // carrier onto the other's house spelling. The role skill states the
    // same blind spots and is deliberately not a third carrier here: it
    // words the limit as a property of the claim protocol rather than of a
    // pre-suite check, so it shares the fan-out leg and neither of the other
    // two, and its own pins sit below.
    for (const [label, pattern] of [
        ['the poll is a sample rather than a clearance',
            /poll is a sample[^.]*(rather than|never|not) a clearance/],
        ['a poll cannot see in-process agent fan-out',
            /cannot see in-process agent fan-out/],
        ['a poll cannot see a neighbour that starts after the sample',
            /cannot see a neighbou?r that starts after the sample and before/],
        ['a clean read licenses a spawn only alongside the claim protocol',
            /licenses a spawn only alongside the claim protocol/],
    ]) {
        assert.match(inSkill[0], pattern,
            'the doctrine box-check bullet no longer states that ' + label
            + ', so a session that loads only the doctrine performs exactly '
            + 'the check the skill calls insufficient');
        assert.match(inTesting[0], pattern,
            'the testing-discipline skill\'s box check no longer states that '
            + label + ', while the doctrine\'s copy of the same rule does');
    }

    // The cost asymmetry is the doctrine's alone and cannot ride the loop
    // above, which can only pin what both carriers already share. It is the
    // leg that says what to do with each reading, so a bullet that lost it
    // would state the limit and leave a reader to price it, and the two
    // readings price out in opposite directions: waiting on residue costs
    // bounded minutes, where starting into work the poll could not see costs
    // an unbounded collision. The role skill owns the line and the doctrine
    // states it here because the doctrine is the surface a session has
    // loaded when it decides whether to start.
    assert.match(inSkill[0], /drawn on cost rather than on evidence/,
        'the box-check bullet no longer prices its two readings against each '
        + 'other, so a clean poll reads as evidence for starting rather than '
        + 'as the sample the sentence before it says it is');
    assert.match(inSkill[0], /never a basis for starting/,
        'the box-check bullet no longer states that a clean read is never a '
        + 'basis for starting, which is the half the role skill calls '
        + 'unbounded in cost and the half a reader in a hurry drops first');
});

// The far end of both pointers above, in the shape the style-skill pin uses:
// the file exists, sits in the index, and still carries what each bullet defers
// to. The index check is what keeps the pointer honest across machines, since a
// target present but never added passes on the machine that wrote it and is
// absent on a fresh checkout.
//
// Headings alone are too coarse a far end: the near-end bullets promise named
// contents (a contention lane, a wall clock captured with the baseline, a
// contention figure beside it), and deleting any one of those leaves its
// heading standing and this pin green while the doctrine promises what the
// skill no longer carries. So the leads are pinned beside the headings.
// The test-earning bullet is the third doctrine pointer at this skill and it
// carries its own near end, which the far-end pin below cannot stand in for:
// with only that pin, deleting the pointer from both copies passes whole-body
// identity, leaves the skill's retire section standing and reddens nothing, so
// the always-loaded layer would name no owner for the retire classes with the
// suite green. The bullet's own content (write the failing test first, prove a
// flag both directions) stays its own, which is why only the deferred half is
// pinned here.
//
// One copy is read rather than two. The mirror is covered by the whole-body
// identity pin at the top of this file, which already fails on a bullet present
// in one copy and not the other, so a count over the mirror's own copies of this
// lead could only fail after that pin had already failed, which is the duplicate
// class the testing-discipline skill states.
test('the test-earning bullet routes its retire classes to the testing-discipline skill', () => {
    const lead = '- **Make the test earn its green.**';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one test-earning bullet in the skill body');
    assert.ok(inSkill[0].includes('skills/testing-discipline/SKILL.md'),
        'the test-earning bullet must route to testing-discipline by path: it '
        + 'states what a new test has to earn and defers the mirror question of '
        + 'what retires one already in the tree, so without the path the '
        + 'always-loaded layer names no owner for the retire classes');
    assert.match(inSkill[0], /retire/,
        'the test-earning bullet must still say what it defers: a bullet naming '
        + 'the skill by path while dropping the retirement question routes a '
        + 'reader to a section they have no reason to open');
});

test('the testing-discipline skill still carries what the doctrine routes to it', () => {
    const parts = ['plugins', 'claude-kit', 'skills', 'testing-discipline', 'SKILL.md'];
    const target = path.join(__dirname, '..', ...parts);
    assert.ok(fs.existsSync(target),
        'the doctrine\'s gate, test-authoring and test-earning bullets all route '
        + 'to a skill that is not on disk: ' + parts.join('/'));
    const body = fs.readFileSync(target, 'utf8');
    for (const heading of [/^## Price the shape at authoring$/m, /^## The lanes$/m,
        /^## The clock and the box$/m, /^## What retires a test$/m]) {
        assert.match(body, heading, 'the doctrine bullets route their lane '
            + 'mechanics, cost shapes, wall-clock capture, contention rule and '
            + 'retire classes here and carry none of that content themselves, so '
            + 'deleting this section leaves the pointer aimed at nothing: ' + heading);
    }
    for (const [lead, promised] of [
        ['- **The contention lane**', 'the contention lane the gate bullet runs '
            + 'beside the whole gate'],
        ['- **Capture the clock with the baseline.**', 'the wall-clock capture '
            + 'the test-authoring bullet defers here'],
        ['- **Record the contention beside the clock.**', 'the '
            + 'comparable-contention rule the test-authoring bullet defers here'],
        ['- **An implementation mirror**', 'the retire classes the '
            + 'test-earning bullet defers here, whose heading can stand with '
            + 'every class under it deleted'],
    ]) {
        assert.ok(body.split(/\r?\n/).some((l) => l.startsWith(lead)),
            'the testing-discipline skill no longer carries ' + promised
            + ', so the doctrine promises content the skill has dropped while its '
            + 'section heading still stands: ' + lead);
    }
    assertTrackedInIndex(parts.join('/'));
});

// The document-length bullet is the same deferral shape a third time, and it
// is pinned for the same reason: the bullet keeps the principle it owns (cover
// the substance, no filler) and routes the sentence-shape bars to
// `writing-skills`, so a symmetric deletion of the pointer and of the section
// it aims at passes whole-body identity while the bars stop being stated
// anywhere. Both ends are asserted here because a near-end-only pin greens on
// a pointer aimed at nothing and a far-end-only pin greens on a section
// nothing points at. Both ends means the near end and the far end of the
// pointer, and one doctrine copy is read for the near end: the mirror is
// covered by the whole-body identity pin at the top of this file, so a count
// over the mirror's own copies of this lead could only fail after that pin had
// already failed.
test('the document-length bullet routes its sentence-shape bars to writing-skills at both ends', () => {
    const lead = '- **Match a document\'s length to its job.**';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one document-length bullet in the skill body');
    assert.ok(inSkill[0].includes('skills/writing-skills/SKILL.md'),
        'the document-length bullet must route to writing-skills by path: it '
        + 'asks the length question of a document and defers the same question '
        + 'asked of a single sentence, so without the path the always-loaded '
        + 'layer names no owner for the sentence-shape bars');
    assert.match(inSkill[0], /sentence-shape bars/,
        'the document-length bullet must still say what it defers: a bullet '
        + 'naming the skill by path while dropping the sentence-shape bars routes '
        + 'a reader to a section they have no reason to open');

    const parts = ['plugins', 'claude-kit', 'skills', 'writing-skills', 'SKILL.md'];
    const target = path.join(__dirname, '..', ...parts);
    assert.ok(fs.existsSync(target),
        'the document-length bullet routes to a skill that is not on disk: '
        + parts.join('/'));
    const body = fs.readFileSync(target, 'utf8');
    assert.match(body, /^## What a sentence has to earn$/m,
        'writing-skills must carry the sentence-shape section the doctrine '
        + 'points at, since the doctrine carries no bar of its own: deleting '
        + 'the section leaves that pointer aimed at nothing');
    // The heading alone is too coarse for the same reason it is on the testing
    // pointer: the bar is three named parts, and deleting any one of them
    // leaves the heading standing while the doctrine promises what the skill
    // no longer carries.
    for (const [bar, promised] of [
        ['- **One idea.**', 'the one-idea bar with its twenty-word diagnostic'],
        ['- **The literal phrase.**', 'the literal-phrase bar and its '
            + 'definition of mannered prose'],
        ['- **A pointer where another site owns the rule.**', 'the pointing bar'],
    ]) {
        assert.ok(body.split(/\r?\n/).some((l) => l.startsWith(bar)),
            'writing-skills no longer carries ' + promised + ', so the doctrine '
            + 'promises a bar the skill has dropped while its section heading '
            + 'still stands: ' + bar);
    }
    assertTrackedInIndex(parts.join('/'));
});

// The Chapter template's Delta: field is a pointer with the same far-end gap,
// one surface out from the doctrine: it tells a session to run a script by
// path and quote what it prints, so deleting or renaming the script leaves a
// shipped instruction that throws for whoever follows it, with the suite green
// and the field still promising a reading. The field is the near end and the
// script is the far end, and the verb and the flags are pinned beside the path
// because a script that exists while the verb or a flag it is handed does not
// fails exactly the same way for the session following the field. Both are
// checked against the script's own module rather than against a substring of
// its source: the verb has to name something callable, and each flag has to
// survive the parser the script actually runs, which refuses an unknown flag
// outright instead of falling back to a default.
test('the Chapter template\'s Delta field still points at a size reader that exists', () => {
    const skillRel = 'plugins/claude-kit/skills/executing-work/SKILL.md';
    const skill = readRepoFile(skillRel);
    const field = skill.split(/\r?\n/).filter((l) => l.startsWith('Delta:'));
    assert.strictEqual(field.length, 1,
        'expected exactly one Delta: field in the Chapter template');
    const scriptRel = 'plugins/claude-kit/scripts/kit-size.js';
    assert.ok(field[0].includes('scripts/kit-size.js'),
        'the Delta: field must name the size reader by path, since a session '
        + 'reading the template has no other way to find the verb it is told '
        + 'to run');
    const verb = /kit-size\.js\s+([a-z-]+)/.exec(field[0]);
    assert.ok(verb, 'the Delta: field must name the verb it runs beside the '
        + 'script path, not the script alone');
    const target = path.join(__dirname, '..', ...scriptRel.split('/'));
    assert.ok(fs.existsSync(target),
        'the Delta: field names a script that is not on disk: ' + scriptRel);
    const reader = require(target);
    // An own property rather than any readable member: `typeof` alone accepts a
    // function inherited from Object.prototype, so a field naming `toString` as
    // its verb would satisfy a leg whose whole job is to establish that the
    // script exports that reading.
    assert.ok(Object.prototype.hasOwnProperty.call(reader, verb[1]),
        'the size reader has no own ' + verb[1] + ' member, so the Delta: field '
        + 'names a verb the script does not export; a member reached through '
        + 'Object.prototype is not a reading this script ships');
    assert.strictEqual(typeof reader[verb[1]], 'function',
        'the size reader exports no ' + verb[1] + ' reading, which is the verb the '
        + 'Delta: field tells a session to run, so the field ships an invocation '
        + 'that fails for whoever follows it');
    // Every flag the field's own invocation passes, put through the parser the
    // script runs on its command line. The token count is derived without the
    // flag pattern, by splitting the field on whitespace and keeping what still
    // begins with a hyphen once its surrounding backticks come off: a count taken
    // from the same pattern the loop reads would match at the same positions for
    // every input, so the comparison could not fail and a flag spelled in a form
    // the pattern misses would leave the loop short and the check silent. The
    // parser is handed each hyphen-led token verbatim, so a form the pattern
    // misses is either caught by the count or refused by the parser: the parser
    // refuses an unknown flag outright rather than ignoring it, and an
    // equals-joined flag is an unknown flag to it.
    // A token counts as hyphen-led on a leading dash followed by a letter or a
    // second dash rather than on the dash alone. The field is prose around a
    // backticked invocation, and house style puts a spaced hyphen where an em
    // dash would go, so a bare `-` token from an ordinary prose edit would
    // otherwise enter this count and red the comparison with a message about a
    // flag outside the pattern's reach. Both live flag forms still land here,
    // a single-letter flag and an equals-joined one included.
    const hyphenTokens = field[0].split(/\s+/)
        .map((token) => token.replace(/^`+/, '').replace(/`+$/, ''))
        .filter((token) => /^-[A-Za-z-]/.test(token));
    const flags = [...field[0].matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((m) => m[0]);
    assert.strictEqual(flags.length, hyphenTokens.length, 'the Delta: field '
        + 'carries ' + hyphenTokens.length + ' hyphen-led tokens ('
        + hyphenTokens.join(', ') + ') and the flag pattern reads ' + flags.length
        + ' of them (' + flags.join(', ') + '), so a flag the field passes sits '
        + 'outside the pattern\'s reach');
    for (const flag of hyphenTokens) {
        const parsed = reader.parseArgs([verb[1], flag, 'x']);
        assert.strictEqual(parsed.invalid, null, 'the size reader\'s argument '
            + 'parser refuses ' + flag + ' (' + parsed.invalidReason + '), which '
            + 'the Delta: field\'s own invocation passes: the parser refuses an '
            + 'unknown flag outright rather than ignoring it, so the field ships '
            + 'a call the script exits on');
    }
    assertTrackedInIndex(scriptRel);
});

// The cross-surface agreement pin over the retire classes. The failure it exists
// for is a class amended at the owner and left standing in a carrier nobody
// thought to re-read, which is a claims defect, and the closure for one of those
// is a predicate over the class rather than more prose, so this is that
// predicate.
//
// It is matched on the class's shape and not on a file list, because a list
// cannot reach a carrier nobody named: a carrier is any paragraph in the
// tracked tree naming CARRIER_FLOOR or more of the class heads, which is what
// separates an enumeration of the classes from prose that happens to use one of
// the heads that are also ordinary English.
//
// The heads and the definitions are derived from the owner's own class bullets
// rather than typed here, so this instrument holds no copy of the vocabulary it
// is policing: a hand-written head list is itself a carrier of the classes,
// which makes the pin flag its own text and, worse, gives the owner's wording a
// second home that can go stale exactly the way the carriers can.
//
// Each class's own derived pattern is asserted against the owner's enumeration
// below, per class rather than over the set: with one head's pattern degraded
// the remaining ones still select every paragraph the sweep reads, so that class
// would drop out of the judgment with every leg green.
//
// What the sweep does not reach, stated because a silent check that never speaks
// reads exactly like a clean one:
//
//   - a carrier restating a class in a paraphrase using none of the heads, which
//     no structural pattern over the class's shape reaches, since the shape is
//     the naming;
//   - a carrier naming fewer heads than CARRIER_FLOOR, which sits below the
//     floor unjudged, and a surface quoting one class verbatim is the ordinary
//     shape of a targeted pointer, so this is the widest class the pin leaves
//     alone;
//   - a class deleted at the owner while a carrier goes on naming it beside every
//     class that survived. A selected unit is held below to the owner's whole
//     enumeration, so a class renamed at the owner leaves every carrier still
//     spelling the old head one short and red, and a class added at the owner
//     reds every carrier until it is brought up to date; a deletion is what that
//     count cannot see, since the carrier's surviving heads still number the
//     owner's classes and the deleted head is compared against nothing. What
//     catches a deletion is the amendment at the owner carrying its carriers with
//     it. And the whole-enumeration bar reaches only a unit the floor selects: a
//     carrier left with fewer than CARRIER_FLOOR of the owner's current heads by a
//     rename or a deletion drops out of the selection and is the bullet above,
//     unjudged whichever way it spells the rest;
//   - a definition of a tailless class reworded while still carrying every word
//     of the owner's own definition clause, since that comparison is over the
//     words the clause uses rather than over its wording;
//   - a carrier naming a class the owner qualifies with a tail exactly as the
//     owner states it, while the prose beside that name states a stale
//     qualification or drops a carve-out the owner holds. The leg for such a
//     class compares the name and stops, so what it covers is the qualifier
//     itself, the qualifier being part of the name the comparison reads; a
//     drifted sentence next to a correctly spelled name is outside the
//     judgment. Extending the definition comparison to a tailed class is not
//     the repair: the owner's name IS its qualifier, so the comparison already
//     reads it, and a wider one would red on the ordinary shape of a pointer;
//   - the Chapters region of a document under `docs/plans/`, cut below with its
//     reason and so judged nowhere: append-only history quotes a retired wording
//     as its subject, and a Chapter naming three class heads would be a red with
//     no repair in scope, since history is not rewritten. The region above that
//     heading is judged like any other document, which is what keeps a live plan's
//     own body in reach;
//   - every document under `docs/archive/`, exempt whole below with its reason
//     rather than cut at a heading. An archived document is append-only in the
//     same way a Chapter is, its body as much as its history: a red in an archived
//     spec's own prose has no repair in scope either, and the root also holds
//     documents carrying no `## Chapters` heading to cut at;
//   - an enumeration spread across the items of one list. Where no single item
//     clears CARRIER_FLOOR the judged unit falls back to the whole block, and a
//     pointer in any item then satisfies the owner-naming leg for all of them;
//     where some unrelated item clears the floor on its own, the units are
//     per-item and a pair of sibling items naming fewer than CARRIER_FLOOR heads
//     each escapes the judgment entirely. An ordered-list enumeration (`1.`, `2.`)
//     is one block whichever way it falls, since the per-item split reads a `-` or
//     a `*` lead and no numeral;
//   - a run that judges far fewer files than the tree holds while recording a
//     cause for every one it dropped. The partition sum holds over such a run
//     by construction, since it is satisfied by any complete accounting, and
//     the two witnesses below establish that one named path was judged and that
//     the judgment selected a carrier at another, rather than that the
//     population was judged: a sparse checkout, or a tree whose files bind on
//     the ceiling, passes all three legs so long as it still holds the two
//     witness paths. What the three do catch is a path leaving the loop with no
//     record at all, which is the shape a future exit added here would take,
//     and a judgment that selects nothing inside the loop, which is the shape
//     an emptied read or a broken predicate takes. A bound on the population
//     would be a threshold nothing derives, which is the count pin this plan
//     retires;
//   - a carrier written into a file that is not yet in the index, the swept
//     population being `git ls-files`: a stale carrier in a new file is unjudged
//     until the file is added, and no assertion here reads the worktree;
//   - a tracked file larger than SWEEP_FILE_MAX_BYTES, which is a counted skip
//     below rather than a red. The counted form is what keeps a future image or
//     captured corpus from redding this pin for something it does not own, and its
//     residue is a document over the ceiling whose prose is genuinely this sweep's
//     subject: such a file leaves the judgment as a named skip. Nothing tracked is
//     near the ceiling today;
//   - and the file this pin lives in, exempt below on its tracked path with its
//     reason and skipped a second time on this module's own resolved path, because
//     a sweep for a text pattern otherwise always finds the fixture it sweeps
//     with; a stale carrier written into this file is outside the pin's reach. The
//     two removals are not redundant and are not the same kind: the tracked path
//     is the named exemption the closed list is compared against, and the resolved
//     path is a counted skip that catches this file reached under a link the
//     listing does not carry, which is a link alias rather than an exemption and
//     so is reported as its own skip cause.
const RETIRE_OWNER = 'plugins/claude-kit/skills/testing-discipline/SKILL.md';

// The owner's own directory segment, which is the token a carrier names it by.
// Derived from the path above rather than spelled a second time, so this
// instrument holds no copy of the vocabulary it polices and a rename of the
// owning skill moves both the read and the pointer test with one edit.
const RETIRE_OWNER_SEGMENT = RETIRE_OWNER.split('/').slice(-2)[0];

// A ceiling on what one file contributes to the sweep, which is what keeps a
// tracked file of any size from pulling an unbounded buffer into this process. A
// read that binds on it leaves the file out of the judgment, so it is a counted
// skip named with its cause rather than a red: the ceiling is a property of this
// process rather than a rule about the tree, and the first tracked file of any
// kind over it would otherwise red this pin for something it does not own. The
// tail nobody read is what the skip records.
const SWEEP_FILE_MAX_BYTES = 4 * 1024 * 1024;

// Three is what separates an enumeration of the classes from prose that happens
// to use one of the heads that is also ordinary English, and it is the number
// the owner's own enumeration is measured against below rather than a figure
// restated anywhere else. It is declared above its first reader rather than
// below it: the readers run inside test callbacks today, so a later module-scope
// call would be the thing that turned a hoisting order into a ReferenceError.
const CARRIER_FLOOR = 3;

// The sweep's reach evidence is the partition below rather than a floor on how
// many files it read. Every judgment it makes lives inside the loop over the
// listing, so a path leaving that loop unrecorded is a file the sweep is silent
// about while reporting the same clean result as a tree with no carrier in it,
// and a floor loose enough not to red when a few files are retired cannot see
// one: a floor set a hundred paths under the tracked population lets a third of
// the tree drop out with every leg green. What stands in its place is an exact
// partition. Every listed path lands in exactly one of judged, exempted or
// skipped, the three counts are asserted to sum to the listing's own length, and
// each skip is named with its cause in that assertion's message, so a branch
// added later that removes a path without recording it breaks the sum.
//
// The one thing the partition cannot establish is that anything was read at all,
// since the sum holds equally over a run whose every path was skipped. A witness
// path is what says the loop reached a real file: this one is tracked, sits under
// no exempt root and no journal root, and is already a path this file names
// outright, so it is derived from the tree rather than being a second figure to
// keep in step with it.
const SWEEP_JUDGED_WITNESS = 'home/claude-kit-doctrine.md';

// A judged path says the loop read a file and says nothing about what the
// judgment did with it: a path is recorded as judged before any carrier is
// selected from it, so a run whose predicate selects nothing at all records
// every path as judged and reads exactly like a clean tree. The second witness
// is a path the judgment must select a carrier from, and it is a carrier by
// contract rather than by observation: the adversarial reviewer's charter
// carries the retire-class duty, which names every class the owner states and
// points at the owner for their definitions, so a tree in which the predicate
// selects nothing there is one in which either the charter has stopped
// enumerating the classes or the predicate has stopped selecting an
// enumeration, and both are this pin's own subject.
const SWEEP_CARRIER_WITNESS = 'plugins/claude-kit/agents/adversarial-reviewer.md';

// A crude stem, so an inflection is not a disagreement: the trailing plural,
// past or participle ending comes off any word long enough to still be a word
// without it. It is applied to both sides of every comparison below, so the two
// sides agree about what a word is even where this reduces one to something no
// dictionary holds.
function stemWord(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    return w.length < 5 ? w : w.replace(/(?:ing|es|ed|s)$/, '');
}

function stemsOf(text) {
    return new Set(text.split(/[^A-Za-z'-]+/).filter(Boolean).map(stemWord));
}

// Regex metacharacters in text read out of the owner. The class names carry none
// of them, and the escape is what keeps that from being the reason this works: the
// owner's file is edited by every amendment to these classes, and a name gaining
// a dot or a star would otherwise widen or narrow the pattern silently, which is
// the same silence the coverage statement above exists to prevent.
function escapeForPattern(text) {
    return text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

// A class is its full name as the owner states it, its head is the first two
// words of that name, and its definition is the clause the owner states after
// it. All three are read off the owner, so the vocabulary lives in one place and
// this file names none of it. `tail` says whether the name carries anything past
// its head: where it does not, matching the head is matching the name, and the
// definition clause is the only thing left to compare a carrier against.
function ownerRetireClasses() {
    const body = readRepoFile(RETIRE_OWNER);
    const section = body.split(/^## /m).find((s) => s.startsWith('What retires a test'));
    assert.ok(section, RETIRE_OWNER + ' no longer carries a '
        + '"What retires a test" section for the classes to be read from');
    const stated = [...section.matchAll(/^- \*\*(?:An?|The)\s+([^*]+?)\*\*:\s*([^\r\n]*)$/gm)]
        .map((m) => ({ name: m[1].trim(), def: m[2].trim() }));
    assert.ok(stated.length >= CARRIER_FLOOR, 'the owner states ' + stated.length
        + ' retire classes, fewer than the ' + CARRIER_FLOOR + ' a paragraph '
        + 'must name for this predicate to select it, so the predicate can no '
        + 'longer select even the owner and its silence would mean nothing');
    // The derivation above reads a class bullet in one shape, an article and a
    // bold name and a colon, and a bullet outside that shape is dropped in
    // silence. The floor alone cannot see one drop: five classes minus one still
    // clears three, and every carrier of the dropped class then goes unjudged,
    // which is the amend-the-owner-and-leave-a-stale-carrier defect this whole
    // pin exists for. So the derived count is held to the section's own list
    // items, counted on the class shape's own outer form rather than on the
    // parse: an article and a bold open. Counting every list item instead would
    // put a non-class bullet into the comparison, so promoting the section's
    // shape-bar paragraph to a bullet, or adding any other bullet under the
    // heading, would red with a message asserting that a class bullet had fallen
    // outside the derivation.
    const bullets = section.split(/\r?\n/)
        .filter((l) => /^- \*\*(?:An?|The)\s/.test(l)).length;
    assert.strictEqual(stated.length, bullets, 'the owner\'s retire section holds '
        + bullets + ' list items and ' + stated.length + ' of them parse as retire '
        + 'classes, so a class bullet sits outside the shape this derivation reads '
        + '(an article, a bold name, a colon) and every carrier of that class is '
        + 'unjudged below while every other leg stays green');
    return stated.map(({ name, def }) => {
        const words = name.split(/\s+/);
        const head = words.slice(0, 2).join(' ');
        const escaped = escapeForPattern(head);
        return {
            name,
            head,
            def,
            tail: name.toLowerCase() !== head.toLowerCase(),
            // The words of the definition clause that carry a subject of their
            // own, taken as every word of five letters or more. Shorter ones are
            // dropped rather than listed as stopwords: nothing this comparison
            // needs turns on "a", "the" or "is", and a stopword list is one more
            // thing that would have to be kept in step with the owner.
            defWords: [...new Set(def.split(/[^A-Za-z'-]+/)
                .filter((w) => w.length >= 5).map(stemWord))],
            // Bounded at both ends in either form. A multi-word head left
            // unbounded matches inside a longer word at either edge, so a head
            // of "count pin" selects "discount pinning" and the carrier reds for
            // naming a class it never mentions.
            re: words.length === 1
                ? new RegExp('\\b' + escaped + '(s|d|ed|es)?\\b', 'i')
                : new RegExp('\\b' + escaped.replace(/ /g, '\\s+') + '\\b', 'i'),
            every: words.length === 1
                ? new RegExp('\\b' + escaped + '(s|d|ed|es)?\\b', 'gi')
                : new RegExp('\\b' + escaped.replace(/ /g, '\\s+') + '\\b', 'gi'),
        };
    });
}

// The carrier predicate, applied to the tracked tree, to the owner as its own
// instrument check, and to the withheld controls below. Keeping it one function
// is what makes the controls evidence about this predicate rather than about a
// second one written to resemble it.
function retireClassCarriers(text, classes) {
    return text.split(/\r?\n\s*\r?\n/)
        .map((para) => ({ para, hits: classes.filter((c) => c.re.test(para)) }))
        .filter((c) => c.hits.length >= CARRIER_FLOOR);
}

// The unit a selected block is judged as. A blank-line block in this tree spans
// a whole bullet list, so where one item of the list carries the enumeration
// that item is the unit: judged as a block, an item naming no owner is covered
// by an unrelated neighbour that names one. Where no single item carries the
// enumeration the block is the unit, which is what keeps an enumeration spread
// across items in reach at all.
function judgedUnits(para, classes) {
    const perItem = para.split(/\r?\n(?=\s*[-*] )/)
        .map((unit) => ({ unit, hits: classes.filter((c) => c.re.test(unit)) }))
        .filter((u) => u.hits.length >= CARRIER_FLOOR);
    return perItem.length > 0
        ? perItem
        : [{ unit: para, hits: classes.filter((c) => c.re.test(para)) }];
}

// The judgment itself, as one function so the sweep and the withheld controls
// below run the same legs: a control exercising a second function written to
// resemble this one is evidence about that second function.
//
// Three legs. The first is the owner pointer. The second takes one of two forms
// per class. A class whose name carries a tail past its head is compared on that
// name, which is what a stale copy of it loses. A class the owner names in one
// or two words has no tail to compare, so what is compared is its definition
// clause: a unit reaching a third of the clause's words within twice the
// clause's own length of the head is restating the class rather than naming it,
// and a restatement that reaches a third of the words and not all of them states
// something the owner does not. The window is what separates the two, since a
// long unit naming the class and pointing at its owner holds some of those words
// incidentally, scattered rather than beside the head.
//
// The third holds the unit to the owner's whole enumeration: the floor selects a
// unit on CARRIER_FLOOR heads, and a selected unit then names every class the
// owner states, because a class renamed at the owner is what leaves a stale
// carrier one head short while the heads that did not change keep it selected,
// and the per-class legs, which run over the hits, read that carrier as clean.
// The bar sits at the judged unit rather than at the selected paragraph: the
// other legs run per unit, and a paragraph's hits are the union over its items,
// so a stale item beside a sibling that names the renamed class would clear a
// paragraph-level count. In the whole-block fallback the unit is the block, so
// an enumeration spread across items is held to the same bar on its combined
// hits. It runs last so a unit is reported on what it spells wrong before on
// what it leaves out, which is also what lets a control for a per-class leg
// withhold a class without reaching this one.
//
// That window is symmetric, running the clause's own length twice in each
// direction from the head and taking the greater reach of the two, because a
// restatement is as readily written before the name as after it ("a test whose
// failure implies another's, which is a duplicate"): a forward-only window reads
// the same carrier as clean when its prose runs the other way, which is a
// silence produced by word order rather than by agreement.
function assertCarrierAgrees(where, unit, hits, classes) {
    assert.ok(unit.includes(RETIRE_OWNER_SEGMENT), where + ' enumerates the retire '
        + 'classes (' + hits.map((c) => c.head).join(', ') + ') without naming '
        + 'their owner, so it reads as a second definition rather than a pointer, '
        + 'and the two drift apart the next time the owner is amended');
    const present = stemsOf(unit);
    for (const cls of hits) {
        if (cls.tail) {
            assert.ok(unit.toLowerCase().includes(cls.name.toLowerCase()),
                where + ' spells the "' + cls.head + '" retire class '
                + 'differently from its owner, which states it as "' + cls.name
                + '"; a reworded copy of a class is how an amendment at the owner '
                + 'leaves a stale definition standing here');
            continue;
        }
        let beside = 0;
        const span = cls.def.length * 2;
        for (const at of unit.matchAll(cls.every)) {
            const after = unit.slice(at.index, at.index + at[0].length + span);
            const before = unit.slice(Math.max(0, at.index - span),
                at.index + at[0].length);
            for (const window of [after, before]) {
                // Stemmed once per window rather than inside the filter, which
                // would rebuild the whole window's stem set for every word of
                // the clause, for every match, in both directions.
                const stems = stemsOf(window);
                const reach = cls.defWords.filter((w) => stems.has(w)).length;
                if (reach > beside) beside = reach;
            }
        }
        if (beside * 3 < cls.defWords.length) continue;
        const missing = cls.defWords.filter((w) => !present.has(w));
        assert.deepStrictEqual(missing, [], where + ' states its own definition of '
            + 'the "' + cls.head + '" retire class, which the owner states as "'
            + cls.def + '", and drops ' + missing.join(', ') + ' from it. A class '
            + 'the owner names without a qualifying tail is compared on the words '
            + 'of its definition, so a restatement carrying part of them is a '
            + 'second definition that has already drifted; point at the owner '
            + 'rather than restating it');
    }
    const unnamed = classes.filter((c) => !hits.includes(c)).map((c) => c.head);
    assert.deepStrictEqual(unnamed, [], where + ' names ' + hits.length + ' of the '
        + classes.length + ' retire classes the owner states and leaves out '
        + unnamed.join(', ') + '. A unit that clears the floor is an enumeration, '
        + 'and an enumeration is complete or stale: a class renamed or added at '
        + 'the owner leaves a carrier short by exactly this head while the heads '
        + 'that did not change keep it selected, and the stale head it still '
        + 'spells is compared against nothing');
}

// What this sweep exempts, each entry with the reason it is exempt and the form
// it matches, a whole path or a root prefix. The set is closed: the entries the
// partition below actually used are compared against this list, so an exemption
// cannot be added in code without moving it, and an entry that matches nothing
// reds rather than silently widening what the sweep skips. Every member is exempt
// because a carrier there is legitimate rather than because nothing was expected
// to be found, which is why none of them is asserted clean.
const RETIRE_SWEEP_EXEMPT = [
    ['path', RETIRE_OWNER, 'the owner itself, whose enumeration is the text every '
        + 'other surface is judged against and which is read above as this '
        + 'sweep\'s own control that the predicate still selects a carrier'],
    ['path', 'test/doctrine-parity.test.js', 'the file this pin lives in: a sweep '
        + 'for a text pattern otherwise always finds the fixtures it sweeps with, '
        + 'so a stale carrier written into this file is outside the pin\'s reach'],
    ['root', 'docs/archive/', 'the archive, which is append-only in its whole '
        + 'body rather than below a heading: an archived document\'s own prose '
        + 'quotes the wording of the moment it was archived at, a red there has '
        + 'no repair in scope any more than a red in a Chapter does, and the root '
        + 'holds documents carrying no `## Chapters` heading to cut at'],
];

// The region of a tracked document this sweep judges, which is all of it except
// under the journal roots. There a document is judged only above its own
// `## Chapters` heading, because everything below that heading is append-only
// history: a Chapter or an interim board quotes a retired wording as its subject,
// and a red there would have no repair in scope, history not being rewritten. The
// carve-out is at the region rather than at the path, so a live plan's own body,
// which is a carrier this pin exists to catch, stays judged, and that is the whole
// reason the root here is the live one: an archived document has no editable body
// to repair either, so it is exempt whole above rather than cut. A document under
// this root with no such heading is judged whole.
const RETIRE_SWEEP_JOURNAL_ROOTS = ['docs/plans/'];

function retireJudgedRegion(rel, text) {
    if (!RETIRE_SWEEP_JOURNAL_ROOTS.some((root) => rel.startsWith(root))) {
        return { text, carved: false };
    }
    const at = text.search(/^## Chapters[ \t]*$/m);
    return at === -1 ? { text, carved: false } : { text: text.slice(0, at), carved: true };
}

test('every tracked surface naming the retire classes agrees with their owner', () => {
    const classes = ownerRetireClasses();
    // The instrument check, and it is a control rather than a formality: the
    // predicate must select the owner's own enumeration, so a rename or a
    // reformat at the owner that puts the classes out of the predicate's reach
    // reddens here instead of emptying the carrier set and reading as clean.
    const ownerCarriers = retireClassCarriers(readRepoFile(RETIRE_OWNER), classes);
    assert.strictEqual(ownerCarriers.length, 1,
        'the carrier predicate no longer selects exactly the owner\'s own '
        + 'enumeration of the retire classes, so it has stopped describing the '
        + 'class it sweeps for and its silence over every other surface says '
        + 'nothing at all');
    for (const cls of classes) {
        assert.ok(cls.re.test(ownerCarriers[0].para), 'the pattern derived for the '
            + '"' + cls.head + '" retire class no longer selects the owner\'s own '
            + 'enumeration of the classes, so that class is out of the judgment '
            + 'below while the heads that still match keep every carrier selected '
            + 'and every leg green');
    }

    // The region carve-out's own control, run before its silence is read: it cuts
    // at the heading and only under the journal roots, so an over-wide cut, which
    // would take a live document's body out of the sweep while every leg below
    // stayed green, speaks here. The instance is built from the classes at run
    // time for the same reason every control below is.
    const journalBody = 'Judged: the ' + classes.map((c) => c.name).join(', ') + '.';
    const journalText = journalBody + '\r\n\r\n## Chapters\r\n\r\nHistory: the '
        + classes.map((c) => c.name).join(', ') + ' as this section left them.';
    const carvedRegion = retireJudgedRegion('docs/plans/a_spec_v1.md', journalText);
    assert.ok(carvedRegion.carved && carvedRegion.text.includes(journalBody)
        && !carvedRegion.text.includes('History:'),
        'the journal carve-out no longer cuts a plan document at its `## Chapters` '
        + 'heading, keeping the body above it and dropping the history below: it '
        + 'either reaches past the heading, which takes a live plan\'s own body out '
        + 'of this sweep, or reaches nothing, which puts append-only history back '
        + 'in reach of a judgment that has no repair for it');
    assert.ok(!retireJudgedRegion('docs/architecture.md', journalText).carved,
        'the journal carve-out reaches a document outside '
        + RETIRE_SWEEP_JOURNAL_ROOTS.join(' and ') + ', so a curated document is '
        + 'judged only down to a heading it happens to share with a plan doc');

    // The whole tracked tree, with no pathspec at all, and the exemptions taken
    // out of the result rather than out of the input. A pathspec is an inclusion
    // list, which is a claim about what exists refreshed by hand: it reports every
    // kind nobody thought to name as clean by construction, and no control catches
    // that, since a control runs inside the scope. It also matches case
    // sensitively, so a differently-cased extension would sit outside the sweep
    // entirely. Listing the tree and partitioning it in code covers a kind, a case
    // and a top-level directory added later by default.
    const root = path.join(__dirname, '..');
    const listing = gitRun(root, ['ls-files', '-z'],
        { timeoutMs: SWEEP_GIT_TIMEOUT_MS });
    assert.ok(listing && listing.status === 0, 'git could not list the tracked '
        + 'tree, so this sweep read nothing and its silence is about git rather '
        + 'than about the tree');
    // -z and a NUL split rather than newlines: git C-quotes any path holding a
    // non-ASCII or special byte in its default listing, which would put a name
    // no file answers to into the sweep.
    const tracked = listing.stdout.split('\0').filter(Boolean);
    // The listing reached a path known to be tracked, which the guard above
    // cannot establish: `ls-files` exits 0 over an empty stdout, so a listing
    // emptied by a wrong argument or a wrong repository leaves every judgment
    // below with nothing to run on and reads exactly like a tree with no carrier
    // in it. The owner is the path asserted because it is the one carrier this
    // pin knows is there.
    assert.ok(tracked.includes(RETIRE_OWNER), 'the tracked listing does not hold '
        + RETIRE_OWNER + ', which git tracks, so the listing this sweep reads is '
        + 'not this repository\'s tracked tree and its silence over every other '
        + 'path means nothing');
    // The partition. Every listed path leaves this loop into exactly one of three
    // recorded sets, and each branch that removes one records it with its cause,
    // so the sum asserted below is what a fourth exit added later breaks.
    const self = fs.realpathSync(__filename);
    const judged = [];
    const exempted = [];
    const exemptionsUsed = new Set();
    const skipped = [];
    let journalCarved = 0;
    // What the judgment selected, recorded inside the loop beside the judged
    // set rather than derived from it afterwards: the judged set says which
    // paths were read, and these say which of them the predicate found a
    // carrier in, which is the one thing the partition cannot.
    let carriersSelected = 0;
    const carrierPaths = new Set();
    for (const rel of tracked) {
        const exemption = RETIRE_SWEEP_EXEMPT.find(([kind, p]) => (kind === 'root'
            ? rel.startsWith(p) : rel === p));
        if (exemption) {
            exempted.push(rel);
            exemptionsUsed.add(exemption[1]);
            continue;
        }
        // A path the index holds and the worktree does not, a tracked file
        // deleted or a sparse checkout, is nothing to read rather than a failure;
        // so is one resolving outside this checkout, and so is one whose name
        // carries a control character, which the containment rule this helper
        // borrows refuses outright. Each of those is a counted skip rather than a
        // silent one: the file leaves the judgment either way, and the count plus
        // the cause is what separates that from a clean read.
        const real = containedRealPath(root, path.join(root, ...rel.split('/')));
        if (real === null) {
            skipped.push([rel, 'the worktree holds no file at this tracked path, '
                + 'or it resolves outside this checkout, or its name carries a '
                + 'control character']);
            continue;
        }
        // The resolved-path self check, which catches this file reached under a
        // link whose name the listing does not carry. It is a skip rather than an
        // exemption on purpose: the path it would push into the exempt set is by
        // construction not the one RETIRE_SWEEP_EXEMPT names, so exempting it
        // would break the closed-set comparison below at exactly the moment this
        // branch did the thing it exists for, turning a link alias into a red
        // about an exemption with no reason recorded.
        if (real === self) {
            skipped.push([rel, 'resolves to this pin\'s own file under a name the '
                + 'tracked listing does not carry']);
            continue;
        }
        const read = readFileBounded(real, SWEEP_FILE_MAX_BYTES);
        assert.ok(read, rel + ' is tracked and could not be read, so this sweep is '
            + 'silent about it for a reason that is not a clean result');
        if (read.bounded) {
            skipped.push([rel, 'is larger than the ' + SWEEP_FILE_MAX_BYTES
                + ' bytes this sweep reads of one file, so its tail went unread '
                + 'and it is left out of the judgment rather than judged on its '
                + 'head alone']);
            continue;
        }
        const region = retireJudgedRegion(rel, read.text);
        if (region.carved) journalCarved += 1;
        judged.push(rel);
        for (const carrier of retireClassCarriers(region.text, classes)) {
            carriersSelected += 1;
            carrierPaths.add(rel);
            for (const unit of judgedUnits(carrier.para, classes)) {
                assertCarrierAgrees(rel, unit.unit, unit.hits, classes);
            }
        }
    }
    // The partition itself, which is this sweep's reach evidence: a path that
    // left the loop without being recorded shows up here as a shortfall, and the
    // skips are named with their causes so the reading is what dropped out rather
    // than how many did.
    const namedSkips = skipped.map(([rel, why]) => rel + ': ' + why);
    assert.strictEqual(judged.length + exempted.length + skipped.length,
        tracked.length, 'this sweep listed ' + tracked.length + ' tracked paths '
        + 'and accounted for ' + (judged.length + exempted.length + skipped.length)
        + ' of them (' + judged.length + ' judged, ' + exempted.length
        + ' exempt, ' + skipped.length + ' skipped), so a path leaves the loop '
        + 'unrecorded and the sweep is silent about it while reading as a clean '
        + 'result. Skips recorded this run:\n' + namedSkips.join('\n'));
    // The witness, which the sum cannot supply: the sum holds over a run that
    // skipped everything, so one tracked path known to be judged is what says the
    // loop reached a file and read it.
    assert.ok(judged.includes(SWEEP_JUDGED_WITNESS), 'this sweep judged '
        + judged.length + ' tracked paths and ' + SWEEP_JUDGED_WITNESS + ' is not '
        + 'among them, so the loop either read nothing or removed a path it has no '
        + 'exemption and no skip cause for. Skips recorded this run:\n'
        + namedSkips.join('\n'));
    // The judgment's own witness, which the judged witness cannot supply: a path
    // is recorded as judged before any carrier is selected from it, so a
    // predicate that selects nothing leaves every path judged and every leg
    // above green. One path known to carry an enumeration is what says the
    // judgment ran on what the loop read.
    assert.ok(carrierPaths.has(SWEEP_CARRIER_WITNESS), 'the judgment selected '
        + carriersSelected + ' carriers over ' + judged.length + ' judged paths '
        + 'and ' + SWEEP_CARRIER_WITNESS + ' is not among the paths they came '
        + 'from, so either that charter has stopped enumerating the retire '
        + 'classes or the predicate has stopped selecting an enumeration, and '
        + 'every clean leg above is silence over a judgment that ran on nothing');
    // The exempt half, held to the closed list above: the comparison is over the
    // entries the loop actually used, so an exemption added in code moves it and
    // an entry that has stopped matching anything reds rather than widening what
    // the sweep skips in silence.
    assert.deepStrictEqual([...exemptionsUsed].sort(),
        RETIRE_SWEEP_EXEMPT.map(([, p]) => p).slice().sort(),
        'the exemptions this sweep applied are not the ones RETIRE_SWEEP_EXEMPT '
        + 'names with their reasons, so either a surface is exempt with no reason '
        + 'recorded or a named exemption no longer matches anything in the tree');
    assert.ok(journalCarved > 0, 'no tracked document under '
        + RETIRE_SWEEP_JOURNAL_ROOTS.join(' or ') + ' carries a `## Chapters` '
        + 'heading, so the journal carve-out removed nothing and the coverage '
        + 'statement above describes a cut this run never applied');
});

// The withheld controls, one per way a carrier disagrees, and each runs the
// judgment the sweep above runs rather than asserting a property of its own
// input: what a control has to show is that the judgment speaks, so it calls it
// and requires a throw. One instance per leg is what makes that evidence
// specific, since an instance failing two legs stays caught with either of them
// inverted.
//
// The instances are authored here rather than taken from the tree, because an
// instance the tree already holds would prove the predicate functions and say
// nothing about whether the judgment catches a stale carrier, which is the only
// thing the pin is for. What cannot be withheld is the class vocabulary itself,
// since a class is its name, so every instance is built from the owner's own
// classes at run time and this file types none of it.
test('the retire-class agreement judgment speaks on each carrier that disagrees', () => {
    const classes = ownerRetireClasses();
    const tailed = classes.find((c) => c.tail);
    const tailless = classes.find((c) => !c.tail);
    assert.ok(tailed, 'no retire class the owner states carries a qualifying tail '
        + 'past its head, so the name leg has nothing to compare and its control '
        + 'cannot be built: that leg is inert rather than passing');
    assert.ok(tailless, 'every retire class the owner states carries a qualifying '
        + 'tail, so the definition leg has nothing to compare and its control '
        + 'cannot be built: that leg is inert rather than passing');
    const owner = 'skills/testing-discipline/SKILL.md';
    const faithfully = (except) => classes.filter((c) => c !== except)
        .map((c) => 'the ' + c.name).join(', ');

    // The opening of the owner's own definition clause, cut at the point where it
    // reaches the third of its words the judgment reads as a restatement, so what
    // the instance drops is the rest of the clause.
    const need = Math.ceil(tailless.defWords.length / 3);
    const partial = [];
    const reached = new Set();
    for (const word of tailless.def.split(/\s+/)) {
        partial.push(word);
        const stem = stemWord(word);
        if (tailless.defWords.includes(stem)) reached.add(stem);
        if (reached.size >= need) break;
    }
    assert.ok(reached.size >= need && reached.size < tailless.defWords.length,
        'the owner\'s definition of the "' + tailless.head + '" class cannot be cut '
        + 'to an opening that reads as a restatement and is less than the whole '
        + 'clause, so the definition leg has no control and is inert rather than '
        + 'passing');

    // Each instance carries the leg it was built for, as a fragment of that
    // leg's own assertion message. A bare description in the matcher position is
    // what these rows read as before: a string second argument to assert.throws
    // is the message parameter rather than a matcher, so every row accepted any
    // throw at all and recorded that something refused rather than that the leg
    // it exercises refused. The classes are iterated in the owner's order, so a
    // later widening of the first class's own window would otherwise have a row
    // throw on the wrong leg with its intended leg silently untested.
    const ownerLeg = /without naming their owner/;
    const enumerationLeg = /retire classes the owner states and leaves out/;
    const nameLeg = /differently from its owner/;
    const definitionLeg = /states its own definition of the/;
    for (const [why, leg, text] of [
        ['a carrier naming no owner', ownerLeg,
            'Retiring a check here follows the house classes: ' + faithfully(null)
            + ', each judged by whatever the file it sits in happens to say.'],
        // Every class but one, each spelled as the owner spells it, with the
        // owner named: what this instance shares with a carrier left behind by
        // a rename at the owner is the count and nothing else, so the leg it
        // reaches is the whole-enumeration bar and not a spelling.
        ['a carrier naming every retire class but one', enumerationLeg,
            'Retiring a check here follows the classes ' + owner + ' states: '
            + faithfully(tailless) + '.'],
        // The one tailed class this instance names is the one it rewords, and
        // every other class it names is tailless: an instance naming a second
        // tailed class faithfully still throws with the name leg inverted, on
        // that second class, which would make the leg look covered while its
        // control says nothing.
        ['a carrier rewording a class the owner states with a qualifying tail',
            nameLeg,
            'Retiring a check here follows the classes ' + owner + ' states: a '
            + tailed.head + ' over any tally at all, '
            + classes.filter((c) => !c.tail).map((c) => 'the ' + c.name).join(', ')
            + ' beside it.'],
        ['a carrier restating part of a definition the owner states whole',
            definitionLeg,
            'Retiring a check here follows the classes ' + owner + ' states: a '
            + tailless.head + ' is ' + partial.join(' ') + ', with '
            + faithfully(tailless) + ' beside it.'],
        // The same restatement written before the head rather than after it,
        // which is the direction a forward-only definition window reads as
        // clean. It is one instance per leg like its neighbours: the leg it
        // exercises is the definition comparison's window, not the comparison.
        ['a carrier restating a definition ahead of the class it defines',
            definitionLeg,
            'Retiring a check here follows the classes ' + owner + ' states: '
            + partial.join(' ') + ' is what makes a ' + tailless.head + ', with '
            + faithfully(tailless) + ' beside it.'],
        ['an enumeration in a list item whose neighbour is what names the owner',
            ownerLeg,
            '- A bullet naming ' + owner + ' and nothing else.\r\n'
            + '- Retiring a check here follows the house classes: '
            + faithfully(null) + ', each judged where it sits.'],
    ]) {
        const found = retireClassCarriers(text, classes);
        assert.strictEqual(found.length, 1, 'the carrier predicate did not select '
            + 'the control instance for ' + why + ', so that instance names fewer '
            + 'than ' + CARRIER_FLOOR + ' heads and says nothing about the '
            + 'judgment it was built for');
        assert.throws(() => {
            for (const unit of judgedUnits(found[0].para, classes)) {
                assertCarrierAgrees('a scratch copy', unit.unit, unit.hits, classes);
            }
        }, leg, 'the agreement judgment passed ' + why + ', so its silence over '
            + 'the tracked tree is silence for an unknown reason. The matcher is '
            + 'the leg this instance was built for (' + leg + '), so a throw from '
            + 'another leg fails here rather than standing in for the untested one');
    }
});

// The far end of the box-check bullet's claim-protocol pointer, pinned on the
// one leg the role skill's other far-end pins below do not take: the near end
// still naming this target. What the target carries, and that it sits in the
// index, are pinned once below rather than restated here, so a reworded
// sentence has one site to move and the index coverage for this path does not
// hang on a prose pointer surviving.
test('the box-check bullet\'s claim-protocol pointer resolves and is tracked', () => {
    const lead = '- **One heavy process at a time is a per-machine budget';
    const bullets = skillBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(bullets.length, 1,
        'expected exactly one box-check bullet to read the pointer from');
    assert.ok(bullets[0].includes('`skills/role/SKILL.md` under the kit plugin root'),
        'the box-check bullet no longer points at the role skill for the claim '
        + 'protocol, so either it restates the protocol it is supposed to defer '
        + 'or it defers to nothing');
    const parts = ['plugins', 'claude-kit', 'skills', 'role', 'SKILL.md'];
    assert.ok(fs.existsSync(path.join(__dirname, '..', ...parts)),
        'the box-check bullet routes its claim protocol to a skill that is not '
        + 'on disk: ' + parts.join('/'));
});

// The peer-sessions bullet defers its whole operative content to the
// peer-sessions skill (it names the contracts, patterns, and etiquette rather
// than restating them), which is exactly the class whose deletion the
// whole-body parity test above cannot catch: a symmetric deletion from both
// copies would pass identity while leaving the standing rule unstated. The
// presence pin closes that gap.
test('the peer-sessions bullet is present once in each copy and identical', () => {
    const lead = '- **Peer sessions are a coordination surface, not a record.**';
    const inSkill = skillBody().split('\n').filter((l) => l.startsWith(lead));
    const inMirror = mirrorBody().split('\n').filter((l) => l.startsWith(lead));
    assert.strictEqual(inSkill.length, 1,
        'expected exactly one peer-sessions bullet in the skill body');
    assert.strictEqual(inMirror.length, 1,
        'expected exactly one peer-sessions bullet in the doctrine mirror');
    assert.strictEqual(inMirror[0], inSkill[0]);
    // Presence alone closes only half the gap: the half where the bullet
    // vanishes. A bullet still present but pointing at a skill that was
    // renamed, deleted, emptied to a stub, or never committed leaves the
    // always-on layer aiming at nothing with the suite green, so the far end
    // is pinned too, the way the outline bullet's pin asserts its own
    // routed-to skills.
    assert.ok(inSkill[0].includes('`peer-sessions` skill'),
        'the peer-sessions bullet no longer names the skill it defers to');
    const parts = ['plugins', 'claude-kit', 'skills', 'peer-sessions', 'SKILL.md'];
    const target = path.join(__dirname, '..', ...parts);
    assert.ok(fs.existsSync(target),
        'the peer-sessions bullet defers to a skill that is not on disk: '
        + parts.join('/'));
    // Existence is the weaker sibling of the outline pin, which asserts
    // routed-to content rather than a routed-to file. The bullet defers three
    // named things, so all three are pinned: a stub passing existence would
    // otherwise satisfy a pointer that promises contracts, patterns, and
    // etiquette. The Naming heading rides along for a different pointer,
    // the coordinator skill's seat-handoff paragraph and its "the peer-sessions Naming section owns", which is the
    // reverse direction of the same skill-to-skill pointer pair; it belongs
    // here rather than in a pin of its own because it is the same defect
    // class against the same file.
    const body = fs.readFileSync(target, 'utf8');
    for (const heading of [/^## The messaging surface$/m,
        /^## The sanctioned patterns$/m, /^## Etiquette$/m, /^## Naming$/m]) {
        assert.match(body, heading, 'the peer-sessions bullet defers to the '
            + 'skill\'s contracts, sanctioned patterns, and etiquette, and the '
            + 'coordinator skill separately defers to its Naming section, so '
            + 'deleting one of those sections leaves a pointer promising what '
            + 'the skill no longer carries: ' + heading);
    }
    assertTrackedInIndex(parts.join('/'));
});

// README's payload map and the peer-sessions Roles section both point at
// the coordinator skill. Asserting only the far end (the skill on disk,
// carrying what it promises) would stay green after the pointer itself was
// deleted, since nothing would then depend on the coordinator skill
// existing at all, so the near end is pinned first: the committed
// pointers still name the coordinator skill.
test('README and peer-sessions still point at the coordinator skill', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const mapLine = readme.split(/\r?\n/).find((l) => /^\s*coordinator\//.test(l));
    assert.ok(mapLine, 'README\'s payload map no longer carries a coordinator/ '
        + 'entry; the coordinator pin below reads this line as its near end');
    // Anchored on the words the entry promises rather than the whole line,
    // since the map's column alignment is cosmetic and will be reflowed
    // someday; a reflow that keeps the words would still pass this.
    for (const word of ['operator interface', 'cross-repo', 'resource arbitration']) {
        assert.ok(mapLine.toLowerCase().includes(word),
            'README\'s coordinator/ map entry no longer mentions "' + word
            + '", one of the functions it promises the skill carries');
    }

    const peerSessions = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'peer-sessions', 'SKILL.md'), 'utf8');
    assert.match(peerSessions, /the coordinator skill names the file/,
        'peer-sessions\' Roles section no longer names the coordinator skill as '
        + 'the ledger\'s owner; that clause is the near end of the pointer the '
        + 'next pin closes at its far end, and losing it here would leave that '
        + 'pin asserting a premise nothing in the tree depends on');
});

// The far end of the pointer pinned above: the coordinator skill on disk,
// tracked, and carrying what README and peer-sessions each promise it does.
test('the coordinator skill is tracked and carries what it is pointed at for', () => {
    const parts = ['plugins', 'claude-kit', 'skills', 'coordinator', 'SKILL.md'];
    const target = path.join(__dirname, '..', ...parts);
    assert.ok(fs.existsSync(target),
        'the README payload map and the peer-sessions Roles section both '
        + 'point at a coordinator skill that is not on disk: ' + parts.join('/'));
    const body = fs.readFileSync(target, 'utf8');

    // README's map line promises named functions, not the heading's count, so
    // each promised function's own lead is pinned instead of the heading. The
    // count itself, stated closed at four with kaizen the fourth, is pinned by
    // the four-functions test below, which is what reddens a surface left
    // stating the retired closed-at-three set.
    for (const lead of ['- **Operator interface.**',
        '- **Cross-repo dependency and portfolio sequencing.**',
        '- **Machine-resource arbitration.**']) {
        assert.ok(body.includes(lead),
            'README\'s payload map promises the coordinator\'s functions '
            + '(operator interface, cross-repo sequencing, resource arbitration), '
            + 'and the skill no longer carries the function lead "' + lead + '"');
    }

    // peer-sessions' Roles section says the coordinator skill "names the file";
    // the file is coordinator/<machine>/board.md in the memory store. A
    // "## The ledger" heading kept while the path inside it is renamed or
    // dropped would pass heading presence while leaving that pointer aimed at a
    // name the skill no longer states, so the literal path is pinned instead of
    // the heading.
    assert.match(body, /coordinator\/<machine>\/board\.md/,
        'peer-sessions defers to the coordinator skill to name the ledger file '
        + 'as coordinator/<machine>/board.md in the memory store, and the skill '
        + 'no longer states that path anywhere in its body');

    // peer-sessions prices the status round at "no oftener than the
    // coordinator's heartbeat cadence, which that skill states". The seat's
    // paced wake is a reconciliation timer every 4 hours, stated once in the
    // cold-start opening above the "## The four functions" heading. No other
    // assertion here pins that figure: the function leads above pin other
    // paragraphs outright, and the path assertion above matches the opening
    // among several occurrences, so it stays green off the ledger's own
    // occurrence with the opening gone. Dropping the opening would take the
    // cadence with it and redden nothing without this assertion, which is why
    // it is separate. Matched loosely enough to survive ordinary rewording of the
    // sentence around it and tightly enough to redden when the figure is gone.
    assert.match(body, /reconciliation timer[^\n]{0,60}every 4 hours/i,
        'peer-sessions defers the status round\'s pricing to "the coordinator\'s '
        + 'heartbeat cadence, which that skill states", and the coordinator '
        + 'skill no longer states its paced cadence, a reconciliation timer '
        + 'every 4 hours, anywhere in its body');

    // The far end of that same deferral is the word it defers to: peer-sessions
    // prices against a "heartbeat cadence", so the timer has to be readable as
    // the seat's heartbeat and not only as a timer, or the clause points at a
    // cadence under a name this skill never uses. The window is 90 characters
    // because the sentence that names the timer as the heartbeat spans 68 of
    // them, which leaves room for rewording and is short enough that the two
    // words have to be making one claim rather than sitting in neighbouring
    // sentences about different things; the skill's paragraphs are one line
    // each, so a window wide enough to cross a sentence boundary twice would
    // go green off an unrelated pair.
    assert.match(body,
        /heartbeat[^\n]{0,90}reconciliation timer|reconciliation timer[^\n]{0,90}heartbeat/i,
        'peer-sessions prices the status round against "the coordinator\'s '
        + 'heartbeat cadence", and the coordinator skill no longer names its '
        + 'reconciliation timer as that heartbeat, leaving the deferral aimed '
        + 'at a cadence under a name this skill does not state');

    assertTrackedInIndex(parts.join('/'));
});

// One number on two surfaces. The coordinator skill's banked-pass paragraph
// rests its coverage argument on an equality: the role-boundary marker's age
// bound is the seat's own reconciliation cadence, so a marker opened at the end
// of one pass is still live when the paced wake fires. The bound lives in code
// as ROLE_BOUNDARY_MAX_AGE_MS; the cadence lives in that skill's prose as a
// figure. Nothing else reads the two together, so shortening the constant would
// leave the skill arguing coverage it no longer has, silently and with the
// suite green. The assertion above pins the prose figure at a literal 4 for the
// status round's own pricing; this one pins the same figure against the
// constant, which is what reddens when the constant moves.
test('the coordinator\'s stated cadence is the role-boundary marker\'s own age bound', () => {
    const { ROLE_BOUNDARY_MAX_AGE_MS } = require(path.join(__dirname, '..',
        'plugins', 'claude-kit', 'hooks', 'kit-compact-lib.js'));
    const hours = ROLE_BOUNDARY_MAX_AGE_MS / (60 * 60 * 1000);
    assert.ok(Number.isInteger(hours) && hours > 0,
        'the role-boundary marker\'s age bound is no longer a whole number of '
        + 'hours, so the coordinator skill cannot state it as one: give the '
        + 'skill\'s cadence a spelling that matches and pin that spelling here');
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');
    assert.match(body,
        new RegExp('reconciliation timer[^\\n]{0,60}every ' + hours + ' hours', 'i'),
        'the coordinator skill\'s banked-pass paragraph argues that a marker '
        + 'opened at the end of one pass is still live when the next paced wake '
        + 'fires, which holds only while the seat\'s reconciliation cadence and '
        + 'the role-boundary marker\'s age bound (ROLE_BOUNDARY_MAX_AGE_MS, '
        + hours + ' hours) are the same figure; the skill no longer states that '
        + 'cadence as every ' + hours + ' hours');
});

// The coordinator's function count is a counted claim stated on two surfaces
// of its own file, the enumeration heading and the closed-set sentence, and
// restated on four sibling surfaces: one peer-sessions clause, README's
// payload map, docs/README.md's architecture summary, and
// docs/architecture.md's runbook overview. A count restated on a sibling
// surface is an invariant nothing checks, which git merges clean and no
// diff-reading review catches, so every restating surface is read here (the
// docs/ surfaces are read, never written). The set is closed at four, kaizen
// the fourth, so the count surfaces are pinned at four, the kaizen bullet is
// pinned on its own load-bearing words, and the retired count is pinned
// absent, scoped to the coordinator-count spellings rather than the bare
// word "three", which the warranted-channels list carries legitimately.
test('the coordinator holds four functions, kaizen among them, and no surface still states three', () => {
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');
    assert.ok(body.includes('## The four functions'),
        'the coordinator skill\'s enumeration heading no longer states the set '
        + 'at four; the heading and the closed-set sentence are two surfaces '
        + 'of one count and must move together');
    assert.ok(body.includes('The seat holds four functions, and the set is closed at four.'),
        'the coordinator skill\'s closed-set sentence no longer states four; '
        + 'the heading and this sentence are two surfaces of one count and '
        + 'must move together');
    const kaizenLines = body.split(/\r?\n/).filter((l) => l.startsWith('- **Kaizen.**'));
    assert.strictEqual(kaizenLines.length, 1,
        'expected exactly one Kaizen function bullet in the coordinator skill; '
        + 'the fourth function is kaizen capture, dispositioning, and dispatch');
    assert.ok(kaizenLines[0].includes('dispositioning')
        && kaizenLines[0].includes('standing authority'),
        'the coordinator\'s Kaizen bullet no longer carries dispositioning '
        + 'under the operator\'s standing authority, which is the substance '
        + 'that separates the seat\'s function from the capture-and-route duty '
        + 'every other seat holds');
    for (const retired of ['## The three functions',
        'The seat holds three functions', 'the set is closed at three']) {
        assert.ok(!body.includes(retired),
            'the coordinator skill still carries the retired count spelling "'
            + retired + '" while the set is closed at four');
    }
    const peerSessions = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'peer-sessions', 'SKILL.md'), 'utf8');
    assert.ok(!/coordinator's three/.test(peerSessions),
        'peer-sessions still restates the coordinator\'s function count as '
        + 'three; the count is single-sourced in the coordinator skill, and a '
        + 'sibling surface names no number, so a future count change cannot '
        + 'strand one');

    // The sibling restatements outside the plugin payload. README's payload
    // map enumerates the functions rather than counting them, so its pin is
    // that kaizen stays in the enumeration; the two docs surfaces state the
    // closed count outright, so each is pinned on its own count-plus-kaizen
    // spelling, and the retired three-count spellings are pinned absent on
    // all three.
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const mapLine = readme.split(/\r?\n/).find((l) => /^\s*coordinator\//.test(l));
    assert.ok(mapLine, 'README\'s payload map no longer carries a coordinator/ '
        + 'entry; this test reads that line as a count-restating surface');
    assert.ok(mapLine.toLowerCase().includes('kaizen'),
        'README\'s coordinator/ map entry no longer names kaizen among the '
        + 'seat\'s functions, so the map enumerates the retired three-function '
        + 'set while the skill holds four');
    const docsReadme = fs.readFileSync(path.join(__dirname, '..', 'docs',
        'README.md'), 'utf8');
    assert.match(docsReadme, /four closed functions[^.]{0,80}kaizen/i,
        'docs/README.md no longer states the coordinator seat\'s four closed '
        + 'functions with kaizen among them; it is a count-restating surface '
        + 'and must move with the coordinator skill\'s own count');
    const architecture = fs.readFileSync(path.join(__dirname, '..', 'docs',
        'architecture.md'), 'utf8');
    assert.match(architecture, /functions are closed at four[^.]{0,200}kaizen/i,
        'docs/architecture.md no longer states the coordinator\'s functions '
        + 'closed at four with kaizen in the enumeration; it is a '
        + 'count-restating surface and must move with the skill\'s own count');
    for (const [label, sibling] of [['README.md', readme],
        ['docs/README.md', docsReadme], ['docs/architecture.md', architecture]]) {
        // The banned spellings are read against this pin's own subject rather
        // than against the file: "three functions" is a phrase another
        // subject may legitimately take, and a bare substring test would
        // redden on a sentence that has nothing to do with the seat. An
        // occurrence counts only where the coordinator is named inside the
        // window around it, which is the count this pin is about.
        const lower = sibling.toLowerCase();
        for (const retired of ['three closed functions', 'closed at three',
            "coordinator's three", 'three functions']) {
            for (let at = lower.indexOf(retired); at !== -1;
                at = lower.indexOf(retired, at + 1)) {
                const window = lower.slice(Math.max(0, at - 200),
                    at + retired.length + 200);
                assert.ok(!window.includes('coordinator'),
                    label + ' still states the coordinator count with the '
                    + 'retired spelling "' + retired + '" while the set is '
                    + 'closed at four');
            }
        }
    }
});

// The standing-watch chassis's admission default faces outward: doubt about
// whether a line belongs on the ledger at all keeps it off, and doubt about
// which kind an admitted line is falls to situational, carved out for the
// standing members no probe of the watched system reproduces. A direction is
// one word, which a rewording flips with nothing else in the diff to notice
// it by, and an inward default on a loop that never terminates is drift by
// construction rather than a risk of it. So the inward spelling is pinned
// absent, and each fork's direction is pinned on the fork's own sentence
// rather than on the clause alone, because the bare clause is satisfied by
// its own negation and by a qualifier appended to it, so it discriminates
// nothing. A pin here is verbatim by convention: a rewording that keeps the
// direction still fails it, and updating the pin belongs to that same edit.
test('the standing-watch admission default faces outward at both forks and the named inward spellings are absent', () => {
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'standing-watch', 'SKILL.md'), 'utf8');
    const founding = 'A line you cannot confidently place is situational';
    assert.ok(!body.includes(founding),
        'standing-watch still carries the retired inward default sentence "'
        + founding + '"; an unplaceable line stays off the ledger, and any '
        + 'sentence sending it in crosses the admission default');
    // Direction-bearing rather than a bare substring: the pacing rule's "a
    // board you cannot confidently place is active" is not a ledger
    // placement and passes. The sweep is a named list of five verbs and
    // four objects, so the spellings it names are swept and the class is
    // not: an inward sentence spelled outside the list ("a line whose
    // placement the keeper cannot call is situational") passes it, and the
    // direction assertions below, bound to each fork's own subject, are
    // what pin the default's words.
    const inward = /cannot confidently place (?:is|goes|belongs|stays|lands) (?:situational|standing|on the ledger|placed)\b/;
    const inwardHit = body.match(inward);
    assert.ok(!inwardHit,
        'standing-watch sends a line the keeper cannot confidently place '
        + 'inward ("' + (inwardHit ? inwardHit[0] : '') + '"); an unplaceable '
        + 'line stays off the ledger, and any spelling placing it on the '
        + 'ledger crosses the admission default');
    const lines = body.split(/\r?\n/);
    const admission = lines.find((l) => l.startsWith('**Doubt falls to the cheap side'));
    assert.ok(admission,
        'standing-watch no longer opens its admission-default paragraph with '
        + '"Doubt falls to the cheap side"; this pin reads that paragraph for '
        + 'the direction the default faces');
    assert.match(admission,
        /(?:^|\. )At admission, a line the keeper cannot confidently say a successor needs stays off\./,
        'the admission default\'s sentence is no longer present verbatim: '
        + 'doubt at admission sends a line off the ledger, never onto it. '
        + 'Either the direction was inverted, which is the defect this pins, '
        + 'or the sentence was reworded, in which case update this pattern in '
        + 'the same edit. The whole sentence is pinned rather than the clause '
        + 'because the clause alone is satisfied by its own negation ("it is '
        + 'never true that a line the keeper cannot confidently say a '
        + 'successor needs stays off") and so discriminates nothing');
    assert.ok(admission.includes('tie-break for doubt'),
        'the admission default is no longer stated as the admission test\'s '
        + 'tie-break for doubt, which is what keeps it residual to the rules '
        + 'that already place content rather than a stage every line passes');
    const residual = lines.find((l) => l.startsWith('**The admission default is residual'));
    assert.ok(residual,
        'standing-watch no longer carries the residual-default paragraph; the '
        + 'default decides only what no rule has already placed');
    assert.ok(residual.includes('Having no other record neither admits a line nor rescues one'),
        'the residual paragraph no longer states that having no other record '
        + 'neither admits a line nor rescues one, which is the load-bearing '
        + 'half: the founding incident\'s content had no other record either');
    // The default's doubt branch must not reach a recognised prohibition or
    // trap. Unreached, such a line is kept off and then dropped, since the
    // destination rule holds no leg for one, and a prohibition off the
    // standing list leaves the wake prompt and stops binding with no pass
    // able to notice. The exemption is pinned with the property that earns
    // it, because an exemption stated on the two members' names alone gives
    // a consuming skill's equivalent member nothing.
    assert.ok(residual.includes(
        "The third shape does not reach two of the standing kind's members"),
        'the residual paragraph no longer exempts two of the standing kind\'s '
        + 'members from the default\'s third doubt shape; a recognised '
        + 'prohibition or trap reached by that shape is kept off the ledger '
        + 'and dropped, and a prohibition off the standing list stops binding '
        + 'before any pass reads the ledger');
    assert.ok(residual.includes(
        'What earns those two members their exemption is the property rather '
        + 'than their names'),
        'the residual paragraph no longer states the exemption on the property '
        + 'that earns it rather than on the two members\' names, which is what '
        + 'a consuming skill naming an equivalent member of its own reads to '
        + 'know the exemption reaches it');
    const fork = lines.find((l) => l.startsWith('**The kind fork'));
    assert.ok(fork,
        'standing-watch no longer carries the kind-fork paragraph; an admitted '
        + 'line whose kind the keeper cannot call needs a stated rule');
    assert.match(fork,
        /(?:^|\. )On the two kinds above, doubt therefore falls to situational, with one class carved out/,
        'the kind fork\'s sentence is no longer present verbatim through its '
        + 'carve-out clause: doubt about an admitted line\'s kind falls to '
        + 'situational, the kind whose misfiling costs a re-measurement. The '
        + 'pattern runs through "with one class carved out" on purpose, since '
        + 'stopping at "situational," leaves the qualifier position open and a '
        + 'clause appended there can reverse the rule while still matching '
        + '("falls to situational, except where the keeper is in doubt, where '
        + 'it falls to standing"). Either the direction was inverted, which is '
        + 'the defect this pins, or the sentence was reworded, in which case '
        + 'update this pattern in the same edit');
    assert.ok(fork.includes('no probe of the watched system reproduces'),
        'the kind fork no longer carves out the standing members no probe of '
        + 'the watched system reproduces, which is the class whose '
        + 're-measurement cannot be had and whose doubt falls to standing');
    assert.match(fork, /such a member falls to standing/,
        'the kind fork\'s carve-out no longer sends doubt about a standing '
        + 'member no probe reproduces to standing; the direction is bound to '
        + 'the carve-out\'s own subject, so the inverse carve-out fails here');
    assert.ok(fork.includes('reaches only the doubt'),
        'the kind fork\'s carve-out is no longer bounded to doubt; a line the '
        + 'keeper recognises as a prohibition or a trap is standing under the '
        + 'two-kinds rule already, and an unbounded carve-out readmits by name');
});

// The coordinator restates both forks for its own board, and the section's
// acceptance reads "no text in either skill sends an unplaceable line
// inward", so the coordinator's direction is pinned beside the chassis's
// rather than inferred from it, and the named inward spellings are swept
// beside it, since a rewording of one file leaves the other unchanged.
// Each direction assertion is bound to its fork's own subject phrase, so
// the inverse spelling ("stays on", "falls to the re-derivable kind")
// fails on that assertion rather than passing on the words appearing
// elsewhere in a file that legitimately says "stays on the board" of a
// line already boarded.
test('the coordinator board default faces outward at both forks', () => {
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');
    // The acceptance's "no text in either skill sends an unplaceable line
    // inward" is swept here as it is for the chassis, as a named list
    // rather than a class: the coordinator spells an unplaceable line as
    // one the seat cannot place, so the list is that phrase, five verbs,
    // and the board-side objects. The named spellings are swept and the
    // class is not: an inward sentence spelled outside the list ("doubt
    // keeps the candidate on the board") passes it, and the two direction
    // assertions below are what pin the default's words. Each is bound to a
    // contiguous span of its own sentence rather than to a subject and an
    // object with a wildcard between them, because such a span leaves the
    // polarity free and matches the negation of the rule it pins.
    const inward = /cannot (?:confidently )?place (?:is|goes|belongs|stays|lands) (?:on the board|boarded|one-record|re-derivable|situational)\b/;
    const inwardHit = body.match(inward);
    assert.ok(!inwardHit,
        'the coordinator sends a candidate the seat cannot place inward ("'
        + (inwardHit ? inwardHit[0] : '') + '"); an unplaceable candidate '
        + 'stays off the board, and any spelling placing it on the board '
        + 'crosses the admission default');
    assert.match(body,
        /whether a candidate belongs on the board at all, is the chassis's admission default unchanged: the candidate stays off,/,
        'the coordinator\'s admission-doubt sentence is no longer present '
        + 'verbatim: doubt over whether a candidate belongs on the board at '
        + 'all keeps the candidate off, never onto it. The span is contiguous '
        + 'on purpose, since a subject and an object with a wildcard between '
        + 'them also match the negation ("doubt over whether a candidate '
        + 'belongs on the board at all never means the candidate stays off"). '
        + 'Either the direction was inverted or the sentence was reworded; a '
        + 'rewording updates this pattern in the same edit');
    assert.match(body,
        /Doubt between those two kinds, for a line the test admits, falls to the one-record kind,/,
        'the coordinator\'s kind-doubt sentence is no longer present verbatim: '
        + 'doubt between its two board kinds falls to the one-record kind, '
        + 'whose misfiling costs a stale duplicate rather than a discounted '
        + 'commitment the board was the only record of. The span is contiguous '
        + 'for the same reason as the assertion above, a wildcard between '
        + 'subject and object matching the negation as readily as the rule. '
        + 'Either the direction was inverted or the sentence was reworded; a '
        + 'rewording updates this pattern in the same edit');
});

// The coordinator skill states four counted, drift-prone claims in prose with
// nothing else exercising them: the four-kinds routing's destinations, homing's
// no-residue rule with the cut invariant that bounds it, the readability test
// standing where a size figure would, and the reconciliation paragraph's
// deliberate exclusion of every memory tier. A claim nothing reads is a claim
// nothing contradicts, so it rots while keeping its authoritative tone, and an
// edit dropping the kaizen destination or the memory-system pointer reddens
// nothing on its own.
//
// This is the counted-claim class the four-functions pin above covers for the
// seat's function count, and the breadth here is that pin's for the same reason:
// a claim restated on a sibling surface is an invariant nothing checks, which git
// merges clean and no diff-reading review catches. Three restating surfaces are
// read here: docs/README.md and docs/plans/README.md, the two curated indexes,
// both of which described a memory tier as a reconciliation source while the
// skill stated the opposite; and docs/security-model.md, whose coordinator
// section restates the routing's two off-board destinations. A fourth restating
// surface is left out deliberately rather than missed: docs/backlog.md carries
// the cut invariant and the two-moment journal record in items of its own, and it
// is pruned live, so a leg over it would redden this test on an ordinary backlog
// prune. The docs surfaces are read, never written by this test.
//
// Each claim's load-bearing words are bound to a contiguous span that includes
// the words carrying its direction or its condition, because a span starting
// after them is satisfied by a sentence that reverses the rule: pinning "the
// round establishes that its own first entry landed" without "before any
// destination write begins" passes a rewrite that moves the check after the
// write. A pin here is verbatim by convention: a rewording that keeps the
// meaning still fails it, and updating the pin belongs to that same edit.
//
// The legs that prove an absence each state what they cover rather than
// reporting a clean sweep. The number of them is deliberately not stated: a
// count over this block's own legs is the closed-enumeration shape the plan
// that landed these claims bars everywhere else, and retiring a leg is
// exactly the edit that falsifies one.
//   The size-figure leg reads a digit-led figure in one of eight named units. The
//   units are a hand-written list, so the named spellings are swept and the class
//   is not: "1 gigabyte", "8 MiB", "90 kilobytes" and "two hundred lines" all
//   pass it. It runs over the whole file with no subject window, which is
//   deliberate: a window naming the board scopes almost nothing here (the word
//   occurs over two hundred times), so the honest form is the wider sweep plus
//   this note that a legitimate size figure added anywhere in this file reddens
//   the leg. That direction is accepted, since the file states no board size figure
//   today; the one size figure it does state is a 40-character cap on a hostname,
//   which is not a board ceiling and is why this note reads board rather than any.
//   The tier-locator leg names one spelling, the memory index filename, and it
//   does not reach the class of every way a locator could be spelled; the
//   exclusion sentence pinned beside it is what carries that claim.
//   The two curated indexes carry no leg here, and that is a statement of
//   coverage rather than an omission. Neither index restates this claim: the
//   subject both legs read was each index's entry for the plan that landed the
//   claims, and that plan is archived, so a positive leg would redden on an
//   absence that is now correct and an absence leg would pass over a file with
//   nothing in it to drift, reporting coverage it does not have. What carries
//   the claim is the pair of skill-side legs below, which read the exclusion
//   sentence and its route in the coordinator skill itself. A future index that
//   restates the claim again is a restating surface with no pin, and earns one.
test('the coordinator skill\'s four counted routing and homing claims are each pinned', () => {
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');

    // A digit-led figure in one of eight named size units, over the whole file.
    // Returned rather than asserted so the predicate can be run against a
    // control string in the same test.
    const sizeFigures = (text) => text.match(
        /\b\d[\d,]*\s*(?:bytes|characters|chars|KB|MB|GB|lines|words)\b/gi) || [];

    // Claim 1, section 1: the routing tests a candidate at the moment of
    // writing, states four kinds, names each off-board destination, and points
    // at the memory-system skill for tier mechanics instead of restating them.
    assert.ok(body.includes('Four kinds of candidate, and the board is where two of them go.'),
        'the coordinator skill no longer states the routing at four kinds with two of them '
        + 'boarding; this is the counted claim section 1 of the board-routing effort shipped, and '
        + 'the count and the two-of-four split are one claim that must move together');
    assert.ok(body.includes('a candidate is routed at the moment of writing rather than pruned at '
        + 'a cleanup later'),
        'the coordinator skill no longer routes a candidate at the moment of writing; deferring '
        + 'the question to a cleanup pass is the state section 1 shipped against, since a pruning '
        + 'pass then finds content it cannot delete without destroying the only copy');
    assert.ok(body.includes('a memory-store record written in the same pass that produced it and '
        + 'never also a board line'),
        'the coordinator skill no longer sends a durable lesson to a memory-store record in the '
        + 'same pass and off the board; this is one of the routing\'s two off-board destinations');
    assert.ok(body.includes('a kaizen note under the standing capture authorization the kaizen '
        + 'skill owns, never a board line'),
        'the coordinator skill no longer sends kit friction to a kaizen note under the kaizen '
        + 'skill\'s standing authorization and off the board; this is the routing\'s other '
        + 'off-board destination, and it is the one an edit drops most quietly, since the board '
        + 'reads as complete without it');
    assert.ok(body.includes('are all the memory-system skill\'s to state, and none of it is '
        + 'restated here'),
        'the coordinator skill no longer defers tier selection and authoring to the memory-system '
        + 'skill; section 1 shipped a pointer rather than a second copy of that contract, and a '
        + 'restatement here is a second contract a month later');
    assert.ok(body.includes('What no kind claims is written nowhere'),
        'the coordinator skill no longer states the routing\'s residual outcome, that a candidate '
        + 'no kind claims is written nowhere; without it the four-way test has no answer for a '
        + 'candidate that answers to none of its kinds');
    assert.ok(body.includes('The two board kinds are permissions and the two off-board ones are '
        + 'refusals'),
        'the coordinator skill no longer resolves a candidate answering to both a board kind and '
        + 'an off-board one; section 1 shipped this as a refusal winning over a permission rather '
        + 'than as a tiebreak, and an enumeration asserted exhaustive and mutually exclusive is '
        + 'what it replaced');

    // Claim 2, section 2: homing is named, distinct from pruning, leaves no
    // residue, and every cut is bounded by a confirmed landing elsewhere. The
    // no-residue rule's span runs from its verb through both of its objects,
    // since binding the clause alone is satisfied by a negating prefix.
    assert.ok(body.includes('**Homing returns a grown board\'s content to where it belonged, and '
        + 'it is not a prune.**'),
        'the coordinator skill no longer names homing as its own operation distinct from a prune; '
        + 'the prune-versus-home distinction is the claim section 2 shipped, and collapsing the '
        + 'two is what leaves a pruning pass destroying the only copy of a line');
    assert.ok(body.includes('the content then comes off the board outright, with no pointer to the '
        + 'record now holding it and no tombstone marking that it was ever there'),
        'the coordinator skill\'s no-residue rule is no longer present verbatim: homed content '
        + 'comes off the board with no pointer and no tombstone. A board that swapped each homed '
        + 'line for a pointer would keep a change log where the content had been and accrete at '
        + 'the rate it homed, which is what the rule refuses. Either the rule was inverted or the '
        + 'sentence was reworded; a rewording updates this pin in the same edit');
    assert.ok(body.includes('a round cuts only a line whose content it has confirmed landed '
        + 'somewhere else'),
        'the coordinator skill no longer bounds a homing cut on a confirmed landing elsewhere; '
        + 'this is the one invariant that makes the operation safe, and without it a round that '
        + 'fails at its destination write still cuts the board\'s only copy');
    assert.ok(body.includes('A round writes at two moments')
        && body.includes('The first moment\'s entry carries `fail` and the second `pass`'),
        'the coordinator skill no longer states the homing round\'s audit as two journal moments '
        + 'with the first carrying fail and the second pass; the two-moment shape is the audit '
        + 'record section 2 shipped, and a single moment cannot distinguish a round that died '
        + 'partway from one that never started');
    assert.ok(body.includes('Pruning is the other operation and is untouched by this one'),
        'the coordinator skill no longer holds pruning separate from homing; superseded history '
        + 'stays pruning\'s business, and merging the two operations is what section 2 shipped '
        + 'against');
    // The span opens at "before any destination write begins" because that is
    // where the safety lives: a rewrite moving the check after the write leaves
    // every later word intact.
    assert.ok(body.includes('before any destination write begins, the round establishes that its '
        + 'own first entry landed, and whether it landed cut'),
        'the coordinator skill no longer requires a round to confirm, before any destination write '
        + 'begins, that its own first journal entry landed and whether it landed cut; without it a '
        + 'round publishes and cuts on the strength of an account that may not exist, while the '
        + 'confirming read below covers only the destination write. The span deliberately opens on '
        + 'the ordering words, since a check moved to after the write keeps every later word');
    assert.ok(body.includes('An entry the round cannot establish landed, which includes one it '
        + 'establishes did not, leaves the round performing neither a destination write nor the '
        + 'cut'),
        'the coordinator skill no longer states what a round does when it cannot establish that its '
        + 'own first entry landed. The span includes the condition on purpose, and the condition is '
        + 'the unknown rather than an observed failure: a clause covering only an entry known not to '
        + 'have landed lets a round publish and cut on a landing it never established, which is the '
        + 'direction every other reading in this file takes the other way');

    // Claim 3, section 3: the readability test is the board's health rule and a
    // size figure is not. The absence leg's coverage is stated in the header.
    assert.ok(body.includes('**The board\'s readability test is that a cold successor takes the '
        + 'seat from one read of it.**'),
        'the coordinator skill no longer states the board\'s readability test as a cold successor '
        + 'taking the seat from one read; this is the property section 3 shipped in place of a '
        + 'byte figure, and it is the test a pass checks and acts on');
    assert.ok(body.includes('that failure earns a homing round rather than a harder prune'),
        'the coordinator skill no longer names a homing round as what a readability failure earns; '
        + 'the test without its action is the recorded-and-ignored proxy section 3 replaced');
    assert.deepStrictEqual(sizeFigures(body), [],
        'the coordinator skill states a size figure, which section 3 replaced with the readability '
        + 'test above: a byte figure is a proxy that gets recorded and ignored, the reporting seat '
        + 'having carried one through twelve prunes with no behaviour change. This leg reads eight '
        + 'named units over the whole file, so a figure in a unit it does not name passes it and a '
        + 'legitimate figure on any subject reddens it; the header states both directions');
    assert.deepStrictEqual(sizeFigures('the board is homed whenever it passes 8,000 bytes on disk'),
        ['8,000 bytes'],
        'the size-figure predicate above no longer speaks at all; this control runs against a '
        + 'spelling the predicate\'s own literals name, so it proves the instrument functions and '
        + 'says nothing about its coverage of the class');

    // Claim 4: the reconciliation paragraph excludes every memory tier from the
    // sources the board is re-derived from, states that exclusion as deliberate,
    // and routes how a record reaches a session to the memory-system skill. The
    // pin is what stops a later editor re-adding a tier as a helpful omission
    // fix, which is the one such edit that reads as an improvement.
    assert.ok(body.includes('No memory tier is a source the board is re-derived from, and the '
        + 'source list above omits no tier by oversight'),
        'the coordinator skill\'s reconciliation paragraph no longer states that no memory tier is '
        + 'a source and that the omission is deliberate; this sentence is what lets a seat reading '
        + 'the runbook tell a considered exclusion from an oversight, and it stands in place of a '
        + 'source-list entry for the tier');
    assert.ok(body.includes('how a memory-tier record reaches a session is the memory-system '
        + 'skill\'s to state'),
        'the coordinator skill no longer routes the question of how a memory-tier record reaches a '
        + 'session to the memory-system skill; the exclusion without its route reads as a gap '
        + 'rather than as a category with a home elsewhere');
    assert.ok(!body.includes('MEMORY.md'),
        'the coordinator skill names the memory index file, which is a locator this file refuses: '
        + 'a locator here resolves a store location out of a machine-local signpost and widens the '
        + 'very source list the exclusion above closes. This leg names one spelling and does not '
        + 'reach every way a locator could be spelled; the exclusion sentence above is what carries '
        + 'the claim');

    // The two curated indexes restate nothing from this claim, so no leg reads
    // them. The header above states why they are unpinned and what carries the
    // claim in their place.

    const securityModel = fs.readFileSync(path.join(__dirname, '..', 'docs',
        'security-model.md'), 'utf8');
    assert.ok(securityModel.includes('a memory-store record on the tier the memory-system skill '
        + 'assigns it')
        && securityModel.includes('a note appended to a `kaizen/notes-*.md` file in the kit '
            + 'checkout'),
        'docs/security-model.md no longer names the routing\'s two off-board destinations in its '
        + 'coordinator section; it is a restating surface for claim 1, and an audit artifact that '
        + 'drops a destination understates what the seat writes outside its own directory');
});

// README's payload map and two peer-sessions clauses point at the role skill:
// the map entry promises the takeover ritual, the directory contract, the
// claim, and the standing delegation, and the peer-sessions Roles section
// names the role skill as the coordinator-directory contract's owner and the
// standing-delegation model's owner. Asserting only the far end would stay
// green after the pointers were deleted, so the near ends are pinned first,
// on the words each pointer promises rather than the whole line, since
// column alignment and sentence order are cosmetic and a reflow should not
// redden the suite. The far end then pins the skill on disk carrying what
// the pointers promise: the registry entry's own field lines, in the
// contract's order, rather than a heading, because a heading survives while
// the shape under it is renamed; the directory contract's four file forms
// and its single-writer rule; and the delegation model's own load-bearing
// phrases. The index-tracking assertion is taken here, once for this path,
// because this pin reaches the file through its own path constant rather
// than through a prose pointer: a target present in a worktree but never
// added passes on the machine that wrote it and resolves to nothing on a
// fresh install, and that coverage should not end because some bullet
// elsewhere was reworded.
test('the role skill is pointed at by README and peer-sessions and carries what the pointers promise', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const mapLine = readme.split(/\r?\n/).find((l) => /^\s*role\//.test(l));
    assert.ok(mapLine, 'README\'s payload map no longer carries a role/ '
        + 'entry; this pin reads that line as its near end');
    for (const word of ['takeover', 'directory contract', 'claim',
        'standing delegation']) {
        assert.ok(mapLine.toLowerCase().includes(word),
            'README\'s role/ map entry no longer mentions "' + word
            + '", one of the things it promises the skill owns');
    }

    const peerSessions = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'peer-sessions', 'SKILL.md'), 'utf8');
    assert.match(peerSessions, /the role skill owns the coordinator-directory contract/,
        'peer-sessions\' Roles section no longer names the role skill as the '
        + 'coordinator-directory contract\'s owner; the role skill is that '
        + 'contract\'s single owner and this clause is the pointer that keeps '
        + 'peer-sessions from restating it');
    assert.match(peerSessions, /owns the standing-delegation model/,
        'peer-sessions\' Roles section no longer names the role skill as the '
        + 'standing-delegation model\'s owner, so the seats\' one pointer to '
        + 'the delegation model is gone and a seat reading this file cannot '
        + 'reach it');

    const parts = ['plugins', 'claude-kit', 'skills', 'role', 'SKILL.md'];
    const target = path.join(__dirname, '..', ...parts);
    assert.ok(fs.existsSync(target),
        'README\'s payload map and the peer-sessions Roles section both '
        + 'point at a role skill that is not on disk: ' + parts.join('/'));
    const body = fs.readFileSync(target, 'utf8');

    // The directory contract the pointers promise: the four file forms, each
    // matched on its own name rather than a section heading.
    for (const promised of ['board.md', 'registry/<session-id>.md',
        'claims/heavy-process.md', 'admin-requests.md']) {
        assert.ok(body.includes(promised),
            'the role skill no longer carries "' + promised + '", which the '
            + 'coordinator-directory contract it owns has to name');
    }

    // The writer contract, pinned on its rule sentence's own lead rather than
    // on the bare token "single-writer": other sentences in the file carry
    // that token (the rule's board-and-registry half, the guard-exemption
    // paragraph), so a whole-body includes on the token stays green off a
    // residual mention after the contract's actual rule sentence is deleted.
    // Both halves are pinned, because the rule is per file and a rewrite that
    // keeps one half has silently re-imposed one rule on all four forms.
    assert.ok(body.includes('The writer rule is per file'),
        'the role skill no longer opens the per-file writer contract with its '
        + 'rule sentence; the board/registry and claim/inbox halves have no '
        + 'home without it');
    assert.ok(body.includes('multi-writer by design'),
        'the role skill no longer states that the claim file and the inbox '
        + 'are multi-writer by design, so the contract reads as one '
        + 'single-writer rule over forms that mechanically cannot obey it');

    // The registry entry shape: every field line, in the contract's order.
    // Matched as line leads so the fenced block's own lines are what is
    // pinned, and matched in order so a reordering reddens rather than
    // passing on bare presence.
    const bodyLines = body.split(/\r?\n/);
    let lastIdx = -1;
    for (const field of ['Name:', 'Role:', 'Repo:', 'Workdir:', 'Session:',
        'Started:', 'Status-updated:', 'Remaining:', 'Heartbeat:', 'Banked:',
        'Status:']) {
        const idx = bodyLines.findIndex((l, i) => i > lastIdx && l.startsWith(field));
        assert.ok(idx !== -1,
            'the role skill\'s registry entry shape no longer carries the '
            + 'field "' + field + '" after its predecessor, so the shape has '
            + 'dropped a field or reordered the contract');
        lastIdx = idx;
    }

    // The standing-delegation model, pinned on its own load-bearing phrases
    // rather than its heading: the chain, and the model-versus-grant line
    // that keeps a public skill from carrying an operator grant.
    assert.match(body, /Coordinator to Expert to Worker/,
        'the role skill no longer states the delegation chain, Coordinator '
        + 'to Expert to Worker, which is the model\'s spine');
    assert.match(body, /defines the delegation model and never the grant/,
        'the role skill no longer separates the delegation model from the '
        + 'grant; the skill body ships to every machine, so carrying the '
        + 'grant would turn an install into an authorization');

    // The claim file's three semantics that must not drift: the claim is
    // deleted at completion, never emptied or marked; it buys legibility,
    // never a guarantee; and what backstops it is its holder's own answer
    // rather than a process poll. The third carries two pins, the rule and
    // its reason, because the poll is what a later reader re-derives from
    // first principles: it is the obvious instrument for "is the box busy"
    // and it is degenerate in every direction, so a rule pinned without its
    // reason reads as an arbitrary prohibition and gets relaxed.
    assert.match(body, /delete it at completion/,
        'the role skill no longer deletes the claim at completion, so a '
        + 'finished claim would linger as a phantom hold on the box');
    assert.match(body, /legibility, never a guarantee/,
        'the role skill no longer bounds the claim to legibility, which '
        + 'upgrades a coordination file into an enforcement mechanism');
    assert.match(body, /never a process poll/,
        'the role skill no longer names the claim\'s holder as its backstop, '
        + 'so the retired process-list verdict can be re-derived as new');
    assert.match(body, /shorter than its interval/,
        'the role skill no longer states why a poll cannot backstop a claim, '
        + 'leaving the rule without the reason that stops a later pass '
        + 'restoring the poll as an improvement');
    assertTrackedInIndex('plugins/claude-kit/skills/role/SKILL.md');
});

// A site's first mention of `Status-updated:` is where that site declares
// who the field belongs to, and the two windows around it are what this pin
// reads. The near half of the declaration is the relative clause that
// follows the field list, so the deferral is asserted over the after-window
// alone: all three coordinator paragraphs say elsewhere in their own
// sentences that the role skill owns something else, the coordinator
// directory's contract at one and the claim protocol at another, so a
// deferral asserted over a whole paragraph is satisfied at two of the three
// with no deferral to this field's owner present at all. The windows are
// character counts around the field rather than a quoted field list,
// because the list's wording is free to change and a pin that quotes its
// far end fails on every honest rewording.
const STAMP_BEFORE = 80;
const STAMP_AFTER = 120;
function stampWindows(text, where) {
    const at = text.indexOf('`Status-updated:`');
    assert.ok(at !== -1, where + ' no longer names `Status-updated:`, so the '
        + 'field this pin follows has left the sentence and there is no '
        + 'declaration left to read');
    return {
        before: text.slice(Math.max(0, at - STAMP_BEFORE), at),
        after: text.slice(at, at + STAMP_AFTER),
    };
}

// A session or a seat named as what acts on the field. The stems span the
// verb's inflections and carry the `hand-` and `re-` compounds, because the
// class is "this site says a session writes this field" and a pattern
// spelling one member of that class goes quiet on every other while reading
// exactly like a clean result: `hand-write` is this plan's own word for the
// defect, so a pattern that cannot match it is not reading its own subject.
// The one compound excluded is `registry-stamp`, which names the instrument
// the rule requires rather than an act a session performs.
const STAMP_STEM = [
    'rewrit(?:e|es|ing|ten)', 'rewrote',
    'writ(?:e|es|ing|ten)', 'wrote',
    'stamp(?:s|ing|ed)?',
    'updat(?:e|es|ing|ed)',
    'set(?:s|ting)?',
    'fill(?:s|ing|ed)?',
    'refresh(?:es|ing|ed)?',
    'advanc(?:e|es|ing|ed)',
    'compos(?:e|es|ing|ed)',
    'record(?:s|ing|ed)?',
].join('|');
const STAMP_ACT = '\\b(?<!registry-)(?:hand-|re-)?(?:' + STAMP_STEM + ')\\b';
const STAMP_PASSIVE = '\\b(?:rewritten|written|stamped|updated|set|filled'
    + '|refreshed|advanced|composed|recorded)\\b';

// Both directions, because a reinstatement arrives in either voice. The gap
// between subject and verb is tempered to exclude `CLI`: the role skill's
// own declaration reads "a seat takeover or handoff, with the registry-stamp
// CLI stamping", where the seat is a noun of the push-moment list and the
// CLI is what stamps, so an untempered window between the two reads that
// legitimate sentence as a hand-write. Tempering rather than a shorter
// window, because a window short enough to miss it is also short enough to
// miss a real reinstatement one clause longer than the ones seen so far.
// It is applied to the declaration windows rather than to a paragraph: the
// role skill's own paragraph legitimately says later that a session's push
// writes both time fields while the stamping CLI reads the clock.
const HAND_WRITTEN_STAMP = new RegExp([
    '(session|seat)s?\\b(?:(?!CLI)[^.]){0,60}' + STAMP_ACT,
    STAMP_PASSIVE + '(?:(?!CLI)[^.]){0,40}\\bby\\b[^.]{0,30}(session|seat)s?\\b',
].join('|'));

// The role skill's push-moments paragraph (opening "The push moments, closed
// with their class") is the sole owner of which registry-entry lines a
// session hand-writes and which the registry-stamp CLI stamps instead. Six
// surfaces depend on that ownership without restating it: the park ritual's
// push step, the peer-sessions banking paragraph, the coordinator skill's
// three registry-reading sites, and the coordinator skill's own banked-pass
// paragraph, which is the one dependent that writes the field rather than
// reading it. Six is this pin's reach and not the class's size: the shipped
// tree names `Status-updated:` in more files than these, so a green here is
// evidence about the surfaces named and never a swept class. docs/architecture.md's
// registry-entry paragraph is a further dependent, pointing at this
// paragraph rather than restating it, and held by its own pin over that
// document rather than by this one. That pin carries the entry's field
// set, the writer-axis count and the pointer; it deliberately does not
// apply the shape below, which matches that document's repaired text as
// readily as its retired text, the subject there being writers rather
// than a declaration of who stamps. Every slice below runs through
// sliceBetween, whose near-edge assertion is what carries the scope here:
// these skill files carry one paragraph per line, so a lead plus a newline
// is the paragraph, and a lead that no longer opens the paragraph fails
// loudly rather than sliding the slice onto whichever paragraph happens to
// carry the lead next. Each assertion keys on a shape over the rule's
// substance rather than on a quoted clause, so an honest rewording of
// either end stays green while a reinstated hand-write does not, whatever
// words it is reinstated in.
test('the push-moments paragraph still owns the stamp and its six dependents still point at it', () => {
    const role = readRepoFile('plugins/claude-kit/skills/role/SKILL.md');
    const paragraph = sliceBetween(role,
        'The push moments, closed with their class', '\n',
        'the role skill\'s push-moments paragraph');

    const roleStamp = stampWindows(paragraph,
        'the role skill\'s push-moments paragraph');
    for (const [half, window] of Object.entries(roleStamp)) {
        assert.ok(!HAND_WRITTEN_STAMP.test(window),
            'the push-moments paragraph once again puts `Status-updated:` in '
            + 'a session\'s own hands, ' + half + ' its first mention of the '
            + 'field, which contradicts the registry entry\'s own shape a few '
            + 'lines above it, where the field reads "never written by hand"');
    }
    assert.match(paragraph, /(session|seat)[^.]{0,40}(rewrites?|writes?)[^.]{0,60}`Remaining:`/,
        'the push-moments paragraph no longer states that a session hand-'
        + 'writes `Remaining:` at a push moment, so the lines a session does '
        + 'still write by hand have lost their owner');
    assert.match(paragraph, /CLI[^.]{0,40}stamp(s|ing)[^.]{0,40}`Status-updated:`/,
        'the push-moments paragraph no longer states that the registry-'
        + 'stamp CLI, rather than the session, stamps `Status-updated:` at '
        + 'a push moment');
    assert.match(paragraph, /read from the clock at the (moment|time) of the write/,
        'the push-moments paragraph no longer states that the moment is read '
        + 'from the clock at the write, so the value it describes may be '
        + 'composed beforehand and carried in, which is the defect the field '
        + 'was taken out of a writer\'s hands to remove');
    assert.match(paragraph, /read from the clock[^.]{0,80}(stamping|registry-stamp) CLI/,
        'the push-moments paragraph no longer attributes the clock read to '
        + 'the stamping CLI, so the sentence reads again as though the '
        + 'session itself measures the moment it writes');
    // The clock-read rule covers exactly the two fields a session's own push
    // writes. Stated over every field the entry carries it is false, because
    // `Heartbeat:` comes from the seat-stop hook and `Banked:` from the
    // compaction checkpoint CLI, and a universal here also strands the audit
    // paragraph's session-written category with no members. Both halves are
    // asserted: which fields the sentence names, and that it does not reach
    // for a quantifier over the entry's fields as a class.
    const clockAt = paragraph.indexOf('read from the clock at the');
    const clockSentence = paragraph.slice(Math.max(0, clockAt - 220), clockAt + 120);
    for (const field of ['`Started:`', '`Status-updated:`']) {
        assert.ok(clockSentence.includes(field),
            'the push-moments paragraph\'s clock-read rule no longer names '
            + field + ', so one of the two fields a session\'s own push '
            + 'writes has fallen out of the rule that governs where its '
            + 'value comes from');
    }
    for (const field of ['`Heartbeat:`', '`Banked:`']) {
        assert.ok(!clockSentence.includes(field),
            'the push-moments paragraph\'s clock-read rule now reaches '
            + field + ', which no session\'s push writes: it is stamped by '
            + 'the seat-stop hook or the compaction checkpoint CLI, and the '
            + 'directory contract above names it as such');
    }
    assert.ok(!/\b(every|each|all)\b[^.]{0,40}\btime fields?\b/i.test(clockSentence),
        'the push-moments paragraph states the clock-read rule over the '
        + 'entry\'s time fields as a class, which is false for `Heartbeat:` '
        + 'and `Banked:` and strands the audit paragraph\'s session-written '
        + 'category with no members');

    // The far end of the same contradiction. The entry shape a few lines
    // above is where the field is declared machine-stamped, so a pin holding
    // only the push-moments paragraph would go green on a drift that moved
    // the hand-write invitation back up into the shape itself.
    const entryShape = sliceBetween(role,
        'Status-updated: <', '\n', 'the registry entry shape\'s '
        + '`Status-updated:` line');
    assert.match(entryShape, /(stamp|CLI)/,
        'the registry entry shape no longer names a stamp or the CLI as '
        + 'where `Status-updated:` comes from, so the push-moments '
        + 'paragraph\'s owner has lost the declaration it is read against');
    assert.ok(!HAND_WRITTEN_STAMP.test(entryShape),
        'the registry entry shape once again describes a session as writing '
        + '`Status-updated:` itself, which reinstates at the declaration the '
        + 'invitation every prose site has had removed');

    const park = readRepoFile('plugins/claude-kit/skills/park/SKILL.md');
    const parkStep = sliceBetween(park,
        '5. **Rewrite the registry entry\'s `Status:` line to parked', '\n',
        'the park ritual\'s drain step 5');
    assert.match(parkStep, /push moment/,
        'the park ritual\'s push step no longer names the push moment, so '
        + 'its dependence on the role skill\'s push-moments paragraph has '
        + 'no anchor left to point from');
    assert.match(parkStep, /role skill[^.]{0,80}writer rule/,
        'the park ritual\'s push step no longer points at the role skill for '
        + 'the entry\'s writer rule, so it either restates the rule it defers '
        + 'or defers to nothing');

    const peerSessions = readRepoFile('plugins/claude-kit/skills/peer-sessions/SKILL.md');
    const banking = sliceBetween(peerSessions,
        '**Each seat banks at its own moments', '\n',
        'the peer-sessions banking paragraph');
    assert.match(banking, /(writer|writes|written)[^.]{0,60}role skill|role skill[^.]{0,60}(writer|writes|written)/,
        'the peer-sessions banking paragraph no longer points at the role '
        + 'skill for the registry entry\'s writer rule and stamped fields');
    assert.match(banking, /stamp[^.]{0,60}(advanc|writ|stamp)[a-z]*[^.]{0,40}`Status-updated:`/,
        'the peer-sessions banking paragraph no longer names the stamp run, '
        + 'rather than a session\'s own prose edit, as what advances '
        + '`Status-updated:`');

    // All three coordinator sites read a registry entry's state, and all
    // three were repaired together: a pin covering one of them leaves a
    // regression at either of the others green, which is the miss this
    // plan has already recorded twice.
    const coordinator = readRepoFile('plugins/claude-kit/skills/coordinator/SKILL.md');
    const coordinatorSites = [
        ['- **Operator interface.** One voice toward the operator',
            'the coordinator skill\'s operator-interface bullet'],
        ['Each pass re-derives the board from durable state',
            'the coordinator skill\'s board-derivation sources'],
        ['Each of the three outcomes has its own disposition.',
            'the coordinator skill\'s live-session disposition'],
    ];
    for (const [lead, where] of coordinatorSites) {
        const site = sliceBetween(coordinator, lead, '\n', where);
        const stamp = stampWindows(site, where);
        assert.match(stamp.after, /role skill[^.]{0,60}(governs|owns)/,
            where + ' no longer defers to the role skill in the clause that '
            + 'follows the field, so it either restates the writer rule it '
            + 'defers or defers to nothing. A deferral elsewhere in the '
            + 'paragraph does not answer this: two of these paragraphs name '
            + 'the role skill as owning something else entirely');
        for (const [half, window] of Object.entries(stamp)) {
            assert.ok(!HAND_WRITTEN_STAMP.test(window),
                where + ' once again describes a session as writing '
                + '`Status-updated:` itself, ' + half + ' the field, which '
                + 're-issues from the read side the invitation every write '
                + 'site has had removed');
        }
    }

    // The sixth dependent is the one that writes the field rather than
    // reading it, and its failure is silent: `seat-stop.js` opens the
    // boundary marker only where `Status-updated:` is fresh, and only the
    // registry-stamp CLI advances that field, so a runbook naming a prose
    // push as the declaration sends a seat through a boundary that never
    // opens with nothing to say so.
    const bankedPass = sliceBetween(coordinator,
        'The last act of a pass', '\n',
        'the coordinator skill\'s banked-pass paragraph');
    assert.match(bankedPass, /stamp run/,
        'the coordinator skill\'s banked-pass paragraph no longer names the '
        + 'stamp run as part of its status push, so a coordinator seat is '
        + 'told to declare a boundary by an act that advances nothing the '
        + '`seat-stop.js` hook reads');
    assert.match(bankedPass, /`Status-updated:`/,
        'the coordinator skill\'s banked-pass paragraph no longer names the '
        + 'field the boundary marker is gated on, so the reason its prose '
        + 'lines are not the declaration has left the sentence');

    for (const skill of ['coordinator', 'park', 'peer-sessions', 'role']) {
        assertTrackedInIndex('plugins/claude-kit/skills/' + skill + '/SKILL.md');
    }
});

// The pointers pin ("the role skill is pointed at by README and
// peer-sessions and carries what the pointers promise") covers the
// delegation model's spine (the chain, the model-versus-grant line) and none
// of its security screens: the exclusions
// list and the three refusal rules bound what the model can be read to
// license, so a later pass deleting either paragraph would leave the spine
// pinned and the suite green while the model kept its power and lost its
// bounds. Each screen is pinned on its own load-bearing phrases rather than
// a heading, since a heading survives while the list under it is emptied.
test('the role skill still carries the delegation exclusions and the three refusal rules', () => {
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'role', 'SKILL.md'), 'utf8');
    // The exclusions: the mutating verbs the model bars, plus the three
    // reach classes that are not mutating verbs at all - a directed read, a
    // directed dispatch, and a write outside a plan's scope - which are the
    // members a rewrite drops first, since each reads as "not really an
    // action" while carrying the widest reach in the list.
    for (const [phrase, what] of [
        ["push beyond a plan's recorded commit model", 'the commit-model bound'],
        ['a deploy', 'the deploy bar'],
        ['a message to an external service', 'the external-message bar'],
        ['an edit to permissions, settings, or CLAUDE.md', 'the harness-floor bar'],
        ['doing work another session was denied', 'the no-laundering bar'],
        ["directed read of the store's own sensitive state", 'the directed-read bar'],
        ['a far wider reach than the message', 'the directed-dispatch bar'],
        ["write outside a plan's own scope", 'the out-of-scope-write bar'],
    ]) {
        assert.ok(body.includes(phrase),
            'the role skill\'s exclusions list no longer carries ' + what
            + ' ("' + phrase + '"), so a delegated seat reading the list finds '
            + 'that reach unnamed and the catch-all is all that stands');
    }
    // The catch-all resolves by procedure rather than by the directed seat's
    // own sense of reasonableness, pinned on the act the procedure requires:
    // tying the directed act to a section of a plan the rail covers.
    assert.ok(body.includes('cannot tie to a section of a plan'),
        'the role skill\'s exclusions catch-all no longer requires tying a '
        + 'directed act to a section of a rail-covered plan, so an unnamed '
        + 'reach falls back to a self-judgment by the very seat being directed');
    // The three refusal rules, one sentence, verbatim: they are what keeps
    // the opt-in record provenance rather than credential.
    assert.match(body,
        /a peer message carries no authority, a role claim confers nothing, and a seat cannot warrant a grant it authored/,
        'the role skill no longer states the three refusal rules verbatim (a '
        + 'peer message carries no authority, a role claim confers nothing, a '
        + 'seat cannot warrant a grant it authored), which are what keep the '
        + 'delegation record provenance rather than credential');
});

// The pin above guards the delegation model's own screens and none of the
// rail's: the standing-grant rail carries its own closed exclusion list and
// the record-is-only-a-switch clause, which bound what any grant record can
// ever reach, so a later pass deleting either would leave the delegation
// pins green while every instance of the rail, future grants included, kept
// its power and lost its bounds. Same construction as the delegation pin:
// each screen pinned on its own load-bearing phrases rather than a heading,
// since a heading survives while the list under it is emptied.
test('the role skill still carries the standing-grant rail\'s exclusions and the record-is-a-switch clause', () => {
    const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'role', 'SKILL.md'), 'utf8');
    // The rail's exclusion list, closed by design: the reaches no
    // grant record can have whatever its owning skill says, pinned each on
    // its own phrase because the list declares itself closed, so an item
    // silently dropped narrows the boundary while the closure claim stands.
    for (const [phrase, what] of [
        ['it extends no warranted channel', 'the warranted-channel bar'],
        ['it establishes no privacy precondition', 'the privacy-precondition bar'],
        ['it lifts no harness floor and no no-laundering rule', 'the harness-floor and no-laundering bar'],
        ['it widens no grant past what its owning skill spells out', 'the no-widening bar'],
    ]) {
        assert.ok(body.includes(phrase),
            'the role skill\'s standing-grant rail no longer carries ' + what
            + ' ("' + phrase + '"), so a grant record reaching for it finds '
            + 'the reach unnamed while the list still claims to be closed');
    }
    // The record-is-only-a-switch clause, the rail's core: without it a
    // record's body reads as carrying the grant's scope, which is exactly
    // the unauthenticated-widening the rail exists to refuse.
    assert.match(body, /The record is only ever the switch/,
        'the role skill no longer states that a standing-grant record is '
        + 'only ever the switch, so a record\'s body can be read as carrying '
        + 'the grant\'s scope');
    assert.match(body, /neither widen nor narrow/,
        'the role skill no longer states that a record\'s body can neither '
        + 'widen nor narrow the mechanism, which is the clause that makes '
        + 'the body data rather than authority');
    // The lead-in that scopes the list, pinned on its own because the
    // bars above read identically under a narrower one: re-scoping this
    // sentence to the delegation model alone would confine the closed
    // boundary to a single instance and leave every other grant
    // unbounded, with every phrase above still present and every
    // assertion above still green. The closure sentence rides with it,
    // since a list that stops declaring itself closed is one a later
    // pass may add reaches to.
    for (const [phrase, what] of [
        ['What the rail can never reach, stated as its own exclusion list',
            'the lead-in scoping the exclusion list to the rail rather than to one instance'],
        ['The list is the rail\'s boundary and it is closed by design',
            'the closure sentence that makes the list a boundary rather than examples'],
        ['Three refusal rules bind every instance of the rail',
            'the clause binding the refusal rules to every instance rather than to delegation alone'],
    ]) {
        assert.ok(body.includes(phrase),
            'the role skill\'s standing-grant rail no longer carries '
            + what + ' ("' + phrase + '"), so the screens below it hold '
            + 'for one grant while the rail admits others unbounded');
    }
    // The one-bit clause: where a grant's scope is a single act there is
    // nothing for the body-is-data rule to narrow, so without this the
    // switch and the authorization are the same object and the record's
    // presence is the whole grant.
    assert.match(body, /the record's presence is never by itself the authorization/,
        'the role skill no longer states that a one-bit grant\'s record is '
        + 'never by itself the authorization, so a grant whose scope is a '
        + 'single act is authorized by the existence of its own switch');
});

// The coordinator seat carries no git prohibition of its own and no exception
// to one: it runs under whatever governs every other session on this machine,
// and what stands where the prohibition stood is the working principle it
// hardened around, stated in the never-tasks-directly rule's own verbs: the
// seat dispatches nothing, it produces artifacts and asks. Both
// halves are pinned, because either alone passes on the wrong tree: a file
// that reinstated the bar would still carry the principle, and one that
// dropped the principle would still be silent under the sweep.
//
// The absence half is structural rather than a list of the sentences that
// once shipped, since a bar rewritten in vocabulary this file never carried
// would clear a literal list while binding the seat exactly as the retired
// one did. What the predicate selects is a prohibition ABOUT GIT IN THE
// STORE: a negation, an interdiction word, a nothing-as-object clause, a
// possessive assignment away from the seat, an exclusivity or belonging claim
// naming the sync as the actor, a passive-agent clause excluding the seat, an
// unscoped routing claim, a deference or remit clause, or a bare-noun list,
// each of them required to carry one of the store's own objects inside the
// same window.
// That object requirement is what keeps the predicate off prohibitions about
// the seat generally, which are ordinary prose all over this kit: "the seat
// does not touch a peer registry entry" and "the seat may not run the suite
// while another session holds the slot" are sentences the seat's contracts
// need, and a predicate that reads them as a reinstated git bar reds on
// healthy text and gets weakened by whoever hits it. The board counts as such
// an object only beside a publishing verb, because touching or reading a
// board is not a git act.
//
// What the controls below demonstrate, stated at their real strength. There
// are nine of them, and none of them demonstrates reach. Every alternative
// this predicate carries enumerates the trigger words of the form it selects,
// so any sentence the predicate matches spells at least one phrasing the
// predicate was handed, and each control below is therefore a literal control:
// it proves the instrument still executes over the form it exercises, and it
// proves nothing about what the predicate would catch beyond that form. Reach
// is OPEN and unmeasured here rather than enumerated, and the honest reading
// of the sweep below is that the enumerated forms are swept and the class of
// seat-git bars is not. A list of the forms that escape cannot be written
// either, since the forms that escape are exactly the ones nobody thought to
// enumerate, so the alternatives grow whenever a live escape is found and the
// coverage claim never grows with them. The sweep reports what its own
// predicate matched over the class it walks, and it is never a clean-class
// result.
const SEAT_STORE_OBJECT = '(?:git|the store|the memory store)';
// The board is a git object only where a publishing verb governs it.
const SEAT_PUBLISH_OBJECT = '(?:git|the store|the memory store|the board)';
const SEAT_GIT_VERB = '(?:runs?|running|ran|touch(?:es|ing)?|assembles?|commits?'
    + '|committing|stages?|staging|push(?:es)?|pushing)';
const SEAT_PUBLISH_VERB = '(?:commits?|committing|stages?|staging|push(?:es)?|pushing)';
const SEAT_NEGATION = '(?:may|must|does|do|can|could|will|would|shall|is|are)'
    + '\\s+not\\s+(?:to\\s+)?';
const SEAT_BAR_NOUN = '(?:staging|committing|pushing|commit|push)';
const SEAT_GIT_BAR = new RegExp([
    '\\b(?:runs?|running|ran)\\s+no\\s+git\\b',
    '\\bno\\s+git\\s+(?:in the store|of its own|at all|to check)\\b',
    '\\bgit\\b[^.]{0,60}?\\bbeing closed to\\b',
    // A negated verb carrying one of the store's objects, which is what
    // catches a bar whose subject is a pronoun ("it may not run git here").
    SEAT_NEGATION + SEAT_GIT_VERB + '\\b[^.]{0,60}?\\b' + SEAT_STORE_OBJECT + '\\b',
    SEAT_NEGATION + SEAT_PUBLISH_VERB + '\\b[^.]{0,60}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\bis not the one\\b[^.]{0,60}?\\b' + SEAT_GIT_VERB + '\\b[^.]{0,40}?\\b'
        + SEAT_PUBLISH_OBJECT + '\\b',
    '\\bnever\\s+' + SEAT_GIT_VERB + '\\b[^.`]{0,40}?\\b' + SEAT_STORE_OBJECT + '\\b',
    '\\bnever\\s+' + SEAT_PUBLISH_VERB + '\\b[^.`]{0,40}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\bneither\\s+' + SEAT_GIT_VERB + '\\b[^.]{0,40}?\\bnor\\s+' + SEAT_GIT_VERB
        + '\\b[^.]{0,40}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\bwithout\\s+(?:ever\\s+)?(?:running|committing|staging|pushing|touching)\\b'
        + '[^.]{0,60}?\\b' + SEAT_STORE_OBJECT + '\\b',
    '\\bleaves?\\b[^.]{0,30}?\\b' + SEAT_STORE_OBJECT + '\\b[^.]{0,40}?'
        + '\\bto\\s+the\\s+sync\\b',
    // The possessive assignment, which is this corpus's own idiom for the bar
    // and carries no negated verb at all ("git in the store is the sync's job
    // and not the seat's").
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,80}?\\b(?:not|never|rather than)\\s+the\\s+'
        + '(?:seat|coordinator)\'s\\b',
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\b(?:is|are|stays?|remains?)'
        + '\\s+the\\s+sync\'s\\b',
    '\\b(?:barred|forbidden|prohibited|off[- ]limits|bars|forbids?|prohibits?|refrains?)'
        + '\\b[^.]{0,60}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\b(?:git|the store)\\b[^.]{0,60}?\\b(?:is|are|stays?|remains?)\\s+'
        + '(?:off[- ]limits|barred|forbidden|prohibited|closed|reserved)\\b',
    // The nothing-as-object form, which carries no negation word at all
    // ("it stages nothing and commits nothing in the store").
    '\\b(?:stages?|commits?|pushes)\\s+nothing\\b[^.]{0,60}?\\b'
        + SEAT_PUBLISH_OBJECT + '\\b',
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\b(?:stages?|commits?|pushes)'
        + '\\s+nothing\\b',
    '\\bruns\\s+none\\b[^.]{0,60}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\bruns\\s+none\\b',
    // The exclusivity form, which bars the seat by naming the sync as the only
    // actor and need not name the seat at all ("only the sync commits and
    // pushes the store", "the store's committer is the sync, and only the
    // sync").
    '\\bonly\\s+the\\s+sync\\b[^.]{0,80}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,80}?\\bonly\\s+the\\s+sync\\b',
    // The belonging form ("git in the store belongs to the sync"). Its sibling
    // spelling, "the store is the sync's to commit", is already carried by the
    // possessive alternative above.
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\b(?:belongs?|belonging)\\s+to\\s+the\\s+sync\\b',
    // The passive-agent form, which names the actor after the verb and the
    // seat only in the exclusion ("the store is committed by the sync rather
    // than by the seat"), in both orders, since the object reads as the agent
    // in the half of them that spells "committed by the store".
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\b(?:committed|pushed|staged)\\s+by\\b'
        + '[^.]{0,60}?\\b(?:rather\\s+than|not)\\s+by\\s+the\\s+(?:seat|coordinator)\\b',
    '\\b(?:committed|pushed|staged)\\s+by\\s+' + SEAT_PUBLISH_OBJECT
        + '\\b[^.]{0,60}?\\b(?:rather\\s+than|not)\\s+by\\s+the\\s+(?:seat|coordinator)\\b',
    // The routing form with nothing scoping it to a read. Routing stated over
    // a git or store object at large is the retired bar under another name,
    // where routing a read of the store's own configuration and history is the
    // shipped standing sentence, so the window is tempered against that
    // qualifier rather than left to select both.
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b(?:(?!history)[^.]){0,80}?'
        + '\\broutes?\\s+rather\\s+than\\s+performs\\b',
    // Deference and remit, which bar by naming where the work belongs or how
    // far the seat reaches rather than by negating any verb.
    '\\bdefers?\\s+to\\s+the\\s+sync\\b[^.]{0,60}?\\b' + SEAT_STORE_OBJECT + '\\b',
    '\\bno\\s+business\\b[^.]{0,60}?\\b' + SEAT_STORE_OBJECT + '\\b',
    '\\b' + SEAT_STORE_OBJECT + '\\b[^.]{0,60}?\\b(?:is|are)\\s+beyond\\s+the\\s+'
        + '(?:seat|coordinator)\'s\\b',
    // The bare-noun list, which is the retired bar's own shape with the verbs
    // dropped ("no staging, no commit, no push").
    '\\bno\\s+' + SEAT_BAR_NOUN + '\\b[^.]{0,40}?\\bno\\s+' + SEAT_BAR_NOUN
        + '\\b[^.]{0,60}?\\b' + SEAT_PUBLISH_OBJECT + '\\b',
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\bno\\s+' + SEAT_BAR_NOUN
        + '\\b[^.]{0,40}?\\bno\\s+' + SEAT_BAR_NOUN + '\\b',
    '\\bno\\s+(?:staging|committing|pushing)\\b[^.]{0,60}?\\b'
        + SEAT_PUBLISH_OBJECT + '\\b',
    '\\b' + SEAT_PUBLISH_OBJECT + '\\b[^.]{0,60}?\\bno\\s+(?:staging|committing|pushing)\\b',
].join('|'), 'i');

test('the coordinator skill states no git prohibition and carries the workload principle in its place', () => {
    const body = readRepoFile('plugins/claude-kit/skills/coordinator/SKILL.md');
    // Nine literal controls, one per enumerated form, each spelling a phrasing
    // the predicate was handed. Each proves the instrument still executes over
    // the form it names; none of them establishes reach, per the accounting
    // above.
    for (const [control, what] of [
        ['The seat writes the file and runs no git in the store, the sync being '
            + 'the store\'s only committer.', 'the negated-verb form'],
        ['Committing and pushing the store is the sync\'s alone, never the '
            + 'seat\'s.', 'the possessive assignment away from the seat'],
        ['The coordinator neither commits nor pushes the store.',
            'the neither/nor pair'],
        ['The coordinator may not push the board it wrote.',
            'a negated publishing verb over the board'],
        // The mutation a later editor of the coordinator's own durability
        // override would most plausibly write: its positive standing sentence
        // turned back into a bar, present and grammatical where it would land.
        ['The seat is not to run git in the store, reading the store\'s own '
            + 'history being work this seat routes rather than performs.',
            'the standing sentence turned back into a bar'],
        ['Only the sync commits and pushes the store.', 'the exclusivity form'],
        ['Git in the store belongs to the sync.', 'the belonging form'],
        ['The store is committed by the sync rather than by the seat.',
            'the passive-agent form'],
        // The routing claim stated over git at large rather than over a read,
        // which is the retired bar under another name and the mutation the
        // durability override's own standing sentence is nearest to.
        ['Every git act in the store is work this seat routes rather than performs.',
            'the routing form with no read scoping it'],
    ]) {
        assert.ok(SEAT_GIT_BAR.test(control), 'the sweep\'s predicate no longer '
            + 'selects a reinstated seat-git prohibition in ' + what + ' ("'
            + control + '"), so its silence over the shipped kit means nothing');
    }
    // Prohibitions about the seat that are not about git in the store, which
    // the seat's own contracts need and which a predicate reading them as a
    // git bar would red on. The first is read from the shipped file rather
    // than copied here, so it cannot drift from the sentence it is about.
    const standingSentence = sentenceStartingWith(body,
        'The seat may run git in the store exactly as any other session',
        'the coordinator skill\'s statement of the seat\'s git standing');
    for (const negative of [
        standingSentence,
        'The seat does not touch a peer registry entry.',
        'The seat may not run the suite while another session holds the slot.',
        'The seat never touches the board of another machine.',
    ]) {
        assert.ok(!SEAT_GIT_BAR.test(negative), 'the sweep\'s predicate now '
            + 'selects a sentence that bars the seat from nothing in the store '
            + '("' + negative + '"), so its hits are prohibitions about the seat '
            + 'at large rather than prohibitions about git in the store');
    }

    // The scope is the class, every shipped kit markdown file the walker
    // enumerates, because a sweep over one file goes green over the bar
    // reinstated in the file nobody listed.
    const barred = [];
    for (const full of shippedKitMarkdown()) {
        const shipped = path.relative(path.join(__dirname, '..', 'plugins',
            'claude-kit'), full).split(path.sep).join('/');
        fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
            if (SEAT_GIT_BAR.test(line)) {
                barred.push(shipped + ':' + (i + 1) + ' ' + line.trim().slice(0, 160));
            }
        });
    }
    assert.deepStrictEqual(barred, [], 'a shipped kit surface bars the seat from '
        + 'git, or from staging, committing or pushing the store, again. The seat '
        + 'holds no such bar: it runs under whatever governs every other session '
        + 'on this machine, and the working shape the retired bar hardened around '
        + 'is carried by the board-write rule\'s workload principle instead:\n'
        + barred.join('\n'));

    // The exception the prohibition carried goes with the prohibition, and it
    // goes from every shipped kit surface rather than from the two files that
    // stated the rule: an exception keyed on a record and left standing over a
    // rule no skill states reads as a grant of its own wherever it sits, and
    // the rail's own fail-closed clause leaves an instance whose owning
    // contract states no path resolving to nothing. The operator-tier record
    // these phrases name is the operator's to delete and is in the store, so a
    // seat that meets one of them and resolves it finds a live switch whose
    // bounds live nowhere. The scope is therefore the class, every shipped kit
    // markdown file the walker enumerates, because a sweep over named files
    // goes green over the copy in the file nobody listed.
    //
    // This is an absence check twice over, so both silences are earned before
    // either is read. The walker's enumeration carries a floor, because a
    // walker returning an empty list passes this loop vacuously and reads
    // exactly like a clean tree; and the phrase test is run against a surface
    // that does hold one of the phrases, so a test that had stopped answering
    // speaks here rather than at the tree. Its residue is the phrases
    // themselves: the three are the exception's shipped spellings, and an
    // exception reinstated in words none of them carries, "the operator-tier
    // record the role skill's rail names" among them, passes this loop.
    const exceptionPhrases = ['memory-store-pushes-need-no-permission',
        'store-push', 'sanctioned store path'];
    const carriesException = (surface) => exceptionPhrases
        .filter((phrase) => surface.includes(phrase));
    assert.deepStrictEqual(carriesException('The seat publishes by the '
        + 'sanctioned store path this exception names.'),
        ['sanctioned store path'], 'the retired-exception test '
        + 'no longer answers on a surface that does hold the exception, so its '
        + 'silence over the shipped kit means nothing');
    const surfaces = shippedKitMarkdown();
    // The floor is set near the population rather than far below it, since a
    // floor a walker can meet while dropping half the class reads exactly like
    // a clean sweep. It sits a little under the real count so that retiring one
    // surface is not a red, and the structural check beside it is what catches
    // a walker that lost a whole directory while still clearing the number:
    // every skill directory ships a SKILL.md, so every one of them has to
    // appear in what the walker returned.
    assert.ok(surfaces.length >= 40, 'the shipped-kit-markdown walker enumerated '
        + 'only ' + surfaces.length + ' files, which is fewer than this kit '
        + 'ships, so the sweeps that read its silence swept next to nothing');
    const skillsDir = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills');
    const missedSkillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !surfaces.some((full) => full
            === path.join(skillsDir, name, 'SKILL.md')));
    assert.deepStrictEqual(missedSkillDirs, [], 'the shipped-kit-markdown walker '
        + 'returned no SKILL.md for a directory that ships one, so the sweeps '
        + 'that read its silence are silent about those skills rather than '
        + 'clean over them:\n' + missedSkillDirs.join('\n'));
    const carryingException = [];
    for (const full of surfaces) {
        const shipped = path.relative(path.join(__dirname, '..', 'plugins',
            'claude-kit'), full).split(path.sep).join('/');
        for (const phrase of carriesException(fs.readFileSync(full, 'utf8'))) {
            carryingException.push(shipped + ' ("' + phrase + '")');
        }
    }
    assert.deepStrictEqual(carryingException, [], 'a shipped kit surface '
        + 'carries the retired store-git exception again, keying a grant on a '
        + 'memory record against a prohibition no skill states. The record is '
        + 'in the store, so a seat that resolves one of these finds a live '
        + 'switch whose bounds live nowhere:\n' + carryingException.join('\n'));

    // The principle, read in the paragraph the prohibition stood in rather
    // than anywhere in the file: a sentence that drifted out of the
    // board-write rule satisfies a whole-file match while the pass reading
    // that rule never reaches it.
    const boardWrite = sliceBetween(body, '**The board write.**', '\n',
        'the coordinator skill\'s board-write rule');
    assert.ok(boardWrite.includes('the never-tasks-directly rule\'s own shape '
        + 'and no second rule beside it: the seat dispatches nothing, it '
        + 'produces artifacts and asks'),
        'the coordinator skill\'s board-write rule no longer states the '
        + 'workload principle the retired git prohibition hardened around, in '
        + 'the verbs the never-tasks-directly rule itself uses, so the rule '
        + 'either reads as a bare description of a file write or restates that '
        + 'rule loosely enough to stand beside it as a second, weaker one');

    // The hand-publish route, pinned as the route plus the sentence that
    // scopes the three guards to it. The route is the screened one: the sync
    // script by hand keeps the single-flight lock, the outbound leak probes
    // and the inbound tree screen, where the bare pair keeps none of the
    // three. All three belong to that one run rather than to the store's
    // channel, since the channel supplies none of them and the bare pair goes
    // through the same channel carrying none, so the scoping sentence is what
    // stops a reader taking them for a protection any hand publish inherits.
    // Widen that sentence back to the channel and every named guard stays in
    // place while the rule states a protection nothing supplies. The hook's
    // own two protections are pinned beside it for the inverse edit, the one
    // that reads the hand run as equivalent to the unattended spawn.
    for (const [phrase, what] of [
        ['`doctor/sync-store.ps1` with an explicit `-StoreRoot`',
            'the screened path a seat closes the lag by'],
        ['the same script the session-start hook spawns, though not the same run',
            'the hand run stated as the same script rather than the same path'],
        ['Two protections the hook puts around that spawn do not come with a '
            + 'hand run', 'the two protections a hand run does not inherit'],
        ['it takes no lock, runs no leak probe, and runs no inbound screen at all',
            'what the bare git pair skips'],
        ['is the outbound half', 'the memory-system gate stated at what it covers'],
        ['None of the three is a privilege of this seat, and none is a property '
            + 'of the store\'s channel either: each belongs to that one run',
            'the sentence scoping those guards to the run that performs them '
            + 'rather than to this seat or to the channel'],
        ['Off Windows the screened run is not on offer at all',
            'the off-Windows case, where the screened run has no runner'],
    ]) {
        assert.ok(boardWrite.includes(phrase), 'the coordinator skill\'s '
            + 'board-write rule no longer carries ' + what + ' ("' + phrase
            + '"), so a seat closing its own visibility lag is pointed at a '
            + 'hand path that holds no lock and screens neither direction, or '
            + 'reads guards that one run performs as protections the channel '
            + 'supplies to every hand publish');
    }

    // The seat's git standing, which is the sentence the removal installed and
    // the one a later editor would most plausibly walk back. Pinned with the
    // clause that scopes the routing to reads, since routing stated over the
    // whole of git is the retired bar under another name.
    const durability = sliceBetween(body,
        '- **Durable, and committed by the store\'s own sync as the automatic '
        + 'committer.**', '\n',
        'the coordinator skill\'s durability override');
    for (const [phrase, what] of [
        ['The seat may run git in the store exactly as any other session on '
            + 'this machine may', 'the seat\'s git standing'],
        ['reading the store\'s own configuration and history is work it routes '
            + 'rather than performs', 'the routing choice at the one scope the '
            + 'file states it in, which the cold-start step and the '
            + 'state-file read both cite rather than restate'],
        ['Publishing its own board by hand is the separate case, open to this '
            + 'seat as to any other session', 'the hand publish left open to '
            + 'this seat'],
    ]) {
        assert.ok(durability.includes(phrase), 'the coordinator skill\'s '
            + 'durability override no longer states ' + what + ' ("' + phrase
            + '"), so the seat either reads as barred from git in the store '
            + 'again or cannot tell from the shipped text whether it may '
            + 'publish its own board');
    }

    // The contested-seat anchor's premise. The freeze covers the write half
    // alone, so the two reasons that reach the read half are pinned beside it:
    // a seat that may read the store's history and is told only that the
    // freeze forbids a board act has been given a reason that does not reach
    // what it is about to do.
    const contested = sliceBetween(body, '**A contested seat freezes the board.**',
        '\n', 'the coordinator skill\'s contested-seat rule');
    for (const [phrase, what] of [
        ['Handing over either of them is out for three reasons rather than one',
            'the sentence scoping the reasons to both versions'],
        ['is a change to the board, which the freeze forbids while the contest '
            + 'stands', 'the freeze, which reaches the write half'],
        // Anchored on the handing-over premise rather than on the routing
        // rule alone, which this paragraph also cites where it explains the
        // freeze's own fail-open direction.
        ['naming one of two versions authoritative is settling the contest, '
            + 'which is the seat ruling on its own collision', 'the routing '
            + 'rule, which reaches the read half'],
        ['reading the store\'s own history is work this seat routes rather '
            + 'than performs under the durability override above',
            'the routes-rather-than-performs choice, which reaches the read half'],
    ]) {
        assert.ok(contested.includes(phrase), 'the coordinator skill\'s '
            + 'contested-seat rule no longer carries ' + what + ' ("' + phrase
            + '"), so handing the operator a version rests on a freeze that '
            + 'reaches a restore and not a read, and the seat may read');
    }

    // The rail's instance list on the other side of the removal. Delegation
    // stays the first instance, and the rail's own lead-in stays with it,
    // since an instance left standing under a rewritten lead-in is an
    // instance of nothing; the loop above is what asserts that no dead second
    // one was left behind.
    const role = readRepoFile('plugins/claude-kit/skills/role/SKILL.md');
    for (const [phrase, what] of [
        ['The delegation model is the rail\'s first instance rather than a one-off',
            'delegation read as the rail\'s first instance'],
        ['A standing operational grant is a mechanism whose entire scope, '
            + 'exclusions, and procedure a shipped skill states',
            'the rail\'s own lead-in, which is what an instance is an instance of'],
    ]) {
        assert.ok(role.includes(phrase), 'the role skill no longer carries '
            + what + ' ("' + phrase + '"), so the rail either names an instance '
            + 'of nothing or has lost the one instance it still owns');
    }

    for (const rel of ['plugins/claude-kit/skills/coordinator/SKILL.md',
        'plugins/claude-kit/skills/role/SKILL.md']) {
        assertTrackedInIndex(rel);
    }
});

// The box-budget brief clause in executing-work's Dispatch Brief template is
// a deliberate second copy of the role skill's claim contract: the clause is
// the only copy a dispatched subagent receives, since an agent inherits no
// skills, so the two surfaces can drift while every pin above stays green,
// every claim pin above reading the role skill alone. This pin holds the two
// copies to each other at the phrases that do the work: the claim's field
// set, derived from the shape-bearing sentence on each surface and compared
// as sets rather than listed here, the session-scoped delete, and the poll
// stated as a sample rather than a clearance, with the process list named
// nowhere in the clause, since a process-list verdict in the brief is the
// one instruction that licenses a subagent to start a suite beside a live
// foreign gate. The clause region is sliced by its own landmarks rather
// than matched against the whole file, so role-contract language elsewhere
// in executing-work cannot satisfy a pin about what the brief actually says.
test('the box-budget brief clause agrees with the role skill\'s claim contract and carries no process-list verdict', () => {
    const executingWork = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8');
    const start = executingWork.indexOf('The standing box-budget clause');
    const end = executingWork.indexOf('The two-question grant audit');
    assert.ok(start !== -1, 'executing-work\'s Dispatch Brief template no '
        + 'longer carries the standing box-budget clause lead, so the brief a '
        + 'heavy-spawning subagent receives has lost the claim protocol');
    assert.ok(end !== -1 && end > start, 'executing-work\'s Dispatch Brief '
        + 'template no longer carries the grant-audit bullet that bounds the '
        + 'box-budget clause, so the slice this pin reads has no far edge');
    const clause = collapseWhitespace(executingWork.slice(start, end));
    const roleBody = collapseWhitespace(fs.readFileSync(path.join(__dirname,
        '..', 'plugins', 'claude-kit', 'skills', 'role', 'SKILL.md'), 'utf8'));

    // The claim's field set, derived from each surface rather than named
    // here: a pin carrying its own list of the fields is a third literal
    // that drifts with neither surface, so a field added to one side alone
    // reads green against it. The derivation reads the shape-bearing
    // sentence on each side, never the whole region, because both regions
    // mention fields incidentally (the probe addresses `Name:`, the delete
    // is scoped by `Session:`): a whole-region read stays green when a
    // field is dropped from the shape sentence but still mentioned
    // elsewhere in the region, and reddens spuriously when a non-shape
    // sentence gains a field mention, both misfires on the one-sided-drift
    // class this comparison exists to catch. Set equality over the two
    // shape sentences catches a one-sided addition, and a one-sided
    // removal by the same comparison. The clause is what the subagent
    // copies into the claim and the role skill is the contract the
    // coordinator probes and releases against, so a field on one side
    // only is a claim the other side cannot parse.
    const roleClaimStart = roleBody.indexOf('## The claim file');
    const roleClaimEnd = roleBody.indexOf('## The takeover ritual');
    assert.ok(roleClaimStart !== -1 && roleClaimEnd > roleClaimStart,
        'the role skill no longer carries a claim-file section between its '
        + 'own headings, so the slice this pin derives the claim fields '
        + 'from has no edges');
    const roleSection = roleBody.slice(roleClaimStart, roleClaimEnd);
    const roleShapeStart = roleSection.indexOf(
        'write `claims/heavy-process.md` carrying');
    const roleShapeEnd = roleSection.indexOf(
        'delete it at completion', roleShapeStart);
    assert.ok(roleShapeStart !== -1 && roleShapeEnd > roleShapeStart,
        'the role skill\'s claim-file section no longer carries its '
        + 'shape-bearing sentence ("write `claims/heavy-process.md` '
        + 'carrying ... delete it at completion"), so the contract side of '
        + 'the field-set comparison has no sentence to derive from');
    const clauseShapeStart = clause.indexOf('write the claim with its');
    const clauseShapeEnd = clause.indexOf(
        'at completion delete only a claim', clauseShapeStart);
    assert.ok(clauseShapeStart !== -1 && clauseShapeEnd > clauseShapeStart,
        'the box-budget brief clause no longer carries its shape-bearing '
        + 'sentence ("write the claim with its ... fields" through the '
        + 'completion delete), so the clause side of the field-set '
        + 'comparison has no sentence to derive from');
    // The shared derivation, hoisted to module scope so this pin and the
    // registry-entry pin over docs/architecture.md read a field name the
    // same way; the token class and the reason for its width are stated
    // there.
    const claimFieldSet = backtickedFieldSet;
    const roleFields = claimFieldSet(
        roleSection.slice(roleShapeStart, roleShapeEnd));
    const clauseFields = claimFieldSet(
        clause.slice(clauseShapeStart, clauseShapeEnd));
    assert.ok(roleFields.length > 0,
        'the role skill\'s shape-bearing sentence names no claim fields at '
        + 'all, so this pin would compare two empty sets and pass on a '
        + 'contract that describes no claim');
    assert.strictEqual(clauseFields.join(', '), roleFields.join(', '),
        'the box-budget brief clause and the role skill\'s claim contract '
        + 'name different claim fields (clause: ' + clauseFields.join(', ')
        + '; contract: ' + roleFields.join(', ') + '), so a subagent briefed '
        + 'from the clause writes a claim the contract does not describe, or '
        + 'omits a field the coordinator needs');
    // The count lives here rather than in either surface's prose: a numeral
    // in the brief clause is a copy nothing checks, staying green while a
    // field lands correctly on both shape sentences and the numeral goes
    // false in the one copy a dispatched agent ever receives. Asserted
    // against the derived set, a shape change reddens this line and forces
    // a deliberate update instead of a silent drift.
    assert.strictEqual(roleFields.length, 5,
        'the claim shape no longer carries exactly five fields (now: '
        + roleFields.join(', ') + '); if the shape grew or shrank on both '
        + 'surfaces deliberately, update this expected count with it');
    // Set equality is blind to a symmetric rename: `Name:` becoming
    // `Address:` on both shape sentences leaves the sets equal and the
    // count at five, so both assertions above stay green, while `Name:` is
    // the address the coordinator's probe uses and the field that makes the
    // release's first leg satisfiable at all. (A symmetric removal is
    // already caught by the count assertion above, which runs first.) Same
    // idiom as the presence pins above: the load-bearing member is asserted
    // by name on each surface beside the whole-set comparison.
    for (const [label, fields] of [['role contract', roleFields],
        ['brief clause', clauseFields]]) {
        assert.ok(fields.includes('`Name:`'),
            'the ' + label + '\'s claim shape no longer names `Name:`, the '
            + 'field that addresses the coordinator\'s probe; without it no '
            + 'probe can be put, the release\'s first leg is never '
            + 'satisfiable, and every claim ends as an untracked hold');
    }

    // The session-scoped delete, on both surfaces, each in its own spelling:
    // the unscoped delete-at-completion is the defect the scoping exists to
    // stop, a finished writer erasing a live foreign claim.
    assert.ok(clause.includes('delete only a claim whose `Session:` line '
        + 'carries that same substituted id'),
        'the box-budget brief clause no longer scopes the completion delete '
        + 'to the substituted session id, so a briefed subagent finishing '
        + 'first erases whatever claim is there, a live foreign one included');
    assert.ok(roleBody.includes('a writer deletes only a claim whose '
        + '`Session:` line is its own'),
        'the role skill no longer scopes the completion delete to the '
        + 'writer\'s own session id while the brief clause still states the '
        + 'session-scoped delete');

    // The contention branch, on both surfaces: naming a contention and
    // proceeding writes no claim. The field-set comparison above is blind to
    // this by construction, comparing what a claim carries and never whether
    // one is written at all, so the two surfaces can agree on the shape while
    // disagreeing on the branch, which is the drift this leg exists for. The
    // clause is the only copy a dispatched subagent receives, so a clause
    // that chains the write onto the contention branch has that subagent
    // overwrite a live holder's claim on the machine's one slot, the failure
    // the contract's own sentence names.
    for (const [label, text] of [['role contract', roleBody],
        ['brief clause', clause]]) {
        assert.ok(text.includes('the contention and proceeding never '
            + 'includes writing the claim'),
            'the ' + label + ' no longer states that naming a contention and '
            + 'proceeding writes no claim, so a session that proceeds under a '
            + 'named contention writes over the live holder\'s claim and the '
            + 'box ends up holding two heavy processes under one claim naming '
            + 'only the second');
    }

    // The poll's standing in the clause: a sample that grounds waiting and
    // never licenses starting or releasing. These two phrases are the
    // anti-verdict statement, and the absence assertion below is its negative
    // half.
    assert.ok(clause.includes('a clean process poll is a sample rather than '
        + 'a clearance'),
        'the box-budget brief clause no longer states the process poll as a '
        + 'sample rather than a clearance, so a clean reading is back to '
        + 'reading as permission');
    assert.ok(clause.includes('absence never licenses starting or releasing'),
        'the box-budget brief clause no longer bars starting or releasing on '
        + 'an absence reading, which is the direction a poll is degenerate in');
    assert.ok(!/process list/i.test(clause),
        'the box-budget brief clause names the process list, which the claim '
        + 'protocol retired as a verdict: the clause instructs on claims and '
        + 'contention naming only, and a process-list instruction in the '
        + 'brief is a poll-as-clearance reading arriving by another name');
});

// The pin above derives the claim's field set and so stays green whatever
// either surface says about where a field's value comes from, which is the
// half this one covers: a writer and a reader sharing one value, held to
// each other rather than each to its own literal. The write side is that
// `Started:` is resolved from the clock at the moment of the write, and the
// read side is that a live claim is aged by the file rather than by that
// line, and the two are one rule, since aging by the line is what makes a
// composed value worth composing. Each side is asserted on both surfaces,
// because a rule stated in the contract and dropped from the brief clause
// is a rule no dispatched subagent ever receives.
test('the write-time resolution of a claim\'s Started and the read side\'s aging by the file are on both surfaces', () => {
    const executingWork = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8');
    const start = executingWork.indexOf('The standing box-budget clause');
    const end = executingWork.indexOf('The two-question grant audit');
    assert.ok(start !== -1 && end > start, 'the box-budget clause slice has no '
        + 'edges, so this pin would read a region that is not the brief clause');
    const clause = collapseWhitespace(executingWork.slice(start, end));
    // The role side is the claim-file section, not the whole file. The
    // registry entry's own paragraphs state a clock-at-the-write rule for a
    // different field on a different artifact, so a pin reading the whole
    // body is satisfied by a sentence that has nothing to do with the claim
    // and stays green through the claim rule's removal.
    const roleBody = sliceBetween(
        fs.readFileSync(path.join(__dirname, '..', 'plugins', 'claude-kit',
            'skills', 'role', 'SKILL.md'), 'utf8'),
        '## The claim file', '\n## The takeover ritual',
        'the role skill\'s claim-file section');

    for (const [name, text] of [['the brief clause', clause], ['the role contract', roleBody]]) {
        assert.ok(/`Started:`[^.]{0,140}\bclock\b[^.]{0,80}\bat the moment\b[^.]{0,30}\bwrit/.test(text)
            || /`Started:`[^.]{0,140}\bat the moment\b[^.]{0,80}\bclock\b/.test(text),
            name + ' no longer states that a claim\'s Started is read from the '
            + 'clock at the write, so the value it describes may be composed '
            + 'before the write and carried in, which is the defect the field '
            + 'was taken out of a writer\'s hands to remove');
        assert.ok(/modification time/.test(text),
            name + ' no longer names the file\'s modification time, so the read '
            + 'side has no machine-written comparator and ages a live claim by '
            + 'a line the claim\'s own writer chose');
    }
});

// The hostile-boundary reuse step in executing-work's Dispatch Brief template
// is a deliberate copy of the guard-siting rule the operating instructions
// state, copied for the reason the box-budget clause above is copied: it is
// the only carrier a dispatched implementer receives, an agent inheriting no
// skills and holding no pointer it could resolve. What a deliberate copy owes
// is a pin, since a divergence survives a parity suite whose assertions never
// touch the diverging text. The two surfaces are held at the proposition
// rather than at a shared string, because they differ in spelling and in
// reach on purpose: the doctrine addresses a session that owns the whole
// tree, while the brief addresses an agent bound to a Files in scope list, so
// the brief carries a scope fallback the doctrine has no reason to state.
// Both halves are asserted, the shared proposition and the divergence,
// because dropping either is how the copy stops being a rule an implementer
// can act on. The clause region is sliced by its own landmarks rather than
// matched against the whole file, so guard language elsewhere in
// executing-work cannot satisfy a pin about what the brief actually says.
test('the hostile-boundary brief clause agrees with the guard-siting rule and carries its scope fallback', () => {
    const executingWork = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8');
    const start = executingWork.indexOf('The standing hostile-boundary reuse step');
    assert.ok(start !== -1, 'executing-work\'s Dispatch Brief template no '
        + 'longer carries the hostile-boundary reuse step, so the guard-siting '
        + 'rule reaches no dispatched implementer at the moment it is acted '
        + 'on, which is the reach failure this clause exists to close');
    const end = executingWork.indexOf('Pin tests + new expected values', start);
    assert.ok(end !== -1 && end > start, 'executing-work\'s Dispatch Brief '
        + 'template no longer carries the pin-tests bullet that bounds the '
        + 'hostile-boundary clause, so the slice this pin reads has no far edge');
    const clause = collapseWhitespace(executingWork.slice(start, end));
    const doctrine = collapseWhitespace(fs.readFileSync(SKILL, 'utf8'));

    // The source side, asserted rather than assumed, because this pin's whole
    // purpose is to hold a copy to a rule: where the rule is retired, the copy
    // is a standing instruction with nothing behind it, and that is a decision
    // to take deliberately rather than to discover from a brief.
    assert.ok(doctrine.includes('A sanitizing or clamping guard is a property '
        + 'of the output channel, not of the producer that first needed it'),
        'the operating instructions no longer state the guard-siting rule '
        + 'while the Dispatch Brief still carries its implementer copy: either '
        + 'the rule moved and this pin moves with it, or the copy is now the '
        + 'only carrier and rests on no authority');
    assert.ok(doctrine.includes('the guard moves to the shared boundary as an '
        + 'exported helper'),
        'the operating instructions no longer name the exported helper as the '
        + 'remedy, which is the half the brief clause instructs an implementer '
        + 'to carry out');

    // The shared proposition, in the brief's own spelling: the guard belongs
    // to the channel and not to the caller that first needed it. That is what
    // makes reuse an instruction rather than a preference, so a clause keeping
    // the grep and dropping this reads as a style note.
    assert.ok(clause.includes('The guard at a boundary is a property of the '
        + 'channel rather than of the caller that first needed it'),
        'the hostile-boundary brief clause no longer states the guard as a '
        + 'property of the channel, so an implementer reads a suggestion to '
        + 'look around rather than the rule that makes hand-matching wrong');
    assert.ok(clause.includes('export the guard and call it'),
        'the hostile-boundary brief clause no longer names exporting the guard '
        + 'as the in-scope form of reuse, so it states the rule and no act '
        + 'that satisfies it');

    // The divergence, which is why this ships as a copy rather than a pointer:
    // the brief's reader is bound to a Files in scope list, so the clause
    // routes an out-of-scope guard to the report instead of editing it.
    // Dropping this leaves the clause directing an edit the scope check never
    // stages, which is the failure the out-of-scope route exists to prevent.
    assert.ok(clause.includes('leave it unedited'),
        'the hostile-boundary brief clause no longer bars editing a guard '
        + 'whose file sits outside Files in scope, so it directs an '
        + 'implementer into an edit that is never staged and a committed tree '
        + 'calling a symbol that exists only in an unstaged worktree');
    assert.ok(clause.includes('out-of-scope route'),
        'the hostile-boundary brief clause no longer routes the out-of-scope '
        + 'guard to step 4\'s out-of-scope route, so the surface it has the '
        + 'implementer name in the report reaches no disposition');

    // The class framing this file carries wherever it enumerates: an
    // implementer standing at a boundary the list omits has to read itself as
    // covered rather than exempt, and a bare list of four says the opposite.
    assert.ok(clause.includes('are instances and not the boundary'),
        'the hostile-boundary brief clause states its boundary examples '
        + 'without the class framing, so an implementer at a boundary the '
        + 'list omits reads itself as outside the rule');
});

// The goal event is the BLOCKED funnel's machine-wide input: any session on
// the box writes the stream, so a field the emitter ships that the funnel
// never dispositions is an unscreened writer-controlled value, the defect
// class an enumeration round found live instances of (the `plan` path and
// the `ts` dedup key among them). The field set is derived from the two hook
// surfaces rather than listed here, in the box-budget pin's own idiom: a pin
// carrying its own field list is a third literal that drifts with neither
// surface, so a field added to one side alone reads green against it.
// Surface one is the emitGoalEvent call sites in kit-goal-stop.js, the keys
// callers pass; surface two is the emitter body in kit-goal-lib.js, both the
// keys it reads off its argument and the record keys it actually ships,
// `ts` and `run` being emitter-generated and appearing in no call site. The
// funnel's disposition sentence names every shipped field in backticks,
// which is what the final loop reads: a field named nowhere in the funnel
// slice is a field the contract routes no reader of through any screen.
test('the coordinator\'s BLOCKED funnel dispositions every field the goal event ships', () => {
    const stopSrc = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'hooks', 'kit-goal-stop.js'), 'utf8');
    const libSrc = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'hooks', 'kit-goal-lib.js'), 'utf8');

    // Surface one: the keys the call sites pass. The object literals are
    // flat today; a nested brace would end the lazy match early and drop
    // keys, which the set comparison below reddens on rather than passing.
    const calls = stopSrc.match(/emitGoalEvent\(\{[\s\S]*?\}\)/g) || [];
    assert.ok(calls.length > 0, 'kit-goal-stop.js no longer calls '
        + 'emitGoalEvent, so the goal event this pin derives its field set '
        + 'from is emitted nowhere and the funnel paragraph describes a '
        + 'stream nothing writes');
    // A key is an identifier opening an object entry, so it is anchored to the
    // `{` or `,` (or line start) that precedes one. An unanchored identifier
    // followed by a colon also matches a ternary's middle arm, `x ? a : b`,
    // which would enter the field set as `a` and make this pin demand a
    // disposition for a field the emitter never ships.
    const keyOf = /(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/gm;
    const callKeys = new Set();
    for (const c of calls) {
        for (const m of c.matchAll(keyOf)) callKeys.add(m[1]);
    }

    // Surface two: the emitter body, sliced from its declaration to the
    // next top-level declaration or the exports line, whichever follows.
    const emitterStart = libSrc.indexOf('function emitGoalEvent(');
    assert.ok(emitterStart !== -1, 'kit-goal-lib.js no longer declares '
        + 'emitGoalEvent, so the emitter half of the field-set derivation '
        + 'has no body to read');
    let emitterEnd = libSrc.indexOf('\nfunction ', emitterStart);
    if (emitterEnd === -1) {
        emitterEnd = libSrc.indexOf('\nmodule.exports', emitterStart);
    }
    assert.ok(emitterEnd > emitterStart, 'the emitGoalEvent body has no '
        + 'following declaration or exports line to bound the slice this '
        + 'pin reads');
    const emitter = libSrc.slice(emitterStart, emitterEnd);
    // The keys the emitter reads off its argument object: the caller-facing
    // contract, compared against what the callers actually pass.
    const argKeys = new Set(
        [...emitter.matchAll(/\bd\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    // The keys the emitter ships: the record literal's own keys plus the
    // conditional record.<key> assignments; `ts` and `run` live only here.
    const recordLiteral = emitter.match(/const record = \{[\s\S]*?\};/);
    assert.ok(recordLiteral, 'the emitGoalEvent body no longer builds its '
        + 'record object literal, so the shipped field set cannot be '
        + 'derived from it');
    const shipped = new Set();
    for (const m of recordLiteral[0].matchAll(keyOf)) shipped.add(m[1]);
    for (const m of emitter.matchAll(/\brecord\.([A-Za-z_$][\w$]*)\s*=/g)) {
        shipped.add(m[1]);
    }

    // The two derivations must agree with each other before either is read
    // against the funnel: a call site passing a key the emitter never reads
    // is a field that silently ships nowhere, and the emitter reading a key
    // no call site passes is a contract field nothing exercises.
    const sorted = (s) => [...s].sort().join(', ');
    assert.strictEqual(sorted(callKeys), sorted(argKeys),
        'the emitGoalEvent call sites in kit-goal-stop.js and the keys the '
        + 'emitter reads in kit-goal-lib.js name different field sets (call '
        + 'sites: ' + sorted(callKeys) + '; emitter reads: ' + sorted(argKeys)
        + '), so one surface gained or lost a field the other cannot see');
    assert.ok(shipped.size > callKeys.size,
        'the emitter ships no field of its own beyond what callers pass '
        + '(shipped: ' + sorted(shipped) + '); `ts` at least is '
        + 'emitter-generated, so an equal set means the record derivation '
        + 'went blind');

    // Every shipped field has a backticked disposition in the funnel
    // paragraph, sliced by its own landmarks so a mention elsewhere in the
    // coordinator skill cannot satisfy a pin about what the funnel says.
    const coordinator = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');
    const funnelStart = coordinator.indexOf('**The BLOCKED funnel.**');
    const funnelEnd = coordinator.indexOf('**A blocker\'s answer never returns');
    assert.ok(funnelStart !== -1 && funnelEnd > funnelStart,
        'the coordinator skill no longer carries the BLOCKED funnel '
        + 'paragraph between its own landmarks, so the disposition side of '
        + 'this pin has no slice to read');
    const funnel = coordinator.slice(funnelStart, funnelEnd);
    // Narrower than the funnel slice: the disposition clause itself, which
    // runs from the sentence's own colon to the clause that closes it. The
    // paragraph also enumerates the record's fields a few words earlier, so a
    // pin reading the whole slice passes on that enumeration alone and stays
    // green when a field's disposition is dropped while the field survives in
    // the list of what the record carries.
    const dispStart = funnel.indexOf('stated so no field rides without one:');
    const dispEnd = funnel.indexOf('A mid-queue advance does record');
    assert.ok(dispStart !== -1 && dispEnd > dispStart,
        'the BLOCKED funnel paragraph no longer carries its per-field '
        + 'disposition clause between its own landmarks, so this pin has no '
        + 'clause to read and would otherwise fall back to the record '
        + 'enumeration, which names the fields without dispositioning them');
    const dispositions = funnel.slice(dispStart, dispEnd);
    for (const field of shipped) {
        assert.ok(dispositions.includes('`' + field + '`'),
            'the BLOCKED funnel\'s disposition clause gives no disposition to '
            + 'the goal event\'s `' + field + '` field, which the emitter '
            + 'ships and any session on the box can write: a field with no '
            + 'named reader or screen at its point of use is the defect class '
            + 'this pin exists to keep out, and naming it in the record '
            + 'enumeration beside the clause is not a disposition');
    }
});

// The capture half of the kaizen function under the standing grant: every
// seat carries the duty to append captured kit friction to the kaizen inbox
// itself and carry on, never actioning it inline and never shelving it, with
// capture standing-authorized so no per-note approval and no routing leg
// stands between the friction and the inbox. The reason is the rule's
// boundary and is pinned with the rule, because a responsibility that names
// no owner is discharged by whichever party is least busy, in a fleet
// reliably the party least likely to have seen the friction; standing
// capture answers it by making the owner whoever met the friction, and a
// rewrite keeping the duty and dropping the reason reopens exactly that
// reading. Both stating surfaces are pinned together, the role skill and the
// peer-sessions Roles section, since one surface amended while a sibling
// goes on saying the old thing is the drift class this file exists to catch.
test('every seat carries the kaizen capture duty as a direct append, with its reason, on both surfaces', () => {
    for (const skill of ['role', 'peer-sessions']) {
        const label = 'plugins/claude-kit/skills/' + skill + '/SKILL.md';
        const body = fs.readFileSync(path.join(__dirname, '..', 'plugins',
            'claude-kit', 'skills', skill, 'SKILL.md'), 'utf8');
        assert.match(body, /kit friction[^.]{0,200}kaizen inbox/i,
            label + ' no longer states that captured kit friction goes to the '
            + 'kaizen inbox, so the duty has lost its destination on this '
            + 'surface and the ownerless reading is back');
        assert.match(body, /standing-authorized/i,
            label + ' no longer states that capture is standing-authorized, '
            + 'the grant that replaced the per-note nod and the routing leg; '
            + 'without it this surface reads as requiring an approval that no '
            + 'longer exists');
        assert.match(body, /never action\w*[^.]{0,40}inline/,
            label + ' no longer bars actioning a captured note inline, which '
            + 'is half of carry-on: the capturing seat appends the note and '
            + 'returns to its mandate');
        assert.match(body, /never shelv/,
            label + ' no longer bars shelving a captured note, which is the '
            + 'other half of carry-on: appended now, not parked');
        assert.ok(body.includes('least likely to have seen the friction'),
            label + ' no longer carries the rule\'s reason, that an ownerless '
            + 'duty is discharged by the least busy party, in a fleet reliably '
            + 'the one least likely to have seen the friction; the reason is '
            + 'the rule\'s boundary and rides with it');
    }
    const peerSessions = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'peer-sessions', 'SKILL.md'), 'utf8');
    for (const lead of ['- **Expert.**', '- **Worker.**', '- **Admin.**']) {
        const lines = peerSessions.split(/\r?\n/).filter((l) => l.startsWith(lead));
        assert.strictEqual(lines.length, 1,
            'expected exactly one ' + lead + ' bullet in peer-sessions\' Roles '
            + 'section; the capture-duty pin below reads that bullet');
        assert.match(lines[0], /kit friction[^.]{0,160}kaizen inbox/i,
            'the peer-sessions ' + lead + ' bullet no longer carries the '
            + 'capture duty; the duty lands in each seat\'s own definition, '
            + 'not only in the shared capture paragraph');
    }
});

// The three pins below cover one drift class rather than three deletions: an
// amendment correct in itself falsifies an unchanged sentence in a file the
// changeset never opened, so no diff shows the falsification and every review
// lens reading the diff is blind to it. Each pin reads only the copies that
// make the claim, never the whole tree, so a document that quotes a retired
// phrasing while explaining it stays green.

// finishing-work states the never-started condition on the transcript's own
// assistant-line counts, because a transcript holding only the harness's
// <synthetic> placeholder satisfies a bare "no turn at all" literally while
// being the shape that rule routes to its own re-dispatch. Every copy that
// describes the first-turn reading therefore names the shape and defers the
// condition, and this pin is what makes the withdrawn spelling loud wherever
// it reappears.
//
// The match is anchored on the condition's own noun phrase rather than on the
// verb that introduces it. The verb is the part that varies (took, taken,
// takes, holding), so a tense-bound pattern goes quiet on the next spelling of
// the same claim, and an interposed noun ("no transcript turn at all") is that
// claim too. The bounded word run is what keeps the phrase a phrase: it spans
// the qualifiers a writer puts between "no" and "turn" without reaching across
// a sentence to pair an unrelated "no" with an unrelated "at all".
test('no copy spells the first-turn condition as a bare absence of turns', () => {
    const withdrawn = /no (?:[\w-]+ ){0,3}turns? at all/i;
    const describing = [
        ['home/claude-kit-doctrine.md', MIRROR],
        ['plugins/claude-kit/skills/operating-instructions/SKILL.md', SKILL],
        ['plugins/claude-kit/skills/finishing-work/SKILL.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
                'finishing-work', 'SKILL.md')],
        ['plugins/claude-kit/skills/executing-work/SKILL.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
                'executing-work', 'SKILL.md')],
    ];
    for (const [label, p] of describing) {
        const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
            const hit = line.match(withdrawn);
            if (!hit) return;
            // The matched text rides in the message rather than one fixed
            // spelling of it, so the report names the phrase actually on the
            // line whichever variant the pattern caught.
            assert.fail(label + ':' + (i + 1) + ' states the first-turn condition '
                + 'as "' + hit[0] + '", which a transcript holding only the '
                + '<synthetic> placeholder satisfies literally; name the '
                + 'never-started shape and defer the condition to finishing-work\'s '
                + 'unavailability rule instead');
        });
    }
});

// The doctrine's probe bullet carries no window of its own, which is what
// keeps it from drifting out of step with finishing-work's figures, and the
// deferral has to name the right owner: the growth window is the class's,
// while the window a first-turn reading earns is set by the dispatch's shape
// and is shared by every class. A bullet that sends a first-turn-earned probe
// to the class's probe window reads as correct and points at the wrong figure.
test('the probe bullet defers its first-turn probe window to the dispatch shape in each copy', () => {
    const copies = [
        ['plugins/claude-kit/skills/operating-instructions/SKILL.md', skillBody()],
        ['home/claude-kit-doctrine.md', mirrorBody()],
    ];
    const lead = '- **Probe a dispatched agent with a message';
    for (const [label, body] of copies) {
        const lines = body.split(/\r?\n/).filter((l) => l.startsWith(lead));
        assert.strictEqual(lines.length, 1,
            'expected exactly one probe bullet in ' + label);
        assert.ok(!/class'?s probe window/i.test(lines[0]),
            'the probe bullet in ' + label + ' sends the reader to "the '
            + 'class\'s probe window", which is the window a growth reading earns; '
            + 'the window a first-turn reading earns is the one the dispatch\'s '
            + 'shape sets, and finishing-work owns both');
        assert.match(lines[0], /probe window[^.;]{0,40}shape sets/,
            'the probe bullet in ' + label + ' must defer its probe window to '
            + 'the dispatch\'s shape, since the bullet carries no window of its own');
    }
});

// The unavailability rule concludes a fact about the gate (this gate could not
// be run at this tier in this environment) rather than about the model, since
// first-turn latency is correlated across a dispatch and its retry and two
// closed windows cannot separate an exhausted allotment from a brownout. The
// skills that route on that conclusion restate it in one clause each, so a
// clause still spelling it as a model being unreachable asserts what its own
// destination rule refuses to conclude. Scoped to the routing line at each
// site, because finishing-work and executing-work both discuss reachability
// elsewhere in prose that is true as written.
test('the hand-off copies route on the gate-level conclusion, not on a model being unreachable', () => {
    // Four sites make the hand-off, each named by its own text because line
    // numbers move. Three restate the conclusion in one clause and are pinned
    // to its gate-level spelling. The fourth, executing-work's
    // reviewer-effort-table line, defers to finishing-work's rule by name and
    // restates no conclusion of its own; that is the shape that cannot drift,
    // so its pin holds the deferral in place rather than demanding a
    // restatement, which would create a second copy of the conclusion for
    // every later amendment to sweep.
    const conclusion = /(?:could not|cannot) be run at (?:the|its) fable tier/;
    const deferral = /per finishing-work's unavailability rule/;
    const sites = [
        [['skills', 'consult', 'SKILL.md'],
            /the stand-in is Opus at `max`/, conclusion],
        [['skills', 'executing-work', 'SKILL.md'],
            /compensated per the effort table below/, conclusion],
        [['skills', 'executing-work', 'SKILL.md'],
            /Unavailability is confirmed and recorded/, deferral],
        [['skills', 'finishing-work', 'SKILL.md'],
            /the compensated re-dispatch that rule defines/, conclusion],
    ];
    for (const [parts, locator, expected] of sites) {
        const label = 'plugins/claude-kit/' + parts.join('/');
        const p = path.join(__dirname, '..', 'plugins', 'claude-kit', ...parts);
        const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
        const hits = lines
            .map((line, i) => [line, i + 1])
            .filter(([line]) => locator.test(line));
        assert.strictEqual(hits.length, 1, 'expected exactly one line matching '
            + locator + ' in ' + label + '; the pin below reads that line, so a '
            + 'reworded or duplicated route leaves the conclusion unpinned');
        const [line, lineNo] = hits[0];
        assert.ok(!/unreachable/i.test(line), label + ':' + lineNo + ' routes on a '
            + 'model being "unreachable", which the unavailability rule declines to '
            + 'conclude: two closed windows establish only that this gate could not '
            + 'be run at this tier in this environment');
        assert.match(line, expected,
            label + ':' + lineNo + ' must carry ' + expected + ': the rule\'s own '
            + 'gate-level conclusion where the line restates one, or the deferral '
            + 'to finishing-work\'s rule where it routes without restating, since '
            + 'the line carries none of that rule\'s evidence itself');
    }
});

test('the surfaces that defer to the outline bullet still say so', () => {
    const deferring = [
        [['agents', 'implementer-sonnet.md'], /hunting for one thing in a file past roughly 1,000 lines/],
        [['agents', 'implementer-opus.md'], /hunting for one thing in a file past roughly 1,000 lines/],
        [['agents', 'implementer-fable.md'], /hunting for one thing in a file past roughly 1,000 lines/],
        [['skills', 'executing-work', 'SKILL.md'], /rule on hunting in a large file/],
    ];
    for (const [parts, phrase] of deferring) {
        const p = path.join(__dirname, '..', 'plugins', 'claude-kit', ...parts);
        const body = fs.readFileSync(p, 'utf8');
        assert.match(body, phrase, parts.join('/') + ' must still carry its '
            + 'outline clause. Matched on the clause\'s own phrase rather than '
            + 'the bare word outline, which any later unrelated mention would '
            + 'satisfy: a deletion here breaks the chain from the far end while '
            + 'the identity check stays green');
    }
});

// Section 3 of the testing-discipline plan added five pointers: three in
// executing-work (the settle-the-test-question paragraph, the Dispatch Brief
// template's Tests: field, and the review step's close-gate reference),
// one in brainstorming's Tests:-line paragraph, and one in README's payload
// map. None of the five sits inside the doctrine's two parity copies, so
// none of the pins above sees a symmetric deletion here: a fold that removed
// any one clause would pass every other test in this file while leaving
// that surface silent again, which is the same drift-by-duplication this
// whole section exists to remove. Each is matched on the clause's own
// distinguishing phrase, never on the bare string "testing-discipline",
// which a later unrelated mention would also satisfy. Whitespace is
// collapsed before matching because three of the five clauses wrap across
// lines in their source file (a fenced template, a long paragraph), so a
// reflow that keeps the words would still pass this.
function collapseWhitespace(text) {
    return text.replace(/\s+/g, ' ');
}

test('the five Section 3 pointers to testing-discipline are still present', () => {
    const executingWork = collapseWhitespace(fs.readFileSync(path.join(__dirname,
        '..', 'plugins', 'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8'));
    const brainstormingBody = collapseWhitespace(fs.readFileSync(path.join(__dirname,
        '..', 'plugins', 'claude-kit', 'skills', 'brainstorming', 'SKILL.md'), 'utf8'));

    assert.ok(executingWork.includes('Settle the test question per '
        + '`skills/testing-discipline/SKILL.md` under the kit plugin root, '
        + 'whose litmus decides what earns a durable test'),
        'executing-work\'s step 2 no longer points the settle-the-test-question '
        + 'duty at the testing-discipline skill\'s litmus, so a reader is left '
        + 'with the paragraph\'s own words and no way to reach the four classes '
        + 'that actually earn a test');

    assert.ok(executingWork.includes('else the test-worthiness call per the '
        + 'testing-discipline skill\'s litmus, its absolute path resolved by '
        + 'the same ladder as the Style-skill file paths bullet below'),
        'the Dispatch Brief template\'s Tests: field no longer points the '
        + 'test-worthiness call at the testing-discipline skill\'s litmus, or '
        + 'dropped the resolved-path qualifier a dispatched agent needs since '
        + 'it inherits no skills and cannot follow a bare relative path');

    assert.ok(executingWork.includes('which runs the section\'s close gate '
        + 'after them, so the gate that closes the section covers what the '
        + 'round changed (the lanes and their moments are owned by the '
        + 'operating doctrine\'s gate bullet)'),
        'step 3\'s review dispatch no longer points at the operating '
        + 'doctrine\'s gate bullet for the lanes, or no longer places the '
        + 'close gate after the review fixes. Both halves are load-bearing: '
        + 'the doctrine is the single owner of the moment, and a close gate '
        + 'running beside the round instead of after it leaves every review '
        + 'fix and every folded surface outside the only gate the section '
        + 'runs, which also makes step 4\'s fold predicate unsatisfiable');

    assert.ok(brainstormingBody.includes('the behaviors that earn one per the '
        + 'testing-discipline skill\'s litmus '
        + '(`skills/testing-discipline/SKILL.md` under the kit plugin root)'),
        'the brainstorming skill\'s Tests:-line paragraph no longer points '
        + 'what a Tests: line names at the testing-discipline skill\'s litmus');

    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const mapLine = readme.split(/\r?\n/).find((l) => /^\s*testing-discipline\//.test(l));
    assert.ok(mapLine, 'README\'s payload map no longer carries a '
        + 'testing-discipline/ entry');
    for (const phrase of ['Litmus for what earns a test', 'what retires one',
        'priced at authoring', 'gate\'s lanes', 'red protocol',
        'contention rule']) {
        assert.ok(mapLine.includes(phrase), 'README\'s testing-discipline/ map '
            + 'entry no longer mentions "' + phrase + '", one of the things it '
            + 'promises the skill owns');
    }
});

// The adversarial reviewer's Tests bullet is the same drift class one surface
// later: that charter adjudicates every future section review, so a litmus
// restated there outlives every deletion the Section 3 fold performed. Both
// halves are pinned: the bullet still routes to the testing-discipline skill's
// litmus, and the three-instance list the fold deleted has not resurfaced,
// because a pointer bolted onto a surviving restatement presents two
// authorities and the reader takes the nearest list.
test('the adversarial reviewer judges test-worthiness by the testing-discipline litmus, not a local list', () => {
    const charter = collapseWhitespace(fs.readFileSync(path.join(__dirname, '..',
        'plugins', 'claude-kit', 'agents', 'adversarial-reviewer.md'), 'utf8'));
    assert.ok(charter.includes('testing-discipline skill\'s litmus'),
        'the adversarial reviewer\'s Tests bullet no longer routes '
        + 'test-worthiness to the testing-discipline skill\'s litmus, so the '
        + 'agent adjudicating every section review is back to its own words');
    assert.ok(!charter.includes('(a business rule, an edge case, a bug fix)'),
        'the three-instance test-worthiness list has resurfaced in the '
        + 'adversarial reviewer\'s charter; the litmus lives in the '
        + 'testing-discipline skill, and a local restatement is what drifts');
});

// The targeted-lane definition and the contention-lane schedule are stated in
// full in both the doctrine's gate bullet and the testing-discipline skill, on
// purpose: the duplication was adjudicated for doctrine-only-reader
// visibility. What duplication costs is drift (the box-check pair had exactly
// that, the skill's copy dropping the running-engine case), so the shared text
// is pinned here at the phrases that do the work: the targeted lane's
// definition, the contention lane's schedule, the schedule's touched-delta
// condition, and the whole-gate moments the three surfaces word alike.
// The condition that bounds the pre-push whole gate is stated on more surfaces
// than the three the loop below compares: the two skills that perform a push
// state it at their own points of action. It is one condition on one property
// of a trunk, and it dissolves the day that trunk gains branch protections, so
// every surface asserting it has to move together or the ones left behind
// assert a condition that no longer holds anywhere.
const INSTALL_SURFACE_CONDITION = 'a trunk consumers install from directly with no CI gating the merge';

function readRepoFile(relPath) {
    return fs.readFileSync(path.join(__dirname, '..', ...relPath.split('/')), 'utf8');
}

// The carriers are keyed by path rather than by content, so the membership
// leg below can compare a file the tree holds against this list. Both doctrine
// copies are read from their own paths here: the frontmatter the skill copy
// carries is immaterial to a substring check.
const INSTALL_SURFACE_CARRIERS = [
    ['the skill-body doctrine copy',
        'plugins/claude-kit/skills/operating-instructions/SKILL.md'],
    ['the doctrine mirror', 'home/claude-kit-doctrine.md'],
    ['the testing-discipline skill',
        'plugins/claude-kit/skills/testing-discipline/SKILL.md'],
    ['executing-work\'s Commit-and-Push bullet',
        'plugins/claude-kit/skills/executing-work/SKILL.md'],
    ['finishing-work\'s Commit-and-Push bullet',
        'plugins/claude-kit/skills/finishing-work/SKILL.md'],
    ['kaizen\'s applied-brief push and its capture exemption',
        'plugins/claude-kit/skills/kaizen/SKILL.md'],
    ['docs/architecture.md\'s cadence paragraph', 'docs/architecture.md'],
];

// A surface stating the condition in some other wording is the drift this
// pin exists to catch, and a list of names cannot see one that was never
// added to it. So the condition's own shape is swept over the live surfaces
// and every hit has to be a listed carrier: a file describing the same trunk
// property under different words reddens here, and the wording loop above
// then reddens on it too. Journey surfaces are outside the sweep by the
// spec's own exemption, since a plan doc and an archive quote the retired and
// the current wording alike as a record.
const INSTALL_SURFACE_SHAPE = /trunk consumers install from|no CI gating/i;

function installSurfaceCandidates() {
    const files = shippedKitMarkdown().map((f) => 'plugins/claude-kit/'
        + path.relative(path.join(__dirname, '..', 'plugins', 'claude-kit'), f)
            .replace(/\\/g, '/'));
    return files.concat(['home/claude-kit-doctrine.md', 'README.md',
        'docs/README.md', 'docs/architecture.md']);
}

test('every surface stating the install-surface condition words it alike', () => {
    for (const [label, relPath] of INSTALL_SURFACE_CARRIERS) {
        assert.ok(readRepoFile(relPath).includes(INSTALL_SURFACE_CONDITION),
            label + ' (' + relPath + ') no longer '
            + 'states the install-surface condition in the shared wording ("'
            + INSTALL_SURFACE_CONDITION + '"). The condition keys on a property '
            + 'of the trunk rather than on a repo name, so a reword that reaches '
            + 'some surfaces and not others leaves the rest gating on a '
            + 'condition the reworded ones no longer describe');
    }

    // The instrument leg, so the membership sweep's silence is readable: the
    // shape has to select a carrier stating the condition in wording the
    // shared literal does not supply.
    assert.match('main is a trunk consumers install from with nothing gating '
        + 'the merge', INSTALL_SURFACE_SHAPE, 'the install-surface shape no '
        + 'longer selects a paragraph describing the trunk property in its own '
        + 'words, so the membership sweep below cannot see an unlisted carrier');

    const listed = new Set(INSTALL_SURFACE_CARRIERS.map(([, p]) => p));
    for (const relPath of installSurfaceCandidates()) {
        if (!INSTALL_SURFACE_SHAPE.test(readRepoFile(relPath))) continue;
        assert.ok(listed.has(relPath), relPath + ' describes the trunk property '
            + 'the install-surface condition keys on and is not among the '
            + 'carriers above, so a reword through the shared wording leaves it '
            + 'asserting a condition no other surface describes. Add it to '
            + 'INSTALL_SURFACE_CARRIERS, or state the property somewhere that '
            + 'is a carrier');
    }
});

test('the lane text agrees between the doctrine gate bullet and the testing-discipline skill', () => {
    const testingSkill = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'testing-discipline', 'SKILL.md'), 'utf8');
    const copies = [
        ['the skill-body doctrine copy', skillBody()],
        ['the doctrine mirror', mirrorBody()],
        ['the testing-discipline skill', testingSkill],
    ];
    for (const [phrase, what] of [
        ['the changed files\' tests plus any whole-tree pin whose subject those files are',
            'the targeted lane\'s definition'],
        ['beside the whole gate wherever the whole gate runs, and at section close whenever',
            'the contention lane\'s schedule, both of its clauses'],
        ['section\'s delta touched',
            'the schedule\'s touched-delta condition'],
        ['before a push only where that push lands on ' + INSTALL_SURFACE_CONDITION,
            'the install-surface condition that bounds the pre-push whole gate'],
        ['before the plan\'s handoff',
            'the handoff moment, which is finishing\'s own gate rather than a '
            + 'second one after it'],
        ['merge takes the whole gate',
            'the post-merge moment, the one whole-gate moment no lane derived '
            + 'from a diff can stand in for'],
    ]) {
        for (const [label, body] of copies) {
            assert.ok(body.includes(phrase), label + ' no longer carries ' + what
                + ' ("' + phrase + '"); the lane text is deliberately stated in '
                + 'full on both surfaces, so the copies must keep saying the '
                + 'same thing');
        }
    }
    // Finishing and the handoff are one moment, not two, and the skill that
    // owns lane mechanics is where that reading is stated rather than left to a
    // reader. Without the sentence a reader takes "at finishing, before the
    // plan's handoff" as two moments and looks for a second gate that no
    // procedure runs.
    assert.match(testingSkill, /Finishing and the handoff are one moment/,
        'the testing-discipline skill no longer states that finishing and the '
        + 'handoff are one moment, so the moments list reads as naming a gate '
        + 'between finishing and the handoff that nothing implements');
});

// Section 7's own Tests: line called for no new test, written before the
// section existed; the section's own fix round created a cross-file
// invariant that line could not anticipate, so this pin extends that floor
// rather than honoring it as written. The peer-sessions Roles table is the
// Admin seat's cadence's one home (the admin-requests.md bullet's own former
// copy was retired in the same round), and the coordinator's staleness leg
// prunes a registry entry on twice that figure, so a row deleted or reshaped
// here leaves two skills pointing at a figure that no longer exists with the
// suite green. The figure is derived from the table row rather than
// restated as a literal in this test, which is what makes the pin sensitive
// to the row moving rather than to one hand-copied number agreeing with
// another.
test('the Admin seat\'s cadence is single-sourced in the peer-sessions tier table, and the role and coordinator skills resolve against it rather than copy it', () => {
    const peerSessions = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'peer-sessions', 'SKILL.md'), 'utf8');
    const adminRow = peerSessions.split(/\r?\n/).find((l) => l.startsWith('| Admin |'));
    assert.ok(adminRow, 'the peer-sessions Roles table no longer carries an '
        + 'Admin row; this pin reads that row as the cadence\'s one source');
    const hourMatch = adminRow.match(/A (\d+)-hour inbox poll of `admin-requests\.md`/);
    assert.ok(hourMatch, 'the peer-sessions Admin row no longer states its '
        + 'inbox-poll cadence in the "A <N>-hour inbox poll of '
        + '`admin-requests.md`" shape this pin derives the figure from');
    const hours = Number(hourMatch[1]);
    assert.ok(Number.isInteger(hours) && hours > 0,
        'the peer-sessions Admin row\'s cadence figure is not a positive '
        + 'whole number of hours');

    // The role skill's admin-requests.md bullet: the far end that must point
    // at the table rather than restate the figure.
    const roleBody = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'role', 'SKILL.md'), 'utf8');
    const roleLine = roleBody.split(/\r?\n/)
        .find((l) => l.includes('admin-requests.md`: the Admin seat\'s artifact inbox'));
    assert.ok(roleLine, 'the role skill no longer carries the admin-requests.md '
        + 'directory-contract bullet this pin reads for the cadence pointer');
    assert.match(roleLine,
        /the Admin seat polls it on its own loop, at the cadence the peer-sessions Roles table states/,
        'the role skill\'s admin-requests.md bullet no longer resolves the '
        + 'Admin seat\'s poll cadence through the peer-sessions Roles table; a '
        + 'reader following this bullet alone has no source for the figure');
    assert.ok(!/\d+-hour/.test(roleLine),
        'the role skill\'s admin-requests.md bullet carries its own '
        + '<N>-hour figure again, a second copy of what the peer-sessions '
        + 'Roles table already states, which is exactly the drift this pin '
        + 'exists to catch');

    // The coordinator skill's staleness leg: the second far end, read from
    // its own paragraph rather than the whole file, so a stray hardcoded
    // figure elsewhere in the skill cannot hide behind this pin passing.
    const coordinator = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');
    const staleStart = coordinator.indexOf(
        'An off-roster entry is not by itself a dead session');
    const staleEnd = coordinator.indexOf('A claim on the heavy-process slot');
    assert.ok(staleStart !== -1 && staleEnd > staleStart,
        'the coordinator skill\'s staleness-leg paragraph no longer sits '
        + 'between its own landmarks, so this pin has no slice to read');
    const staleness = coordinator.slice(staleStart, staleEnd);
    const adminLead = 'The peer-sessions Roles table names a cadence for the Admin seat, which takes that stated figure';
    const adminIdx = staleness.indexOf(adminLead);
    assert.ok(adminIdx !== -1,
        'the coordinator skill\'s staleness leg no longer resolves the Admin '
        + 'seat\'s twice-cadence prune bound through the peer-sessions Roles '
        + 'table by name, so a reader of this skill alone cannot tell which '
        + 'bound an off-roster Admin entry takes');
    const adminWindow = staleness.slice(adminIdx, adminIdx + 250);
    assert.ok(!/\d+-hour/.test(adminWindow),
        'the coordinator skill\'s Admin-cadence sentence carries its own '
        + '<N>-hour figure again rather than resolving through the '
        + 'peer-sessions Roles table alone, which is the same drift the '
        + 'role-skill half of this pin catches on its own surface');
});


// The sync allowlist's admitted roots, read from the installer's own
// generator rather than from a list this file keeps. Get-MemorySyncIgnoreText
// builds each root's rules by calling $tierRules with the root's prefix, so
// the prefixes it passes are the allowlist's own statement of what the store
// publishes. A root added there appears here with no edit to this file, which
// is the point: the boundary sentences below are prose restating that set,
// and a restated claim nothing checks is exactly how the widening that
// created this pin shipped with the suite green and four documents wrong.
//
// The slice is bounded at the next function header rather than run to end of
// file, so a $tierRules call in some later function cannot be read as an
// admitted root.
function admittedSyncRoots(installer) {
    const start = installer.indexOf('function Get-MemorySyncIgnoreText');
    assert.ok(start !== -1, 'install-memory-sync.ps1 no longer defines '
        + 'Get-MemorySyncIgnoreText, which is the generated text this pin '
        + 'derives the admitted roots from');
    const rest = installer.slice(start + 1);
    const next = rest.indexOf('\nfunction ');
    const body = next === -1 ? rest : rest.slice(0, next);
    const roots = [];
    const call = /&\s*\$tierRules\s*'([^']+)'/g;
    let m;
    while ((m = call.exec(body)) !== null) roots.push(m[1]);
    assert.ok(roots.length >= 2, 'Get-MemorySyncIgnoreText no longer builds '
        + 'its roots through $tierRules calls carrying a literal prefix, so '
        + 'this pin can no longer read what the allowlist admits');
    return roots;
}

// The same set read off the path predicate the probes and the inbound screen
// share. Two code surfaces state the admitted roots, and this pin reddens
// when either drifts from the other: the generator alone would let the
// predicate widen silently, and that predicate is what actually decides
// whether a path is published.
function predicateSyncRoots(installer) {
    const start = installer.indexOf('function Test-MemorySyncPathAllowed');
    assert.ok(start !== -1, 'install-memory-sync.ps1 no longer defines '
        + 'Test-MemorySyncPathAllowed, the predicate half of this pin');
    const rest = installer.slice(start + 1);
    const next = rest.indexOf('\nfunction ');
    const body = next === -1 ? rest : rest.slice(0, next);
    const roots = [];
    const branch = /\$p -match '\^([^']+)'/g;
    let m;
    while ((m = branch.exec(body)) !== null) roots.push(m[1]);
    assert.ok(roots.length >= 2, 'Test-MemorySyncPathAllowed no longer tests '
        + 'its roots with anchored -match branches, so this pin can no longer '
        + 'read the predicate half');
    return roots;
}

// Both spellings reduced to the root name a document would say: the leading
// segment, with a wildcard segment in either vocabulary written as '*'.
function rootName(prefix) {
    return prefix.replace(/^\//, '').replace(/\/.*$/, '')
        .replace(/\[\^\/\]\+/g, '*');
}

// Roots whose content the phrase "memory tiers" already covers. This list is
// itself a restatement, and the direction it fails in is the safe one: a new
// memory tier reddens every boundary sentence for not naming its prefix,
// which is a loud review prompt rather than a silent pass.
// The shapes below are ordinary English and match sentences with nothing to
// do with the store ("admits only printable ASCII"), so a match counts only
// where the run-up to it names the sync repository. The subject word sits
// before the match rather than inside it, which is why the window is read
// rather than the claim.
const BOUNDARY_SUBJECT = /allowlist|gitignore|the repository there|sync repo|store root/i;
const SUBJECT_WINDOW = 240;

const MEMORY_TIER_ROOTS = ['projects', 'memory-types', 'memory-operator'];

// The three sentence shapes a surface uses to state the allowlist narrowly.
// A new shape is outside this pin, which is why the sweep below names the
// surfaces it already knows about rather than trusting its own count.
const BOUNDARY_SHAPES = [
    /re-includes only[^.]*\./g,
    /admits only[^.]*\./g,
    /only memory files inside[^.]*\./g,
];

// Comment markers stripped so a claim wrapped across a comment block reads as
// one sentence, then whitespace collapsed through this file's own helper.
function flattenForBoundary(raw) {
    return collapseWhitespace(raw
        .replace(/^[ \t]*(#[ \t]*(---[ \t]*)?|\/\/[ \t]?)/gm, ''));
}

function boundaryClaims(raw) {
    const flat = flattenForBoundary(raw);
    const out = [];
    for (const shape of BOUNDARY_SHAPES) {
        shape.lastIndex = 0;
        let m;
        while ((m = shape.exec(flat)) !== null) {
            const runUp = flat.slice(Math.max(0, m.index - SUBJECT_WINDOW), m.index);
            if (BOUNDARY_SUBJECT.test(runUp)) out.push(m[0]);
        }
    }
    return out;
}

function assertNamesEveryRoot(claim, extraRoots, where) {
    assert.ok(/memory tier/i.test(claim), where + ' states the sync boundary '
        + 'without naming the memory tiers: "' + claim + '"');
    for (const root of extraRoots) {
        assert.ok(claim.toLowerCase().includes(root), where + ' states the sync '
            + 'boundary without naming the "' + root + '" root the allowlist '
            + 'admits, so the document describes a boundary narrower than the '
            + 'code enforces: "' + claim + '"');
    }
}

// The shipped surfaces this sweep reads: the repo-root and docs/ markdown,
// and everything under the plugin payload. Two directories are deliberately
// out, docs/plans/ and docs/archive/, which are the journal layer and quote
// retired wordings as their subject, and so is this test file, whose control
// below is a retired sentence by construction.
function shippedBoundaryFiles() {
    const root = path.join(__dirname, '..');
    const files = [];
    const walk = (dir, depth) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                if (depth > 0) walk(full, depth - 1);
                continue;
            }
            if (/\.(md|ps1|js)$/.test(entry.name)) files.push(full);
        }
    };
    for (const f of fs.readdirSync(root)) {
        if (/\.md$/.test(f)) files.push(path.join(root, f));
    }
    for (const f of fs.readdirSync(path.join(root, 'docs'))) {
        if (/\.md$/.test(f)) files.push(path.join(root, 'docs', f));
    }
    walk(path.join(root, 'plugins', 'claude-kit'), 6);
    return files;
}

test('every shipped sentence stating the sync allowlist narrowly names every root the allowlist admits', () => {
    const installer = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'doctor', 'install-memory-sync.ps1'), 'utf8');

    const generated = admittedSyncRoots(installer).map(rootName);
    const predicate = predicateSyncRoots(installer).map(rootName);
    assert.deepStrictEqual([...generated].sort(), [...predicate].sort(),
        'the roots Get-MemorySyncIgnoreText re-includes and the roots '
        + 'Test-MemorySyncPathAllowed admits are no longer the same set, so '
        + 'the ignore file and the probes disagree about what the store '
        + 'publishes: generated ' + JSON.stringify(generated) + ' vs '
        + 'predicate ' + JSON.stringify(predicate));

    const extraRoots = generated.filter((r) => !MEMORY_TIER_ROOTS.includes(r));
    assert.ok(extraRoots.length > 0, 'the allowlist admits nothing beyond the '
        + 'memory tiers, so the boundary sentences this pin checks now name a '
        + 'root the allowlist does not publish; the drift is real and runs '
        + 'the other way');

    let checked = 0;
    const seen = [];
    for (const file of shippedBoundaryFiles()) {
        if (file === __filename) continue;
        const claims = boundaryClaims(fs.readFileSync(file, 'utf8'));
        if (claims.length === 0) continue;
        const rel = path.relative(path.join(__dirname, '..'), file);
        seen.push(rel);
        for (const claim of claims) {
            assertNamesEveryRoot(claim, extraRoots, rel);
            checked++;
        }
    }

    // Non-vacuity, and the one thing a sweep cannot prove about itself. A
    // sweep that matched nothing reads exactly like a clean one, so the
    // surfaces already known to state the boundary are named here: if a
    // rewording takes one out of the sweep's grammar, this fails rather than
    // going quiet.
    const known = [
        ['docs', 'security-model.md'],
        ['docs', 'architecture.md'],
        ['plugins', 'claude-kit', 'skills', 'kit-doctor', 'SKILL.md'],
        ['plugins', 'claude-kit', 'doctor', 'doctor.ps1'],
        ['plugins', 'claude-kit', 'doctor', 'install-memory-sync.ps1'],
        ['plugins', 'claude-kit', 'scripts', 'memory-index.js'],
    ];
    for (const parts of known) {
        const want = path.join(...parts);
        assert.ok(seen.includes(want), want + ' no longer states the sync '
            + 'boundary in any shape this sweep recognizes, so it has dropped '
            + 'out of coverage silently; either the sentence was reworded out '
            + 'of the grammar or the claim was removed');
    }
    assert.ok(checked >= known.length, 'the boundary sweep matched only '
        + checked + ' sentences, fewer than the surfaces known to carry one');

    // The commit message is the surface a later reader reconstructs the
    // change from, so a message narrower than its own commit misdescribes
    // what was published. It states no sentence the sweep's grammar reaches.
    const msg = installer.match(/"kit memory sync:[^"]*"/);
    assert.ok(msg, 'install-memory-sync.ps1 no longer carries the '
        + '"kit memory sync: ..." commit message literal this pin reads');
    assertNamesEveryRoot(msg[0], extraRoots,
        'the sync commit message in install-memory-sync.ps1');

    // The control, derived from a live claim rather than written out, so a
    // later sweep that "corrects" a retired literal in this file cannot
    // disarm it. The failure this pin exists against is a sentence naming the
    // tiers and stopping there, which is what stripping the extra roots out
    // of a live claim produces.
    const live = boundaryClaims(fs.readFileSync(path.join(__dirname, '..',
        'docs', 'security-model.md'), 'utf8'))[0];
    assert.ok(live, 'docs/security-model.md carries no boundary claim to '
        + 'build the control from');
    let ablated = live;
    for (const root of extraRoots) {
        ablated = ablated.replace(new RegExp('\\s*(and\\s+)?(the\\s+)?(machine\\s+)?'
            + root + '(\\s+directory)?', 'gi'), '');
    }
    assert.throws(
        () => assertNamesEveryRoot(ablated, extraRoots, 'the control'),
        /without naming the "/,
        'the control passed: a boundary sentence with every admitted root '
        + 'beyond the memory tiers stripped out of it was accepted, so a '
        + 'green from this pin proves nothing');

    // What this pin does not refuse, stated rather than left to be assumed:
    // it tests that a root's name appears in the sentence, not that the
    // sentence admits it, so "re-includes only the memory tiers, excluding
    // the coordinator directory" would pass. No check here reads prose sense.
});

// The public-board cap on a worker's blocker traffic is stated at three
// sites: executing-work's expert-ask paragraph, its first-line paragraph, and
// peer-sessions' Worker seat bullet. The cap prices what the ask, the
// coordinator notice, and the declaration's own first line may carry, and
// each site states the footing it stands on. These pins hold both, because
// the footing is the part that has already gone false once: it read as a
// board file a public repository may carry, and the coordinator's board sits
// in the memory store, so a worker reasoning from the footing rather than
// obeying the rule would conclude the cap had lapsed.
//
// The footing each site now states is that the cap is a standard rather than
// a derivation. It is stated against a public board so that moving the board
// somewhere quieter never reads as relaxing it, which is the framing
// docs/security-model.md carries, and no fact about where the board sits,
// what remote is configured, whether anything replicates at all, or who reads
// it can be reasoned into relaxing it. Each site resolves to
// docs/security-model.md for the readership analysis and to the coordinator
// skill for the readership precondition, rather than restating either.
//
// Each pin refuses three named axes and asserts the footing is stated.
//
//   axis 1, the retired footing: the site grounding the cap in a repository
//   carrying the board. The refusing rule is assertFootingNotRetired, which
//   throws on a "board"/container-noun adjacency inside one sentence, in
//   either order. Its reach and its one known misfire are stated at the rule
//   itself.
//
//   axis 2, the re-pegged footing: the site grounding the cap in a fact about
//   the store's remote, either the remote being private or the store's own
//   replication standing as the warrant. The first is the "correction" a
//   later pass would make while appearing to update the paragraph, and it
//   would remove the screen, since a private remote is a precondition of one
//   installation rather than a property of the kit. The second is the
//   re-derivation this section was rewritten to retire, and it passes a
//   refusal aimed at the replacement case when it is added beside the
//   standard rather than put in its place, so the rule reaches it in either
//   position. The refusing rule is assertFootingNotRepegged. Its reach and
//   what it misses are stated at the rule itself.
//
//   axis 3, the cap relaxed while still being named: text that keeps the
//   cap's vocabulary and drops its force, by conditioning the cap or its
//   footing on something ("only until the operator has answered the
//   readership question, after which the seat's own judgement replaces the
//   cap"). It is what a pin over a standard needs, since a standard has no
//   derivation left to falsify: the only way to disarm it in prose is to make
//   it contingent. The refusing rule is assertCapNotConditioned. Its window
//   covers the cap's own statement and its footing's, so a footing made
//   contingent ("where a remote is configured") is refused by this axis and
//   needs no separate one. What it reads is a relaxation vocabulary rather
//   than force itself, which is a real limit and is stated at the rule.
//
// A fourth refusal is not an axis but a boundary: assertNoBoundaryTriple
// keeps these paragraphs from restating which boundaries a board line
// crosses. Two shipped surfaces name different triples, the coordinator skill
// naming machine, account and session and docs/security-model.md naming
// account, machine and person, so a restatement here picks a side in a
// disagreement these paragraphs have no mandate to settle. They point at
// docs/security-model.md instead. Its residual is stated at the rule.
//
// The ablations below are standalone constructed strings that never reference
// the slice, and they prove exactly one thing: that each refusing rule fires
// on that axis's offending shape. They prove nothing about the slice, and no
// arrangement of them could, since each ablation matches on its own and the
// assert.throws would succeed whatever the slice held. What keeps the slice
// itself honest is the positive assertions in assertFootingStated and the
// far-end assertions in assertFootingSourcesCarryIt, which read the live text
// and nothing else.
//
// The far end is the other half of this design. Each site stops carrying its
// own ground and delegates it, so a pin that only reads the pointer goes
// green while the pointed-at standard is reworded or deleted, which is the
// cross-file-invariant-nothing-checks shape these paragraphs refuse to
// create. assertFootingSourcesCarryIt reads the two delegated surfaces and
// runs inside all three site pins, so a far end that moves reddens at every
// site that leans on it rather than nowhere.

function sentencesOf(text) {
    // A period is a sentence break only where whitespace or the end follows,
    // so `board.md` and `docs/security-model.md` stay inside their sentence
    // rather than splitting it. Splitting on a bare period is what let the
    // most likely re-introduction spelling, the coordinator skill's own
    // `board.md`, slip past an adjacency check.
    return text.split(/[.;:](?=\s|$)/);
}

// The container nouns a re-introduced premise would spell. The list is wider
// than the two spellings the retired text used, since the premise reads the
// same with any of them, and it is still a list rather than a rule: a
// re-introduction spelling a container this alternation does not name goes
// unrefused, and that residual is the honest limit of this axis. What the
// list does cover is every spelling on the surfaces this repository ships,
// which is where a copy-forward would come from.
const CONTAINER_NOUN
    = '(?:repo|repos|repository|repositories|project|projects|marketplace|marketplaces|forge|forges|host|hosts|GitHub|git remote)';
// The gap between the two words spans anything but a sentence break, and a
// period is a break only where whitespace or the end follows it. A gap that
// broke on every period was cut by the period inside `board.md`, which is how
// the coordinator skill spells the board and so the most likely spelling a
// re-introduced premise would carry.
const SAME_SENTENCE_GAP = '(?:[^.;:]|[.;:](?!\\s|$)){0,80}';
// `board` is anchored on both sides. Unanchored it matched inside keyboard,
// billboard and boards, and "the operator's keyboard" is standing vocabulary
// in these files, so an ordinary sentence pairing it with a repo would have
// reddened the suite claiming a retired premise that was not there. The
// anchor costs nothing the axis needs: a period is a word boundary, so the
// `board.md` spelling still matches.
const RETIRED_FOOTING = new RegExp(
    '\\bboard\\b' + SAME_SENTENCE_GAP + '\\b' + CONTAINER_NOUN + '\\b|\\b'
    + CONTAINER_NOUN + '\\b' + SAME_SENTENCE_GAP + '\\bboard\\b', 'i');

// Axis 2 is two patterns, because the footing can be re-pegged to the store
// in two directions and only one of them was ever written here.
//
// PRIVATE_PREMISE refuses the literal word "private" beside a remote, a store
// or a board. That covers the primary copy-forward risk, since the
// coordinator skill's own precondition is worded "the store's remote is
// private", so a pass that pulls that premise down into these paragraphs is
// caught. What it misses is the same premise said without the word: "only the
// operator's own machines pull the store", "the remote is the operator's own
// and its principals are theirs alone", "the store is never published, so the
// readership is bounded". Those are refused by nothing here and are left to
// review, which is why each site states the footing as a standard rather than
// leaving a reader to infer one.
//
// REPLICATION_PREMISE refuses a replication-shaped warrant beside a remote or
// a store. That premise is the one this section retired, and refusing only
// the absence of the standard would miss it: added beside the standard
// sentence rather than in its place ("the store's sync replicates that line
// to every machine the configured remote serves, which is why the line is
// capped"), it leaves every other rule green while restoring the derivation a
// worker on a box that replicates nowhere reads as absent. What it misses is
// a replication premise that names neither the remote nor the store ("every
// machine that pulls it sees the line"), and a description of replication
// that is not offered as a warrant, since no pattern here reads a sentence's
// argumentative role. The second cuts the other way and is the reason these
// paragraphs describe no replication at all rather than describing it
// carefully: a site that needs the fact points at docs/security-model.md,
// which carries it.
const PRIVATE_PREMISE
    = /\bprivate\b[^.;:]{0,80}\b(remote|store|board)\b|\b(remote|store|board)\b[^.;:]{0,80}\bprivate\b/i;
const REPLICATION_VERB = '(?:replicat\\w+|sync\\w*|propagat\\w+|pushe[sd]|pulls?)';
const REPLICATION_PREMISE = new RegExp(
    REPLICATION_VERB + SAME_SENTENCE_GAP + '\\b(remote|store)\\b|\\b(remote|store)\\b'
    + SAME_SENTENCE_GAP + REPLICATION_VERB, 'i');

// The relaxation vocabulary. A cap that is named and then made contingent
// reads as a cap to a skimming reader and to any check that matches the cap's
// own words, which is the shape the security lens constructed: the pins are
// satisfied by text that names the cap and no longer imposes it. "Only what"
// and "only when it holds" are not here: the first is how every one of these
// sites states the cap itself, and the second is unrelated prose in the
// Worker bullet.
//
// The residual is the honest limit of this axis and is larger than the other
// two: a relaxation written outside this vocabulary is not refused. Measured
// non-refusals, all of which say what the ablation below says: "the cap binds
// until the operator answers", "where the readership is settled the seat's
// own judgement governs", "at the seat's discretion once the store's
// readership is known". A rule that read force rather than words would catch
// those, and nothing here reads force; what this rule buys is that the
// cheapest spellings of a relaxation, the ones a pass "correcting" these
// paragraphs would reach for first, cannot be written silently.
const RELAXATION
    = /\bonly (?:where|while|until|once|if|so long as|for so long)\b|\bunless\b|\bonce the operator\b|\bmay be relaxed\b|\bno longer applies\b|\bneed not\b|\bceases to\b|\blapses\b|\bis lifted\b|\bdoes not apply\b|\bstops applying\b|\bown judge?ment replaces\b|\bwhere a remote is\b|\bwhere the store's remote\b/i;

const CAP_PHRASE = /public[- ]board cap|put on a public board/i;
const FOOTING_PHRASE = /a standard rather than/i;
const CAP_MENTION = /\bthe cap\b/i;

function assertFootingNotRetired(slice, where) {
    // \brepo\b matches inside "repo-relative", which two of these three
    // slices already contain, so a future sentence putting "board" and
    // "repo-relative" in one clause reddens wrongly. That direction is the
    // acceptable one, a loud false alarm rather than a silent pass, and it is
    // named here so the next author reads the failure rather than guessing at
    // it: reword the sentence or split the clause.
    const hit = slice.match(RETIRED_FOOTING);
    assert.ok(!hit, where + ' grounds the public-board cap in a repository '
        + 'carrying the board, which is the retired footing: the '
        + 'coordinator\'s board sits in the memory store, so a worker reading '
        + 'this reasons from a false premise and concludes the cap has '
        + 'lapsed. Offending text: "' + (hit ? hit[0] : '') + '"');
}

function assertFootingNotRepegged(slice, where) {
    const priv = slice.match(PRIVATE_PREMISE);
    assert.ok(!priv, where + ' grounds the public-board cap in the store\'s '
        + 'remote being private, which is a precondition of one installation '
        + 'rather than a property of the kit: pegging the cap to a private '
        + 'remote removes the screen while appearing to update the paragraph. '
        + 'Offending text: "' + (priv ? priv[0] : '') + '"');
    const repl = slice.match(REPLICATION_PREMISE);
    assert.ok(!repl, where + ' grounds the public-board cap in the store '
        + 'replicating, which is the derivation this section retired: a store '
        + 'with no remote, or a branch that tracks nothing, replicates '
        + 'nowhere, so a worker on that box reads the stated ground as empty '
        + 'and concludes the cap has lapsed. The cap is a standard; the '
        + 'replication belongs to docs/security-model.md, which these '
        + 'paragraphs point at. Offending text: "' + (repl ? repl[0] : '')
        + '"');
}

function assertCapNotConditioned(slice, where) {
    // The window is every sentence that states the cap, its footing, or
    // speaks of the cap at all, plus the sentence after each, since a
    // relaxation is as often written as the following clause as inside the
    // one it relaxes. The bare "the cap" trigger is what reaches these
    // paragraphs' operative cap sentences, which name no cap phrase of their
    // own: "So compose that one line for a public board and keep it inside
    // 120 characters", "The cap holds whatever the queue position", "A path
    // under the cap is spelled repo-relative". A relaxation written into one
    // of those was outside the window while reading as squarely inside the
    // rule.
    const units = sentencesOf(slice);
    for (let i = 0; i < units.length; i++) {
        if (!CAP_PHRASE.test(units[i]) && !FOOTING_PHRASE.test(units[i])
            && !CAP_MENTION.test(units[i])) continue;
        for (const unit of [units[i], units[i + 1] || '']) {
            const hit = unit.match(RELAXATION);
            assert.ok(!hit, where + ' conditions the public-board cap or its '
                + 'footing rather than stating it: the cap is a standard, so '
                + 'no fact about the store, its remote, or who has answered '
                + 'the readership question relaxes it. Text that names the '
                + 'cap and drops its force reads as a cap to every check that '
                + 'matches the cap\'s own words. Offending text: "'
                + (hit ? hit[0] : '') + '" in: "' + unit.trim() + '"');
        }
    }
}

function assertNoBoundaryTriple(slice, where) {
    // It reaches the two orderings the shipped surfaces actually use, both of
    // which lead with account and machine in one order or the other. The
    // residual: a triple ordered otherwise ("machine, session and account",
    // "account, person and machine") passes, and so does a degenerate shape
    // like "account, account and person", since the rule matches an ordering
    // pattern rather than parsing a list. It is a copy-forward refusal, not a
    // proof that no triple can be written here.
    const hit = slice.match(/\b(account|machine),\s*(account|machine)\s+and\s+(person|session)\b/i);
    assert.ok(!hit, where + ' restates which boundaries a board line crosses, '
        + 'which picks a side in a disagreement between two shipped surfaces: '
        + 'the coordinator skill names machine, account and session, '
        + 'docs/security-model.md names account, machine and person. These '
        + 'paragraphs point at docs/security-model.md rather than carrying a '
        + 'triple of their own. Offending text: "' + (hit ? hit[0] : '') + '"');
}

function assertCapStated(slice, where) {
    assert.match(slice, CAP_PHRASE,
        where + ' no longer prices the blocker traffic at what the sender '
        + 'would put on a public board, so the cap itself is gone rather '
        + 'than its footing');
}

// The footing's three parts: the cap is a standard, the standard does not
// move when the board does, and the analysis behind it lives on the two
// surfaces that own it. The pointer is asserted as the path rather than as a
// phrase, since "the security model" is ambiguous in peer-sessions, which
// uses that wording for the AI-OS security model.
function assertFootingStated(slice, where) {
    assert.match(slice, FOOTING_PHRASE, where + ' no longer states the cap as '
        + 'a standard rather than a derivation, so a reader is left to derive '
        + 'it from wherever the board happens to sit');
    assert.match(slice, /stated against a public board/, where + ' no longer '
        + 'states that the cap is held against a public board, which is what '
        + 'makes it independent of where the board lives');
    assert.match(slice, /never reads as relaxing it/, where + ' no longer '
        + 'says that moving the board somewhere quieter does not relax the '
        + 'cap, which is the whole point of stating it against a public board');
    assert.match(slice, /docs\/security-model\.md/, where + ' no longer '
        + 'resolves to docs/security-model.md for the readership analysis, so '
        + 'the paragraph either carries that analysis itself or drops it');
    assert.match(slice, /coordinator skill/, where + ' no longer resolves the '
        + 'readership precondition to the coordinator skill, which owns it; a '
        + 'copy of that precondition here would be a cross-file invariant '
        + 'nothing checks');
    assert.match(slice, /precondition/, where + ' no longer names the '
        + 'readership question as a precondition, so the pointer at the '
        + 'coordinator skill no longer says what is being pointed at');
}

function assertAxesRefuseHere(slice, where) {
    assertFootingNotRetired(slice, where);
    assertFootingNotRepegged(slice, where);
    assertCapNotConditioned(slice, where);
    assertNoBoundaryTriple(slice, where);

    assert.throws(() => assertFootingNotRetired(
        'The seat writes board.md, a file a public repository may carry.',
        where + '\'s retired-footing ablation'),
    /retired footing/, where + '\'s retired-footing ablation passed: the '
        + 'retired premise spelled with the board\'s own filename was '
        + 'accepted, so this axis\'s green proves nothing');
    assert.throws(() => assertFootingNotRetired(
        'What it briefs reaches a board a public GitHub project may carry.',
        where + '\'s retired-footing synonym ablation'),
    /retired footing/, where + '\'s retired-footing synonym ablation passed: '
        + 'the retired premise spelled with a container noun other than '
        + '"repository" was accepted, so this axis reaches only the two '
        + 'spellings the retired text happened to use');
    assert.throws(() => assertFootingNotRepegged(
        'The cap holds because the store\'s remote is private.',
        where + '\'s re-pegged-footing ablation'),
    /remote being private/, where + '\'s re-pegged-footing ablation passed: a '
        + 'private-remote premise was accepted, so this axis\'s green proves '
        + 'nothing');
    assert.throws(() => assertCapNotConditioned(
        'The first line carries what you would put on a public board only '
        + 'until the operator has answered the readership question for this '
        + 'store. Once they have, the seat\'s own judgement replaces the cap.',
        where + '\'s conditioned-cap ablation'),
    /conditions the public-board cap/, where + '\'s conditioned-cap ablation '
        + 'passed: text naming the cap and then making it contingent on the '
        + 'readership answer was accepted, so the relaxation vocabulary is '
        + 'not being read at all');
    // The second half of the window, exercised on its own. The ablation above
    // puts its relaxation in the same sentence as the cap, so it throws
    // before the following-sentence half is ever inspected and would stay
    // green if that half were deleted. Here the cap sentence is clean and the
    // relaxation sits only in the sentence after it, which is how a
    // "correction" to a paragraph of argued prose would most naturally be
    // written: the rule is left standing and a sentence is added beside it.
    assert.throws(() => assertCapNotConditioned(
        'The first line carries only what you would put on a public board. '
        + 'The cap does not apply once the operator has answered the '
        + 'readership question for this store.',
        where + '\'s following-sentence conditioned-cap ablation'),
    /conditions the public-board cap/, where + '\'s following-sentence '
        + 'conditioned-cap ablation passed: a clean cap sentence followed by '
        + 'a sentence relaxing it was accepted, so this axis reads only the '
        + 'sentence the cap sits in');
    assert.throws(() => assertFootingNotRepegged(
        'The store\'s sync replicates that line to every machine the '
        + 'configured remote serves, which is why the line is capped.',
        where + '\'s replication-premise ablation'),
    /grounds the public-board cap in the store replicating/, where
        + '\'s replication-premise ablation passed: a replication-shaped '
        + 'warrant was accepted, so the derivation this section retired could '
        + 'be added back beside the standard with the suite green');
    assert.throws(() => assertNoBoundaryTriple(
        'The line crosses the account, machine and person boundaries recorded '
        + 'there.', where + '\'s boundary-triple ablation'),
    /restates which boundaries/, where + '\'s boundary-triple ablation '
        + 'passed: a restated triple was accepted');
}

// The far end of the delegation. Each site names two surfaces and carries
// neither's content: docs/security-model.md for why readership is never what
// makes a board line safe, and the coordinator skill for the readership
// precondition and its unestablished default. Asserting the pointer's words
// and stopping there is the near end alone, and it goes green with the
// pointed-at standard reworded or gone, leaving three skills delegating to a
// surface that no longer answers. The fragments are distinctive rather than
// whole sentences, so ordinary editing of the surrounding prose does not
// redden them while a rewrite of the claim itself does.
function assertFootingSourcesCarryIt(where) {
    const root = path.join(__dirname, '..');
    const model = fs.readFileSync(path.join(root, 'docs', 'security-model.md'), 'utf8');
    assert.match(model, /independent of where the board lives/, 'docs/'
        + 'security-model.md no longer states that the public-board cap is '
        + 'independent of where the board lives, and ' + where + ' delegates '
        + 'its footing to that statement, as do the other two cap sites');
    assert.match(model, /moving the board somewhere quieter/, 'docs/'
        + 'security-model.md no longer states why the cap is put against a '
        + 'public board, that moving the board somewhere quieter never reads '
        + 'as relaxing it, and ' + where + ' delegates its footing to that '
        + 'statement, as do the other two cap sites');
    assert.match(model, /Readership is therefore never the thing that makes a board line safe/,
        'docs/security-model.md no longer carries the readership analysis '
        + 'the three cap sites point at, so each of them points at a document '
        + 'that no longer answers the question it sends a reader there with');

    const coordinator = fs.readFileSync(path.join(root, 'plugins',
        'claude-kit', 'skills', 'coordinator', 'SKILL.md'), 'utf8');
    assert.match(coordinator, /the board is written as a public surface/,
        'the coordinator skill no longer states what a seat does while the '
        + 'readership precondition is unestablished, and ' + where + ' names '
        + 'that skill as the owner of the precondition, as do the other two '
        + 'cap sites');
    assert.match(coordinator, /unestablished/, 'the coordinator skill no '
        + 'longer names the unestablished state of the readership '
        + 'precondition, which is the default state the three cap sites send '
        + 'a reader there to find');
    assertTrackedInIndex('docs/security-model.md');
    assertTrackedInIndex('plugins/claude-kit/skills/coordinator/SKILL.md');
}

function sliceBetween(body, startMark, endMark, where) {
    const start = body.indexOf(startMark);
    assert.ok(start !== -1, where + ' no longer opens with the lead this pin '
        + 'reads ("' + startMark + '"), so the slice has no near edge');
    const end = body.indexOf(endMark, start);
    assert.ok(end > start, where + ' is no longer followed by the landmark '
        + 'this pin bounds it with ("' + endMark + '"), so the slice has no '
        + 'far edge and would run past the paragraph it is about');
    return collapseWhitespace(body.slice(start, end));
}

// One sentence of a shipped file, read from the file rather than copied into
// a test, so a control built on it cannot drift from the prose it is about.
function sentenceStartingWith(body, opening, where) {
    const start = body.indexOf(opening);
    assert.ok(start !== -1, where + ' no longer opens with the wording this pin '
        + 'reads ("' + opening + '"), so the sentence it controls on is gone');
    const end = body.indexOf('.', start + opening.length);
    assert.ok(end > start, where + ' runs past the end of its own paragraph, so '
        + 'the sentence has no far edge');
    return collapseWhitespace(body.slice(start, end + 1));
}

function executingWorkBody() {
    return fs.readFileSync(path.join(__dirname, '..', 'plugins', 'claude-kit',
        'skills', 'executing-work', 'SKILL.md'), 'utf8');
}

function peerSessionsBody() {
    return fs.readFileSync(path.join(__dirname, '..', 'plugins', 'claude-kit',
        'skills', 'peer-sessions', 'SKILL.md'), 'utf8');
}

test('the expert-ask paragraph holds the cap as a standard, not as a reading of where the board sits', () => {
    const where = 'executing-work\'s expert-ask paragraph';
    const slice = sliceBetween(executingWorkBody(),
        '**Before any BLOCKED at all, the expert ask goes out',
        '**Before any BLOCKED that turns on a decision', where);
    assertCapStated(slice, where);
    assertAxesRefuseHere(slice, where);
    assertFootingStated(slice, where);
    assertFootingSourcesCarryIt(where);
});

test('the first-line paragraph holds the cap as a standard, not as a reading of where the board sits', () => {
    const where = 'executing-work\'s first-line paragraph';
    const slice = sliceBetween(executingWorkBody(),
        '**The first line carries only what you would put on a public board',
        'Waiting is the third stop shape', where);
    assertCapStated(slice, where);
    assertAxesRefuseHere(slice, where);
    assertFootingStated(slice, where);
    assertFootingSourcesCarryIt(where);
});

test('the Worker seat bullet holds the cap as a standard, not as a reading of where the board sits', () => {
    const where = 'peer-sessions\' Worker seat bullet';
    const slice = sliceBetween(peerSessionsBody(), '- **Worker.**',
        '- **Admin.**', where);
    assertCapStated(slice, where);
    assertAxesRefuseHere(slice, where);
    assertFootingStated(slice, where);
    assertFootingSourcesCarryIt(where);
});

// The absence-check clause is a deliberate three-surface restatement: the
// Dispatch Brief carries the implementer half, and both sighted charters carry
// the lens half, because an agent inherits no skills and cannot resolve a
// pointer. What a deliberate copy owes is a pin, which is the lesson Section 12
// of the review-and-record plan exists to record: a divergence survives a
// parity suite whose assertions never touch the diverging text. Both class
// sentences are pinned rather than one, because the clause closes two
// enumerations and an edit that reprices either class on one surface alone is
// exactly the drift this asserts against. The comparison runs on collapsed
// whitespace for a mechanical reason, not a stylistic one: the brief copy sits
// inside a fenced template that wraps it across lines at a 7-space indent, so a
// raw includes finds two of the three copies and would pass while the third
// said something else.
test('the absence-check clause states the same two classes on all three surfaces', () => {
    const surfaces = [
        ['skills', 'executing-work', 'SKILL.md'],
        ['agents', 'adversarial-reviewer.md'],
        ['agents', 'prose-reviewer.md'],
    ];
    const classSentences = [
        'the class is any check whose acceptance is a refusal, because a check '
            + 'that records only that something refused reports the same green '
            + 'whether the rule it was meant to exercise refused it or another '
            + 'rule refused it first',
        'the class is any check whose acceptance is an absence, because a '
            + 'predicate narrower than the class it guards reports the same clear '
            + 'verdict whether the state it was meant to detect is absent or '
            + 'merely unnamed',
    ];
    for (const parts of surfaces) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const body = collapseWhitespace(fs.readFileSync(path.join(__dirname, '..',
            'plugins', 'claude-kit', ...parts), 'utf8'));
        for (const sentence of classSentences) {
            const hits = body.split(sentence).length - 1;
            assert.strictEqual(hits, 1, `${rel} carries the class sentence '`
                + `${sentence.slice(0, 60)}...' ${hits} times, not once; the `
                + 'absence-check clause is a deliberate three-surface copy, so '
                + 'either every surface states both classes identically or the '
                + 'copies have drifted');
        }
    }
});

// The fixture-evidence clause is a deliberate multi-surface restatement, and its
// two sentences have two different reaches on purpose. The diagnosis sentence is
// a reviewer duty, so it sits on the two sighted charters and deliberately not on
// the skill, whose job is counting independence rather than weighing a contract.
// The class sentence is the boundary itself and sits on all three, because a
// boundary stated two ways is exactly the drift this asserts against: the review
// round that produced this clause found the charters bounding the class at what
// the work "carries" while the skill bounded it at what the run "authored", which
// are different sets. Compared on collapsed whitespace for the same reason the
// absence-check pin below uses it, since both sentences wrap across lines.
test('the fixture-evidence clause states the same class across its surfaces', () => {
    const diagnosis = 'A fixture is an assertion by its author about what the '
        + 'code should do, never in itself a statement of a contract, and where '
        + 'no owning surface states the contract the fixture claims, the contract '
        + 'is unstated and the fixture is a proposal rather than the source.';
    const classSentence = 'Fixtures, stubs, golden files, sample payloads, and '
        + 'generated files are instances rather than the boundary: the class is '
        + 'any artifact this effort authored, cited as evidence of a fact the '
        + 'effort does not own.';
    const charters = [
        ['agents', 'adversarial-reviewer.md'],
        ['agents', 'prose-reviewer.md'],
    ];
    const allThree = charters.concat([['skills', 'responding-to-review', 'SKILL.md']]);
    const bodyOf = (parts) => collapseWhitespace(fs.readFileSync(path.join(
        __dirname, '..', 'plugins', 'claude-kit', ...parts), 'utf8'));
    for (const parts of charters) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const hits = bodyOf(parts).split(diagnosis).length - 1;
        assert.strictEqual(hits, 1, rel + ' states the fixture diagnosis sentence '
            + hits + ' times, not once; both sighted charters carry it verbatim, '
            + 'so either they agree or one reviewer half has drifted');
    }
    for (const parts of allThree) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const hits = bodyOf(parts).split(classSentence).length - 1;
        assert.strictEqual(hits, 1, rel + ' states the fixture class sentence '
            + hits + ' times, not once; the class boundary is single-sourced '
            + 'across all three surfaces, and a surface stating it differently is '
            + 'the reviewer and the orchestrator disagreeing about what counts as '
            + 'evidence this effort authored');
    }
});

// The index-window bullet is a two-copy restatement like every doctrine bullet,
// and the byte-identity assertion above already holds the two copies together.
// What identity cannot see is both copies losing the same leg at once, which is
// the shape any later amendment to the staging rule would take. Two legs are
// pinned rather than the whole bullet: the lead, which carries the claim that the
// index is a window rather than a resting place, and the merge clause, whose
// plain-form command under-reports on a merge commit and so goes quiet for the
// wrong reason at exactly the point a swept peer file would land.
test('the index-window bullet keeps both of its legs in each doctrine copy', () => {
    const legs = [
        ['the window lead', 'On a checkout another session may commit to, the '
            + 'index is a window rather than a resting place.'],
        ['the merge-listing clause', 'and `git show --first-parent --name-only` '
            + 'for a merge, whose plain form shows the combined diff and omits '
            + 'every path that merged cleanly from one side'],
    ];
    const copies = [
        ['home/claude-kit-doctrine.md',
            path.join(__dirname, '..', 'home', 'claude-kit-doctrine.md')],
        ['plugins/claude-kit/skills/operating-instructions/SKILL.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
                'operating-instructions', 'SKILL.md')],
    ];
    for (const [rel, abs] of copies) {
        const body = collapseWhitespace(fs.readFileSync(abs, 'utf8'));
        for (const [name, leg] of legs) {
            const hits = body.split(leg).length - 1;
            assert.strictEqual(hits, 1, rel + ' carries ' + name + ' ' + hits
                + ' times, not once; both doctrine copies state the index-window '
                + 'rule, and the byte-identity assertion cannot see both copies '
                + 'dropping the same leg together');
        }
    }
});

// The owning-surface enumeration is the third deliberate three-surface copy this
// clause carries, and it is pinned because its drift is demonstrated rather than
// hypothetical: the review round that produced this clause found the list shipped
// documents-only on all three surfaces, with the tool leg missing, which put it in
// direct conflict with the tool-printed-claims rule sitting one bullet above it on
// both charters. The class sentence is pinned rather than the member list, since
// the members are instances by their own admission and the boundary is the thing
// two surfaces must not state differently.
test('the owning-surface class sentence is one sentence on all three surfaces', () => {
    const classSentence = 'Those surfaces are instances rather than the boundary: '
        + 'the owning surface is wherever the fact\'s own producer defines it, '
        + 'never a copy that restates it.';
    const surfaces = [
        ['agents', 'adversarial-reviewer.md'],
        ['agents', 'prose-reviewer.md'],
        ['skills', 'responding-to-review', 'SKILL.md'],
    ];
    for (const parts of surfaces) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const body = collapseWhitespace(fs.readFileSync(path.join(__dirname, '..',
            'plugins', 'claude-kit', ...parts), 'utf8'));
        const hits = body.split(classSentence).length - 1;
        assert.strictEqual(hits, 1, rel + ' states the owning-surface class '
            + 'sentence ' + hits + ' times, not once; the list of owning surfaces '
            + 'is instances and this sentence is its boundary, so a surface that '
            + 'drops or reworks it is the one that will quietly lose a leg, as the '
            + 'tool leg was lost from the enumeration itself');
    }
});

// The coverage-answer clause is a deliberate five-surface rule in three
// registers, so this pins each surface's own wording rather than byte-identity.
// Two registers carry it: the skill and the two doctrine copies share the
// operative phrases verbatim, and the two sighted charters state the same duty
// in the reviewer's voice. Four legs run, because the rule has parts that
// drift separately. The operative leg holds the coverage answer in the
// register the skill and the doctrine share, and the charter leg holds the
// same duty in the reviewer's voice. The discriminator leg spans all five,
// because the phrase it carries decides the rule's outcome rather than how a
// surface says it: what the pattern was handed is what separates a control
// that proved the instrument from one that proved coverage. The verdict leg
// carries that phrase through to what it concludes, over the three surfaces
// that share a spelling for it, because a presence pin greens on a rewrite
// that keeps the phrase and inverts its verdict. The downgrade gate rides on
// the charter leg rather than the five-surface one: it fires on a class that
// can be neither enumerated nor shaped rather than on a missing shape alone,
// and a charter stating it one clause narrower than the surfaces that own it
// would have a reviewer flag work that followed the doctrine exactly. What
// makes the pin necessary is that the doctrine copies joined the set last and a
// key-phrase grep run from the charters would have missed them: the review round
// that produced this clause found the doctrine copies shipping "neither listed
// nor shaped" and "a member you could not have listed" against the three
// surfaces' "neither enumerated nor shaped" and "a member you did not name",
// with both parity suites green, because they compare the doctrine copies only
// to each other and never to the skill that owns the rule.
test('the coverage-answer clause reaches every surface carrying the absence-check duty', () => {
    const operative = [
        'what would catch a member you did not name',
        'a structural pattern over the class\'s shape where one exists',
        'neither enumerated nor shaped',
    ];
    const paths = [
        ['plugins/claude-kit/skills/executing-work/SKILL.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
                'executing-work', 'SKILL.md')],
        ['home/claude-kit-doctrine.md',
            path.join(__dirname, '..', 'home', 'claude-kit-doctrine.md')],
        ['plugins/claude-kit/skills/operating-instructions/SKILL.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills',
                'operating-instructions', 'SKILL.md')],
    ];
    for (const [rel, p] of paths) {
        const body = collapseWhitespace(fs.readFileSync(p, 'utf8'));
        for (const phrase of operative) {
            const hits = body.split(phrase).length - 1;
            assert.strictEqual(hits, 1, rel + ' carries the '
                + 'coverage-answer phrase \'' + phrase + '\' ' + hits + ' times, '
                + 'not once; the skill and both doctrine copies state this duty '
                + 'in one shared wording on purpose, so a surface that drops it '
                + 'or restates it in its own words has drifted from the owner');
        }
    }

    const charterDuty = [
        'a structural pattern over that class\'s shape where one exists',
    ];
    for (const charter of ['adversarial-reviewer.md', 'prose-reviewer.md']) {
        const body = collapseWhitespace(fs.readFileSync(path.join(__dirname, '..',
            'plugins', 'claude-kit', 'agents', charter), 'utf8'));
        for (const phrase of charterDuty) {
            const hits = body.split(phrase).length - 1;
            assert.strictEqual(hits, 1, charter + ' carries the reviewer-register '
                + 'coverage duty \'' + phrase.slice(0, 50) + '...\' ' + hits
                + ' times, not once; a reviewer that stops asking whether a '
                + 'control proved coverage is the backstop this rule leans on');
        }
    }

    const discriminator = ['a string the pattern was handed'];
    const charterPaths = [
        ['plugins/claude-kit/agents/adversarial-reviewer.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'agents',
                'adversarial-reviewer.md')],
        ['plugins/claude-kit/agents/prose-reviewer.md',
            path.join(__dirname, '..', 'plugins', 'claude-kit', 'agents',
                'prose-reviewer.md')],
    ];
    for (const [rel, p] of paths.concat(charterPaths)) {
        const body = collapseWhitespace(fs.readFileSync(p, 'utf8'));
        for (const phrase of discriminator) {
            const hits = body.split(phrase).length - 1;
            assert.strictEqual(hits, 1, rel + ' carries the discriminator '
                + 'phrase \'' + phrase + '\' ' + hits + ' times, not once; '
                + 'all five surfaces decide the same two questions, so one that '
                + 'drops a phrase is licensing the opposite call from its '
                + 'siblings: crediting a control the others discount, or '
                + 'downgrading a class a complete enumeration already swept');
        }
    }

    for (const [rel, p] of charterPaths) {
        const body = collapseWhitespace(fs.readFileSync(p, 'utf8'));
        const phrase = 'neither enumerated nor shaped';
        const hits = body.split(phrase).length - 1;
        assert.strictEqual(hits, 1, rel + ' gates the honest downgrade on '
            + '\'' + phrase + '\' ' + hits + ' times, not once; a charter that '
            + 'gates it on a missing shape alone downgrades a class a complete '
            + 'enumeration already swept, and flags as unproven the work that '
            + 'followed the surfaces owning this rule');
    }

    const verdict = 'a string the pattern was handed, is coverage evidence too';
    for (const [rel, p] of [paths[0]].concat(charterPaths)) {
        const body = collapseWhitespace(fs.readFileSync(p, 'utf8'));
        const hits = body.split(verdict).length - 1;
        assert.strictEqual(hits, 1, rel + ' carries the discriminator through '
            + 'to its verdict ' + hits + ' times, not once; pinning the phrase '
            + 'alone greens on a rewrite that keeps it and concludes the opposite, '
            + 'so the token and the call it licenses are pinned together');
    }
});

// The paragraph-edit-unit rule has one owner and one operational residue, and
// the residue is what a fix round actually reads, since executing-work is loaded
// at that moment and writing-skills may not be. Both halves are pinned, and so
// is the pointer's path shape: the round that landed this shipped the residue
// carrying a repo-root-relative literal, which resolves only inside this
// checkout and names nothing under a marketplace install or an external engine's
// payload, and no existing assertion could see it.
test('the paragraph-edit-unit rule keeps its owner and its pointer, and the pointer resolves', () => {
    const writingSkills = collapseWhitespace(fs.readFileSync(path.join(__dirname,
        '..', 'plugins', 'claude-kit', 'skills', 'writing-skills', 'SKILL.md'), 'utf8'));
    const owner = 'When an amendment corrects a claim a curated document states, '
        + 'the edit unit is the paragraph, never the sentence.';
    assert.strictEqual(writingSkills.split(owner).length - 1, 1,
        'writing-skills no longer states the paragraph-edit-unit rule exactly '
        + 'once; it is the owning surface, so a second copy or none at all both '
        + 'leave the residue in executing-work pointing at nothing');

    const executingWork = collapseWhitespace(fs.readFileSync(path.join(__dirname,
        '..', 'plugins', 'claude-kit', 'skills', 'executing-work', 'SKILL.md'), 'utf8'));
    assert.ok(executingWork.includes('takes the paragraph as its edit unit rather '
        + 'than the sentence, and carries the claim\'s other carriers with it, per '
        + 'the writing-skills skill (`skills/writing-skills/SKILL.md` under the kit '
        + 'plugin root)'),
        'executing-work\'s fix-round step no longer carries the paragraph-edit-unit '
        + 'residue pointing at the writing-skills skill by its plugin-root path, so '
        + 'an orchestrator correcting curated prose between review rounds gets the '
        + 'rule from nowhere');

    assert.ok(!executingWork.includes('plugins/claude-kit/skills/writing-skills/'),
        'executing-work names the writing-skills skill by a repo-root-relative '
        + 'path, which resolves only inside this checkout: under a marketplace '
        + 'install or an external engine\'s --plugin-dir payload the plugin root '
        + 'holds skills/ directly and that path names nothing');
});

// session-start.js composes its Additional Context payload from a fixed set of
// blocks, and that set's size is restated on two surfaces outside the code that
// produces it: the hook's own file header and docs/architecture.md's
// SessionStart bullet. A count restated on a sibling surface is an invariant
// nothing checks, which git merges clean and no diff-reading review catches, so
// both restatements are read here against the source (docs/ is read, never
// written).
//
// The count is derived rather than asserted at a literal. The emitters are the
// blocks.push sites; two pairs of them are the mutually exclusive if/else
// branches of one block each, the backlog block (a full reading or the bound it
// hit) and the shared-checkout advisory (the sibling count or a transcript
// store that could not be listed), so the blocks number two fewer than the
// emitters. The pairing is the one figure a reader has to re-derive when this
// reddens: a new emitter moves the emitter assertion first, and its message
// says what to re-derive before the prose is touched.
const SESSION_START_BLOCK_PAIRS = 2;
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
    'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

test('session-start.js\'s block count is stated the same by the code, its header, and docs/architecture.md', () => {
    const hookPath = path.join(__dirname, '..', 'plugins', 'claude-kit', 'hooks', 'session-start.js');
    const hook = fs.readFileSync(hookPath, 'utf8');

    const emitters = (hook.match(/\bblocks\.push\(/g) || []).length;
    assert.strictEqual(emitters, 15,
        'session-start.js now holds ' + emitters + ' blocks.push sites rather than 15. '
        + 'Re-derive how many distinct blocks that is (an emitter pair that is the '
        + 'if/else of one block counts once), then move this pin, the hook\'s file '
        + 'header, and docs/architecture.md\'s SessionStart bullet together');
    const blocks = emitters - SESSION_START_BLOCK_PAIRS;
    const word = NUMBER_WORDS[blocks];
    assert.ok(word, 'the derived block count ' + blocks + ' is past this pin\'s number words');

    // The control for the two absence-shaped reads below: the same word lookup
    // over the count the source actually derives is what each surface is
    // searched for, so a surface that fails is one stating a different count
    // rather than one this pin cannot read.
    assert.strictEqual(word, NUMBER_WORDS[13],
        'the derived count is no longer thirteen, so the two prose surfaces below '
        + 'state a stale figure until they are moved with it');

    // The header is a comment block, so it is read with its line markers
    // stripped and its whitespace collapsed: the two figures below wrap across
    // lines, and a raw substring test would read a wrap as a stale count.
    const header = collapseWhitespace(hook.split(/\r?\n/).slice(0, 40)
        .filter((l) => l.startsWith('//'))
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join(' '));
    assert.ok(header.includes('composes ' + word + ' blocks in all'),
        'session-start.js\'s own file header no longer states its payload at '
        + word + ' blocks, which is what the source composes');
    assert.ok(header.includes('the emitters number ' + NUMBER_WORDS[emitters]),
        'session-start.js\'s file header no longer states its emitter count at '
        + NUMBER_WORDS[emitters] + ', the number of blocks.push sites in the file');

    const architecture = fs.readFileSync(path.join(__dirname, '..', 'docs', 'architecture.md'), 'utf8');
    const bullet = architecture.split(/\r?\n/).find((l) => l.includes('runs `session-start.js`'));
    assert.ok(bullet, 'docs/architecture.md no longer carries a SessionStart bullet naming '
        + 'session-start.js; this pin reads that line as a count-restating surface');
    assert.ok(bullet.includes('(' + word + ' blocks:'),
        'docs/architecture.md\'s SessionStart bullet states a block count other than '
        + word + ', which is what session-start.js composes: ' + bullet.slice(0, 200));
});

// The gate cadence prices each moment at a lane, and the failure mode it
// produces is a procedural step that performs a gate-earning action while
// naming no lane at the point of action: the reader executes the step, the
// closing default hands it the targeted lane by silence, and a moment that
// earns the whole gate is skipped with nothing to redden. The pins below carry
// that duty for the surfaces that perform those actions, rather than for the
// surfaces that describe the cadence, which the doctrine pins above already
// cover.
//
// The first is structural over a family rather than over a list of names: the
// commit-model bullets under each skill's "Apply the commit model" step are
// found by their shape, so a commit model added later is pinned the day it is
// written, without anyone remembering this file exists. A bullet that pushes
// is what the cadence prices, so that is the predicate; a bullet that stages
// and stops (Review-Only) performs no push and is exempt by the same reading
// rather than by an exception list.
const COMMIT_MODEL_LEAD = /^\s*\d+\.\s+\*\*Apply the commit model/;
// A push, not the commit model's own name: "Commit-and-Push" and "pre-push"
// both carry the substring, and a bullet selected or cleared by its own label
// is selected or cleared by nothing.
const PUSH_ACTION = /(?<![-\w])push/i;
const LANE_NAMED = /whole gate|targeted lane|contention lane|install surface/i;

// The extractor reports nothing rather than reporting the wrong block, which
// is the only failure mode a caller can act on: an empty array is truthy, so a
// null guard over one never fires, and a scan that runs on past the step it
// was anchored to asserts over prose that has nothing to do with commit
// models. So it returns null both when the anchor is gone and when the scan
// reaches the next numbered step without finding a bullet.
//
// It also joins a bullet's continuation lines before returning it. Markdown
// wraps a long bullet across physical lines as an ordinary authoring shape, so
// an extractor keeping only each bullet's first line drops any bullet whose
// push sits on the continuation, and a dropped bullet is silently exempt from
// every assertion below.
function commitModelBullets(relPath) {
    const lines = readRepoFile(relPath).split(/\r?\n/);
    const lead = lines.findIndex((l) => COMMIT_MODEL_LEAD.test(l));
    if (lead === -1) return null;
    const bullets = [];
    for (let i = lead + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*- \*\*/.test(line)) { bullets.push(line.trim()); continue; }
        if (!bullets.length) {
            if (/^\s*\d+\.\s+\*\*/.test(line)) return null;
            continue;
        }
        if (line.trim() === '') break;
        bullets[bullets.length - 1] += ' ' + line.trim();
    }
    return bullets.length ? bullets : null;
}

test('every commit-model bullet that pushes names the lane that push takes', () => {
    for (const relPath of [
        'plugins/claude-kit/skills/executing-work/SKILL.md',
        'plugins/claude-kit/skills/finishing-work/SKILL.md',
    ]) {
        const bullets = commitModelBullets(relPath);
        assert.ok(bullets, relPath + ' yields no commit-model bullets: either the '
            + 'step led "Apply the commit model" is gone, which is the anchor this '
            + 'pin finds them by, or the step no longer carries bullets under it. '
            + 'Move the pin with the step rather than dropping it');
        // The instrument leg: three commit models ship, so an extractor that
        // silently found none or one would otherwise pass by having nothing to
        // assert over, which reads exactly like a clean sweep.
        assert.ok(bullets.length >= 3, relPath + ' yields ' + bullets.length
            + ' commit-model bullets rather than the three that ship, so this '
            + 'pin is reading the wrong block and its silence means nothing');
        const pushing = bullets.filter((b) => PUSH_ACTION.test(b));
        assert.ok(pushing.length >= 2, relPath + ' yields ' + pushing.length
            + ' commit-model bullets that push, where Branch-and-PR and '
            + 'Commit-and-Push both do, so the predicate no longer selects the '
            + 'bullets it exists to check');
        for (const bullet of pushing) {
            const name = (bullet.match(/- \*\*([^:*]+)/) || [, bullet.slice(0, 40)])[1];
            // The lane has to sit in the same sentence as the push, not merely
            // somewhere in the bullet. A bullet is several hundred words long,
            // so a presence check over the whole of one passes on a lane named
            // for an entirely different action: "the whole gate already ran
            // earlier, so tag the release and push the tag to origin" carries
            // both words and gates nothing. What this pairing still cannot
            // decide is whether a lane named in the push's own sentence is the
            // lane for that push, since prose can claim a gate ran elsewhere;
            // what it catches is the lane word floating in another sentence.
            const paired = sentencesOf(bullet).some((s) => PUSH_ACTION.test(s)
                && LANE_NAMED.test(s));
            assert.ok(paired, 'the ' + name.trim() + ' bullet in ' + relPath
                + ' performs a push and no sentence of it names that push\'s '
                + 'lane, so a session reading it takes the closing default and '
                + 'pushes on the targeted lane. A push to a trunk consumers '
                + 'install from earns the whole gate, and a push to a PR branch '
                + 'does not: whichever it is, the bullet says so in the sentence '
                + 'where the push happens');
        }
    }
});

// The contention lane sits apart from the main gate and runs serially, so a
// full-suite run does not contain it. The finishing pass runs every whole gate
// the cadence names and had no surface saying so, which is a green suite
// handing off with the machine-shared tests unrun.
test('the finishing pass names the contention lane at the gates it runs', () => {
    const finishing = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'finishing-work', 'SKILL.md'), 'utf8');
    assert.match(finishing, /contention lane runs beside each of them, and beside every other whole gate this pass runs/,
        'finishing-work no longer states that the contention lane runs beside '
        + 'the handoff gate and every other whole gate the pass runs, so the '
        + 'pass reads a green full suite as covering tests it never ran');
    // Per bullet rather than by a count over the file: a count is satisfied by
    // the phrase appearing anywhere, so adding it in one paragraph while
    // deleting it from a bullet holds the total and the guard goes quiet for
    // the wrong reason. The subject is the bullets, so the assertion is over
    // the bullets, the way the sibling pin above already reads them.
    const bullets = commitModelBullets('plugins/claude-kit/skills/finishing-work/SKILL.md');
    assert.ok(bullets, 'finishing-work yields no commit-model bullets, so this '
        + 'pin is asserting over nothing rather than over the gates its commit '
        + 'models run');
    for (const bullet of bullets.filter((b) => /whole gate/i.test(b))) {
        const name = (bullet.match(/- \*\*([^:*]+)/) || [, bullet.slice(0, 40)])[1];
        assert.match(bullet, /contention lane beside it/, 'the ' + name.trim()
            + ' bullet in finishing-work runs a whole gate and does not name the '
            + 'contention lane beside it. That lane sits apart from the main gate '
            + 'and runs serially, so a full-suite run does not contain it and the '
            + 'bullet hands off with the machine-shared tests unrun');
    }
    const verifier = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'agents', 'qa-verifier.md'), 'utf8');
    assert.match(verifier, /^CONTENTION LANE:/m,
        'the qa-verifier\'s report format no longer carries a contention-lane '
        + 'line, so the agent that runs the handoff gate has nowhere to report '
        + 'the lane it was asked to run and the omission reads as a clean pass');
});

// The handoff gate is the one run that reads the whole tree: every section
// closed on a lane scoped to its own files. Its counts therefore have exactly
// one carrier, and the final Chapter is it.
test('the final Chapter records the handoff gate the way a section Chapter records its own', () => {
    const finishing = readRepoFile('plugins/claude-kit/skills/finishing-work/SKILL.md');
    const step = sliceBetween(finishing, '5. **Close and archive the plan doc.**',
        '6. **Apply the commit model.**', 'finishing-work\'s step 5');
    assert.match(step, /carries a `Gate:` line/,
        'the step that writes the final Chapter no longer asks it for a Gate '
        + 'line, so the one gate covering the whole tree leaves no counts behind '
        + 'and a later collateral-red diagnosis has nothing to read');
    // The shape is asked for by pointing at the section Chapter's template
    // rather than by a copy here, because the copy this step shipped dropped
    // three qualifiers the template carries, the no-baseline-exists escape
    // among them, which is the one the handoff gate needs first.
    assert.match(step, /same shape a section Chapter's does[^.]{0,200}Chapter template/,
        'finishing-work\'s step 5 no longer routes the final Chapter\'s Gate '
        + 'shape to executing-work\'s Chapter template. A restatement here is a '
        + 'second authority that drifts, and the drift lands as a shorter list '
        + 'than the template asks for');
    // The ordering is the pin's real subject: this step rewrites the plan doc,
    // archives it, prunes the backlog and refreshes the index, all of which a
    // repo's suite may read, so a Chapter carrying counts written before those
    // edits reports a gate that never saw the shipped tree, and amending it
    // after the gate makes the tree one edit newer than its evidence.
    assert.match(step, /`Gate:` line left open/,
        'finishing-work\'s step 5 no longer says the final Chapter is written '
        + 'with its Gate line left open. Without that order the Chapter carries '
        + 'counts from a run that has not happened, since this step changes the '
        + 'tree after the Chapter is appended');
    assert.match(step, /one edit permitted after the gate/,
        'finishing-work\'s step 5 no longer names filling the Gate line as the '
        + 'one edit permitted after the gate, so any other post-gate edit reads '
        + 'as equally allowed and the shipped tree ends up newer than the run '
        + 'that cleared it');
    assert.ok(step.includes('records a run that has already happened and changes nothing that run read'),
        'finishing-work\'s step 5 no longer states why the Gate-line fill is '
        + 'the safe exception. The reason is the rule: an edit that adds a '
        + 'record of the run is safe where one that changes what the run read '
        + 'is not, and without it the exception reads as an arbitrary carve-out');
});

// The section Chapter's template is where that shape lives, so the duty
// phrases the two surfaces once shared are asserted there instead: this is the
// same drift the exitCodeDuty constant exists to catch, moved to the surface
// that still states the shape.
test('the Chapter template still states the Gate shape both Chapters are written to', () => {
    const template = executingWorkBody().split(/\r?\n/)
        .find((l) => l.startsWith('Gate: <'));
    assert.ok(template, 'executing-work\'s Chapter template no longer carries a '
        + 'Gate line, which finishing-work\'s final Chapter now points at for '
        + 'its own shape rather than restating it');
    for (const [phrase, why] of [
        [exitCodeDuty, 'the exit code read from the run itself, which is what '
            + 'keeps the field a value rather than an attestation'],
        [lanePluralDuty, 'more than one lane, while the contention lane runs '
            + 'beside the targeted one and a whole gate can run beside both'],
        ['no baseline exists on it', 'the escape hatch a writer hits first, '
            + 'since the run covering the whole tree is the one least likely to '
            + 'have a prior baseline on its lane'],
    ]) {
        assert.ok(template.includes(phrase), 'the Chapter template\'s Gate line '
            + 'no longer asks for ' + why + ' ("' + phrase + '"). '
            + 'finishing-work\'s step 5 points at this line for the final '
            + 'Chapter\'s shape, so what drops here drops from both');
    }
});

// The contention lane's counts have two ends and both are pinned, because
// either one alone produces a report that reads clean: the agent that runs the
// lane cannot discover it (the lane's commands are per-repo facts in a memory
// tier no subagent is given), and the dispatch that knows it has to say so.
test('the contention lane reaches the qa-verifier from the dispatch, and the charter says how to run it', () => {
    const finishing = readRepoFile('plugins/claude-kit/skills/finishing-work/SKILL.md');
    const step = sliceBetween(finishing, '1. **QA verification.**',
        '2. **Security review.**', 'finishing-work\'s step 1');
    assert.match(step, /brief carries the contention lane's own command, or states that this repo defines none/,
        'finishing-work\'s step 1 no longer passes the contention lane\'s '
        + 'command, or its absence, to the qa-verifier. The agent has no way to '
        + 'discover the lane, so an omitted one comes back as NONE DEFINED and '
        + 'reads exactly like a repo that defines no such lane');

    const verifier = readRepoFile('plugins/claude-kit/agents/qa-verifier.md');
    assert.match(verifier, /^CONTENTION LANE:/m,
        'the qa-verifier\'s report format no longer carries a contention-lane '
        + 'line, so the agent that runs the handoff gate has nowhere to report '
        + 'the lane it was asked to run and the omission reads as a clean pass');
    // The format alone is not the duty: a report line with no process behind
    // it is filled from whatever the agent did, so deleting the instruction
    // leaves the format green and the lane unrun.
    assert.match(verifier, /after the suite has completed, never concurrently with it/,
        'the qa-verifier\'s Tests step no longer tells the agent to run the '
        + 'contention lane after the suite completes. Run concurrently, the two '
        + 'reproduce the contention the lane exists to avoid, and the charter is '
        + 'the only surface that says so');
    assert.match(verifier, /`NONE DEFINED` carries its evidence/,
        'the qa-verifier\'s Tests step no longer requires evidence behind a '
        + 'NONE DEFINED, so the report\'s default answer is indistinguishable '
        + 'from a genuine no-lane repo, which is the clean pass this line exists '
        + 'to prevent');
});

// The pins above read the surfaces this plan already knew about. This one is
// the generator fix: it derives the family from the tree rather than from a
// list of names, so the next procedure that grows a gate-earning git
// integration action reddens when it is written instead of waiting for a
// reviewer to notice it.
//
// The unit is the physical line, which in these files is a paragraph or a
// bullet. The predicate is a git integration action reaching a remote or a
// trunk: the verb next to its object, or the plumbing spelled out, rather than
// a list of the phrasings that happen to ship today, so a step written in
// vocabulary this file never saw is still selected on its shape. What the
// predicate cannot see is an action phrased without any of those objects
// ("publish the branch upstream"), so the sweep covers the shape rather than
// the class of every possible spelling, and it says so here rather than
// reporting a clean sweep it has not earned.
//
// The duty is a lane named, or an exemption stated, in the same paragraph. The
// exemptions below are paragraphs that describe an action rather than perform
// one, or whose action is performed and gated elsewhere; each carries its rule
// so a later reader can tell an exemption from an oversight, and a stale entry
// reddens rather than going quiet, since an entry matching nothing is asserted
// against.
const INTEGRATION_ACTION = new RegExp([
    '\\bgit (?:push|merge|pull|cherry-pick)\\b',
    '(?<![-\\w])(?:push|pushes|pushing|merge|merges|merging|cherry-pick|cherry-picks|cherry-picking)'
        + '\\b[^.`]{0,50}?\\b(?:to origin|to main|to master|to the trunk|the branch|the recovery branch|the tag|onto)\\b',
    '(?<![-\\w])(?:committed and pushed|commit and push|push and open)\\b',
    '\\b(?:is|runs|takes) Commit-and-Push\\b',
].join('|'), 'i');
// A lane named, and never a paragraph's assertion that it owes none. A
// no-gate claim is exactly the thing this sweep exists to adjudicate, so it
// clears only through INTEGRATION_EXEMPT, where the paragraph is anchored and
// its rule is written down beside it. Read as a clearing phrase instead, the
// claim certifies itself: any line performing an integration passes by
// carrying the words, with no rule stated anywhere and nothing to redden.
// What stays honest about the rest of the list is stated rather than implied:
// these are lane words, so a match is presence of the words in the line and
// never proof that the lane named is the one that action takes.
const GATE_STATED = /whole gate|targeted lane|contention lane|install surface/i;

const INTEGRATION_EXEMPT = [
    ['skills/brainstorming/SKILL.md', 'land it on main and leave no mess',
        'names the commit model for a plan header; the push it describes is '
        + 'executing-work step 7\'s, which names that push\'s lane where it happens'],
    ['skills/branch-hygiene/SKILL.md', 'Branch fresh from the current integration ref',
        'the stranded-recovery path\'s gate is an open operator decision in '
        + 'docs/backlog.md: a cherry-pick onto a fresh base produces a tree '
        + 'neither parent had, and whether that is the cadence\'s merge moment '
        + 'is a change to the cadence rather than a carrier repair'],
    ['skills/branch-hygiene/SKILL.md', 'Bring the commits over',
        'same recovery path, same open decision'],
    ['skills/branch-hygiene/SKILL.md', 'Push the recovery branch',
        'same recovery path; the push lands on a recovery branch rather than on '
        + 'an install-surface trunk, so only the cherry-pick\'s own status is open'],
    ['skills/executing-work/SKILL.md', 'pushes the section to origin with no later human gate',
        'a subordinate clause about notifying the operator, referring to step '
        + '7\'s push; step 7 names that push\'s lane'],
    ['skills/finishing-work/SKILL.md', 'Then report the store\'s sync state',
        'the push lands in the kit memory store, a repository of its own that '
        + 'no suite reads and that nobody installs from, so the pre-push '
        + 'condition cannot fire on it'],
    ['skills/kaizen/SKILL.md', 'Per-machine files mean three workstations',
        'describes the sync mechanism; the pull is performed at step 1 of the '
        + 'pass, which names its lane'],
    ['skills/kaizen/SKILL.md', 'the rule is what the push can break rather than the path it lands on',
        'the capture push runs no gate, and the exemption is the one class of '
        + 'claim this sweep adjudicates rather than clears: it holds only while '
        + 'the branch delta is the note commit alone, an appended line to an '
        + 'inbox no test takes as a subject, and the paragraph states that '
        + 'condition and the check that establishes it. A delta carrying '
        + 'anything else is a different push and takes the lane its own surface '
        + 'earns'],
    ['skills/operating-instructions/SKILL.md', 'the index is a window rather than a resting place',
        'a doctrine bullet on staging and the commit window rather than a '
        + 'procedure that pushes; the lane a push takes is the gate bullet\'s, '
        + 'in this same document'],
    ['skills/operating-instructions/SKILL.md', 'Name the rollback and stop for a yes',
        'a doctrine bullet on authorization for outward actions, same document '
        + 'and same gate bullet'],
];

function shippedKitMarkdown() {
    const root = path.join(__dirname, '..', 'plugins', 'claude-kit');
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            // claude-kit-doctrine.md at the plugin root is gitignored build
            // output regenerated by the doctrine-refresh hook, not a shipped
            // surface anyone edits.
            if (entry.name === 'claude-kit-doctrine.md' && dir === root) continue;
            if (entry.name.endsWith('.md')) files.push(full);
        }
    };
    walk(root);
    return files;
}

test('every kit procedure performing a git integration names that action\'s lane or states its exemption', () => {
    // The instrument's controls, run before its silence is read. Two positives
    // built on the predicate's shape rather than on a phrasing the tree
    // already carries, one of them in vocabulary these literals do not name;
    // one negative, so a pin that simply matched any git prose would fail here
    // rather than certifying itself.
    for (const control of [
        '4. **Ship the fleet manifest.** Once the manifest is written, commit and push to origin.',
        'Then bring the fix across by cherry-picking it onto the release ref.',
    ]) {
        assert.ok(INTEGRATION_ACTION.test(control), 'the sweep\'s predicate no '
            + 'longer selects a gate-earning integration step ("' + control
            + '"), so its silence over the tree means nothing');
        assert.ok(!GATE_STATED.test(control), 'the sweep\'s control paragraph '
            + 'names a lane, so it cannot show that an unnamed one is caught');
    }
    assert.ok(INTEGRATION_ACTION.test('Ship it: run the whole gate with the '
        + 'contention lane beside it, then push to origin.')
        && GATE_STATED.test('run the whole gate with the contention lane beside it'),
        'the sweep no longer passes a paragraph that performs an integration '
        + 'and names its lane, so it cannot tell a named action from an unnamed one');
    assert.ok(!INTEGRATION_ACTION.test('A local branch is auto-reaped only if '
        + 'it is verified merged into the integration branch.'),
        'the sweep\'s predicate now selects a paragraph that describes a merged '
        + 'branch without performing an integration, so its hits are git prose '
        + 'rather than gate-earning actions');
    // The self-exempting control, in the shape the clearing branch is most
    // easily widened back into: a paragraph that performs an integration and
    // asserts its own exemption in the same breath. It is selected and not
    // cleared, so it reaches the unnamed list and reddens unless a maintainer
    // anchors it in INTEGRATION_EXEMPT with its rule. A clearing phrase that
    // admitted such a claim would let every paragraph in the tree exempt
    // itself by saying so.
    const selfExempting = 'Then commit and push to origin; that push takes no gate.';
    assert.ok(INTEGRATION_ACTION.test(selfExempting)
        && !GATE_STATED.test(selfExempting),
        'a paragraph asserting its own exemption now clears the sweep in '
        + 'content, so the one claim this sweep exists to adjudicate certifies '
        + 'itself: the exemption belongs in INTEGRATION_EXEMPT, anchored on the '
        + 'paragraph and carrying its rule, where a later reader can tell it '
        + 'from an oversight and a stale entry reddens');

    const exemptHits = new Map(INTEGRATION_EXEMPT.map(([f, anchor]) => [f + '|' + anchor, 0]));
    const unnamed = [];
    for (const file of shippedKitMarkdown()) {
        const rel = path.relative(path.join(__dirname, '..', 'plugins', 'claude-kit'), file)
            .replace(/\\/g, '/');
        readRepoFile('plugins/claude-kit/' + rel).split(/\r?\n/).forEach((line, i) => {
            if (!INTEGRATION_ACTION.test(line)) return;
            const exempt = INTEGRATION_EXEMPT.find(([f, anchor]) => f === rel && line.includes(anchor));
            if (exempt) { exemptHits.set(rel + '|' + exempt[1], exemptHits.get(rel + '|' + exempt[1]) + 1); return; }
            if (GATE_STATED.test(line)) return;
            unnamed.push(rel + ':' + (i + 1) + ' ' + line.trim().slice(0, 120));
        });
    }
    assert.deepStrictEqual(unnamed, [], 'a kit procedure performs a git '
        + 'integration and its paragraph names no lane and states no exemption, '
        + 'so a session executing it takes the closing default and gates a merge '
        + 'or an install-surface push at the targeted lane. Name the lane where '
        + 'the action happens, or state the exemption with its rule and add it '
        + 'to INTEGRATION_EXEMPT above:\n' + unnamed.join('\n'));
    for (const [key, count] of exemptHits) {
        assert.ok(count > 0, 'the exemption for ' + key + ' matches nothing in '
            + 'the tree, so it is a stale entry silently widening what this '
            + 'sweep skips. Remove it, or point it at the paragraph it means');
    }
});

// The moment-pin convention has one owning site, the moment-pin bullet of the
// testing-discipline skill, and every other surface points at it. This pin is
// what makes that stick, because a restatement drifts silently: two copies of
// one convention are never read together, so each is internally coherent while
// the pair disagrees, and the disagreement surfaces only when a reader happens
// to hold both.
//
// Two halves, covering different failures. The restatement half is a structural
// sweep for the pin form's own tail phrase, so a new surface that copies the
// convention reddens here without anyone adding it to a list. Two limits on its
// reach. It sweeps the shipped markdown under plugins/claude-kit and nothing
// else, so a copy in a memory record, under docs/, or anywhere outside that
// root is unswept and this check is silent about it. And its reach is the copy
// class rather than the paraphrase class: a surface restating the convention in
// words of its own carries no phrase this predicate can see. The pointer half
// is an enumeration of the surfaces that carry the duty at their own point of
// action, counted per duty site, so a pointer rewritten back into a restatement
// fails the first half and a pointer deleted fails the second.
const MOMENT_PIN_PHRASE = 'under what contention';
const MOMENT_PIN_OWNER = 'skills/testing-discipline/SKILL.md';
const MOMENT_PIN_EXPIRY_OWNER = 'skills/memory-system/SKILL.md';
const MOMENT_PIN_POINTER = 'moment-pin bullet';

function momentPinPhraseHits(body) {
    return body.split(MOMENT_PIN_PHRASE).length - 1;
}

test('the moment-pin convention has one owning site and its other surfaces point at it', () => {
    // The instrument speaks before its silence is read. The control is a body
    // holding a restatement in the shape one takes here, the convention's own
    // prose lifted into another surface's sentence. It is a function control
    // rather than a coverage one, since it carries the phrase the predicate was
    // handed, so it proves the sweep counts and says nothing about a paraphrase,
    // which is the reach named above.
    assert.strictEqual(momentPinPhraseHits('A measured figure carries what '
        + 'produced it, when, on which machine, and under what contention, so a '
        + 'later reader can place it.'), 1,
        'the moment-pin sweep does not see a restatement it is pointed straight '
        + 'at, so its silence over the tree would mean nothing');

    // The pointers name a moment-pin bullet, so the owner has to carry that
    // term or every pointer aims at a name its target does not answer to.
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', ...MOMENT_PIN_OWNER.split('/')), 'utf8'), /moment-pin/,
        MOMENT_PIN_OWNER + ' does not use the term its pointers name it by, so '
        + 'a reader following one arrives at a file that answers to no such '
        + 'bullet');

    // The same far-end reach for the expiry rule, which the owning bullet and
    // both reviewer charters defer their machine comparison to: the epoch
    // record and the rule that reads a figure against it both have to still be
    // there, or three pointers aim at nothing and stay green doing it.
    const expiryOwner = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', ...MOMENT_PIN_EXPIRY_OWNER.split('/')), 'utf8');
    for (const [pattern, what] of [
        [/machine configuration epoch/i, 'the machine configuration epoch record'],
        [/read against that date before it is leaned on/i, 'the rule that reads a '
            + 'recorded measurement against that epoch'],
    ]) {
        assert.match(expiryOwner, pattern, MOMENT_PIN_EXPIRY_OWNER + ' no longer '
            + 'states ' + what + ', which the moment-pin bullet and both reviewer '
            + 'charters send their readers to, so the expiry comparison is '
            + 'delegated to a rule that is not there');
    }

    const carriers = [];
    for (const full of shippedKitMarkdown()) {
        const rel = path.relative(path.join(__dirname, '..', 'plugins', 'claude-kit'),
            full).split(path.sep).join('/');
        const hits = momentPinPhraseHits(fs.readFileSync(full, 'utf8'));
        if (hits > 0) carriers.push(rel + ' (' + hits + ')');
    }
    assert.deepStrictEqual(carriers, [MOMENT_PIN_OWNER + ' (1)'],
        'the moment-pin convention is stated in full at a surface other than its '
        + 'owner, or at the owner more than once. Every mention outside the '
        + 'moment-pin bullet of the testing-discipline skill is a pointer at it '
        + 'and never a restatement, because two copies of one convention are '
        + 'never read together and so drift without anyone seeing it. This sweep '
        + 'reads the shipped markdown under plugins/claude-kit only, so its '
        + 'silence means no restatement under that root rather than none '
        + 'anywhere. Carriers found: ' + carriers.join(', '));

    // One hit per duty site, not one per file: a file-wide includes() lets two
    // of executing-work's three sites be deleted with the check still green.
    for (const [parts, sites, why] of [
        [['skills', 'executing-work', 'SKILL.md'], 3, 'its gate-reporting step, '
            + 'its interim board entry and its Chapter format each record '
            + 'measured figures, so each of the three names the owner rather '
            + 'than stating the form'],
        [['agents', 'adversarial-reviewer.md'], 1, 'the code reviewer checks this '
            + 'convention and reads its form from the owner'],
        [['agents', 'prose-reviewer.md'], 1, 'the document reviewer checks this '
            + 'convention and reads its form from the owner'],
    ]) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const body = collapseWhitespace(fs.readFileSync(path.join(__dirname, '..',
            'plugins', 'claude-kit', ...parts), 'utf8'));
        const pointers = body.split(MOMENT_PIN_POINTER).length - 1;
        assert.strictEqual(pointers, sites, rel + ' names the moment-pin bullet '
            + 'of the testing-discipline skill ' + pointers + ' times where '
            + sites + ' duty sites carry it. Fewer means a site has lost the duty '
            + 'or taken the convention back onto its own authority; more means a '
            + 'new site legitimately carries it and this expected count is what '
            + 'to raise: ' + why);
    }

    // The charters' two directions are one clause on purpose, so neither reads
    // as the whole, and the journey-ban direction has to carry the doctrine's
    // own exemption or it convicts every append-only Chapter and archive in the
    // tree. The epoch leg is pinned beside them because the convention delegates
    // that comparison to these charters and to nothing else, so a charter that
    // drops it leaves the duty stated in one skill and enforced nowhere.
    for (const parts of [['agents', 'adversarial-reviewer.md'],
        ['agents', 'prose-reviewer.md']]) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const body = collapseWhitespace(fs.readFileSync(path.join(__dirname, '..',
            'plugins', 'claude-kit', ...parts), 'utf8'));
        assert.match(body, /append-only history is exempt/i, rel + ' states the '
            + 'journey-ban direction without the exemption the doctrine states, so a '
            + 'Chapter, an archive and a changelog, which are the journey by '
            + 'design, are findings under it');
        assert.match(body, /configuration epoch of the machine it was measured on/i,
            rel + ' does not check a figure against the configuration epoch of the '
            + 'machine it was measured on, so the expiry comparison the '
            + 'memory-system skill states is delegated to a review that never '
            + 'performs it');
    }
});

// The recap skill's leash reading is a cross-surface claim in two directions.
// The bullet states how many binding forms `kit-goal.js` composes, and it
// ships a runnable invocation naming four exports of `kit-goal-lib.js`. Each
// side is otherwise tested only against its own literal, which is the shape
// the testing discipline names as earning a cross-component pin.
//
// The count leg is keyed on the binding ternary's own outcome literals rather
// than on their full wording, under the retire class that bounds an assert on
// printed text: the "What retires a test" section of
// plugins/claude-kit/skills/testing-discipline/SKILL.md states that class whole,
// with the carve-out that decides when such a pin stays. Its reach here is
// bounded and worth stating: it counts the outcome literals that
// open with "bound to session" or "unbound", so a fourth form spelled either
// way reddens it, and a fourth form worded outside both stems does not.
//
// The export leg carries the rest of the weight. A skill telling a session to
// call a function is asserting a mechanism, so the names are checked against
// the module's live export table rather than against a substring of its
// source, and a rename leaves a red here instead of a shipped instruction that
// throws for whoever runs it.
test('the recap skill\'s leash reading still matches the goal CLI it counts and the exports it calls', () => {
    const recap = readRepoFile('plugins/claude-kit/skills/recap/SKILL.md');
    // Bounded on the next bullet's lead rather than on the newline, so the
    // absence assertion below cannot be defeated by rewrapping the bullet.
    const bullet = sliceBetween(recap, '- **The leash**, read with',
        '- **Any background run', 'the recap skill\'s leash-reading bullet');

    // The writer side, counted at the CLI's own ternary.
    const goalCli = readRepoFile('plugins/claude-kit/hooks/kit-goal.js');
    const at = goalCli.indexOf('const binding = state.boundSession');
    assert.ok(at !== -1, 'hooks/kit-goal.js no longer composes its status '
        + 'binding in a `const binding = state.boundSession` ternary, so this '
        + 'pin has nothing to count the recap skill\'s figure against');
    const ternary = goalCli.slice(at,
        at + goalCli.slice(at).search(/;\r?\n/) + 1);
    const forms = ternary.match(/'(?:bound to session|unbound)[^']*'/g) || [];
    assert.equal(forms.length, 3, 'hooks/kit-goal.js now composes '
        + forms.length + ' binding forms, not three, while the recap skill '
        + 'still tells a session the status prints one of three; the skill\'s '
        + 'figure and the enumeration it feeds both move with this count');
    assert.match(bullet, /one of three forms/,
        'the recap skill no longer states the goal CLI\'s binding forms at '
        + 'three, while hooks/kit-goal.js still composes exactly that many');

    // The reader side. The bullet ships an invocation a session is told to
    // run, so every name in it is checked against the live export table.
    const lib = require(path.join(__dirname, '..', 'plugins', 'claude-kit',
        'hooks', 'kit-goal-lib.js'));
    for (const name of ['sessionHoldsLeash', 'isSessionIdShaped', 'readGoal',
        'goalStateAbsent']) {
        assert.ok(bullet.includes(name), 'the recap skill\'s leash bullet no '
            + 'longer names ' + name + ', which its shipped invocation calls');
        assert.equal(typeof lib[name], 'function', 'hooks/kit-goal-lib.js no '
            + 'longer exports ' + name + ' as a function, so the invocation the '
            + 'recap skill ships would throw for the session that ran it');
    }

    // The legs above read the invocation as text, and a text leg ships green
    // on a command that throws: an unbalanced paren, a swapped argument order
    // and a mis-spelled branch word are each invisible to a match and each
    // fatal to the session told to run it. So this leg runs the shipped
    // payload, lifted from the bullet's own backticks.
    //
    // What is stubbed is stated exactly, because a leg that overstates its own
    // reach is worse than one that admits a gap: `readGoal` and
    // `goalStateAbsent` are both replaced, so the branch ORDER is what these
    // rows prove and not either predicate's own reading of the disk. The two
    // filesystem-backed rows further down are what exercise the predicates,
    // and between them they cover the one distinction the delivery rule binds
    // on. Real here are the branch structure, `isSessionIdShaped` and
    // `sessionHoldsLeash`.
    const payload = (bullet.match(/node -e "(.*?)"`/) || [])[1];
    assert.ok(payload, 'the recap skill\'s leash bullet no longer ships a '
        + 'node -e invocation this pin can run');

    // The module path is checked rather than assumed. A stub that ignores its
    // argument would let a renamed or mistyped path ship green while every
    // session running the command falls into the catch and reads `unknown`,
    // which is the damaged-state reading and forces the leashed delivery in
    // every project. So the specifier is captured, matched, and resolved
    // against the real tree with the placeholder substituted.
    const required = [];
    const placement = (state, sessionId, absent = false) => {
        let printed = null;
        new Function('require', 'process', 'console', payload)(
            (spec) => {
                required.push(spec);
                return Object.assign({}, lib, {
                    readGoal: () => state,
                    goalStateAbsent: () => absent,
                });
            },
            { env: { CLAUDE_CODE_SESSION_ID: sessionId }, cwd: () => '.' },
            { log: (v) => { printed = v; } });
        return printed;
    };
    // Fabricated rather than live: a session id is a disclosure the recap
    // bullet itself bars from a report, so the fixture does not carry a real
    // one from whatever machine authored this.
    const ME = '5f3a91c2-7d4e-4b18-9a06-2c8e5d1f0b73';
    const OTHER = '11111111-2222-3333-4444-555555555555';
    const PLAN = 'docs/plans/a_spec_v1.md';

    // Absence first, because it is the reading the delivery paragraph exempts
    // and the ordinary state of most projects. Folding it into unknown would
    // put every unleashed project under the never-end-the-turn rule, so this
    // leg is the one holding the two apart.
    assert.equal(placement(null, ME, true), 'none armed', 'the recap skill\'s '
        + 'shipped invocation no longer reports none armed for a project with '
        + 'no goal state at all, so an unleashed project reads as a damaged '
        + 'one and takes the delivery rule written for an armed leash');

    // The specifier the invocation actually requires, checked now that a call
    // has been made through the stub.
    assert.match(required[0], /\/hooks\/kit-goal-lib\.js$/, 'the recap skill\'s '
        + 'shipped invocation requires ' + required[0] + ', not the '
        + 'hooks/kit-goal-lib.js it names its exports from; the command would '
        + 'throw into its own catch and every project would read unknown');
    const rootedSpec = required[0].replace('<plugin-root>',
        path.join(__dirname, '..', 'plugins', 'claude-kit').split(path.sep)
            .join('/'));
    assert.doesNotThrow(() => require.resolve(rootedSpec), 'the module path in '
        + 'the recap skill\'s shipped invocation does not resolve against this '
        + 'tree once <plugin-root> is substituted, so the command throws for '
        + 'whoever runs it and the catch reports unknown');

    // Then the damaged states, which are not absence: a goal file that exists
    // and cannot be read is unknown, and readGoal alone cannot tell the two
    // apart because it returns null for both. The list shape is
    // the plausible hand edit, `queue` beside it being a list, and it is what
    // the goal CLI itself reads as unarmed at its own `typeof plan` guard.
    for (const damaged of [null, {}, { plan: '' }, { plan: 5 },
        { plan: [PLAN] }]) {
        assert.equal(placement(damaged, ME), 'unknown', 'the recap skill\'s '
            + 'shipped invocation reports a definite placement for a goal '
            + 'state of ' + JSON.stringify(damaged) + ', which hooks/kit-goal.js '
            + 'reads as unarmed; the two instruments the same bullet tells a '
            + 'session to run would disagree, and the reader would act on the '
            + 'placement');
    }

    // Then the id axis and the two placements, over both routes the predicate
    // composes. The arming-route rows are why the bullet defers to
    // sessionHoldsLeash rather than naming a bare id comparison.
    for (const [state, sessionId, want, why] of [
        [{ plan: PLAN, boundSession: ME }, '', 'unplaceable',
            'this session\'s own id is absent'],
        [{ plan: PLAN, boundSession: ME }, 'not-a-uuid', 'unplaceable',
            'this session\'s own id is not session-shaped'],
        [{ plan: PLAN, boundSession: ME }, ME, 'this session',
            'the goal is bound to this session'],
        [{ plan: PLAN, boundSession: OTHER }, ME, 'not this session',
            'the goal is bound to another session'],
        [{ plan: PLAN, armingSession: ME }, ME, 'this session',
            'this session armed the goal and holds it by that route'],
        [{ plan: PLAN, armingSession: OTHER }, ME, 'not this session',
            'another session armed the goal'],
    ]) {
        assert.equal(placement(state, sessionId), want, 'the recap skill\'s '
            + 'shipped invocation no longer reports ' + want + ' where ' + why
            + ', so the recap delivers the wrong placement');
    }

    // Every row above stubs both state predicates, so it proves the branch
    // ORDER and nothing about either predicate's own reading. These two rows
    // run the real ones against a temporary tree, and they are what earns the
    // absent-versus-damaged split: `readGoal` returns null for both states, so
    // the distinction the delivery paragraph binds on rests entirely on
    // `goalStateAbsent` telling them apart on disk.
    const probeRoot = fs.mkdtempSync(path.join(require('os').tmpdir(),
        'recap-leash-'));
    try {
        const unarmed = path.join(probeRoot, 'unarmed');
        fs.mkdirSync(unarmed, { recursive: true });
        const damagedDir = path.join(probeRoot, 'damaged');
        fs.mkdirSync(path.join(damagedDir, '.kit'), { recursive: true });
        fs.writeFileSync(path.join(damagedDir, '.kit', 'goal-state.json'),
            '{ not json at all');

        assert.equal(lib.readGoal(unarmed), null, 'hooks/kit-goal-lib.js '
            + 'readGoal no longer returns null for a project with no goal '
            + 'state, so the premise these two rows rest on has moved');
        assert.equal(lib.readGoal(damagedDir), null, 'hooks/kit-goal-lib.js '
            + 'readGoal no longer returns null for an unparseable goal state, '
            + 'so it now separates absence from damage on its own and the '
            + 'invocation\'s second predicate may be redundant');
        assert.equal(lib.goalStateAbsent(unarmed), true, 'hooks/kit-goal-lib.js '
            + 'goalStateAbsent no longer reports a project with no goal state '
            + 'as absent, so the recap\'s none-armed reading collapses into '
            + 'unknown and every unleashed project takes the leashed delivery');
        assert.equal(lib.goalStateAbsent(damagedDir), false,
            'hooks/kit-goal-lib.js goalStateAbsent reports an unparseable goal '
            + 'state as absent, so a damaged leash reads as none armed and the '
            + 'recap drops the delivery rule for a project that has one');
    } finally {
        fs.rmSync(probeRoot, { recursive: true, force: true });
    }

    // The placement defers rather than restating: sessionHoldsLeash composes
    // the comparison, and the kit-goal skill owns what claims an unbound leash.
    assert.match(bullet, /kit-goal skill's claim signals/,
        'the recap skill\'s leash bullet no longer points at the kit-goal skill '
        + 'for the claim signals, so a session holding the leash by the arming '
        + 'route is reported unbound and freely claimable');
    assert.ok(!/sameSessionId/.test(bullet),
        'the recap skill\'s leash bullet names the id comparison helper '
        + 'directly; sessionHoldsLeash is the composed answer over both the '
        + 'bound-id and the recorded-arming-id routes, so an invocation built '
        + 'on the bare comparison reports a session that holds the leash by '
        + 'the arming route as not holding it');

    assertTrackedInIndex('plugins/claude-kit/skills/recap/SKILL.md');
});

// The registry entry's shape is stated twice: the role skill's directory
// contract owns it, and docs/architecture.md describes it for a reader who
// never opens the skill. A shape restated on a sibling surface is an
// invariant nothing checks, which a clean merge preserves and no
// diff-reading review catches. This pin holds the document to the contract
// on four axes: the set of lines a writer other than the session stamps,
// the two the stamping CLI writes without adding a writer, the entry's
// field set, and the one-owner rule over the push moments.
//
// The document's paragraphs are sliced rather than matched whole. A count
// can sit in one paragraph while the field enumeration in the next omits the
// very field that count left out, and a whole-file match is satisfied by
// either paragraph naming the field, so it cannot see the two disagreeing.
// What slicing buys in precision it gives up in reach: a stale count or a
// push-moments restatement written into some other section of the document
// is invisible here.
//
// Every field set on both sides is extracted from the role skill at run time
// rather than transcribed, so they move when the contract moves, and each is
// compared as a set rather than by containment, so a field either surface
// adds, renames, or retires while the other keeps it reddens. The one count
// this pin reads off a sentence is the writer-axis one, which has no
// machine-readable form on the document's side; it is keyed on the shape of
// the clause rather than on the clause verbatim, so an honest rewording
// stays green while a reversion to the machine-stamped axis does not.
//
// The push-moments leg is deliberately not a restatement detector, two
// rounds of review having established that no pattern over prose separates a
// paraphrase of a rule from ordinary writing about the same subject without
// either overclaiming or being satisfied by construction. Its reach is two
// named things and nothing wider: the document must point at the paragraph
// that owns the rule, and neither the five push moments the role skill
// enumerates nor the retired stamped-set count may appear verbatim in
// either slice. The HAND_WRITTEN_STAMP shape the six-surface pin above
// applies to its own dependents is deliberately not applied here. Run
// against these two paragraphs it matches the repaired text ("session
// writing" in one, "session's own push rewrites" in the other) exactly as
// it matches the text this section replaced, because that shape is tempered
// for the role skill's own declaration windows while this document's
// subject is writers, so it would redden on correct prose. A restatement
// that paraphrases every one of the five moments is not caught, and
// nothing here claims otherwise.
test("docs/architecture.md's registry-entry description holds to the role skill's contract", () => {
    assertTrackedInIndex('docs/architecture.md');
    assertTrackedInIndex('plugins/claude-kit/skills/role/SKILL.md');
    const role = fs.readFileSync(path.join(__dirname, '..', 'plugins',
        'claude-kit', 'skills', 'role', 'SKILL.md'), 'utf8');
    const architecture = fs.readFileSync(path.join(__dirname, '..', 'docs',
        'architecture.md'), 'utf8');
    const namesOf = (body) => backtickedFieldSet(body)
        .map((token) => token.slice(1, -2)).sort();

    // The writer count lives in the directory contract, which is a different
    // section from the entry's own shape.
    const contract = sliceBetween(role,
        'The writer rule is per file rather than one rule over the four',
        '## The registry entry',
        "the role skill's directory-contract writer rule");
    assert.ok(contract.includes('three writers and no more'),
        "the role skill's directory contract no longer closes the registry"
        + " entry's writer set at three, so the composition"
        + ' docs/architecture.md states has no owner left to agree with');
    assert.ok(sliceBetween(role, 'The push moments, closed with their class',
        'The rule is on where the value comes from',
        "the role skill's push-moments paragraph").includes('and no third'),
        "the role skill's push-moments paragraph no longer closes the"
        + ' registry entry\'s stamped set, so the count'
        + ' docs/architecture.md states is unbounded at its owner');

    const writerRule = sliceBetween(architecture,
        'The writer rule is stated per file',
        "A registry entry is a session's own account of itself",
        "docs/architecture.md's writer-rule paragraph");
    const entryShape = sliceBetween(architecture,
        "A registry entry is a session's own account of itself",
        '`claims/heavy-process.md` models the one-heavy-process-per-machine',
        "docs/architecture.md's registry-entry paragraph");
    const slices = [['writer-rule', writerRule],
        ['registry-entry', entryShape]];

    // The document spells the contract's three writers as one plus two: a
    // single-writer registry entry, and the two lines another writer stamps.
    // The single-writer leg names the entry rather than matching the word
    // alone, which the paragraph's board half satisfies on its own.
    assert.match(writerRule, /registry entr(?:y|ies)[^.]{0,40}single-writer/,
        "docs/architecture.md's writer-rule paragraph no longer states the"
        + ' registry entry itself as single-writer, so the session half of'
        + " the role skill's three-writer composition is gone from the"
        + ' document while the board half may still read as covering it');

    // The count is asserted on its own text rather than on the slice anchor
    // below, which would make it true by construction: that anchor opens
    // after the count, so this match can fail while the slice still resolves.
    // It is keyed on the writer axis deliberately. Four of the entry's lines
    // are machine-stamped and only two are stamped by a writer other than
    // the session, so a paragraph that counts two on the machine-stamped
    // axis is stating a falsehood that reads exactly like the truth.
    assert.match(writerRule, /two lines[^.]{0,60}other than the session/,
        "docs/architecture.md's writer-rule paragraph no longer states the"
        + ' stamped set as two lines written by someone other than the'
        + " session, so a reader is given either a count the role skill's"
        + ' contract does not hold or one stated on the machine-stamped axis'
        + ' rather than on the writer axis the contract closes');

    // The stamped set, as a set on both sides.
    const contractStamped = namesOf(sliceBetween(contract,
        'three writers and no more',
        "so another session's registry file is never yours to write",
        "the role skill's stamped-line enumeration"));
    assert.strictEqual(contractStamped.length, 2, "the role skill's"
        + ' stamped-line enumeration parsed to ' + contractStamped.length
        + ' field names rather than two, which is a parse failure rather'
        + " than a contract this shape; the comparison below would report"
        + " it as the document's drift");
    const stampedClause = sliceBetween(writerRule,
        'which is where the role skill', 'Two more lines are machine-stamped',
        "docs/architecture.md's stamped-line clause");
    assert.deepStrictEqual(namesOf(stampedClause), contractStamped,
        "docs/architecture.md's writer-rule paragraph and the role skill's"
        + ' contract no longer name the same set of lines stamped by a writer'
        + ' other than the session, so one surface counts a stamped set the'
        + ' other does not hold');

    // The other two machine-stamped lines, which add no writer. The expected
    // set is lifted from the role skill's own sentence about them rather
    // than transcribed here, so the document is held to the owner and not to
    // this file's memory of it.
    const timeFields = namesOf(sliceBetween(role,
        'Both time fields the session', 'are read from the clock',
        "the role skill's stamped-time-field sentence"));
    assert.strictEqual(timeFields.length, 2, "the role skill's sentence"
        + ' naming the two time fields the stamping CLI writes parsed to '
        + timeFields.length + ' field names rather than two, which is a'
        + ' parse failure rather than a contract this shape');
    const machineClause = sliceBetween(writerRule,
        'Two more lines are machine-stamped', 'The claim file and the inbox',
        "docs/architecture.md's machine-stamped clause");
    assert.deepStrictEqual(namesOf(machineClause), timeFields,
        "docs/architecture.md's writer-rule paragraph names a different pair"
        + ' of machine-stamped lines than the role skill does, so the'
        + ' sentence that keeps the writer axis honest is itself wrong about'
        + ' which lines it is excusing from that axis');

    // The entry's field set, lifted from the contract's own fenced block.
    // The heading index is checked before the fence is sought, because
    // indexOf returning -1 is clamped to zero and would silently parse the
    // first fenced block anywhere in the file. The section bound excludes a
    // fence added after this section; a fence added between the heading and
    // the entry block would be parsed instead, and what catches that is the
    // line-count check below rather than the bound.
    const headingAt = role.indexOf('## The registry entry');
    assert.notStrictEqual(headingAt, -1, 'the role skill no longer carries a'
        + ' `## The registry entry` heading, so the fenced block this pin'
        + ' reads the field set from cannot be located');
    const sectionEnd = role.indexOf('\n## ', headingAt + 1);
    const section = role.slice(headingAt,
        sectionEnd === -1 ? role.length : sectionEnd);
    const fenceOpen = section.indexOf('```');
    const fenceClose = section.indexOf('```', fenceOpen + 3);
    assert.ok(fenceOpen !== -1 && fenceClose > fenceOpen,
        "the role skill's registry-entry section no longer carries a fenced"
        + ' entry block, so the field set this pin holds the document to'
        + ' cannot be read from its owner');
    // A field line carries a name, a colon, a space, and a value, so a
    // wrapped continuation line is not promoted to a field the document
    // would then be blamed for not carrying. Every non-blank line in the
    // block has to parse: a floor would let a one-field parse loss through
    // and the comparison below would then report it as the document's drift.
    const fenceLines = section.slice(fenceOpen + 3, fenceClose)
        .split('\n').map((line) => line.trim()).filter(Boolean);
    const contractFields = [...new Set(fenceLines
        .map((line) => (/^([A-Za-z][A-Za-z0-9-]*): \S/.exec(line) || [])[1])
        .filter(Boolean))].sort();
    assert.strictEqual(contractFields.length, fenceLines.length,
        'the fenced entry block in the role skill\'s contract holds '
        + fenceLines.length + ' non-blank lines but parsed to '
        + contractFields.length + ' field names, so either a line is not a'
        + ' field line or two fields share a name; the comparison below'
        + " would otherwise report the shortfall as the document's drift");
    assert.deepStrictEqual(namesOf(entryShape), contractFields,
        "docs/architecture.md's registry-entry paragraph and the role skill's"
        + ' fenced entry block no longer name the same field set, so one'
        + ' surface describes an entry the other does not write');

    // The push-moments rule is the role skill's to state; this surface
    // points at it. The bans below are the retired stamped-set count and the
    // rule's own five moments, all held verbatim.
    assert.match(entryShape, /role skill's push-moments paragraph/,
        "docs/architecture.md's registry-entry paragraph no longer points at"
        + " the role skill's push-moments paragraph, so the rule's owner is"
        + ' sourced nowhere and a reader takes this surface for it');
    const RETIRED = ['the one `Heartbeat:` line', 'a Chapter close',
        'a BLOCKED declaration', 'a suite or gate baseline change',
        'a claim write or release', 'a seat takeover or handoff'];
    for (const [label, body] of slices) {
        for (const retired of RETIRED) {
            assert.ok(!body.includes(retired), "docs/architecture.md's "
                + label + ' paragraph carries "' + retired + '", which is the'
                + ' retired wording: either a stamped set stated at one, or'
                + " the push-moments enumeration restated here rather than"
                + ' sourced to the role skill that owns it');
        }
    }
});

// The doctrine's "Which text governs" section is the ranking every other
// pin in this file presumes: which surface wins when two disagree. Whole-body
// identity would pass with the section deleted from both copies, and the
// section is also a pointer whose far end is the ownership map, so both ends
// are pinned: the section present once per copy, identical, carrying its four
// leads and the map path; and the map tracked, on disk, and naming every
// shipped skill as an owner at least once, so a skill added without a row
// reddens here rather than shipping as a moment nobody owns.
function governsSection(body) {
    const lines = body.split('\n');
    const start = lines.findIndex((l) => l === '## Which text governs');
    if (start < 0) return null;
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join('\n');
}

test('the which-text-governs section is present once in each copy, identical, and points at the ownership map', () => {
    const inSkill = governsSection(skillBody());
    const inMirror = governsSection(mirrorBody());
    assert.ok(inSkill, 'the operating-instructions skill body carries no "## Which text governs" section');
    assert.ok(inMirror, 'the doctrine mirror carries no "## Which text governs" section');
    assert.strictEqual(skillBody().split('\n## Which text governs\n').length, 2,
        'expected exactly one which-text-governs heading in the skill body');
    assert.strictEqual(mirrorBody().split('\n## Which text governs\n').length, 2,
        'expected exactly one which-text-governs heading in the doctrine mirror');
    assert.strictEqual(inMirror, inSkill,
        'the which-text-governs section has drifted between the two doctrine copies');
    for (const lead of [
        '- **When two surfaces disagree at a moment, rank them before you act.**',
        '- **A stop read without its exceptions beside it is a pointer, not a bar.**',
        '- **Authorization for an outward act is positional, never loose prose.**',
        '- **One owner per moment, and the map names it.**',
    ]) {
        assert.strictEqual(inSkill.split('\n').filter((l) => l.startsWith(lead)).length, 1,
            'the which-text-governs section no longer carries exactly one bullet led "' + lead + '"');
    }
    assert.ok(inSkill.includes('`skills/operating-instructions/references/ownership-map.md` under the kit plugin root'),
        'the one-owner bullet no longer names the ownership map by its plugin-root path; '
        + 'the map pin below reads that path as its near end');
});

test('the ownership map is tracked and names every shipped skill as an owner', () => {
    const parts = ['plugins', 'claude-kit', 'skills', 'operating-instructions',
        'references', 'ownership-map.md'];
    const target = path.join(__dirname, '..', ...parts);
    assert.ok(fs.existsSync(target),
        'the doctrine points at an ownership map that is not on disk: ' + parts.join('/'));
    assertTrackedInIndex(parts.join('/'));
    const map = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(map.includes('\n## Unowned or contested\n'),
        'the ownership map has lost its "Unowned or contested" section, which is '
        + 'where the doctrine sends a session that meets a moment with no owner');
    const skillsDir = path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills');
    const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name);
    const ownerColumn = map.split('\n')
        .filter((l) => /^\|/.test(l))
        .map((l) => l.split('|')[2] || '')
        .join('\n');
    const unowned = skills.filter((s) => s !== 'operating-instructions'
        && !new RegExp('`' + s + '`').test(ownerColumn));
    assert.deepStrictEqual(unowned, [], 'a shipped skill owns no moment in the '
        + 'ownership map, so a session that reaches its moment finds no owner to '
        + 'read: add a row naming it in the owner column, or retire the skill');
});

// The bounded-artifact class sentence is a deliberate two-surface copy, and both
// surfaces need it self-contained. The authoring rule in brainstorming states what
// an author must write; the charter in blind-reader is read by an agent barred from
// resolving the term against this repository, so neither surface can point at the
// other. Divergence here is the one failure the gating litmus cannot survive: the
// check reads a disagreement between the reader's classification and the author's
// as evidence about the spec, so two sides handed different class texts manufacture
// that disagreement themselves and the loudest bucket fills with noise. Compared on
// collapsed whitespace, since the sentence wraps differently on the two surfaces.
test('the bounded-artifact class sentence reads the same on both gating surfaces', () => {
    const classSentence = 'a phrase deciding what a bounded artifact admits, '
        + 'where a bounded artifact is a thing that holds content, keeps other '
        + 'content out, and cannot grow without limit, so a class of actions or '
        + 'of conditions is not one however cleanly it divides';
    const surfaces = [
        ['skills', 'brainstorming', 'SKILL.md'],
        ['agents', 'blind-reader.md'],
    ];
    for (const parts of surfaces) {
        const rel = ['plugins', 'claude-kit', ...parts].join('/');
        const body = collapseWhitespace(fs.readFileSync(path.join(
            __dirname, '..', 'plugins', 'claude-kit', ...parts), 'utf8'));
        const hits = body.split(classSentence).length - 1;
        assert.strictEqual(hits, 1, rel + ' states the bounded-artifact class '
            + 'sentence ' + hits + ' times, not once; both surfaces carry it '
            + 'verbatim so the gating litmus hands one class to its two sides, '
            + 'and a divergence manufactures the disagreement the check reads '
            + 'as evidence about the spec');
    }
});

test('the probe hook-ins quote the literals the runner actually emits and the flags it actually takes, and the pointer pair between them resolves', () => {
    const runnerPath = path.join(__dirname, '..', 'tools', 'probe-corpus', 'run.mjs');
    assert.ok(fs.existsSync(runnerPath), 'tools/probe-corpus/run.mjs is absent: this pin reads the scenario-probes runner, which lands with that plan\'s section 2 ahead of the hook-ins it pins');
    const runner = fs.readFileSync(runnerPath, 'utf8');
    const flags = /const KNOWN_FLAGS = \[([^\]]*)\]/.exec(runner);
    assert.ok(flags, 'run.mjs names KNOWN_FLAGS as a literal array');
    const known = flags[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    assert.ok(runner.includes("'probe-corpus: '"), 'run.mjs emits the summary line prefix as a literal');
    assert.ok(runner.includes("'- WARNING: '"), 'run.mjs emits the report warning prefix as a literal');
    const skill = (name) => fs.readFileSync(path.join(__dirname, '..', 'plugins', 'claude-kit', 'skills', name, 'SKILL.md'), 'utf8');
    const floor = { 'writing-skills': ['--only', '--before'], 'finishing-work': ['--only', '--before', '--shape'] };
    for (const [name, expected] of Object.entries(floor)) {
        const body = skill(name);
        const spelled = new Set();
        // Only a flag inside a run.mjs command span is read; a bare flag span in prose sits outside this pin's reach.
        const spans = (body.match(/`[^`]*`/g) || []).filter((s) => /run\.mjs/.test(s));
        for (const span of spans) {
            for (const m of span.matchAll(/--[a-z][a-z-]*/g)) spelled.add(m[0]);
        }
        for (const flag of expected) assert.ok(spelled.has(flag), name + ' no longer spells ' + flag + ' in a run.mjs command, so this pin\'s floor is stale');
        for (const flag of spelled) assert.ok(known.includes(flag), name + ' spells ' + flag + ' in a run.mjs command, which run.mjs does not take');
    }
    const ew = skill('executing-work');
    assert.ok(ew.includes('`probe-corpus:`'), 'executing-work names the summary line prefix the runner emits');
    assert.ok(ew.includes('`- WARNING:`'), 'executing-work names the report warning prefix the runner emits');
    // The pointer pairs are pinned on stable tokens rather than on curated sentences, so the wording stays free to move.
    const field = (name) => (ew.split(/\r?\n/).find((l) => l.startsWith(name + ': <')) || '');
    const gate = field('Gate');
    assert.ok(/finishing-work's step 5/.test(gate) && /probe/.test(gate), 'executing-work\'s Gate line holds the slot finishing-work\'s step 5 points at');
    // The paragraph that spells the runner is the hook-in, so the pointer is read there and a sentence elsewhere in the file cannot satisfy it.
    const fwRunnerParas = skill('finishing-work').split(/\r?\n/).filter((l) => /run\.mjs/.test(l));
    assert.ok(fwRunnerParas.length > 0 && fwRunnerParas.some((l) => l.includes("executing-work's Chapter template")), 'finishing-work\'s runner paragraph points at executing-work\'s Chapter template');
    const decisions = field('Decisions / Surprises');
    assert.ok(/writing-skills'/.test(decisions) && /probe pair/.test(decisions), 'executing-work\'s Decisions / Surprises line holds the slot writing-skills points at');
    const wsBody = skill('writing-skills');
    assert.ok(wsBody.includes("executing-work's Chapter template") && wsBody.includes('`Decisions / Surprises`'), 'writing-skills points at the Decisions / Surprises slot');
});
