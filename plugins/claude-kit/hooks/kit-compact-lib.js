// Shared library for the boundary-gated compaction checkpoint, and for the
// transcript reading its consumers share.
//
// The checkpoint is a small project-scoped JSON file (compact-checkpoint.json
// in the scratch directory kitScratchDir resolves below, gitignored territory
// for an ordinary project) recording the plan path a chapter boundary was reached
// for. It is the signal between two programs that must agree on its path and
// shape: the checkpoint CLI (kit-compact-checkpoint.js) writes it at the
// chapter-close ritual, and the PreCompact gate (kit-compact-gate.js) reads it
// to decide whether a pending auto-compaction may land, consuming (deleting) it
// on the allow so the next mid-chapter attempt is denied again. Single-sourcing
// the path, the read/write/clear operations, and the match rule
// (checkpointMatches, with its age constants) here is what keeps the writer,
// the gate, and the status report from drifting apart.
//
// The gate's decision record is three project-local files in that same
// resolved scratch directory (the state compact-gate.json, its append-only
// compact-gate.jsonl log, and the deferral nudge's per-session hold stamps in
// compact-hold-nudge.json), and they are here for the same single-sourcing
// reason: the gate writes, the two deferral nudges write and read, and the
// checkpoint CLI's status report reads, so the paths and the shapes belong in
// one place. The section header over that record below carries the file-by-file
// account of which writer touches which.
//
// The transcript helpers (readTranscriptCapped, stripLocalCommandOutput, and
// the automation detection) live here for the same reason: the goal-leash Stop
// hook (kit-goal-stop.js) and the PreCompact gate both read transcript text
// and both must neutralize local-command echoes, and two near-duplicate copies
// of the greedy stripping semantics would drift apart.
//
// Node core modules only, CommonJS, zero dependencies. Every exported function
// that touches the filesystem is wrapped so it never throws: a filesystem
// hiccup degrades to a null/refusal result instead of trapping the caller,
// matching kit-goal-lib.js.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { normalizePlanArg, pathErrnoClass, readGoal } = require('./kit-goal-lib.js');
// Three shared reads from kit-read-lib. The gate-log tail read below takes
// readFully because a single readSync may legally return fewer bytes than asked
// for, and the fill loop that closes it belongs to every hook read rather than
// to this one. The hold-stamp read takes readFileBounded, which settles a
// file's kind and size on the OPEN DESCRIPTOR: judging a name and then opening
// it leaves a window a local process can swap the path inside, and off win32
// the open is non-blocking, so a FIFO planted there is refused rather than
// waiting for a writer that never comes. The marker directory's listing and
// sweep take listBoundedNames, which reads a directory incrementally: readdirSync
// materializes the whole of it before the first entry can be judged, so a cap on
// the loop alone bounds what is kept and nothing about what was read.
const { readFully, readFileBounded, listBoundedNames } = require('./kit-read-lib.js');

// The directory every file in this library lives in, for a given project
// directory. Two branches, and the second exists because one project
// directory the kit itself creates is inside a replicated tree.
//
// Ordinarily the answer is the project's own `.kit/`, gitignored territory
// beside the work it describes. But the memory store at ~/.claude is a git
// repository the sync pushes to a remote that reaches every machine, and a
// seat whose project directory is the store's coordinator directory would
// otherwise drop its gate state, its journal, and its markers into that
// replicated tree. None of these files is meaningful on another machine: they
// name a session id, a local plan path, and a local clock, and a journal that
// replicates carries one box's decisions into every other box's copy. So a
// project directory lying inside the store resolves instead to a home-
// anchored directory outside it, which nothing syncs, keeping the store-
// relative shape below it so two store-backed project directories cannot
// collide.
//
// The store root is the home directory's .claude, read at call time so a
// fixture home redirects it. One resolver serves every writer here and the
// gate's own reader, which is what keeps a marker's writer and its reader
// agreeing on where it lives.
function kitScratchDir(cwd) {
    const storeRoot = path.join(os.homedir(), '.claude');
    const rel = path.relative(storeRoot, path.resolve(cwd));
    const underStore = !path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel);
    return underStore
        ? path.join(os.homedir(), '.kit', 'store', rel)
        : path.join(cwd, '.kit');
}

// Path to the checkpoint file for a given repo root.
function checkpointPath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-checkpoint.json');
}

// How long an open checkpoint stays honorable. There are two bounds, and which
// one applies is decided by the checkpoint's own pendingOffer flag, because the
// two kinds of checkpoint fail in opposite directions.
//
// The TEN-MINUTE leg governs a checkpoint opened with no offer pending, which
// is a boundary reached BELOW the compaction trigger. It has no offer to catch
// and must age out: honoring it later, when the next chapter crosses the
// trigger mid-section, would land the compaction mid-chapter, which is the
// exact placement the gate exists to prevent, and self-sustainingly so (the
// landed compaction resets consumption, the next boundary opens another
// below-trigger checkpoint, and the cycle repeats). The floor on the value is a
// long dispatched tool call: a chapter close followed immediately by a
// multi-minute implementer run delays the next assistant turn, and therefore
// the next compaction offer, past the open, so a bound much under ten minutes
// would start discarding boundaries that were about to be honored. The ceiling
// on it is how long a below-trigger checkpoint can linger before the next
// chapter crosses the trigger, which at the recommended trigger the doctor
// derives is far longer than either number. That figure is deliberately not
// restated here: the doctor computes every displayed number from its own window
// and reserve values, and a copy in this comment would strand the moment either
// changes.
//
// The PENDING leg governs a checkpoint opened while the gate was already
// holding auto-compaction offers, which the checkpoint CLI reads from the
// gate's own state at the open. That boundary has an offer waiting for it, and
// the only thing between the two is the current tool call: past the trigger the
// harness re-offers every assistant turn, so the checkpoint is consumed at the
// first turn after the call returns, with nothing else having run in between.
// The ten-minute leg is the wrong bound for it, and measurably so: dispatched
// implementer and reviewer steps have run 22, 27, 67 and 73 minutes, each of
// which discards a boundary that was about to be honored and lands the
// compaction mid-chapter instead.
//
// Twenty-four hours is an outer sanity cap, not the operational window. What
// actually ends the long leg first is the deferral episode that corroborates
// it: pendingOfferCorroborated needs an OPEN episode, and gateEpisodeOpen
// retires one whose newest denial has aged past GATE_EPISODE_MAX_IDLE_MS, four
// hours. lastDeniedAt advances only on a denial, which happens only at an
// assistant turn, and during the long tool call this leg exists to cover there
// are no turns. So a call outrunning four hours retires the episode and drops
// its checkpoint back to ten minutes. Four hours is the honest ceiling, and the
// measured steps above sit roughly three times inside it rather than an order
// of magnitude. The cap earns its place on the other axis: it bounds a
// hand-made or clock-skewed record that no episode would otherwise retire, and
// the future-skew check below applies to this leg exactly as it does to the
// other.
//
// The flag alone never buys the long leg, and neither does an episode alone:
// the hold must also be owned by this binding and must predate the record.
// pendingOfferCorroborated states why each of those is required.
//
// One residue that corroboration does not close, named rather than engineered
// away: ANY compaction that lands without clearing the episode leaves a hold
// standing that no longer has an offer behind it. Two produce it. A manual
// /compact is never seen at all (the PreCompact matcher is auto-only, so the
// gate does not run). And an allow whose payload carries no session id does run
// but cannot clear the episode, because clearing is scoped to the allower and a
// record with no session owns nothing. In both, an episode that genuinely
// predates a later record vouches for it, so a boundary opened in that shadow
// takes the long leg with nothing waiting for it, and if the context re-crosses
// the trigger before the episode goes idle, one compaction lands mid-chapter.
// The discriminator that would close it, whether a compaction landed by some
// other route, is not observable to a hook that either never ran or never
// learned whose turn it was. The cost is bounded at one mistimed compaction,
// which is the pre-gate status quo.
//
// When either bound misfires the cost is one mid-chapter compaction, the
// pre-gate status quo, so the failure direction stays fail-open.
const CHECKPOINT_MAX_AGE_MS = 10 * 60 * 1000;
const CHECKPOINT_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Skew allowance for a checkpoint whose openedAt sits in the future: a small
// clock adjustment between the write and the read is tolerated, but a far-
// future timestamp is treated as illegible rather than honored, so a clock
// change can never mint an effectively immortal checkpoint.
const CHECKPOINT_FUTURE_SKEW_MS = 2 * 60 * 1000;

// Compare two session ids as opaque, case-insensitive strings (session UUIDs
// are surfaced in mixed case across the harness). One rule for every surface
// that has to agree on session identity, rather than a list of them: the
// checkpoint match rule, the PreCompact gate, the goal-leash Stop hook, the
// checkpoint CLI's marker verbs, and the per-session lookups behind the deferral
// nudge's hold path (interactiveHoldOpen and the hold stamps). False when either
// side is missing, which is exactly the treat-as-absent handling an unbound goal
// or an old-format checkpoint needs.
//
// Every one of those compares a value a WRITER here stored, and each of those
// writers stores it through gateText, so a caller looking a session up in one of
// these files passes the id through gateText first: this rule decides case and
// whitespace, and that one decides the spelling.
function sameSessionId(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// The one checkpoint match rule, shared by its two consumers so they cannot
// drift: the PreCompact gate uses the verdict to decide whether a pending
// auto-compaction may land (and the checkpoint be consumed), and the CLI's
// status report uses the reason to say why a checkpoint on disk gates
// nothing. A checkpoint counts only when its recorded plan equals the armed
// goal's plan, its recorded boundSession equals the goal's current
// boundSession, its recorded openedBy names that same session, and its openedAt
// is fresh (parseable, within the age bound that applies to it, and no further
// than CHECKPOINT_FUTURE_SKEW_MS into the future).
//
// Which age bound applies takes TWO facts, not one. The record's own
// pendingOffer flag says an offer was being held when the boundary was
// declared; pendingCorroborated says a hold that predates the record is still
// standing at the moment of the decision. Both must be true for the long bound;
// otherwise the ten-minute bound applies. Callers get the second from
// pendingOfferCorroborated, which owns the rule and the reasons the flag alone
// cannot carry it.
//
// This rule stays pure: it is told the answer rather than reading any state, so
// the CLI's report and the gate's decision cannot diverge on it. An absent or
// non-true pendingCorroborated falls back to the ten-minute bound, which is the
// fail-safe direction and is deliberate: a caller that forgets the argument, or
// cannot read the state to answer it, narrows the window rather than widening
// it.
//
// The record's openedBy is held to the same session, which is the read-side
// half of the caller validation the checkpoint CLI's write door enforces. Two
// records fail it: one an older kit wrote, which carries no openedBy at all,
// and one a bystander opened while the goal was unbound and a later claim
// adopted, whose owner is the leash holder while its opener is somebody else.
// Neither is a boundary the leash holder declared, so neither blesses its
// compaction.
//
// The session compared against is the goal's binding rather than a compacting
// session passed in, and the two are the same value everywhere it matters: this
// clause sits below the wrong-session leg, so cp.boundSession already equals
// goal.boundSession by the time it runs, and the PreCompact gate reaches the
// boundary verdict only for a session that either already holds that binding or
// has just written it (kit-compact-gate.js's three boundary call sites). The
// CLI's status report, the Stop hook's queue advance and the deferral nudge ask
// the same question of the same binding. Deriving it here rather than taking it
// as an argument is what keeps a caller from omitting the subject and getting
// the clause skipped, which would be a fail-open default on the one leg that
// exists to refuse a record.
//
// Returns { ok:true, reason:null } on a match, else { ok:false, reason } with
// reason naming the first failed clause in evaluation order:
//   'no-checkpoint'  cp is missing or carries no plan string
//   'no-goal'        goal is missing or carries no plan string
//   'wrong-plan'     the plans differ (a stale file from a prior run)
//   'wrong-session'  the bound sessions differ (an orphan from a crashed run,
//                    or an unbound side on either record)
//   'wrong-opener'   openedBy is absent, or names a session other than the one
//                    the record is bound to (an older kit's record, a hand
//                    edit, or a bystander's boundary that a claim adopted)
//   'no-timestamp'   openedAt is missing or does not parse as a date
//   'expired'        openedAt is older than the bound that applied:
//                    CHECKPOINT_PENDING_MAX_AGE_MS when the record claims
//                    pendingOffer AND the caller corroborates that offers are
//                    still being held, CHECKPOINT_MAX_AGE_MS in every other
//                    case, an uncorroborated pending record included
//   'future'         openedAt is beyond the future skew allowance
// Never throws on JSON-derived input: every access is guarded and Date.parse
// returns NaN on garbage. nowMs exists so a caller can pin the clock; an
// absent or illegible value means the current time.
function checkpointMatches(cp, goal, nowMs, pendingCorroborated) {
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    if (!cp || typeof cp !== 'object' || typeof cp.plan !== 'string') {
        return { ok: false, reason: 'no-checkpoint' };
    }
    if (!goal || typeof goal !== 'object' || typeof goal.plan !== 'string' || goal.plan === '') {
        return { ok: false, reason: 'no-goal' };
    }
    if (cp.plan !== goal.plan) return { ok: false, reason: 'wrong-plan' };
    if (!sameSessionId(cp.boundSession, goal.boundSession)) return { ok: false, reason: 'wrong-session' };
    // The opener is read through the storage rule the writer stores it under, so
    // a value that rule cannot support (an empty string, a number a hand edit
    // left) reads as no opener rather than as one nothing can ever match.
    const opener = storableCheckpointOwner(cp.openedBy).value;
    if (!sameSessionId(opener, goal.boundSession)) return { ok: false, reason: 'wrong-opener' };
    if (typeof cp.openedAt !== 'string') return { ok: false, reason: 'no-timestamp' };
    const opened = Date.parse(cp.openedAt);
    if (!Number.isFinite(opened)) return { ok: false, reason: 'no-timestamp' };
    const age = now - opened;
    // Both legs are tested for a literal true, so an older three-field record,
    // a hand-edited one carrying a truthy value of some other shape, and a
    // caller that passed nothing all take the ten-minute leg.
    const maxAge = (cp.pendingOffer === true && pendingCorroborated === true)
        ? CHECKPOINT_PENDING_MAX_AGE_MS
        : CHECKPOINT_MAX_AGE_MS;
    if (age > maxAge) return { ok: false, reason: 'expired' };
    if (age < -CHECKPOINT_FUTURE_SKEW_MS) return { ok: false, reason: 'future' };
    return { ok: true, reason: null };
}

// The size of the REGULAR file at this path: 0 when nothing is there, and null
// when the path cannot be safely written through, either because something
// other than a regular file is sitting on it (a symlink or junction, a
// directory, a FIFO) or because its kind could not be determined at all. The
// check is an lstat, so a link is judged as a link rather than as whatever it
// points at.
//
// Only ENOENT reads as "nothing there, go ahead". Every other lstat failure
// (EACCES, EPERM, EBUSY: a permission, a lock, a scanner holding the file) is
// an unknown answer, and answering an unknown with the go-ahead value is the
// mistake readGateStateResult exists to avoid. Every caller decides what an
// unknown means for itself: endsOnLineBoundary turns this null into false, its
// own fail-safe, so a transient failure yields a spare blank line rather than
// the fused record a go-ahead answer would produce.
function regularFileSize(target) {
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 0 : null;
    }
    return st.isFile() ? st.size : null;
}

// The checkpoint's read cap. The writer produces five short fields, a couple of
// hundred bytes, and never grows. Anything past 64 KB is not something this
// wrote, and reading it whole on a hook path that runs before any verdict is
// emitted is cost with nothing to gain.
const CHECKPOINT_MAX_BYTES = 64 * 1024;

// Read and parse the checkpoint file. Returns the parsed object, or null if
// the file is absent, refused, unreadable, or not valid JSON. The content is
// untrusted data (the file is user-writable): callers compare its plan against
// the armed goal's and must never surface its values unsanitized.
//
// The path must be a regular file of sane size before it is opened, judged by
// an lstat, which is the same preamble the gate-state reader
// applies and is here for the same reason: three of this function's callers run
// on paths where blocking is not recoverable. The PreCompact gate reads the
// checkpoint before any verdict is emitted, the goal-leash Stop hook reads it
// while holding a stop, and the deferral nudge reads it inside the tool loop,
// on a covered tool return while a deferral episode stands, which is the most
// frequent of the three. (The checkpoint CLI is the fourth caller and the only
// one a human is waiting on.)
// A FIFO planted at THIS path would block any of them
// inside readFileSync forever, where no try/catch can rescue it, and a link
// would be followed into whatever it names. Being an lstat, the check judges a
// link as a link rather than as its target.
//
// What this covers is this one path, and nothing else those callers touch. It
// narrows rather than closes even here, since the open below re-resolves the
// path, the same honest account the readers beside it give of their own; and
// the callers reach other files by other readers, each of which answers for
// itself. A path is safe because the reader that opens it checks, so this
// comment claims that guard and no more.
function readCheckpoint(cwd) {
    try {
        return readCheckpointResult(cwd).cp;
    } catch {
        return null;
    }
}

// The same read, with why it produced no checkpoint. Returns { ok, cp, reason }:
//
//   { ok: true,  cp }                     a parsed checkpoint
//   { ok: true,  cp: null, 'absent' }     nothing is at the path
//   { ok: true,  cp: null, 'illegible' }  a regular file that is not JSON
//   { ok: false, cp: null, 'kind' }       something that is not a regular file
//   { ok: false, cp: null, 'oversized' }  a regular file past the read cap
//   { ok: false, cp: null, 'unreadable' } the read itself was refused
//   { ok: false, cp: null, 'lstat' }      the path's own kind could not be read
//
// The gate and the two hooks take readCheckpoint above, because all seven mean
// the same thing to them: no checkpoint gates anything. The status report takes
// this, because the seven do not mean the same thing to an operator, and because
// the reasons an operator acts on differently cannot be recovered by re-asking
// with a second syscall: an lstat run afterwards reports an ordinary regular
// file for the 'unreadable' leg, which is how a locked file comes to be
// described as illegible and offered a remedy that will fail.
function readCheckpointResult(cwd) {
    const target = checkpointPath(cwd);
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, cp: null, reason: 'absent' };
        return { ok: false, cp: null, reason: 'lstat' };
    }
    if (!st.isFile()) return { ok: false, cp: null, reason: 'kind' };
    if (st.size > CHECKPOINT_MAX_BYTES) return { ok: false, cp: null, reason: 'oversized' };
    let raw;
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, cp: null, reason: 'absent' };
        return { ok: false, cp: null, reason: 'unreadable' };
    }
    try {
        return { ok: true, cp: JSON.parse(raw), reason: null };
    } catch {
        return { ok: true, cp: null, reason: 'illegible' };
    }
}

// The temporary path an atomic write renames from, shared by every writer in
// this file. The pid keeps two writers off one name; the random suffix keeps
// the name from being predictable, because a link pre-planted at a guessable
// tmp path would be followed by the write that creates it. The exclusive flag
// each caller passes at the open is the actual defense (a pre-planted path
// fails the create outright); the unguessable name is what keeps an attacker
// from winning that race repeatedly.
//
// The unguessable name carries a second property, and it is load-bearing: the
// writers unlink their tmp on failure, so a name an attacker could predict
// would let them aim that unlink at a file of their choosing inside .kit/.
// Each writer therefore gates its cleanup on whether its own exclusive create
// returned, not on the errno of whatever failed: a create refused because the
// path was occupied deletes nothing, while every failure after a create that
// did return removes the file this writer made. Reading an errno instead would
// rest on a platform mapping, and a post-create failure reporting EEXIST would
// leak the temp file. The two defenses are independent: making this name
// predictable again, for testability or anything else, reopens an aimed delete
// that nothing else here would catch.
function atomicTmpPath(target) {
    return target + '.tmp.' + process.pid + '.' + crypto.randomBytes(6).toString('hex');
}

// Write the checkpoint atomically (tmp file + rename), recording the plan it
// belongs to, the session the goal is currently bound to, and whether an
// auto-compaction offer was already being held when the boundary was declared.
// Returns { ok:true, plan } or { ok:false, reason }; never throws.
//
// The plan path is validated through kit-goal-lib's normalizePlanArg, in
// putCheckpoint below, where every writer of this file inherits it: it rejects
// control characters and any path that escapes cwd, and the NORMALIZED form is
// what gets stored, so the returned plan is that form rather than the argument
// as given. For a
// plan armGoal wrote, normalization is idempotent, so the stored value equals
// the goal's and the gate's equality check matches; a hand-edited goal state
// carrying a value armGoal would never have written either refuses here or
// stores a normalized form the gate reads as absent, both of which degrade to
// the status quo rather than opening the gate on untrusted input.
//
// boundSession pins the checkpoint to the run that opened it: the gate treats
// a checkpoint whose recorded boundSession does not match the goal's as
// absent, so a checkpoint orphaned by a crash cannot open the gate for the
// re-bound session that resumes the plan. The value is copied from the goal
// state, so it is held to bindSession's own storage rules (a string, capped
// length, no control characters); null is stored as null (an unbound goal),
// which no binding equals, and such a record is given an owner by
// adoptCheckpoint at the moment a claim point binds one.
//
// pendingOffer records whether an auto-compaction offer was already being held
// when this boundary was declared, which is one of the two facts that select
// the age bound the match rule holds the record to (see CHECKPOINT_MAX_AGE_MS;
// the other is corroboration at the moment of the decision). Every caller reads
// it from the gate's own decision state at the moment it writes. Anything other
// than true stores false, so a caller with no answer records the conservative
// one.
//
// openedBy records WHICH SESSION declared this boundary, which the match rule
// requires to equal the owner: the read-side half of the caller validation the
// CLI's write door enforces, and what catches a record an older kit wrote or a
// hand edit made. It is required, with no default: every caller of this writer
// knows which session is declaring the boundary, and a default standing in the
// owner's value would store a real-looking opener for a caller that simply
// omitted the subject, on the one field that exists to refuse a record. So an
// omitted or null opener is a refusal here rather than a record the match rule
// can never tell from a genuine declaration.
//
// The atomic write, the unpredictable tmp name and the cleanup that removes
// only what this writer created are writeJsonAtomic's, reached through
// putCheckpoint below, which owns every field this file stores.
function writeCheckpoint(cwd, planRel, boundSession, pendingOffer, openedBy) {
    if (openedBy === undefined || openedBy === null) {
        return { ok: false, reason: 'opening session is missing' };
    }
    return putCheckpoint(cwd, {
        plan: planRel,
        boundSession,
        openedBy,
        openedAt: new Date().toISOString(),
        pendingOffer: pendingOffer === true
    });
}

// The storage rules a session id on the checkpoint record is held to, as
// { ok, value }: a string, non-empty, within the 128-character cap and free of
// control characters, which is the shape bindSession stores a binding under, or
// an explicit null for an unbound goal. Absent and null are the same answer, so
// a caller with no owner records null rather than a coerced string. One
// definition, because two writers store these fields (an open and an adoption),
// there are two of them (the owner and the opener), and the match rule reads the
// opener back through this same rule, so a value the writer would refuse can
// never sit in a field the comparison is made on.
function storableCheckpointOwner(value) {
    if (value === undefined || value === null) return { ok: true, value: null };
    if (typeof value !== 'string' || value === '' || value.length > 128
        || /[\x00-\x1F]/.test(value)) {
        return { ok: false, value: null };
    }
    return { ok: true, value };
}

// Put a composed record at the checkpoint path, atomically. The sole writer of
// that file, and the one gate every stored field passes: its callers supply the
// plan, the owner, the timestamp and the flag, and this validates and writes
// them, so a second writer cannot store a path or an owner the first one would
// have refused. The plan goes through kit-goal-lib's normalizePlanArg (control
// characters and any path escaping cwd are refused, and the NORMALIZED form is
// what gets stored), and the owner and the opener through the storage rules
// above, which is the same rule the match rule reads the opener back by.
//
// verify is optional and is handed straight to writeJsonAtomic, which runs it in
// the last moment before the rename with the temporary file already written:
// returning anything but true abandons the write. A caller whose record is a
// rewrite of something it read passes one; a caller publishing a record of its
// own passes none.
//
// Returns { ok:true, plan } with the stored path, or { ok:false, reason }, and
// never throws.
function putCheckpoint(cwd, state, verify) {
    const plan = normalizePlanArg(cwd, state && state.plan);
    if (plan === null) {
        return { ok: false, reason: 'plan path is invalid or outside the repo' };
    }
    const owner = storableCheckpointOwner(state.boundSession);
    if (!owner.ok) {
        return { ok: false, reason: 'bound session is invalid' };
    }
    const opener = storableCheckpointOwner(state.openedBy);
    if (!opener.ok) {
        return { ok: false, reason: 'opening session is invalid' };
    }
    const target = checkpointPath(cwd);
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const published = writeJsonAtomic(target, {
            plan,
            boundSession: owner.value,
            openedBy: opener.value,
            openedAt: state.openedAt,
            pendingOffer: state.pendingOffer === true
        }, verify);
        if (!published) {
            return { ok: false, reason: 'the checkpoint on disk changed under this write, so it was left alone' };
        }
    } catch (err) {
        return { ok: false, reason: 'could not write checkpoint: ' + (err && err.message ? err.message : String(err)) };
    }
    return { ok: true, plan };
}

// Delete the checkpoint file if present. Returns { ok:true, cleared:true } when
// a file was removed, { ok:true, cleared:false } when none was open, and
// { ok:false, cleared:false, reason } when a file is there and the delete failed
// or its kind could not be read. Never throws. The gate calls this to consume a
// matching checkpoint; a failed delete there degrades to the gate standing open
// (compaction lands mid-chapter, the pre-gate status quo), never to a wedged
// session.
//
// Presence is judged by the same lstat kind rule readCheckpoint applies, not by
// fs.existsSync, which follows a link: a junction or a link at this path reads
// as no checkpoint open to the gate and to status, so a clear that followed it
// would report a checkpoint consumed that nothing ever read as open. A failed
// lstat is routed by pathErrnoClass, the classification clearGoal takes at the
// same leg of the same question: a determinate code means nothing is at the path
// and nothing can be, so there is nothing to clear and nothing to wait out,
// while a transient one is a failed clear, because reporting a locked file as
// absent tells the caller a thing was released that is still sitting there.
function clearCheckpoint(cwd) {
    const cp = checkpointPath(cwd);
    try {
        let st;
        try {
            st = fs.lstatSync(cp);
        } catch (err) {
            if (pathErrnoClass(err && err.code) !== 'transient') {
                return { ok: true, cleared: false };
            }
            throw err;
        }
        if (!st.isFile()) {
            return { ok: true, cleared: false };
        }
        fs.unlinkSync(cp);
        return { ok: true, cleared: true };
    } catch (err) {
        // A delete that finds nothing there is the gate having consumed the
        // checkpoint between the kind check above and this call: nothing was
        // cleared here, and the consumer that removed it is the one that acted.
        // It is the "none open" answer, not a failed clear, which is what
        // clearGoal's own racing-ENOENT leg says about the same shape.
        if (err && err.code === 'ENOENT') {
            return { ok: true, cleared: false };
        }
        return {
            ok: false,
            cleared: false,
            reason: 'could not clear checkpoint: ' + (err && err.message ? err.message : String(err))
        };
    }
}

// Whether a record on disk is one a claim would take over, as
// { ok, reason }: the record-side half of the adoption rule, pure and doing no
// IO, so the CLI's status report can describe a record's fate by the same rule
// that decides it rather than by a second copy of the conditions.
//
// Each clause bounds what an adoption can reach:
//   'no-checkpoint' nothing legible is there
//   'no-goal'       no armed plan to adopt it for
//   'wrong-plan'    the record names another plan, so a leftover from a prior
//                   plan (or from a queue position already advanced past) is
//                   never taken
//   'owned'         the record already names a session, judged by the same
//                   storage rule the writer stores owners under, so a value
//                   that rule cannot support ('' and its neighbours) reads as
//                   no owner rather than as an owner nothing can ever match
//   'no-timestamp'  no parseable openedAt, which no reader could use anyway
//
// What it does NOT answer is whether a claim is still coming, which is the
// goal's business rather than the record's: the claim points call this with a
// goal whose binding they have just set, so a binding test here would decline
// every real adoption. A caller asking "will anything ever adopt this" tests
// the goal's own binding beside this answer.
function checkpointAdoptable(cp, goal) {
    if (!cp || typeof cp !== 'object' || typeof cp.plan !== 'string') {
        return { ok: false, reason: 'no-checkpoint' };
    }
    if (!goal || typeof goal.plan !== 'string' || goal.plan === '') {
        return { ok: false, reason: 'no-goal' };
    }
    if (cp.plan !== goal.plan) return { ok: false, reason: 'wrong-plan' };
    if (storableCheckpointOwner(cp.boundSession).value !== null) {
        return { ok: false, reason: 'owned' };
    }
    if (typeof cp.openedAt !== 'string' || !Number.isFinite(Date.parse(cp.openedAt))) {
        return { ok: false, reason: 'no-timestamp' };
    }
    return { ok: true, reason: null };
}

// Give an ownerless checkpoint the owner of the leash, at the moment a claim
// point binds one. A goal that is unbound when a chapter boundary is declared
// records no owner on the checkpoint it opens, because the record copies the
// goal's binding and there is none to copy; the match rule then reads that
// record and the now-bound goal as two different sessions, so the boundary the
// run banked is discarded under a reason naming a session mismatch that never
// happened. Adopting the record at the claim keeps the match rule comparing two
// concrete owners, which is the one comparison every other verdict runs.
//
// checkpointAdoptable owns which records may be taken. What this adds is the
// owner to write and the write itself, and the write carries over openedAt
// VERBATIM, so the record ages from the boundary it was opened at: an adoption
// grants no freshness, a record already past its bound stays expired, and the
// pending flag is copied as recorded rather than raised.
//
// openedBy is carried over verbatim for the same reason and one more: an
// adoption answers who OWNS a boundary, never who declared it. So a record
// carrying no opener stays without one and the match rule refuses it, which is
// the belt-and-braces check standing rather than a gap, since a record with no
// opener is one an older kit or a hand edit produced and nothing here can say
// whose boundary it was; and a bystander's boundary declared while the goal was
// unbound is adopted like any other and then refused on its opener, so the
// leash holder's compaction is never blessed by a boundary it did not declare.
//
// The write is abandoned rather than published if the record on disk moved
// between the read and the rename, which is not the single-writer case the gate
// assumes elsewhere: that serialization runs through the one bound session, and
// this runs precisely while there is none, so a checkpoint CLI open racing this
// adoption is a real ordering. The verify runs in writeJsonAtomic's last moment
// before the rename, and it compares the fields that identify the record, which
// every writer of this file writes at once: a record whose plan, opened timestamp,
// opener and ownerlessness are unchanged is the record that was read. The opener
// is one of them because it is the only field two racing opens need differ in:
// both run while the goal is unbound, so both record no owner and the same plan,
// and two inside one millisecond record the same timestamp too, which would leave
// the stale record republished over the newer one under the binding. The verify
// narrows the window rather than closing it: there is
// no lock, so a newer boundary landing before the verify reads survives, and one
// landing between that read and the rename is overwritten. The residual is
// bounded and fail-open, costing one further deferral rather than a lost plan.
//
// Returns { ok, adopted, reason } and never throws. adopted is true only when a
// record was rewritten; every other outcome, an absent checkpoint included, is
// { ok: true, adopted: false } with the reason naming the clause that declined,
// since a claim with no checkpoint open is the ordinary case rather than a
// failure. A failed write is { ok: false }: the caller's claim stands either
// way, and the boundary is lost to a deferral, which is the pre-adoption
// behavior and the same degradation a .kit/ refusing checkpoint writes gives.
function adoptCheckpoint(cwd, goal, sessionId) {
    const owner = storableCheckpointOwner(sessionId);
    if (!owner.ok || owner.value === null) return { ok: true, adopted: false, reason: 'no-session' };
    const cp = readCheckpoint(cwd);
    const adoptable = checkpointAdoptable(cp, goal);
    if (!adoptable.ok) return { ok: true, adopted: false, reason: adoptable.reason };
    // Read through the storage rule on both sides of the comparison below, so a
    // record whose opener that rule reads as none matches one written without the
    // field at all rather than counting as a different record.
    const opener = storableCheckpointOwner(cp.openedBy).value;
    const written = putCheckpoint(cwd, {
        plan: goal.plan,
        boundSession: owner.value,
        // Read through the storage rule rather than copied raw: a hand edit can
        // leave a value the writer would refuse, and passing it on would fail
        // the whole adoption instead of adopting with no opener, which is the
        // outcome the header describes and the one the match rule then refuses.
        openedBy: opener,
        openedAt: cp.openedAt,
        pendingOffer: cp.pendingOffer === true
    }, () => {
        const now = readCheckpoint(cwd);
        return !!now && now.plan === cp.plan && now.openedAt === cp.openedAt
            && storableCheckpointOwner(now.openedBy).value === opener
            && storableCheckpointOwner(now.boundSession).value === null;
    });
    if (!written.ok) return { ok: false, adopted: false, reason: written.reason };
    return { ok: true, adopted: true, reason: null };
}

// ---------------------------------------------------------------------------
// The gate's decision record.
//
// The PreCompact gate takes a verdict on every auto-compaction offer and, until
// it writes one down, leaves no trace: a run held for a whole section, a
// checkpoint that expired seconds before the agent returned, and a safety-valve
// fire are indistinguishable afterwards. Three project-local files under .kit/
// carry that record. The STATE (compact-gate.json) is the newest decision, the
// deferral episode currently standing, and the per-session list of interactive
// holds; it is rewritten in place, so it stays one small file. Its readers are
// not one set: the checkpoint CLI's status report reads the decision and the
// episode, while the per-session hold list is the deferral nudge's alone, since
// the question it answers is whether ONE session is being held and status asks
// about the project. The LOG (compact-gate.jsonl) is append-only and is what an
// operator reads to answer "how often, and why" across a whole run. The HOLD
// STAMPS (compact-hold-nudge.json) are the deferral nudge's own per-session clock
// for a hold that owns no episode, which cannot live in the state because every
// gate write rebuilds that file from a fixed key set (see
// HOLD_NUDGE_MAX_ENTRIES); the status report reads that file too, but only to
// say when it is refusing the nudge's writer, which is a state nothing else
// surfaces.
//
// The writers are not evenly spread across the three, and the log carries TWO
// record classes. The state has two writers: the gate records a decision
// (recordGateDecision, from the PreCompact hook) and the deferral nudge stamps
// the open episode (recordEpisodeNudge, from the tool loop). The stamp file has
// one, recordHoldNudge, from the same tool loop. The log has three, since both
// nudges journal that they spoke through logEpisodeNudge beside the decision
// recorder's own append. A decision line carries `verdict` and a nudge line
// carries `event`, which is how a reader partitions the log without guessing;
// the nudge class carries two event values, `nudge` for an episode and
// `nudge-hold` for a hold, so a reader can tell which directive spoke. A
// consumer folding every line through gateRecord() sees only decisions, since
// that rebuilder returns null for a record with no recognized verdict: that is a
// correct decision-only reading, not a whole-log one.
//
// All three files are written after the verdict, or after the emission decision,
// is already made, and a failure to write cannot change it. recordGateDecision
// swallows every failure and returns nothing a caller branches on, so a full
// disk or a read-only .kit degrades to a gate that decides exactly as it did
// before, silently. The two nudge stamps are the exception and it is deliberate:
// a stamp is not diagnostic, it IS the interval, and it is the only cross-process
// carrier that interval has, so recordEpisodeNudge and recordHoldNudge each
// return a boolean their caller gates the emission on, and a failed stamp yields
// silence. The journal line stays diagnostic on every writer. The ordering
// matters as much as the swallowing: a path that could block (a FIFO planted at
// any of them) cannot delay a verdict that has already been emitted.
//
// The record is written only in a project that is ALREADY kit-governed. An
// existing .kit/ directory is the ordinary evidence: the gate runs on every
// auto-compaction offer on the machine, including in repositories that have
// nothing to do with the kit, and creating an untracked directory of session
// ids and token readings in someone's unrelated checkout is a cost the
// diagnostic does not earn. The one scratch directory these writers do create
// is one an armed goal resolves for that has none of its own, and only then.
// What keeps that branch live is the store-backed resolution above: goal
// state sits at <cwd>/.kit beside the project, so an ordinary project with an
// armed goal already has the directory, while a project lying inside the
// store writes its scratch to ~/.kit/store/<rel> instead, somewhere else
// entirely and under a root that need not exist yet. Refusing there would
// take every deny unrecorded and silence the deferral nudge in exactly the
// place the record exists for. An armed goal is the same already-governed
// evidence an existing directory is, so a stranger's checkout still gets
// nothing. The creation is recursive, which the store-backed shape requires,
// and it reaches no further than the scratch directory the resolver named.
//
// All three files must be regular files, and .kit/ itself must be a real
// directory rather than a link to one. A symlink, junction, or FIFO planted at
// any of those four paths is never followed: appending through a link writes
// into its target on every assistant turn, trimming through one lands a
// megabyte of an arbitrary readable file inside .kit/, and a FIFO blocks a read
// or a write forever where no try/catch can rescue it. Each check is an lstat,
// so a link is judged as a link rather than as whatever it points at.
//
// Three of the four paths REFUSE on that verdict and the hold stamps REMOVE the
// path instead, which is a difference in what a refusal costs rather than in
// what is judged. The gate state, the log and .kit/ itself are written by the
// decision recorder, whose refusal is a diagnostic line not written, and they
// are read by surfaces that report absence honestly. The stamp file IS an
// interval: refusing it silences a held session's directive, and neither a link
// nor an oversized file ever resolves on its own, so a writer that only refused
// would disable that interval permanently. Since neither shape is one that
// writer can produce, neither holds a stamp to preserve, and the path is
// unlinked before the write (recordHoldNudge). The readings that MIGHT sit over
// a real list all refuse there exactly as they do here: a refused read, an lstat
// that could not answer, and a read that ended short of what the descriptor
// promised, which is a fault under the read rather than a shape, and so says
// nothing about whose file it is. The hold stamps are read through the shared
// bounded reader, which settles kind and size on the descriptor and follows a
// link only when a caller does not ask otherwise, and that reader's caller here
// asks BOTH ways: an lstat first, which is what makes a link a distinguishable
// answer rather than one more unreadable file, and the reader's own opt-in
// refusal, which closes the window between that lstat and the open
// (readHoldNudgesResult).
//
// A HARDLINK is the member of that class these checks admit: it is a regular
// file and passes every lstat above. What a planted one then RECEIVES is a
// question about the WRITER rather than about the check, and the four paths do
// not answer it alike. .kit/ itself is not of the class at all, since no
// hardlink to a directory can be created. The state and the hold stamps are
// published by writeJsonAtomic, which writes a temp file and renames it over
// the name: a rename replaces the directory entry, so a hardlink planted at
// either path is orphaned by the first write and goes on holding whatever it
// was linked to. The LOG is the one path a write reaches through an existing
// inode, since the decision recorder and logEpisodeNudge both append to the
// name in place, so a hardlink there receives every record appended until the
// log next crosses GATE_LOG_MAX_BYTES and trimGateLog renames a rebuilt file
// over it, which orphans the link exactly as the other two writers do. That one
// path is left open on purpose, matching the posture the kit already takes for
// its goal-event sink, and the exposure is bounded by what lands there: this
// library's own JSONL decision and nudge lines, in a project the actor can
// already write to.
//
// Those checks NARROW the window rather than closing it, the same honest
// account readTranscriptCapped gives of its own isFile() check: the path is
// re-resolved by the open that follows, so a swap landing between the two is
// still possible. Closing it needs a single open plus an fstat on the
// descriptor, a restructure this diagnostic does not earn, and what rides
// through the residual window is well-formed JSON appended to a path the actor
// already controls. The writers that publish through a temporary file, which is
// writeJsonAtomic for the state, the checkpoint, the hold stamps and the markers
// and trimGateLog for the rebuilt log, create that temporary exclusively
// (O_EXCL) under an unpredictable name, so the one path an attacker could
// otherwise pre-plant is not guessable and would fail the open anyway. The two
// log APPENDERS go through no temporary file at all, the decision recorder and
// logEpisodeNudge both reaching the log's name in place: what an attacker can
// pre-plant there is the log path itself, which is the hardlink exposure the
// paragraph above states and accepts rather than one this defence covers. The hold stamps' own read closes the kind half of that window rather
// than narrowing it, since the shared reader it goes through settles kind and
// size on the descriptor it consumes; what its lstat leg answers for is the link
// question alone.
//
// That acceptance now has to cover callers in the TOOL LOOP as well as the
// PreCompact one, since both nudges journal from there and a stalled tool loop
// is the one failure that hook must never cause. It still holds, on a narrower
// argument. Reaching the window needs a hostile writer already inside .kit/ in
// this project, racing a path that opens for a few microseconds per fire; the
// blocking shapes are refused by the lstat legs above; and the harness's own
// hook timeout bounds anything that does slip through, so the worst case is one
// dropped journal line or one timed-out hook process, never a wedged loop.
//
// Every value stored here that came from outside (the harness's session id, the
// checkpoint file's own contents, and a prior state file, which is user-writable
// like every other file under .kit/) is rebuilt field by field on the way in and
// on the way out, so neither a forged state file nor an odd payload can grow the
// file without bound or push control characters into an operator's terminal.
// ---------------------------------------------------------------------------

// Path to the gate's decision state for a given repo root.
function gateStatePath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-gate.json');
}

// Path to the gate's append-only decision log for a given repo root.
function gateLogPath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-gate.jsonl');
}

// The log's bound. Both record classes run a few hundred bytes or less, and
// both writers are rare: the gate fires at most once per assistant turn, and
// the nudge at most once per NUDGE_INTERVAL_MS per tool batch while a hold
// stands. Their sum is still well inside 2 MB for months of dense use; past it
// the writer keeps the newest 1 MB and drops the rest. Trimming to half the cap
// rather than to the cap itself is what keeps the rewrite rare: at a 1-byte
// margin every subsequent append would rewrite the whole file.
const GATE_LOG_MAX_BYTES = 2 * 1024 * 1024;
const GATE_LOG_KEEP_BYTES = 1 * 1024 * 1024;

// How long a deferral episode stands without a new denial before a reader
// treats it as finished rather than as the hold currently in force.
//
// The episode's whole claim is about right now: "the gate is holding offers,
// and has been for M minutes" is what makes an operator or a nudge act. Nothing
// on disk marks the end of one, because the events that end an episode without
// an allow reaching this file leave no trace to write: a manual /compact (the
// PreCompact matcher is auto-only, so the gate never runs), a session that
// simply ends, an offer that never comes again. So the newest denial's age is
// the only evidence of whether the hold is still real, and past this window the
// count is history rather than state.
//
// The floor is the longest gap there can be between two denials of one genuine
// episode, which is one assistant turn, which is the longest tool call a
// session makes: dispatched implementer and reviewer runs have been measured at
// 22, 27, 67 and 73 minutes. Four hours clears the longest of those by better
// than three times, so no real hold is ever cut short. The ceiling is that a
// count must not survive a break long enough to make it a different working
// session: four hours does not survive a night, a morning off, or a day spent
// in another project, which is where a stale "held 16 offers over 1387 minutes"
// would read as a missed boundary and push an operator into forcing a
// checkpoint open mid-chapter, the exact mis-scheduling the gate exists to
// prevent.
//
// This value also bounds how long a declared boundary stays honorable, which it
// did not when it was first written. The long checkpoint age leg needs a
// standing episode to corroborate it (see pendingOfferCorroborated), and this
// is what retires one, so a pending checkpoint dies when its episode goes idle
// here, well before CHECKPOINT_PENDING_MAX_AGE_MS caps it. The two constants
// answer different questions and are deliberately separate, but they are no
// longer independent: shortening this one shortens the pending leg with it.
// Both release markers' windows are defined as this value outright,
// CONSENT_MAX_AGE_MS and ROLE_BOUNDARY_MAX_AGE_MS alike, so tuning this
// constant retunes two windows and not one: how long an operator-consent
// marker stays honorable, and how long a seat's declared role boundary does.
// Those are the windows in the release design bounded by code rather than
// prose; the derivations and their reasoning live at those constants.
const GATE_EPISODE_MAX_IDLE_MS = 4 * 60 * 60 * 1000;

// The verdicts a record may carry, and the only values recordGateDecision
// accepts: an unrecognized verdict is not written at all, because a state file
// the CLI and the nudge read has to be legible to both.
const GATE_VERDICTS = ['allow', 'deny-boundary', 'deny-interactive'];

// The reasons a record may carry: the gate clause that decided, the
// checkpoint match rule's own codes, which are what a boundary deny reports,
// and the two release reasons a marker-driven allow journals (role-boundary,
// operator-consent), which are how a run's compaction history states which
// release landed it. The vocabulary is closed and this library is the only
// thing that writes it, so a value outside it came from a hand-edited state
// file rather than from the gate. Reason reaches the CLI's status report, a
// channel a model reads, and the charset and length caps alone would let
// arbitrary prose through; checking the value against the list it is drawn
// from costs nothing and bounds it to this file's own words.
//
// The list is paired with the match rule's own reason codes by hand, and
// gateRecord drops an unpaired one to null, which would land a deny with no
// clause on it; the list is exported so a pin can read those codes off
// checkpointMatches and hold them against this one.
const GATE_REASONS = [
    'not-auto', 'external-engine', 'no-session', 'no-goal', 'bystander',
    'automation', 'checkpoint', 'valve', 'illegible',
    'role-boundary', 'operator-consent',
    'no-checkpoint', 'wrong-plan', 'wrong-session', 'wrong-opener', 'no-timestamp',
    'expired', 'future'
];

// A string safe to store and to print back: printable ASCII, length-capped,
// null for anything else (an empty string included, which reads as absent
// everywhere here). Applied to every string field on the way in and again on
// the way out, so a state file hand-edited between the two still cannot carry
// control characters into a terminal or megabytes into the next write.
function gateText(value) {
    if (typeof value !== 'string') return null;
    const clean = value.replace(/[^\x20-\x7E]/g, '').slice(0, 128);
    return clean === '' ? null : clean;
}

// A count safe to store and to print back: a non-negative integer, clamped.
// The clamp is what keeps the "two integers and nothing else" bound the stderr
// note and the status report claim: a planted denials of 1e308 is a finite
// number, and JavaScript renders it as "1e+308", which is neither an integer
// nor anything an operator can read as a count of offers. A billion is past
// every real reading (offers are counted per assistant turn, tokens per
// context) and still renders in full digits.
const GATE_COUNT_MAX = 1000000000;

function gateCount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return Math.min(Math.floor(value), GATE_COUNT_MAX);
}

// Rebuild a decision record from an arbitrary object, or null when it is not
// one. The shape is the whole contract between the gate (writer) and the CLI
// and nudge (readers): `at` when it was taken, `verdict`, `reason` naming the
// clause that decided, `consumed` the token reading behind it or null,
// `checkpoint` the facts of the checkpoint file that was on disk or null, and
// `session` the harness's id for the compacting session.
function gateRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!GATE_VERDICTS.includes(value.verdict)) return null;
    let checkpoint = null;
    const cp = value.checkpoint;
    if (cp && typeof cp === 'object' && !Array.isArray(cp)) {
        checkpoint = {
            ageSeconds: (typeof cp.ageSeconds === 'number' && Number.isFinite(cp.ageSeconds))
                ? Math.round(cp.ageSeconds) : null,
            pendingOffer: cp.pendingOffer === true,
            // Whether the flag was vouched for at the moment of the decision.
            // Without it the log cannot tell the three expiries apart, and they
            // mean different things to whoever reads it: an ordinary
            // below-trigger leftover aging out, a boundary the operator really
            // did open being discarded for want of a standing hold, and the
            // outer sanity cap firing. The middle one is the defect this
            // section exists to make visible, and it reads as either of the
            // others without this field.
            corroborated: cp.corroborated === true
        };
    }
    const reason = gateText(value.reason);
    return {
        at: gateText(value.at),
        verdict: value.verdict,
        reason: GATE_REASONS.includes(reason) ? reason : null,
        consumed: gateCount(value.consumed),
        checkpoint,
        session: gateText(value.session)
    };
}

// Rebuild a deferral episode: the run of denials standing with no allow after
// it. `session` is the session being held, `since` dates the first denial,
// `denials` counts them, `lastDeniedAt` dates the newest, and `nudgedAt` is when
// the deferral nudge last spoke, so it can hold its interval across processes.
//
// Null unless the episode is genuinely open, which means every field an episode
// is read FOR is legible: an owning session, a count of at least one, and two
// timestamps that parse. A half-written or hand-edited record ({} being the
// easy case) reads as no episode rather than as an open one holding zero offers
// since no time at all, so no consumer has to re-derive openness with a guard
// of its own.
//
// The session requirement is what keeps an unownable episode off the disk: every
// writer here records one, so a record without it is hand-made or from an older
// version, and honoring it would let a record nobody can clear hold the single
// slot for its whole idle window.
//
// nudgedAt is stamped by recordEpisodeNudge below, the one writer of a nudgedAt
// VALUE (nextGateState carries the field through on an extension and nulls it
// when a fresh boundary deny opens an episode), and read by the deferral nudge
// hook, which uses it as the cross-process carrier for its own interval. It is
// carried through every rebuild so a hold spoken to once is not spoken to again
// on the next tool return.
function gateEpisode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const session = gateText(value.session);
    const since = gateText(value.since);
    const lastDeniedAt = gateText(value.lastDeniedAt);
    const denials = gateCount(value.denials) || 0;
    if (!session) return null;
    if (denials < 1) return null;
    if (!since || !Number.isFinite(Date.parse(since))) return null;
    if (!lastDeniedAt || !Number.isFinite(Date.parse(lastDeniedAt))) return null;
    return {
        session,
        since,
        denials,
        lastDeniedAt,
        nudgedAt: gateText(value.nudgedAt)
    };
}

// The deferral episode a state has open RIGHT NOW, or null: the one predicate
// for that question, so no reader has to re-derive it. Its readers are the
// gate's stderr note, the checkpoint CLI's status report and hold test, the
// Stop hook's queue advance, and the deferral nudge's own guard. An episode whose
// newest denial has aged past GATE_EPISODE_MAX_IDLE_MS is finished, not open.
// nowMs exists so a caller can pin the clock; an absent or illegible value
// means the current time.
//
// sessionId is optional and answers a different question than omitting it does.
// Supplied, an episode belonging to any other session reads as NOT open, which
// is what every decision-shaped question wants: one session must never act on
// a hold another session is under. Omitted, any open episode counts, which is
// what a human reading `status` wants, since the question there is whether this
// project is holding offers at all. An explicit null is a session id that
// exists and matches nothing, not an omission: a decision carrying no session
// id can own no episode.
//
// The gate's note supplies the deciding session's id; status omits it. A caller
// asking whether to act on a hold supplies one, and an unbound goal supplies an
// explicit null, which matches nothing.
function gateEpisodeOpen(state, nowMs, sessionId) {
    const episode = state ? gateEpisode(state.episode) : null;
    if (!episode) return null;
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    const last = Date.parse(episode.lastDeniedAt);
    if (now - last > GATE_EPISODE_MAX_IDLE_MS) return null;
    // The other direction needs a bound too, and for the reason the checkpoint
    // rule already states: a denial dated into the future (a hand-edited file, a
    // restored VM snapshot, a backward clock correction) has a negative age that
    // no idle bound can ever exceed, so the episode would stand forever while
    // reporting itself as zero minutes old. The same skew allowance the
    // checkpoint uses applies here, rather than a second constant answering the
    // same question.
    if (last - now > CHECKPOINT_FUTURE_SKEW_MS) return null;
    if (sessionId !== undefined && !sameSessionId(episode.session, sessionId)) return null;
    return episode;
}

// The two reasons an interactive deny carries, which are the two ways a session
// reaches the hands-on leg: nothing is armed in the project, or what is armed
// belongs to another session. Both are held to the same ceiling and neither
// touches an episode, so both read the same way here.
const INTERACTIVE_HOLD_REASONS = ['bystander', 'no-goal'];

// The gate state's fourth key, beside the newest decision, the episode and the
// newest allow: one record per session, newest first, of the interactive denies
// this project's gate has taken.
//
// It is a per-session list rather than a reading of the single decision slot,
// and that is forced by the slot's writers. Every gate process in a project
// writes lastDecision for every verdict it takes, so on a checkout carrying
// several sessions the leash holder's boundary denies and a bystander's
// interactive denies alternate in it, and a hold read from there is refused for
// a reason belonging to another seat. A hold is one session's own fact and is
// stored as one.
//
// The cap is a backstop against an unbounded file, and it is also the only
// bound on what the list HOLDS. The idle ceiling interactiveHoldOpen applies
// bounds the ANSWER instead: it refuses a record it has aged out and leaves
// that record in the list, and nothing rebuilds the list by age, gateHolds
// keeping whatever it reads. That is where this parts from the hold-stamp list,
// whose own reader drops a spent entry outright and whose eviction can
// therefore only ever discard one. So an eviction here can drop a record that
// is still live, wherever more sessions than the cap have taken an interactive
// deny in one project since the oldest kept one; the evicted session is then
// unheld until its own next deny, which past the compaction trigger is its next
// assistant turn: one silence rather than a false hold, which is the direction
// every failure here takes.
const INTERACTIVE_HOLD_MAX_ENTRIES = 8;

// The hold records a state carries, rebuilt: an array, newest first, holding at
// most one record per session, and empty for every unusable shape (an absent
// key, a value that is not an array, entries that are not records, and a record
// with no session to own it).
//
// The walk is bounded BY INDEX at the cap, on readHoldNudgesResult's reasoning: a
// planted array of ten thousand entries is not walked, while a bound on how
// many VALID entries are kept would let every invalid one be examined first. A
// second record for a session already kept is dropped rather than kept behind
// the first, so newest-first order is what decides which record answers for a
// session.
function gateHolds(value) {
    if (!Array.isArray(value)) return [];
    const holds = [];
    const scanned = Math.min(value.length, INTERACTIVE_HOLD_MAX_ENTRIES);
    for (let i = 0; i < scanned; i += 1) {
        const record = gateRecord(value[i]);
        if (!record || !record.session) continue;
        if (holds.some((kept) => sameSessionId(kept.session, record.session))) continue;
        holds.push(record);
    }
    return holds;
}

// The interactive hold this state shows for one session RIGHT NOW, as that
// session's own newest interactive deny, or null. This is gateEpisodeOpen's
// question for the OTHER deny class, and it is a separate predicate because the
// two are stored in different places for a reason stated at nextGateState: a
// deny-interactive records the decision and leaves the episode slot untouched,
// so a bystander or a session in an unarmed project never owns an episode at
// all. A reader asking "is this session being held?" therefore asks the hold
// list above, and asking it here rather than at the reader keeps the deny
// vocabulary and the two bounds in the file that writes them.
//
// Four things must hold. The record must be a deny-interactive carrying one of
// the two hands-on reasons, so a boundary deny (the leash holder's own class)
// and every allow read as no hold; the list carries only what this file wrote,
// and those two checks are what a hand-edited state file meets. It must name
// THIS session, which the lookup itself is, since a hold is only ever one
// session's to act on. And its timestamp is held to the same two bounds
// gateEpisodeOpen applies to an episode's newest denial, the four-hour idle
// ceiling and the future-skew allowance, for the same reasons: past the trigger
// the harness re-offers every assistant turn, so a decision no newer than that
// is a finished hold rather than a standing one, and a record dated into the
// future has an age no ceiling can exceed.
//
// A state file carrying no hold list rebuilds to an empty one and answers null
// here, so the session is unheld until its own next deny records it, which past
// the trigger is its next assistant turn. Falling back to the decision slot is
// what this predicate exists not to do: that slot's newest record can belong to
// any session that took an offer in the project.
//
// Unlike an episode this carries no count and no start, because a
// deny-interactive aggregates nothing: what it does carry is `consumed`, the
// token reading behind the decision, which is the figure the deferral nudge's
// floor is read against.
//
// The session id is required rather than optional. gateEpisodeOpen reads an
// omitted one as "any open episode counts", which serves a human running status;
// there is no such reader here, and every caller of this one is deciding whether
// to act, so an unusable id answers null rather than matching whatever the list
// happens to hold.
function interactiveHoldOpen(state, nowMs, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    // Compared as the record stores it: every session field in this file goes in
    // through gateText, so the lookup applies the same rule to the id it is
    // handed rather than comparing a stored spelling against a raw one
    // (holdNudgedAt states the same reasoning for the stamp file).
    const session = gateText(sessionId);
    if (!session) return null;
    const holds = state ? gateHolds(state.interactiveHolds) : [];
    const record = holds.find((entry) => sameSessionId(entry.session, session)) || null;
    if (!record) return null;
    if (record.verdict !== 'deny-interactive') return null;
    if (!INTERACTIVE_HOLD_REASONS.includes(record.reason)) return null;
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    const at = Date.parse(record.at);
    if (!Number.isFinite(at)) return null;
    if (now - at > GATE_EPISODE_MAX_IDLE_MS) return null;
    if (at - now > CHECKPOINT_FUTURE_SKEW_MS) return null;
    return record;
}

// The session a checkpoint question is scoped to, from an armed goal: its bound
// session, or an explicit null when it has none.
//
// Null and undefined are different answers downstream, which is the whole
// reason this exists rather than reading goal.boundSession at each site. An
// explicit null is a session id that matches nothing, so an unbound goal
// corroborates nothing, which is right: its checkpoint records boundSession
// null and the gate never matches one. Undefined, passed to gateEpisodeOpen,
// means "any open episode counts", so a bystander's hold would answer a
// question about this run's boundary. Four callers need that distinction
// (the PreCompact gate, the checkpoint CLI, the goal-leash Stop hook's queue
// advance, and the deferral nudge), and four hand-written copies of it is how
// one of them silently ends up asking the wrong question.
function checkpointOwner(goal) {
    return (goal && typeof goal.boundSession === 'string' && goal.boundSession !== '')
        ? goal.boundSession
        : null;
}

// Does a standing deferral episode corroborate this checkpoint's pendingOffer
// flag? This is the second of the two facts checkpointMatches needs before it
// grants the long age bound, and it is single-sourced here because all four
// callers of the match rule (the PreCompact gate, the checkpoint CLI's status
// report, the goal-leash Stop hook's queue advance, and the deferral nudge's
// guard 7) must answer it identically.
//
// Three things must hold. The record must claim the flag. An episode must be
// open for the given owner, which is gateEpisodeOpen's question, including its
// idle and future-skew bounds. And the episode must PREDATE the record.
//
// That last test is what keeps the gate from corroborating itself. A boundary
// deny writes an episode owned by the denying session, dated at the deny. So
// without it: an offer arrives against a six-hour-old pending checkpoint, is
// denied on the short leg (no episode yet), and that denial's own record mints
// an episode; the next offer, one assistant turn later, reads that episode,
// corroborates, and honors the very checkpoint just rejected. The record is
// never consumed on a deny, so it is still sitting there to be honored. Since
// an extending deny keeps the standing episode's `since`, an episode minted
// this way stays too young forever rather than aging into eligibility.
//
// A real deferral is unaffected: the deny comes first, the boundary is declared
// after it, and the record's openedAt is therefore later than the episode's
// since. Equal timestamps count as predating, since a record opened in the same
// millisecond as a denial is the legitimate ordering at its limit.
//
// Both timestamps must parse. A NaN on either side yields NOT corroborated
// rather than a silent true, which is the fail-safe direction: an unparseable
// openedAt already fails checkpointMatches upstream, and gateEpisode refuses an
// episode whose since does not parse, so neither is reachable through this
// file's own writers, and the guard costs one comparison.
//
// An undefined owner is NOT corroboration, and that is worth stating because
// gateEpisodeOpen reads the same value the other way: there, omitting the
// argument asks whether any session is held, which is what a human running
// status wants. Here the answer feeds a decision, and the two defaults in this
// API would otherwise point in opposite directions, with checkpointMatches
// reading a missing argument as not corroborated (fail-safe) and this one
// turning it into a bystander's hold granting the long lease (fail-open). Every
// caller today passes a string or an explicit null; this keeps the next one
// from inheriting the permissive reading by omission. Use checkpointOwner to
// derive the value from a goal.
function pendingOfferCorroborated(cp, state, nowMs, ownerSessionId) {
    if (!cp || typeof cp !== 'object' || cp.pendingOffer !== true) return false;
    if (ownerSessionId === undefined) return false;
    const episode = gateEpisodeOpen(state, nowMs, ownerSessionId);
    if (!episode) return false;
    const since = Date.parse(episode.since);
    const opened = typeof cp.openedAt === 'string' ? Date.parse(cp.openedAt) : NaN;
    if (!Number.isFinite(since) || !Number.isFinite(opened)) return false;
    return since <= opened;
}

// Whole minutes between an ISO timestamp and now, or null when it does not
// parse. Negative ages (a clock adjustment, a hand-edited file) floor at zero:
// every surface that reports one states it as an elapsed duration, and a
// negative duration is not a thing an operator can act on.
function wholeMinutesSince(iso, nowMs) {
    const at = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (!Number.isFinite(at)) return null;
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    return Math.max(0, Math.floor((now - at) / 60000));
}

function countPhrase(n, singular) {
    return n + ' ' + singular + (n === 1 ? '' : 's');
}

// "held 3 offers over 12 minutes": the count of offers held in this episode and
// its age, as one phrase, single-sourced because two surfaces report the same
// two integers (the gate's stderr note and the checkpoint CLI's status) and an
// operator reading both should not have to reconcile two phrasings. Two
// integers and nothing else, which is what keeps a user-writable state file off
// those channels. Null when the episode's age cannot be read, so a caller says
// nothing rather than guessing.
//
// BOTH integers are clamped by the same helper, and for the same reason. The
// count comes from a user-writable file and so does the timestamp the duration
// is measured from: a `since` of the year 1 renders a nine-figure minute count,
// and a date near the floor of the type renders a twelve-figure one, neither of
// which an operator can read as a duration. The clamp bounds what reaches those
// two channels without misreporting any real episode, since a genuine hold is
// minutes to hours and nothing near the bound.
function episodePhrase(episode, nowMs) {
    if (!episode) return null;
    const minutes = gateCount(wholeMinutesSince(episode.since, nowMs));
    if (minutes === null) return null;
    return 'held ' + countPhrase(episode.denials, 'offer') + ' over ' + countPhrase(minutes, 'minute');
}

// The state file's read cap. The writer produces a few hundred bytes and never
// grows: it holds two records, one episode, and a list of hold records bounded
// at INTERACTIVE_HOLD_MAX_ENTRIES, each rebuilt field by field with capped
// strings. Anything past a quarter megabyte is not something this wrote,
// and reading it whole on a per-offer hook path is cost with nothing to gain.
const GATE_STATE_MAX_BYTES = 256 * 1024;

// Read the gate state, distinguishing a file that is not there from one that
// cannot be read right now. Returns { ok, state, reason }:
//
//   { ok: true,  state }        legible, rebuilt (state is null when the file is
//                               absent, unparseable, or not an object: none of
//                               those carries an episode to lose)
//   { ok: false, state: null }  the answer is unknown, so no caller may act as
//                               though the file were absent
//
// reason names which refusal produced an { ok: false }: 'kind' (something that is
// not a regular file), 'oversized' (past the read cap), 'unreadable' (the read
// itself was refused) or 'lstat' (the path's own kind could not be read). Every
// decision path treats the four alike; the status report does not, because the
// remedy it prints differs by leg and only one of the four is permanent. The
// reason is carried out of here rather than re-derived because it cannot be
// re-derived: an lstat run afterwards succeeds and reports an ordinary regular
// file for the 'unreadable' leg, so a reporter re-asking that way describes a
// scanner's lock as a corrupt file and tells the operator to delete the standing
// deferral episode.
//
// The distinction is load-bearing on the write path. A file locked by an
// indexer or an antivirus scanner (EBUSY, EPERM) is not an absent file, and
// treating it as one would rewrite a live episode as a fresh count of one,
// destroying exactly the reading this record exists to produce. The gate's note
// wants the same distinction: it says nothing rather than reporting a projected
// count of one on the fiftieth deny of a section.
//
// The refusal legs come first and cover this file's own hazards: a non-regular
// path (a FIFO here blocks the read forever, with no verdict emitted, since
// every caller of this runs on the gate's critical path) and an oversized one.
function readGateStateResult(cwd) {
    const target = gateStatePath(cwd);
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, state: null };
        return { ok: false, state: null, reason: 'lstat' };
    }
    if (!st.isFile()) return { ok: false, state: null, reason: 'kind' };
    if (st.size > GATE_STATE_MAX_BYTES) return { ok: false, state: null, reason: 'oversized' };
    let raw;
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, state: null };
        return { ok: false, state: null, reason: 'unreadable' };
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { ok: true, state: null }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: true, state: null };
    return {
        ok: true,
        state: {
            lastDecision: gateRecord(parsed.lastDecision),
            episode: gateEpisode(parsed.episode),
            lastAllow: gateRecord(parsed.lastAllow),
            interactiveHolds: gateHolds(parsed.interactiveHolds)
        }
    };
}

// The gate state, or null when it is absent, refused, unreadable, or not JSON.
// The reading surfaces take this shape because they act the same way on all
// four: a null state and a state whose fields are null both mean no decision
// recorded, no episode open and no hold standing, and each of those is a
// silence at the caller that asks it. A caller that must not confuse "not
// there" with "cannot tell" takes readGateStateResult instead.
function readGateState(cwd) {
    return readGateStateResult(cwd).state;
}

// The state that follows a prior state and a new record. Pure: it writes
// nothing, so the gate can project the episode its note will report before it
// attempts the write that stores it.
//
// The episode belongs to the LEASH, not to whichever session denied last, and
// that is what makes one slot enough. The two deny classes have disjoint
// producers: a boundary deny is reachable only behind the gate's own
// armed-and-bound test (or the bind-claim that immediately follows it), so only
// the bound session can produce one and it always carries a session id, while
// an interactive deny is the only deny on the bystander and nothing-armed
// fall-through. An interactive hold runs the other way and is stored the other
// way: it belongs to the session rather than to the leash, so it lives in a
// list holding one record per session (INTERACTIVE_HOLD_MAX_ENTRIES). So:
//
//   deny-boundary     extends the standing episode when it owns it, and
//                     otherwise opens a fresh one at one. Replacing a foreign
//                     incumbent is right on this path rather than harmful: the
//                     binding is exclusive, so a foreign owner here can only be
//                     a dead binding (a crash, then a re-arm), never a rival.
//                     It also drops the denied session's own hold record: this
//                     verdict is the leash holder's class, so a hold on the
//                     hands-on leg has ended for that session by the time it
//                     reaches here. Another session's hold is untouched.
//   deny-interactive  records the decision and carries the standing episode
//                     through untouched. A bystander, or a project with nothing
//                     armed, never opens, extends, inflates, or destroys one.
//                     The hold it IS goes to the head of the per-session hold
//                     list, which is where a reader asks whether one session is
//                     being held.
//   allow             clears the episode only when the allower owns it, and
//                     drops the allower's own hold record. An allow lands a
//                     compaction in the allower's own context; a bystander's
//                     compaction says nothing about the offers the bound
//                     session is still being denied, and neither one ends
//                     another session's hold.
//
// A decision carrying no session id never opens or extends an episode. The
// partition above makes that unreachable on the boundary path, and the rule
// stays as a floor so no unownable record can reach the disk.
//
// What this costs, taken deliberately: an interactive hold has no episode
// aggregate. In a project holding a hands-on session, status reports the last
// decision's recency but no count and no duration, and says no episode is open.
// The .jsonl log still carries every one of those denials.
//
// The one contention left: two sessions whose transcripts both claim the same
// unbound goal (the superseded-arming window the gate's header documents) can
// alternate boundary denies and reset each other's count. It is self-limiting,
// because each offer re-reads the goal and whichever bind landed last takes the
// boundary path; the tell is a note whose count never grows during a run you
// believe is singly leashed. That contention's failure direction is an
// UNDERCOUNT, which degrades to the pre-plan status quo (a compaction landing
// mid-chapter), never to a checkpoint honored longer than it should be.
//
// One direction does run the other way, and it is stated rather than claimed
// away. This writer has no compare-and-set, unlike the nudge stamp, so a
// bystander session's deny-interactive carries `standing` through from a read
// taken before the bound session's allow, and writing it back restores the
// episode that allow had just cleared. A pending checkpoint the allow left
// standing is then vouched for once more. It needs two gate processes in the
// same project inside the same few milliseconds, and its cost is bounded by the
// same one-mistimed-compaction ceiling as everything else here, so it is carried
// as a residual rather than closed; the fix, if it is ever worth its complexity,
// is the gateOwnedFingerprint verify the EPISODE stamp already uses, which
// catches this shape because every gate write moves the decision fields that
// tuple carries. The hold stamp writes a file of its own and takes no such
// verify (recordHoldNudge states why). The hold list
// rides the same window on the same terms, and costs less when it loses: a
// record written inside that gap by another session is dropped, and that session
// is unheld until its own next deny, one assistant turn later.
//
// So an open episode means "this session has been denied, with no allow since,
// recently", which is the pending-offer signal the checkpoint rule and the
// nudge read: past the compaction trigger the harness re-offers every assistant
// turn, so once a deny has landed the offers recur until one is allowed.
function nextGateState(prior, record) {
    const lastAllow = prior ? gateRecord(prior.lastAllow) : null;
    const standing = gateEpisodeOpen(prior, Date.parse(record.at));
    const mine = !!standing && sameSessionId(standing.session, record.session);
    // The whole state is rebuilt from a fixed key set on every write, so a key
    // this does not carry through is erased by the next decision.
    const holds = gateHolds(prior ? prior.interactiveHolds : null);
    if (record.verdict === 'allow') {
        return {
            lastDecision: record,
            episode: mine ? null : standing,
            lastAllow: record,
            // An allow lands this session's own compaction, which ends whatever
            // hold it was under, so its record leaves the list. Another
            // session's hold is untouched, on the same reasoning the episode
            // takes: an allow says nothing about the offers a different seat is
            // still being denied.
            interactiveHolds: holds.filter((h) => !sameSessionId(h.session, record.session))
        };
    }
    if (record.verdict === 'deny-boundary' && record.session) {
        // A boundary deny is the leash holder's own class, reachable only behind
        // the armed-and-bound test, so the session it names is not a session
        // held on the hands-on leg: whatever interactive hold it was under has
        // ended, and its release is a chapter boundary rather than the
        // role-boundary marker the hold directive names. Carried through, the
        // record would have the state asserting one session is both held as a
        // bystander and holding the leash, and the directive would be spoken at
        // a seat whose next offer is decided on the boundary leg. Another
        // session's hold is untouched, on the reasoning the episode and the
        // allow branch both take.
        const held = holds.filter((h) => !sameSessionId(h.session, record.session));
        if (mine) {
            return {
                lastDecision: record,
                episode: {
                    session: standing.session,
                    since: standing.since,
                    denials: standing.denials + 1,
                    lastDeniedAt: record.at,
                    nudgedAt: standing.nudgedAt
                },
                lastAllow,
                interactiveHolds: held
            };
        }
        return {
            lastDecision: record,
            episode: {
                session: record.session,
                since: record.at,
                denials: 1,
                lastDeniedAt: record.at,
                nudgedAt: null
            },
            lastAllow,
            interactiveHolds: held
        };
    }
    // An interactive deny, or the session-less boundary deny the partition
    // makes unreachable: the decision is recorded and the episode slot is left
    // alone. An interactive deny naming a session also takes the head of the
    // hold list, replacing that session's own prior record, which is what makes
    // the hold readable per session on a checkout several sessions share.
    const held = (record.verdict === 'deny-interactive' && record.session)
        ? [record, ...holds.filter((h) => !sameSessionId(h.session, record.session))]
            .slice(0, INTERACTIVE_HOLD_MAX_ENTRIES)
        : holds;
    return { lastDecision: record, episode: standing, lastAllow, interactiveHolds: held };
}

// The episode this decision's OWN session will stand under once the decision is
// recorded, computed without writing anything. The gate's note has to report
// the hold including the decision it is announcing, and it has to be composed
// before the write is attempted, so a write that fails, or blocks, cannot make
// the note report a prior state as if it were current.
//
// Null when there will be no open episode belonging to this session, and null
// whenever the record cannot land at all (gateRecordTargets owns that whole
// set: an unreadable state, a refused path, an unwritable file). Projecting
// over a state that will never advance is what produces a fresh count of one on
// the fiftieth deny of a section, a stuck number that reads exactly like the
// mechanism working, and it puts two operator-facing surfaces in contradiction:
// stderr claiming a hold that status says was never recorded.
function projectGateEpisode(cwd, decision) {
    try {
        const record = gateRecord(decision);
        if (!record) return null;
        record.at = new Date().toISOString();
        const targets = gateRecordTargets(cwd);
        if (!targets.ok) return null;
        const at = Date.parse(record.at);
        return gateEpisodeOpen(nextGateState(targets.prior, record), at, record.session);
    } catch {
        return null;
    }
}

// Write JSON atomically (tmp file plus rename), on writeCheckpoint's discipline
// and for the same reasons: a failed rename unlinks its tmp so orphans do not
// accumulate in .kit/. The containing directory is a precondition, never
// created here (see the section header; the marker writer creates its own
// directory before calling). Throws on failure; every caller catches.
//
// verifyBeforeRename is optional and runs in the last moment before the rename,
// with the tmp file already written: returning false abandons the write and
// unlinks the tmp, and this function returns false rather than throwing. It sits
// here rather than in the caller because this is the only point where "still
// true" and "now published" are adjacent; a check the caller ran before calling
// would leave the whole tmp write inside the window it is trying to close.
function writeJsonAtomic(target, value, verifyBeforeRename) {
    const tmp = atomicTmpPath(target);
    let created = false;
    try {
        // Create and write are separate calls so created can mean "the exclusive
        // create returned": spelled as one call, a failure in the write leg
        // leaves the flag false with the file already on disk and the cleanup
        // below skips it.
        const fd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
            wrote = true;
        } finally {
            // Swallowed while the write's own error is in flight, rethrown once
            // the write has returned: at that point the close is where a deferred
            // write error surfaces, and dropping it publishes a torn file behind a
            // success. Same split as writeCheckpoint's.
            try {
                fs.closeSync(fd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        if (typeof verifyBeforeRename === 'function' && verifyBeforeRename() !== true) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove */ }
            return false;
        }
        fs.renameSync(tmp, target);
        return true;
    } catch (err) {
        // Only what this writer created is this writer's to remove (see
        // atomicTmpPath).
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove, or it is the unwritable path itself */ }
        }
        throw err;
    }
}

// The gate-owned part of a state, as one comparable string: the newest
// decision's identity and timestamp, and the episode identity the gate
// maintains. Two fields the gate also owns are outside the tuple for their own
// reasons. nudgedAt is the nudge's own and a concurrent nudge overwriting it
// costs nothing. The interactive hold list moves only inside a gate write, which
// always moves the decision fields with it, so a change there is already caught
// by what is here; adding it would cost a comparison and catch nothing further.
//
// This exists for the episode stamp's compare-and-set. Every gate write goes through
// nextGateState, which rebuilds lastDecision from a record whose `at` this
// writer stamps at write time, and an episode is only ever opened, extended or
// replaced with a new lastDeniedAt or denials, so a gate write between two reads
// moves one of these in the ordinary case. `at` alone would not be enough: it is
// an ISO string at millisecond resolution, and a deny-interactive carries the
// episode through untouched, so two distinct decisions inside one millisecond
// would fingerprint identically. The decision's verdict, reason and session ride
// along, which narrows that case rather than closing it: the tuple leaves out
// consumed, the checkpoint block and lastAllow, so two deny-interactive
// decisions in one millisecond carrying the same reason and session still
// fingerprint the same. What that costs is one unstamped nudge, which is the
// undercount this file prefers everywhere.
function gateOwnedFingerprint(state) {
    const decision = state ? state.lastDecision : null;
    const episode = state ? state.episode : null;
    return JSON.stringify([
        decision ? decision.at : null,
        decision ? decision.verdict : null,
        decision ? decision.reason : null,
        decision ? decision.session : null,
        episode ? episode.session : null,
        episode ? episode.since : null,
        episode ? episode.denials : null,
        episode ? episode.lastDeniedAt : null
    ]);
}

// Rewrite the log to its newest GATE_LOG_KEEP_BYTES. The tail is taken at a
// byte offset, which lands mid-line and possibly mid-character, so everything
// up to and including the first newline is discarded: what survives is whole
// lines only, which is what lets a reader parse every line it finds. The
// rewrite goes through a tmp file and a rename, so a failure leaves the old log
// intact rather than truncated.
//
// A rewrite that would keep NOTHING is refused: the file is left exactly as it
// is. That is the degenerate case of a line longer than the keep bound, which
// nothing here writes but a hand-edited or foreign file can hold, and it
// arrives in two shapes: a tail with no line break in it at all, and one whose
// only break is the terminator at its very end. Both would trade the whole log
// for an empty file, and an oversized log is a far smaller problem than a
// destroyed one. The append that follows still lands.
function trimGateLog(logPath, size) {
    const fd = fs.openSync(logPath, 'r');
    let text;
    try {
        text = readFully(fd, size - GATE_LOG_KEEP_BYTES, GATE_LOG_KEEP_BYTES);
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    const nl = text.indexOf('\n');
    const kept = nl === -1 ? '' : text.slice(nl + 1);
    if (kept === '') return;
    const tmp = atomicTmpPath(logPath);
    let created = false;
    try {
        // Create and write are separate calls so created can mean "the exclusive
        // create returned": spelled as one call, a failure in the write leg
        // leaves the flag false with the file already on disk and the cleanup
        // below skips it, stranding up to a megabyte of trimmed gate journal.
        const outFd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(outFd, kept, 'utf8');
            wrote = true;
        } finally {
            // Swallowed while the write's own error is in flight, rethrown once
            // the write has returned: at that point the close is where a deferred
            // write error surfaces, and dropping it publishes a torn log behind a
            // success. Same split as writeCheckpoint's. The descriptor is named
            // apart from the read descriptor above it, since a leaked or
            // mis-closed one is this writer's own failure mode.
            try {
                fs.closeSync(outFd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        fs.renameSync(tmp, logPath);
    } catch (err) {
        // Only what this writer created is this writer's to remove (see
        // atomicTmpPath).
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove, or it is the unwritable path itself */ }
        }
        throw err;
    }
}

// Is this path writable, or absent? Absent is fine: the write creates it. Any
// other refusal (a read-only file, a permission, a lock) is not, and is the
// case a caller must be able to see BEFORE it promises anything about a record
// landing.
function writableOrAbsent(target) {
    try {
        fs.accessSync(target, fs.constants.W_OK);
        return true;
    } catch (err) {
        return !!(err && err.code === 'ENOENT');
    }
}

// The directory leg on its own: the scratch directory this project's files live
// in exists, is a real directory rather than a link to one, and is writable.
// Returns { ok:true, kit } or { ok:false }, and never throws.
//
// Split out because it is the whole precondition for a writer whose file is its
// own, while gateStateTarget below is the precondition for writing the gate
// STATE. A writer that takes more than it needs refuses for a condition on
// another file: the hold stamp gated on the state's writability is silenced by a
// read-only compact-gate.json, which disables the interval for a session whose
// own hold was perfectly legible.
//
// What every caller does inherit is that the record is written only in a project
// that is ALREADY kit-governed, the section header's rule: an existing .kit/, or
// an armed goal resolving for this directory, and nothing else creates one.
function gateScratchTarget(cwd) {
    try {
        const kit = kitScratchDir(cwd);
        let dir;
        try {
            dir = fs.lstatSync(kit);
        } catch (err) {
            // An absent scratch directory refuses unless an armed goal
            // resolves for this directory, which is the one case the section
            // header licenses creating it. The case it reaches is the
            // store-backed one, where the scratch directory is
            // ~/.kit/store/<rel> rather than the project's own .kit/ that an
            // armed goal already implies. Only ENOENT reads as absent; any
            // other failure is an unknown answer and stays a refusal. The
            // mkdir is recursive because that branch of the resolver names a
            // directory several levels below a root that need not exist yet,
            // and the armed-goal condition above is what bounds it: a goal
            // resolves only for a directory that is already there. A failure
            // (a racing creator included) lands in the outer catch as
            // { ok: false }, degrading exactly as an unreadable directory
            // does.
            if (!err || err.code !== 'ENOENT') return { ok: false };
            const goal = readGoal(cwd);
            if (!goal || !goal.plan) return { ok: false };
            fs.mkdirSync(kit, { recursive: true });
            dir = fs.lstatSync(kit);
        }
        if (!dir.isDirectory() || !writableOrAbsent(kit)) return { ok: false };
        return { ok: true, kit };
    } catch {
        return { ok: false };
    }
}

// Everything that must hold before the gate STATE can be rewritten: the
// directory leg above, plus a state path that is a regular file this process may
// write and a state that is legible as it stands right now.
//
// Returns { ok:true, statePath, prior } or { ok:false }.
//
// It is its own function because the state's two writers need different amounts
// of it and neither may spell it by hand. The decision recorder also appends to
// the log, so it takes this plus the log legs (gateRecordTargets below). The
// episode nudge stamps the state and then appends one journal line best-effort,
// after the fact and answering for its own path, so the log legs are not its
// preconditions at all: gating the stamp on the log would make a locked or
// read-only .jsonl silently disable the nudge's interval, and the nudge would
// then repeat after every covered tool return for the life of the episode. The
// hold stamp writes neither this file nor the log and takes the directory leg
// alone.
function gateStateTarget(cwd) {
    try {
        if (!gateScratchTarget(cwd).ok) return { ok: false };
        const statePath = gateStatePath(cwd);
        if (regularFileSize(statePath) === null || !writableOrAbsent(statePath)) return { ok: false };
        const prior = readGateStateResult(cwd);
        if (!prior.ok) return { ok: false };
        return { ok: true, statePath, prior: prior.state };
    } catch {
        return { ok: false };
    }
}

// Everything that must hold before a DECISION can be recorded: the state legs
// above plus the log the recorder appends to. Two callers need this full answer:
// the writer, which refuses to write, and the projection behind the gate's stderr
// note, which refuses to promise a count that will never be stored. Split, they
// drift, and the drift has a specific shape: the note reporting "held 1 offer
// over 0 minutes" on the fifth deny and the five hundredth, because the state
// never advanced and each projection re-derived the same first step from the
// same unchanged file. A stuck number reads exactly like a mechanism working.
//
// Returns { ok:true, statePath, logPath, logSize, prior } or { ok:false }.
//
// It cannot promise the write will succeed, only that nothing already known
// stops it: a disk that fills between here and the rename still throws, and
// that residual is caught and swallowed like any other. What it does cover is
// every condition that PERSISTS across offers, which is the set that turns one
// wrong sentence into the same wrong sentence forever.
function gateRecordTargets(cwd) {
    try {
        const state = gateStateTarget(cwd);
        if (!state.ok) return { ok: false };
        const logPath = gateLogPath(cwd);
        const logSize = regularFileSize(logPath);
        if (logSize === null || !writableOrAbsent(logPath)) return { ok: false };
        return { ok: true, statePath: state.statePath, logPath, logSize, prior: state.prior };
    } catch {
        return { ok: false };
    }
}

// Record one gate decision: rewrite the state and append one line to the log.
//
// Returns nothing, and that is the design rather than an omission. The gate
// calls this once its verdict is already announced, and a caller able to see
// whether the write landed is a caller able to decide differently because of
// it; the record must never be in a position to move a compaction. Every
// failure is swallowed for the same reason, so an unwritable .kit/ leaves the
// verdict, the exit code, and the stderr note exactly as they would have been.
//
// Every refusal is gateRecordTargets', shared with the projection behind the
// gate's note so the two cannot disagree about whether a record can land.
//
// The state is authoritative and the log is the journal. The state is written
// first, and a refusal or a failure there abandons the line too, so the log
// never counts a denial the state does not know about. The reverse is NOT
// guarded: once the state has advanced, a throw from the trim or the append
// loses that line, so the log can undercount what the state has counted. That
// asymmetry is deliberate, and this is the direction to prefer, because an
// operator reading the log to answer "how often" can survive a missing line,
// while a state that disagrees with its own journal about an open episode is
// what every consumer decides from.
//
// Concurrency: two gate processes in one project both read a count and both
// write its successor, so a denial can be lost from the count as well as from
// the log. There is no lock. The failure is an undercount, and a diagnostic does
// not earn a lock file. The log has the matching residual: a trim keeps the tail
// ending at a size read moments earlier and renames the result over the file, so
// a line appended in between is dropped. Both nudges journal through
// logEpisodeNudge, which trims on the same rule, so three callers can reach that
// path rather than one. Same conclusion, same reason.
//
// The state has a second writer, recordEpisodeNudge, and it can fire more often
// than this one, though not on every tool return: it is behind an open episode
// and behind its own interval, so its ceiling is one write per NUDGE_INTERVAL_MS
// per tool batch while a hold stands. It carries the last decision and the last
// allow through verbatim, so a gate write landing between its read and its
// rename would be clobbered. Its compare-and-set narrows that window to the
// rename itself rather than closing it, and what it does catch leaves an
// unstamped nudge (a silence) rather than a lost denial. The residual direction
// is the same undercount this file already prefers everywhere: the count reads
// low, the episode stays open, and nothing is honored longer than it should be.
//
// This writer has no compare-and-set of its own, and the other direction is the
// residual: its read-modify-write carries the episode through from its own
// earlier read, so a decision whose read predates a nudge's rename writes the
// pre-stamp nudgedAt back and that episode loses its interval. The whole cost is
// one extra nudge on the next tool return, which is why this stays a stated
// residual rather than a second lock on the path the gate decides from.
function recordGateDecision(cwd, decision) {
    try {
        const record = gateRecord(decision);
        if (!record) return;
        // The writer stamps the time, never the caller: `at` is what every age
        // in the status report and the deferral note is measured from, so it
        // has to come from one clock rather than from a value passed in.
        record.at = new Date().toISOString();

        const targets = gateRecordTargets(cwd);
        if (!targets.ok) return;
        const { statePath, logPath, logSize, prior } = targets;

        writeJsonAtomic(statePath, nextGateState(prior, record));
        if (logSize > GATE_LOG_MAX_BYTES) trimGateLog(logPath, logSize);
        // One append of one line: a line is written whole or not at all, so a
        // reader never meets a half-written record. A log that does not already
        // end on a line boundary (hand-edited, or truncated by a crash) gets the
        // break first, so the append cannot fuse two records into one line that
        // parses as neither.
        const prefix = endsOnLineBoundary(logPath) ? '' : '\n';
        fs.appendFileSync(logPath, prefix + JSON.stringify(record) + '\n', 'utf8');
    } catch { /* diagnostic only: a decision that cannot be recorded is still taken */ }
}

// Stamp the deferral nudge's clock onto the open episode. This is the one writer
// of a nudgedAt VALUE, the field nextGateState carries through on an extension
// and nulls when a fresh boundary deny opens an episode. It is called by
// compact-deferral-nudge.js BEFORE it emits and gates that emission: the hook
// speaks only when this returns true (see the boolean below). The stamp is what
// makes the nudge's interval survive the separate hook processes that enforce
// it, since each tool return runs a fresh process and the episode record is the
// only place a "last spoke at" can live between them.
//
// Nothing is written unless an episode is genuinely open for this owner, which
// is gateEpisodeOpen's question including its idle and future-skew bounds, so a
// nudge can neither resurrect a finished episode nor mint one no denial
// produced. An owner that is not a usable session id writes nothing either:
// gateEpisodeOpen reads a missing argument as "any open episode counts", which
// is the right default for a human running status and the wrong one for a
// writer, since it would let one session's nudge stamp another's hold.
//
// Every other field is carried through untouched, `since` above all. An
// episode's start is preserved across every extension, so a stamp that re-dated
// it would shorten the age both operator-facing surfaces report and would move
// the predate comparison pendingOfferCorroborated turns on.
//
// Returns true when the stamp is on disk and false on every other path, and never
// throws. The boolean is the whole point: this field is not diagnostic, it IS the
// nudge's rate limit, and the only cross-process carrier the interval has. A
// caller that emitted without it would have no rate limit at all, so the hook
// emits only when this returns true. Silence is the pre-hook status quo; an
// unbounded repeat into a context already past the compaction trigger is worse
// than that status quo, so the failure direction is silence.
//
// The refusal preconditions are gateStateTarget's, shared with the recorder rather
// than spelled a second time: .kit/ must exist (an absent one is created only for
// a directory an armed goal resolves for, per the section header), the state file
// must be a regular file this process may write, and the state must be legible
// right now. The log legs are deliberately NOT among them, even though
// this writer does append one journal line: that line comes after the stamp and
// answers for its own path, so a locked or read-only log costs a log line and never
// the interval.
//
// The written object is derived from what was read rather than enumerated field by
// field, so the state's shape is single-sourced at readGateStateResult for this
// writer exactly as it is for the recorder: a field added there rides through here
// untouched instead of being dropped by a stale literal.
//
// The write carries a compare-and-set over the gate-owned fields, re-read in the
// last moment before the rename. It NARROWS the window to the rename itself and
// closes nothing: the re-read and the rename are adjacent statements, so a gate
// write landing in that gap is still clobbered. It is not a general lock either,
// and the interval race across a parallel tool batch is deliberately uncovered
// (the hook header states that bound). What it narrows is a real inversion of
// this file's own rule that nothing is honored longer than it should be. An
// allow at the valve, or on an illegible reading, clears the episode without
// consuming the checkpoint, since the gate consumes only on a match. A stamp
// whose read predates that allow would write the episode back, with its original
// `since`; pendingOfferCorroborated would vouch for the standing checkpoint
// again, checkpointMatches would grant it the 24-hour bound instead of ten
// minutes, and a compaction would land against a boundary declared hours
// earlier, mid-chapter. Failing closed here costs one silent nudge.
//
// After the stamp lands, one line goes to the log, best-effort and outside every
// precondition above. An operator asking whether the mechanism spoke can then
// tell a nudge that never fired from one that fired five times and was ignored,
// which is the question the plan puts to that log. It is kept outside the stamp
// preconditions on purpose: a locked or read-only .jsonl must never be able to
// disable the interval, which is what the state-only precondition split buys.
//
// toolName is the tool whose return triggered the nudge, carried into the record
// for one reading it makes possible: the nudge is delivered per context, while
// the interval lives on one shared episode, so a run whose nudge lines are all
// Bash while the main session's covered returns are predominantly Agent and
// TaskOutput is a dispatched agent consuming the interval the main session
// needed. A bare count cannot show that. It is a signal to read, not a proof.
function recordEpisodeNudge(cwd, sessionId, nowMs, toolName) {
    let stampedAt = null;
    try {
        if (typeof sessionId !== 'string' || sessionId === '') return false;
        const at = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
        const target = gateStateTarget(cwd);
        if (!target.ok) return false;
        const prior = target.prior;
        const episode = gateEpisodeOpen(prior, at, sessionId);
        if (!episode) return false;
        const basis = gateOwnedFingerprint(prior);
        const iso = new Date(at).toISOString();
        const landed = writeJsonAtomic(target.statePath, {
            ...prior,
            episode: { ...episode, nudgedAt: iso }
        }, () => {
            const current = readGateStateResult(cwd);
            return current.ok && gateOwnedFingerprint(current.state) === basis;
        });
        if (!landed) return false;
        stampedAt = iso;
    } catch { /* an unstamped episode is a silent one: the caller emits nothing */ }
    if (stampedAt === null) return false;
    logEpisodeNudge(cwd, sessionId, stampedAt, toolName);
    return true;
}

// One journal line for a nudge that fired. Never throws and returns nothing.
// It answers for the log file itself, which must be a regular file this process
// can write, and applies the same trim bound and line-boundary discipline the
// decision recorder uses, so a reader still meets whole lines only. What it
// does not re-check is the .kit directory leg (a real directory rather than a
// link to one): both of its callers establish it on the same repo before they
// call, the episode stamp through gateStateTarget and the hold stamp through
// gateScratchTarget, which is the directory leg gateStateTarget itself opens
// with. This is written for those two rather than as a standalone entry point.
//
// The record is distinguishable from a decision by shape rather than by absence:
// it carries `event` where a decision carries `verdict`, so a reader folding the
// log can partition it without guessing. Three fields of provenance and nothing
// else: the time, the session the hold belongs to, and the tool whose return
// triggered it. Each is rebuilt through gateText, so a forged or odd value
// cannot push control characters into an operator's terminal or grow the line.
//
// The event value names WHICH nudge spoke, because two of them share this
// journal and an operator reading it is asking different questions of each: a
// leashed run's chapter-boundary directive against an open episode ('nudge'),
// and a held hands-on session's durability directive against its own interactive
// deny ('nudge-hold'). One value for both would fold the two counts together,
// and the second is the one whose whole point is that it reaches a session the
// first can never speak to. An absent or illegible value reads as the episode
// nudge, which is the older caller and the one whose record shape the suite
// pins.
//
// The vocabulary is closed, exactly as GATE_REASONS closes a decision's reason
// and for the same reason: the journal is read by an operator at a terminal,
// and gateText's charset and length caps alone would let arbitrary prose
// through. Nothing in the kit parses this file, so the field's audience is that
// operator and whatever a later consumer folds the lines through. Both callers
// pass a literal today, so what the check buys is that a third caller cannot
// widen the field by passing a value through; an unrecognized one reads as the
// episode nudge rather than being written.
const NUDGE_EVENTS = ['nudge', 'nudge-hold'];

function logEpisodeNudge(cwd, sessionId, atIso, toolName, event) {
    try {
        const logPath = gateLogPath(cwd);
        const logSize = regularFileSize(logPath);
        if (logSize === null || !writableOrAbsent(logPath)) return;
        if (logSize > GATE_LOG_MAX_BYTES) trimGateLog(logPath, logSize);
        const record = {
            at: atIso,
            event: NUDGE_EVENTS.includes(event) ? event : 'nudge',
            session: gateText(sessionId),
            tool: gateText(toolName)
        };
        const prefix = endsOnLineBoundary(logPath) ? '' : '\n';
        fs.appendFileSync(logPath, prefix + JSON.stringify(record) + '\n', 'utf8');
    } catch { /* the journal is diagnostic: a line that cannot be written is dropped */ }
}

// The deferral nudge's clock for a hold that owns no episode, kept in its own
// small file beside the gate state.
//
// It cannot live in the state file, and that is a property of the state's
// writers rather than a preference. nextGateState rebuilds the whole state from
// a fixed key set on every write, its four keys and nothing else, so any field
// added beside them is dropped by the next gate write, and during a
// hold the gate writes on every offer, which past the trigger is every assistant
// turn. A stamp there would be erased minutes after it landed and the interval
// it exists to enforce would never engage. The episode slot is not available
// either: an interactive deny deliberately opens no episode (nextGateState), and
// minting one from a nudge would hand a bystander's hold to
// pendingOfferCorroborated as a vouching episode for someone else's checkpoint.
//
// The file holds a LIST of one entry per session rather than a single stamp,
// because a project can hold several bystander sessions at once, which is the
// ordinary state of a shared checkout. With one slot they would clobber each
// other's stamps and each read would find another session's, which reads as
// never-nudged: the interval would collapse and every one of them would be
// nudged after every covered tool return, the unbounded repeat the nudge's own
// header calls worse than silence.
//
// What keeps the list short is AGE rather than the count cap, and the split
// matters because the two bound different failures. A stamp older than the
// nudge's interval throttles nothing: the next call fires whether it is there or
// not, so dropping it on read costs nothing and is what keeps a project that has
// seen dozens of sessions over a day from carrying a cap's worth of dead
// entries. The count cap is a backstop against an unbounded file and nothing
// more, and it has to be, because eviction by count alone is not a bounded
// degradation: each evicted session is a LIVE one whose next covered tool return
// fires and evicts a third, so past the cap the whole list becomes a round robin
// re-nudging every seat every few fires instead of every interval. With the age
// rule in force an eviction can only ever drop a stamp that was already spent,
// unless more sessions than the cap are held in one project inside a single
// interval, which is the residue this leaves and the only shape the collapse
// still has.
const HOLD_NUDGE_MAX_ENTRIES = 8;

// How long a stamp throttles anything, which is the nudge's own interval
// (NUDGE_INTERVAL_MS in compact-deferral-nudge.js). It is spelled here rather
// than imported because the hook requires this library and the reverse require
// would be a cycle, so the two are held together by a cross-surface pin in
// test/compact-deferral-nudge.test.js instead. The direction that matters is
// one-sided: a value here SHORTER than the nudge's interval would drop stamps
// that are still throttling and hand back the collapse above, while a longer one
// only keeps spent entries around.
const HOLD_NUDGE_TTL_MS = 30 * 60 * 1000;

// The read cap, on readCheckpoint's reasoning: the writer produces a few short
// entries and never grows past the cap above, so anything larger is not
// something this wrote.
const HOLD_NUDGE_MAX_BYTES = 64 * 1024;

// Path to the hold-nudge stamps for a given repo root.
function holdNudgePath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-hold-nudge.json');
}

// The stamps still throttling something in this project, newest first,
// distinguishing a file that carries nothing to preserve from one that is there
// and could not be read. Returns { ok, holds, reason }, on readGateStateResult's
// shape and for its reason:
//
//   { ok: true,  holds }      the reading stands: holds is what is still
//                             throttling, and an empty one means there is
//                             genuinely nothing here to keep (an absent file, an
//                             empty one, JSON that does not parse or does not
//                             carry a holds array, and entries this reader
//                             dropped)
//   { ok: false, holds: [] }  the file is there and its contents are unknown, so
//                             no caller may act as though it were empty
//
// reason names which refusal produced an { ok: false }: 'lstat' (the path's own
// kind could not be read), 'kind' (a link at the final component), 'unreadable'
// (the open or the read itself was refused), 'oversized' (the file is larger than
// HOLD_NUDGE_MAX_BYTES, so what is past the cut is unknown) or 'short-fill' (the
// read ended short of what the descriptor promised, which is a file truncated
// under the read or a device that stopped answering).
//
// The last two are one flag and two facts at the reader below, which is why they
// are two reasons here. readFileBounded answers `bounded` for both and names the
// bound beside it, and the difference is the whole basis of the write side's
// heal: only 'oversized' says something about the FILE, that it is larger than
// anything this writer produces, while 'short-fill' says only that this READ did
// not finish, which can happen to a file full of live peer stamps.
//
// The distinction is load-bearing at two of this reader's three callers, and it
// is the WRITE side that pays most for it. recordHoldNudge rebuilds this whole
// file from what this returns and renames it into place, so an unknown reading
// taken as an empty one erases every other held session's stamp and collapses
// their intervals, which is the opposite of the preservation that
// read-modify-write exists for; it also reads WHICH refusal, healing the two
// shapes it could not have written and refusing the three that may be a lock or
// a fault over a real list. The checkpoint CLI's status verb takes the reason as
// well, and for the same distinction turned outward: a refusal here is a held
// session that is never spoken to. Its line has two halves and they are two
// different counts, so neither number stands for both. WHAT WAS READ: the five
// reasons reach FOUR leads, 'unreadable' and 'lstat' sharing one deliberately,
// since nothing there can tell a lock over a real list from a shape that never
// lifts. WHAT HAPPENS NEXT: the same five draw THREE remedies, because that half
// is composed off membership in HOLD_NUDGE_HEALABLE rather than off a reason
// name, so 'oversized' and 'kind' take one remedy between them (the next
// directive replaces the file), 'short-fill' takes its own (the stamps stand and
// a read that completes takes them again), and the shared 'unreadable'/'lstat'
// leg takes the third, which promises neither a removal nor an end to the wait.
// The plain read-only caller (holdNudgedAt, through readHoldNudges) keeps the
// empty answer for all of them, because there the two directions cost the same
// one extra nudge.
//
// THE READER AND THE WRITER DISAGREE ABOUT ONE KIND, deliberately and per kind.
// A link is named here because an open follows one and the lstat below is the
// only place that question can be asked. Every OTHER non-regular kind is not:
// a FIFO, a socket or a device node reaches readFileBounded, which refuses it on
// the descriptor and answers the same null as a lock, so this reports it as
// 'unreadable'. holdStampKind, which the WRITER asks, calls all of them 'other'
// and recordHoldNudge removes the path. The asymmetry follows from what each
// side does next. The writer's next act is an unlink of that NAME, which is safe
// whatever kind stands there and opens nothing, so a name-settled verdict costs
// it nothing. This reader's next act is an OPEN of that name, and a kind verdict
// taken off a name it then opens is exactly the swap window the shared reader
// exists to close, so the kind stays the descriptor's here. The cost is
// diagnostic and one-directional: the status verb tells an operator that such a
// path cannot be read and that anything standing there may not clear on its own,
// which is weaker than the truth for a FIFO the next directive does remove, and
// never stronger. It promises no repair that fails to come, and no wait that
// does not end, which are the two ways that surface could mislead.
//
// The file is user-writable, so both fields are rebuilt through gateText exactly
// as the journal's are, and a second entry for a session already kept is dropped
// rather than kept behind the first, on gateHolds' reasoning: newest-first order
// is what decides which stamp answers for a session, and a duplicate left in
// would hold a capped slot against a live one.
//
// The bytes come through kit-read-lib's shared bounded reader rather than
// through a kind check on the name followed by an open of that same name, which
// is the guard the nudge's own signpost read takes and is a property of the
// channel rather than of whichever caller first needed it: the kind and the
// size are settled on the descriptor the read is about to consume, and off
// win32 a planted FIFO is refused instead of blocking a hook that runs after
// every covered tool return. A result the reader had to cut short is refused
// outright rather than parsed, on the same reasoning: a truncated object is not
// the file this reads. One property that reader deliberately does not give is
// taken here instead, in the one line above the open: it follows a link at the
// final component by design, so this refuses a link by name before opening,
// which is the refusal this file's own writer applies to the same path and
// which also keeps a link into a dead network mount from stalling the open.
// That reader offers the same refusal as an opt-in of its own
// (readFileBounded's refuseLink, which the deferral nudge's signpost read takes),
// and BOTH are taken here, each for what the other cannot do. The lstat is what
// makes a link a distinguishable answer: the option refuses with the null it
// answers for every other refusal, and this reader's reasons must stay apart,
// since 'kind' is a shape its writer heals by removing the path while
// 'unreadable' is a lock it must leave alone, and the status verb words the two
// differently. The option is what closes the window between that lstat and the
// open, which the lstat alone only narrows: where the platform has O_NOFOLLOW
// the refusal rides the open itself, so a link swapped in after the lstat is
// refused rather than followed, and where it does not the reader's own lstat is
// a second look at the name, taken later than this one. A swap landing inside
// that window now answers 'unreadable', which is the reading it is: what is at
// the path stopped being what the kind check saw.
//
// Three bounds, and none is another's. The walk is bounded BY INDEX at the
// cap, so a planted array of ten thousand invalid entries is not walked: a
// bound on how many valid entries are kept would let every invalid one be
// examined first, and the byte cap above would then be the only real limit. An
// entry older than HOLD_NUDGE_TTL_MS is dropped rather than returned, which
// is what makes an eviction at the cap safe: a reader of this list either finds
// a stamp that is genuinely holding a session quiet or finds nothing. And an
// entry dated further ahead of the reader's clock than CHECKPOINT_FUTURE_SKEW_MS
// is dropped on the other side of the same rule, the allowance being the one this
// file's other timestamp rules take.
//
// THE ALLOWANCE IS THE WRITER'S DOING rather than the reader's, since for a
// reader alone keeping a future stamp buys nothing: an age is a subtraction, so a
// future stamp's age is negative, and the nudge's own interval rule reads a
// negative elapsed as elapsed (intervalElapsed in compact-deferral-nudge.js) and
// fires anyway. recordHoldNudge rebuilds this whole file from what this returns
// and renames it into place, so an entry this reader drops is not passed over on
// the next write, it is ERASED, and every entry in this file belongs to another
// session, stamped by another process against its own clock. A step backwards on
// this box, an NTP correction or a resumed VM, therefore turns every peer's stamp
// future-dated at once, and the next write takes all of them out: each of those
// seats loses its throttle and is nudged again, over a skew of seconds. The
// allowance is what holds that ordinary case, and a stamp genuinely far ahead is
// still dropped, so a fabricated date cannot sit in one of the capped slots. An
// entry whose time cannot be parsed at all is dropped too, since a caller reads it
// as never-nudged anyway and a slot it occupies would push a live stamp out.
//
// Empty reads as "this session has not been spoken to", which fires. That is the
// same fail-open direction guard 8 of the nudge takes on an illegible nudgedAt,
// and it is self-healing for the same reason: the fire's own stamp is written
// through an atomic rename, so it replaces the illegible file wholesale and the
// interval takes hold from the next tool return onward. That direction belongs
// to the reading callers; the writer takes { ok: false } as a silence instead.
function readHoldNudgesResult(cwd, nowMs) {
    try {
        const target = holdNudgePath(cwd);
        // The one question the descriptor cannot answer, asked of the name and
        // of nothing else: is the final component a link? An open follows one,
        // so without this the read takes whatever the link names, where this
        // file's own writer refuses a link at that path outright, and a link
        // into a dead network mount would stall a hook that runs after every
        // covered tool return. The lstat does not traverse the final component,
        // so asking costs nothing on that path. The KIND and the SIZE stay the
        // descriptor's below: this narrows the name check to the one property an
        // open cannot reject, rather than handing the kind verdict back to the
        // name. An absent file is the one failure here that is an answer: it
        // carries nothing to preserve. Any other lstat failure, and a link, leave
        // the contents unknown.
        let st;
        try {
            st = fs.lstatSync(target);
        } catch (err) {
            if (err && err.code === 'ENOENT') return { ok: true, holds: [] };
            return { ok: false, holds: [], reason: 'lstat' };
        }
        if (st.isSymbolicLink()) return { ok: false, holds: [], reason: 'kind' };
        const read = readFileBounded(target, HOLD_NUDGE_MAX_BYTES, { refuseLink: true });
        // A refused open or read, and either kind of partial read, all leave what
        // the file holds unknown. The two partial readings are told apart because
        // the writer's two directions differ in cost: a file past the ceiling is
        // not this writer's output and is healed, while a read that ended short
        // may be its own file with every peer's stamp in it. Only the bound the
        // reader names as the ceiling takes the healing leg, so a bound it names
        // some other way, or does not name at all, is refused. An empty file is a
        // reading: there is nothing in it to keep.
        if (read === null) return { ok: false, holds: [], reason: 'unreadable' };
        if (read.bounded) {
            return { ok: false, holds: [],
                reason: read.boundedBy === 'ceiling' ? 'oversized' : 'short-fill' };
        }
        if (read.text === '') return { ok: true, holds: [] };
        let parsed;
        // JSON this cannot parse, and JSON carrying no holds array, are read
        // rather than unknown: neither is something this writer produced, so
        // neither holds a stamp to preserve, and the fire's own atomic rename
        // replaces the file wholesale.
        try { parsed = JSON.parse(read.text); } catch { return { ok: true, holds: [] }; }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.holds)) {
            return { ok: true, holds: [] };
        }
        const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
        const holds = [];
        const scanned = Math.min(parsed.holds.length, HOLD_NUDGE_MAX_ENTRIES);
        for (let i = 0; i < scanned; i += 1) {
            const entry = parsed.holds[i];
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const session = gateText(entry.session);
            const nudgedAt = gateText(entry.nudgedAt);
            if (!session || !nudgedAt) continue;
            const at = Date.parse(nudgedAt);
            if (!Number.isFinite(at) || now - at >= HOLD_NUDGE_TTL_MS
                || at - now > CHECKPOINT_FUTURE_SKEW_MS) continue;
            if (holds.some((kept) => sameSessionId(kept.session, session))) continue;
            holds.push({ session, nudgedAt });
        }
        return { ok: true, holds };
    } catch { return { ok: false, holds: [], reason: 'unreadable' }; }
}

// The stamps alone, for a caller whose two directions cost the same: an unknown
// reading answers the empty list here, exactly as an absent file does. Both fire,
// which is the fail-open direction the reader's header states and the one every
// read-only caller of this list takes.
function readHoldNudges(cwd, nowMs) {
    return readHoldNudgesResult(cwd, nowMs).holds;
}

// When the hold nudge last spoke to this session in this project, as the stored
// ISO string, or null when it has not, which is also the answer for a stamp the
// reader above has already aged out or found illegible. The caller still applies
// its own interval to the value it gets: this reader's own bound is what keeps
// the list short, and the nudge's is what decides whether it speaks, and the two
// agreeing is a pin rather than an assumption (HOLD_NUDGE_TTL_MS).
//
// nowMs is the caller's clock where it has one, so a hook that answers several
// questions of one moment does not age this list against a different one.
// The id is canonicalized through gateText before it is compared, which is what
// the WRITERS store: every session field in these files goes in through gateText,
// so an id carrying anything that rule strips is stored in one spelling and would
// be looked up in another, and the lookup would answer never-nudged for a session
// that has a live stamp. No id the harness issues today is changed by that pass,
// so this decides nothing at present; it is the same rule on both sides of the
// comparison rather than a rule on one side and a raw value on the other.
function holdNudgedAt(cwd, sessionId, nowMs) {
    const session = gateText(sessionId);
    if (typeof sessionId !== 'string' || sessionId === '' || !session) return null;
    for (const entry of readHoldNudges(cwd, nowMs)) {
        if (sameSessionId(entry.session, session)) return entry.nudgedAt;
    }
    return null;
}

// What is at the hold stamp path, told apart the way goalPathKind tells the goal
// state's apart and for the same reason: 'file', 'absent', 'other' (something
// that is not a regular file, a link at the final component included, since an
// lstat judges a link as a link) and 'unknown' (a kind that could not be read at
// all, or a path that can never resolve).
//
// regularFileSize answers null for the last two together, and here they are
// opposite answers. 'other' is a shape this file's writer cannot have produced,
// so removing it costs nothing and is the only thing that ever ends it, while
// 'unknown' is a permission, a lock or an indexer over what may be a real list
// of live stamps, which lifts on its own and must not be removed. The errno
// split is pathErrnoClass's, the rule every caller of this question in the kit
// answers to; only its 'absent' leg is an absence, and a 'determinate' one
// (a file standing where .kit/ belongs, a link cycle above the final component)
// is unknown here rather than removable, since no unlink of this path repairs
// any of them. Never throws.
function holdStampKind(target) {
    try {
        return fs.lstatSync(target).isFile() ? 'file' : 'other';
    } catch (err) {
        return pathErrnoClass(err && err.code) === 'absent' ? 'absent' : 'unknown';
    }
}

// Remove the hold stamp file, and say whether the path is clear afterwards.
//
// The one destructive act on this path, and it is scoped by construction: the
// argument is always holdNudgePath's answer for the project in hand, a single
// file this nudge alone writes, never a directory and never a walk. Every
// failure is silent and answers false, which the caller reads as a refusal to
// write: an unlink that cannot remove what is sitting there (a directory, a
// permission, a lock) leaves the path exactly as it found it, and the stamp is
// then skipped, which is the silence every failure on this path takes.
function unlinkHoldStamp(target) {
    try {
        fs.unlinkSync(target);
        return true;
    } catch (err) {
        return !!(err && err.code === 'ENOENT');
    }
}

// The two refusal reasons readHoldNudgesResult can give that this writer's own
// file cannot be behind: a file past the read ceiling (its own holds at most
// HOLD_NUDGE_MAX_ENTRIES short entries and cannot approach the cap) and a link
// at the final component (it writes a regular file through a temp-and-rename,
// which replaces the name rather than following what stands at it). Both are
// healed by removing the path.
//
// The other three keep refusing, and the third is the one worth naming, since it
// arrives through the same `bounded` flag as the first: 'unreadable' and 'lstat'
// may be a transient lock over a real list, and 'short-fill' is a read that ended
// short, which is a file truncated under the read or a device that stopped
// answering, and says nothing about whose file it is. Healing on that reading
// would unlink a file this writer may well have written, with every other held
// session's live stamp in it.
//
// Exported because it is read on BOTH sides of the same question. This file's
// writer heals the reasons in it, and the checkpoint CLI's status verb promises
// an operator that a refusing file is replaced by the next directive, which is
// true for exactly these reasons and false for the rest. Each side filtering on
// its own copy of the literals is how a reason added here would leave that
// promise withheld from a file the writer now heals, with both suites green;
// test/kit-compact-gate.test.js pins the correspondence.
const HOLD_NUDGE_HEALABLE = ['oversized', 'kind'];

// Stamp the hold nudge's clock for one session, and return whether the stamp is
// on disk. This is recordEpisodeNudge's counterpart for the hold that owns no
// episode, and the boolean carries the same contract for the same reason: the
// stamp is not diagnostic, it IS the rate limit and the only cross-process
// carrier the interval has, so the hook emits only when this returns true and
// every failure here is a silence.
//
// The .kit/ precondition is gateScratchTarget's rather than a second copy: the
// directory must already be there (or be one an armed goal licenses creating,
// per the section header) and be a real writable directory, so a held session
// standing in a stranger's checkout writes nothing into it. The gate STATE's own
// legs are deliberately not among the preconditions, even though the hold this
// stamp throttles was read out of that file: this writer never touches it, and
// taking its legs would let a read-only or locked compact-gate.json disable the
// interval for a session whose hold record read back perfectly, which is a
// refusal about a different file. The stamp's own path is then held to the same
// kind-and-writable test every other writer here applies to its target, with two
// differences this file alone takes, both following from the same heal: a kind
// that is not a regular file is removed rather than refused, and the writable
// test is asked AFTER the heal rather than before it, since an unlink needs
// permission on the directory and none on the file, so a path judged unwritable
// before the heal is one the heal makes writable.
//
// The write carries no compare-and-set, unlike the episode stamp, because there
// is nothing here for a concurrent writer to lose: the file is this nudge's
// alone, no gate path reads or writes it, and the whole cost of a lost entry is
// one extra nudge on the next tool return. What the read-modify-write does do is
// preserve the other sessions' stamps, which is why the entries kept are
// everything except this session's own. They are read as of this write's own
// clock, so the spent ones are already gone by the time the cap is applied and
// the truncation can only drop a stamp that was still throttling where more
// sessions than the cap are held inside one interval.
//
// That preservation is why the read is taken through readHoldNudgesResult rather
// than through the plain list. A rename rebuilt from an empty list is a rename
// that erases the file, so a reading that is empty because the file could not be
// read makes this write destroy exactly the stamps it exists to keep, collapsing
// every other held session's interval at once and re-nudging all of them. Such a
// reading refuses the write here instead: the hold goes unstamped, which is a
// silence, which is the direction every failure on this path takes.
//
// The refusal is split by whether the reading can END, because a refusal that
// cannot is not a silence but a disabled interval. Two of the five readings this
// file can give are ones this writer could not have produced, a file past the
// read ceiling and a link at the path, and nothing about either resolves with
// time: refusing them alone would silence this session's directive for the life
// of the file, with no age-out and no surface saying why. Those two are healed by
// removing the path before the write (HOLD_NUDGE_HEALABLE), which costs nothing,
// since a file this writer did not write holds no peer's stamp to preserve.
//
// The split is on WHOSE FILE IT IS rather than on how partial the reading was,
// which is what keeps the heal off the third permanent-looking leg. A read that
// ended short arrives through the same partial-read flag as the oversized one and
// means something else entirely: the file was truncated under the read or a
// device stopped answering, either of which can happen to this writer's own file
// on the tool return after it wrote it. Unlinking on that reading destroys
// exactly the peer stamps the read-modify-write exists to preserve, which is why
// it refuses with the other two, a read that was refused and an lstat that could
// not answer, the transient lock over a REAL list. The checkpoint CLI's status
// verb is what reports the file that is refusing, and it words the healing legs
// and the refusing ones apart because only the healing ones end by themselves.
//
// What the rebuild preserves is every entry the READER returned, which is not
// every entry the file held: the reader drops what it will not act on, and this
// write then erases it rather than passing over it. Two classes are dropped that
// way, an entry past HOLD_NUDGE_TTL_MS and one dated further ahead of the clock
// than CHECKPOINT_FUTURE_SKEW_MS, and it is that erasure rather than any property
// of the read that the forward allowance exists for: without it a clock stepping
// back by seconds would erase every peer's stamp in one write.
// readHoldNudgesResult's drop rule states the whole trade.
//
// The journal line follows the stamp, best-effort and outside its preconditions,
// on logEpisodeNudge's own terms: a locked or read-only .jsonl must never be
// able to disable an interval.
function recordHoldNudge(cwd, sessionId, nowMs, toolName) {
    let stampedAt = null;
    try {
        const session = gateText(sessionId);
        if (typeof sessionId !== 'string' || sessionId === '' || !session) return false;
        const at = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
        if (!gateScratchTarget(cwd).ok) return false;
        const target = holdNudgePath(cwd);
        // The kind leg, asked so the two halves of regularFileSize's null are
        // told apart: a shape this writer cannot have produced is removed, while
        // a kind that could not be read at all refuses.
        const kind = holdStampKind(target);
        if (kind === 'unknown') return false;
        if (kind === 'other' && !unlinkHoldStamp(target)) return false;
        const iso = new Date(at).toISOString();
        const prior = readHoldNudgesResult(cwd, at);
        // A reading that identifies the file as one this writer cannot have
        // produced is healed by removing the path; every other reading that left
        // the contents unknown refuses, since the rebuild below would erase peer
        // stamps that may really be there. A read that ended short is on the
        // refusing side for exactly that reason: it names no shape at all, only
        // an unfinished read. The 'kind' leg is still reachable here despite the
        // check above, through a swap landing between the two, and takes the
        // same heal.
        if (!prior.ok
            && !(HOLD_NUDGE_HEALABLE.includes(prior.reason) && unlinkHoldStamp(target))) return false;
        // The writability of the TARGET is judged here rather than above the
        // read, because the heal changes the answer. An unlink takes permission
        // on the containing directory (gateScratchTarget's leg above, which has
        // already passed) and none at all on the file, so a stamp file that is
        // both oversized and unwritable is one the heal removes and the write
        // then creates: asked before the heal, this leg would refuse it forever,
        // which is the permanent silence the healable set exists to prevent and
        // the replacement the status verb promises for that same file. Asked
        // here, it answers for the path the write is actually about to meet, and
        // its original subject is untouched: a legible, unwritable stamp file
        // reads back fine, takes no heal, and refuses exactly as before.
        if (!writableOrAbsent(target)) return false;
        const kept = prior.holds.filter((entry) => !sameSessionId(entry.session, session));
        const holds = [{ session, nudgedAt: iso }, ...kept].slice(0, HOLD_NUDGE_MAX_ENTRIES);
        if (!writeJsonAtomic(target, { holds })) return false;
        stampedAt = iso;
    } catch { /* an unstamped hold is a silent one: the caller emits nothing */ }
    if (stampedAt === null) return false;
    logEpisodeNudge(cwd, sessionId, stampedAt, toolName, 'nudge-hold');
    return true;
}

// Does this file end on a line boundary? True for an empty or absent file,
// which needs no separator. False when the answer cannot be established: a
// path whose kind or size could not be read (regularFileSize's null) gets the
// fail-safe answer rather than the go-ahead one, since a spare blank line in
// the journal costs nothing while a fused record parses as neither of the two
// records it ran together. Reads the final byte alone: the answer is one byte
// long and the file can be megabytes.
function endsOnLineBoundary(target) {
    const size = regularFileSize(target);
    if (size === null) return false;
    if (size === 0) return true;
    const fd = fs.openSync(target, 'r');
    try {
        const buf = Buffer.alloc(1);
        const read = fs.readSync(fd, buf, 0, 1, size - 1);
        return read !== 1 || buf[0] === 0x0A;
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed */ }
    }
}

// ---------------------------------------------------------------------------
// Release markers. Two session-scoped marker kinds beside the checkpoint give
// the gate its release paths for sessions the checkpoint cannot serve: the
// role-boundary marker, which a goalless session (a coordinator, expert or
// admin seat) opens at a banked-and-empty moment so the hands-on deferral can
// land the next offer there instead of riding to the safety ceiling; and the
// operator-consent marker, written only on the operator's explicit word,
// which releases one deferred compaction for the session it names on either
// deny leg. The boundary marker is one FILE per session, its session id a
// component of the file's own name, because a shared checkout carries several
// seats at once and each declaration is one seat's own word about one moment:
// two seats scoped only by a field inside a single file left the second
// declaration renaming over the first, and the unmade seat deferred at its next
// offer believing it had declared. The consent marker is one file per project,
// the operator writing one at a time. Both release SCHEDULING denials only, the verdicts that mean
// "not at this moment": no marker touches an allow clause, an integrity
// refusal, or the leashed checkpoint rule, and the no-marker case leaves
// every leg exactly as it was.
//
// The trust shape mirrors the checkpoint's. A session's own banked-and-empty
// declaration is the best boundary signal available, and the ceiling
// force-landing is already the worst case, so honoring a self-declared
// boundary can only move a compaction earlier onto a cleaner spot. The
// consent marker is asserted rather than authenticated (a single-principal
// machine); what bounds its writing is prose in the role skills, and what
// bounds its effect is here: one session, one release, one age window.
// ---------------------------------------------------------------------------

// Path to one session's role-boundary marker under a given repo root, or null
// where the session id is not one this file will compose a name from. The
// charset rule usableSessionId carries is the whole of what stands between an id
// and the scratch directory: a value carrying a separator, a parent segment or a
// leading dash resolves to nothing rather than to a path somewhere else, and
// every reader and writer here treats that null as "no marker" rather than
// falling back to an unscoped name.
//
// The id composes the name as it is given, where the match rule below compares
// ids case-insensitively, so on a case-sensitive filesystem two spellings of one
// id resolve two files while the rule reads them as one session. The cost of
// that seam is a marker the offer does not find, which is a deferral, the
// direction every leg of this gate fails in.
//
// A marker left at the name this file used while it was one file per project
// (compact-role-boundary.json) is resolved by nothing and read by nothing: it
// is inert. It is not migrated, a declaration's own life being bounded by the
// age bound and by the moment rule either way, and it needs no hand: the name
// carries the sweep's prefix and its .json tail, so sweepRoleBoundaryMarkers
// removes it once it passes the same age bound, exactly as it removes a session
// file nobody will read again.
function roleBoundaryPath(cwd, sessionId) {
    const id = usableSessionId(sessionId);
    if (id === null) return null;
    return path.join(kitScratchDir(cwd), 'compact-role-boundary.' + id + '.json');
}

// Path to the operator-consent marker for a given repo root.
function consentPath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-consent.json');
}

// A session id a caller may scope a marker to, or null. The gate is charset
// plus a leading-character rule, not charset alone: a value that opens with a
// dash reads as an option to any parser that meets it later, so the first
// character must be alphanumeric however clean the rest is. Session ids as
// the harness mints them are UUID-shaped and pass untouched; anything else
// degrades to the refusal at the call sites, never to an unscoped write. The
// rule also carries the path-safety property every caller that composes a name
// from an id depends on, since a passing value is a single path component: it
// holds no separator, is not a dots-only name, and is inside the storage cap
// the marker writer enforces. One definition serves the checkpoint CLI's marker
// verbs, the seat Stop hook's registry lookup, the transcript and registry
// entry paths below, and the role-boundary marker's own file name, so the value
// one of them refuses is not a value another joins onto a path.
function usableSessionId(value) {
    return (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
        ? value
        : null;
}

// Where the harness files a session's transcript for a project directory, or
// null where nothing resolves. The shape is <session-id>.jsonl under
// <projects root>/<flattened project path>, and both halves are memq's own,
// harnessProjectsRoot for the root and sanitizeProjectPath for the
// flattening, imported rather than restated so no spelling here can disagree
// with the store's. memq is required lazily because this is the only path
// here that needs it and the gate's own hot path must not pay for loading it.
// One derivation serves the corroboration below and the status report's
// reading of a declared moment.
function sessionTranscriptPath(projectDir, sessionId) {
    try {
        if (usableSessionId(sessionId) === null) return null;
        const { sanitizeProjectPath, harnessProjectsRoot } = require(path.join(__dirname, '..', 'scripts', 'memq.js'));
        return path.join(harnessProjectsRoot(),
            sanitizeProjectPath(path.resolve(projectDir)), sessionId + '.jsonl');
    } catch {
        return null;
    }
}

// Whether the harness holds a transcript for this session under this project
// directory, which is the corroboration a marker written at a directory the
// caller named rather than stood in has to pass. A marker landing in a
// project the named session never ran in is inert and silently so, and this
// turns that miss into a refusal.
//
// Anything unresolvable reads as no transcript: the caller's refusal is the
// conservative answer, and a marker not written costs one re-run at the right
// directory while one written at the wrong one costs a release nothing reads.
function projectHoldsSessionTranscript(projectDir, sessionId) {
    try {
        const full = sessionTranscriptPath(projectDir, sessionId);
        return full !== null && fs.statSync(full).isFile();
    } catch {
        return false;
    }
}

// How long each marker stays honorable. Both are the deferral episode's idle
// bound rather than numbers of their own, because all three answer one
// question: how long a moment's word still describes the same working
// session. A seat opens the boundary marker at a banked moment its runbook
// defines, and the invariant that moment carries is that context holds
// nothing the disk does not, so a compaction anywhere inside the window costs
// a re-read and never state; what the window has to cover is the seat's own
// quiet gap between banked moments, which is the same order as the idle bound
// and far longer than one tool call. The consent marker covers the same gap
// from the other side, an operator's release preceding the next offer by a
// while (the offer only recurs while the context sits past the trigger).
// Derived rather than restated so the three cannot drift; evidence that ever
// tunes one apart turns that one's derivation into its own literal.
const ROLE_BOUNDARY_MAX_AGE_MS = GATE_EPISODE_MAX_IDLE_MS;
const CONSENT_MAX_AGE_MS = GATE_EPISODE_MAX_IDLE_MS;

// The one marker match rule, shared by its two consumers (the gate's release
// legs and the CLI's status report) so they cannot drift, exactly as
// checkpointMatches is shared for the checkpoint. A marker counts only for
// the session it names, only while unconsumed, and only within the age bound
// the caller passes: the two marker kinds differ in nothing but that bound.
// Like checkpointMatches, this rule stays pure: it is told the subject
// session and the clock rather than reading any state.
//
// Returns { ok:true, reason:null } on a match, else { ok:false, reason } with
// reason naming the first failed clause in evaluation order:
//   'no-marker'      marker is missing, not an object, or carries no session
//                    string (a hand-made or torn file; the writer always
//                    records one)
//   'consumed'       consumed is anything but a literal false. An absent flag
//                    reads as consumed too: the writer always records false,
//                    so a record without it is not one of ours, and the
//                    conservative reading is the dead one.
//   'wrong-session'  the marker names a different session than the subject,
//                    or the subject itself is unusable (sameSessionId is
//                    false when either side is missing, which is exactly the
//                    treat-as-absent handling a payload without an id needs)
//   'no-timestamp'   writtenAt is missing or does not parse as a date
//   'expired'        writtenAt is older than maxAgeMs, or maxAgeMs itself is
//                    not a finite number: a caller that forgot the bound
//                    narrows the window to nothing rather than widening it
//   'future'         writtenAt is beyond the same skew allowance the
//                    checkpoint tolerates (one constant, one question)
// Never throws on JSON-derived input: every access is guarded and Date.parse
// returns NaN on garbage. nowMs pins the clock as it does elsewhere here.
function markerMatches(marker, sessionId, nowMs, maxAgeMs) {
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || typeof marker.session !== 'string') {
        return { ok: false, reason: 'no-marker' };
    }
    if (marker.consumed !== false) return { ok: false, reason: 'consumed' };
    if (!sameSessionId(marker.session, sessionId)) return { ok: false, reason: 'wrong-session' };
    if (typeof marker.writtenAt !== 'string') return { ok: false, reason: 'no-timestamp' };
    const written = Date.parse(marker.writtenAt);
    if (!Number.isFinite(written)) return { ok: false, reason: 'no-timestamp' };
    if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs)) {
        return { ok: false, reason: 'expired' };
    }
    const age = now - written;
    if (age > maxAgeMs) return { ok: false, reason: 'expired' };
    if (age < -CHECKPOINT_FUTURE_SKEW_MS) return { ok: false, reason: 'future' };
    return { ok: true, reason: null };
}

// Read and parse a marker file, mirroring readCheckpointResult leg for leg
// and for the same reasons: the gate reads these on its deny paths before any
// verdict is emitted, so the path must be a regular file of sane size before
// it is opened (a FIFO planted here would block forever inside readFileSync,
// where no try/catch can rescue it, and being an lstat the check judges a
// link as a link rather than as its target), and the status report needs the
// refusal legs told apart because they name different remedies and cannot be
// recovered by re-asking with a second syscall. The checkpoint's own read cap
// applies: the writer produces three short fields and never grows. The
// outcome vocabulary is readCheckpointResult's, with `marker` in place of
// `cp`.
function readMarkerResult(target) {
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, marker: null, reason: 'absent' };
        return { ok: false, marker: null, reason: 'lstat' };
    }
    if (!st.isFile()) return { ok: false, marker: null, reason: 'kind' };
    if (st.size > CHECKPOINT_MAX_BYTES) return { ok: false, marker: null, reason: 'oversized' };
    let raw;
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, marker: null, reason: 'absent' };
        return { ok: false, marker: null, reason: 'unreadable' };
    }
    try {
        return { ok: true, marker: JSON.parse(raw), reason: null };
    } catch {
        return { ok: true, marker: null, reason: 'illegible' };
    }
}

// One session's marker, read at its own file. A session id the resolver
// refuses gets its own outcome rather than the absent one: the two facts are
// different, an id nothing can compose a path from being a caller's problem
// where an absent file is an ordinary state, and a reader that answered
// 'absent' for both would hand every caller one value for two questions.
function readRoleBoundaryResult(cwd, sessionId) {
    const target = roleBoundaryPath(cwd, sessionId);
    if (target === null) return { ok: false, marker: null, reason: 'no-session' };
    return readMarkerResult(target);
}

// The name shape both the listing and the sweep below judge an entry by, spelled
// once: the prefix the writer composes and the .json tail, on a regular file. The
// legacy single name (compact-role-boundary.json) carries both, deliberately, so
// the sweep collects one; the listing narrows further, below, to the names a
// session id actually composes.
const ROLE_BOUNDARY_PREFIX = 'compact-role-boundary.';

function isRoleBoundaryEntry(entry) {
    return entry.isFile() && entry.name.startsWith(ROLE_BOUNDARY_PREFIX)
        && entry.name.endsWith('.json');
}

// How many marker names one listing or one sweep will consider. A shared
// checkout carries seats in the low tens and each holds one file, so this is far
// above the population and exists to bound the cost of a directory somebody has
// filled rather than to describe it. The listing says so with its `bounded` flag
// rather than reporting a truncated set as the whole picture.
const ROLE_BOUNDARY_MAX_NAMES = 512;

// Which sessions hold a marker file in this project, for the status report,
// which answers "what is open here" rather than "what is open for me" and so
// has no one session to ask about. Returns { ok:true, sessions, bounded } with
// the ids in the order the directory listed them and `bounded` true where the
// listing was cut short, or { ok:false, sessions:[], bounded:true, reason } where
// the directory could not be listed, since an empty list and an unread directory
// are different facts and the caller says different things about them. An absent
// scratch directory is the empty list: nothing has ever been written there, which
// is a genuine none-open.
//
// Every id comes back through the same resolver the writers compose with, so a
// file name that is not one this library could have produced is not reported as
// a session. This and the sweep below answer about the DIRECTORY rather than
// composing a path in it, so neither is of the scratch-resolver class the suite
// sweeps and the suite names both as consumers of it; the directory they read is
// kitScratchDir's own answer, which is where that sweep's property comes from.
//
// The failure is classified by pathErrnoClass rather than reported as one
// condition, the split clearMarkerFile takes: something that is not a directory
// parked at the scratch path is a state that will never resolve on its own, and
// a caller told to wait it out would wait forever.
function roleBoundarySessionsResult(cwd) {
    const dir = kitScratchDir(cwd);
    const listing = listBoundedNames(dir, ROLE_BOUNDARY_MAX_NAMES, isRoleBoundaryEntry);
    if (listing.bounded && listing.names.length === 0) {
        const refusal = roleBoundaryListFailure(dir);
        if (refusal !== null) return { ok: false, sessions: [], bounded: true, reason: refusal };
    }
    const sessions = [];
    for (const name of listing.names) {
        const id = name.slice(ROLE_BOUNDARY_PREFIX.length, name.length - '.json'.length);
        const resolved = roleBoundaryPath(cwd, id);
        if (resolved === null || path.basename(resolved) !== name) continue;
        sessions.push(id);
    }
    return { ok: true, sessions, bounded: listing.bounded };
}

// Why the listing above came back with no names and the shared lister's bounded
// flag set, which is two different facts: the directory refused to be listed at
// all, or it answered and the read was cut short before a marker was reached.
// The shared lister reports what it read rather than why it stopped, so the
// question is asked again here, on the failing path only, by opening the
// directory: 'determinate' where the path can never be listed as it stands
// (something that is not a directory, or a link chain that will not resolve),
// 'transient' where the condition is one that can lift, and null where the
// directory itself answers, leaving a cut listing rather than a refused one.
//
// The classes are pathErrnoClass's, the same split clearMarkerFile takes, so an
// operator is never told to wait out a state that will never resolve. A
// directory that has gone away since the listing reads as null: nothing is there
// to be open.
function roleBoundaryListFailure(dir) {
    let handle = null;
    try {
        handle = fs.opendirSync(dir);
    } catch (err) {
        const cls = pathErrnoClass(err && err.code);
        if (cls === 'absent') return null;
        return cls === 'determinate' ? 'determinate' : 'transient';
    } finally {
        if (handle !== null) {
            try { handle.closeSync(); } catch { /* already closed */ }
        }
    }
    return null;
}

// Remove every marker file in this project older than the age bound, which is
// the age past which markerMatches refuses one anyway: what the sweep collects
// is a file no reader will ever honor again. One file per session and no writer
// that renames over a peer's is what makes this necessary, since a session that
// declares and then ends leaves a file nothing else will ever replace, and the
// directory would otherwise grow by one file per session forever.
//
// Age is the file's own mtime rather than its recorded writtenAt: the writer
// creates the file at the instant it records, an unparseable or hand-edited
// record still ages out, and no file has to be opened to judge one. The listing
// is bounded and the cap named, so a directory somebody has filled cannot turn a
// turn end into a walk of it. Best-effort throughout: a file that raced away or
// is not ours to remove is left, since nothing here is a precondition for the
// write that drives it.
function sweepRoleBoundaryMarkers(cwd) {
    const dir = kitScratchDir(cwd);
    const cutoff = Date.now() - ROLE_BOUNDARY_MAX_AGE_MS;
    const listing = listBoundedNames(dir, ROLE_BOUNDARY_MAX_NAMES, isRoleBoundaryEntry);
    let removed = 0;
    for (const name of listing.names) {
        const full = path.join(dir, name);
        try {
            const st = fs.lstatSync(full);
            if (!st.isFile() || st.mtimeMs > cutoff) continue;
            fs.unlinkSync(full);
            removed += 1;
        } catch { /* raced away, or not ours to remove */ }
    }
    return { removed, bounded: listing.bounded };
}

function readConsentResult(cwd) {
    return readMarkerResult(consentPath(cwd));
}

// The swallowing forms the gate takes, because every refusal leg means the
// same thing to it: no marker releases anything. Same split as readCheckpoint
// over readCheckpointResult.
function readRoleBoundary(cwd, sessionId) {
    try {
        return readRoleBoundaryResult(cwd, sessionId).marker;
    } catch {
        return null;
    }
}

function readConsent(cwd) {
    try {
        return readConsentResult(cwd).marker;
    } catch {
        return null;
    }
}

// Write a marker atomically, on writeCheckpoint's discipline via
// writeJsonAtomic (exclusive create, atomic rename, failure cleanup gated on
// the create having returned). Returns { ok:true, session } or
// { ok:false, reason }; never throws.
//
// The session id is held to bindSession's own storage rules, the same bound
// writeCheckpoint holds boundSession to (a string, capped length, no control
// characters); the CLI additionally charset-gates what it accepts before this
// is reached, so this guard is the floor, not the whole gate. There is no
// unscoped form: a marker without a session would release whichever session's
// offer arrived first, which is the one shape the design forbids, so a caller
// with no usable id gets a refusal rather than a wildcard. consumed is
// written as a literal false, the only value the match rule reads as live.
// Unlike the gate's own record targets, the directory is created here: the
// CLI's marker modes are the .kit/ writers that must work with no goal ever
// armed, boundary and consent alike, exactly as writeCheckpoint creates it
// for the leashed mode.
//
// `declared` records provenance, and it is the field the moment rule below is
// scoped by: true only for the boundary verb's deliberate declaration, absent
// for every other writer, so a marker's own record says which rule governs it
// rather than a call site restating the distinction. `position` rides with it,
// where the transcript could be measured: the byte offset the declared moment
// sits at and a fingerprint of what preceded it, which is what the moment rule
// reads forward from. Both fields are machine written here and nowhere else;
// no prose ever asks anyone to produce either.
//
// The pair is written together or not at all. A declaration whose transcript
// could not be measured records no position and the moment rule lapses it,
// which is the conservative end: a marker that cannot be vouched for buys a
// deferral, where one honored on an unread transcript buys a compaction in the
// middle of a turn.
function writeMarkerFile(target, sessionId, declared, position) {
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > 128
        || /[\x00-\x1F]/.test(sessionId)) {
        return { ok: false, reason: 'session id is invalid' };
    }
    const state = {
        session: sessionId,
        writtenAt: new Date().toISOString(),
        consumed: false
    };
    // Written only on the declaring path, so the file the seat-stop hook
    // produces is byte-identical to the one it produced before these fields
    // existed and reads as the window-scoped marker it has always been.
    if (declared === true) {
        state.declared = true;
        if (position !== null && position !== undefined) {
            state.transcriptBytes = position.bytes;
            state.transcriptAnchor = position.anchor;
        }
    }
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        writeJsonAtomic(target, state);
    } catch (err) {
        return { ok: false, reason: 'could not write marker: ' + (err && err.message ? err.message : String(err)) };
    }
    return { ok: true, session: sessionId, positioned: declared !== true || (position !== null && position !== undefined) };
}

// The declaring path measures the marked session's own transcript as it writes,
// which is the file the gate later reads forward from: the position is taken
// here rather than by the caller so no call site can declare a moment without
// recording where it fell. `positioned` in the result says whether one was
// taken, for a caller that reports a declaration nothing will be able to vouch
// for.
//
// The file is this session's own, so an id the resolver will not compose a name
// from is refused here in the writer's own vocabulary: there is no unscoped
// name left to fall back to, which is the property the per-session file buys.
//
// This is also where the marker directory is collected. Every write here is one
// seat saying something about its own file and none replaces a peer's, so the
// aged-out files a set of seats leaves behind have no other writer to retire
// them; the sweep runs after the write, on the two events that reach this
// function (a seat's turn end and a boundary declaration), which is the same
// cadence the single shared file was replaced at. It runs after rather than
// before so a failed sweep cannot cost the declaration, and its result is not
// read: nothing about this write turns on what was collected.
function writeRoleBoundary(cwd, sessionId, declared) {
    const target = roleBoundaryPath(cwd, sessionId);
    if (target === null) return { ok: false, reason: 'session id is invalid' };
    const position = declared === true
        ? transcriptPosition(sessionTranscriptPath(cwd, sessionId))
        : null;
    const result = writeMarkerFile(target, sessionId, declared, position);
    if (result.ok) sweepRoleBoundaryMarkers(cwd);
    return result;
}

function writeConsent(cwd, sessionId) {
    return writeMarkerFile(consentPath(cwd), sessionId);
}

// Delete a marker file if present, on clearCheckpoint's exact rule: presence
// judged by the lstat kind check rather than existsSync (a link at the path
// reads as no marker to every reader here, so a clear that followed it would
// report consuming something nothing read as open), a failed lstat routed by
// pathErrnoClass, and a racing ENOENT reported as none-open rather than as a
// failure. Returns clearCheckpoint's own shape. The gate calls these to
// consume a marker on the allow it caused, best-effort: a failed delete
// degrades to the gate standing open, never to a wedged session. The risk
// that choice takes is the checkpoint's own, deliberately: a consume that
// fails to delete releases again on every later offer inside the marker's
// age bound, with no cap here on the count, which costs an extra compaction
// at a declared boundary (or under a standing consent), while the opposite
// choice, refusing the allow when the delete fails, would convert a locked
// file into a session riding to the ceiling,
// the exact failure the release paths exist to end.
function clearMarkerFile(target) {
    try {
        let st;
        try {
            st = fs.lstatSync(target);
        } catch (err) {
            if (pathErrnoClass(err && err.code) !== 'transient') {
                return { ok: true, cleared: false };
            }
            throw err;
        }
        if (!st.isFile()) {
            return { ok: true, cleared: false };
        }
        fs.unlinkSync(target);
        return { ok: true, cleared: true };
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return { ok: true, cleared: false };
        }
        return {
            ok: false,
            cleared: false,
            reason: 'could not clear marker: ' + (err && err.message ? err.message : String(err))
        };
    }
}

// A session's own marker, removed at its own file. An id the resolver refuses
// names no file to remove, and that is a refusal rather than a clear that found
// nothing: the caller reports the second as a successful retraction, which is
// not what happened.
function clearRoleBoundary(cwd, sessionId) {
    const target = roleBoundaryPath(cwd, sessionId);
    if (target === null) {
        return { ok: false, cleared: false, reason: 'could not clear marker: no usable session id to scope it by' };
    }
    return clearMarkerFile(target);
}

function clearConsent(cwd) {
    return clearMarkerFile(consentPath(cwd));
}

// ---------------------------------------------------------------------------
// The declared moment. The boundary verb's marker says the seat's context held
// nothing the disk did not at the instant it was written. That is a statement
// about a moment rather than a window: the instant a new turn begins in the
// marked session, the session is working again and the declaration no longer
// describes it, so the gate honors such a marker only while nothing has
// arrived in that session's transcript since the write.
//
// The rule is scoped by provenance, and the scoping is the whole of what keeps
// it from refusing every marker in existence. Its subject is a declaration,
// which is the marker the boundary verb writes and stamps `declared`. The
// seat-stop hook's turn-end bank carries no such field and is outside this
// rule entirely, on its age bound alone: that marker is written at a turn END,
// while a compaction offer only ever arrives inside a LATER turn, which by
// construction began with a newer inbound line, so a moment test over the hook
// path would lapse every marker it ever wrote. An undeclared marker is
// therefore answered here without the transcript being opened at all.
//
// The evidence is the transcript's inbound lines, which are two shapes rather
// than one. A `user` line is a tool result whenever its message content is an
// array carrying a tool_result block, and those are the overwhelming majority
// of user lines in a working session, the boundary command's own result among
// them: a rule reading the last user line alone would mark every marker stale
// the moment it was written. A genuine inbound message is a `user` line that
// is not a tool result, whose content is a string or an array of text blocks;
// a queued peer message additionally arrives as a `queue-operation` line,
// which is not a `user` line at all and is the exact arrival this rule exists
// to catch.
//
// Harness-injected lines are not arrivals and are excluded on the same three
// flags userCommandArgsClaimPlan excludes them on: a meta record (a skill body,
// a hook's own output replayed back, the session-start surfacing), a
// compaction summary, and a sidechain turn. Without that exclusion a seat that
// declares a boundary and then loads a skill lapses its own declaration, which
// is the harness talking to the model rather than anyone arriving.
//
// What settles "since the write" is POSITION rather than time. A transcript's
// lines are appended in order, so everything past a byte offset was written
// after everything before it; their timestamps are not in that order, and a
// line later in a real transcript routinely carries a stamp minutes older than
// the line before it. So the declaration records where the transcript ended at
// the instant it was made, and this rule reads forward from there. A rule that
// instead inferred the read's coverage from timestamps would honor a marker
// whose arrival sat outside the window it inspected, which is a compaction
// landing mid-turn: the one direction this rule exists to refuse.
//
// Every unanswerable question is stale rather than fresh, so this leg fails
// toward deferral the way the gate's other legs do: a declared marker carrying
// no recorded position, an absent or unreadable transcript, a transcript that
// no longer matches the recorded position, an appended stretch past the read
// bound, and a line in that stretch that will not parse.
// ---------------------------------------------------------------------------

// How much of the appended stretch the moment rule reads. What the cap has to
// cover is not the transcript, which on a held seat runs to tens of megabytes,
// but what was appended since the declaration, which is seconds to tens of
// seconds of one session (an offer recurs every half minute or so while a
// compaction is being held). An arrival inside the cap is answered from what
// was read; a stretch running past it with no arrival inside is answered as
// unknown and lapses, rather than being read as an absence of arrivals.
const MOMENT_APPEND_MAX_BYTES = 512 * 1024;

// How much of the transcript before the recorded position is fingerprinted, so
// a file replaced or rotated under the same path is not read as the one the
// declaration measured. A few kilobytes are several whole records of a shape
// nothing else produces; the offset alone would be satisfied by any file that
// happens to be long enough.
const MOMENT_ANCHOR_MAX_BYTES = 4 * 1024;

// A hex digest of `text`, short enough to sit in a marker file and long enough
// that two different transcripts do not collide on it.
function momentAnchorDigest(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32);
}

// Where a transcript ends right now, as the position a declaration records:
// { bytes, anchor }, or null where nothing can be measured (no path, not a
// readable regular file, or a file whose last line boundary cannot be found).
//
// The position is the end of the last COMPLETE line rather than the file's own
// end, which is what makes reading forward from it parse whole records: a
// record caught mid-append at the declaration is left on the far side of the
// offset, so it is judged when it is whole rather than as a fragment. That is
// also the conservative side, since a record being appended at the instant of
// the declaration is judged as an arrival if it turns out to be one.
function transcriptPosition(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return null;
        if (st.size === 0) return { bytes: 0, anchor: momentAnchorDigest('') };
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const window = Math.min(st.size, MOMENT_ANCHOR_MAX_BYTES);
            const tail = readFully(fd, st.size - window, window);
            const lastBreak = tail.lastIndexOf('\n');
            // No line boundary inside the window: where the window is the whole
            // file the transcript holds no complete line yet, and where it is
            // not, the last record is longer than the window and its start
            // cannot be found from here. Neither can be positioned.
            if (lastBreak === -1) return null;
            // Measured back from the file's end rather than forward from the
            // window's start: the window starts at an arbitrary byte, so its
            // decoded head can open on a replacement character whose length is
            // not the length of the bytes it stands for, while the fragment
            // after the last newline runs to the end of the file.
            const bytes = st.size - Buffer.byteLength(tail.slice(lastBreak + 1), 'utf8');
            const anchorFrom = Math.max(0, bytes - MOMENT_ANCHOR_MAX_BYTES);
            return {
                bytes,
                anchor: momentAnchorDigest(readFully(fd, anchorFrom, bytes - anchorFrom))
            };
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return null;
    }
}

// What the transcript has gained since a recorded position, as
// { text, bounded } for a readable stretch, or { reason } naming why it cannot
// be read:
//
//   'unreadable'  the path is absent, is not a regular file, or the read failed
//   'replaced'    the file is shorter than the recorded position, or the bytes
//                 before that position no longer hash to the recorded anchor:
//                 a truncated, rotated or different file, whose arrivals since
//                 the declaration are unknowable
//
// `bounded` says the stretch runs past the read bound, so an absence of
// arrivals inside the text is not an absence of arrivals: the caller answers a
// found arrival from what it read and answers a bounded read with no arrival in
// it as unknown. The read starts at the recorded position rather than at the
// file's end, so an arrival that landed first is inside the bound however much
// followed it.
//
// The isFile check is the same narrowing readTranscriptCapped applies and for
// the same reason (a FIFO planted here would block inside the read, where no
// try/catch can rescue it).
function readMomentAppend(transcriptPath, from, anchor) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return { reason: 'unreadable' };
        if (st.size < from) return { reason: 'replaced' };
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const anchorFrom = Math.max(0, from - MOMENT_ANCHOR_MAX_BYTES);
            if (momentAnchorDigest(readFully(fd, anchorFrom, from - anchorFrom)) !== anchor) {
                return { reason: 'replaced' };
            }
            const grown = st.size - from;
            const take = Math.min(grown, MOMENT_APPEND_MAX_BYTES);
            return { text: readFully(fd, from, take), bounded: grown > take };
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return { reason: 'unreadable' };
    }
}

// Whether a parsed transcript entry is an inbound message, by the two shapes
// the section header states. A `user` line whose content array carries a
// tool_result block is the harness reporting a tool call back to the model,
// which is not a new turn arriving; nor is anything the harness injects, which
// is the isSidechain / isMeta / isCompactSummary triple userCommandArgsClaimPlan
// screens on, read here on the same three flags and in the same order so the
// two readers of this transcript cannot disagree about what the harness wrote
// to itself.
function entryIsInbound(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.isSidechain || entry.isMeta === true || entry.isCompactSummary === true) return false;
    if (entry.type === 'queue-operation') return true;
    if (entry.type !== 'user') return false;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) return true;
    return !content.some(block => block && typeof block === 'object' && block.type === 'tool_result');
}

// Whether a marker is the boundary verb's declaration, which is the only kind
// the moment rule governs. The provenance decision lives here alone: a call
// site asking whether the moment holds gets the scoping with it, so no reader
// can apply the rule to the seat-stop hook's turn-end bank by forgetting a
// condition.
function markerDeclaresMoment(marker) {
    return !!marker && typeof marker === 'object' && marker.declared === true;
}

// The transcript position a declaration recorded, or null where it carries
// none that can be used. A declared marker without one cannot be positioned
// and so cannot be vouched for, which its caller reads as lapsed: the writer
// records the pair or records neither, so a marker missing it was written by
// something other than this file's writer, or written where no transcript
// could be measured.
function markerMomentPosition(marker) {
    if (!markerDeclaresMoment(marker)) return null;
    const bytes = marker.transcriptBytes;
    const anchor = marker.transcriptAnchor;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return null;
    if (typeof anchor !== 'string' || anchor === '') return null;
    return { bytes, anchor };
}

// Whether the marker still describes the moment it was written in, given the
// marked session's transcript. Returns { ok:true, reason:null } while it does,
// which is also the answer for every marker that declares no moment, else
// { ok:false, reason } naming the clause that refused it:
//   'no-position'  the declaration records no usable transcript position, so
//                  there is nowhere to read from and nothing can be vouched
//   'unreadable'   the transcript is absent, not a regular file, or the read
//                  failed
//   'replaced'     the transcript is shorter than the recorded position, or
//                  what sits before that position no longer matches what was
//                  there: a truncated, rotated or different file
//   'too-long'     nothing arrived inside the stretch the read covers, and
//                  more was appended past it, so the rest is unknown
//   'torn'         a whole line of the appended stretch will not parse, so
//                  what it was cannot be answered
//   'inbound'      a message arrived after the marker was written
//
// An arrival found inside the bounded read is an arrival whatever sits past
// the bound, so 'inbound' is answered before 'too-long' rather than after it.
//
// Only the LAST line of the stretch may be a fragment and only it is passed
// over: the gate runs while the session is live, so the record at the end of
// the file is routinely one caught mid-append, and a bounded read ends on a
// fragment by construction. That is also exactly where an arrival lands, so an
// unparseable line anywhere before it is answered as unknown rather than
// skipped.
//
// No timestamp is read here at all. Position is what orders a transcript's
// lines; their stamps are not ordered, so a rule resting on them can be shown
// an arrival it reads as predating the write.
function markerMomentHolds(marker, transcriptPath) {
    if (!markerDeclaresMoment(marker)) return { ok: true, reason: null };
    const position = markerMomentPosition(marker);
    if (position === null) return { ok: false, reason: 'no-position' };
    const appended = readMomentAppend(transcriptPath, position.bytes, position.anchor);
    if (appended.reason !== undefined) return { ok: false, reason: appended.reason };
    const lines = appended.text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '') continue;
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            if (i === lines.length - 1) continue;
            return { ok: false, reason: 'torn' };
        }
        if (entryIsInbound(entry)) return { ok: false, reason: 'inbound' };
    }
    if (appended.bounded) return { ok: false, reason: 'too-long' };
    return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// The registry record of a declared boundary.
// ---------------------------------------------------------------------------

// The store's coordinator directory, holding one directory per machine. Every
// path into that directory is composed from this, so the location has one
// spelling however many callers reach for it: the stamps here, the seat-stop
// hook's heartbeat, and the stamp audit's default scope and containment screen.
function coordinatorRoot() {
    return path.join(os.homedir(), '.claude', 'coordinator');
}

// This machine's own directory under that root.
function coordinatorDir() {
    return path.join(coordinatorRoot(), os.hostname());
}

// A registered session's entry under the machine's coordinator directory, or
// null. The id is held to the shared marker-scope rule before it is joined to
// anything, so a value carrying a separator or a parent segment never composes
// a path here at all.
function registryEntryPath(sessionId) {
    if (usableSessionId(sessionId) === null) return null;
    return path.join(coordinatorDir(), 'registry', sessionId + '.md');
}

// The value of a `<Field>: <value>` line, or null where the text carries no
// such line. The shape is the role skill's directory contract's, and one
// spelling serves every reader of these files: the seat-stop hook's freshness
// reads and the stamp audit's, which would otherwise be two copies of one
// grammar pinned only by their own tests.
function registryField(text, name) {
    const match = new RegExp('^' + name + ':[^\\S\\r\\n]*(.*)$', 'm').exec(text);
    return match === null ? null : match[1].trim();
}

// The renderer for a channel a model reads, in one place. Every writer into
// such a channel goes through it rather than spelling the elision again: the
// guard belongs to the channel rather than to whichever caller first needed it,
// and two spellings of it drift, with the one a caller reaches for then decided
// by which file it happens to sit beside.
//
// Four exported parts. sanitizeForOutput renders one repo-controlled value;
// displayPath renders a value already known to be a path; scrub takes the home
// directory out of a whole composed line, which is what a caller's own emitter
// hands it; and homeElisionsKnown answers whether a home directory is knowable
// at all, which is the reading a caller states out loud when its floor is off.

// The length a repo-controlled string is printed within absent a caller's own
// cap. One number, so the value and the mark that says it was shortened cannot
// be decided against two.
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
// Four steps in one order, and the order is what both marks rest on. The
// channel's home elision runs first, over the text as given, which is where a
// spelling standing whole in the argument is taken out under the full boundary
// rule. The strip runs next, so the cut is decided on what is actually EMITTED
// rather than on the string before sanitizing: a value carried past the cap only
// by characters the strip removes is not cut at all, and marking it as cut would
// name a truncation that did not happen. The elision runs again over the stripped
// text, for two reasons that are not cosmetic. A value carried past the cap only
// by a home prefix the channel takes out is not cut either, and eliding after the
// cap is eliding a home spelling the cut may have taken in half, which no pattern
// built from the whole spelling can match, so the account name would reach the
// channel in a fragment on exactly the machines whose home directory is long. And
// the strip DELETES what it removes, so a non-printable character inside a home
// spelling breaks it for the first pass and the deletion puts it back together
// for the second.
//
// That second pass runs through scrubAfterStrip, which drops the leading boundary
// wherever the strip removed anything. The boundary is what keeps a neighbouring
// directory its own name, and a deleted character can glue a home spelling onto
// the word in front of it, which the boundary then refuses: two stripped
// characters, one before a spelling and one inside it, would otherwise carry the
// account name past both passes. Dropping the boundary on stripped text costs an
// over-elision there, a path nowhere on disk, which is the cheap direction; text
// the strip left alone keeps the boundary and so keeps a foreign home path such
// as /mnt/backup/home/<name>/repo its own name.
//
// The cap runs last, over the text the reader will see, and the marks are
// appended after it so a mark is never itself cut. The strip's mark is read
// against the text the strip was handed rather than against the argument, since
// the elision ahead of it shortens a value too and says so for itself.
function printableAscii(s) {
    return String(s).replace(/[^\x20-\x7E]/g, '');
}

function sanitizeForOutput(s, max) {
    const given = scrub(String(s));
    const stripped = printableAscii(given);
    // The strip only ever deletes, so a length change is the whole of whether it
    // removed anything, and it decides both the mark and the second pass's rule.
    const removed = stripped.length !== given.length;
    const elided = scrubAfterStrip(stripped, removed);
    const shown = elided.slice(0, max === undefined ? PRINT_CAP : max);
    const marks = [];
    if (removed) marks.push('characters removed');
    if (shown.length < elided.length) marks.push('cut to fit');
    return shown + (marks.length === 0 ? '' : ' [' + marks.join('; ') + ']');
}

// A filesystem path for the operator's eye. The home prefix is elided to `~`,
// because the OS account name is in it and this output is read by a model.
// Eliding is what keeps a realistic path inside the cap, so the cut mark
// sanitizeForOutput appends is the rare case rather than the ordinary one.
//
// This is the renderer for a value KNOWN to be a path, and it runs beside the
// channel's own floor rather than instead of it: sanitizeForOutput elides every
// value it is handed and a caller's emitter scrubs whatever text was composed,
// path or sentence, and a value elided here passes through both unchanged. The
// two are aimed at different problems. The containment test here is
// boundary-aware and answers on components, so it reaches a spelling the text of
// the home directory does not appear in at all (a path routed through `..`, or
// one differing only in letter case on win32); the elision scrub applies is
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
// case-insensitive on win32, which is both directions at once; kitScratchDir
// above decides the same question the same way. A relative result that is
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
    // The marks sanitizeForOutput appends are what say the name on the line is
    // not the name on disk, in both directions: a cut tail and a stripped middle.
    return sanitizeForOutput(shown);
}

// The home directory in the spellings a model-read channel's output can carry
// it in, as the patterns that channel elides it by, beside an explicit reading
// of whether a home directory is knowable at all.
//
// The two are separated because one empty list would otherwise answer both, and
// they are opposite news for a channel whose floor is this elision. Nothing to
// elide is the floor standing. No knowable home directory is the floor OFF, and
// os.homedir() can throw and follows USERPROFILE and HOME, so a stripped
// environment turns the whole guard off silently: homeElisionsKnown below is
// what lets a caller state that case out loud rather than passing values
// through unmarked.
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
// a comma alike; sanitizeForOutput's own marks ride on that, since it appends them as
// ` [cut to fit]` and a home directory at the end of a marked value is followed
// by a space and then a bracket.
//
// The leading edge refuses the same characters and NOT a separator. Without a
// leading edge at all the match floats: POSIX home /home/admin turns
// /mnt/backup/home/admin/repo/.kit/x.json into /mnt/backup~/repo/.kit/x.json,
// and win32 is not immune by design, only by its home spelling starting with a
// drive letter. Refusing an alphanumeric in front is what kills that case, the
// candidate /home/admin there being preceded by the p of backup. A separator in
// front is admitted, because the spellings that carry one introduce the SAME
// directory rather than another name: a win32 long-path prefix (\\?\C:\Users\a),
// a file URL (file:///C:/Users/a) and a doubled separator (//C:/Users/a) all
// name the home directory, and refusing them prints the account name into the
// channel, the expensive direction. What admitting it costs is a
// doubled-separator spelling of some other path eliding to a path nowhere on
// disk, the cheap one, which is the direction every edge here fails in.
//
// Each literal spelling is compiled twice more, once with both of those edges
// and once with neither, which is the pair scrub and scrubAfterStrip read. The
// second table exists because the strip that runs between the two elision passes
// deletes rather than replaces: a character taken out from beside a home
// spelling glues it onto whatever text stood on that side, and an edge that
// refuses an alphanumeric then refuses the site. Neither edge survives that,
// because a deletion after a spelling glues the following word onto it exactly
// as one before it glues the preceding word on: a spelling carrying a stripped
// character inside it, which is what hides it from the first pass, followed by
// one more stripped character and then a word, reassembles into a whole home
// spelling with a name character behind it and would print the account name in
// full. On text a strip has already altered, both edges have lost their premise,
// so the relaxed table matches a spelling wherever it sits and accepts the
// over-elision that comes with it.
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
// sanitizeForOutput strips before it elides, so on a home directory carrying an
// accented or CJK character the raw spelling is one no emitted line can ever
// contain, and C:\Users\Jose with an accent on the e reaches the channel as
// C:\Users\Jos. Building the same patterns from printableAscii(home) covers the
// text as it will actually be emitted. On an all-ASCII home the two are
// identical and the duplicates are dropped. What that costs is a real sibling
// directory spelled like the stripped home being elided too, which is the
// flattened spelling's own trade taken for the same reason: where the strip has
// made two names indistinguishable, eliding keeps the account name off the
// channel.
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
// The literal's separators match a RUN of either slash, since a path can arrive
// in either spelling and a doubled separator names the same directory it would
// name single (C:\\Users\\name and /home//name are both the home directory), so
// a spelling that doubles one is elided rather than printed with the account
// name in it. win32 matches without regard to letter case, as its filesystem
// does.
function homeElisions() {
    let home = '';
    try { home = os.homedir(); } catch { home = ''; }
    home = String(home);
    if (home === '') return { known: false, elisions: [], relaxed: [] };
    const root = String(path.parse(home).root).replace(/[\\/]+$/, '');
    const escape = (s) => s.replace(/[^A-Za-z0-9]/g, (ch) => '\\' + ch);
    const flags = process.platform === 'win32' ? 'gi' : 'g';
    const lead = '(?<![A-Za-z0-9._-])';
    const trail = '(?![A-Za-z0-9._-])';
    // How many path components a spelling names, which is the measure the guard
    // below compares the stripped spelling against.
    const depth = (s) => s.split(/[\\/]+/).filter((part) => part !== '').length;
    const homeDepth = depth(home.replace(/[\\/]+$/, ''));
    const elisions = [];
    const relaxed = [];
    const seen = new Set();
    const seenRelaxed = new Set();
    for (const spelling of [home, printableAscii(home)]) {
        const named = spelling.replace(/[\\/]+$/, '');
        if (!/[A-Za-z0-9]/.test(named) || named === root) continue;
        // A spelling naming fewer components than the home directory is some
        // ancestor of it rather than it, and eliding an ancestor takes every
        // account's paths off the channel rather than this account's name.
        if (depth(named) < homeDepth) continue;
        const literal = Array.from(named)
            .map((ch) => (ch === '\\' || ch === '/' ? '[\\\\/]+' : escape(ch)))
            .join('');
        const flattened = escape(named.replace(/[^A-Za-z0-9]/g, '-'));
        for (const [source, unbounded, shown] of [
            [lead + literal + trail, literal, '~'],
            [flattened + '(?![A-Za-z0-9])', flattened, 'flattened-home']
        ]) {
            if (!seen.has(source)) {
                seen.add(source);
                elisions.push({ pattern: new RegExp(source, flags), shown });
            }
            if (!seenRelaxed.has(unbounded)) {
                seenRelaxed.add(unbounded);
                relaxed.push({ pattern: new RegExp(unbounded, flags), shown });
            }
        }
    }
    return { known: true, elisions, relaxed };
}

// Read once at module load: a process's home directory does not move under it,
// and the patterns are compiled rather than rebuilt per line.
const HOME_ELISIONS = homeElisions();

// Whether a home directory is knowable in this process at all. A caller whose
// output channel rests on the elision reads this to decide whether its floor is
// standing, since an empty elision list on its own answers two facts and only
// one of them is news: nothing to elide is ordinary, while no knowable home
// directory means every path on the lines that follow carries whatever the OS
// account name is, with nothing else on that channel saying so.
function homeElisionsKnown() {
    return HOME_ELISIONS.known;
}

// A text as the channel prints it, with the home directory's name taken out of
// it in every spelling wherever in the text it sits. Two kinds of caller:
// sanitizeForOutput above, which hands it one repo-controlled value before the
// cap is applied, and a writer's own emitter, which hands it a whole composed
// line. The value the second catches that displayPath cannot is a path embedded
// in an error reason: fs errors name the file the syscall was refused on, and a
// caller printing that reason is printing a sentence rather than a path.
//
// The substitution is not marked the way sanitizeForOutput marks its cut and its
// strip, and it needs no mark: both replacements say for themselves that the
// text was altered and what was taken out. `~` is the operator's own shorthand
// for the home directory, and `flattened-home` is not a spelling any component
// on disk carries, so a reader who needs the real path can put their home
// directory back where the mark is. A cut tail and a stripped middle have no
// such self-evident spelling, which is why those two are marked and this is not.
function scrub(text) {
    let shown = String(text);
    for (const elision of HOME_ELISIONS.elisions) shown = shown.replace(elision.pattern, elision.shown);
    return shown;
}

// The same elision for a SECOND pass over text a printable-ASCII strip has
// already been through, which is the one place the name boundaries are dropped.
//
// A caller that strips before it prints runs the elision on both sides of the
// strip, because the strip deletes: a non-printable character inside a home
// spelling hides it from the first pass and is gone by the second. What the
// second pass then meets is text whose neighbouring characters are not the ones
// the writer put there, so a spelling can arrive glued onto the text beside it,
// and the boundaries, which exist to keep a directory whose name merely runs on
// from another its own name, refuse it. Both edges are in that state, not the
// leading one alone: a deletion in front of a spelling glues the preceding word
// on, and a deletion after it glues the following word on. Either of them,
// paired with the stripped character inside the spelling that hid it from the
// first pass, is enough to carry the OS account name through a guard that keeps
// its boundaries on both passes.
//
// So the caller says whether the strip removed anything, and where it did this
// matches with no boundary at either edge. The cost is an over-elision on a value
// that carried a stripped character, a path printed under the home shorthand
// while sitting somewhere else on disk; the cost of the other direction is the
// account name on a channel a model reads. Text the strip left untouched takes
// scrub above and keeps both boundaries, so a foreign home path such as
// /mnt/backup/home/<name>/repo is still printed under its own name.
function scrubAfterStrip(text, strippedSomething) {
    if (!strippedSomething) return scrub(text);
    let shown = String(text);
    for (const elision of HOME_ELISIONS.relaxed) shown = shown.replace(elision.pattern, elision.shown);
    return shown;
}

// A registry entry is a handful of short lines. Anything past this is not one,
// and is left untouched rather than parsed.
const REGISTRY_ENTRY_MAX_BYTES = 64 * 1024;

// A coordinator file's text, or null with the clause that refused it. Both
// mechanical stampers of registry entries read through this, the boundary
// verb's `Banked:` stamp here and the seat-stop hook's `Heartbeat:` stamp, and
// so does the stamp audit's read of every coordinator file it scans, so the
// screen is a property of these files as a channel rather than of whichever
// writer needed it first.
//
// lstat, not stat: a link planted at the entry path is judged as a link rather
// than as whatever it points at, which is the screen every marker read in this
// file already takes, and the reason is sharper here, since both stampers
// rename over the path they read and following a link would aim an atomic write
// at a file of someone else's choosing. The size cap is the same conservatism:
// a file past it is not the shape the reader expects and is left untouched
// rather than parsed. It defaults to the registry entry's own bound, and a
// caller reading a coordinator file of another shape passes that file's, the
// board running to tens of thousands of bytes where an entry is a handful of
// short lines. Never throws.
function readRegistryEntryText(full, maxBytes) {
    const cap = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : REGISTRY_ENTRY_MAX_BYTES;
    try {
        const st = fs.lstatSync(full);
        if (!st.isFile()) return { text: null, reason: 'not a regular file' };
        if (st.size > cap) {
            return { text: null, reason: 'the file is too large to be the shape this reads' };
        }
        return { text: fs.readFileSync(full, 'utf8'), reason: null };
    } catch {
        return { text: null, reason: 'no readable file at that path' };
    }
}

// Replace a registry entry's whole text atomically, as { ok, reason }. The
// other half of the shared channel: one atomic write serves both stamps, so
// neither can drift from the discipline the other keeps.
//
// The three defences atomicTmpPath's own comment states, taken together because
// each is worthless alone: an unguessable temporary name, an exclusive create
// that refuses a path already occupied, and a cleanup gated on that create
// having returned, so a failure path can only remove the file this writer made.
// The temporary's name is transient-shaped, so the store's sync allowlist
// refuses it and a crash between the write and the rename leaves nothing that
// replicates. Never throws.
function writeRegistryEntryAtomic(full, text) {
    const tmp = atomicTmpPath(full);
    let created = false;
    try {
        // Create and write are separate calls, and the close is split from the
        // write, for writeJsonAtomic's own two reasons: `created` has to mean
        // "the exclusive create returned" for the cleanup below to be safe, and
        // a close error after a returned write is where a deferred write error
        // surfaces, which must not be dropped behind a success.
        const fd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(fd, text, 'utf8');
            wrote = true;
        } finally {
            try {
                fs.closeSync(fd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        fs.renameSync(tmp, full);
        return { ok: true, reason: null };
    } catch (err) {
        // Only what this writer created is this writer's to remove (see
        // atomicTmpPath).
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing left to clean up */ }
        }
        return {
            ok: false,
            reason: 'could not write the registry entry: ' + (err && err.message ? err.message : String(err))
        };
    }
}

// The shared middle of every mechanical stamp of a registry entry: the path,
// the read screen, the entry's own corroboration, the clock read and the atomic
// write, with the caller supplying only the rewrite. The boundary verb's
// `Banked:` stamp and the seat's own `Status-updated:` stamp both go out
// through it, so no screen and no refusal reason exists here in two copies.
//
// The time is read from the clock here at the write rather than passed in: a
// stamp templated from a value a caller has been holding reads as authoritative
// while naming a moment nobody measured.
//
// What the `Session:` comparison is, stated at its real strength rather than
// rounded up, because one of the fields written through here is the one the
// seat-stop hook gates its boundary marker on. The path is composed from a
// session id taken out of the environment, and the entry's own line is then
// compared against that same caller-supplied value, so what the comparison
// establishes is that the file at that path agrees with the id that named it,
// and never that the caller is the session either of them names: it is an
// internal-consistency screen on the file rather than authentication of the
// writer, and a process holding a peer's id passes it exactly as the peer
// would. What it does catch is the ordinary accident, a stale or foreign entry
// sitting at the path this id composes, which would otherwise be rewritten
// under a peer's name; an entry naming a different session, or naming none, is
// refused and left byte-identical.
//
// `rewrite(text, atIso)` answers { text, reason }, a null text refusing the
// stamp with that reason and leaving the entry untouched.
//
// Every failure returns { stamped:false, reason }: a stamp is a record of a
// declaration, never a precondition for it, so an absent coordinator directory,
// an absent entry, a foreign entry and a refused write all leave the caller's
// own work exactly as it was. Never throws.
//
// One residual, named rather than left for a reader to find, and it is
// stampHeartbeat's own: the entry is read whole here and rewritten whole from
// that snapshot, with no lock between the two, so a write by either of the
// entry's other writers landing inside that window is discarded silently. The
// cost is one lost line rewrite on a file whose fields are all restated at the
// next push or the next stamp, and the atomic rename is what keeps the loser a
// stale entry rather than a torn one.
function stampRegistryEntry(sessionId, rewrite) {
    const full = registryEntryPath(sessionId);
    if (full === null) return { stamped: false, reason: 'session id is invalid' };
    const read = readRegistryEntryText(full);
    if (read.text === null) return { stamped: false, reason: read.reason };
    const text = read.text;
    const named = /^Session:[ \t]*(\S+)[ \t]*\r?$/m.exec(text);
    if (named === null) {
        return { stamped: false, reason: 'the entry carries no Session line to vouch for it' };
    }
    if (!sameSessionId(named[1], sessionId)) {
        return { stamped: false, reason: 'the entry at that path names a different session' };
    }
    const at = new Date().toISOString();
    // The rewrite is the caller's own function and composes a pattern from a
    // caller-supplied field name, so the never-throws contract above is kept
    // here rather than assumed of every caller: a throw becomes an ordinary
    // refusal and the entry is left byte-identical, which is what every other
    // failure on this path already does.
    let rewritten;
    try {
        rewritten = rewrite(text, at);
    } catch {
        return { stamped: false, reason: 'the stamp for that entry could not be composed' };
    }
    // The shape check sits beside the catch rather than inside the deref for
    // the same reason the catch exists: a rewrite returning nothing at all
    // would otherwise throw a TypeError out of a function this path documents
    // as never throwing, which is the one failure the caller has no refusal to
    // read.
    if (rewritten === null || typeof rewritten !== 'object') {
        return { stamped: false, reason: 'the stamp for that entry could not be composed' };
    }
    if (rewritten.text === null) return { stamped: false, reason: rewritten.reason };
    const wrote = writeRegistryEntryAtomic(full, rewritten.text);
    if (!wrote.ok) return { stamped: false, reason: wrote.reason };
    return { stamped: true, reason: null, at };
}

// One field's line rewritten with the stamp. The entry's own line ending is
// preserved rather than assumed: the capture carries whatever carriage return
// the matched line ended on, so a stamp into a CRLF entry writes a CRLF line
// and leaves the file's endings uniform.
function rewriteFieldLine(text, name, at) {
    return text.replace(new RegExp('^' + name + ':.*?(\\r?)$', 'm'), name + ': ' + at + '$1');
}

// Stamp each named field's existing line with now. A name the entry does not
// carry refuses the whole stamp and leaves the file byte-identical: an entry
// missing a line the contract defines is not the shape this writes into, and
// restructuring an entry is not a stamp's to do. The refusal is over the whole
// set rather than per field, so no caller has to reason about a partial write.
function stampRegistryFields(sessionId, names) {
    return stampRegistryEntry(sessionId, (text, at) => {
        let out = text;
        for (const name of names) {
            if (!new RegExp('^' + name + ':', 'm').test(out)) {
                return { text: null, reason: 'the entry carries no ' + name + ' line this stamp rewrites' };
            }
            out = rewriteFieldLine(out, name, at);
        }
        return { text: out, reason: null };
    });
}

// Stamp the entry's `Banked:` line with now. The entry gains exactly one such
// line, an existing one being rewritten in place and a missing one inserted
// directly after `Heartbeat:`, which is where the contract's shape carries it;
// the rest of the file is byte-identical. An entry carrying neither line is not
// the shape the contract defines and is left untouched.
function stampRegistryBanked(sessionId) {
    return stampRegistryEntry(sessionId, (text, at) => {
        if (/^Banked:/m.test(text)) {
            return { text: rewriteFieldLine(text, 'Banked', at), reason: null };
        }
        if (/^Heartbeat:/m.test(text)) {
            return {
                text: text.replace(/^(Heartbeat:.*?)(\r?)$/m, '$1$2\n' + 'Banked: ' + at + '$2'),
                reason: null
            };
        }
        return { text: null, reason: 'the entry carries neither line this stamp writes beside' };
    });
}

// ---------------------------------------------------------------------------
// Shared transcript reading.
// ---------------------------------------------------------------------------

// Read a transcript with a size cap: for a large file, the head plus tail. The
// evidence each consumer scans for can land near either end of a long-running
// session: the arming invocation and any re-arm for the goal leash, and for
// the gate's automation scan a /loop invocation's first user line (head)
// beside the newest goal_status record (tail). It is the goal leash's reader
// and the automation scan's above-ceiling fallback (see
// readTranscriptForAutomation, which owns why the fallback is not that scan's
// primary read). Returns '' on any error or a non-regular file, whatever the
// size. The isFile check narrows, without closing, the window in which the
// path could be swapped for a FIFO between the stat and the open (a blocking
// read on a FIFO hangs, which no try/catch can rescue): both read branches
// re-resolve the path after the stat. The residual is accepted because
// exploiting it needs write access to the transcript's directory, which
// already implies control of the transcript contents themselves.
function readTranscriptCapped(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return '';
        const HEAD = 384 * 1024;
        const TAIL = 128 * 1024;
        if (st.size <= 512 * 1024) {
            return fs.readFileSync(transcriptPath, 'utf8');
        }
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const head = Buffer.alloc(HEAD);
            const hb = fs.readSync(fd, head, 0, HEAD, 0);
            const tail = Buffer.alloc(TAIL);
            const tb = fs.readSync(fd, tail, 0, TAIL, st.size - TAIL);
            return head.toString('utf8', 0, hb) + '\n' + tail.toString('utf8', 0, tb);
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return '';
    }
}

// Remove local-command output and caveat blocks from user-slot text. When a user
// runs a slash command the CLI echoes its stdout (and a caveat) back into the
// user turn inside <local-command-stdout>/<local-command-caveat> wrappers; that
// is the CLI's own output, not something the user typed, so it must not bind the
// leash (e.g. /kit-goal status prints the armed plan path, and a catted file or
// grep hit can echo a literal <command-args> string as data). The deliberate
// slash-command invocation record (<command-name>/<command-args>) is NOT
// stripped: the plan path a user types as a command argument is exactly how the
// arming session claims the binding. A close tag counts only when it names the
// same wrapper as its opener, so a coincidental mismatched-name closing tag
// inside real output cannot terminate the strip early and leave the rest of that
// output, or content past it, looking like ordinary typed text. The paired strip
// is greedy: it runs to the LAST same-name close tag in the entry, so echoed
// output that embeds a literal same-name close tag followed by a fake
// <command-name>/<command-args> claim cannot end the strip early and expose that
// claim. The accepted trade-off is that genuine typed text sitting between two
// same-name blocks in one entry is over-stripped, which errs toward NOT claiming
// (the safe direction). An opener with no matching closer anywhere in the
// (possibly capped) text is a truncated echo (cut by the read cap, or caught
// mid-write); it is stripped to end-of-text rather than left holding whatever it
// happened to contain.
//
// The implementation is a linear scan (one pass recording the last close tag
// per wrapper name, one pass over the openers) rather than a backtracking
// regex: this runs on user-slot text on per-turn hook paths, and a crafted
// entry dense with unmatched openers must cost milliseconds, not seconds (a
// greedy-with-backreference regex restarts an O(n) backtrack at every such
// opener, which is quadratic). The gate test suite pins both the semantics
// (differentially, against the regex form as a reference) and the bound.
function stripLocalCommandOutput(text) {
    // One forward pass records the LAST close tag per wrapper name, so the
    // opener loop below never rescans the text. Tags are matched
    // case-insensitively and pair across case, hence the case-folded map key;
    // the emitted text is always sliced from the original.
    const lastClose = new Map();
    const closeRe = /<\/local-command-([a-z]+)>/gi;
    let c;
    while ((c = closeRe.exec(text))) {
        lastClose.set(c[1].toLowerCase(), { start: c.index, end: c.index + c[0].length });
    }
    const openRe = /<local-command-([a-z]+)>/gi;
    let out = '';
    let pos = 0;
    for (;;) {
        openRe.lastIndex = pos;
        const m = openRe.exec(text);
        if (!m) return out + text.slice(pos);
        out += text.slice(pos, m.index) + ' ';
        const close = lastClose.get(m[1].toLowerCase());
        if (close && close.start >= m.index + m[0].length) {
            // Paired: strip to the LAST same-name close (greedy). Anything
            // between two same-name blocks, openers of other names included,
            // goes with the span, exactly as the greedy pairing implies.
            pos = close.end;
        } else {
            // Unmatched: stripped to end-of-text.
            return out;
        }
    }
}

// Every <command-args>...</command-args> span in the given text, in order:
// each span runs from an opener to the FIRST close after it, and scanning
// resumes past that close, the same non-overlapping enumeration a global lazy
// regex produces, but as linear literal scans (a lazy [\s\S]*? span restarts
// an O(n) walk at every unclosed opener, which is quadratic on crafted text
// and measured in whole seconds at the transcript read cap). Tags match
// case-insensitively. Spans are returned raw: callers own their
// normalization. An unclosed trailing opener contributes no span. Shared by
// userCommandArgsInclude below (which searches every span) and the gate's
// automation detection (which reads the first span only); the two must
// enumerate identically, which is why there is exactly one scanner.
function commandArgsSpans(text) {
    const spans = [];
    const openRe = /<command-args>/gi;
    const closeRe = /<\/command-args>/gi;
    let pos = 0;
    for (;;) {
        openRe.lastIndex = pos;
        const o = openRe.exec(text);
        if (!o) return spans;
        closeRe.lastIndex = o.index + o[0].length;
        const c = closeRe.exec(text);
        if (!c) return spans;
        spans.push(text.slice(o.index + o[0].length, c.index));
        pos = c.index + c[0].length;
    }
}

// Extract genuine user-typed text from a user message (a string content, or
// {type:'text'} blocks), strip local-command output, and test whether it is a
// kit-goal invocation that carries the needle. Two shapes count, checked in
// order on the same stripped text:
//   1. Harness markup: a <command-args> span carries the needle, and the same
//      content carries a <command-name> whose value is exactly '/kit-goal' or
//      ends with ':kit-goal' (the plugin-namespaced form, e.g.
//      '/claude-kit:kit-goal'), so another command that legitimately takes a
//      path argument (e.g. /graphify docs/plans/<plan>.md) cannot steal the
//      binding from the arming session.
//   2. Typed lead: the message's first non-whitespace characters are the
//      /kit-goal command token (optionally plugin-namespaced, any number of
//      ':'-joined segments, agreeing with the markup path's ':kit-goal'
//      suffix rule) followed by a token boundary, and the needle sits inside
//      the argument block that follows the token: the text up to the first
//      line that is blank (whitespace-only), or whose first non-whitespace
//      character is a backtick or '<'. A blank line ends a typed argument
//      list; a fence or tag line opens quoted or injected material, which
//      must never supply the needle; the one-plan-per-line arming shape
//      stays fully inside the block. The harness writes the markup shape
//      only when the command and its arguments share the message's first
//      line; a multi-line /kit-goal with one plan path per line lands as
//      plain prose, and this shape is what makes that arming claimable. The
//      lead anchor plus the block boundary are the anti-steal control: a
//      prose or code-fence lead never anchors, and a mention of the armed
//      plan behind a blank line, a fence, or a tag line inside a lead-token
//      message never supplies the needle. The shape is deliberately looser
//      than the harness's own parsing in exactly two ways, both confined to
//      hand-typed text: the token is case-insensitive (case variance in
//      typing is plausible and harmless), and the block spans lines (the
//      multi-line arming is this shape's whole reason to exist); the harness
//      itself would take only the first line and the exact case.
// Separators are normalized to '/' so a Windows-style reference matches the
// forward-slash plan path. tool_use and tool_result blocks are ignored: they
// carry tool I/O, which can echo the plan path outside any command invocation.
function userCommandArgsInclude(message, needle) {
    if (!message) return false;
    const c = message.content;
    let text = '';
    if (typeof c === 'string') {
        text = c;
    } else if (Array.isArray(c)) {
        // A tool block discards the WHOLE entry rather than being filtered out of
        // it, taking userTypedText's whole-entry reading in this file and going one
        // step stricter: that one discards on a tool_result, this one on either
        // tool block. A claim is an authorization
        // decision, so an entry mixing genuine user text with tool output is one
        // where planted markup could ride beside a real turn, and the stricter
        // of the two readings is the one that belongs on the deciding side.
        for (const b of c) {
            if (b && (b.type === 'tool_result' || b.type === 'tool_use')) return false;
        }
        for (const b of c) {
            if (b && b.type === 'text' && typeof b.text === 'string') text += '\n' + b.text;
        }
    } else {
        return false;
    }
    const strippedRaw = stripLocalCommandOutput(text);
    // Markup shape, on the separator-normalized whole: command-args spans are
    // matched by substring and the needle is a forward-slash path. EVERY span
    // is searched, not just the first: a real invocation can carry more than
    // one <command-args> span, and the plan path counts wherever it rides.
    // The enumeration is this file's linear scanner (commandArgsSpans).
    const stripped = strippedRaw.replace(/\\/g, '/');
    const nameMatch = /<command-name>([^<]*)<\/command-name>/i.exec(stripped);
    if (nameMatch) {
        const name = nameMatch[1].trim();
        if (name === '/kit-goal' || name.endsWith(':kit-goal')) {
            for (const span of commandArgsSpans(stripped)) {
                if (span.includes(needle)) return true;
            }
        }
    }
    // Typed-lead shape, evaluated only when the markup shape did not match.
    // Anchored against the stripped but UN-normalized text: the token is a
    // command, not a path, so a literal '\kit-goal' lead (which the harness
    // would never execute) must not normalize into a claiming '/kit-goal'.
    // The lookahead is the token boundary, so /kit-goal-notes.md never
    // matches; the (?:[\w-]+:)* prefix accepts the plugin-namespaced form,
    // multi-segment included, agreeing with the markup path's ':kit-goal'
    // suffix rule. Case-insensitive, unlike the markup path's exact name
    // comparison: this shape matches hand-typed text, where case variance is
    // plausible and harmless, while the markup name is harness-written and
    // exact.
    const lead = strippedRaw.trimStart();
    const leadMatch = /^\/(?:[\w-]+:)*kit-goal(?=\s|$)/i.exec(lead);
    if (!leadMatch) return false;
    // The needle counts only inside the argument block: the text from just
    // after the token up to the first line that is blank (whitespace-only),
    // or whose first non-whitespace character is a backtick or '<'. A blank
    // line ends a typed argument list; a fence or tag line opens quoted or
    // injected material, which must never supply the needle; the
    // one-plan-per-line arming shape stays fully inside the block. The
    // array-content path above concatenates every text block with '\n'
    // separators, so an appended second text block continues the argument
    // block only if nothing terminates it first: the '<' terminator is what
    // cuts an injected tag-shaped block. The token line's own tail is part
    // of the block even when empty (a token followed directly by a newline
    // is the multi-line arming's normal head); only a terminator character
    // ends the block there. Separator normalization applies to the block
    // alone, for the path comparison.
    const restLines = lead.slice(leadMatch[0].length).split('\n');
    let block = '';
    for (let i = 0; i < restLines.length; i++) {
        const t = restLines[i].trim();
        if (i > 0 && t === '') break;
        if (t !== '' && (t[0] === '`' || t[0] === '<')) break;
        block += restLines[i] + '\n';
    }
    return block.replace(/\\/g, '/').includes(needle);
}

// Scoping predicate for an unbound goal: does this session's transcript show the
// user typing the armed plan path as a /kit-goal argument? Matches the full
// repo-relative plan path (e.g. docs/plans/foo.md), separator-normalized, and
// only in one of userCommandArgsInclude's two invocation shapes of a USER entry
// (the arming invocation, including a re-arm after a crash): inside a
// <command-args>...</command-args> span of a kit-goal invocation, or inside
// the argument block of a typed /kit-goal lead (the block boundary is
// userCommandArgsInclude's; never past it). A plain prose mention of the path never claims:
// without this, any bystander session that happens to type or discuss the path
// (or that echoes it back, e.g. reading the session-start goal surfacing aloud)
// could steal the binding from the session actually working the plan.
// Deliberate exclusions:
//   - Assistant entries are skipped entirely: an assistant echo of the plan path
//     must never self-leash the session.
//   - isMeta entries are skipped: harness-injected records (e.g. the Stop
//     hook's own block reason, replayed back as "Stop hook feedback: ...") land
//     in the transcript as a user-type entry but are not something the user
//     typed, and the Stop hook's reason text names the plan path in full.
//   - Attachment and tool_result entries are skipped: the session-start
//     surfacing injects the plan path into EVERY session's transcript as an
//     attachment, and tool output can echo it, neither of which is the user
//     working the plan.
//   - Local-command output inside a user turn is stripped before the
//     <command-args> scan (the CLI's own echo of a slash command's stdout could
//     otherwise carry a literal, fake <command-args> string as quoted data),
//     and sub-agent (sidechain) turns do not count.
//   - The typed-lead shape anchors at the message's first non-whitespace
//     characters and reads the needle only from the argument block that
//     follows the token: a mid-message or quoted /kit-goal (prose before it,
//     a code fence around it) never claims, and a mention of the armed plan
//     behind a blank line, a fence, or a tag line inside a lead-token
//     message never claims either, so quoting or discussing an arming
//     command, or arming a DIFFERENT plan while mentioning this one, is not
//     arming this plan.
//   - It matches the dir-qualified path, not just the basename, so a session
//     that merely names a same-basename file is not leashed.
// False if there is no path or it is unreadable: a session we cannot scope is
// never leashed.
function userCommandArgsClaimPlan(transcriptPath, planRel) {
    try {
        if (!transcriptPath || !planRel) return false;
        const needle = String(planRel).replace(/\\/g, '/');
        const content = readTranscriptCapped(transcriptPath);
        if (!content) return false;
        const lines = content.split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            let entry;
            try { entry = JSON.parse(t); } catch { continue; }
            if (!entry || entry.type !== 'user' || entry.isSidechain || entry.isMeta === true
                || entry.isCompactSummary === true) continue;
            if (userCommandArgsInclude(entry.message, needle)) return true;
        }
        return false;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Automation detection for the PreCompact gate's interactive-deferral clause.
//
// The gate defers auto-compaction to the safety ceiling only when the session
// is a human interacting directly; a session driven by native /goal or /loop
// keeps the harness's early trigger. The transcript is the detection surface,
// and the shapes read here are undocumented harness output, the same class as
// the gate's other version-pinned facts: real-transcript observations, except
// the /goal clear argument shape, which follows from the invariant command
// markup and fails safe if wrong (an unrecognized clear leaves the newest
// evidence at met:false and the session on the early trigger). Detection
// errs toward "automated" only via absent evidence never arriving (a loop
// that stops being continued classifies automated indefinitely); every read
// or parse defect classifies as no evidence, and the gate turns that into a
// verdict whose failure direction is the early-trigger status quo.
// ---------------------------------------------------------------------------

// The literal command-name tags a typed /goal or /loop invocation writes. The
// FULL tag is load-bearing: a continuing ScheduleWakeup carries the loop's
// prompt verbatim, so a bare '/loop' substring appears in every wakeup and
// would read each one as a fresh invocation.
const GOAL_COMMAND_TAG = '<command-name>/goal</command-name>';
const LOOP_COMMAND_TAG = '<command-name>/loop</command-name>';

// Extract the genuinely user-typed text of a user entry's message: a string
// content, or the concatenated {type:'text'} blocks of an array content.
// Returns null when there is none, and null for an array carrying any
// tool_result block: tool output is the observed source of quoted command
// markup (a file containing the literal tags, read back into the session),
// and the harness's own /loop detector excludes exactly this shape, so the
// whole entry is discarded rather than trusting its text blocks.
function userTypedText(message) {
    if (!message) return null;
    const c = message.content;
    if (typeof c === 'string') return c;
    if (!Array.isArray(c)) return null;
    let text = '';
    for (const b of c) {
        if (b && b.type === 'tool_result') return null;
        if (b && b.type === 'text' && typeof b.text === 'string') text += '\n' + b.text;
    }
    return text;
}

// Scan transcript text for evidence that native /goal or /loop is driving the
// session. Returns true when either is in effect by the NEWEST evidence of
// its kind: transcripts are append-ordered, so a single forward pass letting
// the last match of each kind win reads newest-wins for free (the real
// end-of-loop sequence is /loop lines followed by a terminal stop, after
// which the session continues as ordinary interactive work).
//
// Evidence, per instrument:
//   /goal, surface 1: a goal_status attachment (type 'attachment', its
//     attachment.type 'goal_status'), which the goal system writes at arming
//     and at every stop evaluation. met === false means in effect; met ===
//     true means satisfied and auto-cleared, so not. Only a strict boolean
//     met decides; sentinel and reason are carried but decide nothing (a
//     real record carries met:true beside sentinel:true).
//   /goal, surface 2: a user command line whose <command-name> is exactly
//     /goal. <command-args> trimmed and lowercased equal to 'clear' means
//     not in effect; any other non-empty argument means in effect; a bare
//     /goal (empty args) reads state and decides nothing.
//   /loop: a user command line whose <command-name> is exactly /loop means
//     in effect; an assistant ScheduleWakeup tool_use whose input.stop is
//     strictly true means the loop ended. A continuing wakeup (delaySeconds,
//     prompt, ...) decides nothing: every iteration of a dynamic loop
//     re-writes its own /loop command line, so the positive evidence
//     refreshes without it.
//
// Tag order in a command line is not fixed (/loop writes <command-message>
// before <command-name>, /goal the other way), so each tag is matched by its
// own independent regex, first tag of each kind winning within the entry.
//
// Exclusions, adopted from the harness's own /loop detector, each defeating
// an observed false positive (quoted markup rides in tool output whenever a
// file containing the tags is read into a session):
//   - a raw line containing the quoted JSON form "tool_result" (quotes
//     included, the same discriminator the harness's detector uses) is never
//     a command line; the bare substring would also skip a genuine typed
//     command whose argument text merely mentions tool_result;
//   - a command line must be entry.type 'user', the wakeup entry.type
//     'assistant';
//   - isMeta, isCompactSummary, and sidechain entries are skipped;
//   - array content holding any tool_result block discards the entry
//     (userTypedText above);
//   - local-command output is stripped before the tag scan (a /goal
//     invocation's own stdout is echoed back inside <local-command-stdout>
//     carrying the full goal condition text);
//   - the ScheduleWakeup check is structural, never a substring (the tool
//     listing rides in system-prompt-shaped entries, so the bare name
//     appears in transcripts with no real invocation).
//
// String prefilters run before any JSON.parse so a multi-megabyte scan costs
// milliseconds; an unparseable line is skipped, no evidence.
function automationInEffect(text) {
    let goalInEffect = null;
    let loopInEffect = null;
    const lines = text.split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const rawToolResult = t.includes('"tool_result"');
        const mayGoalStatus = t.includes('"goal_status"');
        const mayGoalLine = !rawToolResult && t.includes(GOAL_COMMAND_TAG);
        const mayLoopLine = !rawToolResult && t.includes(LOOP_COMMAND_TAG);
        const mayWakeup = t.includes('tool_use') && t.includes('ScheduleWakeup');
        if (!mayGoalStatus && !mayGoalLine && !mayLoopLine && !mayWakeup) continue;
        let entry;
        try { entry = JSON.parse(t); } catch { continue; }
        if (!entry || typeof entry !== 'object') continue;
        if (entry.isSidechain || entry.isMeta === true || entry.isCompactSummary === true) continue;

        if (mayGoalStatus && entry.type === 'attachment'
                && entry.attachment && typeof entry.attachment === 'object'
                && entry.attachment.type === 'goal_status') {
            if (entry.attachment.met === false) goalInEffect = true;
            else if (entry.attachment.met === true) goalInEffect = false;
            continue;
        }

        if ((mayGoalLine || mayLoopLine) && entry.type === 'user') {
            const typed = userTypedText(entry.message);
            if (typed === null) continue;
            const stripped = stripLocalCommandOutput(typed);
            const nameMatch = /<command-name>([^<]*)<\/command-name>/i.exec(stripped);
            if (!nameMatch) continue;
            const name = nameMatch[1].trim();
            if (name === '/loop') {
                loopInEffect = true;
            } else if (name === '/goal') {
                // The first <command-args> span decides (first tag wins, the
                // convention every command-line reader here follows); no span
                // at all, an unclosed opener included, decides nothing.
                const spans = commandArgsSpans(stripped);
                const args = spans.length > 0 ? spans[0].trim().toLowerCase() : '';
                if (args === 'clear') goalInEffect = false;
                else if (args !== '') goalInEffect = true;
            }
            continue;
        }

        if (mayWakeup && entry.type === 'assistant') {
            const content = entry.message && entry.message.content;
            if (!Array.isArray(content)) continue;
            for (const b of content) {
                if (b && b.type === 'tool_use' && b.name === 'ScheduleWakeup'
                        && b.input && typeof b.input === 'object'
                        && b.input.stop === true) {
                    loopInEffect = false;
                }
            }
        }
    }
    return goalInEffect === true || loopInEffect === true;
}

// The byte ceiling on reading a transcript whole for the automation scan.
//
// Newest-evidence-wins only holds over bytes actually read, so the scan wants
// the whole file: a head-plus-tail read leaves an unread middle, and a loop
// whose terminating stop lands there shows its opening /loop line and nothing
// that retires it, classifying a session that has been hands-on for hours as
// automation-driven. That is the exact case the deferral exists to serve, and
// it is the common one, because a session keeps working for as long as it
// likes after its loop ends.
//
// 64 MB scans a whole multi-day session (the largest transcripts observed run
// to 57 MB) with headroom, and the cost is linear and bounded: at that size
// the read plus classification is roughly 150 ms and 175 MB of peak resident
// memory in this short-lived hook process, which runs only when the harness
// is already offering a compaction. Past the ceiling the head-plus-tail
// reader takes over, so a runaway or hostile file costs the same 512 KB it
// always did; the unread middle comes back with it, and the misread it can
// produce degrades to the early trigger, never to a wedged session.
const AUTOMATION_READ_MAX_BYTES = 64 * 1024 * 1024;

// Read a transcript for the automation scan: the whole file at or below
// AUTOMATION_READ_MAX_BYTES, the head-plus-tail read above it. Returns '' on
// any error or a non-regular file, which classifies as no evidence. The
// isFile check narrows the same FIFO-swap window readTranscriptCapped
// documents, and on the same accepted residual: a blocking read on a FIFO
// hangs where no try/catch can rescue it, and the path is re-resolved after
// the stat either way.
function readTranscriptForAutomation(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return '';
        if (st.size > AUTOMATION_READ_MAX_BYTES) return readTranscriptCapped(transcriptPath);
        return fs.readFileSync(transcriptPath, 'utf8');
    } catch {
        return '';
    }
}

// Does the transcript at this path show a native automation instrument
// driving the session? A missing path, an unreadable or non-regular file, or
// any escape reads as no evidence (false); the caller's valve leg reads the
// same file, so an unreadable transcript also yields no consumed-token
// reading and the gate's verdict on it is allow.
function transcriptShowsAutomation(transcriptPath) {
    try {
        if (!transcriptPath) return false;
        const text = readTranscriptForAutomation(transcriptPath);
        if (!text) return false;
        return automationInEffect(text);
    } catch {
        return false;
    }
}

module.exports = {
    checkpointPath, readCheckpoint, readCheckpointResult, writeCheckpoint, clearCheckpoint,
    adoptCheckpoint, checkpointAdoptable, storableCheckpointOwner, checkpointMatches, sameSessionId,
    CHECKPOINT_MAX_AGE_MS, CHECKPOINT_PENDING_MAX_AGE_MS, CHECKPOINT_FUTURE_SKEW_MS,
    roleBoundaryPath, consentPath, ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS,
    markerMatches, readRoleBoundary, readConsent, readRoleBoundaryResult, readConsentResult,
    roleBoundarySessionsResult, sweepRoleBoundaryMarkers, ROLE_BOUNDARY_MAX_NAMES,
    writeRoleBoundary, writeConsent, clearRoleBoundary, clearConsent,
    markerMomentHolds, markerDeclaresMoment, transcriptPosition,
    stampRegistryBanked, stampRegistryEntry, stampRegistryFields, registryEntryPath,
    coordinatorRoot, coordinatorDir, registryField,
    sanitizeForOutput, displayPath, scrub, scrubAfterStrip, homeElisionsKnown,
    readRegistryEntryText, writeRegistryEntryAtomic,
    projectHoldsSessionTranscript, sessionTranscriptPath, usableSessionId,
    gateStatePath, gateLogPath, readGateState, readGateStateResult, recordGateDecision, GATE_REASONS,
    gateEpisodeOpen, pendingOfferCorroborated, checkpointOwner, recordEpisodeNudge,
    interactiveHoldOpen, INTERACTIVE_HOLD_REASONS, INTERACTIVE_HOLD_MAX_ENTRIES,
    holdNudgePath, holdNudgedAt, recordHoldNudge, readHoldNudgesResult, HOLD_NUDGE_TTL_MS,
    HOLD_NUDGE_HEALABLE,
    projectGateEpisode, episodePhrase, wholeMinutesSince, gateCount,
    readTranscriptCapped, stripLocalCommandOutput, commandArgsSpans,
    userCommandArgsClaimPlan,
    automationInEffect, transcriptShowsAutomation
};
