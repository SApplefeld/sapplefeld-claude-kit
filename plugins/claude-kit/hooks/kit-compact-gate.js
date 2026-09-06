#!/usr/bin/env node
// PreCompact hook (auto matcher): boundary-gated compaction, and interactive
// deferral.
//
// Native auto-compaction lands wherever context happens to fill, which on a
// leashed plan run means mid-section, at the point of maximum lost state. The
// only native lever is this hook's power to veto a pending compaction (a
// denied auto attempt is re-tried once per assistant turn, indefinitely), so
// the kit uses the veto as a scheduler: deny auto-compaction mid-chapter,
// stand aside once the chapter-close ritual or an interim board entry has
// written a boundary checkpoint (compact-checkpoint.json in the project's
// scratch directory, via kit-compact-checkpoint.js), and the compaction lands
// on the first attempt
// after the boundary. The kit summarizes
// nothing itself; re-grounding after the compaction is the existing
// SessionStart plan-doc recovery.
//
// The autoCompactWindow that makes the early trigger possible is
// machine-global, so a hands-on session with no automation driving it
// inherits the same early trigger and would be compacted mid-discussion. The
// interactive-deferral path below is the counterweight: when no kit goal
// covers this session and no native automation instrument (/goal or /loop)
// shows in the transcript, the gate holds auto-compaction back until the
// safety ceiling, so an interactive session keeps its context roughly three
// times longer.
//
// The verdict mechanics are exit-code only, a harness fact pinned to a
// version because it can change upstream: on Claude Code 2.1.233 the harness
// honors an exit-code-2 deny (observed live against the real harness: 19
// consecutive auto-compaction attempts denied by this gate, no compaction
// landing, and a matching checkpoint then landing one with the session id
// preserved across it), while the JSON {"decision":"deny"} form is inert for
// PreCompact on that version (the compaction proceeds as if allowed, with no
// error anywhere), so nothing here is built on it. Every allow is a plain
// exit 0, and the allow path emits
// nothing at all: everything this hook reads (the payload, the goal state, the
// checkpoint, the transcript) is untrusted data, and the cheapest way to keep
// it out of a model's context is to print none of it. Each deny path writes
// its own string to stderr, carrying no data from any input (the one composed
// value is this hook's own install directory, see CHECKPOINT_CLI), distinct
// per deferral kind so a transcript reader can tell which one fired. The
// boundary note also carries two integers off the gate's own decision state,
// the count of offers held in this deferral episode and its age in whole
// minutes; integers only, so a hand-edited state file has no string it can put
// on that channel.
//
// Every verdict is recorded, after the fact and never affecting it: a state
// file and an append-only log under the project's .kit/, both owned by
// kit-compact-lib.js (recordGateDecision). Without them a deferral leaves no
// trace at all, so a run held for a whole section, a checkpoint that expired
// seconds before its offer arrived, and a valve fire are indistinguishable
// afterwards, and "this keeps happening" cannot be measured. The write is the
// last thing the entry point below does, in its own try and returning nothing,
// so no failure in it can change a verdict or an exit code; what keeps it from
// DELAYING one is that every path it touches is refused unless it is a regular
// file (a blocking read or write is the only way a diagnostic could wedge a
// run, and the entry point below says where that guard sits).
//
// The gate is a three-state classifier evaluated per offer, cheapest check
// first, with two deny states. The BOUNDARY deny holds an armed-and-bound
// plan run to its chapter boundaries; it fires only when ALL of these hold:
//   1. The payload's trigger is 'auto'. The hooks.json matcher already scopes
//      this; the in-code check makes a later matcher edit unable to silently
//      widen the gate. Manual /compact is never gated.
//   2. KIT_EXTERNAL_ENGINE is not '1'. An external engine spawns a fresh
//      worker per section, so there is no mid-chapter context to protect:
//      stand down (same marker as branch-reaper-nudge.js and hook-canary.js).
//   3. A kit goal is armed for the project (.kit/goal-state.json has a plan).
//   4. The compacting session HOLDS the leash, by one of three routes. It is
//      already bound: payload session_id equals the goal's boundSession,
//      compared as opaque case-insensitive trimmed strings (the bound session
//      keeps matching across a compaction because the harness preserves the
//      session id). Or the goal is UNBOUND and this session's transcript
//      shows the user typing the arming command against the armed plan
//      (userCommandArgsClaimPlan in kit-compact-lib.js, the same predicate
//      and the same anti-steal exclusions the Stop hook claims a binding
//      with). Or the goal is UNBOUND and its recorded arming session id is
//      this session's own (armingSessionClaims in kit-goal-lib.js owns the
//      whole match rule and is shared with the Stop hook; the field it reads
//      is written at the arm from the arming process's environment), which is
//      the route that
//      reaches a run that armed a plan for itself and so typed no command for
//      the transcript route to find. Neither claim route rests on text a
//      session can emit into its own transcript. That session claims the
//      binding here, best-effort via
//      bindSession, and is boundary-gated for this offer whether or not the
//      write landed, mirroring bindSession's own posture that enforcement
//      never depends on it. Claiming at the first compaction offer, rather
//      than only at the first stop, is what makes the gate reachable at all:
//      executing-work's completion contract forbids stopping with unblocked
//      work remaining, so a run behaving correctly never stops and a
//      stop-only claim never fires. A goal bound to a DIFFERENT session, or
//      unbound with neither claim route open to this one (a bystander either
//      way), is
//      never boundary-gated; it falls through to the interactive path below,
//      the same as no goal at all. A payload carrying no session id can be
//      neither compared nor bound, so it allows outright.
//      Two windows are widened rather than opened by claiming here, both
//      pre-existing at the stop-point claim and both bounded by the same
//      last-writer-wins posture bindSession already documents. A session
//      whose transcript carries a superseded arming of the same plan can
//      claim a freshly re-armed goal, and a clear landing between the bind's
//      read and its write can be resurrected by it. What changes is the
//      cadence: past the compaction trigger the harness re-offers every
//      assistant turn, so an unbound armed goal in a claiming session
//      attempts the write far more often than it would at stops alone. Both
//      recover by clearing or re-arming again; a compare-and-swap on the
//      bind, matching the one the advance carries, is backlogged.
//   5. No boundary checkpoint is open. A checkpoint matches only when its
//      recorded plan equals the armed goal's plan, its recorded boundSession
//      equals the goal's current boundSession, its recorded openedBy equals
//      that same session, AND it is fresh (the shared match rule and its age
//      bounds live in kit-compact-lib.js); anything else is treated as
//      absent. The plan match retires a stale file from a prior run; the
//      opener match refuses a record some other session wrote under the
//      binding, so a bystander's open never declares the leash holder's
//      boundary (the CLI's write door refuses that open first, and this leg
//      catches a record an older CLI or a hand edit produced); and the session match
//      retires an orphan from a crashed run: a checkpoint written just before
//      a crash names the same plan, but the resumed session re-binds under a
//      new id, so the orphan must not open the gate for its first mid-chapter
//      compaction. The normal path keeps matching because the harness
//      preserves the session id across a compaction. The age bound retires
//      the ordinary same-run leftover the other two cannot: the chapter-close
//      ritual opens a checkpoint at EVERY boundary, and a boundary reached
//      below the trigger has no compaction offer to catch, so its checkpoint
//      would otherwise sit open until the NEXT chapter crossed the trigger
//      mid-section and be honored there, landing the compaction mid-chapter
//      (the exact placement the gate exists to prevent) on every cycle after
//      the first. That ordinary leftover is what the ten-minute bound
//      retires. Freshness has a second leg for the case the first one cuts
//      too short: a boundary declared while this gate was ALREADY holding
//      offers has one waiting for it, with only the tool call in flight
//      between the two, and that call can run for an hour or more, so such a
//      checkpoint is judged by a bound of hours instead. The long leg is
//      never granted on the file's say-so: this gate passes what its own
//      recorded state says at the moment it decides, and
//      pendingOfferCorroborated in kit-compact-lib.js is the rule that reads
//      it. An uncorroborated pending flag falls back to the short bound. One
//      consequence belongs here rather than there, because it is about this
//      hook's own sequence: the FIRST boundary after the context crosses the
//      trigger takes ten minutes like any other, since no episode exists
//      until this gate has denied once, and the CLI reads that same absence
//      at the open and writes the flag false, so the record does not claim a
//      hold either. The leg engages from the first deny onward. A checkpoint
//      recording no owner is the ordinary product of a boundary declared while
//      the goal was unbound, and a claim adopts it here before the verdict
//      runs; one that reaches the verdict still ownerless is a mismatch, as is
//      one with no legible openedAt (written by an older version, or
//      hand-made), the fail-open-toward-status-quo direction. When a MATCHING checkpoint is
//      open the hook allows and consumes (deletes) it before exiting, so the
//      next mid-chapter attempt is denied again: consumption is single-shot,
//      and it happens only on this checkpoint-driven allow. Allowing for any
//      other reason (no goal, bystander, external engine, valve) leaves the
//      file alone, because those allows are not the boundary firing and
//      consuming there would burn a checkpoint the run still needs. The
//      checkpoint check runs before the valve read (it is the cheaper of the
//      two, and a boundary that has been reached should land the compaction
//      and retire its checkpoint whatever the token count says).
//   6. The consumed-token reading from the transcript is legible AND strictly
//      below SAFETY_CEILING_TOKENS. This is the safety valve: a denied auto
//      attempt retries forever, so sustained denial with a chapter that never
//      closes would otherwise climb to the model's hard limit and kill the
//      session with "Prompt is too long". At or above the ceiling the gate
//      allows regardless of the checkpoint. The PreCompact payload carries no
//      usage field, so the reading comes from the transcript at the payload's
//      transcript_path: the newest main-thread assistant usage row, summed as
//      input_tokens + cache_creation_input_tokens + cache_read_input_tokens
//      (monotonic across a session, so a rising-signal ceiling check is
//      sound).
//   7. No live operator-consent marker names this session. The consent marker
//      (compact-consent.json in the project's scratch directory, which
//      kitScratchDir in kit-compact-lib.js resolves, written by
//      kit-compact-checkpoint.js consent, only on the operator's explicit
//      word) releases one deferred
//      compaction for the session it names, on this leg and the interactive
//      one: a scheduling release, converting "not at this moment" into "now",
//      never touching an allow clause or the checkpoint rule. It is read only
//      where the deny would otherwise fire, so every allow above keeps its
//      meaning; the match (session, unconsumed, age-bounded) is the shared
//      markerMatches rule in kit-compact-lib.js, and the allow it causes
//      consumes the marker, single-shot, best-effort like the checkpoint's
//      own consumption. A marker does not outlive its moment by another route
//      either: every allow is a compaction landing for the payload's session,
//      and the entry wrapper's landing sweep retires that session's markers
//      whatever the reason, so a release that missed its offer cannot convert
//      a later mid-work deny.
//
// The INTERACTIVE deny is the second deny state. When no kit goal covers this
// session (none armed, an unparseable goal state, a goal bound to another
// session, or an unbound goal this session's transcript makes no claim on),
// the session is either a human interacting directly or one driven
// by a native automation instrument, and the transcript at the payload's
// transcript_path tells the two apart (transcriptShowsAutomation in
// kit-compact-lib.js, which owns the evidence shapes and their exclusions).
// Native /goal or /loop in effect: allow, the native early trigger governs.
// Neither in effect: the operator is mid-conversation and an early compaction
// costs the discussion its context, so deny while the same valve reading as
// clause 6 is legible AND strictly below SAFETY_CEILING_TOKENS, and allow at
// or above the ceiling or on an illegible reading. Two release markers can
// end this hold before the ceiling, both read only where the deny would
// otherwise fire: a live role-boundary marker for the offering session
// (compact-role-boundary.<session>.json in the project's scratch directory, one
// file per session so no seat can rename over a peer's declaration, resolved by
// roleBoundaryPath in kit-compact-lib.js for writer and reader alike)
// lands the compaction at that declared boundary, and a live operator-consent
// marker naming it does the same on the operator's word. The boundary marker's
// ordinary writer is the seat-stop.js Stop hook, which opens it at a turn end
// off the registered seat's own status push over a clean tree; the
// kit-compact-checkpoint.js boundary subcommand writes the same marker by hand,
// for a seat the registry does not carry and for a registered one whose project
// tree holds work it does not own, and stamps that marker as a declaration.
// A declared marker carries a second condition besides the shared match rule,
// because it names a moment rather than a window: it is honored only while no
// new turn has begun in the session it names since it was written, read from
// that session's transcript by markerMomentHolds in kit-compact-lib.js, which
// owns the provenance scoping, the inbound shapes and the reading of every
// unanswerable question as lapsed. The hook's turn-end marker declares no
// moment and is governed by its age bound alone, so this leg opens no
// transcript for one. Each allow
// consumes its marker, single-shot, and journals its own reason (role-boundary,
// operator-consent); a peer's boundary marker sits at a file this leg never
// opens for this session, and a marker naming another session, a consumed one,
// and a stale one release nothing and are left in place under a deny, so a
// marker-less session takes exactly the path it always did, while the
// landing sweep (see the entry wrapper) retires the landing session's own
// markers on every allow. No allow on this path ever
// consumes a checkpoint: consumption is the boundary firing, exclusive to the
// clause-5 allow, and burning one here would rob the bound run of a boundary
// it still needs. A detection miss in either direction is safe-cheap: a
// missed instrument defers a session that would rather compact early (it
// still compacts at the ceiling), and an unreadable transcript yields no
// valve reading either, so the verdict on it is allow, the early-trigger
// status quo.
//
// Any other state, any read error, any ambiguity: allow. This is the same
// fail-open posture as kit-goal-stop.js. A forgotten checkpoint degrades to
// "compaction lands late, mid-chapter" (the pre-gate status quo); an
// unreadable transcript, an unparseable payload, a missing goal file, or a
// filesystem error must never wedge a session against the context limit. A
// bug anywhere allows, so the hook never converts a scheduling nicety into a
// dead run.

'use strict';

const fs = require('fs');
const { readGoal, bindSession, armingSessionClaims } = require('./kit-goal-lib.js');
const {
    readCheckpoint, clearCheckpoint, adoptCheckpoint, checkpointMatches, sameSessionId,
    transcriptShowsAutomation, userCommandArgsClaimPlan,
    recordGateDecision, projectGateEpisode, episodePhrase,
    readGateState, pendingOfferCorroborated, checkpointOwner,
    markerMatches, markerMomentHolds,
    readRoleBoundary, readConsent, clearRoleBoundary, clearConsent,
    ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS
} = require('./kit-compact-lib.js');

// The deferral ceiling, in consumed tokens, shared by both deny paths: the
// armed run's safety valve (clause 6) and the interactive deferral's bound.
//
// ASSUMPTION, named because it is the one direction of this design that is
// not fail-open: this is an absolute token count sized for the roughly
// 1,000,000-token window current models carry. The PreCompact payload
// provides no model field (only SessionStart does), so the window cannot be
// derived at fire time. On a model with a SMALLER window the ceiling sits
// above the hard limit, the valve never fires, and sustained denial kills
// the session outright. The interactive path applies this ceiling to every
// hands-on session on the machine, on whatever model it happens to run, so
// that blast radius is machine-wide, no longer confined to leashed plan
// runs. Two facts bound it: the gate can only deny an offer the harness
// already made, so a model whose window sits below the compaction trigger
// never reaches this path at all; and the hazard therefore needs a model
// whose hard limit falls between the trigger and this ceiling. One shared
// ceiling is the decided design (per-mode ceilings are out of scope).
// Nothing detects the small-window state; the doctor's window check reads
// the configured autoCompactWindow, which says nothing about the running
// model's real window.
//
// Arithmetic. The ceiling has two jobs and the tighter one sets the value.
// Its hard job is preventing a dead run: a denied attempt is re-offered every
// turn and never forced, so without a valve the context climbs to the model's
// limit and the session dies with "Prompt is too long", which was observed
// live. Its softer job is landing the compaction before a run gets bad, and
// quality is observed degrading through the 700,000 to 800,000 band. Sitting
// at the bottom of that band satisfies both with roughly 200,000 tokens of
// headroom under the limit, which absorbs the two mechanics that compound
// against the margin: the reading is one turn STALE (the newest usage row
// reflects the previous turn's request), and a denied attempt is re-evaluated
// only once per turn, so the true margin from a deny decision to the limit is
// two turns of growth rather than one.
const SAFETY_CEILING_TOKENS = 800000;

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Read the transcript's tail with a size cap. The valve only needs the newest
// usage row, which sits within a few lines of the file's end, so unlike
// kit-goal-stop's head+tail read this one takes the tail alone. Returns '' on
// any error or a non-regular file (a blocking read on a FIFO would hang,
// which no try/catch can rescue).
function readTranscriptTail(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return '';
        const CAP = 1024 * 1024;
        if (st.size <= CAP) {
            return fs.readFileSync(transcriptPath, 'utf8');
        }
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const buf = Buffer.alloc(CAP);
            const bytes = fs.readSync(fd, buf, 0, CAP, st.size - CAP);
            return buf.toString('utf8', 0, bytes);
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return '';
    }
}

// Sum one usage-shaped object into a consumed-token figure, or null when it is
// not a legible reading. Consumed = input_tokens + cache_creation_input_tokens
// + cache_read_input_tokens; an absent field counts as zero (a turn with no
// cache activity omits nothing load-bearing), but a present field that is not
// a finite non-negative number makes the whole reading illegible, and an object
// carrying none of the three fields is no reading at all. Illegible returns
// null, which the caller turns into an allow: guessing low here would keep the
// gate denying a session that may already be at the limit.
function sumUsageFields(usage) {
    const fields = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
    let total = 0;
    let sawAny = false;
    for (const f of fields) {
        const v = usage[f];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
        total += v;
        sawAny = true;
    }
    return sawAny ? total : null;
}

// The current context size a usage object describes.
//
// A message whose assistant turn took several internal iterations carries a
// usage.iterations array, and the object's TOP-LEVEL cache fields are summed
// across those iterations rather than describing the final request. Observed
// in the wild: a row whose top-level fields sum to 710,223 is three iterations
// of roughly 355,000 each, its top-level cache_read of 708,291 being exactly
// the iterations' 353,812 + 0 + 354,479. Reading the top level there overstates
// the real context by about a factor of two.
//
// So a single iteration is the reading when the array is present and non-empty,
// and the top-level fields are the reading otherwise, which is every
// single-iteration turn. Note the top level is not uniformly a sum
// (input_tokens is not aggregated the way the cache fields are), which is why
// this picks an iteration outright rather than trying to divide the aggregate.
//
// Which iteration: the LARGEST, not the last. The last entry is the final
// request and on every row observed so far it is also the largest, the
// iterations of a turn running within a percent of each other. But that is one
// session's evidence for a rule that has to hold on shapes nobody has seen, and
// the two candidates fail in opposite directions. If a turn ever ends on a
// small internal call, reading the last entry understates the context, the gate
// keeps denying a session that may be at its limit, and the run dies: the one
// outcome this whole design exists to prevent. Reading the largest can only
// overstate by comparison, which trips the valve early and costs a mistimed
// compaction, the pre-gate status quo. Identical on the observed shape, safe on
// the ones that are not.
//
// An unreadable entry makes the whole reading illegible rather than being
// skipped, so a malformed array cannot silently narrow the set being maximized.
// Illegible allows, per sumUsageFields.
//
// The error this corrects was fail-open (overstating consumption makes the
// valve allow earlier, never deny longer), but it tripped the valve at roughly
// half the intended ceiling on the affected rows, which is the same inertness
// the ceiling exists to avoid.
function consumedFromUsage(usage) {
    const iterations = usage.iterations;
    if (Array.isArray(iterations) && iterations.length > 0) {
        let largest = null;
        for (const entry of iterations) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
            const sum = sumUsageFields(entry);
            if (sum === null) return null;
            if (largest === null || sum > largest) largest = sum;
        }
        return largest;
    }
    return sumUsageFields(usage);
}

// The newest main-thread consumed-token reading from the transcript, or null
// when none can be obtained. Scans the tail newest-first for an assistant
// entry carrying a usage object at message.usage; sidechain (sub-agent) rows
// are skipped because their usage measures the sub-agent's own context, not
// this session's. The tail's first line may be a partial entry (cut by the
// cap, or caught mid-append): an unparseable line is simply skipped. The
// NEWEST usage-bearing row decides alone: when it is illegible this returns
// null (allow) rather than falling back to an older row, because the signal
// is monotonic and an older reading can only understate, which is the
// dangerous direction (a deny near the hard limit).
function latestConsumedTokens(transcriptPath) {
    try {
        if (!transcriptPath) return null;
        const text = readTranscriptTail(transcriptPath);
        if (!text) return null;
        const lines = text.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const t = lines[i].trim();
            if (!t) continue;
            let entry;
            try { entry = JSON.parse(t); } catch { continue; }
            if (!entry || entry.type !== 'assistant' || entry.isSidechain) continue;
            const usage = entry.message && entry.message.usage;
            if (!usage || typeof usage !== 'object') continue;
            return consumedFromUsage(usage);
        }
        return null;
    } catch {
        return null;
    }
}

// Clauses 5 and 6 for a session that holds the leash: the boundary-gated
// verdict. `goal` must carry the boundSession the checkpoint is expected to
// name, which for a session that just claimed the binding is its own id.
//
// Clause 5: a matching open checkpoint is the boundary firing. The match rule
// (plan equals the goal's, boundSession equals the goal's, openedBy equal to
// that same session, openedAt fresh; see the header for why each leg exists) is
// checkpointMatches in kit-compact-lib.js, single-sourced there because the
// CLI's status report answers from the same rule and the two must never drift.
// Allow and consume on a match, single-shot; a non-matching checkpoint reads as
// absent and is left in place (the next CLI write replaces it, and the expired
// case in particular must NOT be consumed: an expiry deny is not the boundary
// firing).
// A checkpoint opened while the goal was still unbound records boundSession
// null, and every claim point adopts such a record for the session it binds
// (adoptCheckpoint in the lib, called from this hook's two claim branches and
// the Stop hook's two) before this verdict reads it, so a boundary a run banked
// before its leash reached it is matched here like any other. An arm-time bind
// is not a claim point and adopts nothing; it writes the binding before any
// boundary of that run exists. A record naming some other session is not
// adoptable and still reads as absent, which is the crash-orphan case that leg
// exists for. The read here and the delete below are not atomic: this
// assumes the single-writer reality, where the CLI writer and this gate
// serialize through the one bound session, so no checkpoint can land between
// them and be consumed by an allow the previous one earned. A future
// concurrent writer breaks that assumption and needs a compare-before-delete
// or an atomic take.
//
// Clause 6: the safety valve. Illegible reads allow rather than denying blind.
//
// Clause 7: the operator's release. A live consent marker naming the offering
// session (`sessionId`, the payload's own id, which on both call sites equals
// the goal's boundSession) converts this hold's "not at this moment" into
// "now", once. It is read only after every allow above has declined, so none
// of those allows changes meaning; what they share with this one is the entry
// wrapper's landing sweep, which retires any marker the landing session names
// whatever the allow's reason, so a marker never outlives the landing that
// mooted it. The consume here is best-effort like clearCheckpoint's, and the
// residue of a failed delete is one extra release inside the consent's own
// age bound, the same direction the checkpoint's failed consume takes.
function boundaryVerdict(cwd, goal, transcriptPath, sessionId) {
    const cp = readCheckpoint(cwd);
    // Whether a flagged checkpoint is vouched for by a standing, owned,
    // predating deferral episode: pendingOfferCorroborated owns that rule and
    // the reasons for each of its three legs. A state that cannot be read
    // yields no episode and so the short bound, the conservative direction.
    //
    // The state read is deliberately NOT eager. The dominant case here is
    // mid-chapter with no checkpoint at all, or one carrying no flag, where the
    // predicate answers on its first line without looking at the state; hoisting
    // the read into the argument would put an lstat plus a full file read on the
    // pre-verdict path of every offer, which is the path this hook keeps clear.
    const now = Date.now();
    const owner = checkpointOwner(goal);
    const pendingCorroborated = (cp && cp.pendingOffer === true)
        ? pendingOfferCorroborated(cp, readGateState(cwd), now, owner)
        : false;
    const checkpoint = checkpointFacts(cp, pendingCorroborated);
    const match = checkpointMatches(cp, goal, now, pendingCorroborated);
    if (match.ok) {
        clearCheckpoint(cwd); // best-effort: a failed delete degrades to an open gate, never a wedged run
        return { verdict: 'allow', reason: 'checkpoint', checkpoint };
    }

    const consumed = latestConsumedTokens(transcriptPath);
    if (consumed === null) return { verdict: 'allow', reason: 'illegible', consumed: null, checkpoint };
    if (consumed >= SAFETY_CEILING_TOKENS) return { verdict: 'allow', reason: 'valve', consumed, checkpoint };

    const consent = readConsent(cwd);
    if (markerMatches(consent, sessionId, now, CONSENT_MAX_AGE_MS).ok) {
        clearConsent(cwd); // best-effort: a failed delete degrades to an open gate, never a wedged run
        return { verdict: 'allow', reason: 'operator-consent', consumed, checkpoint };
    }

    // The deny's reason is the checkpoint rule's own verdict on whatever was on
    // disk ('no-checkpoint' for the ordinary mid-chapter case, 'expired' for a
    // boundary whose offer arrived too late, and so on), which is what makes a
    // run of denials in the log readable after the fact.
    return { verdict: 'deny-boundary', reason: match.reason, consumed, checkpoint };
}

// The boundary verdict, carrying what an adoption that could not land says
// about it. An adoption that failed leaves the ownerless record on disk, so the
// match rule refuses it on its session leg and the deny reports wrong-session
// against the run's own boundary with nothing naming the write behind it, which
// is the misleading diagnostic one layer down. The flag rides on the decision
// for the operator note the entry wrapper composes; gateRecord's shape is
// closed and drops it, which is deliberate, since this is a diagnostic for the
// operator watching this deny rather than a new field in the journal contract
// the CLI and the nudge both read.
function boundaryDecision(cwd, goal, transcriptPath, sessionId, adoption) {
    const verdict = boundaryVerdict(cwd, goal, transcriptPath, sessionId);
    return (adoption && adoption.ok === false) ? { ...verdict, adoptFailed: true } : verdict;
}

// What the decision record keeps about the checkpoint file that was on disk:
// how old it was, and whether it claims to have been opened while an offer was
// already pending. Null when no legible record was there at all. The values are
// recorded, never acted on; the match rule alone decides.
//
// The checkpoint CLI sets pendingOffer at the open, from the gate's own
// recorded state, and the pair of it and `corroborated` selects the age bound
// the match rule holds the record to. Both are recorded because they are what
// makes an expiry legible afterwards: a deny reports reason 'expired' for an
// ordinary below-trigger leftover aging out, for a real boundary discarded
// because no standing hold vouched for its flag, and for the outer sanity cap,
// and only these two fields tell those apart in the log. The pendingOffer field
// is absent on a checkpoint an older kit wrote, which reads false, exactly as
// the match rule reads it.
function checkpointFacts(cp, corroborated) {
    if (!cp || typeof cp !== 'object' || Array.isArray(cp)) return null;
    const opened = typeof cp.openedAt === 'string' ? Date.parse(cp.openedAt) : NaN;
    return {
        ageSeconds: Number.isFinite(opened) ? Math.round((Date.now() - opened) / 1000) : null,
        pendingOffer: cp.pendingOffer === true,
        corroborated: corroborated === true
    };
}

// Decide the verdict, as a decision object: `verdict` is 'allow',
// 'deny-boundary' (the armed-and-bound run held mid-chapter) or
// 'deny-interactive' (a hands-on session held below the ceiling), `reason`
// names the clause that decided, and `cwd`, `session`, `consumed` and
// `checkpoint` carry what that clause read. The clauses run cheapest first (see
// the header for why each exists), and only the checkpoint-driven allow
// consumes the checkpoint.
//
// The reason and the readings exist for the decision record alone: nothing here
// branches on them, and the entry-point wrapper reads `verdict` and nothing
// else to pick the exit code. Never throws on its own account; that wrapper
// turns any escape, and any return value it does not recognize, into an allow.
function main() {
    let payload;
    try { payload = JSON.parse(readStdin() || '{}'); } catch { return { verdict: 'allow' }; }
    if (!payload || typeof payload !== 'object') return { verdict: 'allow' };

    const cwd = payload.cwd || process.cwd();
    const transcriptPath = payload.transcript_path || payload.transcriptPath;
    const sessionId = payload.session_id || payload.sessionId;
    // The project the decision is RECORDED against is the payload's cwd alone,
    // never the fallback the clauses read from. A payload that does not parse,
    // or that omits its cwd, names no project: recording under process.cwd()
    // would scatter records into whatever directory the harness happened to
    // spawn this hook from. A decision carrying no cwd is simply not recorded,
    // and the clauses below still read the fallback, so no verdict changes.
    const recordCwd = (typeof payload.cwd === 'string' && payload.cwd !== '') ? payload.cwd : null;
    // Every decision below carries the project and the session it was taken
    // for, which is what the record is keyed on; the clause supplies the rest.
    function decide(clause) {
        return {
            reason: null, consumed: null, checkpoint: null,
            cwd: recordCwd, session: sessionId,
            ...clause
        };
    }

    // Clause 1: only the auto trigger is ever gated.
    if (payload.trigger !== 'auto') return decide({ verdict: 'allow', reason: 'not-auto' });

    // Clause 2: external-engine workers are fresh per section; stand down.
    if (process.env.KIT_EXTERNAL_ENGINE === '1') return decide({ verdict: 'allow', reason: 'external-engine' });

    // Clauses 3 and 4: an armed goal held by THIS session, whether already
    // bound to it, claimed here from its transcript, or claimed here on the
    // arming session id the state records, takes the boundary-gated path; an
    // armed goal bound to ANOTHER session or unbound with neither claim
    // available to this one (a bystander either way), or no armed goal at all,
    // falls through to the interactive path.
    const goal = readGoal(cwd);
    const armed = !!(goal && typeof goal.plan === 'string' && goal.plan !== '');
    // An armed goal beside a payload carrying no session id is ambiguous: the
    // harness normally always sends session_id, so its absence is an anomaly,
    // not evidence of a bystander, and the offer may belong to the bound
    // session itself. A bind is impossible without an id either, and an id
    // that is not a string is the same anomaly one step further on: it would
    // reach the checkpoint compare only through a String() coercion, so the
    // shape is checked here rather than relied on downstream. Ambiguity
    // allows rather than risking an interactive deny against the bound run.
    if (armed && (typeof sessionId !== 'string' || !sessionId)) return decide({ verdict: 'allow', reason: 'no-session' });
    if (armed && sameSessionId(goal.boundSession, sessionId)) {
        return decide(boundaryVerdict(cwd, goal, transcriptPath, sessionId));
    }
    // An unbound goal whose arming command this session's transcript shows the
    // user typing is this run: claim the binding now, so the gate reaches a
    // run that holds the completion contract and therefore never stops to
    // claim it. The write is best-effort and the verdict does not wait on it;
    // a bind that never lands leaves the run deferring to the safety ceiling,
    // which is where a .kit/ that rejects this write also leaves checkpoint
    // placement anyway.
    if (armed && !goal.boundSession && userCommandArgsClaimPlan(transcriptPath, goal.plan)) {
        bindSession(cwd, sessionId, transcriptPath);
        goal.boundSession = sessionId;
        // A boundary banked while the goal was unbound records no owner,
        // because the record copies the goal's binding at the open. The verdict
        // below compares the two owners, so without this the run's own
        // checkpoint reads as another session's and the boundary it declared is
        // discarded. The adoption runs before the verdict for that reason, is
        // best-effort like the bind above, and adoptCheckpoint owns which
        // records it may take. An adoption that could not land does not hold up
        // the verdict; it rides on it, so the deny says so (boundaryDecision).
        return decide(boundaryDecision(cwd, goal, transcriptPath, sessionId,
            adoptCheckpoint(cwd, goal, sessionId)));
    }
    // The same claim on the other evidence: an unbound goal whose state records
    // the id of the session that armed it, met here by that session. A run that
    // armed a plan for itself types no command for the branch above to read, so
    // this is the route by which its own leash reaches it, and the id comes from
    // the arming process's environment rather than from transcript text, which
    // is why nothing a session emits can claim on it. The whole match rule, the
    // shape test this payload id is held to included, is armingSessionClaims's,
    // shared with the Stop hook's copy of this branch. Best-effort bind and
    // stale-snapshot refresh on the same terms as above.
    if (armed && !goal.boundSession && armingSessionClaims(goal, sessionId)) {
        bindSession(cwd, sessionId, transcriptPath);
        goal.boundSession = sessionId;
        // The ownerless-checkpoint adoption the branch above states, on the
        // same terms. A run that armed a plan for itself reaches its first
        // boundary unbound by construction, so this is the route where the
        // adoption is the ordinary case rather than the unusual one.
        return decide(boundaryDecision(cwd, goal, transcriptPath, sessionId,
            adoptCheckpoint(cwd, goal, sessionId)));
    }

    // The interactive path (see the header): no kit goal covers this session,
    // so the transcript decides whether a native automation instrument is
    // driving it. Automation in effect: allow, the native early trigger
    // governs. Neither instrument in effect: a hands-on session, deferred to
    // the same ceiling the valve enforces, under the same illegible-reading
    // allow. No checkpoint is touched on this path.
    if (transcriptShowsAutomation(transcriptPath)) return decide({ verdict: 'allow', reason: 'automation' });
    const consumed = latestConsumedTokens(transcriptPath);
    if (consumed === null) return decide({ verdict: 'allow', reason: 'illegible' });
    if (consumed >= SAFETY_CEILING_TOKENS) return decide({ verdict: 'allow', reason: 'valve', consumed });
    // The release markers, read only once every allow above has declined so a
    // marker-less session takes exactly the path it always did (see the
    // header). Both apply to either interactive reason: the bystander leg is a
    // role seat's ordinary state in a leashed project, held while another
    // session works the goal, and its own banked-and-empty moment is as real
    // as an unarmed session's. The seat's own declared boundary is checked
    // first, mirroring the checkpoint-before-valve ordering: a boundary that
    // has been reached should land the compaction and retire its marker, and
    // an operator's consent then stays for the deferral it was given for,
    // until this session's own landing retires it (the landing sweep in the
    // entry wrapper). The consume here is best-effort like the checkpoint's;
    // a failed delete degrades to one extra release inside the marker's own
    // age bound, never to a wedged run.
    //
    // The typeof guard mirrors the armed path's own session-id shape check,
    // which an unarmed payload never passes through: sameSessionId compares
    // through a String() coercion, so a coercible non-string (an array of one
    // id) would otherwise match and spend a marker. A payload whose session
    // id is not a non-empty string reads neither marker and releases nothing.
    //
    // A role-boundary marker the boundary verb declared carries a second
    // condition the consent marker does not: it names a moment, so it is
    // honored only while no new turn has begun in the session it names since it
    // was written (markerMomentHolds, read against that session's own
    // transcript, which is the one this payload names). A marker that outlived
    // its moment is ignored and left in place, for the status verb to report as
    // lapsed and the age bound to clear; every unreadable answer counts as
    // lapsed, so this leg fails toward deferral like the rest. Which markers
    // the rule governs is markerMomentHolds's own to decide rather than a
    // condition spelled again here: it holds by return for a marker that
    // declared no moment, the seat-stop hook's turn-end bank, and reads no
    // transcript for one.
    if (typeof sessionId === 'string' && sessionId !== '') {
        const now = Date.now();
        const boundary = readRoleBoundary(cwd, sessionId);
        if (markerMatches(boundary, sessionId, now, ROLE_BOUNDARY_MAX_AGE_MS).ok
            && markerMomentHolds(boundary, transcriptPath).ok) {
            clearRoleBoundary(cwd, sessionId);
            return decide({ verdict: 'allow', reason: 'role-boundary', consumed });
        }
        const consent = readConsent(cwd);
        if (markerMatches(consent, sessionId, now, CONSENT_MAX_AGE_MS).ok) {
            clearConsent(cwd);
            return decide({ verdict: 'allow', reason: 'operator-consent', consumed });
        }
    }
    // The deny's reason is why this session took the interactive path at all:
    // nothing is armed in the project, or what is armed belongs to another
    // session. The two read very differently in a log.
    return decide({ verdict: 'deny-interactive', reason: armed ? 'bystander' : 'no-goal', consumed });
}

// Run as the PreCompact hook only when invoked directly, so a require() of
// this file can never fire the gate as a side effect. Nothing in the kit
// requires it today: hook-canary's load check covers files wired in
// hooks.json via node --check, which is syntax-only and proves nothing about
// whether the lib requires above resolve; resolution is exercised by this
// hook's own test suite, which spawns the real file. Either deny is exit code
// 2 via process.exitCode rather than process.exit(), so the stderr note can
// drain before the process ends; each note carries no input data, the one
// composed value being this hook's own installed directory (see CHECKPOINT_CLI
// below), and each is distinct per deny kind so a transcript reader can tell
// which deferral fired, there so the operator watching reads a deferral, not a
// failure. That audience is a dependency on the harness version this kit runs
// on: PreCompact stderr is observed to reach the operator alone and never the
// model, which the harness does not guarantee and can change upstream. The note
// carries a runnable release chain, so an erosion of that reading would put a
// command that ends a deferral in front of the model with nothing but the model's
// own judgment between the two; a harness release that changes where this
// channel lands is therefore a review trigger for what these notes may say. Any
// exception, and any verdict value that is not a recognized deny, allows:
// fail-open on every axis.
// The gate ships as a plugin and runs in every project, so a repo-relative
// command path in the note below resolves only where the kit is dogfooded in
// its own checkout. The note names a command the operator is meant to run, so
// it is built from this hook's own location instead: __dirname is the module's
// path, never a payload, transcript, or repo value, so the injection posture is
// unchanged. Forward slashes because node accepts them on Windows and a
// backslash path pasted into a shell does not survive every shell. The doctor
// charset-gates the interpolants in its own pasteable command line; this one is
// exempt because the value is module state rather than input, and an actor who
// controls this file's path is already running this file's code. The CLI reads
// its state from the cwd, so the remedy names the project directory too.
const CHECKPOINT_CLI = __dirname.split('\\').join('/') + '/kit-compact-checkpoint.js';
// The goal CLI, composed the same way and for the same reason. The note needs it
// because the session id `consent --session` takes is printed there and nowhere
// else the operator can reach: the checkpoint CLI's own status never prints the
// binding, its checkpoint and gate-state reports naming no session id at all and
// its hold-stamp report withholding ids by design, and the ids its marker legs do
// print are each marker's own session, which is the session already holding a
// release rather than the one an operator is looking to release. The goal CLI's
// status prints the binding as "bound to session <id>".
const GOAL_CLI = __dirname.split('\\').join('/') + '/kit-goal.js';
const BOUNDARY_NOTE = 'kit-compact-gate: auto-compaction deferred to the next chapter close or interim board entry; '
    + 'this is the kit scheduling the compaction, not an error. Keep working. '
    + 'The hold runs until that boundary or the context safety valve fires near the token limit, whichever '
    + 'comes first; a skipped boundary costs a compaction landing at the worst point in the section, never a '
    + 'wedged run. Repeating for many turns within one section is expected. If it is still firing after a '
    + 'Chapter has closed, either the boundary checkpoint was never opened or the one that was opened is no '
    + 'longer honored (an expired one, one whose pending-offer flag no deferral episode vouches for, or one '
    + 'a session other than the leash holder opened, which is also how every record written before the '
    + 'opener was recorded reads): '
    + 'prompt the session to close its '
    + 'boundary, or check yourself from the project directory with node "' + CHECKPOINT_CLI
    + '" status, read that session\'s id from node "' + GOAL_CLI
    + '" status, which prints the binding as "bound to session <id>", and release that session '
    + 'yourself with node "' + CHECKPOINT_CLI
    + '" consent --session <that session\'s id>. The release is the operator\'s path rather than open, '
    + 'which is scoped to the calling session: from a shell of your own it has no session id to write, '
    + 'and from another session\'s it would be declaring that session\'s boundary.';
// The clause a boundary deny carries when this run's own ownerless boundary
// record could not be given the binding. Two things produce that, an unwritable
// .kit and a concurrent open replacing the record under the write, so it names
// neither and states what the operator can act on: the record was judged as
// another session's, and opening a boundary now records it under the binding
// this offer just claimed. Fixed text interpolating nothing, on the same
// provenance bound the notes it joins.
const ADOPT_FAILED_NOTE = ' The boundary record this run opened before its leash was claimed could not be '
    + 'rewritten with the binding, so this offer judged it as another session\'s; opening a boundary again '
    + 'records it under the binding.';

const INTERACTIVE_NOTE = 'kit-compact-gate: auto-compaction deferred to the context safety ceiling; '
    + 'this is the kit holding compaction out of an interactive session, not an error. Keep working. '
    + 'To land it sooner, bank the session\'s state at a natural boundary and open the release from '
    + 'the project directory with node "' + CHECKPOINT_CLI + '" boundary; the next offer lands there.';

// How long the gate has been holding this run back, as a sentence for the
// boundary note: the count of offers held and the whole minutes since the first
// of them. That turns a note the operator has seen twenty times into a reading
// they can act on ("this has been going for an hour" is a missed boundary; "two
// offers over one minute" is the mechanism working).
//
// The figures come from projecting the state forward over this decision rather
// than from re-reading the file, so the sentence reports the hold including the
// deny it is announcing, and a write that fails or never runs cannot make it
// report an older reading as if it were current.
//
// Two integers and nothing else, on the same provenance bound the notes
// themselves hold: the state file is user-writable, so no string out of it ever
// reaches stderr. No episode, or one whose age cannot be read, yields no
// sentence rather than a guessed one.
function episodeNote(cwd, decision) {
    if (!cwd) return '';
    const phrase = episodePhrase(projectGateEpisode(cwd, decision));
    return phrase === null ? '' : ' The gate has ' + phrase + ' in this deferral episode.';
}

if (require.main === module) {
    let decision = null;
    try { decision = main(); } catch { /* any escape allows, per the fail-open posture */ }
    if (!decision || typeof decision !== 'object') decision = { verdict: 'allow' };

    let note = null;
    if (decision.verdict === 'deny-boundary') {
        note = BOUNDARY_NOTE;
        if (decision.adoptFailed === true) note += ADOPT_FAILED_NOTE;
        try { note += episodeNote(decision.cwd, decision); } catch { /* the figures are best-effort */ }
    } else if (decision.verdict === 'deny-interactive') {
        note = INTERACTIVE_NOTE;
    }
    if (note) {
        try {
            process.stderr.write(note + '\n');
        } catch { /* the note is best-effort; the exit code is the verdict */ }
        process.exitCode = 2;
    } else {
        process.exitCode = 0;
    }

    // The landing sweep: every allow is a compaction landing for the
    // payload's session, whatever clause allowed it, and a marker that missed
    // its moment must not outlive it. A boundary or consent marker left live
    // through a valve, checkpoint or illegible landing would stay
    // honorable for up to its age bound, and if the same session crossed the
    // trigger again mid-chapter inside that window, the leftover would
    // convert the deny into an allow at exactly the placement the gate exists
    // to prevent. A manual /compact leaves that same leftover and this sweep
    // never reaches it: hooks.json wires PreCompact on the auto matcher alone,
    // so the gate does not run for one at all and the not-auto clause above is
    // defence against a rewiring rather than a live path. There the age bound
    // is the only retirement. So an allow retires any marker naming the landing session;
    // a peer's boundary marker is a file this sweep never opens for it, and the
    // session check kept beside each read answers for the consent file, which is
    // one per project, and for whatever else may stand at a path this session's
    // own id resolved. A marker naming another session is not this landing's to spend, and a
    // deny retires nothing, because nothing landed. Scoping needs both a
    // project and a string session id (the sweep, like the record below,
    // trusts the payload's cwd alone, and a coercible non-string id scopes
    // nothing). The whole pass runs after the exit code is set, inside its
    // own try, so it can change nothing but the marker files; one that
    // survives a failed pass is retired by its age bound or the next landing.
    if (decision.verdict === 'allow'
        && typeof decision.session === 'string' && decision.session !== ''
        && typeof decision.cwd === 'string' && decision.cwd !== '') {
        try {
            const boundary = readRoleBoundary(decision.cwd, decision.session);
            if (boundary && sameSessionId(boundary.session, decision.session)) {
                clearRoleBoundary(decision.cwd, decision.session);
            }
            const consent = readConsent(decision.cwd);
            if (consent && sameSessionId(consent.session, decision.session)) {
                clearConsent(decision.cwd);
            }
        } catch { /* best-effort on the same terms as the record below */ }
    }

    // The record comes last, once the note has been written and the exit code
    // set, so no failure of it can CHANGE either one; it runs inside its own
    // try for the same reason, and a decision naming no project (an unreadable
    // payload) is not recorded at all.
    //
    // Delaying is the part the ordering alone does not cover, for the note as
    // much as for the exit code. Setting process.exitCode emits nothing (the
    // harness reads the verdict only when this process exits), and the note is
    // queued rather than guaranteed written: Node's stdio is synchronous for
    // pipes on Windows and Linux but asynchronous for pipes on macOS and for
    // TTYs on Windows, so on those it drains at exit alongside the exit code.
    // What rules out a delay to either is that every path the record touches is
    // lstat-refused unless it is a regular file.
    if (typeof decision.cwd === 'string' && decision.cwd !== '') {
        try { recordGateDecision(decision.cwd, decision); } catch { /* diagnostic only */ }
    }
}
