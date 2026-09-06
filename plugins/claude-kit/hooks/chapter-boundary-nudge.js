#!/usr/bin/env node
// PostToolUse hook (Edit|MultiEdit|Write matcher): the chapter-boundary nudge.
//
// The checkpoint system has a mechanical consumer (the PreCompact gate) and a
// prose producer (executing-work's boundary steps), and without this hook no
// feedback loop between them: a leashed run that never loads the
// executing-work skill closes Chapters by hand from the doctrine alone, never
// opens a boundary checkpoint, and the gate correctly denies every
// auto-compaction offer until the gate's own safety valve fires near the context
// limit, with no signal to anyone
// who could fix it. The gate's own deny note cannot heal it, because
// PreCompact stderr is observed to reach the user only and never the model,
// a property of the harness version this kit runs on rather than one it
// guarantees (kit-compact-gate.js states what a change there would expose).
// This hook is the
// feedback loop: it detects a Chapter being appended to the armed plan doc on
// a leashed run and puts the boundary steps in front of the model.
//
// It is a detector plus a directive, deliberately not an auto-open: the
// checkpoint belongs after the section's commit model has been honored, so a
// hook that auto-opened it at the Chapter append would admit a compaction
// between the Chapter write and its commit, the mid-boundary landing the gate
// exists to prevent. A reminder can misfire at zero cost; an auto-open cannot.
//
// The output channel is one form and one form only: JSON on stdout at exit 0
// whose hookSpecificOutput object carries hookEventName 'PostToolUse' and
// additionalContext set to the reminder. A TOP-LEVEL additionalContext key is
// inert on this harness (the hooks documentation shows it, but the harness
// parses the payload and discards that field), so this hook never emits one:
// an inert "compatibility" copy would read as working while reaching nothing.
// The reminder is a fixed string carrying no payload, transcript, or repo
// data, the same injection posture as the gate's deny notes.
//
// Seven guards, in order, every one failing toward a silent exit 0:
//   1. The payload parses and tool_name is exactly Edit, MultiEdit, or Write.
//      The hooks.json matcher already scopes this; the in-code check makes a
//      later matcher edit unable to silently widen the hook.
//   2. KIT_EXTERNAL_ENGINE is not '1'. An external engine's workers are fresh
//      per section, so there is no boundary ritual to remind them of (same
//      marker as the sibling hooks).
//   3. The payload carries no agent-identity key: agent_id, or any of the
//      four agent-type spellings the sibling subagent detectors defend
//      (agent_type, agentType, subagent_type, subagentType, per
//      readonly-agent-guard.js and docs-write-guard.js, whose breadth is the
//      repo's evidence that the spelling varies across harness versions).
//      Any of them marks a subagent's tool call, and the reminder belongs to
//      the main session. This guard is load-bearing on its own rather than
//      belt-and-braces: a subagent's PostToolUse payload carries the PARENT
//      session's own session_id, so the bound-session check in guard 6 passes
//      for a subagent's tool call and never stands one down. Only the agent
//      keys tell the two apart.
//   4. tool_input.file_path is a .md file under a docs/plans/ directory, and
//      (checked once the goal is in hand) it names the ARMED plan itself:
//      the forward-slash-normalized path equals the goal's repo-relative plan
//      or ends with '/' plus it. A sibling plan doc in the same tree never
//      fires, because the reminder asserts a boundary on the leashed run and
//      a Chapter landing in a different plan is not one; a false assertion
//      in the model's context is worse than a missed nudge. Both path
//      separators are accepted, because payloads on Windows carry backslash
//      paths.
//   5. A kit goal is armed (readGoal from kit-goal-lib.js, the same read the
//      gate uses, returning a state with a non-empty plan). The payload cwd
//      that read resolves against is refused when it names a network share
//      (two leading separators, the UNC and //server forms, single-sourced in
//      hooks/kit-network-lib.js per Standing Amendment 2): opening a path on
//      an unreachable share blocks for the SMB timeout, and a stalled edit
//      loop is the one failure this hook must never cause. A require failure
//      for that small module answers true, refusing the call, on the same
//      fail-toward-refusal reasoning as the lib requires just below: a
//      damaged cache that cannot even supply this module is not evidence the
//      working directory is safe to open. kit-goal-lib.js applies the same
//      rejection to its own stat paths, for a different subject (a stored
//      transcript path rather than a working directory), so it keeps its own
//      copy rather than folding into this module.
//   6. This session holds the goal's leash (sessionHoldsLeash from
//      kit-goal-lib.js): it is the bound session, or the goal is unbound and
//      this session is the one the state records as having armed it. Claiming a
//      binding stays the gate's and the Stop hook's business; this hook reads
//      the answer only, so a run whose leash is claimable but not yet claimed
//      is reminded rather than passed over, an arm whose bind could not be
//      corroborated and a claim whose bind write failed alike. The user's typed
//      arming text is NOT a leg: it is a claim route those two hooks act on and
//      this hook reads no transcript, so an arm made outside any session, which
//      records no arming id, leaves this hook silent for the session that will
//      claim on that text.
//   7. The write ADDS a Chapter heading, per the curating-docs machine
//      contract shape '### Chapter N'. Added means a Chapter NUMBER present
//      in new_string and absent from old_string, not merely a heading
//      somewhere in new_string: a real append anchors its old_string on the
//      document's tail, which on any plan doc past its first boundary
//      already contains the previous Chapter's heading, so a
//      presence-and-absence rule on whole headings would go silent on the
//      exact shape this hook exists to detect. For a MultiEdit any one edit
//      adding a number is enough; for a Write a heading anywhere in content
//      suffices, because a full-file Write carries no pre-image to diff and
//      a repeat reminder is harmless.
//
// Fail-open everywhere, matching the gate's posture: the hook never exits
// non-zero, never exits 2 (the tool already ran; an error-framed reminder on
// every plan-doc edit is noise), and any internal error exits 0 silently. The
// kit library requires are deferred into the guard that uses them so a
// damaged or missing lib in an installed plugin cache degrades to the same
// silent exit 0 instead of a require-time crash on every edit. A missed
// nudge degrades to the pre-hook status quo; a thrown hook would degrade the
// edit loop itself, which is strictly worse.

'use strict';

const fs = require('fs');

// The reminder, a fixed string interpolating nothing. It names the hook,
// states the boundary, orders the steps behind the section's commit model,
// states why the checkpoint matters, and routes a skill-less session to
// executing-work. The test suite pins fragments of it, so a reword is a
// deliberate double-edit.
const REMINDER = 'chapter-boundary-nudge: a Chapter was just appended to a plan doc on a '
    + 'leashed run, which marks a chapter boundary. Once this section\'s commit model has '
    + 'been honored, complete the executing-work boundary steps in order: run the memory '
    + 'sweep, then open the compaction checkpoint (kit-compact-checkpoint.js open). The '
    + 'compaction gate defers auto-compaction until a matching checkpoint is open, so a run that '
    + 'skips the steps is held mid-chapter until the safety valve in that gate fires '
    + 'near the context limit, which lands the compaction at the worst point in the '
    + 'section rather than at a clean one. If the executing-work skill is not loaded '
    + 'in this session, load it before starting the next section.';

// The Chapter heading shape, from the curating-docs machine contract: only
// '### Chapter' and the number are contract; a trailing ' - <date>' is
// convention and matches because the pattern is unanchored on the right. The
// inter-token whitespace is [ \t], not \s, so a newline between the tokens
// (prose that happens to start a line with '### ') never reads as a heading.
// One source string feeds both consumers: the anchored single-match test for
// a Write's content and the number extraction guard 7 diffs on.
const CHAPTER_HEADING_SRC = '^###[ \\t]+Chapter[ \\t]+(\\d+)';
const CHAPTER_HEADING_RE = new RegExp(CHAPTER_HEADING_SRC, 'm');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Guard 4, first half: a .md file under a docs/plans/ directory. Backslashes
// are folded to forward slashes first, so a Windows payload path matches.
// Both the directory segment and the extension are matched case-insensitively,
// because the Windows filesystem is case-preserving but not case-sensitive,
// so Docs\Plans\X.MD names the same file.
function isPlanDocPath(filePath) {
    if (typeof filePath !== 'string' || filePath === '') return false;
    const normalized = filePath.replace(/\\/g, '/');
    if (!/\.md$/i.test(normalized)) return false;
    return /(^|\/)docs\/plans\//i.test(normalized);
}

// Guard 4, second half: the payload path names the armed plan itself. The
// goal's plan is stored repo-relative with forward slashes, so the payload
// path (absolute or relative, either separator) matches when, normalized, it
// equals the plan or ends with '/' plus it. Case-insensitive on Windows only,
// where the filesystem cannot distinguish case; elsewhere the comparison is
// exact. An unusable plan value stands down.
function namesArmedPlan(filePath, plan) {
    if (typeof plan !== 'string' || plan === '') return false;
    let file = filePath.replace(/\\/g, '/');
    let target = plan.replace(/\\/g, '/');
    if (process.platform === 'win32') {
        file = file.toLowerCase();
        target = target.toLowerCase();
    }
    return file === target || file.endsWith('/' + target);
}

// The Chapter numbers the given text carries headings for, as raw digit
// strings. A fresh regex per call, because a shared global regex carries
// lastIndex state between calls.
function chapterNumbers(text) {
    const numbers = new Set();
    const re = new RegExp(CHAPTER_HEADING_SRC, 'gm');
    let match;
    while ((match = re.exec(text)) !== null) {
        numbers.add(match[1]);
    }
    return numbers;
}

// Guard 7's per-edit rule: the edit ADDS a Chapter, meaning new_string
// carries a Chapter number that old_string does not. Diffing numbers rather
// than testing for any heading is what lets a real append fire: its
// old_string anchors on the document's tail and so contains the previous
// Chapter's heading. A missing or wrong-typed new_string never fires; a
// missing or wrong-typed old_string contributes no numbers, so every number
// in new_string counts as added.
function editAddsChapter(edit) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return false;
    if (typeof edit.new_string !== 'string') return false;
    const added = chapterNumbers(edit.new_string);
    if (added.size === 0) return false;
    if (typeof edit.old_string === 'string') {
        for (const n of chapterNumbers(edit.old_string)) {
            added.delete(n);
        }
    }
    return added.size > 0;
}

// Guard 7, dispatched per tool shape (see the header for why Write is
// contains-only).
function writeAddsChapter(toolName, input) {
    if (toolName === 'Edit') return editAddsChapter(input);
    if (toolName === 'MultiEdit') {
        const edits = input.edits;
        if (!Array.isArray(edits)) return false;
        for (const edit of edits) {
            if (editAddsChapter(edit)) return true;
        }
        return false;
    }
    if (toolName === 'Write') {
        return typeof input.content === 'string' && CHAPTER_HEADING_RE.test(input.content);
    }
    return false;
}

// Evaluate the seven guards in order. Returns the reminder string when all
// pass, null otherwise. Never throws on its own account; the entry-point
// wrapper turns any escape into a silent exit 0.
function main() {
    // Guard 1: the payload parses and the tool is one this hook covers.
    let payload;
    try { payload = JSON.parse(readStdin() || '{}'); } catch { return null; }
    if (!payload || typeof payload !== 'object') return null;
    const toolName = payload.tool_name;
    if (toolName !== 'Edit' && toolName !== 'MultiEdit' && toolName !== 'Write') return null;

    // Guard 2: external-engine workers stand down.
    if (process.env.KIT_EXTERNAL_ENGINE === '1') return null;

    // Guard 3: a subagent's tool call stands down on the agent keys alone;
    // its session_id is the parent's, so guard 6 cannot tell it apart. The key
    // set is one shared module rather than a copy here, so a spelling added
    // for one detector cannot go missing from another; this site reads
    // PRESENCE rather than truthiness, which is the wider stand-down and the
    // cheaper error for a nudge fired at a plan-doc write. A cache too damaged
    // to supply the module stands the nudge down, on the same terms as guard
    // 5's lib requires below.
    let carriesAgentKey;
    try {
        ({ carriesAgentKey } = require('./kit-agent-identity-lib.js'));
    } catch { return null; }
    if (carriesAgentKey(payload)) return null;

    // Guard 4, first half: only a plan doc is a boundary surface.
    const input = payload.tool_input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (!isPlanDocPath(input.file_path)) return null;

    // Guard 5: a kit goal is armed for the project. The cwd the goal is read
    // from is refused when it is not a usable string or names a network
    // share (see the header); the lib requires are deferred to here so a
    // damaged installed cache degrades to silence rather than a crash.
    const cwd = (typeof payload.cwd === 'string' && payload.cwd !== '') ? payload.cwd : process.cwd();
    let readGoal, sessionHoldsLeash, namesNetworkShare;
    try {
        ({ namesNetworkShare } = require('./kit-network-lib.js'));
        ({ readGoal, sessionHoldsLeash } = require('./kit-goal-lib.js'));
    } catch { return null; }
    if (namesNetworkShare(cwd)) return null;
    const goal = readGoal(cwd);
    if (!goal || typeof goal.plan !== 'string' || goal.plan === '') return null;

    // Guard 4, second half: the edited file is the armed plan, not a sibling.
    if (!namesArmedPlan(input.file_path, goal.plan)) return null;

    // Guard 6: the leash holder only, by any route the claim points act on.
    if (!sessionHoldsLeash(goal, payload.session_id)) return null;

    // Guard 7: the write adds a Chapter.
    if (!writeAddsChapter(toolName, input)) return null;

    return REMINDER;
}

// Run as the PostToolUse hook only when invoked directly, so a require() of
// this file (the test suite reads REMINDER through it) can never fire the
// nudge as a side effect. Exit is via process.exitCode rather than
// process.exit(), so stdout can drain before the process ends. Every path,
// success and internal error alike, exits 0.
if (require.main === module) {
    let reminder = null;
    try { reminder = main(); } catch { reminder = null; }
    if (reminder) {
        try {
            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    additionalContext: reminder
                }
            }));
        } catch { /* the nudge is best-effort; the exit code stays 0 */ }
    }
    process.exitCode = 0;
}

module.exports = { REMINDER };
