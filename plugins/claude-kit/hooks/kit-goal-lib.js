// Shared library for the kit-native goal continuity mechanism.
//
// Goal state is a small working-tree-scoped JSON file (.kit/goal-state.json,
// gitignored) that survives a session swap because it lives in the repo, not
// in any one session's transcript. It belongs to the working tree it sits in:
// a leash names an execution stream, and git makes a working tree the unit of
// one (HEAD, index and branch are per-worktree), so a linked worktree holds a
// leash of its own and the main checkout's is untouched by it (goalPath below
// owns the resolution). This module is the single owner of the
// canonical condition text (composeCondition) and the read/write/clear
// operations on that file, and of the machine-readable event stream
// (emitGoalEvent), which carries the releases the Stop hook itself observes; a
// manual clear through the CLI releases the leash without an event, since the
// user is already there for it. Consumed by kit-goal.js (the CLI), the
// /kit-goal skill, and the Stop hook that enforces the armed goal.
//
// Node core modules only, CommonJS, zero dependencies. Every exported
// function that touches the filesystem or parses data is wrapped so it never
// throws; a filesystem hiccup degrades to a null/false/default result instead
// of trapping the caller (the CLI and, eventually, the Stop hook, must never
// crash a session over a goal-state read).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Characters of a path git's own administrative data may name, the .git
// pointer file and the worktree listing alike. A working directory is bounded
// by what the OS will hand back; what git writes about one is not. It is
// exported beside storablePathValue so a caller screening such a path takes
// this cap rather than a second figure of its own.
const GIT_POINTER_PATH_CAP = 2048;

// Path and filename fragments compare the way the platform's filesystem
// compares them, so one physical file cannot pass one check in a caller and
// fail another. Only win32 folds case. Off win32 the comparison is exact even
// where the filesystem folds (macOS's default APFS is case-insensitive and
// case-preserving), so two spellings of one file can fail to match there;
// that errs toward not resolving, and it matches memq's fsEq, which is the
// agreement to preserve on any edit to either copy. No test asserts that
// agreement directly; what covers this function is session-start-goal's
// sibling-worktree cases, which reach it through the own-tree exclusion.
function fsEq(a, b) {
    return process.platform === 'win32'
        ? String(a).toLowerCase() === String(b).toLowerCase()
        : a === b;
}

// A path folded to the volume's own spelling on win32 (an 8.3 short form, a
// junction, a subst drive, and a re-cased segment all fold to one spelling),
// and the path unchanged off win32, where resolving the real path would
// silently follow symlinks. A path the fold cannot resolve keeps its lexical
// spelling, which errs toward whatever the caller's comparison already did
// with the unfolded form. It is exported rather than kept local because the
// comparison it serves belongs to a caller: session-start.js folds a sibling
// worktree's path and its own root to one spelling before comparing them,
// and a hand copy of the fold there would drift from this one silently.
function nativeSpelling(p) {
    if (process.platform !== 'win32') return p;
    try {
        return fs.realpathSync.native(p);
    } catch {
        return p;
    }
}

// The directory .kit/ resolves against: the working directory itself, for a
// linked worktree exactly as for an ordinary checkout. A leash names an
// execution stream and git makes a working tree the unit of one, so the tree
// a session runs in is the tree whose leash it holds, and two trees of one
// repository can carry two leashes at once without either reaching the other.
//
// So the derivation is written into goalPath below rather than standing as a
// function of its own: the answer is the caller's own directory, and a named
// identity function around it reads as a resolution step that could answer
// something else.

// Path to the goal-state file for a given working directory. Every read/write
// helper in this file resolves through here, so every consumer of this module
// inherits the resolution without an edit of its own.
//
// State and plan docs are co-located: both resolve against the caller's own
// cwd, so a reading of a queued plan's doc and the leash that queued it come
// from one tree, no reader of either needs a second opinion from a checkout
// elsewhere, and no reader of either reaches past cwd for a plan doc at all.
function goalPath(cwd) {
    return path.join(cwd, '.kit', 'goal-state.json');
}

// The cap on a stored transcript path. Long enough for a real harness
// transcript path, short enough that no caller can pad the state file.
const TRANSCRIPT_MAX = 512;

// The clamp every stored path field routes through: a non-empty string within
// the caller's cap, free of control characters, and not network-shaped (two
// leading separators: a UNC path, a //server form, or the \\?\ device
// namespace, whose root spells the same way). The channel is a path arriving
// from data rather than from the session, the goal-state file that is
// hand-editable and surfaced by the hooks, and the worktree list git's own
// administrative data supplies to session-start.js, so these rules belong to
// the channel rather than to whichever producer first needed them. Every such
// path routes through this one spelling, so a hardening applied here reaches
// them all at once where a hand copy would drift.
//
// requireAbsolute is the one leg not every caller takes. Where it is on, the
// value must name a place independent of the reader. On win32 that means a
// drive-qualified root (letter, colon, separator), because path.isAbsolute
// also admits a drive-relative rooted form (a single leading separator),
// which resolves against whichever drive the reading process happens to be
// on, the very ambiguity the leg exists to exclude; the network-shape leg
// above already refuses the UNC and device roots that are also absolute. Off
// win32, path.isAbsolute is the whole question.
function storablePathValue(value, cap, requireAbsolute) {
    if (typeof value !== 'string' || value === '' || value.length > cap) return false;
    if (/[\x00-\x1F]/.test(value) || /^[\\/]{2}/.test(value)) return false;
    if (!requireAbsolute) return true;
    return process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) : path.isAbsolute(value);
}

// Whether a value is storable as boundTranscript: storablePathValue at the
// transcript cap, absoluteness not required. The path is machine-local and
// lives in a gitignored file; it is only ever fs.stat'ed, never executed, and
// never surfaced raw. The control-character leg is a sanitize-before-store
// guard (a newline would smuggle text into a file the hooks surface into the
// model's context). The network-path leg narrows the hang surface of the
// stat, which runs synchronously at every SessionStart and blocks for the SMB
// timeout on an unreachable share: it rejects the doubled-separator forms,
// and only those. A path on a mapped network drive letter is
// indistinguishable from a local disk without a syscall, so it passes this
// check and can still hang the stat; that residual takes a hand-edited state
// file to reach, since the harness produces transcript paths under the local
// user profile.
function validTranscript(value) {
    return storablePathValue(value, TRANSCRIPT_MAX, false);
}

// The shape a harness session id has: a lowercase-or-uppercase UUID. This is
// the first of the two keys armGoal's arm-time bind requires, and it is only a
// shape: it cannot authenticate an id, since any 36-character UUID passes it.
// The second key is a transcript file on this machine that the id names (see
// armGoal), which is the evidence that the id belongs to a real local session.
// Both are required because an arm-time bind is not recoverable from the wrong
// value: a goal bound to a session that never stops is one the real run can
// never claim, because both fallback claim points (the first stop, the first
// auto-compaction offer) act only on an unbound goal, so the real run stays a
// bystander for the goal's whole life. Arming unbound costs nothing by
// comparison: the claim points bind it at the run's first stop. The residual
// the two keys leave is a stale id that still names a real local transcript
// (an id from an earlier session on this machine); that binds, and the operator
// re-arms to correct it.
//
// A value passing this gate is 36 printable ASCII characters, so it satisfies
// bindSession's storage rules (string, within the 128-character cap, no control
// characters) by construction, and carries no path separator.
const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether a value has the shape of a harness session id. Exported so the CLI
// can test the shape before doing any filesystem work on the value, without a
// second copy of the grammar: one definition decides what both the CLI's
// transcript lookup and armGoal's bind answer to.
function isSessionIdShaped(value) {
    return typeof value === 'string' && SESSION_ID_SHAPE.test(value);
}

// The session id the arming invocation ran under, or null where the state
// records none. It re-applies the shape test rather than trusting what is on
// disk: the state file is hand-editable, and a value that is not shaped like a
// harness session id is one no session's own id can ever be.
//
// What it answers is which session ran the arm, which is a different question
// from which session holds the leash: boundSession answers that one, and the
// two disagree from the moment another session claims an unbound goal. The
// claim points reach it only through armingSessionClaims below, so the lookup
// has one spelling everywhere a claim is decided; the status report reads the
// normalized field directly, to say which of the two unbound states the file
// holds, and decides nothing on it.
function armingSession(state) {
    const value = state && state.armingSession;
    return isSessionIdShaped(value) ? value : null;
}

// Whether the session a claim point is running for is the session that armed
// the goal. This is the whole rule an unbound goal is claimed on, and both
// claim points (kit-goal-stop.js and kit-compact-gate.js) call it, so the rule
// cannot be spelled two ways or gain a gate on one route and not the other.
//
// The payload id is held to the session-id shape before the compare because
// sameSessionId compares through String() and a trim: a claim point takes its
// id from hook payload JSON whose shape it does not control, so without this
// test a whitespace-padded string, or a one-element array wrapping the recorded
// id, coerces into a match and the binding is then written from that coerced
// value. The recorded side needs no such test, armingSession applies it.
//
// The comparison helper is required at call time rather than at module load:
// kit-compact-lib.js destructures this module at its own load, so a top-level
// require back is the cycle the local-copies note further down states.
function armingSessionClaims(state, sessionId) {
    const { sameSessionId } = require('./kit-compact-lib.js');
    return isSessionIdShaped(sessionId) && sameSessionId(armingSession(state), sessionId);
}

// Whether this session holds the leash on an armed goal, by the two routes that
// need no transcript: it is the bound session, or the goal is unbound and the
// session is the one the state records as having armed it. The second route
// answers true before any claim has been made, which is deliberate: a run that
// armed a plan for itself holds the leash from the arm onward as far as every
// surface that only reports or reminds is concerned, and the claim point it
// next reaches is what writes that down.
//
// The claim points act on a third route this one leaves out, and a caller has
// to know it: an unbound goal is also claimed by a session whose own arming
// text names the plan, read out of its transcript. That read is too expensive
// for a surface that runs on every covered tool return, so what this predicate
// costs is that an arm made outside any session, which records no arming id,
// answers false for the session that will claim on its typed text.
//
// This is the read-only spelling of the question, for surfaces that do not
// themselves bind: the two nudges call it to report or remind, and the checkpoint
// CLI's write verbs call it as a write door, where a caller holding the leash by
// the arming route may open a chapter boundary over another session's record and
// clear one. The claim points do not call it, and that is not a second spelling
// of the rule but the same rule taken
// apart, because they must know WHICH route claimed in order to bind on it and
// to say so; both of their branches call armingSessionClaims above and
// sameSessionId, which are the two legs this composes.
//
// The unbound test is the claim points' own (a falsy boundSession), so a state
// carrying a binding this file cannot support answers false here exactly as it
// claims nothing there: no session is told it holds a leash the claim points
// would not give it.
function sessionHoldsLeash(state, sessionId) {
    const { sameSessionId } = require('./kit-compact-lib.js');
    if (!state || typeof state.plan !== 'string' || state.plan === '') return false;
    if (state.boundSession) return sameSessionId(state.boundSession, sessionId);
    return armingSessionClaims(state, sessionId);
}

// Normalize a parsed goal state to the current shape, so every reader can rely
// on queue, queueIndex, history, and boundTranscript being present and on
// queue[queueIndex] === plan. Path fields are re-validated on every read, not
// only at write time: planHead joins plan (and the status report joins each
// queue entry) onto cwd and opens the result, so a hand-edited value that
// traverses out of the repo, or names a FIFO outside it, must never reach a
// reader. A plan that does not round-trip normalizePlanArg (that is, was not
// the product of armGoal's own normalization) makes the whole state
// malformed: readGoal returns null, every reader sees no armed goal, and the
// doctor, which reads the raw file, is the surface that flags the damage. A
// state file carrying no queue is a queue of one: plan is the authority on
// what is current, so a queue that is absent, malformed, carrying an entry
// that fails the same path rule, or disagreeing with plan is replaced by
// [plan] at index 0. Applied inside readGoal, so no caller sees the
// un-normalized shape.
function normalizeState(cwd, state) {
    if (!state || typeof state !== 'object' || typeof state.plan !== 'string' || state.plan === '') {
        return state;
    }
    if (normalizePlanArg(cwd, state.plan) !== state.plan) {
        return null;
    }
    const queue = state.queue;
    const index = state.queueIndex;
    const usable = Array.isArray(queue) && queue.length > 0
        && queue.every((p) => typeof p === 'string' && normalizePlanArg(cwd, p) === p)
        && Number.isInteger(index) && index >= 0 && index < queue.length
        && queue[index] === state.plan;
    if (!usable) {
        state.queue = [state.plan];
        state.queueIndex = 0;
    }
    if (!Array.isArray(state.history)) state.history = [];
    if (!validTranscript(state.boundTranscript)) state.boundTranscript = null;
    // The arming invocation's own session id, repaired to the rule its reader
    // applies: anything not shaped like a harness session id records no arming
    // identity at all, so a hand edit cannot park a value a claim point would
    // read. A state predating the field reads back with none, which is the same
    // reading an arm that could read no session id from its environment writes.
    if (!isSessionIdShaped(state.armingSession)) state.armingSession = null;
    // Who made the arming invocation each queued plan was armed by, repaired
    // one entry at a time. A state predating the map reads as the operator's
    // arming throughout, which is the reading its own stored condition sentence
    // was composed under, so the two agree there. A hand edit is where they can
    // disagree, since this repair never recomposes condition; the next append
    // or advance recomposes it from the repaired map.
    state.armedBy = normalizeArmedBy(state.armedBy, state.queue);
    state.authorizations = normalizeAuthorizations(state.authorizations, state.queue);
    return state;
}

// The authorization map as every reader may rely on it: an object with NO
// prototype, keyed by the plan paths the queue actually holds, each value either
// a printable-ASCII sentence within safeForAuthorization's cap or null for none
// recorded. Anything else (absent, an array, a scalar, a hand-edited value
// carrying escape sequences or padded to kilobytes) is repaired here rather than
// propagated, matching the repair the queue and the history already get on every
// read.
//
// The value is quoted plan-doc content, so it is re-screened at read and not
// only at write: it is written back verbatim by every advance and bind, and it
// reaches a terminal through the CLI's status report, so a hand edit that never
// went through the writer must not survive one round trip into the file the
// readers trust. A string with nothing printable left in it records as none,
// since an empty quote asserts a section that said nothing.
//
// The keys answer to the same rule: this is the one field keyed by untrusted,
// hand-editable strings, and it is both built and read by key. So the map is
// walked from the queue rather than from the file's own key list, which does
// three things at once. It prunes a key naming no queued plan, so a hand edit
// cannot park a claim about a plan this state does not carry and a plan dropped
// by a re-arm does not leave its authorization behind. It re-validates the keys
// against the containment rule, since every queue entry has already round-tripped
// normalizePlanArg above. And it reads each entry as an OWN property, which
// matters because a plain object answers a key it never recorded with whatever
// Object.prototype carries under that name: a plan path of 'toString' would
// otherwise render a native function as the authorization that plan recorded.
// The absent prototype closes that direction for every later reader too, none of
// which can know the key it is about to look up came from a file.
function normalizeAuthorizations(value, queue) {
    const clean = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
    for (const rel of queue) {
        if (!Object.prototype.hasOwnProperty.call(value, rel)) continue;
        const entry = value[rel];
        if (typeof entry !== 'string') {
            clean[rel] = null;
            continue;
        }
        const safe = safeForAuthorization(entry);
        clean[rel] = safe === '' ? null : safe;
    }
    return clean;
}

// The armedBy map as every reader may rely on it: an object with NO prototype,
// one entry per plan the queue holds, each entry either 'self' or 'operator'.
// It records ONE fact, who made the invocation that armed this plan: 'self'
// where the run ran the CLI for itself, 'operator' where a person typed it.
// What authorizes a plan to be leashed is a different fact with its own field,
// authorizations above, read from the plan doc rather than declared by the
// caller.
//
// The keys answer to the rules stated above, one at a time and for the same
// reasons: they are hand-editable plan paths, so the map is walked from the
// queue rather than from the file's own key list. Where the two maps differ is
// the absent entry. An authorization is a quotation, so a plan the file says
// nothing about records nothing; armedBy is an answer every armed plan has, so
// an absent or unrecognized entry reads as the operator's arming. That is a
// compatibility reading and rests on nothing else: every state written before
// this map existed was armed by an operator typing the CLI, since the self
// spelling did not exist to be run, so it is the reading such a file was
// written under and the one its stored condition text already states.
function normalizeArmedBy(value, queue) {
    const clean = Object.create(null);
    const usable = value && typeof value === 'object' && !Array.isArray(value);
    for (const rel of queue) {
        clean[rel] = usable && Object.prototype.hasOwnProperty.call(value, rel) && value[rel] === 'self'
            ? 'self'
            : 'operator';
    }
    return clean;
}

// The map an arm or an append writes for the plans it is adding: one entry per
// plan, all of them who made that invocation. The entries already in a queue
// are never touched by it, which is what lets one queue hold plans armed by two
// different invocations.
function armedByFor(plans, arming) {
    const map = Object.create(null);
    for (const rel of plans) map[rel] = arming;
    return map;
}

// Who armed one plan of an armed queue: the single reader every surface that
// renders or composes from the field goes through, so the Stop hook, the CLI
// and the recompose sites cannot spell the lookup three ways. 'self' is the
// only value that answers self, so a map damaged in any way reads as the
// operator's arming, matching the repair every reader's state has been
// through.
function planArmedBy(state, planRel) {
    const map = state && state.armedBy;
    return map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, planRel)
        && map[planRel] === 'self'
        ? 'self'
        : 'operator';
}

// The armedBy argument as an arming caller may pass it, judged rather than
// repaired. A stored value is hand-editable and gets the lenient repair above;
// this one is a live argument from the CLI, where a typo ('granted', 'Self',
// true) silently repaired to 'operator' would record an arming nobody made. So
// an unrecognized value refuses the whole invocation and nothing is written.
// Absent means the operator's arming, what a caller saying nothing is doing.
function armedByArg(value) {
    if (value === undefined || value === null || value === 'operator') {
        return { ok: true, authority: 'operator' };
    }
    if (value === 'self') return { ok: true, authority: 'self' };
    // Named defensively: a value with no primitive conversion (an object with
    // a null prototype, one whose toString is not callable) throws on String(),
    // and this module's contract is that no exported function throws. What such
    // a value is cannot be quoted, so the refusal names its type instead.
    let named;
    try {
        named = safeForReason(String(value));
    } catch {
        named = 'an unprintable ' + typeof value;
    }
    return { ok: false, reason: 'armedBy must be self or operator: ' + named };
}

// The kind-and-size preamble the hardened readers in kit-compact-lib.js apply,
// and the temp-path helper its atomic writers share, spelled locally in this
// file.
//
// They are local copies rather than imports because the dependency runs the
// other way: kit-compact-lib.js destructures this module at its own load
// (`const { normalizePlanArg } = require('./kit-goal-lib.js')`), so a require
// back would be a genuine cycle, and because that destructure runs at load time
// one load order hands kit-compact-lib.js a half-built exports object with
// normalizePlanArg undefined. Every hook is its own entry point, so such a
// breakage follows load order rather than logic and appears in one hook and not
// another.
//
// The obligation covers those two helpers and nothing wider: regularFileSize and
// atomicTmpPath answer questions both files ask about their own state files, so
// a change to either copy belongs in both. It does not reach the writers around
// them, which answer to their own cadences: sweepStaleTmp below exists because
// this file's writers run often enough for an abandoned temp to matter, and a
// directory listing on every checkpoint write is a cost those cadences do not
// earn. The residual that leaves is real and named rather than dismissed: two
// legs still orphan a temp there (a process killed between the create and the
// rename, and a cleanup unlink that itself throws), the temp names are
// unguessable by design, and with no sweep on that side nothing reclaims one.
//
// readGoal calls the one definition below over the goal state file. Every
// question about an armed PLAN path goes through planFileSize and planPathState
// instead, which add the one resolution rule a plan doc needs, and those two are
// what planHeadText, armGoal, the CLI's queue rendering, the Stop hook's hold,
// the queue-position walk's treeEntryState, the SessionStart hook's plan
// inventory and the status-line widget all call: a reader that answered
// differently would open a path another one refused, which is the disagreement
// this file's section exists to close.
//
// emitGoalEvent spells the same lstat-and-isFile shape inline over a different
// file, and deliberately with the opposite posture: an lstat that fails for any
// reason there leaves the sink unjudged and the append proceeds, because a
// missing event costs observability while a refused read costs a verdict. That
// is a different question about a different file, so it is not a fourth copy of
// this rule.

// The size of the REGULAR file at this path: 0 when nothing is there, and null
// when the path cannot be safely read through, either because something other
// than a regular file is sitting on it (a symlink or junction, a directory, a
// FIFO) or because its kind could not be determined at all. The check is an
// lstat, so a link is judged as a link rather than as whatever it points at.
//
// Only ENOENT reads as "nothing there, go ahead". Every other lstat failure
// (EACCES, EPERM, EBUSY: a permission, a lock, a scanner holding the file) is an
// unknown answer, and answering an unknown with the go-ahead value would hand
// the caller the open this check exists to withhold.
function regularFileSize(target) {
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 0 : null;
    }
    return st.isFile() ? st.size : null;
}

// What an errno from a stat of a path settles, for every caller that has to turn
// a failed stat into a verdict or a wording:
//
//   'absent'       ENOENT: nothing is at the path
//   'determinate'  ENOTDIR (a regular file standing where a parent directory
//                  belongs), ELOOP (a link cycle above the final component) and
//                  ENAMETOOLONG (a path no filesystem call accepts, and
//                  normalizePlanArg imposes no length bound of its own). No lock
//                  produces any of these and waiting resolves none of them
//   'transient'    every other code, EACCES, EPERM and EBUSY above all: a
//                  permission, a lock, a scanner or an indexer holding the path.
//                  The answer is unknown rather than settled, and it may lift on
//                  its own
//
// One classification, and the callers are wherever that question is asked: in
// this library and in kit-compact-lib.js, a path's state is reported to an
// operator (planPathState, goalPathKind, roleBoundaryListFailure), a link is
// resolved or refused (resolvePlanLink), a file is removed or left alone
// (clearGoal, clearCheckpoint, clearMarkerFile, holdStampKind). The rule is what
// is shared rather than the list: spelled per site instead, two callers of one rule routed
// ENOTDIR to opposite answers.
function pathErrnoClass(code) {
    if (code === 'ENOENT') return 'absent';
    if (code === 'ENOTDIR' || code === 'ELOOP' || code === 'ENAMETOOLONG') return 'determinate';
    return 'transient';
}

// The size of the plan doc at a repo-relative plan path: 0 when nothing is
// there, and null when nothing at that path can be read as a plan doc. The
// plan-doc counterpart of regularFileSize, and the one answer every reader of an
// armed plan path takes.
//
// A regular file and an absent path answer exactly as regularFileSize does. The
// difference is the one non-regular kind that is genuinely readable: a link
// whose target resolves, still inside the repo, to a regular file is a plan doc.
// Refusing it would leave a checkout that links a plan doc unable to arm, and a
// goal already armed over such a path holding every stop for the life of the
// run, over a file the operator can open by hand.
//
// The link is resolved with realpathSync and the result held to
// normalizePlanArg's own containment rule, so a link out of the repo is refused
// exactly as a plan argument naming that path would be. The repo root is
// resolved too, so a checkout reached through a link of its own is not judged
// foreign to itself. The resolved path is then stat'ed rather than lstat'ed, so
// a chain ending anywhere but a regular file is refused. A dangling link, a link
// cycle, and a resolution that fails for any other reason all keep the refusal.
//
// A directory, a junction, a FIFO or a device at the plan path stays refused
// too: none can ever be opened as a plan doc, and those are the kinds the Stop
// hook's hold is written for.
//
// The size is returned rather than judged here because the callers hold
// different bounds: planHead reads a fixed 2 KB head and needs none, and the
// status-line widget applies its own plan-doc cap to what this returns.
//
// The lstat is spelled here rather than borrowed from regularFileSize because
// this function needs the distinction that helper erases, the same one clearGoal
// needs: regularFileSize answers null both for a kind that is not a regular file
// and for an lstat that failed. Only the first of those may be resolved through,
// since a failed lstat has told us nothing about the path and following it would
// hand back the very open the check exists to withhold.
function planFileSize(cwd, planRel) {
    const full = path.join(cwd, planRel);
    let st;
    try {
        st = fs.lstatSync(full);
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 0 : null;
    }
    if (st.isFile()) return st.size;
    return resolvePlanLink(cwd, full).size;
}

// The link-resolution half of planFileSize's rule, spelled once so the two
// questions asked of it cannot answer differently: the size when the link
// resolves, inside the repo, to a regular file, and otherwise how the refusal
// was reached. planFileSize takes the size and discards the rest, which is why
// its contract is unchanged by this split; planPathState needs the rest, because
// a refusal it must hold a stop over forever and one that may clear on its own
// look identical from a bare null.
//
// A dangling link raises ENOENT from realpathSync, which pathErrnoClass calls
// 'absent'. That is the wrong word here and is mapped to a determinate refusal
// instead: something IS at the plan path, it simply cannot be opened as a plan
// doc, and it will not start being openable without a hand fixing it.
function resolvePlanLink(cwd, full) {
    try {
        const real = fs.realpathSync(full);
        if (normalizePlanArg(fs.realpathSync(cwd), real) === null) return { size: null, cls: 'determinate' };
        const st = fs.statSync(real);
        return st.isFile() ? { size: st.size, cls: null } : { size: null, cls: 'determinate' };
    } catch (err) {
        const cls = pathErrnoClass(err && err.code);
        return { size: null, cls: cls === 'transient' ? 'transient' : 'determinate' };
    }
}

// Why the plan doc at a repo-relative plan path could not be read, judged by the
// same rule planFileSize applies, so the callers of one question cannot answer
// differently. Asked only where planHead has already reported the path
// unreadable, and one of:
//
//   'gone'        nothing is there; archiving a finished plan is the expected
//                 cause, but this state alone cannot tell that from a deletion
//                 or a path that never held a doc
//   'unusable'    the path cannot be opened as a plan doc now or later, either
//                 because something that is not a readable plan doc is at it (a
//                 directory, a junction, a FIFO, a link resolving out of the repo
//                 or to no file at all) or because the path itself can never
//                 resolve to one
//   'unreadable'  a readable kind whose read did not succeed, or a path whose
//                 kind could not be determined by a transient errno
//
// The kind leg is why this is an lstat rather than fs.accessSync. accessSync
// follows a link and succeeds on a directory, so it reports "present" for
// exactly the paths planHead refuses, and the Stop hook's absent branch would
// then take neither the archived branch nor any other: no block, no advance, no
// clear and no event, at every stop for as long as the path stays that way, with
// the goal still armed and the status line still showing it. A leash that allows
// every stop while looking armed is the one outcome that hook exists to prevent.
//
// The three wordings the callers give these states are their own: armGoal
// refuses an arm, the Stop hook holds a stop, and the CLI prints a queue token.
function planPathState(cwd, planRel) {
    let st;
    try {
        st = fs.lstatSync(path.join(cwd, planRel));
    } catch (err) {
        const cls = pathErrnoClass(err && err.code);
        if (cls === 'absent') return 'gone';
        return cls === 'determinate' ? 'unusable' : 'unreadable';
    }
    if (st.isFile()) return 'unreadable';
    // A non-regular kind that resolves to an in-repo regular file is a plan doc
    // planHead reads, so reaching here over one means the read failed rather
    // than the kind, which is the transient answer. A resolution that did not
    // finish splits the same way the lstat above splits: a transient errno
    // (a scanner holding the target, a descriptor exhaustion) says nothing
    // permanent about the path and fails open, where the determinate refusals
    // (out of the repo, dangling, cyclic, not a regular file) hold the stop.
    const link = resolvePlanLink(cwd, path.join(cwd, planRel));
    if (link.size !== null) return 'unreadable';
    return link.cls === 'transient' ? 'unreadable' : 'unusable';
}

// The goal state's read cap. The writer produces a plan path, the armed queue of
// plan paths, one condition sentence, a bound session id, a transcript path
// capped at TRANSCRIPT_MAX, one authorization entry per queued plan holding a
// sentence capped at AUTHORIZATION_MAX_CHARS (the largest per-plan contributor
// of the lot), and one short history entry per finished plan: a few kilobytes
// for the largest queue anyone arms. Anything past 64 KB is not something this
// wrote, and reading it whole on the paths readGoal runs on is cost with nothing
// to gain.
const GOAL_STATE_MAX_BYTES = 64 * 1024;

// Read and parse the goal-state file, normalized to the current shape (see
// normalizeState). Returns the parsed object, or null if the file is absent,
// refused, unreadable, not valid JSON, or carrying a plan path the normalizer's
// path re-validation refuses.
//
// The path must be a regular file of sane size before it is opened, judged by
// regularFileSize's lstat, because this reader runs where blocking is not
// recoverable: the PreCompact gate calls it before any verdict is emitted and
// ahead of both hardened readers there, the goal-leash Stop hook calls it while
// holding a stop, and the deferral nudge calls it inside the tool loop, at the
// return of every covered Bash, PowerShell, Agent and TaskOutput call. A FIFO
// planted at this path would block any of them inside readFileSync forever,
// where no try/catch can rescue it, and a link would be followed into whatever
// it names.
//
// What this covers is this one path. It narrows rather than closes even here,
// since the open below re-resolves the path, and the callers reach other files
// through other readers, each of which answers for itself.
//
// Every refusal returns the same null an absent file returns, so this stays
// fail-open: every caller already reads null as no goal armed.
function readGoal(cwd) {
    try {
        const target = goalPath(cwd);
        const size = regularFileSize(target);
        if (size === null || size > GOAL_STATE_MAX_BYTES) return null;
        return normalizeState(cwd, JSON.parse(fs.readFileSync(target, 'utf8')));
    } catch {
        return null;
    }
}

// What is at the goal-state path: 'file', 'oversized' (a regular file past the
// bound every reader of it enforces), 'other' (something that is not a regular
// file), 'unresolvable' (a path that can never resolve to a file), 'unreadable'
// (a kind that could not be read at all) or 'absent'. The kind rule every reader
// of that file applies, plus the size cap they apply with it, asked here because
// it is the one question readGoal above cannot answer: readGoal returns null for
// a state file that is not there and for one that is there and could not be read
// alike, and a surface that tells an operator no goal is armed on the second of
// those is guessing rather than reading.
//
// Every surface that needs the distinction takes it from here. The CLI turns
// each non-file kind into its own sentence, so the two places it would otherwise
// print plain absence do not say "nothing armed" about a path with something
// sitting at it that a later arm will fail on with a raw errno; goalStateAbsent
// below is the boolean face, for the surfaces that choose between speaking and
// staying silent on absence alone.
//
// A speak-or-stay-silent surface is not automatically one of those, and the
// deferral nudge is the one that is not: it stands down only where the reading
// is UNCERTAIN, so it needs the kinds that are settled-but-not-absent
// ('unresolvable', 'oversized') on the speaking side and takes this question
// directly rather than through the boolean. So the boolean's caller set is the
// surfaces whose silence is owed to absence, not every surface with two
// directions.
//
// The errno split is pathErrnoClass's, the rule every caller of this question in
// the kit answers to. 'unresolvable' is what its 'determinate' leg produces, and
// that leg holds three codes: ENOTDIR, a regular file standing where a parent
// directory belongs; ELOOP, a link cycle above the final component; and
// ENAMETOOLONG.
//
// A regular file standing where the .kit directory belongs therefore reads two
// ways, by platform, and both readings are the platform's own. On POSIX the
// lstat through that file answers ENOTDIR, so the kind is 'unresolvable',
// goalStateAbsent is false, and every surface gated on it stays silent. On win32
// the same lstat answers ENOENT, so the kind is 'absent' and the state reads as
// plain absence. The win32 residual is loud rather than silent: the write an arm
// would then attempt fails on its own mkdir, so what the operator meets there is
// an arm that errors, never a surface claiming an arm landed.
//
// Never throws.
function goalPathKind(cwd) {
    let st;
    try {
        st = fs.lstatSync(goalPath(cwd));
    } catch (err) {
        const cls = pathErrnoClass(err && err.code);
        if (cls === 'absent') return 'absent';
        return cls === 'determinate' ? 'unresolvable' : 'unreadable';
    }
    if (!st.isFile()) return 'other';
    return st.size > GOAL_STATE_MAX_BYTES ? 'oversized' : 'file';
}

// Whether nothing at all is at the goal-state path: the boolean face of
// goalPathKind, true for its 'absent' answer alone. Every other kind, a file of
// any kind, an oversized one and one whose kind could not be read included, is
// false, so a surface gated on this one stays silent wherever its reading is
// uncertain. Never throws.
function goalStateAbsent(cwd) {
    return goalPathKind(cwd) === 'absent';
}

// The temporary path an atomic write in this file renames from, the local copy
// of kit-compact-lib.js's atomicTmpPath (see regularFileSize above for why it is
// a copy). The pid keeps two writers off one name (a CLI arm racing a Stop
// hook's bind); the random suffix keeps the name from being predictable, because
// a link pre-planted at a guessable tmp path would be followed by the write that
// creates it. The exclusive flag the write passes is what refuses an occupied
// path (the create fails with EEXIST rather than writing through it); the
// unguessable name is what keeps an attacker from winning that race repeatedly.
//
// The name carries a second property: the cleanup inside writeState deletes the
// tmp path on a failure, so an aimed name would be an aimed delete. That cleanup
// runs only for a tmp this process actually created, and unguessability is what
// keeps it from being pointed at anything in the first place. sweepStaleTmp
// below deletes on different terms and states them itself: any regular file in
// .kit/ carrying this writer's prefix and older than TMP_SWEEP_AGE_MS, whatever
// created it, since an orphan's creator is exactly what no later run can
// establish.
//
// What unpredictability costs is the one property the old pid-only name had: a
// process killed hard between the create and the rename leaves an orphan no
// later run can recognize as reclaimable by name, where a recycled pid used to
// take the same name and overwrite it. The sweep in writeState below is what
// replaces that, on age rather than on name.
function atomicTmpPath(target) {
    return target + '.tmp.' + process.pid + '.' + crypto.randomBytes(6).toString('hex');
}

// The room one history record can take, beyond the plan path it names: the JSON
// keys and indentation, an ISO timestamp, an outcome word, and a recorded
// blocker at safeForReason's 120-CHARACTER cap, which is 240 bytes once every
// character is a quote or a backslash and JSON escapes each to two. armGoal
// reserves this much per queued plan so a queue cannot arm within one advance of
// the writer's bound.
const HISTORY_RECORD_MAX_BYTES = 400;

// The room the fields written after the arm can take, all of which land before
// the queue finishes: boundSession and boundTranscript from a bind, and
// blockedAdvanceKey from a blocked advance, with their keys, quoting and
// indentation. Reserved once rather than per plan: each is a single field
// that is overwritten, never appended to. It is unconditional headroom rather
// than a per-field derivation, because an arm that binds its own session
// writes boundSession and boundTranscript at arm time, so those two are
// already inside the serialized state this budget is measured against and the
// reservation is then simply spare.
//
// Every term is in BYTES, and the caps the writers enforce are in UTF-16 CODE
// UNITS: bindSession caps sessionId at 128 units and validTranscript caps a
// transcript path at 512. A BMP code unit is up to 3 UTF-8 bytes (a surrogate
// pair is 2 units for 4 bytes, so 3 per unit is the worst case), and JSON
// escapes a quote or a backslash to two characters, so each capped field is
// budgeted at 6 bytes per code unit. blockedAdvanceKey is printable ASCII by
// its own gate, so it takes 1 byte per unit doubled. That is 128 x 6 = 768,
// plus 512 x 6 = 3072, plus 128 x 2 = 256, plus 320 for the three keys, their
// quoting and the indentation. blockedAdvancePlan holds one of the queue's own
// paths and is reserved beside the queue below, where the paths are measured.
const POST_ARM_MAX_BYTES = 4416;

// How old an abandoned temp file must be before a later write reclaims it. Far
// longer than any write takes (a single serialize, create and rename), with room
// for a writer suspended mid-write by a slow disk or a scanner. The residual it
// leaves is a writer stalled past this age: its in-flight temp is reclaimed by
// another process's sweep and its rename then fails ENOENT, which turns a very
// slow write into a reported failure rather than a silent one, and the caller
// retries at the next stop.
//
// What the sweep does not do is run on a schedule: it runs from writeState, so
// an orphan is reclaimed at the next goal-state write in that repo, and the
// orphan left by a run's last write survives until something arms, binds or
// advances there again.
const TMP_SWEEP_AGE_MS = 5 * 60 * 1000;

// How many directory entries one sweep may examine. The sweep runs on paths
// where cost is not free: the PreCompact gate reaches this writer before any
// verdict is emitted, and the Stop hook reaches it while holding a stop. A .kit/
// directory holds a handful of files, so this ceiling is never reached in
// practice; it is here so that a directory someone has filled cannot turn every
// goal-state write into a walk of it. The listing is read incrementally through
// opendirSync rather than readdirSync for the same reason: readdirSync
// materializes the whole directory before the first entry can be judged, so a
// ceiling on the loop alone would bound nothing.
const TMP_SWEEP_MAX_ENTRIES = 256;

// Remove temp files a previous write abandoned. Cleanup inside writeState covers
// every failure it can catch; a process killed between the create and the rename
// catches nothing, and the random suffix means no later run recognizes that file
// by name, so age is the only signal left (see atomicTmpPath). What that costs
// is the creator test: any regular file in .kit/ carrying this writer's prefix
// and older than TMP_SWEEP_AGE_MS is removed, whatever wrote it. The prefix is
// this file's own name plus '.tmp.', a name nothing else has reason to take, and
// the kind is judged by the same lstat rule every reader here uses, so a link or
// a directory someone parked in .kit/ is passed over rather than followed or
// removed.
//
// Wholly best-effort: it never throws and its result is never read. A sweep that
// cannot run leaves orphans, which is where the code stood before it existed.
function sweepStaleTmp(target) {
    let dir = null;
    try {
        const prefix = path.basename(target) + '.tmp.';
        const cutoff = Date.now() - TMP_SWEEP_AGE_MS;
        dir = fs.opendirSync(path.dirname(target));
        for (let seen = 0; seen < TMP_SWEEP_MAX_ENTRIES; seen += 1) {
            const entry = dir.readSync();
            if (entry === null) break;
            if (!entry.name.startsWith(prefix)) continue;
            const full = path.join(path.dirname(target), entry.name);
            try {
                const st = fs.lstatSync(full);
                if (!st.isFile() || st.mtimeMs > cutoff) continue;
                fs.unlinkSync(full);
            } catch { /* raced by another writer, or not ours to remove */ }
        }
    } catch { /* no directory yet, or it cannot be listed: nothing to sweep */ }
    if (dir) {
        try { dir.closeSync(); } catch { /* already closed, or never opened cleanly */ }
    }
}

// Write the goal state atomically (tmp file + rename), matching writeCheckpoint
// in kit-compact-lib.js: the tmp name is unique per writer and unpredictable
// (see atomicTmpPath), the create is exclusive so an existing path at that name
// fails the write instead of being written through, and a failed rename unlinks
// its tmp so orphans do not accumulate in .kit/. Returns { ok } or
// { ok:false, reason }: a filesystem failure is reported, never thrown, keeping
// the whole exported surface non-throwing.
//
// The reader's cap is enforced here too, on the bytes about to be written, so
// GOAL_STATE_MAX_BYTES bounds what this writer can produce rather than only what
// a reader will accept. Without it a long enough queue or history writes
// successfully, the CLI reports the goal armed, and every reader then refuses
// the file as oversized and reports no armed goal, with no error anywhere in
// between. Refusing at the write keeps a reader's refusal meaning one thing:
// the file is not ours.
//
// The cleanup deletes the tmp path only when this process created it, tracked by
// a flag set the moment the exclusive create returns rather than by the error's
// code. The catch spans both the create and the rename, and the two failures
// need opposite answers: an EEXIST from the create says the file was already
// there, so it is not this process's to remove, while a rename onto a non-empty
// directory reports EEXIST or ENOTEMPTY too, with this process's own freshly
// created tmp sitting there. Gating on the code would skip that one and orphan a
// full copy of the goal state, boundSession and boundTranscript included, under a
// new random name on every retry. The flag answers what the code cannot: who
// made the file. kit-compact-lib.js's writeCheckpoint carries the same gate for
// the same reason.
function writeState(cwd, state) {
    const gp = goalPath(cwd);
    try {
        const body = JSON.stringify(state, null, 2) + '\n';
        const bytes = Buffer.byteLength(body, 'utf8');
        if (bytes > GOAL_STATE_MAX_BYTES) {
            return {
                ok: false,
                reason: 'could not write goal state: the state is ' + bytes + ' bytes, past the '
                    + GOAL_STATE_MAX_BYTES + '-byte bound every reader of this file enforces'
            };
        }
        fs.mkdirSync(path.dirname(gp), { recursive: true });
        sweepStaleTmp(gp);
        const tmp = atomicTmpPath(gp);
        let created = false;
        try {
            // The create is its own call so the flag can mean what it says. A
            // single writeFileSync with the exclusive flag creates, writes and
            // closes together, so a failure in its write leg (a full disk, a
            // quota, an IO error) leaves the flag false with the file already on
            // disk, and the cleanup below then skips the partial copy of the goal
            // state it was written to remove.
            const fd = fs.openSync(tmp, 'wx');
            created = true;
            let wrote = false;
            try {
                fs.writeFileSync(fd, body, 'utf8');
                wrote = true;
            } finally {
                // The close is reached in two states and the flag tells them
                // apart. With the write already failed, a throwing close would
                // replace the error in flight and the reported reason would name
                // the close rather than the cause, so it is swallowed. With the
                // write returned, the close is the last point at which the OS can
                // report a deferred write error (a network volume, a quota), so it
                // is allowed to throw: swallowing it would publish a torn or
                // unflushed file while telling the caller the write succeeded.
                try {
                    fs.closeSync(fd);
                } catch (closeErr) {
                    if (wrote) throw closeErr;
                }
            }
            fs.renameSync(tmp, gp);
        } catch (err) {
            if (created) {
                try { fs.unlinkSync(tmp); } catch { /* already gone, or the path itself is unwritable */ }
            }
            throw err;
        }
    } catch (err) {
        return { ok: false, reason: 'could not write goal state: ' + (err && err.message ? err.message : String(err)) };
    }
    return { ok: true };
}

// Read the first 2KB of a plan file and classify its Status header.
// Returns { exists, status } where status is 'complete', 'in progress',
// 'ready', or 'unknown'. exists is false when the file cannot be opened at all.
//
// The path must read as a plan doc before it is opened, judged by
// planFileSize's kind rule, because the plan path arrives from the goal-state
// file and the Stop hook reaches this function while holding a stop.
// normalizeState's re-validation constrains where that path may point (inside
// the repo, no control characters), never what kind of thing sits there, so a
// FIFO at a perfectly well-formed in-repo plan path passes every check above and
// blocks a POSIX open until a writer appears. The size is not capped here
// because the read is a fixed 2 KB head, never the whole file.
//
// A refused path takes the existing absent-file return, which is the same shape
// an absent plan produces but NOT the same case, and a caller that acts on the
// difference asks planPathState, which parts the three.
function planHead(cwd, planRel) {
    const readings = planStatusReadings(cwd, planRel);
    return { exists: readings.exists, status: readings.status };
}

// Both readings of a plan doc's Status row, from one head read:
//
//   { exists, status, terminal }
//
// status is classifyPlanStatus's loose reading, the one the leash acts on, and
// terminal is planReadsTerminal's strict frozen-contract reading, the one the
// queue-position walk acts on. The two answer different questions and are
// allowed to disagree ('Complete (archived)' is complete and not terminal),
// which is exactly why a surface rendering both must take them from one call
// over one set of bytes: read separately, a screen can print a position walked
// under one rule beside a per-entry token classified under the other, with no
// way for its reader to tell which sentence used which. Never throws.
function planStatusReadings(cwd, planRel) {
    const head = planHeadText(cwd, planRel);
    if (!head.exists || head.text === null) {
        return { exists: head.exists, status: 'unknown', terminal: false };
    }
    return { exists: true, status: classifyPlanStatus(head.text), terminal: planReadsTerminal(head.text) };
}

// How much of a plan doc any header question here reads. A plan's header rows
// sit at the top by the machine contract the curating-docs skill freezes, so a
// fixed head answers every one of them, and the bound is what keeps a plan doc
// from ever being pulled into memory whole on a path the Stop hook crosses
// while holding a stop.
const PLAN_HEAD_MAX_BYTES = 2048;

// The head bytes of a plan doc at a repo-relative path, decoded and with a
// leading UTF-8 BOM stripped (PowerShell Set-Content writes one, and every
// header anchor below is line-start anchored, so an unstripped BOM would hide
// the first row). One read site for every question asked of a plan doc's Status
// row, so two readings of that row cannot disagree about which bytes they were
// asked of. It is not the file's only read of a plan doc: planAuthorization
// takes a far wider window for a different question, and states its own bound.
//
// { exists, text }, and the pair carries three outcomes rather than two, which
// is the distinction callers act on: exists false is a path that is not a
// readable plan doc at all (planFileSize's kind rule, or an open that failed),
// while exists true with a null text is a plan doc whose read failed after the
// open, which says nothing about the plan and must not read as an answer about
// its header. Never throws.
function planHeadText(cwd, planRel) {
    const full = path.join(cwd, planRel);
    // The path must read as a plan doc before it is opened, judged by
    // planFileSize's kind rule, because the plan path arrives from the
    // goal-state file: a FIFO at a well-formed in-repo plan path passes every
    // other check and would block a POSIX open until a writer appears.
    if (planFileSize(cwd, planRel) === null) {
        return { exists: false, text: null };
    }
    let fd;
    try {
        fd = fs.openSync(full, 'r');
    } catch {
        return { exists: false, text: null };
    }
    try {
        const buf = Buffer.alloc(PLAN_HEAD_MAX_BYTES);
        const bytes = fs.readSync(fd, buf, 0, PLAN_HEAD_MAX_BYTES, 0);
        let head = buf.toString('utf8', 0, bytes);
        if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
        return { exists: true, text: head };
    } catch {
        return { exists: true, text: null };
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
    }
}

// The Stop hook's reading of a plan doc's Status header: 'complete', 'in
// progress', 'ready', or 'unknown'. Deliberately looser than the frozen machine
// contract planReadsTerminal below answers to, and the two are separate
// because they decide different things. This one decides whether a leash
// releases or advances, where a header carrying trailing text after Complete
// ("Complete (archived)") is a plan whose author called it finished, and
// holding every stop of a finished run over the parenthetical is the more
// expensive error. planReadsTerminal decides whether a queue entry a reporting
// surface is standing on may be counted as finished on the filesystem's
// evidence alone, with no author in the loop, so it takes the strict contract:
// the position walk evaluates the entry at the stored index FIRST and then
// everything forward of it, so the strict rule governs the current plan and its
// successors rather than anything already behind the leash.
//
// The consequence of the two rules meeting on one plan is worth naming, because
// it is a state an operator will see: a current plan whose header reads
// 'Status: Complete (archived)' is finished to the leash, which advances or
// releases on it, and unfinished to both reporting surfaces, which keep
// reporting it as the current position until the stop that moves the index.
function classifyPlanStatus(head) {
    // A non-string head has no header to classify, the same guard the strict
    // twin below takes. Every caller today reads through planHeadText and
    // checks for text first, so this is the shape of the contract rather than
    // a live path.
    if (typeof head !== 'string') return 'unknown';
    // Classify from the Status header only: anchored to a line start (m flag)
    // so body prose cannot match, and the value must sit on the same line as
    // the header ([^\S\r\n]* is horizontal whitespace only, never a newline),
    // so a bare "Status:" line above a line beginning "Complete" or "in
    // progress" does not misclassify the plan. A leading UTF-8 BOM (PowerShell
    // Set-Content writes one) is stripped by the reader so the anchor sees the
    // header. The Status header sits on its own line near the top by convention.
    //
    // Ready is the value of a plan that is authored and deliberately parked
    // before any run starts. It is a value of its own rather than an
    // unrecognized one so a reporting surface can list such a plan as parked
    // instead of not listing it at all, which is what hides finished, ready
    // work from every recovery surface. It ranks below the two started
    // readings: a doc carrying Ready alongside In Progress or Complete is one
    // somebody began, and reporting a run in flight as parked is the more
    // expensive error.
    //
    // Ready is the one leg that does not take its siblings' bare prefix match.
    // It must be the whole value, optionally followed by a parenthetical
    // ("Ready (parked pending the design round)"), because unlike Complete and
    // In Progress this word has ordinary English continuations that reverse
    // what it claims: "Ready for review", "Ready to merge" and "Ready to
    // archive" all name work somebody already did, and classifying them as
    // parked would have every reporting surface assert of them that the plan
    // is written and not started. Those fall through to 'unknown', the same
    // answer any other unrecognized value gets.
    const inProgress = /^status:[^\S\r\n]*in[^\S\r\n]*progress/im.test(head);
    const complete = /^status:[^\S\r\n]*complete/im.test(head) && !inProgress;
    const ready = /^status:[^\S\r\n]*ready[^\S\r\n]*(?:\([^)\r\n]*\)[^\S\r\n]*)?\r?$/im.test(head);
    if (complete) return 'complete';
    if (inProgress) return 'in progress';
    if (ready) return 'ready';
    return 'unknown';
}

// The directory a plan is armed from, and the one a close-out files it under.
// The move between them is the second of the two pieces of evidence a queue
// entry can be read as finished on; the first is the entry's own Status row.
const PLANS_DIR = 'docs/plans/';
const ARCHIVE_DIR = 'docs/archive/';

// Where a queued plan path's doc lands when a close-out files it, or null when
// there is no archive location to ask about. A goal may be armed over any
// in-repo path, and an entry outside docs/plans/ has no archived counterpart:
// such an entry carries no archived evidence, so it is reported at its position
// rather than counted finished behind the reader's back.
//
// The derived path is round-tripped through normalizePlanArg before it is
// returned, the same guard every reader of a stored plan path applies, so this
// function is safe on its own terms whatever calls it. The slice alone is a
// text operation over a value that reached the caller from a JSON file: an
// entry spelled docs/plans/../../../evil.md passes the bare prefix test and
// would yield an archive target outside the repository, which the callers would
// then stat and open. Containment is this function's own to prove rather than
// its callers' to promise.
function archivePathFor(cwd, planRel) {
    if (typeof planRel !== 'string' || !planRel.startsWith(PLANS_DIR)) return null;
    const tail = planRel.slice(PLANS_DIR.length);
    if (tail === '') return null;
    const filed = ARCHIVE_DIR + tail;
    return normalizePlanArg(cwd, filed) === filed ? filed : null;
}

// Whether a plan doc's head reads terminal under the machine contract the
// curating-docs skill freezes: the first Status row above the first '##'
// heading is the one read, and its value must be exactly Complete as a whole
// string, case-insensitively. 'Complete (archived)' does not terminate, in the
// contract's own words, because trailing text makes a different claim (where
// the doc has been filed) from the one being read here (that the work is
// finished).
//
// Three legs sit beyond the value compare, each closing a way this could
// answer yes on something that is not the header. Only the text above the
// first '##' heading is searched, so a Status row quoted inside a Chapter
// cannot answer for the document. The FIRST such row wins, so a later one
// cannot override the header. And the row must be terminated by a newline
// inside the head window, so a header pushed to the window's own bound never
// reads terminal on a value the window cut in half.
function planReadsTerminal(head) {
    if (typeof head !== 'string') return false;
    const heading = /^##/m.exec(head);
    const front = heading ? head.slice(0, heading.index) : head;
    const row = /^status:([^\r\n]*)\r?\n/im.exec(front);
    return row !== null && row[1].trim().toLowerCase() === 'complete';
}

// Note a path a position walk is about to read, on the walk's own record of
// what it consulted, when a caller asked for that record.
//
// The record exists for a caller that caches a render keyed on ONE plan doc
// and must know whether the position in it came from anywhere else: the walk
// falls through to a plan's archived copy and advances through finished
// entries, and none of those other files is in such a key. Reported rather
// than re-derived, because a caller that
// re-derived it would be spelling this file's branch rules a second time and
// the two spellings would part at the next input this walk learns to read.
//
// A pair is recorded where the read happens rather than where a branch is
// chosen, so a path a branch considered and never opened is not in the record.
// The list is bounded by the walk itself: each scanned queue entry reads at
// most two paths in the one tree the leash lives in, the plans path and the
// archived copy, so QUEUE_POSITION_MAX_SCAN x 2 pairs. It is one pair long
// for the healthy case that dominates, an armed plan standing live at its own
// plans path.
function recordConsulted(consulted, root, rel) {
    if (Array.isArray(consulted)) consulted.push({ root, rel });
}

// What one checkout's filesystem says about a queued plan entry:
//
//   'complete'  the doc's own header reads terminal, or the doc has moved to
//               docs/archive/ with nothing left at the plans path AND the
//               archived copy's own header reads terminal too
//   'live'      a readable plan doc stands at the plans path and does not read
//               terminal
//   'absent'    neither path holds anything
//   'unknown'   something this tree cannot settle right now stands at one of
//               the paths: a kind that is not a plan doc, or a stat refused by
//               a lock, a permission or a scanner
//
// The fourth state is the one worth spelling out, because collapsing it into
// 'absent' is how a transient errno becomes a claim that a plan was archived.
// It is evidence of neither finished nor missing, so every caller here reads
// it as an entry that is present and unfinished, the direction that
// under-reports progress rather than reporting past live work. Never throws.
//
// consulted is the optional record every path this reading actually opened is
// noted in (recordConsulted states what it is for). It is written to rather
// than returned because the paths are read at two depths here, the plans path
// and the archived copy, and a caller that had to infer which of them ran
// would be re-deriving this function's own branches.
function treeEntryState(root, planRel, consulted) {
    try {
        recordConsulted(consulted, root, planRel);
        const head = planHeadText(root, planRel);
        if (head.exists) {
            if (head.text === null) return 'unknown';
            return planReadsTerminal(head.text) ? 'complete' : 'live';
        }
        // planHeadText refuses on the kind rule as well as on absence, so the
        // cases are parted by planPathState, the classification every reader of
        // a plan path here answers to.
        if (planPathState(root, planRel) !== 'gone') return 'unknown';
        const filed = archivePathFor(root, planRel);
        if (filed === null) return 'absent';
        recordConsulted(consulted, root, filed);
        // planFileSize answers 0 for an absent path and null for one that
        // cannot be read as a plan doc. A zero-byte file standing at the
        // archive path answers 0 too and so reads as absent: it is
        // indistinguishable from nothing here, and an empty file is no record
        // of a finished plan anyway.
        const size = planFileSize(root, filed);
        if (size === null) return 'unknown';
        if (size === 0) return 'absent';
        // The archived copy is HELD TO THE SAME BAR as a doc still in
        // docs/plans/: its header must read terminal. Presence alone is not
        // evidence, because the two paths carry the same name and nothing ties
        // the file under docs/archive/ to this plan beyond that name. A plan doc
        // DELETED rather than filed, with a same-named doc from an earlier
        // effort already in the archive, would otherwise read finished here and
        // move the reported position past live work in silence, which is the
        // one outcome the archived copy's own header check exists to prevent.
        const filedHead = planHeadText(root, filed);
        if (!filedHead.exists || filedHead.text === null) return 'unknown';
        // Present and not terminal is the same answer a live doc at the plans
        // path gives: something stands for this entry and it does not read
        // finished, so the walk stops on it rather than counting it either way.
        return planReadsTerminal(filedHead.text) ? 'complete' : 'live';
    } catch {
        return 'unknown';
    }
}

// Whether a queue entry is finished, asked of the tree the leash lives in, as
// { state, cause }. state is 'complete', 'pending', or 'unresolvable' (nothing
// can be read about the entry at all), and cause names WHY an unresolvable one
// is unresolvable, so a reporting surface can say something true about it:
//
//   'unreadable-path'  the entry does not round-trip the plan-path normalizer,
//                      so no reader here will resolve it against the tree
//   'unarchivable'     the entry is not armed from docs/plans/, so its own path
//                      is the only place it could be, and nothing is there
//   'neither'          its doc is in neither docs/plans/ nor docs/archive/
//
// cause is null for the two resolvable states. Naming it here rather than at
// each surface is what keeps a message from describing the wrong directories:
// the sentence "in neither docs/plans/ nor docs/archive/" is false of an entry
// that was never armed from either.
//
// The entry is re-validated against the normalizer before the tree is asked,
// the same round-trip readGoal applies, kept here so this function is safe on
// its own terms whatever calls it: the entries arrive from a JSON file, and a
// caller that passed a raw state rather than a normalized one would otherwise
// have this walk stat and open paths outside the repository.
//
// One tree answers, and it is the caller's own: the leash and the plan docs
// it queued live in the same working tree, so a sibling checkout's copy of the
// same plan is another execution stream's business and says nothing about this
// queue. A branch that has not merged, or a plan archived in one tree and live
// in another, moves this reading not at all. Never throws.
//
// consulted is the walk's optional record of the paths actually read, passed
// through to the reading that does the reading. The early return above it
// opens nothing and so records nothing.
function queueEntryState(cwd, planRel, consulted) {
    if (normalizePlanArg(cwd, planRel) !== planRel) {
        return { state: 'unresolvable', cause: 'unreadable-path' };
    }
    const here = treeEntryState(cwd, planRel, consulted);
    if (here === 'complete') return { state: 'complete', cause: null };
    if (here === 'absent') {
        return {
            state: 'unresolvable',
            cause: archivePathFor(cwd, planRel) === null ? 'unarchivable' : 'neither'
        };
    }
    return { state: 'pending', cause: null };
}

// How many queue entries a position walk will settle before it stops asking.
// Each entry costs a file open or two, on paths that run at every session start
// and at every status report, so the walk is bounded rather than proportional
// to a queue an operator may have armed dozens of plans into.
//
// A walk that exhausts the bound has read every one of those entries as
// finished and reports the NEXT one, which it never evaluated. That is the
// conservative end of the evidence rather than a claim about the entry: naming
// the last entry it did read would report a plan it just established is
// finished. Nothing was read about the reported entry either way, so such a
// walk reports no unresolvable label and no finished flag, and the position it
// gives is the earliest one the evidence leaves open.
const QUEUE_POSITION_MAX_SCAN = 16;

// The queue position a reporting surface shows: the first entry from the
// stored index onward that the plan docs themselves do not report as finished.
//
// The stored index only ever moves at a clean stop of the bound session (the
// Stop hook is advanceGoal's one caller), so a run that dies at its close-out,
// or one whose bound session never stops again, leaves the index frozen on a
// plan that is finished and archived, with no path in the system that repairs
// it. Every surface that reported the stored index at face value then told the
// operator, and the next session, that the run sits on a plan it finished
// yesterday. So position is READ from the world here rather than trusted from
// the file.
//
// The walk only ever moves FORWARD from the stored index, and that is a rule
// rather than an implementation detail: an entry behind the stored position
// may be unfinished for a reason the leash already adjudicated (a blocked
// advance moves past a plan that never went Complete), and reporting a
// position behind the leash's own would re-open work the operator decided to
// leave. Reading forward can only ever agree with the leash or catch it up.
//
// Returns { index, stored, healed, positional, unresolvable, cause, finished,
// consulted }:
//
//   index         the position to report
//   stored        the stored index the walk started from, clamped into the
//                 queue, which a surface names beside a corrected position so
//                 the gap between the two is visible rather than papered over
//   healed        how many finished entries the walk moved past (0 on every
//                 healthy state, where the first entry read is the current plan
//                 and it is not finished)
//   positional    whether this queue holds more than one plan, and so whether a
//                 claim ABOUT a position among several says anything at all.
//                 Spelled once here rather than at each surface, because two
//                 surfaces that answered it differently would report the same
//                 queue of one two different ways
//   unresolvable  whether the entry AT the reported position is one no tree can
//                 resolve
//   cause         queueEntryState's cause for that unresolvable entry, or null
//   finished      whether the entry AT the reported position itself reads
//                 finished, which is the whole-queue-finished state: the walk
//                 pins at the last entry and the leash RELEASES at the bound
//                 session's next stop rather than advancing, so a surface that
//                 reported the position alone would describe work remaining
//                 where none does
//   consulted     every { root, rel } pair this walk actually read, in the
//                 order it read them, so a surface caching a render keyed on
//                 one plan doc can tell whether the position in it came from
//                 anywhere else (recordConsulted states the whole rule and the
//                 bound). A walk that threw keeps the pairs it had already
//                 read, since it did read them
//
// An unresolvable entry stops the walk and keeps its position, never being
// skipped: skipping it would renumber the queue around a plan whose absence is
// the very thing the operator needs told. Nothing here writes: this reports the
// truth over a stale file rather than repairing it. Never throws.
function queuePosition(cwd, state) {
    let stored = 0;
    let index = 0;
    let entry = null;
    let positional = false;
    const consulted = [];
    try {
        if (!state || typeof state.plan !== 'string' || state.plan === '') {
            return empty();
        }
        const queue = Array.isArray(state.queue) ? state.queue : [];
        if (queue.length === 0) return empty();
        positional = queue.length > 1;
        stored = Number.isInteger(state.queueIndex) && state.queueIndex >= 0
            && state.queueIndex < queue.length ? state.queueIndex : 0;
        index = stored;
        const last = queue.length - 1;
        for (let scanned = 0; scanned < QUEUE_POSITION_MAX_SCAN; scanned++) {
            entry = queueEntryState(cwd, queue[index], consulted);
            if (entry.state !== 'complete' || index === last) break;
            index++;
            entry = null;
        }
    } catch {
        // A walk that threw has no evidence for the ground it covered, so it
        // keeps none of it: the stored index is still a position, and reporting
        // it is exactly today's behavior.
        index = stored;
        entry = null;
    }
    return {
        index,
        stored,
        healed: index - stored,
        positional,
        unresolvable: entry !== null && entry.state === 'unresolvable',
        cause: entry !== null && entry.state === 'unresolvable' ? entry.cause : null,
        finished: entry !== null && entry.state === 'complete',
        consulted
    };
}

// The answer for a state carrying no queue to have a position in. Nothing was
// read to reach it, so its record of consulted paths is empty.
function empty() {
    return {
        index: 0, stored: 0, healed: 0, positional: false,
        unresolvable: false, cause: null, finished: false, consulted: []
    };
}

// How much of a plan doc the authorization scan reads. A Dispatch Authorization
// section sits in a plan's front matter, above the sections of work, but the
// header, the goal and the approach can precede it, so the window is far wider
// than planHead's 2 KB Status window and still a fixed bound rather than the
// whole file: this read happens once per plan at arm time, and a plan doc is
// prose no reader of this file ever needs whole.
const AUTHORIZATION_SCAN_MAX_BYTES = 16 * 1024;

// The Dispatch Authorization heading, anchored to a line start so body prose
// naming the section cannot match, with the value required to be the whole line
// ([^\S\r\n] is horizontal whitespace only, never a newline).
const AUTHORIZATION_HEADING = /^##[^\S\r\n]*Dispatch Authorization[^\S\r\n]*$/im;

// The sections-of-work heading, which bounds where an authorization may be
// asserted. The section is front matter: a plan states who authorized arming it
// above the work, and a heading of this name below the sections is prose about
// the format rather than a claim. Any heading level matches, since the level a
// plan writes its sections at is a formatting choice and the ordering is the
// point.
const SECTIONS_HEADING = /^#{1,6}[^\S\r\n]*Sections of Work[^\S\r\n]*$/im;

// A heading line, as the section body's terminator. It matches exactly what
// AUTHORIZATION_HEADING matches structurally, hashes then optional horizontal
// whitespace then content, because the two answer the same question about the
// same syntax: where they disagreed about a heading written with no space after
// its hashes, the body ran on past the next heading and the FOLLOWING section's
// first sentence was recorded as this plan's authorization, a claim the plan
// never made. The content character excludes '#' so a rule line of seven or more
// hashes, which is no heading, does not read as one.
const HEADING_LINE = /^#{1,6}[^\S\r\n]*[^\s#]/m;

// An opening or closing code fence, allowing markdown's three spaces of indent.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

// The text with every fenced code block's content replaced by spaces, one
// character for one character so every offset and line break is where it was.
//
// A plan doc that ILLUSTRATES the authorization format carries the heading
// inside a fence, and a purely lexical match reads that illustration as the
// plan's own claim: the state file then records an authorization the plan never
// asserted, and every surface that prints it presents it as one. Masking rather
// than skipping keeps the rest of this function's arithmetic unchanged.
//
// A fence opened and never closed inside the scan window masks everything after
// it. That is the conservative direction: what is inside an unterminated fence
// cannot be told from what follows it, and an authorization is a claim worth
// refusing when its context is unreadable.
function maskFencedRegions(text) {
    let fence = null;
    return text.split('\n').map((line) => {
        const open = FENCE_LINE.exec(line);
        if (fence === null) {
            if (open === null) return line;
            fence = open[1];
            return ' '.repeat(line.length);
        }
        if (open !== null && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
        return ' '.repeat(line.length);
    }).join('\n');
}

// The first sentence of a plan doc's Dispatch Authorization section, screened
// for storage, or null when the plan carries no such section or nothing
// printable under it.
//
// The sentence is the plan's own claim about who authorized arming it, and it is
// stored as provenance rather than as a credential: nothing here authenticates
// the writer, and the file's content is taken at its word for the audit trail
// the status report and the doctor surface. Git history is what makes the claim
// traceable.
//
// The heading is matched structurally rather than lexically: it must sit outside
// every fenced code block (see maskFencedRegions) and above the plan's sections
// of work. Both conditions exist for one reason: a plan doc that shows what the
// section looks like, in a fence or in a section about the format, asserts
// nothing, and recording its example would put a grant in the state file that no
// plan ever made.
//
// The section body runs to the next heading of any level, its first sentence
// ends at the first period, question mark or exclamation mark followed by
// whitespace or the end of the body, and the whitespace inside it is flattened,
// because the stored value is a single line in a file whose readers print it.
// Every scan is a bounded search or a literal replace rather than a pattern
// spanning the untrusted text, so a plan doc cannot cost this more than its own
// length. The masked text is what every search runs against, including the
// sentence itself, so a section whose body is only a fence reads as nothing
// printable under the heading rather than as a quoted code block.
//
// truncated says whether text is a cut head of the plan doc rather than the
// whole of it, which its caller knows and this function cannot see. It answers
// one question: whether the end of the body in hand is the end the plan wrote.
// Three things have to hold at once for the answer to be no. The text is cut, no
// heading follows the section inside it, and the body carries no sentence
// terminator, which together say the body ran to the window's edge and its end
// is simply unseen. Such a body is a fragment, and recording it would store part
// of a sentence as the plan's whole claim, exactly what the storage cap's own
// mark exists to prevent one step later, so it records nothing.
//
// A following heading is what settles the ordinary case, because it is the
// evidence that the section ended inside the window: the body is bounded by
// something the scan actually saw, so it is whole whatever its punctuation, and
// a terminator-less line there is the section's own claim rather than a cut one.
// A plan doc past the scan window is otherwise ordinary, and refusing every
// terminator-less section in one would drop grants those plans really made. The
// same reasoning covers a plan doc read whole, where nothing was cut at all.
//
// safeForAuthorization is what screens it: the same printable-ASCII rule every
// other caller-supplied string stored in this file answers to, at its own cap,
// which that constant states its reason for. It is the stricter of the two
// screens in the kit (the status line's terminal sanitizer admits ordinary
// non-ASCII text, which a name shown to a person needs and a quoted sentence
// entering a model's context does not), and the strictness is what this value
// earns: it is untrusted file content on its way into a state file several
// surfaces print.
function authorizationSentence(text, truncated) {
    const scanned = maskFencedRegions(text);
    const heading = AUTHORIZATION_HEADING.exec(scanned);
    if (heading === null) return null;
    const sections = SECTIONS_HEADING.exec(scanned);
    if (sections !== null && sections.index < heading.index) return null;
    let body = scanned.slice(heading.index + heading[0].length);
    const next = body.search(HEADING_LINE);
    if (next !== -1) body = body.slice(0, next);
    body = body.replace(/^\s+/, '');
    if (body === '') return null;
    const stop = body.search(/[.!?](\s|$)/);
    if (stop === -1 && next === -1 && truncated) return null;
    const sentence = (stop === -1 ? body : body.slice(0, stop + 1)).replace(/\s+/g, ' ').trim();
    const safe = safeForAuthorization(sentence);
    return safe === '' ? null : safe;
}

// The authorization provenance recorded for a plan at the moment it is queued,
// or null when the plan records none. Every failure to read the plan answers
// null too: the field is an audit trail, and a plan that could not be read for
// it has recorded no authorization, which is exactly what null says. The arm
// itself is refused elsewhere over an unreadable plan, so a null here never
// stands in for a plan the caller was told was fine.
//
// The open is guarded by planFileSize's kind rule, as every read of a plan path
// in this file is, so a FIFO or a link out of the repo at a queued plan path is
// refused before any open. The read is spelled here rather than shared with
// planHead because the two answer differently to a read that fails: planHead
// reports the file present with an unknown status, where an unread section is
// simply no authorization.
function planAuthorization(cwd, planRel) {
    if (planFileSize(cwd, planRel) === null) return null;
    let fd;
    try {
        fd = fs.openSync(path.join(cwd, planRel), 'r');
    } catch {
        return null;
    }
    try {
        // The size that decides the question below is the descriptor's own,
        // taken after the open: the screen above stats a path, and anything
        // that swapped or grew the file between that stat and this open would
        // have the answer decided about a different file.
        const size = fs.fstatSync(fd).size;
        const buf = Buffer.alloc(AUTHORIZATION_SCAN_MAX_BYTES);
        const bytes = fs.readSync(fd, buf, 0, AUTHORIZATION_SCAN_MAX_BYTES, 0);
        let head = buf.toString('utf8', 0, bytes);
        if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
        // What authorizationSentence needs to know is whether this head is a
        // PREFIX of the doc, so that a trailing sentence carrying no terminator
        // is a sentence something cut rather than the section's own short line.
        // Fewer bytes than the file holds is that question exactly, and it
        // answers both ways a prefix arises: a doc longer than the window, and
        // a read that came back short of one no larger than it. A read holding
        // every byte of the file is not a prefix however large the file is,
        // window-sized included, so it is not judged one.
        return authorizationSentence(head, bytes < size);
    } catch {
        return null;
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
    }
}

// The single source of the canonical goal condition text. planRel is the
// repo-relative forward-slash plan path already validated by armGoal. This
// text is descriptive and has no reader in this tree: it is written for a
// person, or a session, opening goal-state.json. The deterministic Stop hook
// enforces via file and transcript signals rather than by parsing it, and
// composes its own block reason, so this clause (a) wording need not mirror
// the hook's exact Complete-or-archived check.
//
// authority is who armed THIS plan, 'self' or 'operator', resolved by the
// caller (planArmedBy reads a state's own map, and armGoal refuses any other
// value at the point a caller supplies one). It decides which arming the text
// records, because the two carry different authority and the file must not
// assert one the arming did not have. An operator's arming is a person's own
// act, so its text carries the per-run parallelization request (subagent
// dispatch and Workflows) and that request rides with the goal state across
// session swaps. A self-arming is an invocation the run made for itself, which
// no keystroke accompanies: its text records that the invocation declared
// itself the run's own, which is all the state holds, and asserts nothing about
// what authorized any plan (the authorizations map records that, per plan, from
// the plan doc). It then points at the skill rather than restating what an
// arming carries, so nothing in the file states a request the operator never
// made.
//
// queue and queueIndex are optional and describe the armed sequence this plan
// belongs to. When plans remain after this one, the text gains the queue
// context: the position, the plans still to come, and that each runs to
// Complete or a recorded BLOCKED: before the next begins. A single plan, or
// the last plan of a queue, has nothing remaining and reads exactly as a solo
// arming does. The queue context is a property of the queue, so both armings
// take it identically.
const OPERATOR_ARMING_TEXT = "Arming is Scott's request for this run: reduce wall-clock time by "
    + 'parallelizing work that can run simultaneously, via subagent dispatch '
    + 'and via Workflows. ';

// The self spelling states one fact, the one the state holds: the invocation
// that armed this plan declared itself the run's own rather than a person's.
// It names no plan, claims no grant and identifies no session, because none of
// those is established by anything the CLI saw.
const SELF_ARMING_TEXT = 'Arming is recorded as this run\'s own rather than as a request Scott '
    + 'typed, as the arming invocation declared it. The kit-goal skill states what an '
    + 'arming carries; read it there rather than from this text. ';

function composeCondition(planRel, queue, queueIndex, authority) {
    const remaining = Array.isArray(queue) && Number.isInteger(queueIndex)
        ? queue.slice(queueIndex + 1)
        : [];
    const tail = remaining.length === 0 ? '' : ' This plan is ' + (queueIndex + 1)
        + ' of ' + queue.length + ' in an armed queue; still to come after it: '
        + remaining.join(', ') + '. Each plan runs to Complete or a recorded '
        + "'BLOCKED:' before the next begins, and the leash advances to the next "
        + 'plan on its own: no re-arming, and the run continues in this session.';
    const arming = authority === 'self' ? SELF_ARMING_TEXT : OPERATOR_ARMING_TEXT;
    return 'Work ' + planRel + ' to completion using executing-work. ' + arming
        + 'Met when (a) every section is complete and closed out, or '
        + '(b) you are BLOCKED on a decision only Scott can make and have said so. '
        + 'Capacity is never a blocker: auto-compaction rides through with the '
        + 'leash intact. Waiting on dispatched background work is a pause, not a '
        + "stop: lead with 'WAITING:' and what you await; the leash stays armed "
        + 'and the completion notification resumes the run.' + tail;
}

// Normalize a plan argument (relative or absolute) to a repo-relative,
// forward-slash path. Returns null if the argument carries control characters
// or the resolved path escapes cwd.
function normalizePlanArg(cwd, planArg) {
    // Reject any control character up front: the plan path is written into
    // goal-state.json, which the hooks surface back into the model's context, so
    // a path carrying newlines or control bytes could smuggle instructions into
    // a trusted channel. Windows filenames cannot hold these; this closes the
    // POSIX case and matches the sibling hooks' sanitize-before-trust rule.
    if (typeof planArg !== 'string' || /[\x00-\x1F]/.test(planArg)) {
        return null;
    }
    const abs = path.resolve(cwd, planArg);
    const rel = path.relative(cwd, abs);
    // Reject a path that resolves to cwd itself, escapes it via a real `..` path
    // segment (not merely a name beginning with two dots, e.g. `..notes.md`), or
    // lands on another drive (path.relative yields an absolute path when no
    // relative route exists).
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        return null;
    }
    return rel.split(path.sep).join('/');
}

// A caller-supplied path rendered safe for a reason string: printable ASCII,
// capped. Reason strings reach stderr and, through the Stop hook, the model's
// context, so an offending path is named in a form that cannot carry more than
// its own characters.
function safeForReason(value) {
    return String(value).replace(/[^\x20-\x7E]/g, '').slice(0, 120);
}

// The room an authorization sentence gets, which is deliberately not
// safeForReason's. That cap is sized for a path named inside an error line,
// where 120 characters is generous; an authorization sentence is prose written
// to be read, and the sentences plans actually carry run past 120 (the first
// plan to carry one records 268 characters, quoting the operator's own words).
// A sentence cut mid-clause is worse than none, because it reads as whole: the
// value's entire job is to let a reader judge a claim about who authorized
// arming, and half a claim cannot be judged. 320 leaves headroom above the
// observed length without inviting a paragraph.
//
// Nothing else changes: the printable-ASCII rule is the same one, and this is
// still the stricter of the kit's two screens, since the status line's terminal
// sanitizer admits ordinary non-ASCII where a quoted sentence entering a
// model's context does not. The cap is what differs, because the two values
// differ.
const AUTHORIZATION_MAX_CHARS = 320;

// What a value cut by the cap ends in, so a reader sees the cut. A sentence
// stopped at the cap and stored bare reads as the whole claim, which is the
// failure the cap's own derivation names one line up: a claim that is judged
// whole and is not is worse than none at all.
//
// The mark is written INSIDE the cap, replacing the last of the content rather
// than being added past it, so a marked value measures exactly
// AUTHORIZATION_MAX_CHARS. That is what keeps the screen idempotent, which it
// has to be: normalizeAuthorizations re-applies it to the stored value on every
// read of the state file, and a mark the next read cut off would turn a marked
// truncation back into a silent one.
const AUTHORIZATION_TRUNCATION_MARK = ' ...[truncated]';

function safeForAuthorization(value) {
    const printable = String(value).replace(/[^\x20-\x7E]/g, '');
    if (printable.length <= AUTHORIZATION_MAX_CHARS) return printable;
    return printable.slice(0, AUTHORIZATION_MAX_CHARS - AUTHORIZATION_TRUNCATION_MARK.length)
        + AUTHORIZATION_TRUNCATION_MARK;
}

// The key two plan paths are compared as for the purpose of deciding whether a
// queue already holds one. Case-folded on Windows, where the filesystem is
// case-insensitive and two casings of one path name one file: a queue holding
// both would advance past the plan once and stall on the repeat, which is the
// shape both duplicate refusals exist to stop. One definition, so an arm and an
// append cannot disagree about what a duplicate is.
function queueKey(rel) {
    return process.platform === 'win32' ? rel.toLowerCase() : rel;
}

// One plan argument validated for a queue, as { ok:true, rel } or
// { ok:false, reason }. Shared by arming and appending, so a path that cannot
// enter a queue one way cannot enter it the other: the containment rule, the
// three unreadable states parted by planPathState, and the refusal of a plan
// already Complete are one rule at one site.
function validatePlanArg(cwd, arg) {
    const rel = normalizePlanArg(cwd, arg);
    if (rel === null) {
        return { ok: false, reason: 'plan path is invalid or outside the repo: ' + safeForReason(arg) };
    }
    const head = planHead(cwd, rel);
    if (!head.exists) {
        // planHead answers the same 'no' for three states an operator would act
        // on differently: nothing is at the path, something that is not a plan
        // doc is at it, or the path is there and could not be read right now (a
        // scanner or an indexer holding it, which lifts on its own).
        // planPathState parts them by the shared rule, and these are its three
        // wordings: reporting a locked plan doc as one that does not hold a plan
        // file sends the operator to fix a file that is fine, and reporting a
        // path that can never resolve as one to retry names a condition no
        // amount of waiting resolves.
        const state = planPathState(cwd, rel);
        if (state === 'gone') {
            return { ok: false, reason: 'plan not found: ' + rel };
        }
        if (state === 'unusable') {
            return { ok: false, reason: 'plan path does not hold a plan file: ' + rel };
        }
        return { ok: false, reason: 'plan path could not be read right now: ' + rel };
    }
    if (head.status === 'complete') {
        return { ok: false, reason: 'plan is already Complete: ' + rel };
    }
    return { ok: true, rel };
}

// Whether a queue's own progress fits the writer's bound, judged on the state
// about to be written plus room for every record that queue can still produce.
//
// Each advance appends a history record while the condition's remaining tail
// sheds one path, a net growth, so a queue that fits exactly today crosses the
// bound on an advance: writeState would then refuse deterministically, the Stop
// hook would block at every stop reporting that the advance could not be
// recorded, and the run could neither advance nor release without a manual
// clear. That failure is permanent rather than degrading, so the room is
// reserved at the one moment a person is present to read the refusal, which is
// the arm or the append that grows the queue.
//
// Every term is counted in BYTES, the unit the budget is in: a path is measured
// with Buffer.byteLength and doubled, because JSON escapes a quote or a
// backslash in a filename to two bytes each, and the same doubling is already
// inside HISTORY_RECORD_MAX_BYTES for the note. The fields a bind or a blocked
// advance add after the arm are reserved once in POST_ARM_MAX_BYTES, which
// states its own derivation; the one such field that carries a plan path,
// blockedAdvancePlan, is reserved here instead, against the longest path in the
// queue, because that is where the paths are measured.
//
// The condition takes a reservation of its own, because every advance rewrites
// it for the plan the leash moves to and it can come back longer two ways: it
// names that plan's path once, hence the reservation against the longest path
// in the queue, and it carries one of two fixed arming spellings, the self one
// being the longer, so an advance onto a self-armed plan grows the text by that
// measured difference. Both terms are reserved unconditionally rather than only
// where the queue already holds a self-armed plan, because an append can add
// one after this budget was judged.
//
// The armedBy map is measured rather than reserved: it is written at the arm,
// one short value per queued plan, so the serialization below already counts
// it, and an append that adds entries re-runs this whole judgment on the state
// it is about to write. armingSession is measured on the same terms and takes
// no reservation of its own: it is a single arm-time field holding a
// session-id-shaped value or null, no later write grows it, and the arm's own
// judgment below runs on the state literal that already carries it.
//
// The reservation runs where a queue grows, so a queue armed before it existed
// carries none: such a state reads back fine under the cap and can still meet
// writeState's refusal on a later advance. That takes a standing queue in the
// low hundreds of plans, a bound rather than a figure because the count follows
// the plan paths' own lengths and the blockers the advances record. Such a state
// predates the authorization map too, so it reads back with an empty one and its
// growth is the history records alone; a state arming a queue today carries a
// recorded sentence per plan, which queueFits measures as part of the serialized
// state below. The recovery is /kit-goal clear followed by a fresh arm, which the
// refusal's own wording points at.
function queueFits(state) {
    let reserved = POST_ARM_MAX_BYTES;
    let longest = 0;
    for (const rel of state.queue) {
        const bytes = Buffer.byteLength(rel, 'utf8');
        reserved += 2 * bytes + HISTORY_RECORD_MAX_BYTES;
        if (bytes > longest) longest = bytes;
    }
    // Three terms. Two are plan paths, each doubled for JSON escaping the same
    // way the per-path term above is: blockedAdvancePlan, and the copy of the
    // current plan path the recomposed condition carries. The third is the
    // difference between the two arming spellings, which is fixed ASCII text
    // and escapes to itself.
    reserved += 2 * longest + 2 * longest
        + Math.max(0, Buffer.byteLength(SELF_ARMING_TEXT, 'utf8')
            - Buffer.byteLength(OPERATOR_ARMING_TEXT, 'utf8'));
    return Buffer.byteLength(JSON.stringify(state, null, 2) + '\n', 'utf8') + reserved <= GOAL_STATE_MAX_BYTES;
}

// Validate the plan arguments, then write the goal-state file atomically.
// planArgs is one plan path or an ordered array of them (the armed queue).
//
// bind is optional, { sessionId, transcriptPath }: the session doing the
// arming, so an in-session arm holds the leash from the moment it is written
// rather than waiting for a claim point. The bind takes two keys together, and
// writes boundSession and boundTranscript as a pair: sessionId must be
// session-id shaped, and transcriptPath must pass validTranscript, which the
// CLI supplies only from a transcript file it found on this machine under the
// harness's own projects tree. The shape alone cannot authenticate an id (see
// SESSION_ID_SHAPE), so the transcript on disk is what corroborates that the id
// names a real local session: a stale, mistyped, or planted value that matches
// no local transcript arms unbound instead of leashing the goal to a session
// that will never stop. A bound goal therefore always carries its transcript,
// and the liveness hint every reader renders from it is never stranded null.
//
// Anything short of both keys arms unbound exactly as an arm with no bind does:
// that is a silent fallback, not a failure, because the stop and
// auto-compaction-offer claim points still bind the goal, recording the hook
// payload's own authoritative transcript path. Where the id itself was of the
// right shape, it is recorded as armingSession (see the field), so the session
// that ran the arm is one of the two things those claim points bind on; where
// no shaped id reached this function at all, the typed arming command in some
// session's transcript is the only route left. The binding rides in the same
// single atomic write as the rest of the state, so arming never becomes a
// read-modify-write and cannot race one.
// Every path is validated before anything is written and the whole arm is
// refused if any one fails, so a partial queue can never reach the state file;
// the reason names the offending path. Duplicates are refused for the same
// reason: a queue that visits a plan twice would advance past it the first
// time and stall the second. Returns { ok:true, plan, queue, boundSession,
// armingSession } on success (boundSession is the id that was written, or null
// when the arm is unbound, and armingSession is the arming id that was
// recorded, or null when none was usable, so the CLI reports what the state
// holds without restating either gate) or
// { ok:false, reason } on any failure: a bad path, a missing or Complete plan,
// a duplicate, or an unexpected filesystem error, which is caught and reported
// rather than thrown. This keeps the whole exported surface non-throwing.
//
// dropped rides on the success result: the plans a previously armed queue still
// had ahead of it that this queue does not name, which the caller warns about.
// Arming replaces the queue rather than growing it, and appendGoal below is the
// spelling that grows one.
//
// authority names who is making this invocation: 'self' for a run running the
// CLI for itself, 'operator' or absent for a person typing it, and anything
// else refuses the whole invocation (armedByArg states why a typo must not be
// repaired here). It is asserted by the caller because the caller is the only
// surface that knows: an arm a session runs for itself reaches this function
// identical to one an operator typed. Every plan this call arms records it, one
// entry per plan, because an append can add a self-armed plan to a queue the
// operator typed and the condition each plan is worked under is that plan's
// own. Nothing about enforcement, the binding or the queue answers to it; the
// condition text and the surfaces that restate it are its whole reach, and
// arming rides on the success result so the caller can report what was
// recorded without restating the rule.
//
// unauthorized rides on the success result beside it: the self-armed plans of
// this invocation whose doc records no Dispatch Authorization, for the caller
// to warn about. A warning rather than a refusal because the kit's own skills
// direct a legitimate case of it, an unleashed run arming an inbound plan
// alongside its own in-flight plan, which need carry no section. The arm
// records what is true of each plan either way.
function armGoal(cwd, planArgs, bind, authority) {
    const args = Array.isArray(planArgs) ? planArgs : [planArgs];
    if (args.length === 0) {
        return { ok: false, reason: 'no plan path given' };
    }
    const requested = armedByArg(authority);
    if (!requested.ok) return requested;
    const arming = requested.authority;

    const queue = [];
    const seen = new Set();
    // No prototype, for the reason normalizeAuthorizations states: the keys are
    // plan paths, and a repository is free to hold a plan named after one of
    // Object.prototype's own members. Assigning '__proto__' on a plain object
    // invokes the prototype setter rather than recording a key, so the entry for
    // such a plan would simply never be written.
    const authorizations = Object.create(null);
    // The self-armed plans of this invocation whose doc records no
    // authorization, collected in the same pass that reads them.
    const unauthorized = [];
    for (const arg of args) {
        const checked = validatePlanArg(cwd, arg);
        if (!checked.ok) return checked;
        const rel = checked.rel;
        if (seen.has(queueKey(rel))) {
            return { ok: false, reason: 'plan appears twice in the queue: ' + rel };
        }
        seen.add(queueKey(rel));
        authorizations[rel] = planAuthorization(cwd, rel);
        if (arming === 'self' && authorizations[rel] === null) unauthorized.push(rel);
        queue.push(rel);
    }

    const requestedBind = bind || {};
    // Both keys or neither: an id of the right shape whose transcript is
    // absent or unusable arms unbound rather than failing the arm.
    const bindable = isSessionIdShaped(requestedBind.sessionId) && validTranscript(requestedBind.transcriptPath);
    const boundSession = bindable ? requestedBind.sessionId : null;
    // The arming session's own id, recorded whenever the caller supplied one of
    // the right shape, whether or not the bind landed. It is what the state
    // carries about an arm the transcript leg could not corroborate.
    const armingSessionId = isSessionIdShaped(requestedBind.sessionId) ? requestedBind.sessionId : null;

    const state = {
        // The current plan of the queue. Every other reader of this state
        // answers to this field and to boundSession, so both keep their
        // meaning as the queue advances: plan is what is being worked now.
        plan: queue[0],
        condition: composeCondition(queue[0], queue, 0, arming),
        // Which arming each of these plans was armed under, one entry per
        // plan, so an append and an advance recompose the condition under the
        // authority that plan's own arming had rather than under whatever the
        // queue was started with.
        armedBy: armedByFor(queue, arming),
        armedAt: new Date().toISOString(),
        // Which session currently holds the leash, or null when unclaimed. An
        // arm carrying a usable bind (the CLI supplies the arming session's
        // id) holds the leash from this write, a crash-recovery re-arm
        // included, which rebinds to the re-arming session here; an arm with
        // no usable bind (none supplied, or one the CLI could not
        // corroborate) starts unbound, and the next stop that resolves to a
        // leashed session claims it, so re-arm is always a clean rebind
        // opportunity either way.
        boundSession,
        // The bound session's transcript path, used as a liveness hint for a
        // session other than the leash holder and, at arm time, as the
        // corroboration that the bound id names a real local session. It is
        // written with the binding or not at all, so an unbound arm records
        // none and a bound one always has it.
        boundTranscript: bindable ? requestedBind.transcriptPath : null,
        // Which session ran this arm, where the arm could read an id of the
        // right shape from its own environment, and null where it could not.
        // It is not a binding and never becomes one on its own: the two claim
        // points read it only while boundSession is null, and there a session
        // whose own id matches it claims the leash, which is what an arm a run
        // made for itself has in place of the typed command text the other
        // claim route reads. The two routes rest on different kinds of
        // evidence deliberately. This one comes from the arming process's
        // environment rather than from transcript content, so no text a
        // session emits into its own transcript can produce it, and the typed
        // route's own evidence bar is untouched by its existence.
        //
        // It rides beside a landed bind too, where no reader consults it,
        // rather than being cleared there: the field records who armed, and a
        // later claim or rebind by another session does not change that answer.
        armingSession: armingSessionId,
        queue,
        queueIndex: 0,
        // One entry per finished plan: { plan, outcome, at } and, for a
        // blocked plan, the recorded blocker.
        history: [],
        // What each queued plan doc says about who authorized arming it: the
        // first sentence of its Dispatch Authorization section, or null where it
        // carries none. Derived from the artifact at the moment the plan is
        // queued, never asserted by the caller, and asserted rather than
        // authenticated: it is the provenance trail a status report or the
        // doctor can surface, and it grants nothing.
        authorizations
    };

    // Refuse a queue whose own progress would grow the state past the writer's
    // bound. queueFits states the whole derivation.
    if (!queueFits(state)) {
        return {
            ok: false,
            reason: 'the armed queue is too long: ' + queue.length + ' plans and the records their '
                + 'advances would add do not fit the goal state file. Arm fewer plans, and queue the rest '
                + 'when they come up.'
        };
    }

    // What this arm takes off the leash: the plans still ahead of the current
    // position in whatever was armed before, minus the ones this queue names
    // again. Arming replaces the queue outright, which is the compatible
    // behavior and stays so, and the one thing standing between an operator and
    // a plan that quietly stopped being armed is the caller naming these. Plans
    // behind the current position are not dropped: the leash finished them.
    const dropped = [];
    const prior = readGoal(cwd);
    if (prior && typeof prior.plan === 'string' && prior.plan !== '') {
        const kept = new Set(queue.map(queueKey));
        for (const rel of prior.queue.slice(prior.queueIndex)) {
            if (!kept.has(queueKey(rel))) dropped.push(rel);
        }
    }

    const written = writeState(cwd, state);
    if (!written.ok) return written;

    return {
        ok: true, plan: queue[0], queue, boundSession, armingSession: armingSessionId,
        dropped, arming, unauthorized
    };
}

// Append plans to the armed queue under the binding it already carries, in one
// atomic rewrite: the new paths land at the end of the queue, the current plan
// and queueIndex do not move, the condition is recomposed so it names what is
// now still to come, and boundSession, boundTranscript, armedAt, the arming
// authority of every plan already queued, and the history are preserved
// untouched.
//
// authority is who is making this invocation, in armGoal's vocabulary and
// answering to the same judgment: an unrecognized value refuses the whole
// invocation before anything is written, and a self-armed plan recording no
// authorization rides back on unauthorized for the caller to warn about. It
// reaches the appended plans alone. An append arms nothing that is already in
// the queue, so the entries there keep what they were armed under, and the
// recomposed condition is the CURRENT plan's, which an append never moves. That
// is what lets a run append a plan it armed itself to a queue the operator
// typed, or the reverse, without either plan wearing the other's arming.
//
// Preserving armedAt is load-bearing rather than tidy: it is half of
// advanceGoal's compare-and-swap, so an append that refreshed it would make
// every advance decided from a snapshot older than the append refuse, and a run
// whose queue grew mid-flight would stop advancing. Preserving the binding is
// the other half of the point: a plan handed to a running session is appended
// from whatever shell is at hand, and re-deriving the binding there would move
// the leash to that shell.
//
// Every path is validated exactly as arming validates it, and a duplicate is
// refused for the reason arming refuses one: a queue that visits a plan twice
// would advance past it the first time and stall the second. A path already
// anywhere in the queue counts, the finished positions included, and so does a
// repeat among the appended paths themselves. Any failure refuses the whole
// invocation before anything is written, so a partial append cannot reach the
// state file.
//
// The write is guarded by a compare-and-swap against the state this call decided
// from, in the spirit of the one advanceGoal takes from its caller. This is a
// read-modify-write over a file another process writes: an append is typed into
// whatever shell is at hand while the leashed session runs, and its validation
// opens a plan doc per path, so a Stop hook's advance or bind has a real window
// to land in between. Written blind, the append would put its own pre-advance
// snapshot back: queueIndex and plan would walk back to the finished plan and
// the advance's history record would be gone, with the run then working a plan
// it already closed. So the state is re-read immediately before the write and
// the append is refused unless the progress markers it read are still the ones
// on disk. armedAt alone would not do it, because an advance preserves armedAt
// by design (it is half of advanceGoal's own guard); the position, the current
// plan, the queue length and the history length are what an advance moves.
//
// What is written is that re-read state with the append applied to it, never the
// snapshot the validation ran against. The compare answers for the fields it
// names and for nothing else, and a state carries fields an append has no
// opinion about: a stop claiming an unbound leash writes boundSession and
// boundTranscript, and a blocked advance writes the blockedAdvance pair. Writing
// the snapshot back would revert every one of them, for the whole width of the
// call rather than for the narrow window below, and an unbound leash is how a
// bystander session comes to claim a goal already being worked. Rebasing keeps
// them because it keeps whatever the re-read holds, a field added later
// included, where a compare widened to name them is a list that goes stale.
//
// The residual is the window between that re-read and the rename, which no
// unlocked writer here closes: a writer landing inside it still wins last, the
// same last-writer-wins posture bindSession states for its own rewrite. What the
// guard converts is the ordinary case, from a silent revert into a refusal the
// operator reads and retries.
//
// Returns { ok:true, plan, queue, appended, boundSession } on success, where
// plan is the unchanged current plan and appended is what this call added, or
// { ok:false, reason } when no goal is armed, a path fails, a duplicate is
// named, the grown queue would not fit, the state moved under the append, or
// the write fails. Never throws.
function appendGoal(cwd, planArgs, authority) {
    const args = Array.isArray(planArgs) ? planArgs : [planArgs];
    if (args.length === 0) {
        return { ok: false, reason: 'no plan path given' };
    }
    const state = readGoal(cwd);
    if (!state || typeof state.plan !== 'string' || state.plan === '') {
        // Three readings reach this refusal and they do not call for the same
        // advice, so the path is asked about rather than assumed. readGoal
        // answers null for a state file that is absent and for one sitting there
        // unreadable alike (a lock or a scanner holding it, an oversized one, a
        // kind no reader opens, JSON that does not parse), and it answers a
        // parsed object carrying no plan for a file that is there, is JSON, and
        // is not a goal state, which normalizeState returns unchanged and which
        // may carry a queue and a history. The bare arm this reason would
        // otherwise name replaces whatever queue is on disk. Named over either
        // of the two readings where something is at the path, it would overwrite
        // a live leash, its queue, its history and its binding, with armGoal's
        // own dropped-plan warning defeated by the same file and so unable to
        // say what went.
        //
        // So the guard is the path's own emptiness rather than the shape of what
        // readGoal returned, and the pointer rides only where nothing is there
        // to lose, which is where the way forward is genuinely a first arming:
        // the state a caller that reached for --append with nothing armed is in,
        // and what rescues a session that loaded neither the kit-goal skill nor
        // the executing-work paragraph naming both spellings. Every other
        // reading takes the reason that names no command, which asserts nothing
        // about what is at the path because one of the kinds it covers,
        // 'unresolvable', is a path with nothing at it at all. Both fit inside
        // the 120-character cap the CLI sanitizes every reason to, so what an
        // operator reads on stderr is a whole clause rather than a cut one.
        if (!goalStateAbsent(cwd)) {
            return {
                ok: false,
                reason: '.kit/goal-state.json could not be read as a goal state,'
                    + ' so what is armed is unknown'
            };
        }
        return {
            ok: false,
            // The whole reason is printed through the CLI's 120-character cap,
            // so the bare form's own flag is named in four words rather than
            // explained: a run arming a plan it traced a grant for needs
            // --self-armed on the bare form too, and the kit-goal skill states
            // when that is the right spelling.
            reason: 'no goal is armed, so nothing to append to;'
                + ' arm without --append is the first arming (--self-armed rides on it)'
        };
    }

    // The progress this append was decided from, which the re-read below is
    // compared against.
    const decidedFrom = {
        armedAt: state.armedAt,
        plan: state.plan,
        queueIndex: state.queueIndex,
        queueLength: state.queue.length,
        historyLength: state.history.length
    };

    const requested = armedByArg(authority);
    if (!requested.ok) return requested;
    const arming = requested.authority;

    const seen = new Set(state.queue.map(queueKey));
    const appended = [];
    for (const arg of args) {
        const checked = validatePlanArg(cwd, arg);
        if (!checked.ok) return checked;
        const rel = checked.rel;
        if (seen.has(queueKey(rel))) {
            return { ok: false, reason: 'plan is already in the armed queue: ' + rel };
        }
        seen.add(queueKey(rel));
        appended.push(rel);
    }

    // Derived ahead of the re-read because deriving one opens a plan doc, and
    // the re-read's whole value is that nothing slow sits between it and the
    // write.
    const added = Object.create(null);
    const unauthorized = [];
    for (const rel of appended) {
        added[rel] = planAuthorization(cwd, rel);
        if (arming === 'self' && added[rel] === null) unauthorized.push(rel);
    }

    const now = readGoal(cwd);
    if (!now || now.armedAt !== decidedFrom.armedAt || now.plan !== decidedFrom.plan
        || now.queueIndex !== decidedFrom.queueIndex || now.queue.length !== decidedFrom.queueLength
        || now.history.length !== decidedFrom.historyLength) {
        return {
            ok: false,
            reason: 'goal state changed while this append was validated, so nothing was appended. '
                + 'Read the state and append again.'
        };
    }

    for (const rel of appended) {
        now.authorizations[rel] = added[rel];
        now.armedBy[rel] = arming;
    }
    now.queue = now.queue.concat(appended);
    now.condition = composeCondition(now.plan, now.queue, now.queueIndex, planArmedBy(now, now.plan));
    // Judged on the object that is about to be written, so the answer is about
    // the state that will exist rather than about a snapshot of it.
    if (!queueFits(now)) {
        return {
            ok: false,
            reason: 'the armed queue is too long: ' + now.queue.length + ' plans and the records their '
                + 'advances would add do not fit the goal state file. Append fewer plans, and queue the rest '
                + 'when they come up.'
        };
    }

    const written = writeState(cwd, now);
    if (!written.ok) return written;

    return {
        ok: true, plan: now.plan, queue: now.queue, appended, boundSession: now.boundSession,
        arming, unauthorized
    };
}

// Record the current plan's outcome and move the leash to the next plan in the
// queue, in one atomic rewrite: the history entry is appended, queueIndex and
// plan move together, the condition is recomposed for the new current plan,
// and boundSession, boundTranscript and every plan's recorded arming authority
// are preserved, so one binding rides the whole queue and each plan keeps the
// authority it was armed under.
//
// outcome is 'complete', 'archived', or 'blocked'; note is the optional
// recorded blocker, sanitized and capped here because it originates in
// transcript text. attributedPlan is the optional plan the history record is
// filed under, for a caller whose own reading of where the run stands differs
// from the stored pointer (the Stop hook's blocked clause reads the position
// walk and emits an event under it, and the record has to agree with that
// event); it is honored only when the armed queue holds it, and it reaches the
// history record alone, never the guards below or the position the leash
// moves to. expectedPlan and expectedArmedAt are an optional
// compare-and-swap guard: the caller decided to advance from a snapshot,
// another writer (a CLI re-arm or clear) can land between that snapshot and
// this function's own re-read, and a state that no longer matches either
// value is refused rather than advanced over. The plan alone cannot tell a
// re-arm that put the same plan back at the head (/kit-goal <currentPlan>
// <newTail>, the ordinary crash-recovery spelling) from the state the caller
// saw, which is why the arming timestamp rides with it: a fresh arm writes a
// fresh armedAt. leadKey is the optional identity of the transcript entry
// whose 'BLOCKED:' lead drove this advance; a usable value (printable ASCII,
// capped) is stored as blockedAdvanceKey, together with the plan this advance
// moves to as blockedAdvancePlan, so the Stop hook can refuse consuming the
// same entry twice. An unusable leadKey is dropped rather than stored, the
// same bar every stored field answers to, and no advance ever deletes a
// standing pair: the hook retires it by queue position instead (honored only
// while the recording plan is the current or the immediately previous
// position), so a keyless advance slotting in between two reads of the same
// entry cannot make that entry consumable again.
//
// Returns { ok:true, advanced:true, finished, plan, arming } when the leash
// moved (arming is who armed the new plan, the value its fresh condition text
// was composed under; the state's own field is the per-plan map armedBy, and
// the two are named apart because one is a scalar and the other a map),
// { ok:true, advanced:false, finished } on the last plan of the queue (nothing
// is written: the caller releases the goal, and the session's own closing
// summary is the operator-facing record), and { ok:false, reason } when no
// goal is armed, the outcome is unusable, the expected plan no longer
// matches, or the write fails. Never throws.
function advanceGoal(cwd, outcomeEntry) {
    const entry = outcomeEntry || {};
    if (!['complete', 'archived', 'blocked'].includes(entry.outcome)) {
        return { ok: false, reason: 'outcome must be complete, archived, or blocked' };
    }
    // The plan must be a string, matching every other reader's guard, not
    // merely truthy: a hand-edited non-string plan returns from the
    // normalizer without the queue fields it otherwise guarantees, so a
    // truthiness check here would dereference an absent queue below and break
    // this surface's never-throws contract.
    const state = readGoal(cwd);
    if (!state || typeof state.plan !== 'string' || state.plan === '') {
        return { ok: false, reason: 'no goal is armed' };
    }
    if (typeof entry.expectedPlan === 'string' && entry.expectedPlan !== state.plan) {
        return {
            ok: false,
            reason: 'goal state changed: the current plan is no longer ' + safeForReason(entry.expectedPlan)
        };
    }
    if (typeof entry.expectedArmedAt === 'string' && entry.expectedArmedAt !== state.armedAt) {
        return {
            ok: false,
            reason: 'goal state changed: the goal was re-armed after this advance was decided'
        };
    }

    const finished = state.plan;
    const next = state.queueIndex + 1;
    if (next >= state.queue.length) {
        return { ok: true, advanced: false, finished };
    }

    // The plan the record is filed under is attributedPlan where the caller
    // supplied one the queue actually holds, otherwise the stored pointer. The
    // two differ when the pointer lags the position the plan docs put the run
    // at, and the caller that supplies one emits an event for the same
    // incident, so this keeps the persisted record and that event naming one
    // plan. Nothing else moves: every enforcement read below, the
    // compare-and-swap above included, is the stored pointer's.
    const attributed = typeof entry.attributedPlan === 'string' && state.queue.includes(entry.attributedPlan)
        ? entry.attributedPlan
        : finished;
    const record = { plan: attributed, outcome: entry.outcome, at: new Date().toISOString() };
    if (entry.note) record.note = safeForReason(entry.note);
    state.history.push(record);
    state.queueIndex = next;
    state.plan = state.queue[next];
    // The plan the leash moves to owns the arming the new condition is composed
    // under, which is its own map entry rather than the finished plan's: a queue
    // can hold plans armed two different ways, and the condition states the
    // arming of the plan it is about. It rides back on the result, so a caller
    // naming the new plan states the arming this text was composed under rather
    // than re-reading it from a snapshot taken before the advance.
    const movedArmedBy = planArmedBy(state, state.plan);
    state.condition = composeCondition(state.plan, state.queue, next, movedArmedBy);
    if (typeof entry.leadKey === 'string' && entry.leadKey !== '' && entry.leadKey.length <= 128
        && !/[^\x20-\x7E]/.test(entry.leadKey)) {
        state.blockedAdvanceKey = entry.leadKey;
        // The plan this advance moved to, stored beside the key. The Stop
        // hook honors the pair only while this plan is the current or the
        // immediately previous queue position, which is as far as a stale
        // transcript re-read of the consumed entry can plausibly reach, and
        // an advance carrying no key (clause (a)'s Complete or archived, or
        // a lead whose identity could not be derived) leaves the pair
        // standing rather than deleting it. Retiring by position closes both
        // failure directions at once: a keyless advance in between cannot
        // resurrect the consumed entry, and a stale text-digest key in a
        // uuid-less transcript cannot collide with a genuinely new,
        // identically worded blocker beyond that neighbourhood.
        state.blockedAdvancePlan = state.plan;
    }
    const written = writeState(cwd, state);
    if (!written.ok) return written;

    return { ok: true, advanced: true, finished, plan: state.plan, arming: movedArmedBy };
}

// Bind (or rebind) the armed goal to a session id, recording which session
// holds the leash. Reads the current goal state, sets boundSession, and
// rewrites the file atomically (tmp + rename, matching armGoal). Returns
// { ok:true } on success, or { ok:false, reason } when no goal is armed, the
// session id is unusable, or the write fails. Never throws. The session id is
// written into goal-state.json, which the hooks surface into the model's
// context, so a control character (a newline could smuggle instructions) is
// rejected, matching normalizePlanArg's sanitize-before-store rule; a length
// cap likewise rejects an oversized value, whatever caller produced it, so a
// session id padded to kilobytes never lands in the state file.
//
// Concurrency posture: this read-modify-write is not locked, so two stops
// resolving to different sessions at nearly the same moment are last-writer-
// wins; the loser simply reads the winner's binding at its own next stop and
// allows as a bystander.
// A clear that lands between this function's read and its write can be
// resurrected by this write, recoverable by clearing again. Enforcement never
// depends on this write succeeding: a failed bind still leashes the current
// stop and is retried at the next one.
//
// The two binding fields are set on a state re-read immediately before the
// write, never on the state the caller's decision was made from, because
// everything else in the file belongs to another writer: an append typed while
// this session runs grows the queue and the authorization map, and writing an
// older whole snapshot over it drops an armed plan with no trace that it was
// ever queued. Only the fields this function owns are set, so what the re-read
// holds is what is written for every other field. The residual is the window
// between that re-read and the rename, which the last-writer-wins posture above
// covers.
//
// transcriptPath is optional: the binding session's transcript, recorded as
// boundTranscript so another session can read a liveness hint from its mtime.
// It travels with the binding, so a bind that carries no usable path clears
// any previous one rather than leaving the prior session's transcript standing
// for the new holder. An absent or invalid path never fails the bind: leashing
// the session is the load-bearing half, and the hint is decoration.
function bindSession(cwd, sessionId, transcriptPath) {
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > 128
        || /[\x00-\x1F]/.test(sessionId)) {
        return { ok: false, reason: 'session id is invalid' };
    }
    const state = readGoal(cwd);
    if (!state || !state.plan) {
        return { ok: false, reason: 'no goal is armed' };
    }
    // The base for the write is a second read taken here rather than the one the
    // gate above answered from, so the fields this function does not own are the
    // newest ones on disk. A goal cleared or made unreadable in between is
    // refused rather than resurrected from the older copy.
    const now = readGoal(cwd);
    if (!now || !now.plan) {
        return { ok: false, reason: 'no goal is armed' };
    }
    now.boundSession = sessionId;
    now.boundTranscript = validTranscript(transcriptPath) ? transcriptPath : null;
    const written = writeState(cwd, now);
    if (!written.ok) return written;
    return { ok: true };
}

// Delete the goal-state file if present. Returns { ok:true, cleared:true } when
// a file was removed, { ok:true, cleared:false } when none was armed, and
// { ok:false, cleared:false, reason } when a delete failed or the path's own
// kind could not be read, which leaves existence unproven: either way nothing
// was released and the caller must not report one. Never throws.
//
// Presence is judged by an lstat rather than by fs.existsSync, which follows a
// link and would report a goal armed where every reader of this file reports
// none. Two spellings of one question are how a surface comes to say 'kit goal
// cleared' about a path no reader ever read as a goal. A path holding something
// other than a regular file therefore reads as nothing armed and is left where
// it is: there is no release to report, and what a repository parked at that
// path is not this function's to delete.
//
// The lstat is spelled here rather than borrowed from regularFileSize, which
// collapses two answers this caller has to keep apart: it returns null both for
// a kind that is not a regular file and for an lstat that failed for any other
// reason. A reader treating a locked file as absent costs one skipped read; this
// function telling the operator a leash is released while the file is still on
// disk and every reader still reads it as armed is the failure this whole file
// exists to prevent. So a failed lstat is routed by pathErrnoClass, the shared
// rule: a determinate code means nothing is at the path and nothing can be, so
// there is no release to report and nothing to wait out, and only a transient
// one (a lock, a permission, a scanner) is a failed clear, because that is the
// one leg where the file may be sitting there still. A kind that was read and is
// not a regular file is 'nothing armed' for the same reason as a determinate
// code. A zero-length regular file is a regular file: it is removed
// and reported cleared, since leaving it is a goal state no reader can parse
// and no CLI can delete.
//
// Where an arm over such a path gets named depends on what is sitting there. A
// directory, and on this platform a junction, refuses the rename and the arm
// says so. POSIX rename(2) replaces an existing file symlink, so on Linux and
// macOS an arm over one publishes normally and the path is never named; that
// half is reasoned from the specification and unverified here, since this box
// creates no file symlink without a privilege the suite must not require.
function clearGoal(cwd) {
    const gp = goalPath(cwd);
    try {
        let st;
        try {
            st = fs.lstatSync(gp);
        } catch (err) {
            if (pathErrnoClass(err && err.code) !== 'transient') {
                return { ok: true, cleared: false };
            }
            return {
                ok: false,
                cleared: false,
                reason: 'could not clear goal state: ' + (err && err.message ? err.message : String(err))
            };
        }
        if (!st.isFile()) {
            return { ok: true, cleared: false };
        }
        fs.unlinkSync(gp);
        return { ok: true, cleared: true };
    } catch (err) {
        // A delete that finds nothing there is a concurrent stop having removed
        // the file between the kind check above and this call: nothing was
        // released here, and the stop that did remove it reports the release. It
        // is the "nothing armed" answer, not a failure to clear.
        if (err && err.code === 'ENOENT') {
            return { ok: true, cleared: false };
        }
        return {
            ok: false,
            cleared: false,
            reason: 'could not clear goal state: ' + (err && err.message ? err.message : String(err))
        };
    }
}

// How long ago a transcript file was last written, as a coarse phrase
// ('less than a minute ago', 'about N minutes ago', 'about N hours ago'), or
// null when the path is absent, invalid per validTranscript, or unreadable.
// The single source of the liveness hint that the CLI's status report and the
// SessionStart armed-goal notice both render, so two surfaces cannot answer
// the same mtime differently. Only a number and a unit ever leave this
// function: the transcript path is machine-local (it typically embeds an OS
// username) and is never surfaced. Math.floor and the 60-minute crossover
// make the phrase err toward reading recent: the one decision this hint feeds
// is whether a bound sibling run is dead enough to re-arm over, and
// overstating liveness errs away from stealing a live run's leash.
function lastActivePhrase(transcriptPath) {
    if (!validTranscript(transcriptPath)) return null;
    let mtimeMs;
    try {
        mtimeMs = fs.statSync(transcriptPath).mtimeMs;
    } catch {
        return null;
    }
    if (!Number.isFinite(mtimeMs)) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - mtimeMs) / 60000));
    if (minutes < 1) return 'less than a minute ago';
    if (minutes < 60) return 'about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
    const hours = Math.floor(minutes / 60);
    return 'about ' + hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
}

// Normalize one event field to printable ASCII, capped at max characters; an
// absent value stays absent. Field values cross into a consumer that treats the
// stream as kit-authored, so their content is normalized to a short printable
// form at this boundary rather than trusted downstream, matching the hook's
// sanitize-before-trust rule for the plan path it prints in a block reason.
function eventField(value, max) {
    if (value === undefined || value === null) return value;
    return String(value).replace(/[^\x20-\x7E]/g, '').slice(0, max);
}

// The event sink this process writes to.
//
// KIT_EVENTS_PATH is honored only when KIT_EVENTS_PATH_ALLOW=1 is also set;
// otherwise it is ignored with a once-per-process stderr note and the real
// sink is used. The same two-signal discipline as KIT_MEMORY_ROOT's gate in
// memq.js (memoryRoot(), read at call time there too): one innocuous-looking
// variable is settable from a committed file a repository already has
// (.vscode/settings.json's terminal env, devcontainer.json, an .envrc), and
// this variable chooses where a session's goal-release events are written,
// so it answers to the same bar as every other kit path override rather than
// to an argument specific to this one. The intended user of both signals is
// the repo test suite and the hook canary's own probe, which point the
// stream at a throwaway file.
let ungatedEventsOverrideNoted = false;
function eventsSink() {
    const override = process.env.KIT_EVENTS_PATH;
    if (override) {
        if (process.env.KIT_EVENTS_PATH_ALLOW === '1') return override;
        if (!ungatedEventsOverrideNoted) {
            ungatedEventsOverrideNoted = true;
            // A failed write here must not cost the fallback emit below: the
            // note is best-effort observability layered on top of a function
            // whose whole body is already best-effort.
            try {
                process.stderr.write('kit-goal: ignoring KIT_EVENTS_PATH (it redirects the goal-event '
                    + 'sink, so it is honored only with KIT_EVENTS_PATH_ALLOW=1)\n');
            } catch { /* the note is best-effort; a failed write changes nothing */ }
        }
    }
    return path.join(os.homedir(), '.claude', 'kit-events.jsonl');
}

// The run id this event correlates to, or undefined when none applies.
// Reuses memq's isRunId rather than restating the grammar, so the two
// producers that answer to a run id (this event stream, and memq's own
// pending-tier routing) cannot disagree about what a well-formed one looks
// like: memq's header states the rule for exactly this reason ("The hooks
// import them rather than restating them, so no two writers can disagree").
// A value memq would refuse (a dots-only name, a trailing dot, a reserved
// device stem, anything outside its token charset, or over its 40-character
// cap) is refused here too, rather than shipping a run label a correlator
// could join into a path memq itself would never create, and rather than the
// truthy-but-empty-after-normalization case a raw check would let through
// (KIT_RUN_ID=<a value that normalizes to nothing> would otherwise ship
// run:""). memq.js is required lazily and defensively, inside this function
// rather than at module load, so a damaged or missing copy costs only the run
// field: the rest of the event, and every other kit-goal-lib.js consumer that
// never touches events, stay unaffected.
//
// Presence of a well-formed run does NOT mean run-scoped memory was active
// for this session: memq additionally requires the KIT_MEMORY_ROOT pair
// before honoring the id for its own pending tier, a separate condition this
// event stream does not check. A consumer must not read run's presence as
// proof of that.
function runIdField() {
    const raw = process.env.KIT_RUN_ID;
    if (!raw) return undefined;
    let isRunId;
    try { ({ isRunId } = require('../scripts/memq.js')); } catch { return undefined; }
    if (typeof isRunId !== 'function' || !isRunId(raw)) return undefined;
    return eventField(raw, 40);
}

// Append one goal release event to the kit event stream, the well-known file an
// outside watcher reads to turn a release into a notification. One JSON object
// per line, { ts, event, project, plan, session, detail, run }: ts is ISO 8601,
// project the absolute project path, plan the repo-relative plan path, session
// the session id or null, detail is present only on a goal-complete, naming
// which release it was, and run is present only when KIT_RUN_ID names a
// well-formed run id per runIdField() above. JSON encoding escapes any
// newline inside a value, so an event is always exactly one line. See
// eventsSink() above for the sink and its override gate.
//
// Every field is sanitized display data: each is normalized to printable ASCII
// and capped, at 40 characters for event and detail, 120 for plan and session,
// and 260 for project (a Windows absolute path bound). The values carry caller
// data (a project path, repo data, a harness-supplied session id), and the
// contract holds at this boundary for the whole record, so no caller can widen
// what reaches the consumer.
//
// A sink that exists and is not a regular file is left untouched and nothing is
// written: opening a FIFO blocks, which no try/catch can rescue, the same guard
// the Stop hook applies to a transcript path. An absent sink is the ordinary
// case: its directory is created and the append starts the file.
//
// Rotation is best-effort, sized for the single writer this normally has: a sink
// already larger than 1 MB is renamed to <sink>.old, replacing any previous
// .old, and the append starts a fresh file. The stat, rename, and append are not
// atomic across processes, and a rename that keeps failing degrades to a sink
// that grows without bound rather than to lost events.
//
// Emitting is observability, never a decision input. The whole body is wrapped
// and nothing is returned, so an unwritable sink or a full disk can neither
// throw into a caller's control flow nor give it something to branch on: a
// missing event is the accepted cost of a hook whose verdict cannot shift.
function emitGoalEvent(details) {
    try {
        const d = details || {};
        const sink = eventsSink();
        const record = {
            ts: new Date().toISOString(),
            event: eventField(d.event, 40),
            project: eventField(d.project, 260),
            plan: eventField(d.plan, 120),
            session: eventField(d.session, 120) || null
        };
        // The key is present exactly when the caller supplied a detail, judged on
        // the value it passed rather than on what survives normalization.
        if (d.detail) record.detail = eventField(d.detail, 40);
        const run = runIdField();
        if (run !== undefined) record.run = run;
        // lstatSync, not statSync: a symlink or junction planted at the sink
        // path must not pass as a regular file. statSync follows the link, so
        // the isFile() guard below would see the target's type, the rotation
        // would rename the link (not the target) aside, and the append would
        // then write straight through the (unrotated, still-linked) path into
        // whatever it points at. A repo carrying both the link and an env
        // pointing KIT_EVENTS_PATH at it is a cheap way to plant a
        // destroy-the-target primitive; this closes that composition without
        // touching the ordinary regular-file path.
        let st = null;
        try { st = fs.lstatSync(sink); } catch { /* no sink yet: the append creates it */ }
        if (st) {
            if (!st.isFile()) return;
            if (st.size > 1024 * 1024) {
                try { fs.renameSync(sink, sink + '.old'); } catch { /* cannot rotate: append to the sink as it is */ }
            }
        }
        fs.mkdirSync(path.dirname(sink), { recursive: true });
        fs.appendFileSync(sink, JSON.stringify(record) + '\n', 'utf8');
    } catch { /* the event stream is best-effort; a failed emit changes nothing */ }
}

// The plan-path helpers are exported for the readers outside this file that ask
// the same questions of the same paths: the status-line widget reads the armed
// plan doc whole (planFileSize), the Stop hook decides whether to hold over one
// (planPathState), and the CLI prints a token per queued plan (planPathState).
// Each must answer to the one rule rather than to a spelling of its own.
// GOAL_STATE_MAX_BYTES rides along for the CLI's report of a state file past it.
// safeForAuthorization rides along for the same single-rule reason: the CLI
// prints the stored sentence, and a printer applying a shorter cap than the store
// hands a reader half a claim and presents it as the whole recorded one.
// queuePosition rides along for the surfaces that report where a queue stands:
// the SessionStart notice, the CLI status report, the status-line widget's
// Plans segment, and the Stop hook's blocked clause, which files its event and
// its history record under the plan the walk puts current. The stored index
// moves only at a clean stop of the bound session, so what a queue entry's own
// plan doc says is the evidence those surfaces read, and one spelling of that
// evidence is what keeps four reports of one queue from disagreeing. The Stop
// hook reads it for attribution alone: the leash's own position, and every
// enforcement decision taken from it, stays the stored index's. A fifth
// surface reports the position and deliberately does not read this: the doctor
// renders the raw stored index,
// because it is the reporting control for a state file the hooks correct or
// refuse, and a doctor that silently corrected too would have nothing left to
// report the defect with.
// classifyPlanStatus and planStatusReadings ride along for the same
// single-rule reason one level down. Three surfaces ask the loose Status
// question and none of them spells it. The SessionStart hook's plan inventory
// asks it of docs/plans/ entries and would otherwise carry a second spelling
// of the regex in the same hook whose queue clause reads the strict one; the
// Stop hook's docs-hygiene check asks it of the same directory to find plans
// left unarchived, at every turn end; and the CLI's queue rendering asks both
// questions of one entry and must show which reading each of its lines used.
// A value the classifier learns reaches all three at once, which is the whole
// point of naming them here: a fourth surface spelling its own regex is the
// drift this export exists to prevent.
// Four path primitives are exported for the same single-source reason: a
// path comparison and a path screen are properties of the boundary a value
// crosses rather than of the caller that first needed them. session-start.js
// reads a sibling worktree's goal state through a path git's own
// administrative data supplies, which is the same untrusted-path channel
// storablePathValue guards here, and it compares that path against the
// caller's own tree, which is the comparison fsEq and nativeSpelling answer
// here. A hand copy in the caller would match this file's comparison the day
// it was written and drift from it silently after.
module.exports = { goalPath, goalPathKind, goalStateAbsent, readGoal, armGoal, appendGoal, advanceGoal, bindSession, clearGoal, composeCondition, planArmedBy, armingSession, armingSessionClaims, sessionHoldsLeash, planHead, planStatusReadings, classifyPlanStatus, emitGoalEvent, normalizePlanArg, lastActivePhrase, isSessionIdShaped, planFileSize, planHeadText, planPathState, pathErrnoClass, safeForAuthorization, queuePosition, fsEq, nativeSpelling, storablePathValue, GIT_POINTER_PATH_CAP, GOAL_STATE_MAX_BYTES };
