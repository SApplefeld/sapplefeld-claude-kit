#!/usr/bin/env node
// The coordinator directory's time fields: the stamps a session's own write
// step reads from the clock, and the audit that reads the stamps already on
// disk against the comparators beside them.
//
// Subcommands:
//   kit-registry-stamp.js push [--takeover]
//                                         stamp this session's registry entry
//                                         `Status-updated:` with now, and
//                                         `Started:` too at a takeover
//   kit-registry-stamp.js now             print one moment read from the clock,
//                                         for a line whose only writer is a
//                                         session (a board line's evidence time)
//   kit-registry-stamp.js audit [--dir <coordinator directory>]
//                                         report the registry entries', the
//                                         claim file's and the board's stamps
//                                         against the comparators beside them
//
// `push` is the stamping helper the seat's own status push calls. The registry
// entry is single-writer under the role skill's directory contract, the
// registering session plus the two machine-stamped lines the seat-stop hook and
// the compaction checkpoint CLI own, so `Started:` and `Status-updated:` stay
// the session's fields and this verb changes who reads the clock rather than
// who writes the line: the session composes its `Remaining:` and `Status:`
// prose and runs this last, so the moments on the entry are an instrument's.
// Nothing else in the entry is touched.
//
// `now` is the same repair where there is no line to rewrite. A coordinator
// board line carries the time of its evidence inside its own prose, and only
// the coordinator writes that file, so nothing can stamp a field there; what a
// tool can do is supply the moment, which is the half a writer gets wrong.
//
// `audit` is the reading side. Four readings, each resting on a value the
// artifact's own writer did not supply:
//
//   1. A session-written registry stamp falling on a whole second. This is a
//      population reading and never a per-seat verdict: an honest clock read
//      lands on a whole second about once in a thousand, which is the harmless
//      direction to fail, while a hand-typed moment lands there almost every
//      time. So it says something about a directory of entries and nothing
//      about the seat that wrote any one of them.
//   2. A session-written registry stamp leading that entry's hook-stamped
//      `Heartbeat:` by more than the heartbeat throttle window. The heartbeat
//      is machine written, so the comparison needs no second clock and catches
//      the fabricated-forward stamp the round-second reading cannot see. The
//      window is the throttle itself, since a stop after a push restamps the
//      heartbeat unless the throttle refuses it, so an honest push sits at most
//      one throttle window ahead of the heartbeat once the session has stopped.
//      The hook stamps at a turn end and nowhere else, so a push made inside
//      a turn that has not ended yet legitimately leads the heartbeat from
//      the previous turn's end and reads here exactly as a fabricated stamp
//      does. That false positive is admitted rather than screened out, for
//      the arithmetic reason `stampsLeadingHeartbeat` states at its own
//      definition, which is why this reading produces a report and never a
//      verdict.
//   3. A claim file's `Started:` against the file's own modification time. The
//      claim is written once when the slot is taken and deleted at completion,
//      so its modification time is a record of the write that no writer of the
//      file's text supplied. One residual bounds it: the file sits in the
//      store's sync allowlist, so a checkout, a rebase or a fresh clone sets
//      that time to the sync moment, and on a store just synced an old claim
//      reads as freshly written and a stale `Started:` is reported that no
//      writer composed.
//   4. Any stamp, in an entry or in a board line, sitting ahead of the clock
//      past the skew the compaction checkpoint allows for one. The board takes
//      this reading alone: it carries no machine-written comparator for reading
//      2, its own modification time answers reading 3's question about the
//      claim rather than about a line, and its evidence times are legitimately
//      written at minute precision, so reading 1 over it would fire on honest
//      lines. Its stamps are found by their ISO shape inside the prose, the
//      board having no field grammar to read them out of.
//
// Every finding is a report and gates nothing. The audit writes nothing and
// reads entries through the same screen the mechanical stampers read them
// through. What it never does is confuse scanning nothing with finding nothing.
// The only scope it scans is one machine's directory under the coordinator
// root, judged on the real path rather than the spelling; anything else is
// refused and named, the root itself and a directory inside a machine's
// included, since neither holds artifacts of this shape and a clean reading of
// either would say the machine is clean when nothing about it was read. An
// unreadable artifact inside a scanned scope is itself a finding, a listing too
// large to read whole is reported as partial, and every run states what it
// scanned. It exits non-zero on any of those, so a caller reads the result from
// the exit code rather than from a grep over the text.

'use strict';

const fs = require('fs');
const path = require('path');

// The kit libraries, bound through a guard that splits the two ways this file
// is loaded. Run as a CLI, a require that throws would print Node's own trace,
// and every module path on a `Require stack:` is home-anchored on an installed
// plugin, while this tool's output is read by a model that was told to run it;
// so that leg names the failure, withholds the text and exits nonzero. Required
// as a MODULE, the throw rides on unchanged: the constants this file exports are
// derived from the libraries' at module scope just below, so a module that
// loaded with them unbound would answer undefined where it now fails loudly.
let readRegistryEntryText, stampRegistryFields,
    usableSessionId, CHECKPOINT_FUTURE_SKEW_MS,
    coordinatorRoot, coordinatorDir, field, sanitize,
    namesNetworkShare,
    containedRealPath, listBoundedNames, DIR_SCAN_MAX_ENTRIES,
    HEARTBEAT_THROTTLE_MS;
try {
    ({
        readRegistryEntryText, stampRegistryFields,
        usableSessionId, CHECKPOINT_FUTURE_SKEW_MS,
        coordinatorRoot, coordinatorDir,
        registryField: field, sanitizeForOutput: sanitize
    } = require('./kit-compact-lib.js'));
    ({ namesNetworkShare } = require('./kit-network-lib.js'));
    ({ containedRealPath, listBoundedNames, DIR_SCAN_MAX_ENTRIES } = require('./kit-read-lib.js'));
    ({ HEARTBEAT_THROTTLE_MS } = require('./seat-stop.js'));
} catch (err) {
    if (require.main !== module) throw err;
    // The error's CODE still rides, since a Node error code is an upper-case
    // identifier (MODULE_NOT_FOUND, ERR_DLOPEN_FAILED) that names the failure's
    // kind and can carry no path; anything else in that field is dropped.
    const code = err && typeof err.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.code)
        ? ' (' + err.code + ')' : '';
    // Written to the descriptor rather than through process.stderr: a write to a
    // pipe is asynchronous on win32, and process.exit below does not wait for
    // one, so the single sentence this leg exists to print is the one thing an
    // exit here can drop.
    //
    // The write itself can throw, a reader that closed the pipe being the
    // ordinary way (EPIPE), and a throw here would print the stack trace whose
    // absolute paths this leg exists to keep off the channel. So a descriptor
    // that will not take the sentence loses the sentence and nothing more.
    try {
        fs.writeSync(2, 'kit-registry-stamp: a kit library could not be loaded' + code
            + ', and the renderer that takes the OS account name out of an error is in it, so the'
            + ' message itself is withheld; nothing written\n');
    } catch {
        // The channel is gone; the exit code below is what is left to say it.
    }
    process.exit(1);
}

// The entry's session-written time fields, per the role skill's registry shape.
// `Heartbeat:` and `Banked:` are the machine-stamped lines that contract names,
// so they are this audit's comparators rather than its subjects.
const SESSION_TIME_FIELDS = ['Started', 'Status-updated'];

// Every ISO field an entry carries, for the reading that asks only whether a
// stamp sits ahead of the clock. A machine-written stamp is as capable of
// sitting in the future as a composed one where a machine's clock is wrong, and
// a reader that skipped them would be reading half the file.
const ENTRY_TIME_FIELDS = SESSION_TIME_FIELDS.concat(['Heartbeat', 'Banked']);

// How far a session-written stamp may lead the hook-stamped heartbeat before
// the audit reports it. The figure is the heartbeat throttle itself, imported
// from the hook that owns it rather than restated here, so the bound and the
// behaviour it describes cannot drift apart.
const HEARTBEAT_LEAD_MS = HEARTBEAT_THROTTLE_MS;

// How far a claim's `Started:` may sit from the file's own modification time
// before the audit reports it. A claim is written in one act, so the honest gap
// is seconds; this leaves room for a slow write and for a filesystem timestamp
// resolution coarser than the stamp's.
const CLAIM_SKEW_MS = 5 * 60 * 1000;

// How far ahead of the clock a stamp may sit before it is read as ahead of it.
// The figure is the compaction checkpoint's own future-skew allowance, imported
// rather than restated: the machines writing these files run their own clocks,
// a peer can push while a scan is running, and a zero allowance turns either
// into a finding on a healthy directory.
const FUTURE_SKEW_MS = CHECKPOINT_FUTURE_SKEW_MS;

// How much of a board this reads. The shared screen's default bound is the
// registry entry's, a handful of short lines, and a live board runs to tens of
// thousands of bytes, so the board's own bound is passed rather than the entry's
// inherited: the default would refuse a healthy board and the scan would report
// an unreadable file on every run.
const BOARD_MAX_BYTES = 4 * 1024 * 1024;

// How many findings a run prints. The board is prose any local session and any
// machine the store syncs can write, and one finding is produced per stamp in
// it, so the count is bounded by that file rather than by anything here. The
// exit code carries the reading whatever the cap does, and a run that prints
// this many has said what it needed to; the line past the cap says how many
// were withheld, so the coverage is still read from the report.
const FINDING_PRINT_CAP = 200;

// A stamp inside prose, by its ISO shape. The board carries its evidence times
// in sentences rather than in fields, at minute or second precision, so this is
// what stands in for a field read there.
const ISO_IN_PROSE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;

// A field's value as milliseconds, or null where the field is absent, empty or
// unparseable. Nothing here reads an unparseable stamp as anything: the audit
// reports what it cannot read rather than guessing at which side of a bound it
// would have fallen.
function stampMs(text, name) {
    const value = field(text, name);
    if (typeof value !== 'string' || value === '') return null;
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
}

// Whole minutes for a report an operator reads, rounded up rather than to
// nearest. Every caller reports a gap that has already passed a bound stated in
// the same sentence, so rounding down produces a line that contradicts itself,
// a gap of ten and a half minutes reading as ten minutes past a ten-minute
// window. Rounding up keeps the figure and the bound consistent.
function minutes(ms) {
    return Math.ceil(ms / (60 * 1000));
}

// A file-derived value as it appears in a report: the shared output guard at a
// short cap, taken here at the interpolation site rather than at the printer,
// because a value out of a file any local session can write is otherwise long
// enough to push the module's own prose past the printer's cap and out of the
// line. The guard rather than a local filter is what puts the home elision
// ahead of the cut, which is the ordering that guard exists for: a cap applied
// first leaves the account name at the head of whatever survives it.
function shortValue(v) {
    return sanitize(v === null || v === undefined ? '' : v, 40);
}

// Session-written stamps that fall on a whole second. Reading 1 above. The test
// is on the parsed moment rather than on the literal's spelling, so a stamp
// written with an explicit `.000` reads the same as one written without any
// fractional part at all: what the reading is about is the value, and a
// composed moment is round however it is typed.
function roundSecondStamps(text) {
    const out = [];
    for (const name of SESSION_TIME_FIELDS) {
        const at = stampMs(text, name);
        if (at === null || at % 1000 !== 0) continue;
        out.push({
            kind: 'round-second',
            field: name,
            value: field(text, name),
            what: 'the ' + name + ' stamp falls on a whole second (' + shortValue(field(text, name))
                + '), which a clock read almost never does'
        });
    }
    return out;
}

// Session-written stamps leading the hook-stamped heartbeat by more than
// leadMs. Reading 2 above. An entry with no readable heartbeat has no
// comparator, so it yields no finding in either direction: the takeover writes
// `none` there and an install without the stamping hook never advances it, and
// reading either state as a finding would report every such entry forever.
//
// One false positive is admitted rather than screened out, and naming it is
// what keeps the reading honest: the hook stamps at a turn end and nowhere
// else, so a seat that pushed twenty-five minutes into a turn that has not
// ended yet legitimately leads the heartbeat from the previous turn's end and
// reads here exactly as a fabricated stamp does. Nothing in the entry tells the
// two apart once both moments are in the past, which is why this instrument
// produces a report and never a verdict. Screening the case out by requiring a
// recent heartbeat was tried and is wrong in the arithmetic: a finding needs
// the session stamp to lead the heartbeat by more than leadMs, so demanding a
// heartbeat within leadMs of now forces that stamp past now and leaves this
// instrument a worse duplicate of the future-stamp scan, silent on exactly the
// after-the-fact fabrication it exists to catch.
function stampsLeadingHeartbeat(text, leadMs) {
    const heartbeat = stampMs(text, 'Heartbeat');
    if (heartbeat === null) return [];
    const out = [];
    for (const name of SESSION_TIME_FIELDS) {
        const at = stampMs(text, name);
        if (at === null || at - heartbeat <= leadMs) continue;
        out.push({
            kind: 'ahead-of-heartbeat',
            field: name,
            value: field(text, name),
            what: 'the ' + name + ' stamp leads the machine-written Heartbeat by '
                + minutes(at - heartbeat) + ' minutes, past the ' + minutes(leadMs)
                + '-minute window an honest push can lead it by'
        });
    }
    return out;
}

// Every stamp an entry carries that sits ahead of nowMs past the skew. Reading
// 4 above, and the read-protocol self-check a board or ledger read performs.
function futureStamps(text, nowMs, skewMs) {
    const skew = skewMs === undefined ? FUTURE_SKEW_MS : skewMs;
    const out = [];
    for (const name of ENTRY_TIME_FIELDS) {
        const at = stampMs(text, name);
        if (at === null || at - nowMs <= skew) continue;
        out.push({
            kind: 'future',
            field: name,
            value: field(text, name),
            what: 'the ' + name + ' stamp sits ' + minutes(at - nowMs) + ' minutes ahead of the clock'
        });
    }
    return out;
}

// The same reading over prose. A board line's stamp has no field name, so the
// finding names the value itself, which is what a seat searches the board for.
function futureStampsInProse(text, nowMs, skewMs) {
    const skew = skewMs === undefined ? FUTURE_SKEW_MS : skewMs;
    const out = [];
    for (const match of String(text).match(ISO_IN_PROSE) || []) {
        const at = Date.parse(match);
        if (!Number.isFinite(at) || at - nowMs <= skew) continue;
        out.push({
            kind: 'future',
            field: null,
            value: match,
            what: 'a stamp reading ' + shortValue(match) + ' sits ' + minutes(at - nowMs)
                + ' minutes ahead of the clock'
        });
    }
    return out;
}

// A claim file's `Started:` against the file's own modification time. Reading 3
// above, in both directions: a `Started:` behind the write by more than the
// skew is a moment resolved before the write, and one ahead of it is a moment
// that had not arrived when the file was written. A `Started:` that cannot be
// read at all is reported as that rather than read as either side of the bound.
function claimStampFindings(text, mtimeMs) {
    const value = field(text, 'Started');
    const at = stampMs(text, 'Started');
    if (at === null) {
        return [{
            kind: 'claim-started-unreadable',
            field: 'Started',
            value,
            what: 'the claim carries no readable Started, so nothing in it can be read against the'
                + ' moment the file was written'
        }];
    }
    if (mtimeMs - at > CLAIM_SKEW_MS) {
        return [{
            kind: 'claim-started-behind-write',
            field: 'Started',
            value,
            what: 'Started names a moment ' + minutes(mtimeMs - at)
                + ' minutes before the claim file itself was written, which is either a composed'
                + ' value or a modification time a store sync reset'
        }];
    }
    if (at - mtimeMs > CLAIM_SKEW_MS) {
        return [{
            kind: 'claim-started-after-write',
            field: 'Started',
            value,
            what: 'Started names a moment ' + minutes(at - mtimeMs)
                + ' minutes after the claim file itself was written'
        }];
    }
    return [];
}

// Every finding one registry entry carries.
function auditEntry(text, nowMs) {
    return roundSecondStamps(text)
        .concat(stampsLeadingHeartbeat(text, HEARTBEAT_LEAD_MS))
        .concat(futureStamps(text, nowMs));
}

// ---------------------------------------------------------------------------
// The stamp.
// ---------------------------------------------------------------------------

// Rewrite this session's own entry's session-written time fields with now,
// through the shared stamping channel in kit-compact-lib.js: the path, the read
// screen, the entry's own corroboration, the clock read and the atomic write
// all live there, shared with the boundary verb's `Banked:` stamp, so this
// caller supplies the field list and nothing else. What that corroboration
// does and does not establish is stated there rather than restated here.
//
// A takeover stamps `Started:` beside it, that field being written exactly once
// per registration and by the same session; every later push stamps
// `Status-updated:` alone, since a rewritten `Started:` would name the moment
// of the push rather than of the takeover.
function stampRegistryStatus(sessionId, takeover) {
    return stampRegistryFields(sessionId,
        takeover ? ['Started', 'Status-updated'] : ['Status-updated']);
}

// ---------------------------------------------------------------------------
// The audit's own reads.
// ---------------------------------------------------------------------------

// A scope's real path where it is one machine's directory under the coordinator
// root, and null otherwise. Two screens, and each catches what the other cannot.
//
// Containment is judged on the real path through the shared link-resolving
// screen rather than on the spelling, because a lexical test reads a link's own
// name and never where it goes, so a link planted under the root would carry
// the scan wherever it points. One residual is left standing rather than
// claimed away: resolving a link is itself a touch, so a junction aimed at an
// unreachable share still costs this the connection's timeout at the resolve.
// What the screen buys is that the scan does not then proceed there, which is
// the reach the lexical test did not have.
//
// Depth is the second screen and it is what stops the audit reporting on a
// scope nobody asked about. The root holds one directory per machine and the
// artifacts sit inside those, so a machine directory is exactly one component
// below the root: the root itself and `<root>/<machine>/registry` both contain
// no `registry/`, no claim file and no board of their own, and a scan of either
// finds nothing because there is nothing of this shape there, not because the
// machine is clean. Requiring the depth refuses both, while a machine directory
// that genuinely holds nothing yet still scans and still reports honestly.
//
// Absence is kept apart from both screens and answers in its own words. A
// mistyped machine name resolves to a path this would have scanned, and calling
// that out of scope sends the caller hunting the wrong mistake; the two are the
// same silence and different repairs. The order is what makes the extra answer
// safe: the lexical depth screen runs first and touches nothing, so only a path
// already inside the root is ever stat'd, and no value outside it learns from
// this whether it exists.
// One spelling of the containment refusal, because every branch below reaches
// it for the same reason and a caller reading the reason should not be able to
// tell which branch caught the value: the answer is the same either way.
const SCOPE_REFUSAL = '--dir is not one machine\'s directory under the store\'s coordinator directory,'
    + ' which is the only scope this scans';

function machineDirScope(raw) {
    const root = coordinatorRoot();
    const lexRel = path.relative(path.resolve(root), raw);
    if (lexRel === '' || lexRel === '..' || lexRel.startsWith('..' + path.sep)
        || lexRel.includes('/') || lexRel.includes('\\')) {
        return { dir: null, reason: SCOPE_REFUSAL };
    }
    if (presence(raw) === 'absent') {
        return {
            dir: null,
            reason: '--dir names no directory under the store\'s coordinator directory,'
                + ' so there was nothing to scan'
        };
    }
    const real = containedRealPath(root, raw);
    if (real === null) return { dir: null, reason: SCOPE_REFUSAL };
    let realRoot;
    try { realRoot = fs.realpathSync(root); } catch { return { dir: null, reason: SCOPE_REFUSAL }; }
    const rel = path.relative(realRoot, real);
    if (rel === '' || rel === '..') return { dir: null, reason: SCOPE_REFUSAL };
    if (rel.includes('/') || rel.includes('\\')) return { dir: null, reason: SCOPE_REFUSAL };
    return { dir: real, reason: null };
}

// The directory a run scans, as { dir, reason }. A null dir refuses the run
// with that reason rather than scanning something else, because every refusal
// here is a scope the caller did not mean and a scan of it would report a clean
// directory that is not the one asked about.
//
// The network-shaped refusal is the shared guard from kit-network-lib.js rather
// than a second copy of it, and it is applied to the value as given and to the
// resolved path both: the touch is itself the harm, a share path making this
// machine authenticate outbound to a host of the caller's choosing and blocking
// for the connection's own timeout while it does. Containment under the
// coordinator root is the second screen, since this tool exists to read one
// directory's artifacts and a path outside it is a value nothing here vouches
// for.
function resolveScope(raw) {
    if (raw === null) return { dir: coordinatorDir(), reason: null };
    if (typeof raw !== 'string' || raw.trim() === '') {
        return { dir: null, reason: '--dir needs a directory, and an empty value would scan whatever the shell stands in' };
    }
    if (namesNetworkShare(raw)) {
        return { dir: null, reason: '--dir names a network share, which this reads nothing from' };
    }
    const resolved = path.resolve(raw);
    if (namesNetworkShare(resolved)) {
        return { dir: null, reason: '--dir resolves to a network share, which this reads nothing from' };
    }
    return machineDirScope(resolved);
}

// Whether a path is there to be read: 'present', 'absent', or 'unreadable'.
// The three are kept apart everywhere below, because a scan that cannot tell
// them apart reports a directory it never opened as a directory with nothing
// in it, which is the one failure an instrument like this must not have.
function presence(full) {
    try {
        fs.lstatSync(full);
        return 'present';
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 'absent' : 'unreadable';
    }
}

// The `.md` names under a directory, as { names, reason, bounded }. A null
// names refuses the read; an absent directory answers an empty list with
// 'absent', which is an ordinary state for a machine on which no seat has
// registered; `bounded` says the listing was cut, so a partial read is reported
// as partial rather than as the whole directory.
//
// The listing goes through the shared capped lister rather than readdirSync,
// which materializes a whole directory before the first name can be judged: any
// local session and any machine the store syncs can write here, so the number
// of entries is not this reader's to assume.
function mdNames(dir, root) {
    if (presence(dir) === 'absent') return { names: [], reason: 'absent', bounded: false };
    // The containment screen is taken again here and not only at the scope,
    // because the two readings above disagree about links by construction:
    // `presence` is an lstat, so a symlink at this path reads present, while the
    // lister below opens through it. Any local session and any machine the store
    // syncs can write into the directory this path sits in, so a link planted
    // here would otherwise list and read `.md` files at the far end of it, which
    // are exactly the files the scope screen exists to keep out of range.
    if (containedRealPath(root, dir) === null) {
        return { names: null, reason: 'uncontained', bounded: false };
    }
    const listed = listBoundedNames(dir, DIR_SCAN_MAX_ENTRIES,
        (entry) => entry.isFile() && entry.name.endsWith('.md'));
    if (listed.bounded && listed.names.length === 0) {
        return { names: null, reason: 'unreadable', bounded: true };
    }
    return { names: listed.names.slice().sort(), reason: null, bounded: listed.bounded };
}

function findingLine(subject, finding) {
    return '  ' + sanitize(subject) + ': ' + sanitize(finding.what, 300);
}

// Every finding under one coordinator directory, as { findings, scanned }.
// `scanned` carries what each artifact was, so a run always says what it read
// rather than leaving a caller to infer coverage from silence.
//
// Entries are read through the shared screen the mechanical stampers read them
// through, the claim file and the board included: that screen is a property of
// the channel rather than of whichever writer needed it first, and these are
// the directory's widest-writer forms.
function auditDir(dir, nowMs) {
    const findings = [];
    const scanned = { entries: 0, registry: null, claim: null, board: null };

    const registryDir = path.join(dir, 'registry');
    const listed = mdNames(registryDir, dir);
    if (listed.names === null) {
        scanned.registry = 'unreadable';
        findings.push({
            subject: 'registry/',
            finding: {
                kind: 'unread',
                what: listed.reason === 'uncontained'
                    ? 'the registry directory resolves outside the machine directory that holds it,'
                        + ' so it is refused rather than listed'
                    : 'the registry directory is present and could not be listed'
            }
        });
    } else {
        scanned.registry = listed.reason === 'absent' ? 'absent' : 'read';
        if (listed.bounded) {
            findings.push({
                subject: 'registry/',
                finding: {
                    kind: 'unread',
                    what: 'the registry directory holds more entries than one scan reads, so what'
                        + ' follows covers part of it and the rest is unread'
                }
            });
        }
        for (const name of listed.names) {
            const read = readRegistryEntryText(path.join(registryDir, name));
            if (read.text === null) {
                findings.push({ subject: 'registry/' + name, finding: { kind: 'unread', what: read.reason } });
                continue;
            }
            scanned.entries += 1;
            for (const finding of auditEntry(read.text, nowMs)) {
                findings.push({ subject: 'registry/' + name, finding });
            }
        }
    }

    const claimPath = path.join(dir, 'claims', 'heavy-process.md');
    const claimThere = presence(claimPath);
    scanned.claim = claimThere === 'present' ? 'read' : claimThere;
    if (claimThere === 'unreadable') {
        findings.push({
            subject: 'claims/heavy-process.md',
            finding: { kind: 'unread', what: 'the claim file is present and could not be read' }
        });
    } else if (claimThere === 'present') {
        const read = readRegistryEntryText(claimPath);
        let mtimeMs = null;
        try { mtimeMs = fs.statSync(claimPath).mtimeMs; } catch { mtimeMs = null; }
        if (read.text === null || mtimeMs === null) {
            // A claim is deleted at completion, which is the file's ordinary
            // end rather than a fault, so a read that failed is asked once more
            // whether the file is still there. A claim that finished between
            // the presence check above and this read is reported as the absence
            // it now is; only a file still present and still unreadable is a
            // finding, which keeps a healthy directory off the exit code.
            if (presence(claimPath) === 'absent') {
                scanned.claim = 'absent';
            } else {
                scanned.claim = 'unreadable';
                findings.push({
                    subject: 'claims/heavy-process.md',
                    finding: {
                        kind: 'unread',
                        what: read.text === null ? read.reason : 'the claim file has no readable modification time'
                    }
                });
            }
        } else {
            const claimFindings = claimStampFindings(read.text, mtimeMs);
            for (const finding of claimFindings) {
                findings.push({ subject: 'claims/heavy-process.md', finding });
            }
            // One defect earns one finding. A `Started:` naming a moment after
            // the write is already reported against the file's own modification
            // time, which is the sharper comparator of the two, so the clock
            // reading is not also run over that same field.
            const alreadyReported = claimFindings.some((f) => f.field === 'Started');
            for (const finding of futureStamps(read.text, nowMs)) {
                if (alreadyReported && finding.field === 'Started') continue;
                findings.push({ subject: 'claims/heavy-process.md', finding });
            }
        }
    }

    const boardPath = path.join(dir, 'board.md');
    const boardThere = presence(boardPath);
    scanned.board = boardThere === 'present' ? 'read' : boardThere;
    if (boardThere === 'unreadable') {
        findings.push({
            subject: 'board.md',
            finding: { kind: 'unread', what: 'the board is present and could not be read' }
        });
    } else if (boardThere === 'present') {
        const read = readRegistryEntryText(boardPath, BOARD_MAX_BYTES);
        if (read.text === null) {
            scanned.board = 'unreadable';
            findings.push({ subject: 'board.md', finding: { kind: 'unread', what: read.reason } });
        } else {
            // Coverage on the board is the count of stamps this recognized, not
            // the fact that the file opened. The board has no field grammar, so
            // its stamps are found by their ISO shape, and a board writing its
            // moments in any other spelling yields nothing to read: reporting
            // that as a read board would be the same confusion of scanning
            // nothing with finding nothing that the scope screen exists to stop.
            const boardStamps = (String(read.text).match(ISO_IN_PROSE) || []).length;
            scanned.board = boardStamps + (boardStamps === 1 ? ' stamp read' : ' stamps read');
            for (const finding of futureStampsInProse(read.text, nowMs)) {
                findings.push({ subject: 'board.md', finding });
            }
        }
    }

    return { findings, scanned };
}

// ---------------------------------------------------------------------------
// The CLI.
// ---------------------------------------------------------------------------

function usage() {
    process.stderr.write('usage: kit-registry-stamp.js push [--takeover] | now'
        + ' | audit [--dir <coordinator directory>]\n');
    process.exitCode = 1;
}

// The calling session's own id, from the environment the harness sets for a
// session's tool shell, or null when nothing usable is there. Where no id is
// derivable the stamp refuses rather than writing into a file it cannot place,
// which is the sibling CLI's own degradation.
function callerSessionId() {
    return usableSessionId(process.env.CLAUDE_CODE_SESSION_ID);
}

function cmdPush(rest) {
    const takeover = rest.length === 1 && rest[0] === '--takeover';
    if (rest.length !== 0 && !takeover) {
        process.stderr.write('usage: kit-registry-stamp.js push [--takeover] (no other arguments:'
            + ' the stamp is the calling session\'s own entry)\n');
        process.exitCode = 1;
        return;
    }
    const session = callerSessionId();
    if (session === null) {
        process.stderr.write('kit-registry-stamp: no usable session id in this shell'
            + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped), so the entry to stamp cannot be'
            + ' established; nothing written\n');
        process.exitCode = 1;
        return;
    }
    const result = stampRegistryStatus(session, takeover);
    if (!result.stamped) {
        process.stderr.write('kit-registry-stamp: ' + sanitize(result.reason) + '; nothing written\n');
        process.exitCode = 1;
        return;
    }
    // File-derived values print indented, never at column zero, keeping them
    // visually subordinate in a channel a model reads.
    process.stdout.write('  registry ' + (takeover ? 'Started and Status-updated' : 'Status-updated')
        + ' stamped ' + sanitize(result.at) + '\n');
    process.exitCode = 0;
}

function cmdNow(rest) {
    if (rest.length !== 0) {
        process.stderr.write('usage: kit-registry-stamp.js now (no arguments)\n');
        process.exitCode = 1;
        return;
    }
    process.stdout.write(new Date().toISOString() + '\n');
    process.exitCode = 0;
}

// What the run covered, printed on every run whatever it found, so coverage is
// read from the report rather than inferred from the absence of findings.
function scannedPhrase(scanned) {
    const parts = [scanned.entries + (scanned.entries === 1 ? ' registry entry' : ' registry entries')];
    if (scanned.registry !== 'read') parts.push('the registry directory ' + scanned.registry);
    parts.push('the claim file ' + scanned.claim);
    // The board reports the count it recognized rather than that it opened, so
    // the two shapes read differently here on purpose.
    parts.push(typeof scanned.board === 'string' && /^\d+ stamps? read$/.test(scanned.board)
        ? 'the board with ' + scanned.board
        : 'the board ' + scanned.board);
    return parts.join(', ');
}

function cmdAudit(rest) {
    let raw = null;
    if (rest.length === 2 && rest[0] === '--dir') {
        raw = rest[1];
    } else if (rest.length !== 0) {
        process.stderr.write('usage: kit-registry-stamp.js audit [--dir <coordinator directory>]'
            + ' (one flag, with one value)\n');
        process.exitCode = 1;
        return;
    }
    const scope = resolveScope(raw);
    if (scope.dir === null) {
        process.stderr.write('kit-registry-stamp: ' + sanitize(scope.reason) + '; nothing scanned\n');
        process.exitCode = 1;
        return;
    }
    const there = presence(scope.dir);
    if (there !== 'present') {
        process.stderr.write('kit-registry-stamp: the coordinator directory to scan is ' + there
            + ', so nothing was scanned and no reading of it is available\n');
        process.exitCode = 1;
        return;
    }
    let isDir = false;
    try { isDir = fs.statSync(scope.dir).isDirectory(); } catch { isDir = false; }
    if (!isDir) {
        process.stderr.write('kit-registry-stamp: the path to scan is not a directory,'
            + ' so nothing was scanned\n');
        process.exitCode = 1;
        return;
    }

    const { findings, scanned } = auditDir(scope.dir, Date.now());
    process.stdout.write('scanned ' + scannedPhrase(scanned) + '\n');
    if (findings.length === 0) {
        process.stdout.write('no stamp findings in what was scanned\n');
        process.exitCode = 0;
        return;
    }
    process.stdout.write('stamp findings:\n');
    for (const { subject, finding } of findings.slice(0, FINDING_PRINT_CAP)) {
        process.stdout.write(findingLine(subject, finding) + '\n');
    }
    if (findings.length > FINDING_PRINT_CAP) {
        process.stdout.write('and ' + (findings.length - FINDING_PRINT_CAP)
            + ' further findings, not printed\n');
    }
    // The round-second reading is about the population rather than about any
    // one seat, so the report says so where it has produced one: a single such
    // finding among honest stamps is the coincidence the reading prices in.
    if (findings.some((f) => f.finding.kind === 'round-second')) {
        process.stdout.write('a whole-second stamp is a population reading, not a verdict on one entry:'
            + ' an honest clock read lands on one about once in a thousand\n');
    }
    process.exitCode = 1;
}

function main() {
    const [cmd] = process.argv.slice(2);
    if (cmd === 'push') cmdPush(process.argv.slice(3));
    else if (cmd === 'now') cmdNow(process.argv.slice(3));
    else if (cmd === 'audit') cmdAudit(process.argv.slice(3));
    else usage();
}

// Run as a CLI only when invoked directly, so a require() of this file answers
// with the exports and performs nothing: test/registry-stamp.test.js reads the
// audit predicates that way.
if (require.main === module) {
    try {
        main();
    } catch (err) {
        // An unguarded throw prints a stack trace, and a stack trace carries
        // absolute paths, which is the account name this module elides from
        // every line it composes deliberately. The catch keeps the one channel
        // that bypasses those lines held to the same guard. It writes to the
        // descriptor for the reason the load-failure leg above does: a write to
        // a pipe is asynchronous on win32 and the exit below does not wait for
        // one, so this line is what an exit here would drop. And it is guarded
        // for that same reason: a descriptor that refuses the write (a reader
        // that closed the pipe, EPIPE) would otherwise throw out of the catch
        // that exists to keep a stack trace off this channel, printing the one
        // thing it was written to prevent.
        try {
            fs.writeSync(2, 'kit-registry-stamp: '
                + sanitize(err && err.message ? err.message : 'the run failed')
                + '; nothing written\n');
        } catch {
            // The channel is gone; the exit code below is what is left to say it.
        }
        process.exit(1);
    }
}

module.exports = {
    SESSION_TIME_FIELDS, ENTRY_TIME_FIELDS,
    HEARTBEAT_LEAD_MS, CLAIM_SKEW_MS, FUTURE_SKEW_MS,
    field, stampMs,
    roundSecondStamps, stampsLeadingHeartbeat, futureStamps, futureStampsInProse,
    claimStampFindings, auditEntry, auditDir,
    coordinatorRoot, coordinatorDir, machineDirScope, resolveScope, stampRegistryStatus,
    FINDING_PRINT_CAP
};
