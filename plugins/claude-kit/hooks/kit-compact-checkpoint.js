#!/usr/bin/env node
// CLI entry for the boundary-compaction checkpoint and the release markers.
//
// Subcommands:
//   kit-compact-checkpoint.js open      open a checkpoint for the armed plan
//   kit-compact-checkpoint.js clear     remove any open checkpoint
//   kit-compact-checkpoint.js status    report the checkpoint, the release
//                                       markers, the gate state, and any
//                                       hold stamps refusing the deferral nudge
//   kit-compact-checkpoint.js boundary [--cancel]
//                                       open the role-boundary marker for the
//                                       calling session (no goal required), or
//                                       retract the one it opened
//   kit-compact-checkpoint.js consent [--session <id>] [--project <path>]
//                                       record the operator's release for the
//                                       caller's session, or the named one, in
//                                       the caller's directory or a named one
//
// `open` is invoked by the executing-work chapter-close ritual after a
// Chapter is appended and the section's commit model has been honored. An
// open checkpoint tells the PreCompact gate (kit-compact-gate.js) that a
// chapter boundary has been reached: the gate allows the next auto-compaction
// attempt and consumes the checkpoint, so each open lands exactly one
// compaction. Opening requires an armed kit goal, because the checkpoint
// records the armed plan path and the gate treats a checkpoint naming any
// other plan as absent: with no goal armed there is nothing the file could
// ever match, so the open refuses rather than writing a dead checkpoint.
//
// `open` and `clear` are scoped to the session the checkpoint blesses, which on
// a checkout several sessions share is what keeps one seat out of another's
// compaction timing. The blessed session is the leash holder where the goal is
// bound and the record is one that holder could spend; the caller itself where
// the goal is armed, unbound, and the caller is the session that armed it, which
// is the other route a claim point binds on, so the session about to hold the
// leash is never held off by a boundary a bystander banked in that window; and
// otherwise the session the record on disk names as its opener. Each verb
// refuses on its own terms. `clear` refuses every caller that is not that
// session, and removes nothing, so a boundary another seat declared stands.
// `open` reads the binding itself and refuses every caller that is not the leash
// holder while the goal is bound, whatever is on disk; while it is unbound it
// refuses only where a record for this plan already names another opener, since
// an unbound goal blesses nobody yet and a run banking a boundary before its
// leash reaches it is the case that permission exists for.
//
// Nobody's boundary is the state where nothing at the checkpoint path can ever
// land a compaction, and any caller may clear or replace it. Which readings and
// which record shapes come to that state is one enumeration, and it lives at
// blessedCheckpointSession below, which is the rule the two write verbs, `open`
// and `clear`, read the answer from: a file the gate could never spend for
// anybody is nobody's boundary however the goal is bound.
//
// All of that reads the goal state, so a goal state that is present and cannot
// be read leaves the question unasked rather than answered: whether any session
// holds the leash is exactly what could not be read. Both verbs refuse over one
// and touch nothing, the readings being the goal library's own kinds, each of
// which UNREADABLE_GOAL_PHRASES below words for a reader.
// Two readings are read as no goal armed and no others: a settled-absent goal
// state, and a state file the reader could read that names no plan and no bound
// session. Every other present state, an array or a shape carrying a binding
// beside no usable plan among them, is the unreadable reading. A `clear` over an
// absent checkpoint path is the exit-0 no-op before any of this, since it removes
// nothing from anybody.
//
// `open` refuses a caller whose own session id cannot be resolved, the id being
// what would scope the record it writes. `clear` refuses one only over a record
// it is guarding: a clear over nothing, or over a record that is nobody's
// boundary, needs no caller id, and the clear over nothing is the no-op the
// chapter-close ritual runs before it knows whether a boundary is open. Both
// verbs refuse over a checkpoint path they cannot read at all, a scope guard
// being able to protect only a scope it can see, and the two readings there
// differ in whom they refuse. Something that is not a regular file at that path
// refuses every caller, the leash holder included: it never becomes a
// checkpoint and a clear removes nothing from it, so attributing it to a
// binding would answer the one caller who could act with a cleared-nothing
// success line and everybody else with a boundary that is not there. A read the
// filesystem refused or an lstat that could not answer refuses only where the
// record is the thing that would answer the question, the binding answering
// over one instead, since a lock lifts and the record beneath it may be the
// leash holder's own. A goalless seat's own boundary is the `boundary` verb.
//
// The record carries its opener and the gate honors it only for the session it
// names, which is the read-side half of the same rule and what catches a record
// an older kit wrote or a hand edit made.
//
// Neither half is a boundary against a determined writer, and the design does
// not claim one: the id is self-reported environment, nothing about the record
// is secret, and the granularity is the harness session, so a subagent
// dispatched by the leash holder reports that session's id and passes as it.
// What the check prevents is the accident it was built for, a seat following its
// own instructions writing into another seat's compaction timing.
//
// `boundary` is the goalless seats' analogue of `open`: it opens the
// role-boundary marker for a role session (coordinator, expert, admin) at its
// own banked-and-empty moment, scoped by session rather than by plan, so no
// armed goal is required and the no-goal refusal stays the leashed mode's
// alone. The ordinary writer of that marker is the seat-stop.js Stop hook,
// which opens it at a turn end off the seat's own registry status push; this
// subcommand writes the same file the hook does, and it serves the two seats
// the hook cannot: one the machine's session registry does not carry, and a
// registered one whose project tree holds work it does not own, which the
// hook's clean-tree test refuses. Where the caller does have a registry entry,
// the run stamps that entry's `Banked:` line, a record of the declaration
// rather than a precondition for it: an absent directory or entry is a silent
// no-op and the marker opens either way. What this verb writes is stamped as a
// declaration, and that field is what puts it under the gate's moment rule,
// where the hook's turn-end marker stands on its age bound alone.
// `boundary --cancel` retracts this session's own marker; nothing depends on it
// being run, since the gate stops honoring a declared marker the moment a new
// turn begins in the session it names.
// `consent`
// writes the operator-release marker; the rule for WHEN it may be run (only
// on the operator's explicit word over a warranted channel, never on the
// session's own judgment) is the role skills' prose, while this CLI bounds
// only what one run of it can do: one session, one release, one age window.
// Its `--project` names the directory the marker is written at, for the
// ordinary case of an operator releasing a session that is not the one their
// shell stands in; a named project the session left no transcript under is
// refused, since a marker written there would be read by nobody.
// Both markers are consumed by the gate on the allow they cause, single-shot.
//
// All filesystem work is delegated to kit-compact-lib.js; this file is only
// argument parsing and output formatting, matching kit-goal.js.

'use strict';

const os = require('os');
const path = require('path');
// The kit libraries this CLI is written against, bound here and LOADED inside
// the guarded region at the foot of this file rather than required at module
// scope. A require that throws (a damaged or partially written plugin cache)
// throws before any guard this file installs, and what Node prints for it is its
// own trace, whose `Require stack:` lines carry the absolute module path of
// every file on that stack, home-anchored on an installed plugin. Loading them
// inside the try is what puts that failure back on this file's own channel. The
// sibling hook compact-deferral-nudge.js defers its kit requires into the guards
// that use them for the same failure mode.
let readGoal, sessionHoldsLeash, goalPathKind;
let readCheckpointResult, writeCheckpoint, clearCheckpoint, checkpointMatches,
    checkpointAdoptable, storableCheckpointOwner,
    readGateStateResult, gateStatePath, gateEpisodeOpen, pendingOfferCorroborated, checkpointOwner,
    readHoldNudgesResult, holdNudgePath, HOLD_NUDGE_HEALABLE,
    episodePhrase, wholeMinutesSince, gateCount,
    CHECKPOINT_MAX_AGE_MS, CHECKPOINT_PENDING_MAX_AGE_MS,
    readRoleBoundaryResult, roleBoundarySessionsResult, readConsentResult,
    writeRoleBoundary, writeConsent, clearRoleBoundary, sameSessionId,
    markerMatches, markerMomentHolds, markerDeclaresMoment, stampRegistryBanked,
    projectHoldsSessionTranscript, sessionTranscriptPath, usableSessionId,
    ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS;

// The age bounds as an operator reads them, derived from the constants rather
// than written out so a sentence here cannot drift from the rule it describes.
// The rounding is exact only while the constants stay whole minutes and whole
// hours respectively: a 90-minute pending bound would print as "2 hours" against
// a rule enforcing one and a half, so a change to either constant that leaves
// whole units is what keeps these honest. The two marker bounds both render in
// hours because both are the same quantity: rendering one of them in minutes
// would print two different-looking figures for one window in a single `status`
// report, which reads as two rules rather than one. They are derived with the
// libraries loaded rather than at module scope, the constants arriving with
// them.
let ORDINARY_MINUTES, PENDING_HOURS, BOUNDARY_HOURS, CONSENT_HOURS;

function loadKitLibraries() {
    ({ readGoal, sessionHoldsLeash, goalPathKind } = require('./kit-goal-lib.js'));
    ({
        readCheckpointResult, writeCheckpoint, clearCheckpoint, checkpointMatches,
        checkpointAdoptable, storableCheckpointOwner,
        readGateStateResult, gateStatePath, gateEpisodeOpen, pendingOfferCorroborated, checkpointOwner,
        readHoldNudgesResult, holdNudgePath, HOLD_NUDGE_HEALABLE,
        episodePhrase, wholeMinutesSince, gateCount,
        CHECKPOINT_MAX_AGE_MS, CHECKPOINT_PENDING_MAX_AGE_MS,
        readRoleBoundaryResult, roleBoundarySessionsResult, readConsentResult,
        writeRoleBoundary, writeConsent, clearRoleBoundary, sameSessionId,
        markerMatches, markerMomentHolds, markerDeclaresMoment, stampRegistryBanked,
        projectHoldsSessionTranscript, sessionTranscriptPath, usableSessionId,
        ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS
    } = require('./kit-compact-lib.js'));
    ORDINARY_MINUTES = Math.round(CHECKPOINT_MAX_AGE_MS / (60 * 1000));
    PENDING_HOURS = Math.round(CHECKPOINT_PENDING_MAX_AGE_MS / (60 * 60 * 1000));
    BOUNDARY_HOURS = Math.round(ROLE_BOUNDARY_MAX_AGE_MS / (60 * 60 * 1000));
    CONSENT_HOURS = Math.round(CONSENT_MAX_AGE_MS / (60 * 60 * 1000));
}

// What the gate's state says about this goal's binding, as the three facts the
// report and the open need. Read once per call, so a single call cannot
// contradict itself.
//
//   readable  the state file could be read at all. A file locked by a scanner
//             is not an absent one, and every surface here takes the
//             conservative bound either way, but only an answered question may
//             be printed as an answer.
//   held      a deferral episode owned by this binding is open now. This is
//             what `open` records, because a record written now cannot predate
//             a hold that is already standing.
//   state     the state itself, for the corroboration test the match rule
//             needs, which additionally requires the episode to predate the
//             record on disk (pendingOfferCorroborated owns that whole rule).
//
// The owner is the leash holder, because that is whose offers the gate holds:
// the goal's binding where it has one (checkpointOwner, which answers with an
// explicit null rather than undefined, for the reason stated there), and
// otherwise the calling session where it holds the leash by the other route the
// claim points act on. Without that second leg the question is scoped to null
// while a goal is unbound, no episode matches a null id, and a boundary opened
// in that window records no pending offer while the gate is holding this run's
// offers under its own session id: the adopted record then takes the short age
// bound, and a long tool call after the Chapter expires the boundary the flag
// exists to keep alive.
//
// The test is sessionHoldsLeash rather than armingSessionClaims, so this site
// answers "does this session hold the leash" in the one spelling the nudges use
// and cannot drift from them when that rule next changes; it also gates the
// fallback, so a caller that holds no leash scopes the question to nobody
// rather than to itself. Where no id is derivable from the environment at all,
// the predicate answers false and the owner stays null, which is the same
// conservative reading the unbound case had before.
function pendingHold(cwd, goal) {
    const bound = checkpointOwner(goal);
    const caller = callerSessionId();
    const owner = bound !== null ? bound : (sessionHoldsLeash(goal, caller) ? caller : null);
    const result = readGateStateResult(cwd);
    return {
        readable: result.ok,
        held: result.ok && gateEpisodeOpen(result.state, Date.now(), owner) !== null,
        state: result.state,
        owner
    };
}

// The length a repo-controlled string is printed within. One number, so the
// value and the mark that says it was shortened cannot be decided against two.
const PRINT_CAP = 120;

// Repo-controlled strings (a timestamp read back from disk, a session id, a
// verdict word) are sanitized to printable ASCII and length-capped before they
// reach stdout/stderr, matching the sibling hooks' convention for any repo data
// entering a trusted output channel. A value that is a PATH takes displayPath
// below instead.
//
// Both ways of DISCARDING text are marked, because both leave the reader
// looking at something that is not the value. The cap takes the tail off. The
// strip deletes characters from the middle of an accented or CJK name and
// leaves a plausible-looking shorter one, which is the worse of the two on the
// legs that hand the operator a path and tell them to remove that file: a name
// altered without a mark sends them after something that is not on disk. A
// value can take both marks, so the two are decided separately and read
// together. The third alteration, the channel's home elision, shortens a value
// too and carries no mark of its own; scrub below states why it needs none.
//
// Three steps in one order, and the order is what both marks rest on. The strip
// runs first, so the cut is decided on what is actually
// EMITTED rather than on the string before sanitizing: a value carried past the
// cap only by characters the strip removes is not cut at all, and marking it as
// cut would name a truncation that did not happen. The channel's home elision
// runs next, for that same reason and for a second one that is not cosmetic. A
// value carried past the cap only by a home prefix the channel takes out is not
// cut either; and eliding after the cap is eliding a home spelling the cut may
// have taken in half, which no pattern built from the whole spelling can match,
// so the account name reaches the channel in a fragment on exactly the machines
// whose home directory is long. The cap runs last, over the text the reader
// will see.
function printableAscii(s) {
    return String(s).replace(/[^\x20-\x7E]/g, '');
}

function sanitize(s) {
    const raw = String(s);
    const stripped = printableAscii(raw);
    const elided = scrub(stripped);
    const shown = elided.slice(0, PRINT_CAP);
    const marks = [];
    if (stripped.length !== raw.length) marks.push('characters removed');
    if (shown.length < elided.length) marks.push('cut to fit');
    return shown + (marks.length === 0 ? '' : ' [' + marks.join('; ') + ']');
}

// A filesystem path for the operator's eye. The home prefix is elided to `~`,
// because the OS account name is in it and this output is read by a model.
// Eliding is what keeps a realistic path inside the cap, so the cut mark
// sanitize appends is the rare case rather than the ordinary one.
//
// This is the renderer for a value KNOWN to be a path, and it runs beside the
// channel's own floor rather than instead of it: sanitize elides every value it
// is handed and emitOut and emitErr elide whatever text a caller composed, path
// or sentence, and a value elided here passes through both unchanged. The two
// are aimed at different problems. The containment test here is boundary-aware
// and answers on components, so it reaches a spelling the text of the home
// directory does not appear in at all (a path routed through `..`, or one
// differing only in letter case on win32); the elision the channel applies is
// textual, which is what a path embedded in the middle of an error sentence
// allows.
//
// Containment is decided by path.relative rather than by a prefix test on the
// text, because a prefix test is wrong in both directions once the input is not
// home-composed. It over-elides a sibling whose name merely starts with the home
// directory's (home /home/ad, project /home/admin/repo prints as ~min/repo), and
// on win32 it under-elides a path differing from the home directory only in
// letter case, printing the OS account name raw into a channel a model reads.
// path.relative answers on components rather than characters and is
// case-insensitive on win32, which is both directions at once; kitScratchDir in
// the library decides the same question the same way. A relative result that is
// absolute, or that escapes upward, means the path is somewhere else; the empty
// result means the path IS the home directory and elides to `~` alone, which is
// the one reading where the account name would otherwise be the whole output.
//
// A RELATIVE input is never elided, which is what keeps a repo-relative plan
// path printing as itself. path.relative would otherwise resolve it against the
// process's own cwd first, so `docs/plans/x.md` in a checkout under the home
// directory would come back rewritten as an absolute ~-anchored path: a longer,
// stranger rendering of a value that carried no home prefix to elide.
function displayPath(full) {
    const text = String(full);
    let home = '';
    try { home = os.homedir(); } catch { home = ''; }
    let shown = text;
    if (home !== '' && path.isAbsolute(text)) {
        const rel = path.relative(home, text);
        if (!path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel)) {
            shown = rel === '' ? '~' : '~' + path.sep + rel;
        }
    }
    // The marks the sanitize appends are what say the name on the line is not
    // the name on disk, in both directions: a cut tail and a stripped middle.
    return sanitize(shown);
}

// The home directory in the spellings this CLI's output can carry it in, as the
// patterns the channel elides it by, beside an explicit reading of whether a
// home directory is knowable at all.
//
// The two are separated because one empty list would otherwise answer both, and
// they are opposite news for a channel whose floor is this elision. Nothing to
// elide is the floor standing. No knowable home directory is the floor OFF, and
// os.homedir() can throw and follows USERPROFILE and HOME, so a stripped
// environment turns the whole guard off silently: the emitters state that case
// out loud rather than passing values through unmarked.
//
// The flattened spelling is what a transcript path carries: a session's
// transcript is filed under a directory named by the whole project path with
// each non-alphanumeric character turned to a dash (sanitizeProjectPath in
// scripts/memq.js), so for a checkout under the home directory the account name
// sits in the MIDDLE of that path, inside one component, where eliding a
// leading prefix cannot reach it.
//
// A match has to end at a boundary rather than mid-name, which is the bug a raw
// substring replace reproduces: home C:\Users\a against C:\Users\admin\repo
// renders as ~dmin\repo, a path that is nowhere on disk, on legs whose purpose
// is naming a file to act on. Both edges of the literal are therefore DENY-lists
// of the characters that would make the text a different name, never allow-lists
// of the characters that may stand beside it. That direction is what the two
// failure costs decide: over-elision prints a path nowhere on disk, while
// under-elision prints the OS account name into a channel a model reads, and an
// allow-list leaks on every neighbour nobody thought to name, an equals sign, a
// comma, a colon, an angle bracket, a parenthesis. So the trailing edge refuses
// an alphanumeric, a dot, an underscore and a dash, which are the characters
// that would make this another name (<home>-sib and <home>X keep their own
// names), and admits everything else, a separator and a quote and a bracket and
// a comma alike; sanitize's own marks ride on that, since it appends them as
// ` [cut to fit]` and a home directory at the end of a marked value is followed
// by a space and then a bracket.
//
// The leading edge refuses the same characters and a separator besides. Without
// a leading edge at all the match floats: POSIX home /home/admin turns
// /mnt/backup/home/admin/repo/.kit/x.json into /mnt/backup~/repo/.kit/x.json,
// and win32 is not immune by design, only by its home spelling starting with a
// drive letter. Refusing an alphanumeric in front is what kills that case, the
// candidate /home/admin there being preceded by the p of backup; refusing a
// separator additionally refuses a doubled-separator spelling of some other
// path.
//
// In the flattened spelling the separator is a dash and so is the character a
// dash was made from, so a child and a sibling are indistinguishable there and
// any non-alphanumeric character ends the match: where the flattened form cannot
// tell the two apart, eliding is the direction that keeps the account name off
// the channel. It takes no leading boundary at all, deliberately: it rides
// inside one component by construction, which is the whole reason it is elided
// separately from the leading prefix.
//
// Each spelling is built TWICE, from the raw home directory and from its
// printable-ASCII form, because the text this elides has already been stripped:
// sanitize strips before it elides, so on a home directory carrying an accented
// or CJK character the raw spelling is one no emitted line can ever contain, and
// C:\Users\Jose with an accent on the e reaches the channel as C:\Users\Jos.
// Building the same patterns from printableAscii(home) covers the text as it
// will actually be emitted. On an all-ASCII home the two are identical and the
// duplicates are dropped. What that costs is a real sibling directory spelled
// like the stripped home being elided too, which is the flattened spelling's own
// trade taken for the same reason: where the strip has made two names
// indistinguishable, eliding keeps the account name off the channel.
//
// A home directory AT A FILESYSTEM ROOT yields no patterns at all. C:\ reduces
// to C:, which carries an alphanumeric and would otherwise elide the drive
// prefix of every path on this channel, printing `removing ~\proj\.kit\x.json`
// for a file at C:\proj. A root holds no account name, so there is nothing here
// to take out of it. The same refusal covers a spelling the strip SHORTENED by a
// whole component, which the root test alone does not reach: a home whose final
// component is wholly non-ASCII strips to C:\Users\, and a pattern for C:\Users
// elides every account's paths on this channel, other accounts' included, into
// paths that are nowhere on disk. A spelling that names fewer path components
// than the home directory itself is a different directory, so it is skipped.
//
// The literal's separators match either slash, since a path can arrive in
// either spelling, and win32 matches without regard to letter case, as its
// filesystem does.
function homeElisions() {
    let home = '';
    try { home = os.homedir(); } catch { home = ''; }
    home = String(home);
    if (home === '') return { known: false, elisions: [] };
    const root = String(path.parse(home).root).replace(/[\\/]+$/, '');
    const escape = (s) => s.replace(/[^A-Za-z0-9]/g, (ch) => '\\' + ch);
    const flags = process.platform === 'win32' ? 'gi' : 'g';
    const lead = '(?<![A-Za-z0-9\\\\/._-])';
    const trail = '(?![A-Za-z0-9._-])';
    // How many path components a spelling names, which is the measure the guard
    // below compares the stripped spelling against.
    const depth = (s) => s.split(/[\\/]+/).filter((part) => part !== '').length;
    const homeDepth = depth(home.replace(/[\\/]+$/, ''));
    const elisions = [];
    const seen = new Set();
    for (const spelling of [home, printableAscii(home)]) {
        const named = spelling.replace(/[\\/]+$/, '');
        if (!/[A-Za-z0-9]/.test(named) || named === root) continue;
        // A spelling naming fewer components than the home directory is some
        // ancestor of it rather than it, and eliding an ancestor takes every
        // account's paths off the channel rather than this account's name.
        if (depth(named) < homeDepth) continue;
        const literal = Array.from(named)
            .map((ch) => (ch === '\\' || ch === '/' ? '[\\\\/]' : escape(ch)))
            .join('');
        const flattened = escape(named.replace(/[^A-Za-z0-9]/g, '-'));
        for (const [source, shown] of [
            [lead + literal + trail, '~'],
            [flattened + '(?![A-Za-z0-9])', 'flattened-home']
        ]) {
            if (seen.has(source)) continue;
            seen.add(source);
            elisions.push({ pattern: new RegExp(source, flags), shown });
        }
    }
    return { known: true, elisions };
}

// Read once: this is a CLI process whose home directory does not move under it,
// and the patterns are compiled rather than rebuilt per line.
const HOME_ELISIONS = homeElisions();

// A text as the channel prints it, with the home directory's name taken out of
// it in every spelling wherever in the text it sits. Two callers: sanitize,
// which hands it one repo-controlled value before the cap is applied, and the
// two emitters below, which hand it a whole composed line. The value the second
// catches that displayPath cannot is a path the library embedded in an error
// reason: fs errors name the file the syscall was refused on, and a caller
// printing that reason is printing a sentence rather than a path.
//
// The substitution is not marked the way sanitize marks its cut and its strip,
// and it needs no mark: both replacements say for themselves that the text was
// altered and what was taken out. `~` is the operator's own shorthand for the
// home directory, and `flattened-home` is not a spelling any component on disk
// carries, so a reader who needs the real path can put their home directory back
// where the mark is. A cut tail and a stripped middle have no such self-evident
// spelling, which is why those two are marked and this is not.
function scrub(text) {
    let shown = String(text);
    for (const elision of HOME_ELISIONS.elisions) shown = shown.replace(elision.pattern, elision.shown);
    return shown;
}

// Whether this run has already said that its floor is not standing, so the
// sentence is spent once rather than on every line.
let floorStated = false;

// The one-time note that no home directory is knowable here, or the empty string
// where one is. An empty elision list on its own answers two facts, and only one
// of them is news: nothing to elide is ordinary, while no knowable home
// directory means every path on the lines that follow carries whatever the OS
// account name is, with nothing else on this channel saying so. So the uncertain
// reading speaks rather than passing values through unmarked, which is the
// direction a floor has to fail in. It rides whichever descriptor is written to
// first, since both are read by the same reader and the fact is about neither
// one in particular.
function floorNote() {
    if (floorStated || HOME_ELISIONS.known) return '';
    floorStated = true;
    return 'kit-compact-checkpoint: no home directory is knowable in this shell, so nothing'
        + ' below is elided and any path on these lines carries the OS account name as it stands\n';
}

// The two writes this CLI makes to its output descriptors. Each routes its
// argument through the scrub above, so a line composed anywhere in this file
// carries the guard by reaching the channel here rather than by its author
// having remembered it. What keeps a print site from reaching a descriptor
// directly is the source-side pin in test/kit-compact-gate.test.js, which reads
// this file's own text; a sentence here could not.
function emitOut(text) {
    process.stdout.write(floorNote() + scrub(text));
}

function emitErr(text) {
    process.stderr.write(floorNote() + scrub(text));
}

function usage() {
    emitErr('usage: kit-compact-checkpoint.js open | clear | status'
        + ' | boundary [--cancel]'
        + ' | consent [--session <id>] [--project <path>]\n');
    process.exitCode = 1;
}

// The calling session's own id, from the environment the harness sets for a
// session's tool shell, or null when nothing usable is there. The variable is
// an undocumented harness detail that can change or vanish upstream. A
// dispatched subagent's shell carries the dispatching session's id rather than
// one of its own, so a subagent running a scoped verb acts as the seat that
// dispatched it, which is the granularity the file header states this guard has.
// The refusal at the call sites is the designed degradation for the variable
// vanishing: where no id is derivable, this CLI refuses to write a scoped marker
// rather than writing an unscoped one.
function callerSessionId() {
    return usableSessionId(process.env.CLAUDE_CODE_SESSION_ID);
}

function cmdOpen() {
    const goal = readGoal(process.cwd());
    if (!goal || typeof goal.plan !== 'string' || goal.plan === '') {
        // A state file that is there and could not be read is not an absent one,
        // and this refusal is the one place the difference is visible to a caller
        // that has just been told nothing is armed. The reading is the guard's own
        // spelling, so the two verbs answer the same question the same way.
        const unreadable = unreadableGoalKind(process.cwd(), goal);
        if (unreadable !== null) {
            refuseUnreadableGoal(unreadable, 'nothing written');
            return;
        }
        emitErr('kit-compact-checkpoint: no kit goal is armed, so a checkpoint would never match; nothing written\n');
        // The goal family resolves its state from the current directory, and a
        // linked worktree is a directory of its own, so a goal armed in
        // another checkout or another worktree of this repository is invisible
        // here however live it is. Naming that makes the refusal
        // self-explaining, since from such a tree the goal looks armed and
        // this looks like a defect.
        emitErr('kit-compact-checkpoint: the goal may be armed in another checkout: this CLI reads'
            + ' the goal state from the current directory (a linked worktree holds its own), so arm'
            + ' where you run\n');
        process.exitCode = 1;
        return;
    }
    // Who is asking. A checkpoint is one session's declaration that its chapter
    // has closed, and the gate lands that session's next auto-compaction on it,
    // so a caller who is not the session the record would bless is refused here
    // rather than granted its slot: on a checkout several sessions share, an open
    // run by the wrong seat otherwise declares a boundary on the leash holder's
    // behalf and lands a compaction it never blessed, mid-chapter.
    //
    // A bound goal is the leash holder's, and only that session may declare its
    // chapters. That is read off the binding directly and before the record,
    // because it holds whatever is on disk: a stale wrong-plan record is nobody's
    // boundary, so a guard that asked the file first would answer null over one and
    // let a bystander's open through, writing the leash holder's plan and binding
    // with the bystander as its opener, a record every session is refused at
    // wrong-opener, and printing a success line at the caller least able to act on
    // it. An UNBOUND goal blesses nobody yet, so the caller may bank a
    // boundary of its own and becomes the opener: the record is adopted for
    // whichever session claims the leash next, and the gate then holds it to this
    // opener, so a boundary a bystander declared in that window releases nothing.
    //
    // What that permission cannot be is a licence to overwrite: an open here
    // replaces the whole record, so a bystander opening over a boundary somebody
    // else banked would leave the leash claimant a record it cannot spend (the
    // adoption keeps the opener it finds, and the gate then refuses it), which is
    // the deferral-to-the-safety-valve outcome this guard exists to prevent. So
    // while the goal is unbound the record on disk is consulted too: a record for
    // this plan naming another opener refuses, and the caller's own record is
    // replaced like any other. The one caller that outranks such a record is the
    // session that armed the plan, which is about to hold the leash by a route a
    // claim point acts on; blessedCheckpointSession owns that ordering.
    //
    // The authorization read and the write are two syscalls with no lock across
    // them, so two opens racing in the unbound window can both pass this guard
    // and the second one's record is what stands. The residual is cmdClear's
    // own, accepted on the same terms: the cost is one further deferral rather
    // than a lost plan, and no compare-and-swap is built, the comparison and the
    // rename being no more one syscall here than they are there.
    //
    // The record is read before the caller id is judged, which is cmdClear's
    // order too: over one state, a shell with no id standing at a checkpoint path
    // that cannot be read, the two verbs would otherwise report different reasons
    // for the same refusal, and a shared refusal exists to prevent exactly that.
    const caller = callerSessionId();
    const blessed = blessedCheckpointSession(process.cwd(), goal, caller);
    if (!blessed.ok) {
        refuseUnansweredScope(blessed, 'nothing written');
        return;
    }
    // An unresolvable id refuses, for the reason cmdBoundary's own refusal
    // states: the id is what scopes the record, and a record scoped to nobody is
    // one the gate can never honor, so writing it would be writing a dead
    // checkpoint. The remedy named is the operator's rather than the session's,
    // and the bound rides on the same line as the pointer: consent lands a
    // compaction for a session named by id, which is what an operator standing in
    // a bare shell wants, and it is a verb a session never runs on its own
    // judgment. This channel is one a session reads, so the line names the verb
    // and who runs it rather than handing over a runnable command form.
    if (caller === null) {
        emitErr('kit-compact-checkpoint: no usable session id in this shell'
            + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped), so whose chapter boundary'
            + ' this would be cannot be established; nothing written\n');
        emitErr('kit-compact-checkpoint: releasing a held session by id is the operator\'s own verb,'
            + ' consent, which a session never runs on its own judgment: an operator standing in a'
            + ' shell of their own runs it and names the session it acts for\n');
        process.exitCode = 1;
        return;
    }
    // The binding, whatever is on disk. Two remedies, each with the hold it
    // answers named beside it, since the caller's own hold and the leash holder's
    // are different questions. This checkpoint releases the leash holder's
    // deferral, so there is nothing here for this caller to declare. A caller that
    // is itself being held has its own boundary to bank, and the `boundary` verb
    // is where it declares one: that marker is scoped by session, so it releases
    // the hold on the caller alone and reaches this checkpoint not at all, and it
    // is declared at the caller's own banked moment rather than on the strength of
    // this refusal.
    const bound = checkpointOwner(goal);
    if (bound !== null && !sameSessionId(bound, caller)) {
        emitErr('kit-compact-checkpoint: this project\'s kit goal is leashed to another session,'
            + ' so this checkpoint would be that session\'s chapter boundary and would land its'
            + ' next auto-compaction; it is not this session\'s to declare; nothing written\n');
        emitErr('kit-compact-checkpoint: the deferral a boundary here releases is that session\'s,'
            + ' so there is nothing here for this session to declare; ' + BOUNDARY_VERB_REMEDY
            + '\n');
        emitErr('kit-compact-checkpoint: a run resumed under a new session id, whose bound'
            + ' predecessor is its own earlier session and is gone, may ' + REARM_REMEDY + '\n');
        process.exitCode = 1;
        return;
    }
    // What is left is the record leg, the binding having answered above and the
    // arming leg only ever granting. The remedy is that leg's own too: this caller
    // is waiting for a claim of its own, and an open replaces the record once that
    // claim binds the leash, so nothing has to be moved by hand.
    if (blessed.session !== null && !sameSessionId(blessed.session, caller)) {
        emitErr('kit-compact-checkpoint: a chapter boundary another session declared for this'
            + ' plan is already open here, and opening over it would leave that session a'
            + ' boundary the gate refuses; it is not this session\'s to replace; nothing'
            + ' written\n');
        emitErr('kit-compact-checkpoint: once this session claims the leash, at its next stop or'
            + ' auto-compaction offer, an open here replaces that record with its own\n');
        process.exitCode = 1;
        return;
    }
    // The checkpoint records the goal's current boundSession alongside the
    // plan: the gate requires both to match, so a checkpoint orphaned by a
    // crash cannot open the gate for the re-bound session that resumes the
    // plan. An unbound goal writes null, which no session's binding equals;
    // the record gains its owner when a claim point binds one and adopts the
    // ownerless record (adoptCheckpoint in the lib), which is how a run that
    // armed a plan for itself keeps the boundary it declared before its leash
    // reached it. The open therefore succeeds while unbound rather than
    // refusing: the binding is claimed at a stop or at an auto-compaction
    // offer, either of which may simply not have happened yet.
    // Whether an auto-compaction offer is already being held is recorded in the
    // checkpoint, because it is one of the two facts that decide which age
    // bound the gate holds it to (see CHECKPOINT_MAX_AGE_MS in the lib; the
    // other is corroboration at the moment the gate decides). The gate's own
    // decision state is where the fact lives: an open deferral episode is a
    // recorded deny with no allow after it, and past the trigger the harness
    // re-offers every assistant turn, so the offers recur until one is allowed.
    // The opener is passed as its own subject, which the writer requires of every
    // caller: the owner cannot stand in for it here, since an open against an
    // unbound goal records no owner and this caller as its opener.
    const hold = pendingHold(process.cwd(), goal);
    const result = writeCheckpoint(process.cwd(), goal.plan, goal.boundSession, hold.held, caller);
    if (result.ok) {
        // File-derived values print indented, never at column zero, keeping
        // sanitized untrusted data visually subordinate in a channel a model
        // reads. Which of the two checkpoints was opened is stated, because the
        // two behave differently for the rest of their lives: one waits for an
        // offer that is already pending, the other ages out in minutes. Both
        // durations come from the constants, so neither sentence can promise
        // what the rule does not do.
        // The plan is a path, so it takes the path renderer rather than the
        // plain sanitize: this one is repo-relative by construction (the goal
        // library's normalizer refuses anything else), so nothing is elided here
        // and the value prints as itself, but reportCheckpoint prints the same
        // field back out of a user-writable file, where it is whatever a hand
        // edit made it.
        //
        // The unbound line states the condition the record carries rather than an
        // unconditional landing. A record opened while the goal is unbound is
        // adopted for whichever session claims the leash next and then held to its
        // opener, so it releases a compaction only for the caller that opened it,
        // and telling any caller here that the next auto-compaction lands on it
        // would be the same false promise the gate's own release notes withdrew.
        // The held-offer sentence is about which age bound the record takes, which
        // is the same question either way, so its wording holds whether the goal is
        // bound or not; what it gains while unbound is the condition above, since
        // the record it describes is honored on exactly the same terms.
        emitOut('  compact checkpoint open for ' + displayPath(result.plan)
            + (hold.held
                ? ' (the compaction gate is holding offers, so this waits for the next one rather than'
                    + ' aging out in ' + ORDINARY_MINUTES + ' minutes: for as long as the gate keeps'
                    + ' deferring, and never past ' + PENDING_HOURS + ' hours'
                    // The record's condition is the same question either way, so
                    // an unbound open states it here too: the age bound is what
                    // this branch is about, and without the clause a caller reads
                    // a wait for an offer as a promise that the offer lands here.
                    + (bound === null
                        ? '; honored once the leash binds this session, and a claim by another session'
                            + ' leaves it refused'
                        : '')
                    + ')'
                : (bound === null
                    ? ' (honored once the leash binds this session, at its next stop or held offer;'
                        + ' a claim by another session leaves it refused)'
                    : ' (the next auto-compaction lands here)'))
            + '\n');
        // A state file that could not be read is not an absent one, and the
        // bound taken above is the conservative one either way. Saying so is
        // what keeps the confident sentence above from being the whole story:
        // an operator who expected a held offer learns the question went
        // unanswered rather than being told there was no hold.
        if (!hold.readable) {
            emitOut('the compaction gate state could not be read, so this checkpoint records no'
                + ' pending offer and keeps the ' + ORDINARY_MINUTES + '-minute bound\n');
        }
        process.exitCode = 0;
    } else {
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
    }
}

// Open the role-boundary marker for the calling session: the goalless seats'
// analogue of `open`. The marker is scoped by session rather than by plan, so
// no armed goal is required and the no-goal refusal above stays the leashed
// mode's alone. The refusal here is loud and names the variable, because the
// alternative, an unscoped marker whichever session's offer arrived first
// would consume, is the one shape the design forbids.
//
// The scope is the file itself: the marker's name carries the session id, so
// several seats held in one checkout each declare into their own file and this
// write can replace nothing but this session's own previous declaration.
function cmdBoundary(rest) {
    // The parse is strict for the same reason cmdConsent's is: `boundary
    // --session <id>` is the natural misreading of the consent form, and a
    // parser that ignored the tail would do two wrong things at once, denying
    // the named session its release and handing the ambient session one it
    // never asked for. Exactly one argument form is accepted, --cancel, and
    // it takes no value: the boundary marker is the calling session's own
    // declaration, whether it is being made or retracted.
    const cancel = rest.length === 1 && rest[0] === '--cancel';
    if (rest.length !== 0 && !cancel) {
        emitErr('usage: kit-compact-checkpoint.js boundary [--cancel] (no other arguments:'
            + ' the marker is scoped to the calling session; consent is the mode that takes'
            + ' --session)\n');
        process.exitCode = 1;
        return;
    }
    const session = callerSessionId();
    if (session === null) {
        emitErr('kit-compact-checkpoint: no usable session id in this shell'
            + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped), so a session-scoped'
            + ' marker cannot be ' + (cancel ? 'retracted' : 'written') + '; nothing written\n');
        process.exitCode = 1;
        return;
    }
    if (cancel) {
        cancelBoundary(session);
        return;
    }
    // Written as a declaration, which is the field the gate's moment rule is
    // scoped by: this verb is a seat's deliberate word about one instant, where
    // the seat-stop hook's turn-end marker is a standing window it rewrites
    // every turn. The tool writes the field; nothing asks a model to.
    const result = writeRoleBoundary(process.cwd(), session, true);
    if (result.ok) {
        // The registry record of the declaration, best-effort and after the
        // marker: a seat the registry does not carry declares exactly as well
        // as one it does, so an absent directory or entry is a silent no-op
        // and nothing about the marker turns on it.
        //
        // One refusal is not silent. An entry that exists at this session's own
        // path while naming a different session is a state nobody should meet
        // by accident: either the id this shell carries is not this session's,
        // or a peer's entry is sitting at it, and both are worth a word to the
        // operator. The declaration still stands, so this is a note on stderr
        // rather than a failure, and it names neither the entry's session nor
        // its path, since the point is that neither is this caller's.
        const stamp = stampRegistryBanked(session);
        if (!stamp.stamped && stamp.reason === 'the entry at that path names a different session') {
            emitErr('kit-compact-checkpoint: the registry entry for this session id names a'
                + ' different session, so it is not this session\'s to stamp and was left untouched;'
                + ' the boundary itself is declared\n');
        }
        // Environment-derived values print indented and sanitized, the same
        // handling cmdOpen gives the plan path; the duration comes from the
        // constant, so the sentence cannot promise what the rule does not do.
        // The moment clause is stated beside the age bound because the two
        // bound the marker together, and the shorter one is the one a seat
        // will meet: the gate stops honoring this marker the moment a new turn
        // begins in this session.
        emitOut('  role-boundary marker open for session ' + sanitize(session)
            + ' (that session\'s next deferred auto-compaction lands at this boundary,'
            + ' until a new turn begins there; it ages out in ' + BOUNDARY_HOURS + ' hours)\n');
        // A declaration the gate cannot position is one it will never honor, so
        // it is said here rather than left to look like a marker that works.
        // The ordinary cause is a run from a directory this session's own
        // transcript is not filed under, which is the same working-directory
        // mistake the marker's own path can make.
        if (result.positioned === false) {
            emitErr('kit-compact-checkpoint: no transcript for this session could be measured'
                + ' from this directory, so the gate has nothing to read the moment against and will'
                + ' treat this marker as lapsed; run the verb from the session\'s own project directory\n');
        }
        process.exitCode = 0;
    } else {
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
    }
}

// Retract this session's own declaration, at this session's own file: a peer's
// declaration lives at a name this verb never composes, so nothing here can
// reach one. What the file at this session's name holds is still read before
// anything is removed, since the name is composed from an environment variable
// nothing authenticates and whatever sits there may be a peer's: a record naming
// another session is left standing, exactly as the gate leaves one it does not
// match. Nothing in the design depends on this being run, the moment rule above
// retiring a marker that outlived its lull with no act from anyone; this is the
// explicit retraction, for an operator at a shell and for a session withdrawing
// a declaration it has just made.
//
// A marker whose owner cannot be read is not removed either, and it is the
// leg worth stating: an illegible or oversized file reads as no marker at all,
// so a clear that ran on it would delete whatever was written there and
// report it as this session's own retraction. The scope guard can only protect
// a scope it can see, so where it cannot see one the answer is to leave the
// file alone and say what is there.
function cancelBoundary(session) {
    const read = readRoleBoundaryResult(process.cwd(), session);
    const marker = read.marker;
    if (read.reason === 'no-session') {
        // No file name composes from this id, so nothing was read and no file is
        // being asserted to exist: the refusal names the id rather than a marker
        // that cannot be read, which is the opposite fact. The caller charset-
        // gates before it reaches here, so this is the floor rather than the
        // path an operator meets.
        emitErr('kit-compact-checkpoint: this session id is not one a marker file name'
            + ' composes from, so no declaration of its own can be open here'
            + ' (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (marker === null && read.reason !== 'absent') {
        emitErr('kit-compact-checkpoint: a role-boundary marker file is present here that'
            + ' cannot be read (' + sanitize(read.reason) + '), so whose declaration it is cannot be'
            + ' established and it is left in place; move it aside by hand (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (marker !== null && typeof marker.session !== 'string') {
        emitErr('kit-compact-checkpoint: the role-boundary marker file here names no session,'
            + ' so whose declaration it is cannot be established and it is left in place; the next'
            + ' boundary write replaces it (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (marker && typeof marker.session === 'string' && !sameSessionId(marker.session, session)) {
        emitOut('  a role-boundary marker for session ' + sanitize(marker.session)
            + ' is open here and is left in place: this session declared no boundary to retract\n');
        process.exitCode = 0;
        return;
    }
    const result = clearRoleBoundary(process.cwd(), session);
    if (!result.ok) {
        // Nothing was removed, so this must not read as a successful retraction,
        // and what is left behind is not asserted: cmdClear's own wording at the
        // same leg of the same question.
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason)
            + ' (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    emitOut((result.cleared
        ? 'role-boundary marker retracted'
        : 'no role-boundary marker was open') + '\n');
    process.exitCode = 0;
}

// Record the operator's release for the caller's session, or an explicitly
// named one. The rule for WHEN this may be run is the role skills' prose (the
// operator's explicit word over a warranted channel, never the session's own
// judgment); what this parser owns is the strictness of the write: --session
// demands exactly one value, and a value is never taken from anything
// dash-led (usableSessionId's leading-character rule), so a missing value
// cannot swallow the next flag and be recorded as a session name.
function cmdConsent(rest) {
    const flags = { '--session': null, '--project': null };
    for (let i = 0; i < rest.length; i += 2) {
        if (!Object.prototype.hasOwnProperty.call(flags, rest[i])
            || flags[rest[i]] !== null || i + 1 >= rest.length) {
            emitErr('usage: kit-compact-checkpoint.js consent'
                + ' [--session <id>] [--project <path>]'
                + ' (each flag at most once, each with one value)\n');
            process.exitCode = 1;
            return;
        }
        flags[rest[i]] = rest[i + 1];
    }

    let session;
    if (flags['--session'] === null) {
        session = callerSessionId();
        if (session === null) {
            emitErr('kit-compact-checkpoint: no usable session id in this shell'
                + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped); name one with'
                + ' --session <id>; nothing written\n');
            process.exitCode = 1;
            return;
        }
    } else {
        session = usableSessionId(flags['--session']);
        if (session === null) {
            emitErr('kit-compact-checkpoint: --session needs one value that starts'
                + ' with a letter or digit and uses only letters, digits, dot, underscore or'
                + ' hyphen; nothing written\n');
            process.exitCode = 1;
            return;
        }
    }

    // Without --project the marker lands where the caller stands, which is the
    // operator's own session's project and needs no corroboration. With it the
    // target directory is a value the caller supplied, so it is corroborated
    // before anything is written: the named session must have a transcript
    // filed under that project. A marker written anywhere else is inert and
    // says nothing about it, which is the failure this flag exists to end, so
    // the miss is an error here rather than a successful-looking write.
    const target = flags['--project'] === null ? process.cwd() : flags['--project'];
    if (flags['--project'] !== null && !projectHoldsSessionTranscript(target, session)) {
        emitErr('kit-compact-checkpoint: no transcript for session '
            + sanitize(session) + ' under the project at ' + displayPath(target)
            + ', so a marker written there would never be read; check the path and the'
            + ' session id; nothing written\n');
        process.exitCode = 1;
        return;
    }
    const result = writeConsent(target, session);
    if (result.ok) {
        emitOut('  operator-consent marker recorded for session ' + sanitize(session)
            + ' (releases that session\'s next deferred auto-compaction once, within '
            + CONSENT_HOURS + ' hours)\n');
        process.exitCode = 0;
    } else {
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
    }
}

// The readings of the checkpoint path that a binding may answer over: a read the
// filesystem refused, and an lstat that could not answer. Both leave nothing to
// say about what is there and both are transient, a lock lifting to reveal a
// fresh record that belongs to whichever session opened it, so under a binding
// they are attributed to the leash holder, the one caller who may act on such a
// file. This list is what that attribution is keyed on, and a write verb refuses
// over either one where no binding answers.
//
// The third reading a write verb refuses over, something at the path that is not
// a regular file, is not here: it is the opposite news and is attributed to
// nobody, so blessedCheckpointSession answers it for every caller before it
// reaches this list, and a directory or a FIFO at the checkpoint path is one
// refusal for everybody rather than a boundary the leash holder is told it can
// clear.
//
// An illegible file and one past the read cap are deliberately not here. Both
// are regular files whose content the reader has settled: no session's
// compaction can ever land on either, and a clear unlinks them, so refusing over
// one would leave a state `status` says a clear removes with no CLI path out of
// it. They read as nobody's boundary instead, and that reading holds whatever the
// goal is bound to, since a binding cannot make a file no compaction can spend
// into its holder's boundary.
const OPAQUE_CHECKPOINT_READINGS = ['unreadable', 'lstat'];

// The two remedies the bound leg carries, worded once here and emitted by both
// write verbs: cmdOpen's refusal of a caller that is not the leash holder, and
// cmdClear's refusal on its 'goal' leg. Each verb supplies its own lead-in, since
// what the caller was refused differs, and the remedy itself does not: a reader
// comparing the two refusals is reading one sentence, and neither verb can drift
// from the other on what a held session may actually do.
//
// The pointer is for the caller that has a boundary of its own to bank. The
// marker that verb writes is scoped by session, so it releases the hold on that
// caller alone and reaches this checkpoint not at all, and it is declared at the
// caller's own banked moment rather than on the strength of a refusal.
const BOUNDARY_VERB_REMEDY = 'a session with a boundary of its own to bank declares it with the'
    + ' boundary verb, once it has banked its own state at a natural boundary, which releases the'
    + ' hold on that session alone';
// The remedy for the state where the bound session is gone, a run resumed under a
// new session id against a goal still bound to its dead predecessor, and the
// sentences above name nobody who can act. Re-arming rebinds the goal, and two
// bounds ride with it. The whole queue is named, because arming replaces the
// queue rather than adding to it, so a resumed run that re-arms with one plan
// path drops the rest of the queue it was carrying. And the act is the resumed
// run's alone: a peer seat acting on it would take the leash holder's binding and
// replace its queue at the same time. The spelling rides too: an arm a run makes
// for itself carries --self-armed, since a bare arm records the invocation as
// the operator's and writes the operator's parallelization request into the
// goal's condition text (the kit-goal skill owns that flag).
const REARM_REMEDY = 're-arm the goal with its whole queue, which rebinds it: arming replaces the'
    + ' queue rather than adding to it, so a re-arm naming fewer plans drops the rest, the run'
    + ' spells it arm --self-armed since the invocation is its own, and a session'
    + ' that is not that run leaves the goal alone';

// What is at the goal-state path when readGoal did not answer with a goal, or
// null when the state is settled absent. readGoal answers the same way for a
// state file that is absent and for one that is present and could not be read,
// which is the one question it cannot answer (goalPathKind in the goal library
// owns the reading), and every rule in this file about whose boundary a
// checkpoint is derives from the goal: the binding, the arming route, and even
// "no goal is armed, so nothing here can ever be spent". So a non-answer the
// state file could not answer is refused rather than read as absence, in one
// spelling both verbs take.
//
// What counts as an answer is narrower than a non-null object, because the
// normalizer hands its argument back unchanged for every shape whose plan is not
// a non-empty string: a state file holding `0`, `false` or `""` parses and
// readGoal answers with that value, and so do a JSON array and an object carrying
// a binding beside a plan that is not a usable string. A guard reading only for
// null, or only for a non-null object, would take one of those as a state it had
// read and let every no-goal leg treat a file sitting at the path as no goal
// armed: `open` would say nothing is armed over a file still holding the
// binding, and the blessing rule's no-plan leg would answer nobody's boundary
// before the binding was consulted, so a bystander's clear would remove the leash
// holder's live record. Read as a non-answer instead, each of those takes the
// 'file' kind and the refusal that names contents this kit cannot use, which is
// what it is.
//
// So an answer is a non-array object that either carries a usable plan, or
// carries no binding at all. The second half is the ordinary no-goal state: a
// file the reader read that names no plan and no session, which says nothing is
// armed and about which the no-goal legs are true. A shape carrying something at
// boundSession with no usable plan beside it is the case a binding could be lost
// over, and it refuses.
function unreadableGoalKind(cwd, goal) {
    const readable = !!goal && typeof goal === 'object' && !Array.isArray(goal)
        && ((typeof goal.plan === 'string' && goal.plan !== '')
            || goal.boundSession === undefined || goal.boundSession === null);
    if (readable) return null;
    const kind = goalPathKind(cwd);
    return kind === 'absent' ? null : kind;
}

// What each of goalPathKind's readings says in words. The kinds are that rule's
// internal tokens, and 'file' is the one that reads as nothing at all on a
// terminal: it means a regular, sane-sized state file whose contents readGoal
// will not use, which is two shapes rather than one (JSON that does not parse,
// and JSON that parses and the goal library's own state normalizer then
// rejects, a plan path that does not round-trip its normalization being the
// case). So an operator told the state "could not be read (file)" has been
// handed the reason least likely to be understood, and one told its contents do
// not parse has been handed a reason that is false for the second shape. The
// phrase is what prints instead, keyed by the token so a kind added there prints
// as itself under the fallback below rather than silently as one of these.
const UNREADABLE_GOAL_PHRASES = {
    file: 'its contents are not a goal state this kit can use',
    other: 'something that is not a regular file is at the path',
    oversized: 'the file is past the read cap',
    unreadable: 'the filesystem refused the read',
    unresolvable: 'the path cannot resolve to a file'
};

// One reading of the goal state in words, for the two surfaces that print it:
// the write verbs' refusal below and the status report's checkpoint line. The
// map's phrase where the kind has one, and the token itself, gated, where it
// does not; the kind arrives from goalPathKind rather than from a file, so the
// vocabulary is closed either way and the gate covers a kind added there.
function unreadableGoalPhrase(kind) {
    return Object.prototype.hasOwnProperty.call(UNREADABLE_GOAL_PHRASES, kind)
        ? UNREADABLE_GOAL_PHRASES[kind]
        : sanitize(kind);
}

// The refusal both verbs emit over that state, worded off the kind and naming
// what did not happen. Two remedies, because the kinds split two ways and this
// sentence covers both: a lock or a scanner lifts, and a file the reader has
// settled it cannot use needs a hand.
//
// The reading prints as its phrase, through the lookup above.
function refuseUnreadableGoal(kind, whatDidNotHappen) {
    emitErr('kit-compact-checkpoint: the kit goal state is present but could not be read ('
        + unreadableGoalPhrase(kind) + '), so whether any session holds the leash cannot be established; retry'
        + ' once it is readable, or repair the file by hand (' + whatDidNotHappen + ')\n');
    process.exitCode = 1;
}

// Whose chapter boundary a checkpoint here would be, as { ok:true, session,
// from, present } where session is null for nobody's, from names the leg that
// answered ('goal' for the binding, 'arming' for a caller about to hold the
// leash, 'record' for the opener on disk, null for nobody's), and present says
// whether a file is at the checkpoint path at all; or as { ok:false, reason }
// where the question could not be asked. Both write verbs read the answer from
// here, so the two of them cannot drift, and each words its own refusal from the
// leg it names. `caller` is the calling session's own id, or null where none
// resolves.
//
// One read of the record answers both questions, which is what keeps a clear
// from deciding presence and ownership off two reads with a window between them.
//
// The order of the legs is what the rule is. An unreadable goal state answers
// first, since every leg below reads the goal and none of them can be asked over
// one (unreadableGoalKind above). Then something at the path that is not a
// regular file, which is refused for every caller and so is answered before the
// binding has a chance to claim it. Then the two transient readings that leave
// nothing to say, which the binding does answer over, both of them the
// { ok:false } state below. Then the files that gate nothing,
// tested before the binding, since no scope guard has anything to protect over
// one: a settled illegible or oversized file whatever the binding, a legible
// record naming a plan other than the armed one, and a legible record met with no
// goal armed at all, which can never be spent either, `open` refusing outright
// while no goal is armed, so it is always a leftover. Then the binding, because a
// record adopted for the leash holder is that session's to clear whoever
// declared it, which is what lets a run clean up a boundary it cannot spend; the
// binding answers for a legible same-plan record only where the record's own
// opener IS that binding and the owner it carries is that binding or none, since
// the gate refuses another opener at wrong-opener and another owner at
// wrong-session, and a record nothing can spend is nobody's however the goal is
// bound. Then the caller where it holds the leash by the arming route, which
// outranks the record's opener: with the goal armed and unbound, a same-plan
// record a bystander banked would otherwise refuse the very session about to
// bind, on both verbs, leaving it nothing to do but wait for a claim point. That
// leg can only grant, the session it answers with being the caller itself, so
// neither verb's refusal is ever worded from it. And last the record's own
// opener, which is what scopes the question while no leash and no arming session
// answer it; the refusal a true bystander meets there stands.
//
// A null session is nobody's, which is several states coming to the same thing:
// no legible record at all, a record for another plan, a record met with no goal
// armed, a file the reader settled as illegible or oversized, a record carrying
// no opener, which is what an older kit or a hand edit leaves and what the gate
// already treats as absent, a record whose recorded owner is not its own opener,
// which the gate refuses whichever of the two sessions meets it, and a same-plan
// record under a bound goal whose opener, or whose recorded owner, is a session
// other than that binding. None of them is a
// boundary a session could spend, so there is nothing here for a scope guard to
// protect.
//
// { ok:false } is the different state where the question could not be asked.
// Three readings produce it, and they divide over whether a binding may answer
// instead. Something IS at the checkpoint path and the read was refused by the
// filesystem or the lstat could not answer (OPAQUE_CHECKPOINT_READINGS above):
// there the binding answers first, so the one caller who can act on such a file,
// the session it would belong to, is not the one turned away from it, and a
// transient lock over a fresh record is the case that earns it. Something at the
// path is not a regular file: that never becomes a checkpoint, the clear rule in
// the lib refuses to unlink a non-regular file by design, and so no binding makes
// it the leash holder's boundary; it refuses every caller, which is why it is
// answered above the binding rather than beneath it. And the goal state is
// present and could not be read, which leaves every leg here unasked, carried as
// reason 'goal-unreadable' with the kind beside it, and over which there is no
// binding to answer with. All three are an unanswered question rather than
// nobody's boundary, so cancelBoundary's reading of the same question holds here:
// the guard can only protect a scope it can see, and where it cannot see one the
// file is left alone.
function blessedCheckpointSession(cwd, goal, caller) {
    const read = readCheckpointResult(cwd);
    const present = read.reason !== 'absent';
    const nobody = { ok: true, session: null, from: null, present };
    // An absent checkpoint path first, and only then the goal: a clear over
    // nothing removes nothing from anybody, which is the no-op the section loop's
    // step 0 runs, and it stays one whatever the goal state says.
    if (present) {
        const unreadable = unreadableGoalKind(cwd, goal);
        if (unreadable !== null) return { ok: false, reason: 'goal-unreadable', kind: unreadable };
    }
    // Something that is not a regular file, before the binding: the clear rule
    // refuses to unlink one, so a binding that claimed it would answer the leash
    // holder's clear with "no compact checkpoint was open" at exit 0 while the
    // obstruction stayed where it was, and every other caller with a boundary
    // that does not exist. One refusal for everybody instead, on the reading
    // itself.
    if (present && read.reason === 'kind') return { ok: false, reason: 'kind' };
    const bound = checkpointOwner(goal);
    if (present && OPAQUE_CHECKPOINT_READINGS.includes(read.reason)) {
        return bound !== null
            ? { ok: true, session: bound, from: 'goal', present }
            : { ok: false, reason: read.reason };
    }
    const cp = read.cp;
    const legible = !!cp && typeof cp === 'object' && !Array.isArray(cp);
    const plan = (goal && typeof goal.plan === 'string' && goal.plan !== '') ? goal.plan : null;
    // The files nothing can spend, tested before the binding, since attributing
    // one to the leash holder would refuse a bystander tidying a file that gates
    // nothing with a reason that is false for it. A file the reader has settled it
    // cannot use, illegible or past the read cap, is one no compaction can ever
    // land on whatever the goal is bound to; a wrong-plan record and a record met
    // with no armed goal are both absent to the gate.
    if (present && !legible) return nobody;
    if (legible && (plan === null || cp.plan !== plan)) return nobody;
    if (bound !== null) {
        // Under a binding, a legible same-plan record is the bound session's only
        // where that session is both the owner the record carries and its opener.
        // The gate holds the record to both fields, refusing another owner at
        // wrong-session and another opener at wrong-opener, so a record failing
        // either leg is one the leash holder can no more spend than a bystander
        // can: an owner naming some other session is as dead as an opener naming
        // one, and a record carrying no opener at all is dead the same way. An
        // ABSENT owner is the other news, the ownerless boundary a claim adopts for
        // this binding, so it is not tested here. With no file at the path the
        // binding answers on its own, which is the state `open` blesses.
        if (legible) {
            const recorded = storableCheckpointOwner(cp.boundSession).value;
            if (recorded !== null && !sameSessionId(recorded, bound)) return nobody;
            if (!sameSessionId(storableCheckpointOwner(cp.openedBy).value, bound)) return nobody;
        }
        return { ok: true, session: bound, from: 'goal', present };
    }
    if (caller !== null && caller !== undefined && sessionHoldsLeash(goal, caller)) {
        return { ok: true, session: caller, from: 'arming', present };
    }
    if (!legible) return nobody;
    // The opener is what this leg answers with, and what the gate holds a record
    // to, so a record the gate can never honor for anybody is nobody's boundary
    // here however legible it is. A record carrying an owner that is not its own
    // opener is that record: the gate refuses it at wrong-session or at
    // wrong-opener whichever session's offer meets it. The shape occurs, it is not
    // hypothetical: a bystander's open against an unbound goal, a claim adopting
    // the record for the session that binds, and then a re-arm nulling the
    // binding leaves owner and opener two different sessions with no leash to
    // answer for either. Read off the opener alone the record would protect
    // itself against the very session it names as its owner.
    const owner = storableCheckpointOwner(cp.boundSession).value;
    const opener = storableCheckpointOwner(cp.openedBy).value;
    // A record carrying no opener the storage rule can read is nobody's on this
    // leg too, and it is answered as nobody rather than as this leg answering with
    // a null session: `from` names the leg that answered, and nobody's boundary
    // carries no leg, so returning the record leg with a null session would put a
    // shape on the answer that the contract above says cannot occur.
    if (opener === null) return nobody;
    if (owner !== null && !sameSessionId(owner, opener)) return nobody;
    return { ok: true, session: opener, from: 'record', present };
}

// What each of the reader's two transient readings says in words. They are
// readCheckpointResult's own internal tokens, and both read as nothing at all on
// a terminal: an operator told the path "cannot be read right now (lstat)" has
// been handed the name of a syscall rather than a reason. Keyed by the token, so
// a reading added there prints as itself under the fallback below rather than
// silently as one of these.
const UNREADABLE_CHECKPOINT_PHRASES = {
    unreadable: 'the filesystem refused the read',
    lstat: 'the filesystem would not say what is at the path'
};

// The refusal a write verb emits over a checkpoint path whose reading left
// nothing to say, worded for the verb that met it and off the reading itself:
// one sentence naming what is there, that the question could not be answered,
// that the file is untouched, and the remedy that reading actually has. Shared
// because open and clear meet the same path in the same state and a reader
// comparing the two should not be reading two accounts of it.
//
// Two remedies, because the two readings are opposite news. Something that is
// not a checkpoint file never becomes one, so it is moved aside by hand; a
// refused read or an unanswerable lstat may be a lock over a perfectly good
// record, so the remedy is to run the verb again once that lifts. Neither points
// at `status`, which over these readings can only report what is already said
// here.
function refuseUnreadableCheckpoint(reason, whatDidNotHappen) {
    const phrase = Object.prototype.hasOwnProperty.call(UNREADABLE_CHECKPOINT_PHRASES, reason)
        ? UNREADABLE_CHECKPOINT_PHRASES[reason]
        : sanitize(reason);
    emitErr('kit-compact-checkpoint: ' + (reason === 'kind'
        ? 'something that is not a checkpoint file is at the checkpoint path, so whose chapter'
            + ' boundary it is cannot be established and it is left in place; no verb here removes'
            + ' it, so move it aside by hand'
        : 'the checkpoint path cannot be read right now (' + phrase + '), so whose chapter'
            + ' boundary it is cannot be established and it is left in place; try again once whatever'
            + ' holds it lets go')
        + ' (' + whatDidNotHappen + ')\n');
    process.exitCode = 1;
}

// The refusal for a { ok:false } blessing, whichever of the two questions went
// unanswered. One spelling, so the two verbs cannot drift on which reading gets
// which sentence.
function refuseUnansweredScope(blessed, whatDidNotHappen) {
    if (blessed.reason === 'goal-unreadable') refuseUnreadableGoal(blessed.kind, whatDidNotHappen);
    else refuseUnreadableCheckpoint(blessed.reason, whatDidNotHappen);
}

function cmdClear() {
    // The scope guard cmdOpen applies at the same door, for the opposite act: a
    // clear by the wrong seat unmakes a boundary the leash holder legitimately
    // declared, which defers its compaction to the safety valve near the context
    // limit, the worst landing point there is.
    //
    // The record is read before any caller is refused, because a clear with no
    // record on disk removes nothing from anybody: it is the no-op the section
    // loop's own step 0 runs before it knows whether a boundary is open, and a
    // refusal there would fail a run for tidying up. So an absent record falls
    // through to the ordinary no-op below whoever calls, and the refusals below
    // speak only over a record that exists.
    //
    // The authorization read and the unlink are two syscalls with no lock across
    // them, so a boundary another session declares in that window is removed by
    // a clear this guard already approved. The residual is the gate's own,
    // accepted for the same reason (see adoptCheckpoint's verify in the lib): the
    // cost is one further deferral rather than a lost plan, and a
    // compare-and-delete would buy a narrower window rather than none, since the
    // comparison and the unlink cannot be one syscall either.
    const goal = readGoal(process.cwd());
    // The caller is read before the record is judged, because it is one of the
    // things that decides whose boundary the record is: a caller holding the
    // leash by the arming route outranks the opener a bystander left on disk.
    const caller = callerSessionId();
    const blessed = blessedCheckpointSession(process.cwd(), goal, caller);
    if (!blessed.ok) {
        refuseUnansweredScope(blessed, 'nothing was cleared');
        return;
    }
    // A caller with no usable id cannot be held against the record at all, so it
    // is refused rather than trusted, over a record this guard is protecting;
    // cancelBoundary's own reading of the same question is the sibling of this.
    // No pointer at another verb: consent lands a compaction, which is the
    // opposite of what a clear wants, and the boundary verb writes a different
    // file, so the only true remedy is the session the record belongs to running
    // this verb itself.
    const guarded = blessed.present && blessed.session !== null;
    if (guarded && caller === null) {
        emitErr('kit-compact-checkpoint: no usable session id in this shell'
            + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped), so whose chapter boundary is'
            + ' open here cannot be established; the record is left in place, and the session it'
            + ' belongs to can clear it (nothing was cleared)\n');
        process.exitCode = 1;
        return;
    }
    if (guarded && !sameSessionId(blessed.session, caller)) {
        emitErr('kit-compact-checkpoint: the chapter boundary here belongs to another session,'
            // The record leg names the opener and claims nothing about the leash at
            // the moment the boundary was declared: a re-arm from a bare shell nulls
            // the binding and leaves the checkpoint where it is, so a record on this
            // leg may have been declared under a leash that has since gone.
            + (blessed.from === 'goal'
                ? ' the one this project\'s kit goal is leashed to,'
                : ' the one that declared it,')
            + ' so clearing it would defer that session\'s compaction to its safety valve; the record'
            + ' is left in place, and that session'
            + (blessed.from === 'goal' ? '' : ', or whichever session claims the leash next,')
            + ' can clear it'
            + (blessed.from === 'goal'
                ? ', or, where this run is that session\'s own resumption under a new session id,'
                    + ' ' + REARM_REMEDY
                : '')
            + ' (nothing was cleared)\n');
        // Where the binding answered, the caller's own hold has its own remedy, and
        // naming it is what keeps this refusal from reading as a dead end. The
        // record leg gets none, its caller being one whose own boundary is the
        // checkpoint it is about to be able to declare rather than a marker.
        if (blessed.from === 'goal') {
            emitErr('kit-compact-checkpoint: ' + BOUNDARY_VERB_REMEDY + '\n');
        }
        process.exitCode = 1;
        return;
    }
    const result = clearCheckpoint(process.cwd());
    if (!result.ok) {
        // Nothing was removed, so this must not read as a successful clear. What
        // is left behind is not asserted: the lstat leg fires with existence
        // unproven, and while a lock stands every reader treats the path as
        // absent, so the checkpoint is not necessarily open either. This is the
        // goal CLI's own wording at the same leg of the same question.
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + ' (nothing was cleared)\n');
        process.exitCode = 1;
        return;
    }
    emitOut((result.cleared ? 'compact checkpoint cleared' : 'no compact checkpoint was open') + '\n');
    process.exitCode = 0;
}

// Why a checkpoint on disk gates nothing, per checkpointMatches reason code.
// Every message states plainly that the gate treats the file as absent, so a
// reader never mistakes an open-but-dead checkpoint for a live one. The
// 'no-checkpoint' code has no entry because cmdStatus reports that state
// before consulting the rule, and the three codes with more than one story
// behind them are worded by their own producers instead ('expired' by
// expiredReason, 'wrong-session' by unmatchedSessionReason, 'wrong-opener' by
// unmatchedOpenerReason); an unknown future code falls back to the bare
// treats-as-absent clause rather than printing nothing.
//
// The 'no-goal' entry words the settled reading alone, an absent goal state. The
// match rule reports that code over a state file that is present and could not be
// read as well, the goal reading null for both, and the report's own call site
// tells the two apart and words the second one there, so this entry is never
// printed over a file that is sitting at the path.
const ABSENT_REASONS = {
    'no-goal': 'no kit goal is armed, so the gate treats it as absent',
    'wrong-plan': 'does not match the armed goal, so the gate treats it as absent',
    'no-timestamp': 'its opened timestamp is missing or unreadable, so the gate treats it as absent',
    'future': 'its opened timestamp is in the future, so the gate treats it as absent'
};

// Why a record the match rule refused on its session leg gates nothing, which
// is four states rather than one. That rule compares the record's owner against
// the goal's and reports one code whether the record names another session or
// names none at all, and the two are opposite news for an operator: a record
// with no owner is the boundary a run banked before anything held its leash,
// which the next claim adopts rather than discards, so calling it another
// session's would send an operator to clear or re-open the one record that needs
// neither. A record with no owner beside a leash already held is genuinely dead,
// because an adoption rides on a claim and a held leash is claimed.
//
// The fourth is a record with no owner AND no opener, which a claim adopts and
// the gate then refuses on its opener leg, so the sentence over it withdraws the
// promise outright: nothing can say whose boundary it was, and no session's claim
// will ever make the gate honor it.
//
// That leaves the adoptable sentence itself carrying a condition rather than a
// promise, because an adoption supplies the owner and never the opener: a
// boundary a bystander declared while nothing held the leash is adopted like any
// other and then refused on its opener, so the gate honors an adopted record
// only where the session that claimed the leash is the one that opened it. The
// unconditional promise was false over exactly that record, and on this surface a
// false one sends an operator to wait for a boundary that is not coming.
//
// The report stays in step with the gate by asking the gate's own predicates
// rather than a second copy of them: the verdict above is still checkpointMatches',
// and the two questions here are storableCheckpointOwner's (does the record name
// an owner, or an opener, by the rule the writer stores both under) and
// checkpointAdoptable's (would a claim take this record), which is the step the
// claim points run between the match and the next verdict.
function unmatchedSessionReason(cp, goal) {
    if (storableCheckpointOwner(cp.boundSession).value !== null) {
        return 'names a session that does not hold the armed goal\'s leash, so the gate treats it as absent';
    }
    if (checkpointOwner(goal) !== null) {
        return 'records no session while the leash is held, so the gate treats it as absent;'
            + ' a boundary opened now records the binding';
    }
    if (!checkpointAdoptable(cp, goal).ok) {
        return 'records no session and carries no opened timestamp a claim could adopt it by,'
            + ' so the gate treats it as absent';
    }
    // An adoption supplies the owner and never the opener, so a record with no
    // opener is one a claim WILL take and the gate will still ignore. The
    // promise below would be false over it, which on this surface sends an
    // operator to wait for a boundary that is never going to land.
    if (storableCheckpointOwner(cp.openedBy).value === null) {
        return 'records no session and no opening session; the claim that binds one adopts this'
            + ' record and the gate still treats it as absent, having nothing to say whose boundary'
            + ' it was; declare the boundary again rather than waiting on this one';
    }
    return 'records no session, no session holding the leash when it opened; the claim that binds one'
        + ' adopts this record, and the gate honors it from then where the session that claims the'
        + ' leash is the one that opened it, within the age bound it already carries';
}

// Why a record the match rule refused on its OPENER leg gates nothing, which is
// two states rather than one, and they name different remedies. A record with no
// opener at all is one an older kit wrote or a hand edit made: nothing can say
// whose boundary it was, and the fix is to declare the boundary again. A record
// whose opener is some other session is a boundary a bystander declared, which
// the leash holder's claim then adopted; the fix is for the session the goal is
// leashed to to declare its own, since this one gates nothing however fresh it
// is. The opener is read through the same storage rule the writer stores it under
// and the match rule compares it by, so this report cannot call a value an owner
// that the rule reads as none.
function unmatchedOpenerReason(cp) {
    return storableCheckpointOwner(cp.openedBy).value === null
        ? 'records no opening session, so whose boundary it is cannot be established and the gate'
            + ' treats it as absent; declaring the boundary again records one'
        : 'was opened by a session other than the one it belongs to, so the gate treats it as'
            + ' absent; the leashed session declares its own boundary';
}

// Why a record carrying the pending-offer flag was judged by the ordinary bound
// anyway, as a clause. Null when it was not, so a caller says nothing.
//
// Three things send a flagged record to the short bound, and an operator
// debugging a boundary that went unhonored needs to know which. The wording is
// scoped to this session's binding on purpose: the gate-state report two lines
// below answers the unscoped question (is this PROJECT holding offers), and
// without the qualifier the two lines read as a contradiction when a bystander
// is being held and this binding is not.
function shortBoundBecause(cp, hold, corroborated) {
    if (cp.pendingOffer !== true || corroborated) return null;
    if (!hold.readable) {
        return 'the compaction gate state could not be read, so the longer bound could not be confirmed';
    }
    if (hold.held) {
        return 'the hold now standing began after this checkpoint opened, so it does not vouch for it';
    }
    return 'no offer is being held for this session\'s binding, so the longer bound does not apply';
}

// Why an EXPIRED checkpoint expired, which is the one reason code with more
// than one story behind it: three different fixtures print the same word, and
// the one an operator is debugging (a boundary that should have been honored
// and was not) is the middle one. So the sentence names the bound that actually
// applied and, where they differ, why it was not the other. This is the only
// producer of an expired message, so the two spellings cannot drift.
function expiredReason(cp, hold, corroborated) {
    if (corroborated) {
        return 'expired (opened under a pending offer, and past even the ' + PENDING_HOURS
            + '-hour bound for one), so the gate treats it as absent';
    }
    const why = shortBoundBecause(cp, hold, corroborated);
    return 'expired (past the ' + ORDINARY_MINUTES + '-minute checkpoint age bound)'
        + (why === null ? '' : ': ' + why) + ', so the gate treats it as absent';
}

// The checkpoint half of the status report: whether one is open, and why the
// gate would ignore it if it is.
function reportCheckpoint(cwd) {
    const read = readCheckpointResult(cwd);
    const cp = read.cp;
    if (!cp || typeof cp.plan !== 'string') {
        // The read answers with no checkpoint for a genuinely absent file, for
        // one that exists and did not parse, and for three refusals. The gate
        // treats all of them as absent, but an operator does not: each names a
        // different remedy, so status prints the one that works rather than
        // reporting absence over a file that is sitting right there.
        //
        // Which leg it was comes from the reader itself rather than from a second
        // lstat here. An lstat asked afterwards cannot see the 'unreadable' leg
        // at all: it succeeds and reports an ordinary regular file, so the report
        // would call a locked checkpoint illegible and promise a clear that is
        // failing for the same reason the read did.
        const reason = cp === null ? read.reason : 'illegible';
        if (reason === 'illegible') {
            emitOut('an illegible checkpoint file is present (the gate treats it as absent); clear removes it\n');
        } else if (reason === 'oversized') {
            // A regular file, so clear unlinks it, and past the read cap, so it
            // never becomes legible on its own.
            emitOut('a checkpoint file past the size the reader accepts is present '
                + '(the gate treats it as absent); clear removes it\n');
        } else if (reason === 'kind') {
            emitOut('something that is not a checkpoint file is sitting at the checkpoint path '
                + '(the gate treats it as absent); clear cannot remove it, so move it aside by hand\n');
        } else if (reason === 'unreadable' || reason === 'lstat') {
            // Scoped to now: a lock lifts, and a checkpoint the gate ignores this
            // second can be the one it honors the next. Saying none is in effect
            // either way would be the same false absence this report exists to
            // stop printing, and naming a remedy over it would name one that
            // fails for the reason the read already failed.
            emitOut('the checkpoint path cannot be read right now, so the gate treats '
                + 'it as absent while that lasts\n');
        } else {
            emitOut('no compact checkpoint is open\n');
        }
        return;
    }
    // File-derived values print indented, never at column zero (see cmdOpen).
    // A missing openedAt is stated as missing rather than stringified (the
    // literal "undefined" would read as a value the file carries).
    // The plan takes the path renderer rather than the plain sanitize. It is
    // read back out of the checkpoint file with no per-field validation of its
    // own, and that file is user-writable like everything under .kit/, so an
    // absolute value planted there is a home prefix on this line and a long one
    // is a truncation that would read as the whole name of the plan were it not
    // marked. The ordinary value is repo-relative and prints unchanged.
    let line = '  compact checkpoint open for ' + displayPath(cp.plan);
    line += (typeof cp.openedAt === 'string')
        ? ' (opened ' + sanitize(cp.openedAt) + ')'
        : ' (no opened timestamp recorded)';
    // A checkpoint the gate would read as absent is worth flagging here, with
    // the reason: the file exists but gates nothing, which status alone would
    // misreport. The verdict comes from the same checkpointMatches rule the
    // gate itself decides by, and the two refusals that carry more than one
    // story, the session leg and the opener leg, are worded by their own
    // producers off the same predicates the rule uses (unmatchedSessionReason,
    // which asks the adoption's, and unmatchedOpenerReason), so this report
    // cannot drift from the gate's effective answer either.
    const goal = readGoal(cwd);
    const hold = pendingHold(cwd, goal);
    // The same corroboration the gate applies, from the same predicate, so this
    // report cannot describe a checkpoint the gate would judge differently.
    const corroborated = pendingOfferCorroborated(cp, hold.state, Date.now(), hold.owner);
    const verdict = checkpointMatches(cp, goal, Date.now(), corroborated);
    if (!verdict.ok) {
        // Asked once here, whatever the verdict was. unreadableGoalKind answers
        // with a kind only where readGoal did not answer with a usable goal, and
        // with null otherwise, so the legs below read it rather than re-deriving
        // that condition.
        const goalUnreadable = unreadableGoalKind(cwd, goal);
        let why;
        if (verdict.reason === 'expired') why = expiredReason(cp, hold, corroborated);
        else if (verdict.reason === 'wrong-session') why = unmatchedSessionReason(cp, goal);
        else if (verdict.reason === 'wrong-opener') why = unmatchedOpenerReason(cp);
        else if (verdict.reason === 'no-goal' && goalUnreadable !== null) {
            // The match rule takes the goal readGoal answered with, and that null
            // reads the same for a state file that is absent and for one that is
            // present and could not be read, so the no-goal verdict arrives over
            // both. Only the first of them is absence, and the write verbs refuse
            // over the second in the unreadable-state wording, so printing "no kit
            // goal is armed" here would have status contradict them about a file
            // sitting right there. The reading is asked once, off the same rule
            // both verbs ask, and the verdict is worded from it. status still
            // reports rather than refuses: it writes nothing and exits 0 whatever
            // it read.
            why = 'the kit goal state is present but could not be read ('
                + unreadableGoalPhrase(goalUnreadable)
                + '), so whether the gate would honor it cannot be established';
        } else why = ABSENT_REASONS[verdict.reason] || 'the gate treats it as absent';
        line += ' - ' + why;
    } else {
        // A live checkpoint stands on one of two age bounds, and an operator
        // asking why one is still honored an hour in (or why another died in
        // minutes) is asking which. The flag alone does not answer it, so the
        // clause names the bound that actually applies and, for a flagged
        // record on the short one, why.
        const why = shortBoundBecause(cp, hold, corroborated);
        if (corroborated) {
            line += ' - the gate honors it: offers are being held, so it waits for the pending one';
        } else {
            line += ' - the gate honors it, within the ordinary checkpoint age bound'
                + (why === null ? '' : '; ' + why);
        }
    }
    emitOut(line + '\n');
}

// Why a marker on disk gates nothing, per markerMatches reason code, worded
// as ABSENT_REASONS words the checkpoint's: every message states plainly that
// the gate treats the file as absent. The 'no-marker' and 'wrong-session'
// codes have no entry because this report all but never produces them (a
// shapeless file takes the illegible leg below, and the marker is judged
// for the session it itself names). One hand-made shape reaches
// 'wrong-session' anyway: an empty-string session passes the shape guard
// below, being a string, and then compares unequal to itself. That code and
// any unknown future one fall back to the bare treats-as-absent clause
// rather than printing nothing, which is why the fallback is here rather
// than an assertion. 'expired' is built at
// the call site, because it names the bound that applied and the two marker
// kinds carry different bounds.
const MARKER_DEAD_REASONS = {
    'consumed': 'already consumed, so the gate treats it as absent',
    'no-timestamp': 'its written timestamp is missing or unreadable, so the gate treats it as absent',
    'future': 'its written timestamp is in the future, so the gate treats it as absent'
};

// Why a live marker no longer describes the moment it declared, per
// markerMomentHolds reason code. A declaration is about a moment, so a marker
// lapses the instant a new turn begins in the session it names, and every
// question the rule cannot answer lapses it too, which is the direction that
// keeps the gate deferring rather than landing a compaction mid-turn. An
// unknown future code falls back to the bare lapsed clause.
const MARKER_LAPSED_REASONS = {
    'inbound': 'lapsed: a message arrived in that session after it was declared',
    'no-position': 'lapsed: the declaration records no place in that session\'s transcript, so nothing can vouch for the moment',
    'unreadable': 'lapsed: that session\'s transcript cannot be read, so nothing can vouch for the moment',
    'replaced': 'lapsed: that session\'s transcript no longer matches what was there when the boundary was declared',
    'too-long': 'lapsed: that session\'s transcript has grown past what the read covers, so what arrived since is unknown',
    'torn': 'lapsed: a line of that session\'s transcript cannot be read, so what arrived since is unknown'
};

// One marker's line in the status report, mirroring reportCheckpoint's
// legs: the read refusals are told apart by the reader's own reason (a second
// lstat here could not see the 'unreadable' leg at all), a present marker is
// judged by the same markerMatches rule the gate decides by, and a dead one
// is flagged with why, so the file's presence is never misreported as a live
// release. `verb` is how presence is phrased ("open" for a declared boundary,
// "present" for a recorded consent), and `boundPhrase` names the age bound
// that applies to this kind.
//
// The marker is judged for the session it itself names, deliberately: a shell
// running status is not the offering session, so the wrong-session leg is not
// this report's question to answer. What it answers is whether the marker
// would release the session it names, and it prints that session so the
// operator can judge the scoping half themselves. One call is one marker, so
// the boundary kind takes a call per open declaration in the project and the
// consent kind, one file per project, takes exactly one.
//
// `momentCwd` is the project directory the moment rule is read at, passed for
// the marker kind that can carry a declaration (a role-boundary marker) and
// null for the one that cannot (a consent is the operator's word rather than a
// seat's moment). Within that kind the rule still applies only to the boundary
// verb's declared marker, which markerDeclaresMoment decides. A marker the
// moment rule has retired is reported as lapsed rather than as live: it is
// still on disk, the gate ignores it, and the next write in that project sweeps
// it once it passes its age bound, which is exactly the state an operator has no
// other way to see.
//
// `named` is the session the marker's own FILE NAME carries, for the kind whose
// files are listed rather than resolved from a caller's id, and null where the
// report has no name to hold the record against. Two things turn on it. It names
// whose file a refusal is about, which with several files open is the difference
// between a legible report and an unattributable one. And it is checked against
// the record inside, because the gate resolves a marker by name and then
// requires the record to agree: a file at one session's name recording another
// releases neither, and reporting it as live for the session it records would
// describe a marker the gate can never reach.
function reportMarker(read, label, verb, maxAgeMs, boundPhrase, momentCwd, named) {
    const marker = read.marker;
    const whose = (typeof named === 'string' && named !== '')
        ? ' for session ' + sanitize(named)
        : '';
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || typeof marker.session !== 'string') {
        const reason = marker === null ? read.reason : 'illegible';
        if (reason === 'illegible') {
            emitOut('an illegible ' + label + ' marker file is present' + whose + ' '
                + '(the gate treats it as absent); the next ' + label + ' write replaces it\n');
        } else if (reason === 'oversized') {
            emitOut('a ' + label + ' marker file past the size the reader accepts '
                + 'is present' + whose + ' (the gate treats it as absent); the next ' + label
                + ' write replaces it\n');
        } else if (reason === 'kind') {
            emitOut('something that is not a ' + label + ' marker file is sitting '
                + 'at its path' + whose + ' (the gate treats it as absent); move it aside by hand\n');
        } else if (reason === 'unreadable' || reason === 'lstat') {
            // Scoped to now, exactly as reportCheckpoint scopes its own lock
            // leg: a lock lifts, and absence must not be asserted over it.
            emitOut('the ' + label + ' marker path' + whose + ' cannot be read right now, '
                + 'so the gate treats it as absent while that lasts\n');
        } else if (reason === 'no-session') {
            // The resolver composed no path, so no file was read and nothing is
            // being asserted about the directory: its own fact, said as itself
            // rather than folded into either an absence or a bad file.
            emitOut('no ' + label + ' marker file name composes from that session id'
                + whose + ', so none was read\n');
        } else if (whose !== '') {
            // Absent, for a file that WAS listed a moment ago: the project-wide
            // none-open line would contradict the open markers this report has
            // just printed beside it.
            emitOut('the ' + label + ' marker file' + whose + ' is no longer there '
                + '(it was listed and then removed)\n');
        } else {
            emitOut('no ' + label + ' marker is ' + verb + '\n');
        }
        return;
    }
    if (whose !== '' && !sameSessionId(marker.session, named)) {
        // The gate finds a marker by name and then holds the record to the same
        // session, so this file releases neither: not the session naming it,
        // whose read of this path finds a record for someone else, and not the
        // session recorded, whose own offer resolves a different path entirely.
        emitOut('  a ' + label + ' marker file' + whose + ' records session '
            + sanitize(marker.session) + ', so the gate reaches it for neither session; '
            + 'move it aside by hand\n');
        return;
    }
    // File-derived values print indented, never at column zero (see cmdOpen).
    let line = '  ' + label + ' marker ' + verb + ' for session ' + sanitize(marker.session);
    line += (typeof marker.writtenAt === 'string')
        ? ' (written ' + sanitize(marker.writtenAt) + ')'
        : ' (no written timestamp recorded)';
    const verdict = markerMatches(marker, marker.session, Date.now(), maxAgeMs);
    // The moment rule governs a declared marker only, so a hook-written one is
    // reported on its age bound alone and no transcript is read for it.
    const declares = markerDeclaresMoment(marker) && momentCwd !== null && momentCwd !== undefined;
    // The moment is read only where the match rule has already passed, since a
    // marker the gate treats as absent is not one any transcript can speak for,
    // and the line below reports the read rather than the marker's provenance:
    // one condition governs the call and the report of it, so the report can
    // never assert a read that did not happen.
    const reads = declares && verdict.ok;
    const transcript = reads ? sessionTranscriptPath(momentCwd, marker.session) : null;
    const moment = reads
        ? markerMomentHolds(marker, transcript)
        : { ok: true, reason: null };
    if (!verdict.ok) {
        line += ' - ' + (verdict.reason === 'expired'
            ? 'expired (past the ' + boundPhrase + ' bound), so the gate treats it as absent'
            : (MARKER_DEAD_REASONS[verdict.reason] || 'the gate treats it as absent'));
    } else if (!moment.ok) {
        line += ' - ' + (MARKER_LAPSED_REASONS[moment.reason] || 'lapsed')
            + ', so the gate treats it as absent; declare again at the next real boundary';
    } else {
        line += ' - the gate honors it once for that session\'s next deferred auto-compaction, '
            + 'within the ' + boundPhrase + ' bound';
    }
    emitOut(line + '\n');
    // Which transcript answered the moment question, named rather than left to
    // be assumed. This report derives the path from the directory it is run in;
    // the gate reads the path its own PreCompact payload carries. The two are
    // the same file for a session working the directory this report is run
    // from, and a session that is not makes them differ, so a verdict here that
    // disagrees with the gate's is readable as the different subject it is
    // rather than as a contradiction.
    if (reads) {
        emitOut('    moment read against ' + (transcript === null
            ? '(no transcript path derives from this directory and that session id)'
            : displayPath(transcript))
            + ', this directory\'s transcript for that session\n');
    }
}

// The compaction gate's own record: what it decided last, and whether it is
// currently holding auto-compaction offers back. An operator reads this to tell
// a gate that is working (a short episode mid-section) from a boundary that was
// never opened (a long one), which is the question the state file exists to
// answer; the full history is the .jsonl log beside it.
//
// The two halves are reported independently: a state file whose newest decision
// is illegible can still hold a live episode, and that episode is the half an
// operator acts on. The open-episode test and the phrasing of its two integers
// are the lib's (gateEpisodeOpen, episodePhrase), shared with the gate's own
// note so the two surfaces cannot disagree about one episode.
//
// One reading to expect: an episode belongs to the leashed run, so a project
// holding a hands-on session with no goal armed reports its last decision but
// no episode. The deferral is real and the .jsonl log carries every offer of
// it; the aggregate is the leash's alone.
//
// No session id is passed to gateEpisodeOpen, deliberately: an operator running
// status is asking whether this project is holding offers at all, not whether
// any particular session owns the hold. A decision-shaped question would pass
// the armed goal's boundSession instead, since acting on another session's hold
// is the mistake the argument exists to prevent.
function reportGateState(cwd) {
    const result = readGateStateResult(cwd);
    if (!result.ok) {
        // A state file the reader refuses is not an absent one, and reporting it
        // as absent would describe a project recording nothing as a fresh one.
        // The refusal legs do not all mean the same thing, though, and the
        // message names a remedy: removing the file discards the standing
        // deferral episode and the corroboration that selects the checkpoint's
        // long bound, so it is advice worth giving over a file that will never
        // resolve and worth withholding over a scanner's lock that lifts in
        // seconds.
        //
        // Which leg it was comes from the reader's own refusal, the way
        // reportCheckpoint takes its own. Re-asking with an lstat here cannot see
        // the leg where the read was refused: that lstat succeeds and reports an
        // ordinary regular file, so the destructive advice would print over
        // exactly the transient case it is withheld for.
        //
        // Both remedies name the file at the path the reader itself used rather
        // than at a spelling written out here: the scratch directory is
        // resolved (kitScratchDir in kit-compact-lib.js), and a project
        // directory inside the memory store keeps its gate state outside the
        // project, so a hard-coded `.kit/` remedy would send an operator to
        // inspect a file that is not there. It is a value known to be a path, so
        // it takes displayPath, since a project under the operator's home carries
        // the OS account name into a channel a model reads.
        const statePath = displayPath(gateStatePath(cwd));
        if (result.reason === 'oversized') {
            // Worded as reportCheckpoint words its own oversized leg: the file
            // is legible and was refused on size, which is not the same fact as
            // a read that failed, and one refusal answered two ways is what the
            // shared-spelling rule exists to stop.
            emitOut('a compaction gate state file past the size the reader accepts is present, '
                + 'so the gate is recording nothing; removing ' + statePath + ' lets the next '
                + 'decision rebuild it\n');
        } else if (result.reason === 'kind') {
            emitOut('something that is not the gate state file is sitting at '
                + statePath + ', so the gate is recording nothing; move it aside by hand '
                + '(a delete cannot remove it)\n');
        } else {
            emitOut('the compaction gate state file cannot be read right now, so the gate '
                + 'is recording nothing while that lasts; try again once whatever holds it lets go\n');
        }
        return;
    }
    const state = result.state;
    const last = state && state.lastDecision;
    if (!last) {
        emitOut('the compaction gate has recorded no decisions in this project\n');
    } else {
        // File-derived values print indented, never at column zero (see cmdOpen).
        let line = '  last compaction gate decision: ' + sanitize(last.verdict);
        if (last.reason) line += ' (' + sanitize(last.reason) + ')';
        // Clamped exactly as episodePhrase clamps its own two integers: `at`
        // comes out of a file anyone can write, and an unclamped one renders a
        // twelve-digit minute count on a surface a model reads.
        const age = gateCount(wholeMinutesSince(last.at));
        if (age !== null) line += ', ' + age + (age === 1 ? ' minute ago' : ' minutes ago');
        emitOut(line + '\n');
    }

    const phrase = episodePhrase(gateEpisodeOpen(state));
    emitOut(phrase === null
        ? 'no deferral episode is open\n'
        : '  the compaction gate has ' + phrase + ' since this deferral episode opened\n');
}

// The deferral nudge's hold stamps, reported only when the file is refusing the
// writer, which is the one thing about it an operator can neither see nor infer
// from anywhere else.
//
// The stamp file is that nudge's clock for a held session that owns no episode,
// and the directive is emitted only when the stamp lands, so a file the writer
// refuses is a session being held and never spoken to. Two of the five refusals
// end by themselves, since the next directive removes a file this writer cannot
// have produced (an oversized one, or a link at the path) and rebuilds it. The
// other three do not: a refused open, an lstat that could not answer, and a read
// that ended short of the file all leave the path exactly as it was, over
// contents that may be a real list of live stamps. They are worded apart on
// reportCheckpoint's
// rule, that a leg drawing destructive advice or promising self-repair must be
// one where that is true, and the promise of a replacement therefore rides
// membership in the library's own healable set rather than a reading's name.
//
// Two of those three are stated as of now rather than as a standing shape, and
// deliberately without a claim either way: a lock or a scanner lifts on its own,
// while something that is not a regular file at the path never does, and this
// report cannot tell them apart, since the reader answers both with the same
// refused open. So the line names the path to look at rather than promising the
// wait ends, which is what keeps it from telling an operator to wait out a
// directory.
//
// A reading that stands prints nothing, which is where this parts from the two
// reports above. What they answer is whether a checkpoint or an episode is in
// effect, which is a state an operator asks about; the stamps answer only when
// each held session was last spoken to, which is the nudge's own bookkeeping and
// carries session ids this report has no reason to put on a terminal.
//
// The reason comes from the reader's own refusal rather than from a second
// syscall here, for the reason reportGateState states: an lstat asked afterwards
// cannot see the leg where the READ was refused, so the two would be reported as
// one. The path is composed rather than written out, since a project inside the
// memory store keeps these files outside the project (kitScratchDir), and it
// rides this file's display guard on the way out; it is the only value
// interpolated, the five reasons being this library's own fixed words with
// nothing file-derived reaching the line.
//
// WHICH readings promise a replacement is not decided here. That authority is
// the library's HOLD_NUDGE_HEALABLE, the same list the writer heals by, so the
// two sides cannot come to disagree about one file: a reason added there gains
// the promise on this surface in the same edit, and one removed loses it.
// Spelling the reason names again here is what would let the writer start
// healing a file this verb still describes as standing.
function reportHoldStamps(cwd) {
    const result = readHoldNudgesResult(cwd, Date.now());
    if (result.ok) return;
    const stampPath = displayPath(holdNudgePath(cwd));

    // What was read, worded per reading, since the legs name different things
    // about the same path. The per-reason wordings below are genuinely
    // per-reason and are spelled by name for that reason. What is NOT decided by
    // name is the healable-versus-refusing split: the fallback that catches a
    // reading with no wording of its own forks on the same HOLD_NUDGE_HEALABLE
    // membership the remedy below rides, so a sixth healable reason added to the
    // library's set cannot land on the refusing wording and print "cannot be
    // read" beside a promise that the next directive replaces it. That
    // self-contradicting pair is exactly what spelling the set's members again
    // on this side would produce.
    let lead;
    if (result.reason === 'oversized') {
        lead = 'the deferral nudge\'s hold stamps at ' + stampPath
            + ' are past the size the reader accepts';
    } else if (result.reason === 'kind') {
        lead = 'something that is not the deferral nudge\'s hold stamp file is sitting at ' + stampPath;
    } else if (result.reason === 'short-fill') {
        // The reading that ended short of the file. Nothing here identifies the
        // file as one the nudge did not write, so nothing removes it.
        lead = 'the read of the deferral nudge\'s hold stamps at ' + stampPath + ' ended short of the file';
    } else if (HOLD_NUDGE_HEALABLE.includes(result.reason)) {
        // A healable reading with no wording of its own: the set says the writer
        // identified this file as one it could not have produced and removes it,
        // so the line says that much and leaves the shape unnamed rather than
        // borrowing the refusing leg's claim that nothing can be told about the
        // path. Nothing reaches this branch today, the set's two members both
        // having their own wording above; it is what a sixth member lands on.
        lead = 'the deferral nudge\'s hold stamp file at ' + stampPath
            + ' is not one that writer produced';
    } else {
        // 'unreadable' and 'lstat' together: both may be a lock over a file
        // holding live stamps, and both may equally be a directory or another
        // shape at the path that never lifts, so this leg claims nothing about
        // what is there. What the operator can act on is the path, which is
        // named.
        //
        // One shape lands here that the writer does in fact remove: a FIFO or a
        // socket, which the reader refuses on the descriptor and cannot tell
        // from a lock, while the writer's own lstat calls it a kind it unlinks.
        // readHoldNudgesResult states why the two sides are asked differently.
        // What that costs is bounded to this line being weaker than the truth
        // for those kinds rather than wrong about them, since it promises
        // neither a repair nor an end to the wait.
        lead = 'the deferral nudge\'s hold stamp file at ' + stampPath + ' cannot be read';
    }

    // What happens next, decided by membership in the healable set rather than
    // by the reason's name. The promise is CONDITIONAL because the repair it
    // names is: the heal is an unlink, which takes permission on the scratch
    // directory itself, so under a read-only .kit/ the next directive refuses
    // and the file stands. An unconditional promise there tells an operator to
    // wait out a replacement that never comes, which is the same failure the
    // refusing legs are worded to avoid.
    const remedy = HOLD_NUDGE_HEALABLE.includes(result.reason)
        ? 'the next hold directive replaces it, so long as the directory holding it is writable'
        : (result.reason === 'short-fill'
            ? 'the stamps are left as they are and a read that completes takes them again'
            : 'a lock or a scanner over it clears on its own, while anything else standing at '
                + 'that path does not');

    emitOut(lead + ', so a held session cannot be stamped and its directive stays '
        + 'silent; ' + remedy + '\n');
}

// Every role-boundary declaration open in this project, one line each. The
// question this report answers is what is open HERE rather than what is open
// for whoever is running it: an operator at a shell carries no session id, and a
// seat reading its own status is one of possibly several seats holding this
// checkout. So the sessions come from the files present rather than from the
// caller, and each is judged for the session it names, which is reportMarker's
// own rule.
//
// A directory that could not be listed is not an empty one, and saying so is
// what keeps the none-open line honest: with the listing refused, this report
// knows nothing about what is open here. The refusal is reported in the class
// the reader gives it, since a determinate one (something that is not a
// directory parked at the scratch path) is a state an operator has to act on,
// where a transient one is one to re-ask. A listing that was cut short is
// neither: what it found is reported and the report says it is partial, rather
// than a truncated set standing in for the whole picture.
//
// Each marker is judged against the session its own file name carries, which is
// what lets a file recording a different session be reported as one the gate
// cannot reach rather than as that session's live release.
function reportRoleBoundaryMarkers(cwd) {
    const listed = roleBoundarySessionsResult(cwd);
    if (!listed.ok) {
        emitOut('the scratch directory holding the role-boundary markers ' + (listed.reason === 'determinate'
            ? 'is not a directory that can be listed, so whether any marker is open here cannot be '
                + 'established; move aside whatever is standing at that path'
            : 'cannot be listed right now, so whether any is open here cannot be established')
            + '\n');
        return;
    }
    if (listed.sessions.length === 0 && !listed.bounded) {
        reportMarker({ ok: true, marker: null, reason: 'absent' }, 'role-boundary', 'open',
            ROLE_BOUNDARY_MAX_AGE_MS, BOUNDARY_HOURS + '-hour', cwd, null);
        return;
    }
    for (const session of listed.sessions) {
        reportMarker(readRoleBoundaryResult(cwd, session), 'role-boundary', 'open',
            ROLE_BOUNDARY_MAX_AGE_MS, BOUNDARY_HOURS + '-hour', cwd, session);
    }
    if (listed.bounded) {
        emitOut('that listing of the role-boundary markers was cut short by this tool\'s own '
            + 'per-call cap, so there may be more open here than the lines above\n');
    }
}

function cmdStatus() {
    const cwd = process.cwd();
    reportCheckpoint(cwd);
    reportRoleBoundaryMarkers(cwd);
    reportMarker(readConsentResult(cwd), 'operator-consent', 'present',
        CONSENT_MAX_AGE_MS, CONSENT_HOURS + '-hour', null, null);
    reportGateState(cwd);
    reportHoldStamps(cwd);
    process.exitCode = 0;
}

function main() {
    const [cmd] = process.argv.slice(2);
    if (cmd === 'open') cmdOpen();
    else if (cmd === 'clear') cmdClear();
    else if (cmd === 'status') cmdStatus();
    else if (cmd === 'boundary') cmdBoundary(process.argv.slice(3));
    else if (cmd === 'consent') cmdConsent(process.argv.slice(3));
    else usage();
}

// Wrapped so an unexpected defect prints one elided line and a nonzero exit
// instead of a stack trace, the guard kit-goal.js carries at the same place and
// for a reason that is stronger here: this CLI's output is echoed into a
// session's context, and an uncaught throw writes Node's own trace to stderr
// carrying the full module path of every file on the require stack, which is
// home-anchored on an installed plugin. That write is the runtime's rather than
// this file's, so it is a leg both the emitters' floor and the source-side pin
// are blind to; catching here is what puts it back on the channel.
//
// The kit-library loading is INSIDE the region for that reason: a require is the
// throw most likely to produce that trace, a damaged plugin cache being its
// ordinary cause. What remains outside is this file's own module-scope
// evaluation and the two Node built-in requires above it, neither of which
// carries a plugin path or reads anything off disk.
try {
    loadKitLibraries();
    main();
} catch (err) {
    emitErr('kit-compact-checkpoint: ' + sanitize(err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
}
