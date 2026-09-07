#!/usr/bin/env node
// CLI entry for the kit-native goal continuity mechanism.
//
// Subcommands:
//   kit-goal.js arm <planPath>...  arm a goal against one plan doc or an
//                                  ordered queue of them, replacing whatever
//                                  was armed before and naming on stderr any
//                                  plans that replacement takes off the leash
//   kit-goal.js arm --append <planPath>...
//                                  add plans to the end of the armed queue,
//                                  under the binding it already carries
//   kit-goal.js arm [--append] --self-armed <planPath>...
//                                  record the named plans as armed by an
//                                  invocation this run made for itself rather
//                                  than by one the operator typed, and warn on
//                                  stderr for any of them whose doc records no
//                                  Dispatch Authorization
//   kit-goal.js clear              clear any armed goal
//   kit-goal.js status             report whether a goal is armed
//
// Invoked by the /kit-goal skill. Goal-state work is delegated to
// kit-goal-lib.js, which takes the binding as an argument; this file reads the
// session-id variable, plus argument parsing and output formatting. It is not
// the variable's only reader: the compaction checkpoint CLI's release verbs
// read it too, to name the session a release marker is scoped to, and they
// gate it on shape alone where this file also corroborates it against a real
// transcript before binding anything.
//
// arm runs inside the arming session's own shell, so it binds the goal to that
// session at arm time: CLAUDE_CODE_SESSION_ID names the session, and the
// harness writes that session's transcript under ~/.claude/projects. Both are
// required to bind (kit-goal-lib.js's SESSION_ID_SHAPE states why), so a
// session id naming no transcript on this machine arms unbound. The variable is
// undocumented, so it can change shape or vanish upstream without notice; an
// absent or non-UUID value arms unbound too, and the Stop hook's and compaction
// gate's claim points bind the goal instead. What those points can claim on
// differs by which half failed: a shaped id is recorded as the arming session,
// which the claim points bind on when a session carrying that id reaches one of
// them, while a value of no usable shape leaves the typed arming command in
// some session's transcript as the only route.
// Every arm reports which of the three happened, because an armed-but-unbound
// goal is otherwise silent.

'use strict';

const fs = require('fs');
const path = require('path');

// The kit libraries are bound inside the guarded region at the bottom of this
// file rather than at module scope, so a require that throws prints one elided
// line instead of Node's own trace: every module path on a `Require stack:` is
// home-anchored on an installed plugin, and this CLI's output is echoed into a
// session's context.
let armGoal, appendGoal, clearGoal, readGoal, planStatusReadings, lastActivePhrase, isSessionIdShaped,
    goalPathKind, planPathState, planArmedBy, queuePosition,
    GOAL_STATE_MAX_BYTES, AUTHORIZATION_MAX_CHARS;

// Repo-controlled strings (a plan path) are sanitized before they reach
// stdout/stderr, matching the sibling hooks' convention for any repo data
// entering a trusted output channel. It is the shared library's renderer under
// this file's own name: the refusal reasons this CLI prints embed absolute plan
// paths, so the channel's home elision is what keeps the OS account name out of
// them, and the library's cap of 120 is the cap this file already used. A
// recorded authorization sentence is prose that runs past that cap, so it takes
// the same renderer at the cap the store screened it under
// (AUTHORIZATION_MAX_CHARS): one renderer for everything this file prints, and
// the sentence still reaches the reader whole.
let sanitize;

function loadKitLibraries() {
    ({
        armGoal, appendGoal, clearGoal, readGoal, planStatusReadings, lastActivePhrase,
        isSessionIdShaped, goalPathKind, planPathState, planArmedBy,
        queuePosition, GOAL_STATE_MAX_BYTES, AUTHORIZATION_MAX_CHARS
    } = require('./kit-goal-lib.js'));
    ({ sanitizeForOutput: sanitize } = require('./kit-compact-lib.js'));
}

function usage() {
    process.stderr.write('usage: kit-goal.js arm [--append] [--self-armed] <planPath>... | clear | status\n');
    process.exitCode = 1;
}

// The build identity of the plugin this CLI is running from. The build stamps
// its short git hash into `.claude-plugin/build-info.json` under the plugin
// root, which is the one surface that carries a version at all: the root is
// CLAUDE_PLUGIN_ROOT where the host provides it, else this file's own parent
// directory. kit-version-nudge.js's installedBuildInfo() reads the same stamp
// for the session-restart nudge; this is a second reader of the file rather
// than a shared helper, since that hook exports nothing.
//
// The fallback is the root's own directory name, taken only when it is
// sha-shaped, which is what the installed cache layout spells
// (...<separator>claude-kit<separator><commit-sha>). Any other basename is a
// directory name and not a build identity (a dev checkout and a marketplace
// clone both spell it `claude-kit`), so it yields 'unknown' rather than being
// printed as a version. Either way the refusal still names the token itself.
function pluginVersion() {
    const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
    try {
        // Strip a leading BOM: a UTF-8-with-BOM stamp would otherwise fail JSON.parse.
        const stamp = JSON.parse(
            fs.readFileSync(path.join(root, '.claude-plugin', 'build-info.json'), 'utf8')
                .replace(/^\uFEFF/, '')
        );
        if (stamp && typeof stamp.hash === 'string' && stamp.hash) return stamp.hash;
    } catch { /* unstamped or unreadable: fall back to the root's own name */ }
    const base = path.basename(root);
    return /^[0-9a-f]{7,40}$/.test(base) ? base : 'unknown';
}

// A leading-dash token on an arm invocation that is not a recognized flag. It
// is refused here rather than passed to armGoal as a plan argument, which
// would answer a misleading "plan not found" for what is actually an
// unrecognized flag, most often an older CLI running a build without the flag
// a newer session expects. Naming the CLI's own build identity is what makes
// that case self-diagnosing.
function usageBadArmFlag(token) {
    process.stderr.write('kit-goal: unrecognized flag ' + sanitize(token)
        + ' (kit-goal.js version ' + sanitize(pluginVersion()) + ')\n');
    usage();
}

// The transcript file of a session id, or null when it cannot be located. The
// harness stores each session's transcript as <sessionId>.jsonl inside a
// per-project directory under ~/.claude/projects, and the scan of those
// directories is memq's own sessionTranscriptDir, delegated to rather than
// restated, the same way the SessionStart hook's fallback delegates: one copy
// of the lookup is what keeps every surface answering the same question the
// same way. The shared scan applies the shape test before any filesystem
// work, refuses a value carrying a path separator, lists through a bounded
// reader so a filled projects root cannot become an unbounded walk, and
// answers null for an id more than one project directory holds, since two
// matches are an ambiguity and taking the first would let readdir order
// decide which transcript corroborates a binding. The directory it answers
// with holds this id's transcript as a verified regular file, which is the
// corroboration the security model states, so the join below names that file.
// The whole body is wrapped, and an absent or unreadable projects directory
// yields null. The shape test is kept ahead of the delegation as a cheap
// short-circuit, so a junk id never pays for loading memq; the require is
// lazy for the same reason.
//
// A null result is what makes the arm unbound: a session id naming no local
// transcript is not corroborated as a real session on this machine, and
// armGoal writes the binding and the transcript together or not at all.
function findTranscript(sessionId) {
    try {
        if (!isSessionIdShaped(sessionId) || path.basename(sessionId) !== sessionId) {
            return null;
        }
        const { sessionTranscriptDir } = require(path.join(__dirname, '..', 'scripts', 'memq.js'));
        const dir = sessionTranscriptDir(sessionId);
        return dir === null ? null : path.join(dir, sessionId + '.jsonl');
    } catch {
        return null;
    }
}

// Add plans to the armed queue, leaving everything already armed where it is.
// The binding is the state file's own, never this shell's: an append is what a
// running session's operator reaches for when a new plan arrives mid-run, and
// re-deriving the binding from whatever shell ran the CLI would move the leash
// off the session doing the work. That is why no bind is passed here.
//
// The arming authority is passed, because it is a property of this invocation
// rather than of the queue: a run under its own typed leash appends a plan it
// armed itself under a traced grant, and the appended plan records that while
// the queue keeps what it was armed under. It reaches the appended plans alone.
function cmdAppend(planArgs, authority) {
    const result = appendGoal(process.cwd(), planArgs, authority);
    if (!result.ok) {
        process.stderr.write('kit-goal: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
        return;
    }
    unauthorizedWarning(result.unauthorized);
    process.stdout.write('kit goal queue extended with ' + result.appended.map((value) => sanitize(value)).join(', ')
        + ' (now ' + result.queue.length + ' plans; working ' + sanitize(result.plan) + ')'
        + (result.boundSession ? ' (binding unchanged)' : ' (still unbound)')
        + armingNote(result.arming)
        + '\n');
    process.exitCode = 0;
}

// What an arm or an append says about the arming it recorded, on the self
// direction only: this line is what tells the session the claim landed. It is
// worded as what the invocation declared, because that is all that happened:
// a run arming a plan for itself reaches this CLI indistinguishable from an
// operator typing the same command. An operator's arming says nothing extra,
// being the ordinary case.
function armingNote(authority) {
    return authority === 'self'
        ? " (recorded as this run's own arming rather than one the operator typed)"
        : '';
}

// What an arm that landed unbound says about how the leash can still be
// claimed, which is two different answers because the state holds two different
// things.
//
// Where the arm recorded an arming session's id (armingSession, which armGoal
// writes whenever a shaped id reached it), the claim points bind on that id, so
// a session carrying it takes the leash at its next stop or auto-compaction
// offer. That is stated as conditional on such a session existing, because this
// branch is exactly the one where the id could not be corroborated against a
// transcript file on this machine, and the reasons for that include a stale or
// inherited value naming no live session at all. Where no session holds the id,
// nothing ever claims, and re-arming from the session that should hold the
// leash is what recovers. The id is also not necessarily this process's own
// session: a dispatched subagent's shell can carry the id of the session that
// dispatched it, which is why the text says the arming session rather than this
// one.
//
// Where no shaped id was readable in this process's environment, the state
// records no arming identity, so the id route does not exist for this goal at
// all and a session whose transcript carries the plan path typed as a kit-goal
// command argument is the only route left. Whether the session reading this can
// take that route is not something the CLI can see: it reads no transcript, and
// an operator who typed the command has left that very text in a transcript.
//
// Both spellings are fixed text carrying no value from the result, so there is
// nothing here to sanitize; the plan paths beside them go through sanitize at
// their own interpolation.
function unboundNote(armingSession) {
    return armingSession
        ? ' (unbound: no usable transcript file on this machine corroborated the id this arm'
            + ' ran under, so the session holding that id claims the leash at its next stop or'
            + ' auto-compaction offer; if no live session holds it, nothing claims, and a'
            + ' re-arm from the session that should hold the leash is the recovery)'
        : " (unbound: no session id of the harness's shape was readable here, so the state"
            + ' records no arming identity, and the one remaining route is a session whose'
            + ' transcript carries this plan path typed as a kit-goal command argument)';
}

// The self-armed plans whose docs record no Dispatch Authorization, named on
// stderr beside a successful arm. A warning rather than a refusal because the
// directed path reaches plans with no section: an unleashed run arming an
// inbound plan must name its own in-flight plan too. What it is for is the
// other case, a section the scan does not reach, invisible from the state
// alone. It reports what the scan read rather than what the doc holds,
// because null has several causes and a doc with no section at all is only
// one of them, so the remedy names where a section is read from instead of
// asserting one is missing. The list is capped and says so, since every path
// prints through the 120-character cut. Silent when there is nothing to name.
function unauthorizedWarning(plans) {
    if (!Array.isArray(plans) || plans.length === 0) return;
    const shown = plans.slice(0, 5).map((value) => sanitize(value));
    const more = plans.length - shown.length;
    process.stderr.write('kit-goal: armed as this run\'s own, and the scan read no Dispatch'
        + ' Authorization out of these plan docs: ' + shown.join(', ')
        + (more > 0 ? ', and ' + more + ' more' : '')
        + ' (the arming stands; a section reads only above ## Sections of Work, outside a code'
        + ' fence, in the head of the file, with nothing after its heading)\n');
}

function cmdArm(planArgs, append, selfArmed) {
    if (planArgs.length === 0) {
        usage();
        return;
    }
    try {
        if (append) {
            cmdAppend(planArgs, selfArmed ? 'self' : 'operator');
            return;
        }
        // The environment of this process is the only source of the binding:
        // no argument, no file, and no repo data can bind the goal, and the
        // transcript is located rather than supplied. armGoal owns the gate
        // that decides whether the pair is usable, so this output answers to
        // what was actually written rather than to a second copy of the rule.
        //
        // Who is arming is the one thing here that no surface of this process
        // can read: a run arming a plan for itself supplies the same session id,
        // transcript and arguments an operator typing the command does. So it is
        // what the invocation says it is, and the default is the operator's.
        const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
        const result = armGoal(process.cwd(), planArgs, {
            sessionId,
            transcriptPath: findTranscript(sessionId)
        }, selfArmed ? 'self' : 'operator');
        if (result.ok) {
            // Arming replaces the queue, so a plan that was armed and is not
            // named again has quietly stopped being armed. That is the one
            // failure this warning exists to make loud, and it stays a warning:
            // the replace itself is unchanged. Silent when the replacement drops
            // nothing, so the line means something when it appears.
            if (result.dropped.length > 0) {
                process.stderr.write('kit-goal: this arm replaced the armed queue and these plans are no'
                    + ' longer armed: ' + result.dropped.map((value) => sanitize(value)).join(', ')
                    + ' (arm --append adds to a queue instead of replacing it)\n');
            }
            unauthorizedWarning(result.unauthorized);
            process.stdout.write('kit goal armed for ' + sanitize(result.plan)
                + (result.queue.length > 1
                    ? ' (1 of ' + result.queue.length + '; then '
                        + result.queue.slice(1).map((value) => sanitize(value)).join(', ') + ')'
                    : '')
                + (result.boundSession
                    ? ' (bound to this session)'
                    : unboundNote(result.armingSession))
                + armingNote(result.arming)
                + '\n');
            process.exitCode = 0;
        } else {
            process.stderr.write('kit-goal: ' + sanitize(result.reason) + '\n');
            process.exitCode = 1;
        }
    } catch (err) {
        process.stderr.write('kit-goal: ' + sanitize(err.message) + '\n');
        process.exitCode = 1;
    }
}

// The sentence the two absence-reporting surfaces add when the goal-state path
// holds something no reader reads as a goal, or when its kind could not be read.
// Empty for the ordinary absent and regular-file cases.
function goalPathNote(kind) {
    if (kind === 'other') {
        return ' (something that is not a goal-state file is at .kit/goal-state.json;'
            + ' no reader treats it as a goal, and arming over it will fail until it is'
            + ' moved aside by hand)';
    }
    if (kind === 'oversized') {
        return ' (.kit/goal-state.json is past the ' + GOAL_STATE_MAX_BYTES + '-byte bound every'
            + ' reader of this file enforces, so no reader treats it as a goal; clear it and arm'
            + ' again)';
    }
    if (kind === 'unresolvable') {
        return ' (.kit/goal-state.json cannot resolve to a file at all, so nothing is armed and'
            + ' arming will fail until the path above it is a directory again)';
    }
    if (kind === 'unreadable') {
        return ' (.kit/goal-state.json could not be read right now, so whether anything is'
            + ' there is unknown; try again once whatever holds it lets go)';
    }
    return '';
}

function cmdClear() {
    const cwd = process.cwd();
    const result = clearGoal(cwd);
    if (!result.ok) {
        // Nothing was removed, so this must not read as a successful clear. What
        // is left behind is not asserted: the lstat leg fires with existence
        // unproven, and while a lock stands every reader treats the leash as
        // absent, so the goal is not necessarily enforcing either.
        process.stderr.write('kit-goal: ' + sanitize(result.reason) + ' (nothing was released)\n');
        process.exitCode = 1;
        return;
    }
    if (result.cleared) {
        process.stdout.write('kit goal cleared\n');
    } else {
        process.stdout.write('no kit goal was armed' + goalPathNote(goalPathKind(cwd)) + '\n');
    }
    process.exitCode = 0;
}

// How each state a queued plan path can be in prints in the queue rendering.
// 'missing' keeps its meaning (the plan is not there, which is what archiving a
// finished plan produces and what the leash advances on).
const QUEUE_TOKENS = { gone: 'missing', unusable: 'unusable', unreadable: 'unreadable' };

// Where a queue entry's doc was looked for and not found, worded from
// queuePosition's own cause so the sentence cannot name directories the entry
// was never in: a plan armed from outside docs/plans/ has no archive location
// to check, and an entry that does not round-trip the plan-path normalizer was
// never resolved against any directory at all.
function unresolvableWhere(cause) {
    if (cause === 'unarchivable') {
        return 'is not at that path, and the plan is not armed from docs/plans/, so there is no'
            + ' archive location to look in either';
    }
    if (cause === 'unreadable-path') {
        return 'is at a path no reader here resolves, so it was looked for in no directory';
    }
    return 'is in neither docs/plans/ nor docs/archive/';
}

function cmdStatus() {
    const cwd = process.cwd();
    const state = readGoal(cwd);
    // A parseable state file with no usable plan string enforces nothing (the
    // Stop hook's hot path checks the same field before doing anything), so
    // it reads as unarmed here rather than being dereferenced into a crash;
    // the doctor is the surface that flags such a file as damage worth a
    // look. Only a state with a plan is normalized, so every field below is
    // guaranteed present past this guard.
    if (!state || typeof state.plan !== 'string' || state.plan === '') {
        process.stdout.write('no kit goal armed' + goalPathNote(goalPathKind(cwd)) + '\n');
        process.exitCode = 0;
        return;
    }

    // The liveness phrase is single-sourced in kit-goal-lib (lastActivePhrase),
    // shared with the SessionStart armed-goal notice, so the two surfaces
    // cannot answer the same mtime differently. It is a hint about whether
    // the leash holder is still working, never a verdict: a session can be
    // alive and quiet, and only the number and its unit reach the output.
    const phrase = lastActivePhrase(state.boundTranscript);
    // The two unbound states are named apart, because they are claimable by
    // different things and the arm's one-shot line that said which one this is
    // does not survive the arming session. This says what the state file holds
    // and stops there: whether any session still carries a recorded id is not
    // something this report can read. The field is the normalizer's, so it is
    // either shaped like a harness session id or null (normalizeState), and
    // nothing here decides anything on it.
    const binding = state.boundSession
        ? 'bound to session ' + sanitize(state.boundSession) + (phrase ? ', last active ' + phrase : '')
        : state.armingSession
            ? 'unbound, arming session recorded'
            : 'unbound, no arming session recorded';

    // The position is read from the plan docs rather than taken from the
    // stored index (queuePosition states the whole rule): the index only moves
    // at a clean stop of the bound session, so a run that died at its close-out
    // leaves it naming a plan that is finished and archived, and this report is
    // where an operator goes to find out where the queue actually stands.
    const position = queuePosition(cwd, state);
    const correction = position.positional && position.healed > 0;
    // The first line names the plan the STATE says is armed, which on a
    // corrected position is not the plan the '>' marker below points at. Left
    // bare, the two would read as a contradiction on one screen, so the line
    // says which of the two it is naming and where the other one is.
    const out = ['kit goal armed for ' + sanitize(state.plan)
        + ' (armed ' + sanitize(state.armedAt) + '; ' + binding + ')'
        + (correction ? ' (that is the stored current plan; the queue line below names the plan the'
            + ' plan docs put current, and the > marker points at that one)' : '')];

    const current = sanitize(state.queue[position.index]);
    let queueLine = 'queue: plan ' + (position.index + 1) + ' of ' + state.queue.length
        + ', ' + current;
    if (correction) {
        // The stored index is named rather than quietly replaced: the gap
        // between it and the truth is what tells an operator an advance was
        // missed, and the leash still acts on the stored one until the bound
        // session's next stop moves it, one plan per stop.
        queueLine += ' (the stored position still says plan ' + (position.stored + 1) + ', '
            + sanitize(state.queue[position.stored]) + '; the plan docs report ' + position.healed
            + ' plan(s) from there on as Complete or archived, and the leash advances one plan per'
            + ' stop of the bound session until it catches up)';
    }
    if (position.positional && position.finished) {
        queueLine += ' (every plan in the queue reads Complete or is archived, this one included,'
            + " so the bound session's next stop releases the leash rather than advancing it)";
    }
    if (position.positional && position.unresolvable) {
        queueLine += ' (unresolvable: the doc for this plan ' + unresolvableWhere(position.cause)
            + ', so whether it is finished cannot be read; it keeps its position rather than being'
            + ' skipped)';
    }
    out.push(queueLine);
    // The rendering is capped at five entries from the current position, with
    // the rest as a count, matching the SessionStart notice's queue clause:
    // this stdout is echoed into the session by the /kit-goal skill, and each
    // rendered entry costs a file open (planStatusReadings), so an oversized
    // state file must not become an unbounded context flood or an open per
    // line. Entries behind the reported position are not rendered here: each
    // plan the leash advanced past is reported under finished below, and any
    // the position walk moved past is counted in the queue line above.
    const window = state.queue.slice(position.index, position.index + 5);
    // Whether any rendered entry is one the two Status readings answer
    // differently about, which the divergent-token note below explains. Both
    // readings come from one call over one set of bytes (planStatusReadings),
    // so the token an entry prints and the position walked above cannot be
    // taken from different reads of the same row.
    let divergent = false;
    window.forEach((plan, i) => {
        const head = planStatusReadings(cwd, plan);
        if (head.exists && head.status === 'complete' && !head.terminal) divergent = true;
        // planStatusReadings answers the same 'no' for three states, and this
        // is the surface an operator reads first when debugging an armed queue,
        // so the three get three tokens rather than all printing as missing: a
        // directory, a junction or a link out of the repo at a queued plan path
        // is not the same problem as a plan that was archived, and a locked one
        // is neither. The classification is planPathState's, the one every
        // reader of a plan path here answers to.
        const status = head.exists ? head.status : QUEUE_TOKENS[planPathState(cwd, plan)];
        // The authorization each plan recorded when it was queued, printed on
        // both directions rather than only when one is present: an audit trail
        // that showed nothing for a plan carrying no authorization would read
        // the same as one this surface simply did not render. It is quoted from
        // the plan doc and asserted rather than authenticated, which is why it
        // reads as what the plan says rather than as a grant.
        //
        // It goes through sanitize at the cap the store screened it under rather
        // than at sanitize's own 120-character path cap: the sentences plans
        // carry run well past that cap, and a claim about who authorized arming
        // that is cut mid-clause reads as the whole recorded claim, which is the
        // one thing this line exists to let a reader judge. The renderer is what
        // the sentence needs and the store's screen cannot give it: the sentence
        // is quoted from a plan doc and an author can write an absolute
        // home-anchored path into it, and this report is echoed into a session's
        // context, so the OS account name in such a path is what the channel's
        // home elision takes out. The store's screen is a printable-ASCII rule
        // and a cap, already applied to the stored value, so the renderer's own
        // strip and cap have nothing left to do here.
        const authorization = state.authorizations[plan];
        // The arming beside the authorization, on both directions for the reason
        // the authorization prints on both: a line rendered only for one reading
        // is indistinguishable from a line this surface did not render. They are
        // two facts and read as two: who ran the arming invocation, which the
        // caller declared, and what the doc records, which was read from it.
        const arming = planArmedBy(state, plan) === 'self'
            ? "recorded as this run's own arming"
            : 'typed by the operator';
        out.push('  ' + (i === 0 ? '>' : ' ') + ' ' + sanitize(plan) + ' [' + status + ']'
            + ' (armed: ' + arming + ')'
            + ' (authorization: '
            + (authorization ? sanitize(authorization, AUTHORIZATION_MAX_CHARS) : 'none recorded') + ')');
    });
    const more = state.queue.length - position.index - window.length;
    if (more > 0) out.push('  ... and ' + more + ' more');
    if (divergent) {
        // One screen, two readings of one Status row, and without this line a
        // reader has no way to tell which line used which: a [complete] token
        // above a plan the queue line still reports as current looks like a
        // contradiction rather than the two rules meeting.
        out.push('  (a [complete] token above is the leash\'s reading of the Status row, under which'
            + ' trailing text after Complete still finishes a plan; the queue position above reads the'
            + ' frozen plan-doc contract instead, under which it does not, so an entry can be complete'
            + ' to the leash and current to this report)');
    }

    if (state.history.length > 0) {
        out.push('finished:');
        // The five most recent outcomes, newest last, with the rest as a
        // count: the same bound as the queue above and for the same reason.
        const omitted = state.history.length - 5;
        if (omitted > 0) out.push('  ... ' + omitted + ' earlier omitted');
        for (const entry of state.history.slice(-5)) {
            out.push('  ' + sanitize(entry.plan) + ' ' + sanitize(entry.outcome) + ' at ' + sanitize(entry.at)
                + (entry.note ? ': ' + sanitize(entry.note) : ''));
        }
    }

    process.stdout.write(out.join('\n') + '\n');
    process.exitCode = 0;
}

// The /kit-goal skill documents these as clear aliases (matching native
// /goal); honoring them in the CLI too means a direct alias call is not a
// silent usage error.
const CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel']);

function main() {
    const [cmd, ...args] = process.argv.slice(2);
    // --append and --self-armed are read wherever they sit among the plan paths and
    // removed from them, so an operator typing one after the paths gets the flag
    // rather than an arm over a plan doc named --append, which no repository
    // has. Any other leading-dash token is refused before it can reach armGoal
    // as a plan argument, rather than misread as a plan path that is merely
    // missing.
    if (cmd === 'arm') {
        const flags = new Set(['--append', '--self-armed']);
        const badFlag = args.find((a) => a.startsWith('-') && !flags.has(a));
        if (badFlag) usageBadArmFlag(badFlag);
        else cmdArm(args.filter((a) => !flags.has(a)), args.includes('--append'), args.includes('--self-armed'));
    }
    else if (CLEAR_ALIASES.has(cmd)) cmdClear();
    else if (cmd === 'status') cmdStatus();
    else usage();
}

// Wrapped so an unexpected defect prints one sanitized line and a nonzero
// exit instead of a stack trace: this CLI's output is echoed into a session's
// context by the /kit-goal skill invocation, and a stack dump is noise there.
// The library load is INSIDE the region because a require is the throw most
// likely to produce that trace, a damaged plugin cache being its ordinary cause.
try {
    loadKitLibraries();
    main();
} catch (err) {
    // A throw during the load leaves the renderer unbound, and it stays unbound
    // whichever library refused: the renderer lives in kit-compact-lib.js,
    // which requires kit-goal-lib.js itself, so a load that failed at either
    // cannot be recovered by requiring the renderer alone. Nothing here can then
    // take the OS account name out of the error text, whose module path and
    // `Require stack:` lines are home-anchored on an installed plugin, so that
    // reading names the failure and withholds the text. The error's CODE still
    // rides, since a Node error code is an upper-case identifier
    // (MODULE_NOT_FOUND, ERR_DLOPEN_FAILED) that names the failure's kind and
    // can carry no path; anything else in that field is dropped. It rides the
    // withheld leg alone, since a message that survived sanitize already opens
    // with its own code where it has one (ENOENT: no such file ...).
    const code = err && typeof err.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.code)
        ? ' (' + err.code + ')' : '';
    process.stderr.write('kit-goal: ' + (sanitize === undefined
        ? 'a kit library could not be loaded' + code + ', and the renderer that takes the OS'
            + ' account name out of an error is in it, so the message itself is withheld'
        : sanitize(err && err.message ? err.message : String(err))) + '\n');
    process.exitCode = 1;
}
