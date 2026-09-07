#!/usr/bin/env node
// PreToolUse guard: check a memory record's frontmatter at the write, and keep
// the write tools off the two shared tiers.
//
// The project memory tier is authored with Write/Edit/MultiEdit, so its
// frontmatter passes through none of the refusals memq's own verbs apply: a
// hand-written `supersedes:` naming a record that does not exist, a `tags:`
// list in the YAML form memq reads as no tags at all, an indented `pinned:`
// that pins nothing, a malformed date, an `anchors:` or `triggers:` entry
// outside the grammar,
// and a frontmatter fence that does not close inside the line bound memq reads
// a block within, or that never starts on line 1, all land
// with nothing said. This is the write-door check for those, and it is the only
// surface that sees a record before it exists. The two shared tiers
// (memory-types/, memory-operator/) are CLI-authored by the rule the
// memory-system skill already states, so the three write tools this guard is
// wired in front of (Write, Edit, MultiEdit in hooks.json) are refused there
// whoever is writing: the rule is "never the Write tool", not "not by
// subagents".
//
// Every judgment about where a record's fields may sit is memq's own. The tier
// directories, what may be a memory filename, the frontmatter block grammar,
// which line a field is read off (the top level, or the harness's `metadata:`
// map, and nowhere else), the pointer grammar, the anchor path grammar, the
// anchor root and the recognition-trigger grammar all come from
// scripts/memq.js through its exports, so this guard
// and the readers it guards for cannot come to disagree about what a record
// says. Three rules are spelled here because memq decides none of them: the
// house date form a `pinned:` or `created:` value takes, the `- ` item that
// follows a `tags:` key carrying no inline value, and the position of the
// opening fence. Which named tier a placed directory is (tierOf below) is
// memq's own answer too, memq.tierNameFor, rather than a local re-spelling of
// the three tier shapes.
//
// SAFETY: this hook can BLOCK a tool call, so it fails OPEN. Any parse error,
// unreadable file, unresolvable root, target it cannot place, or payload shape
// it does not recognize exits 0 (allow), and so does any throw, through the
// catch around main(). It exits 2 (deny) only for defects of two kinds. The
// first is certain in the sense the store can state: the named record is
// absent, memq reads the field as nothing, or the placement is one memq will
// not read. The second is refused on this guard's own account, and it has
// three members: a supersedes: pointer whose target name parses and still
// cannot do its job (the record's own name, a target held only under a
// variant casing or a variant extension case, a target held only under
// archive/); a pinned: or created: value memq parses fine that is not the
// YYYY-MM-DD form this store writes; and an anchors: entry whose path leaves
// the project root, which memq's own anchorEntryState answers `unreadable`
// for rather than refusing, so the refusal is this guard's.
//
// Three answers, and each travels on the channel its reader is on. A deny
// exits 2 and writes one line to stderr, which is what the harness delivers
// to the model as its reason for blocking the call. A record that was checked
// and is clean exits 0 and writes nothing on either channel. A target this
// guard placed inside the store and then could not check exits 0 like the
// clean one and says so on stdout, as the hookSpecificOutput JSON that is the
// one exit-0 channel the model receives (exit-0 stderr reaches no reader), in
// a line that names the tier and the cause and states plainly that the write
// is going ahead unchecked, so the two allows are never one answer. That line
// is written only for a target already placed inside the store: a target out
// of scope, unplaceable, or not a memory file gets nothing at all, because a
// hook that spoke on every `.md` write on the machine would be noise rather
// than a signal.
//
// Both channels are fenced at the streams for the life of the process (see
// silenceOthers below), so the deny line is the only text this guard puts
// through stderr and the not-checked object the only text it puts through
// stdout. memq writes a note to stderr of its own when it is asked to honor a
// store-root override that is not gated, which is a fact about the session's
// configuration rather than about this write; and any byte on stdout from
// anything loaded here would leave the not-checked object unparseable to a
// harness that reads that channel as JSON. Both lines this guard does write
// go out through fs.writeSync on the descriptors, under the fence rather than
// over it. The fence covers process.stdout.write and process.stderr.write; a
// dependency writing to a descriptor directly, as those two lines do, would
// pass it, and nothing loaded here does.
//
// Residuals, stated rather than implied:
//   - Scope follows memq's own store resolution, so under a KIT_MEMORY_ROOT
//     override that memq honors, the machine's real tiers are out of scope and
//     the redirected ones are in it. The claim this guard makes is "the shared
//     tiers of the store this session resolves", not "every shared tier on the
//     machine".
//   - The run-scoped pending tier (pending/<run id>/ under a project's memory
//     directory) is not a tier directory to memq's own tierDirFor, so a record
//     written there is out of scope and unvalidated.
//   - MEMORY.md, decay-stamp and the sidecars are out of scope on every tier,
//     the shared ones included, because isMemoryFilename is memq's boundary for
//     what a record is and re-deciding it here would be a second grammar.
//   - A shell write (a redirection in Bash or PowerShell) never passes this
//     guard, whose matcher names the three file-writing tools; the skill's
//     CLI-authored rule is what governs a shell's hand on the shared tiers.
//   - A target is placed lexically, with the extended-length (\\?\) and
//     device (\\.\) prefixes folded off in either separator spelling, an
//     admin-share UNC spelling naming this machine rewritten to its drive
//     form, and every component's win32 spellings folded to the base name (a
//     colon suffix on the basename names an alternate data stream of the
//     base file, and a trailing dot or space comes off every segment, the
//     one spelling under which such a write reaches the tier). The directory's real
//     path is tried as a second candidate only for a target whose lexical
//     path already sits under the store root and is not UNC- or
//     device-rooted, which is what resolves an 8.3 short name or a link in
//     the directory chain inside the store while asking nothing of any other
//     write on the machine: resolving a network path on win32 is an outbound
//     SMB connection made before the user's permission prompt, and a mapped
//     drive letter is that connection behind a spelling no lexical screen
//     catches. A UNC spelling of the store by a non-admin share name is
//     therefore not placed, and neither is a spelling through a mapped or
//     subst drive letter, or a short name of the store root itself.
//   - That last claim is scoped to a store root on a local drive. memq's
//     memoryRoot() is os.homedir() plus .claude absent an honored override, so
//     where the profile is redirected onto a mapped drive letter the store
//     root itself sits on a network-backed volume: underStoreRoot answers
//     true for targets there, memq.namesNetworkShare does not fire on a
//     drive-letter spelling (it answers only the UNC and //server forms), and
//     the resolver runs on that volume. This guard is one of four callers
//     that single-source that predicate in scripts/memq.js; nothing here
//     re-spells the question, and widening it to a drive-letter spelling is
//     not this guard's to decide.
//   - An admin-share UNC host is folded only when it matches one of the five
//     spellings isLocalHost compares against (localhost, 127.0.0.1, ::1, .,
//     and whatever os.hostname() reports). Any other spelling of this same
//     machine is not among them, a fully qualified name and a DNS alias
//     included, so a shared-tier write spelled
//     \\box.corp.example\C$\...\memory-operator\rec.md places nothing and is
//     allowed with no line at all: the cost of an unrecognized local spelling
//     is paid in the clean answer's silence, on the one tier where clean is
//     never the right answer. Widening the list would mean resolving a name,
//     which is the outbound connection the paragraph above refuses.
//   - A path component of only dots and spaces (`. `, `...`) folds to nothing,
//     and a target carrying one is not placed. Such a write reaches no tier:
//     measured on win32 with a `. ` component, a plain write to it fails
//     ENOENT, and a write through a recursive create lands a literal `. `
//     directory that fs.realpathSync.native reports back verbatim, with
//     nothing arriving in the sibling tier directory. Placing it as though the
//     component were elided would refuse a write that never touches the store.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MEMQ = path.join(__dirname, '..', 'scripts', 'memq.js');

// The fields memq reads out of a memory record's frontmatter, all of them: the
// placement rule below is asked of these and nothing else, so a key the store
// does not read cannot be refused for where it sits.
const MEMQ_FIELDS = ['pinned', 'supersedes', 'anchors', 'triggers', 'tags', 'created', 'machine'];

// The memq exports whose absence this guard tells apart from an answer, each
// with the typeof its caller here needs. They are the ones newer than
// isMemoryFilename, which is what a plugin cache one version behind can supply
// while lacking these: a symbol older than that cannot be missing from a memq
// this guard was able to require at all. The gate in main() reads this list.
const MEMQ_SYMBOLS = [
    ['tierDirFor', 'function'],
    ['tierNameFor', 'function'],
    ['namesNetworkShare', 'function'],
    ['frontmatterTriggers', 'function'],
    ['parseTriggers', 'function'],
    ['TRIGGER_TYPES', 'object'],
    ['TRIGGER_FRAGMENT_TYPES', 'object'],
    ['TRIGGER_PATTERN_MIN', 'number'],
    ['TRIGGER_ENTRY_CAP', 'number']
];

// Whether a value is the date form this store writes: YYYY-MM-DD naming a day
// the calendar holds. It is this guard's own rule rather than something memq
// decides: memq never parses a `pinned:` value at all, and reads a `created:`
// value through Date.parse, which takes far more than this.
//
// The calendar half is what keeps one house rule from giving two answers about
// one value. Shape alone admits 2026-13-45 and 2026-02-30, and the two fields
// this rule is asked of then diverge on them: Date.parse refuses the first, so
// the created: path denies it while a pinned: carrying it lands in the
// checked-and-clean silence, and Date.parse rolls the second over into March,
// so both fields admit a day that does not exist. With the calendar asked here,
// every impossible day is refused at both fields.
function isHouseDate(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (parts === null) return false;
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    // Date.UTC reads a year under 100 as 1900 + it, so the year is compared
    // back rather than trusted: that is what refuses 0000-01-01 here instead
    // of reading it as 1900-01-01 and admitting it.
    const at = new Date(Date.UTC(year, month - 1, day));
    return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1
        && at.getUTCDate() === day;
}

// Characters of store text (a name a record points at, a date it declares)
// quoted back on a line, past which it is cut and the cut is marked.
const QUOTE_CAP = 120;

// Bytes of a record this guard judges, measured as UTF-8 (utf8Length below)
// and taken as a head from the front, which is what memq's own readHead does
// (scripts/memq.js :465) at this same size. The store reads a record through
// two kinds of door and the head is what reconciles them. The capped ones go
// through readHead at FRONTMATTER_READ_CAP: readFrontmatterAnchors (:2665)
// and listMemories (:3551). The uncapped ones go through frontmatterField
// (:2334), which reads the whole file with fs.readFileSync, and that is the
// door for readFrontmatterTags (:2355), readFrontmatterCreated (:2380),
// pinState (:3356), the machine: read (:4350), the back-pointer read in
// supersedesTargetRefusal (:11013), which is the --supersedes screen
// cmdAddType and cmdAddOperator run, and readFrontmatterUnclosedRepair
// (:2124), which names a record's repair and so has to see the record the
// state it explains was decided from.
//
// So a block that closes before the head's last line is the block every one of
// those readers sees, capped and uncapped alike, and its fields are judged in
// full: a 70 KB record whose fence closes at byte 200 is an ordinary record to
// the whole store, and padding a body is no way to turn a deny rule off. Two
// shapes are what the two kinds of door can disagree about, and a record
// carrying either is not judged at all, taking the not-checked line instead
// because what it declares depends on which reader looks. One is a block that
// does not close inside the head: the capped readers never see it close and
// read no field inside it at all, while the uncapped ones close it and read
// the fields. The other is a block whose closing fence is the head's own last
// line, which only a cut record can be, since the cut falls by byte count and
// not at a line end: the `---` the head ends on may be the front of a line
// that runs past the cut and closes nothing, so the capped readers' closed
// block and the uncapped readers' open one are the same record. A read or a
// computed result is cut
// to the head rather than refused, so a replace_all whose replacement
// multiplies the text cannot grow an unbounded string inside a hook that runs
// in front of every write.
//
// The value duplicates memq's FRONTMATTER_READ_CAP (:1991) rather than
// importing it, because memq does not export that constant: the duplication
// is an accepted residual, and a change to memq's cap has to be made here
// too.
const READ_CAP = 65536;

// The byte length a string lands on disk with, the unit READ_CAP is in and
// the unit every bound here is taken in. A string's own length is UTF-16 code
// units, and a record of ordinary non-ASCII text crosses the byte cap while
// that count still reads as inside it: measured in code units, such a record
// is judged whole while the store reads a head of it.
function utf8Length(text) {
    return Buffer.byteLength(text, 'utf8');
}

// A text as the head the store's capped readers see, `{text, truncated}`:
// `truncated` says there is more record than this, so the head is what was
// judged and not the whole of it. The cut is by bytes and lands wherever it
// lands, mid-character included, which is the same cut readHead makes and
// costs at most one replacement character at the end of a head no field
// reader looks past.
function capText(text) {
    if (utf8Length(text) <= READ_CAP) return { text, truncated: false };
    // Every UTF-16 code unit encodes to at least one byte, so the first
    // READ_CAP bytes all come from the first READ_CAP code units: encoding
    // that prefix alone holds the buffer to four times the cap however long
    // the payload behind it is, which matters in a hook that runs in front of
    // every write and is handed whatever a tool call carries.
    const buf = Buffer.from(text.slice(0, READ_CAP), 'utf8');
    return { text: buf.toString('utf8', 0, READ_CAP), truncated: true };
}

// The tier this call's target was placed in, once memq places it: 'project',
// 'type' or 'operator' from tierOf, or 'memory' for a target placed in a tier
// directory whose tier is not yet (or never) named. It gates the not-checked
// line, including the one the outer catch writes, so nothing is said about a
// file this guard never placed in the store, and the line names the tier.
let placedTier = null;

// The one writer to stderr. Every line this guard emits is a single line, so
// the separators are folded out before the terminator goes on: a deny's text
// carries store-derived names, and a second line under a `Blocked:` prefix
// would read as a second verdict from the harness rather than as file content.
function say(text) {
    try { fs.writeSync(2, String(text).replace(/[\r\n]+/g, ' ') + '\n'); } catch { /* nothing to do */ }
}

// Everything else that writes to either channel is dropped. memq's store-root
// gate notes on stderr when a session sets KIT_MEMORY_ROOT without the data
// signal, and this guard resolves the store on every write of every
// memory-shaped filename, so echoing that note would put it in front of writes
// all over the machine while saying nothing about any of them. stdout is
// fenced for a harder reason: it carries the one structured answer this guard
// gives, and a harness reading that channel as JSON drops the whole object if
// any other byte shares it, so a single line written there by anything loaded
// here would turn the not-checked answer into no answer. Both of this guard's
// own lines go out through fs.writeSync on the descriptors, which is under the
// fence rather than over it.
function silenceOthers() {
    process.stdout.write = () => true;
    process.stderr.write = () => true;
}

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Normalized path equality, the same expression memq-grant.js compares script
// paths with: path.relative applies the platform's own case rule, so on Windows
// two spellings of one directory are equal and on a case-sensitive filesystem
// they are not.
function samePath(a, b) {
    return path.relative(a, b) === '';
}

// A bounded read of a target as `{text, absent, truncated}`: `text` is the
// record's head, at most READ_CAP bytes of it, or null when there is nothing
// this can read (an unreadable file, a path that is not a plain file, or one
// that changed size while it was being read); `truncated` says the file holds
// more than the head; and `absent` is true only when the open failed because
// no such file exists, which is the one failure that is an answer rather than
// the lack of one: the tools' file-creation form applies to exactly that
// state. The descriptor discipline (open once, fstat, size-gate the buffer,
// read, re-fstat) is the one memq's own readHead uses, so a name swapped for
// something else between the check and the read is not what gets judged, and
// the head is the same head every capped reader in the store takes.
function readTarget(file) {
    const flags = process.platform === 'win32'
        ? fs.constants.O_RDONLY
        : fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
    let fd;
    try {
        fd = fs.openSync(file, flags);
    } catch (err) {
        return { text: null, absent: !!(err && err.code === 'ENOENT'), truncated: false };
    }
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) return { text: null, absent: false, truncated: false };
        const want = Math.min(READ_CAP, st.size);
        const buf = Buffer.alloc(want);
        let read = 0;
        while (read < want) {
            const n = fs.readSync(fd, buf, read, want - read, read);
            if (n <= 0) break;
            read += n;
        }
        if (read !== want || fs.fstatSync(fd).size !== st.size) {
            return { text: null, absent: false, truncated: false };
        }
        return { text: buf.toString('utf8', 0, read), absent: false, truncated: st.size > READ_CAP };
    } catch {
        return { text: null, absent: false, truncated: false };
    } finally {
        try { fs.closeSync(fd); } catch { /* already gone */ }
    }
}

// The spellings of an absolute path folded to the one the store is resolved
// in, or null for one this guard places nothing for. On win32 only: both
// semantics below are that platform's, and applied elsewhere the admin-share
// rewrite would mint a relative c:/rest out of a //host/c$/rest path, which
// the caller then resolves against the payload cwd, judging a file the write
// never touches. Both NT namespace prefixes are folded off, the
// extended-length \\?\ and the device \\.\, each with its UNC variant
// rewritten to the plain \\host form, and in either separator spelling,
// because path.resolve re-spells the forward-slash forms into the backslash
// prefix downstream of this fold. An administrative-share UNC spelling of a
// local volume (\\host\C$\rest, host a spelling of this machine) becomes its
// drive form, which is the spelling that otherwise reaches a tier directory by
// a path no lexical comparison places. A host that is not this machine names
// that host's volume, where the drive form would judge a local file the write
// never touches, and an ordinary network share is left alone with it: each
// names a volume this store's root is not on, and refusing every write to one
// would block work on a network working directory to close nothing.
//
// What sits behind an NT prefix decides whether anything is placed. Only two
// bodies name a path the rest of this file can reason about: a drive-rooted
// one (\\?\C:\rest) and the UNC form (\\?\UNC\host\share\rest). Every other
// body is a volume GUID, GLOBALROOT or a device name (\\?\Volume{...}\rest,
// \\.\PhysicalDrive0), and stripping the prefix off one of those leaves text
// that is not absolute at all: the caller would resolve it against the
// payload's working directory and judge a file the write never touches, in
// both directions at once, which is the hazard this fold exists to prevent.
// So those answer null and nothing is placed for them.
function foldSpelling(raw) {
    if (process.platform !== 'win32') return raw;
    let s = raw;
    const nt = /^[\\/]{2}[?.][\\/](UNC[\\/])?/i.exec(s);
    if (nt) {
        if (nt[1]) s = '\\\\' + s.slice(nt[0].length);
        else if (/^[A-Za-z]:(?:[\\/]|$)/.test(s.slice(nt[0].length))) s = s.slice(nt[0].length);
        else return null;
    }
    const admin = /^[\\/]{2}([^\\/]+)[\\/]([A-Za-z])\$(?=[\\/]|$)/.exec(s);
    if (admin && isLocalHost(admin[1])) s = admin[2] + ':' + s.slice(admin[0].length);
    return s;
}

// Whether a UNC host segment is a spelling of this machine: the fixed local
// names, and the hostname the OS reports, compared caselessly. Any host
// outside this list keeps its UNC spelling, which placeTarget below never
// resolves, so an unrecognized local spelling costs a placement, never a
// connection.
function isLocalHost(host) {
    const name = String(host).toLowerCase();
    return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '.'
        || name === os.hostname().toLowerCase();
}

// The write's target as an absolute path, or null when the payload does not
// place it. A relative path needs the payload's cwd to mean anything, and
// without one there is no file this guard can be about. On win32 every
// component is folded to its base name: a colon suffix on the basename names
// an alternate data stream, whose write creates and touches the base file,
// and a trailing dot or space comes off every segment, because the folded
// spelling is the only name such a write can silently land on inside the
// store: an opener that normalizes win32 names lands it there, and a writer
// that passes the spelling through literally cannot reach the tier at all
// (through Node's own fs it lands a stray directory beside the tier on a
// recursive create, and fails through an existing one). A component that
// folds to nothing places nothing.
//
// The fold is an over-deny and not an exact re-spelling, and the difference
// shows where the two folds meet: \\?\C:\<store>\projects\p\memory.\rec.md
// has its prefix stripped, which is itself what re-enables the Win32
// normalization that takes the trailing dot off, and the judged path is then
// the tier's own memory\rec.md while a writer passing the spelling through
// literally lands in a directory named memory. So a judged write can be one
// that never reaches the judged path. Every such case runs in the refusing
// direction (a record judged that would otherwise be judged by nothing), and
// none of them lets an unjudged write into a tier, which is the property the
// placement needs.
function targetPath(input, cwd) {
    const raw = input.file_path || input.path;
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const s = foldSpelling(raw.trim());
    if (s === null) return null;
    let file;
    try {
        if (path.isAbsolute(s)) file = path.resolve(s);
        else if (cwd !== null) file = path.resolve(cwd, s);
        else return null;
    } catch {
        return null;
    }
    if (process.platform !== 'win32') return file;
    const root = path.parse(file).root;
    const segments = file.slice(root.length).split(path.sep);
    const last = segments.length - 1;
    const stream = segments[last].indexOf(':');
    if (stream !== -1) segments[last] = segments[last].slice(0, stream);
    const folded = [];
    for (const segment of segments) {
        const name = segment.replace(/[. ]+$/, '');
        if (name === '') return null;
        folded.push(name);
    }
    return path.join(root, ...folded);
}

// The tier directory this write lands in, with the file spelling it was placed
// by, or null for a target in no tier. The path as written is tried first, and
// only when it places nothing is the directory's real path tried as a second
// candidate, which is what resolves an 8.3 short name and any link in the
// chain above the file. The real path is unavailable for a directory that
// does not exist yet, which is ordinary for a Write, so its absence is not a
// failure to place anything. It is asked only of a target whose lexical path
// already sits under the store's own root, and never of one that is UNC- or
// device-rooted: on win32 resolving \\host\share is an outbound SMB
// connection that authenticates as the logged-in account, made here before
// the user's permission prompt and stalled for the SMB timeout by an
// unreachable host, which is the hazard memq's own resolveWorktreeMainRoot
// refuses a .git pointer over, and a mapped or subst drive letter is a
// spelling of the same connection no lexical screen catches. Confining the
// resolver to in-store targets keeps it out of every other .md write on the
// machine; a target that reaches the store only through an alias of the root
// itself is placed by its written spelling or not at all. The UNC- and
// device-rooted screen is `memq.namesNetworkShare`, single-sourced in
// scripts/memq.js (Standing Amendment 2), memq's own answer to the same
// question rather than a second regex on the leading separators.
function placeTarget(memq, file) {
    const lexical = memq.tierDirFor(file);
    if (lexical !== null) return { file, dir: lexical };
    if (memq.namesNetworkShare(file) || !underStoreRoot(memq, file)) return null;
    try {
        const dir = path.dirname(file);
        const real = fs.realpathSync.native(dir);
        if (real !== dir) {
            const candidate = path.join(real, path.basename(file));
            const placed = memq.tierDirFor(candidate);
            if (placed !== null) return { file: candidate, dir: placed };
        }
    } catch { /* no real path for a directory that is not there */ }
    return null;
}

// Whether an absolute path sits lexically under the store's root, the screen
// that admits a target to the real-path resolver above. The comparison is
// path.relative's, so the platform's own case rule applies, and a root memq
// cannot answer admits nothing.
function underStoreRoot(memq, file) {
    let root = null;
    try { root = memq.memoryRoot(); } catch { return false; }
    if (typeof root !== 'string' || root === '') return false;
    const rel = path.relative(root, file);
    return rel !== '' && !path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel);
}

// Which tier a memory directory is, or null for a directory that is none of
// them. memq.tierDirFor answers only whether a file's directory is a tier
// directory, so naming which tier calls memq.tierNameFor rather than
// re-spelling the three shapes locally (Standing Amendment 2): were memq's
// own shapes to move, a local re-spelling here would still place the file
// while answering null about it, and a shared-tier write would be allowed in
// silence rather than refused, which is the fail-open drift this call closes.
function tierOf(memq, dir) {
    return memq.tierNameFor(dir);
}

// The CLI verb that authors the tier this write was aimed at, named on the
// refusal so the fix is in the line that blocks. What comes back is the verb
// and its positionals, with no flags: the flags are what decide whether the
// command creates a record, rewrites its index description or replaces its
// body, and the refusal builds each of those forms off this one stem, because
// they are different commands to run and they change different things.
//
// The type segment is store text on its way onto that line, so it is named
// only when it is a name memq would accept (a bounded [\w.-] word) and stands
// as a placeholder otherwise: the directory comes out of the payload's own
// path, and a deny's stderr reaches the model as the harness's reason for
// blocking the call.
function sharedTierFix(memq, compact, tier, dir) {
    if (tier === 'operator') return 'memq add-operator <name> "<description>"';
    const segment = path.basename(dir);
    const named = memq.isTypeName(segment) ? quoted(memq, compact, segment) : '<type>';
    return 'memq add-type ' + named + ' <name> "<description>"';
}

// How `memq triggers` names this tier, which is not how the add verbs name it:
// that verb takes a type as --type=<type> where add-type takes it as its first
// positional, so the create form's stem cannot carry the trigger form. The
// unusable segment reads as the same placeholder either way.
function sharedTierTriggerFlag(memq, compact, tier, dir) {
    if (tier === 'operator') return '--operator';
    const segment = path.basename(dir);
    return '--type=' + (memq.isTypeName(segment) ? quoted(memq, compact, segment) : '<type>');
}

// What a rejected value reads as when the library that elides it is not there.
// The deny is the thing that has to survive a damaged cache: this guard is one
// of the enforcement points the hook canary probes, and a renderer that will
// not load must cost the VALUE rather than the verdict, because a throw here
// reaches the catch around main() and that catch allows the write. Printing the
// value unelided is the other direction and the expensive one, since the whole
// point of the elision is that a deny reason is a channel a model reads.
const VALUE_WITHHELD = '[value withheld: the kit library that elides the account name could '
    + 'not be loaded]';

// Whether the channel's renderer is there to be called at all. A cache can
// supply a kit-compact-lib.js that loads and carries none of these exports, so
// presence is asked of the function rather than of the module.
function rendererAvailable(compact) {
    return compact !== null && typeof compact === 'object' && typeof compact.scrub === 'function';
}

// The home directory taken out of text bound for a deny reason, which is a
// channel a model reads, or null where the renderer refused to answer.
//
// kit-compact-lib owns that elision, and which pass it takes depends on whether
// a strip has already deleted characters out of the text: where one has, a home
// spelling can arrive glued to the text beside it and the name boundaries that
// keep a neighbouring directory its own name refuse the site, so the relaxed
// pass drops them. A cached library one version behind carries scrub without
// scrubAfterStrip, and scrub is that same elision with the boundaries kept, so
// it stands in.
//
// A cache can supply exports that are there and throw when called, and a throw
// out of one reaches the catch around main(), which ALLOWS the write: presence
// alone is not the answer, so the call is made behind a catch of its own and a
// renderer that will not answer costs the VALUE. That is the same ruling as the
// missing export's, taken one step later, and null is how each caller reads it.
function elideForChannel(compact, text, stripped) {
    const s = String(text);
    try {
        return stripped && typeof compact.scrubAfterStrip === 'function'
            ? compact.scrubAfterStrip(s, true)
            : compact.scrub(s);
    } catch {
        return null;
    }
}

// Store text on its way onto a line, reduced to what a line can carry with
// every reduction named: the home directory is elided, memq.sanitize keeps
// printable ASCII and drops the double quote, so the characters it removed are
// marked when any were, and a value past the cap is marked as cut, because text
// shown as if it were whole is how a reader comes to act on a name the record
// does not carry. The note vocabulary is the one memq's own anchorRefusalText
// uses, so one wording marks a reduction wherever a line carries one.
//
// The four steps are the shared renderer's own order and hold it for its
// reasons. The values that reach here FAILED the store's grammars, so they are
// free text and a hand- or model-written record can put an absolute
// home-anchored path in one. The elision runs first, over the text as given;
// the strip runs next, so the cut is decided on what is emitted; the elision
// runs again where the strip deleted anything, both because a deletion inside a
// spelling reassembles it for this pass and because a cut taken before the
// elision can halve a spelling into a fragment no whole-spelling pattern
// reaches; and the cap runs last.
function quoted(memq, compact, value) {
    if (!rendererAvailable(compact)) return VALUE_WITHHELD;
    const elided = elideForChannel(compact, value, false);
    if (elided === null) return VALUE_WITHHELD;
    const kept = memq.sanitize(elided, Infinity);
    const removed = kept.length !== elided.length;
    const rendered = elideForChannel(compact, kept, removed);
    if (rendered === null) return VALUE_WITHHELD;
    const cut = rendered.length > QUOTE_CAP;
    const head = cut ? rendered.slice(0, QUOTE_CAP) : rendered;
    const notes = [];
    if (removed) notes.push('characters removed for display');
    if (cut) notes.push('shown to ' + QUOTE_CAP + ' characters');
    return notes.length === 0 ? head : head + ' [' + notes.join('; ') + ']';
}

// The longest text a refused anchors: or triggers: entry can carry once
// memq's own reduction has annotated it, measured from that reduction rather
// than declared here: probe entries drive each field's parse through the
// faults it can name, the cut cases carrying every note they can join, and
// the longest text handed back is the bound. Measuring keeps a refused entry
// shown whole through its own annotation, and moves with memq's wording
// instead of drifting from it.
//
// One bound covers both fields because one `shown` prints them, and their
// reductions are the same reduction over different grammars, so the max is
// the honest answer for either: a bound taken from anchors alone would cut a
// refused trigger mid-annotation on the strength of a measurement of another
// field.
let refusedTextCap = null;
function shownCap(memq) {
    if (refusedTextCap !== null) return refusedTextCap;
    const cap = memq.ANCHOR_ENTRY_CAP;
    const triggerCap = memq.TRIGGER_ENTRY_CAP;
    // Each probe opens with one character of the invisible class (BEL), so
    // every measured answer carries the reduction's removed-characters note.
    // memq takes its cut AFTER that strip, over the text it will print, so a
    // probe meant to be cut is written one past the cap in the characters that
    // survive the strip rather than in the characters it is handed.
    const probes = [
        '\u0007' + 'a'.repeat(cap + 1),                          // one past the entry cap: cut
        '\u0007' + 'a'.repeat(cap - 42) + '@' + '0'.repeat(40),  // at the cap: a path the grammar refuses
        '\u0007' + 'a'.repeat(cap - 1)                           // at the cap: not <path>@<sha> at all
    ];
    // The trigger probes, each written to reach one named fault, which is a
    // property worth stating because getting it wrong is silent: a probe that
    // trips an earlier bar than the one it is named for still returns a
    // string and still contributes a length, so the bound stays plausible
    // while measuring nothing it claims to. Two rules keep them honest, and
    // shownCap's own test asserts the fault each one yields.
    //
    // Where the BEL sits decides whether the type parses at all. An entry is
    // read as <type>:<pattern>, so a lead written ahead of the type leaves no
    // recognizable type and the probe comes back carrying the not-a-type
    // fault whatever else was wrong with it. It goes after the type prefix,
    // except in the probe that is for that fault.
    //
    // And the lead is only on the probes whose fault it cannot pre-empt. The
    // BEL is in the invisible class the pattern charset refuses, so a probe
    // carrying one can never reach the specificity floor or the bare-token
    // bar, both of which are asked after the charset. Those three probes
    // carry no lead and so no removed-characters note, which costs the
    // measurement nothing: their faults are reachable only by short patterns,
    // and the bound is set by the long ones above them.
    const lead = String.fromCharCode(7);
    const triggerProbes = [
        'cmd:' + lead + 'a'.repeat(triggerCap),      // past the entry cap: cut, both notes
        'cmd:' + lead + 'a'.repeat(triggerCap - 5),  // at the cap: the pattern charset
        lead + 'x'.repeat(triggerCap - 1),           // at the cap: no type prefix at all
        'cmd:git',                                   // under the floor, a fragment type
        'tool:ls',                                   // under the floor, an identifier type
        'cmd:node'                                   // a bare common token
    ];
    const lengths = [];
    for (const [parse, list] of [[memq.parseAnchors, probes], [memq.parseTriggers, triggerProbes]]) {
        const parsed = parse(list.join(', '));
        for (const item of (parsed && Array.isArray(parsed.items) ? parsed.items : [])) {
            lengths.push(String(item.text).length);
        }
    }
    refusedTextCap = Math.max(cap, triggerCap, ...lengths);
    return refusedTextCap;
}

// Text memq has already reduced for display, with the home directory taken out
// of it and bounded past the measured cap above, and not reduced again.
// memq.sanitize keeps printable ASCII only, and a refused anchor entry has been
// through memq's own reduction, which strips the invisible class and the quote
// and names what it removed: running sanitize over that would quietly drop the
// visible non-ASCII characters of a path (src/Ubersicht.cs) and hand back a
// different filename under an annotation saying nothing was removed. So the
// strip step of the renderer's order is that upstream one rather than a second
// pass taken here.
//
// The elision is the strict pass, boundaries kept, because neither thing that
// reaches here is text a strip has altered under this guard's eye. A refused
// entry arrives already elided: memq takes the channel's four steps over it,
// the relaxed pass among them, before it caps and annotates it, so what is left
// to do here is a floor over a cache whose memq is older than that order, and
// that floor covers one shape: a home spelling standing whole, unglued and
// uncut. An older memq cuts the entry at its own cap before any elision and
// strips it with none, so a spelling it hands back can arrive halved by that
// cut or glued to its neighbour by that strip, and the strict pass reaches
// neither. A PARSED anchor path has been through no reduction at all, memq's path grammar
// refusing the colon, the backslash and every absolute spelling, so it is the
// text as its author wrote it and the boundaries are exactly what keeps a
// neighbouring directory its own name on this line.
function shown(memq, compact, text) {
    if (!rendererAvailable(compact)) return VALUE_WITHHELD;
    const cap = shownCap(memq);
    const s = elideForChannel(compact, text, false);
    if (s === null) return VALUE_WITHHELD;
    return s.length > cap ? s.slice(0, cap) + ' [cut]' : s;
}

// The names of the memory records a directory holds, or null when the listing
// says nothing. A directory that is not there holds no records, which is an
// answer; every other failure is the absence of one, and the caller says so
// rather than passing a pointer it never checked. That is the split memq's own
// projectSegments() makes on the same two codes.
function recordNames(memq, dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch (err) {
        return err && err.code === 'ENOENT' ? [] : null;
    }
    return entries.filter((name) => memq.isMemoryFilename(name));
}

// One literal replacement pass over a bounded text, as `{text, truncated}`,
// or null when the search text is empty or the text does not carry it (a call
// the tool itself will fail, and a result this guard must not present as the
// unchanged file). The search text is taken as text rather than as a pattern:
// every occurrence when `all`, the first otherwise.
//
// The result is built a piece at a time and stopped once the text already
// built reaches the cap, so a replace_all whose replacement is larger than
// what it replaces cannot multiply a 64 KB input into an arbitrarily large
// string inside a hook that runs in front of every write. A result stopped
// short, or cut to fit, is marked truncated exactly as an over-cap read is,
// and the head it hands back is the head the store's capped readers would see
// of the same result; a result ending on the cap with nothing behind it is the
// whole of what the tool will land, so it is not marked.
function replaceBounded(text, from, to, all) {
    if (from === '') return null;
    let at = text.indexOf(from);
    if (at === -1) return null;
    const pieces = [];
    let bytes = 0;
    let cut = 0;
    while (at !== -1) {
        const before = text.slice(cut, at);
        pieces.push(before, to);
        bytes += utf8Length(before) + utf8Length(to);
        cut = at + from.length;
        if (bytes >= READ_CAP) {
            // The running sum is measured a piece at a time, and a piece
            // boundary falling between the halves of a surrogate pair counts
            // three bytes for each lone half where the joined text encodes
            // four, so the sum can reach the cap while the text has not. The
            // sum is therefore the trip wire that says when to ask, and the
            // joined text is what answers; a sum that overshot is replaced by
            // the measured length and the walk goes on.
            const joined = pieces.join('');
            bytes = utf8Length(joined);
            if (bytes >= READ_CAP) {
                // The tail past this point is dropped rather than built, so
                // what comes back is a head. It is marked truncated only where
                // something is genuinely left behind it: the cut capText made,
                // or text this walk stopped short of. A result landing exactly
                // on the cap with nothing behind it is the whole record, and
                // marking it truncated would route an owed deny to the
                // not-checked answer, which allows, while a Write of the same
                // bytes denies.
                const head = capText(joined);
                return { text: head.text, truncated: head.truncated || text.slice(cut) !== '' };
            }
        }
        if (!all) break;
        at = text.indexOf(from, cut);
    }
    pieces.push(text.slice(cut));
    return capText(pieces.join(''));
}

// The file's text after this call as `{text, truncated}`, or `{cause}` naming
// why it could not be computed. The operation is the one the payload's
// tool_name declares, and the field read is that tool's own: Write reads
// `content`, Edit the old_string/new_string pair, MultiEdit `edits`. A rival
// operation's field sitting beside them is read by nothing here, which is
// what the harness does with it: the harness decides the operation from
// tool_name and hands the tool its own field, ignoring the rest, so reading
// `content` for a declared Write is reading exactly what will land. The
// not-checked answer is kept for the declared tool's own field being absent
// or unreadable; a name outside the three write tools computes nothing
// either, which is the fail-open direction the header states. A Write's
// content is cut to the store's own head before it is handed back, on the
// reasoning the cap's comment gives.
function resultingText(toolName, input, disk) {
    if (toolName === 'Write') {
        if (typeof input.content !== 'string') {
            return { cause: 'this call\'s payload is not one this guard reads as a write' };
        }
        return capText(input.content);
    }
    if (toolName === 'Edit') {
        if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') {
            return { cause: 'this call\'s payload is not one this guard reads as a write' };
        }
        return appliedEdits([input], disk);
    }
    if (toolName === 'MultiEdit') {
        if (!Array.isArray(input.edits) || input.edits.length === 0) {
            return { cause: 'this call\'s payload is not one this guard reads as a write' };
        }
        return appliedEdits(input.edits, disk);
    }
    return { cause: 'this call\'s tool_name is not a write tool this guard computes a result for' };
}

// The disk record's head with the edits applied in order, as
// `{text, truncated}`, or `{cause}` naming why there is no result. An edits
// list whose first entry searches for the empty string against a target that
// is not there is the tools' file-creation form, so it is computed from empty
// text and the created record is judged exactly as a Write's content is; the
// empty search anywhere else matches no text a file already carries, and the
// cause says the string was empty rather than claiming it is not in the file,
// which is untrue of the empty string.
//
// `replace_all` decides how many occurrences land, so a value that is neither
// true nor false is a payload this guard cannot price: reading it as false
// would judge one replacement while the tool made every one of them, with the
// judged text and the landed text diverging and nothing saying so. It answers
// with its own cause instead. An absent key is the ordinary single
// replacement and is not that case.
//
// Truncation is sticky across the run: once the text this walks is a head
// rather than a whole record, every later result is a head too, and an
// old_string that is not in the head of a truncated record says so in its own
// words rather than claiming the record does not carry it.
function appliedEdits(edits, disk) {
    let text = disk.text;
    let truncated = disk.truncated;
    if (text === null) {
        if (disk.absent && edits[0] && edits[0].old_string === '') {
            text = '';
            truncated = false;
        } else {
            return { cause: 'the file this edit applies to could not be read, so the result of the edit is unknown' };
        }
    }
    for (const edit of edits) {
        if (!edit || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') {
            return { cause: 'one of this call\'s edits could not be read' };
        }
        if (edit.replace_all !== undefined && typeof edit.replace_all !== 'boolean') {
            return { cause: 'an edit\'s replace_all is neither true nor false, so how many '
                + 'occurrences the tool replaces, and the text it lands, are unknown' };
        }
        if (edit.old_string === '') {
            if (text !== '') {
                return { cause: 'an edit\'s old_string is empty, which is the tools\' file-creation form and matches no text already there, so the result of the edit is unknown' };
            }
            const created = capText(edit.new_string);
            text = created.text;
            truncated = truncated || created.truncated;
        } else {
            const applied = replaceBounded(text, edit.old_string, edit.new_string,
                edit.replace_all === true);
            if (applied === null) {
                return { cause: truncated
                    ? 'this record runs past the bytes this guard reads of it and an edit\'s old_string is not in the part it read, so the result of the edit is unknown'
                    : 'an edit\'s old_string is not in the file as it stands, so the result of the edit is unknown' };
            }
            text = applied.text;
            truncated = truncated || applied.truncated;
        }
    }
    return { text, truncated };
}

// A record's frontmatter block as text, or null when it opens no block on the
// first line. A block that never closes inside memq's line bound has no end to
// cut at, so the whole of the text handed in stands in for it (the record, or
// the head of one past the read cap), and a record whose first
// non-blank line is a late fence is read the same way. The consequence is
// worth stating: an edit that changes any byte of such a record compares
// unequal against the whole record and is judged, and the unclosed or
// late-fence rule then refuses every result still carrying the defect, so the
// one edit such a record accepts is the one that mends its fence (closing the
// open block, or moving the late fence to the first line).
function blockText(memq, block) {
    if (!block.opened) return fenceIsLate(block) ? block.lines.join('\n') : null;
    const end = block.closer === -1 ? block.lines.length : block.closer + 1;
    return block.lines.slice(0, end).join('\n');
}

// Whether a record that opens no block on line 1 nevertheless leads with what
// its author meant as frontmatter: the first line carrying anything is a fence.
// memq reads a block only when the record's very first line opens it, so such a
// record declares no fields at all and every reader answers as though it had
// none. A `---` further down, under a body that never opened a fence, is not
// this: it is a horizontal rule or a divider, and it is left alone.
function fenceIsLate(block) {
    if (block.opened) return false;
    for (const line of block.lines) {
        if (line.trim() === '') continue;
        return line.trim() === '---';
    }
    return false;
}

// The rule a record's frontmatter breaks as `{fault}`, `{cause}` naming a check
// that could not run, or null when it breaks none of them. Every question here
// is asked of memq's own readers, so a field this refuses is a field the store
// would read (or fail to read) exactly this way.
//
// A fault outranks a cause, and that is the whole reason the checks are a list
// rather than a run of early returns. A cause is an allow: it says one field
// could not be looked at. A fault is a deny. So a check that stops the run the
// moment it produces a cause takes every deny below it down with it, and which
// denies those are is decided by whichever field happens to sit first in the
// source. Every check here runs until one produces a fault, which makes the
// order below a matter of which fault is reported rather than of which faults
// are reachable.
//
// The cause kept is the first one produced, the checks running in the order a
// record is read: the earliest field the store could not read is the one whose
// repair is likeliest to let the rest be read at all, and reporting a later
// one would send its author past the field that is actually in the way.
//
// The list costs nothing extra on a clean record and nothing extra on a
// denied one, because the loop returns at the first fault: the checks past a
// filesystem-touching one run only when that one answered a cause, which is
// exactly the case this exists for.
function frontmatterFault(memq, compact, text, block, dir, file, cwd) {
    const checks = [
        () => unclosedFault(memq, block),
        () => lateFenceFault(block),
        () => placementFault(memq, text),
        () => triggersFault(memq, compact, text),
        () => supersedesCheck(memq, compact, text, dir, file),
        () => anchorsFault(memq, compact, text, cwd),
        () => tagsFault(memq, text, block),
        () => dateFault(memq, compact, text)
    ];
    let cause = null;
    for (const check of checks) {
        const answer = check();
        if (answer === null || answer === undefined) continue;
        if (typeof answer.fault === 'string') return answer;
        if (cause === null) cause = answer;
    }
    return cause;
}

// A frontmatter block that opens and never closes inside the bound memq reads
// a block within, which is every field of the record gone unread.
function unclosedFault(memq, block) {
    if (memq.frontmatterUnclosed(block)) {
        // The repair is memq's own, because there are two shapes of this
        // state and they take opposite instructions: a block whose closing
        // fence stands past the line bound is closed already, and telling its
        // author to add a fence would close it early and drop the fields
        // below the new one, the pinned: among them, into the body. A record
        // reaching here is on the project tier, the shared tiers having been
        // denied above, so the repair is one this session's write tools can
        // make.
        // The shape-specific instruction is memq's, and a failure to get it
        // degrades this deny rather than losing it. Everything else on this
        // path is a string literal that cannot throw; this one call is the
        // only way the sentence can fail to build, and a throw here would
        // reach the outer catch, which answers not-checked and exits 0, so
        // a record the store cannot read would land because a message could
        // not be written. The fallback names the property both repairs
        // establish rather than either instruction, so a degraded line is
        // less specific and never wrong about which shape is in front of it.
        let repair = null;
        try {
            repair = memq.frontmatterUnclosedRepair(block, false);
        } catch {
            repair = null;
        }
        return {
            fault: 'Its frontmatter block opens on the first line and does not close inside the '
                + 'line bound memq reads a block within, so no field inside it is read: a '
                + 'supersedes: there points nowhere, and a pinned: there does not pin, it leaves '
                + 'every pass that reads the record unable to say whether it is pinned. To fix '
                + 'it, ' + (typeof repair === 'string' && repair !== ''
                    ? repair
                    : 'make its frontmatter block close inside that bound, keeping every field '
                        + 'the record is to carry above the closing line') + '.'
        };
    }
    return null;
}

// A fence that is not the record's first line, which memq reads as no block
// at all, every field inside it included.
function lateFenceFault(block) {
    if (fenceIsLate(block)) {
        return {
            fault: 'Its frontmatter fence is not the record\'s first line, and memq reads a block '
                + 'only when the first line opens it, so every field inside this one reads as '
                + 'absent. Move the fence to the first line: nothing may precede it, blank lines '
                + 'included.'
        };
    }
    return null;
}

// A memq field indented under a key of the author's own, where memq does not
// read it. Placement is asked before any value, since a misplaced field is why
// the value checks would otherwise see nothing at all.
function placementFault(memq, text) {
    for (const name of MEMQ_FIELDS) {
        if (memq.frontmatterValue(text, name) === memq.FRONTMATTER_INDENTED) {
            return {
                fault: 'Its ' + name + ': is indented under a key other than metadata:, where memq '
                    + 'does not read it. Put it at the top level of the frontmatter block, or under '
                    + 'the harness\'s metadata: map.'
            };
        }
    }
    return null;
}

// The pointer, asked only of a record that declares one.
function supersedesCheck(memq, compact, text, dir, file) {
    const supersedes = memq.frontmatterValue(text, 'supersedes');
    if (typeof supersedes === 'string' && supersedes.trim() !== '') {
        return supersedesFault(memq, compact, supersedes, dir, file);
    }
    return null;
}

// The tags line in the one shape memq reads as no tags at all.
function tagsFault(memq, text, block) {
    if (tagsAreListForm(memq, text, block)) {
        return {
            fault: 'Its tags: carries a YAML list rather than an inline value, which memq reads as '
                + 'no tags at all. Write them on the key\'s own line, comma separated: tags: a, b.'
        };
    }
    return null;
}

// The anchors line: its grammar, then the containment of what it names, then
// whether the whole of it was read. This is the one check here that touches
// the filesystem, and only for a record that names an anchor.
function anchorsFault(memq, compact, text, cwd) {
    const anchors = memq.frontmatterAnchors(text);
    if (anchors === null) {
        return { cause: 'this record\'s anchors could not be read' };
    }
    if (anchors.bad.length) {
        return {
            fault: 'Its anchors: carries an entry outside the grammar: ' + shown(memq, compact, anchors.bad[0])
                + '. An entry is <repo-relative-path>@<40 hex>, and memq anchor <name> <path>... '
                + 'writes the line so no hash is typed by hand.'
        };
    }
    if (anchors.entries.length) {
        // The root is derived only for a record that names an anchor. It is a
        // synchronous walk against the payload's working directory, and this
        // hook sits in front of a tool call, so a record that anchors nothing
        // pays none of it.
        //
        // A working directory naming a network share is refused before that
        // walk (memq.anchorRoot's own projectTreeRoot) ever runs: this guard
        // stalls the operator's own tool call rather than losing a hook's
        // stdout, which is the costliest of the four callers that
        // single-source memq.namesNetworkShare (Standing Amendment 2).
        //
        // cwd is legitimately null here (main() sets it at the top when the
        // payload carries no working directory at all), and
        // namesNetworkShare's own fail-closed type guard answers true for
        // any non-string, refusal being the right direction for that
        // predicate's own callers generally. It is the wrong direction for
        // this one: a call with no cwd has no working directory to name a
        // network share, and anchorRoot(null) already answers the accurate
        // "no project root resolves" cause below, so the type check here
        // routes a null cwd to that branch instead of asserting a network
        // share this call never had one of.
        if (typeof cwd === 'string' && memq.namesNetworkShare(cwd)) {
            return { cause: 'this call\'s working directory names a network share, so this '
                + 'record\'s anchor paths were not checked against one' };
        }
        const root = memq.anchorRoot(cwd);
        if (typeof root !== 'string' || root === '') {
            return { cause: 'no project root resolves from this call\'s working directory, so this '
                + 'record\'s anchor paths were not checked against one' };
        }
        // Containment behind the grammar, and lexical: memq.isAnchorPath
        // already refuses an empty, dot-only or dot-dot segment and every
        // spelling of an absolute path, so no entry that reaches here can climb
        // out of the root by its text alone and no payload reaches this
        // refusal today. It stands because the grammar is the only thing
        // holding that, and because resolving the path instead is what
        // anchorEntryState refuses to do: a link inside the project is judged
        // at the read door rather than followed here.
        for (const entry of anchors.entries) {
            const rel = path.relative(root, path.resolve(root, entry.path));
            if (path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) {
                // The path is quoted through shown() rather than quoted():
                // the grammar has already refused the invisible and
                // whitespace classes, so what a parsed entry carries is the
                // author's own visible text, and memq.sanitize over it would
                // strip visible non-ASCII and name a file the record does
                // not carry.
                return {
                    fault: 'Its anchors: names ' + shown(memq, compact, entry.path) + ', which leaves this '
                        + 'project. An anchor path is relative to the project root. Use memq anchor '
                        + '<name> <path>... , which refuses a path outside it.'
                };
            }
        }
    }
    if (anchors.truncated) {
        // The parse reads a bounded head of the line and flags the cut, so
        // the entries past it exist in the record and were never grammar- or
        // containment-checked; silence here would be the checked-and-clean
        // answer for anchors nobody looked at.
        return { cause: 'this record\'s anchors: line was cut at memq\'s bound before its end, so '
            + 'the anchors on its unread tail were not checked' };
    }
    return null;
}

// The date rules, which are two different rules and say so. A `created:` memq
// cannot parse is the certain case: memq.readFrontmatterCreated runs Date.parse
// over the value and reads the record as carrying no created date at all when
// that is not finite. The house form is the other, and it refuses a value memq
// does read, so it names itself as this store's own convention rather than as
// something the store could not read. `pinned:` has only the house rule: memq
// never parses that value, so no spelling of it is certain damage.
function dateFault(memq, compact, text) {
    const created = memq.frontmatterValue(text, 'created');
    if (typeof created === 'string' && created.trim() !== ''
        && !Number.isFinite(Date.parse(created.trim()))) {
        return {
            fault: 'Its created: reads ' + quoted(memq, compact, created.trim()) + ', which memq cannot parse '
                + 'as a date, so the record reads as carrying no created date at all. Write it as '
                + 'YYYY-MM-DD.'
        };
    }
    for (const name of ['pinned', 'created']) {
        const value = memq.frontmatterValue(text, name);
        if (typeof value === 'string' && value.trim() !== '' && !isHouseDate(value.trim())) {
            return {
                fault: 'Its ' + name + ': reads ' + quoted(memq, compact, value.trim()) + ', which is not the '
                    + 'date form this store writes. Write it as YYYY-MM-DD, naming a day the '
                    + 'calendar holds.'
            };
        }
    }
    return null;
}

// Why a `triggers:` line is one memq will not read whole as `{fault}`,
// `{cause}` when the record says nothing this can read, or null when every
// entry on it is inside the grammar.
//
// The whole check is memq's own parse, because the field has no second half
// to resolve: an anchor names a path that then has to be found under a root,
// and a trigger is a pattern that is judged entirely by its own text. So
// there is no containment check here and no root derived, and a record
// declaring triggers costs this guard no filesystem walk at all.
//
// A record whose frontmatter could not be read is a cause rather than a
// fault, for the reason the anchors branch above gives: silence there would
// be the checked-and-clean answer for a line nobody looked at.
function triggersFault(memq, compact, text) {
    const triggers = memq.frontmatterTriggers(text);
    if (triggers === null) return { cause: 'this record\'s triggers could not be read' };
    if (triggers.bad.length) {
        return {
            fault: 'Its triggers: carries an entry outside the grammar: '
                + shown(memq, compact, triggers.bad[0]) + '. An entry is <type>:<pattern>, the type one of '
                + memq.TRIGGER_TYPES.join(', ') + ', and the pattern at least '
                + memq.TRIGGER_PATTERN_MIN + ' characters, not a bare common token on the '
                + memq.TRIGGER_FRAGMENT_TYPES.join('/') + ' types, and free of the quote, the '
                + 'opening bracket, the comma, the backslash and every invisible character, '
                + 'carrying no whitespace but the plain space and none of that at either end, '
                + 'and free of the \': \', \' #\' and trailing \':\' sequences a YAML line reads '
                + 'as syntax. A glob: pattern is narrower again: it takes the path grammar\'s '
                + 'own bars, so it carries no whitespace at all. The refused entry names the '
                + 'rule it met. '
                + 'memq triggers <name> <type>:<pattern>... writes the line and names every '
                + 'entry it refuses.'
        };
    }
    if (triggers.truncated) {
        // The parse reads a bounded head of the line and flags the cut, so
        // the entries past it exist in the record and were never checked;
        // silence here would be the checked-and-clean answer for triggers
        // nobody looked at.
        return { cause: 'this record\'s triggers: line was cut at memq\'s bound before its end, '
            + 'so the triggers on its unread tail were not checked' };
    }
    return null;
}

// Why a `supersedes:` value points at no live record of this tier as `{fault}`,
// `{cause}` when the tier or its archive could not be listed and the pointer
// was therefore never checked, or null when it points at a live record. The
// exact-casing check is the point: a variant-case pointer passes on a
// case-insensitive filesystem and goes inert on a case-sensitive one, so the
// exact filename is named here, at the door where it is still one edit away.
function supersedesFault(memq, compact, value, dir, file) {
    const name = memq.supersedesName(value);
    if (name === null) {
        return {
            fault: 'Its supersedes: reads ' + quoted(memq, compact, value.trim()) + ', which memq does not '
                + 'read as one record name, so it points nowhere. Name a single record, without '
                + 'the .md.'
        };
    }
    // The record's own name is compared the way the platform's filesystem
    // compares names (samePath's expression), because the write lands on a
    // filesystem rather than on a string: where names fold case, a pointer to
    // the variant casing of the record's own name is a self-pointer, and the
    // variant-casing fix line below must never instruct the exact casing this
    // rule then denies.
    const self = path.basename(file).slice(0, -3);
    if (samePath(name, self)) {
        return {
            fault: 'Its supersedes: names the record\'s own name, ' + quoted(memq, compact, name) + '. The '
                + 'field rides on the successor and points at the record it replaces, which is '
                + 'never itself.'
        };
    }
    const target = name + '.md';
    const live = recordNames(memq, dir);
    if (live === null) return { cause: 'this tier\'s own records could not be listed' };
    if (live.includes(target)) return null;
    const variant = live.find((n) => n.toLowerCase() === target.toLowerCase());
    if (variant !== undefined) {
        // Which half of the filename differs decides which edit fixes it, and
        // both halves can. memq.isMemoryFilename compares the extension the
        // way the platform's filesystem does, so a live-record.MD is a record
        // of this tier on win32; a pointer reading live-record is then already
        // spelled exactly, and an instruction to write the name it already
        // carries would leave the deny standing on the next write. The file is
        // what carries the spelling in that case.
        const stem = variant.slice(0, -3);
        const fixes = [];
        if (stem !== name) fixes.push('name it exactly: ' + quoted(memq, compact, stem));
        if (variant.slice(-3) !== '.md') {
            fixes.push('rename the file to ' + quoted(memq, compact, stem + '.md'));
        }
        const fix = fixes.join(', and ');
        return {
            fault: 'Its supersedes: names ' + quoted(memq, compact, name) + ', and this tier holds '
                + quoted(memq, compact, variant) + ' instead. The pointer is read in exact casing, so it '
                + 'goes inert on a case-sensitive checkout. To fix it, '
                + (fix === '' ? 'name it exactly: ' + quoted(memq, compact, stem) : fix) + '.'
        };
    }
    const retired = recordNames(memq, path.join(dir, memq.ARCHIVE_DIR));
    if (retired === null) return { cause: 'this tier\'s archive could not be listed' };
    // The archive is compared by the filesystem's own rule (samePath's
    // expression) rather than caselessly on every platform, because this
    // comparison only chooses the reason for a deny the live lookup has
    // already settled. Where names fold case, a variant-cased archive entry is
    // the file the pointer would have found and archive/ is the reason; where
    // they do not, it is a different name and the honest reason is that the
    // tier holds no such record. The live lookup above is exact on every
    // platform for the opposite reason: it is stating a rule the record has to
    // survive a move to a case-sensitive checkout under.
    if (retired.some((n) => samePath(n, target))) {
        return {
            fault: 'Its supersedes: names ' + quoted(memq, compact, name) + ', which this tier holds only '
                + 'under ' + memq.ARCHIVE_DIR + '/. A pointer names a live record: a retired one is '
                + 'already out of the tier, so nothing is left to supersede.'
        };
    }
    return {
        fault: 'Its supersedes: names ' + quoted(memq, compact, name) + ', and this tier holds no such '
            + 'record. A pointer that names nothing is inert: name a live record of this tier, or '
            + 'drop the field.'
    };
}

// Whether the record's `tags:` is the YAML list form: the key carrying no
// inline value, with a `- ` item on the next line that says anything. memq
// finds the key at either placement and reports the line it sits on, so this
// asks only what follows it and never re-decides where a field may live.
function tagsAreListForm(memq, text, block) {
    const site = memq.frontmatterSite(text, 'tags');
    if (typeof site.value !== 'string' || site.value.trim() !== '' || site.line < 0) return false;
    const end = block.closer === -1 ? block.lines.length : block.closer;
    for (let i = site.line + 1; i < end; i++) {
        const line = block.lines[i];
        if (line.trim() === '') continue;
        return /^\s*-\s/.test(line);
    }
    return false;
}

// The allow that says it checked nothing. It exits 0 like a clean record and
// is never mistaken for one, and it never reads as a refusal: no `Blocked:`,
// and the sentence says the write is going ahead. It travels as stdout JSON
// whose hookSpecificOutput carries additionalContext under this event's name,
// because that is the channel the installed CLI's own PreToolUse dispatch
// delivers an exit-0 hook answer to the model on: the CLI (2.1.246) builds a
// hook_additional_context attachment from a PreToolUse hook's
// additionalContexts, named `PreToolUse:<tool>`, and its PreToolUse output
// schema carries additionalContext as an optional key (exit 2 is what
// delivers stderr, and exit-0 stderr reaches no reader). No
// permissionDecision rides beside the text, so the line informs and decides
// nothing about the call. The write is synchronous, so the process.exit
// below cannot lose it.
function notChecked(cause) {
    const shared = placedTier === 'type' || placedTier === 'operator';
    const record = placedTier === 'project' || shared
        ? 'this ' + placedTier + '-tier memory record'
        : 'this memory-store record';
    const text = 'Not checked: ' + record + ' is allowed without '
        + (shared ? 'the shared-tier rule being applied' : 'its frontmatter being validated')
        + ', because ' + cause + '. The write goes ahead; nothing here says '
        + (shared ? 'the record may be written there.' : 'the record is well formed.');
    try {
        fs.writeSync(1, JSON.stringify({
            hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text }
        }));
    } catch { /* nothing to do */ }
}

function main() {
    silenceOthers();

    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; }   // parse fail: allow
    if (typeof p !== 'object' || p === null) return;

    // One spelling for the subject and one for the operation, and both are the
    // harness's own: it sends `tool_name` and `tool_input`, which is the pair
    // memq-grant.js reads. Reading a spelling the harness does not send would
    // let a payload put a target in front of this guard that no tool call is
    // about, and every verdict below is about the file that reading names.
    const input = p.tool_input;
    if (typeof input !== 'object' || input === null) return;
    const cwd = (typeof p.cwd === 'string' && p.cwd.trim()) ? p.cwd.trim() : null;
    const toolName = typeof p.tool_name === 'string' ? p.tool_name : null;

    const target = targetPath(input, cwd);
    if (target === null) return;                                  // no target to judge: allow

    // Required here, after the payload and path screens that need nothing
    // from it, so a call with no target never parses the module, and required
    // inside main() so a plugin cache that cannot supply the store's rules
    // leaves this guard inert through the catch around main(), which is the
    // allow direction, instead of ending the process on an unhandled throw.
    // Every screen below is memq's own judgment, so none of it can move above
    // this line, memq.namesNetworkShare included.
    const memq = require(MEMQ);
    // The channel's renderer, bound beside memq: every deny reason below
    // carries store text a model reads, and the elision that takes the OS
    // account name out of it belongs to that channel. Unlike memq above it is
    // bound behind a catch of its own rather than through the one around
    // main(), because that catch ALLOWS the write: a renderer this guard could
    // not use would otherwise stop it denying at all, which is the one failure a
    // guard must not have. A null here withholds the value and leaves every
    // verdict standing, and so does an export that is missing or throws.
    //
    // That holds on the values memq renders too, not only the ones rendered
    // here. A refused anchors: or triggers: entry is reduced for display inside
    // memq's own parse, which this guard calls through frontmatterAnchors and
    // frontmatterTriggers, so a throw there would arrive ahead of every wrapper
    // below and land in the catch around main(). memq's refusedEntryText gates
    // and catches the same two calls for the same reason, and hands back a
    // withheld placeholder among the entries it refused, so the deny that names
    // one still runs.
    //
    // What this catch does NOT cover is a library that will not load at all:
    // memq requires the same file at its own module scope and rethrows the
    // failure when it is loaded as a module, so that state has already taken the
    // require above, with no target placed in a tier yet and so nothing for the
    // catch around main() to report. That is where an unloadable memq lands too,
    // and it is the same allow. The states this leg answers for are a renderer
    // that loads and lacks an export the guard calls, or supplies one that
    // throws.
    let compact = null;
    try { compact = require('./kit-compact-lib.js'); } catch { compact = null; }

    // tierDirFor, tierNameFor and namesNetworkShare are newer than
    // isMemoryFilename, so a plugin cache carrying an older memq.js can
    // supply an isMemoryFilename that works while lacking any of them, and
    // the triggers exports are newer again. namesNetworkShare belongs in this
    // same gate rather than a separate one: placeTarget below calls it, and
    // placeTarget runs before placedTier is ever set (placedTier = 'memory'
    // is the line right after it), so a throw out of a missing
    // namesNetworkShare reaches the outer catch around main() with placedTier
    // still null, and notChecked never runs there either - the exact
    // silent-allow this gate exists to close, left open for its own sibling
    // symbol. The triggers exports are here for the same reason a step later:
    // frontmatterFault reaches for them on every project-tier record, and a
    // throw out of one of them reaches the outer catch too, where the whole
    // project-tier check set degrades through a generic answer that cannot
    // say a skew was what happened.
    //
    // Checked here, before any of them is called, so an export skew is told
    // apart from a deny that ran and found nothing, the same way
    // memory-session.js's DRIFT_MEMQ_SYMBOLS tells a skewed memq apart from a
    // clean drift answer. The answer names the symbols that are missing
    // rather than the set they came from, so a cache one export behind says
    // which one.
    const missing = MEMQ_SYMBOLS.filter(([name, kind]) => typeof memq[name] !== kind)
        .map(([name]) => name);
    if (missing.length > 0) {
        placedTier = 'memory';
        notChecked('memq\'s ' + missing.join(', ') + (missing.length === 1 ? ' symbol is' : ' symbols are')
            + ' not there, which a version skew between this guard and its cached memq.js can cause');
        return;
    }

    if (!memq.isMemoryFilename(path.basename(target))) return;    // MEMORY.md, decay-stamp, a sidecar
    const site = placeTarget(memq, target);
    if (site === null) return;                                    // outside the store, or under archive/

    // From here the target sits in a directory memq places as a tier, so a
    // check that cannot run is reported rather than passed off as silence,
    // and tierOf refines the name the report carries; a throw out of tierOf
    // itself still speaks, as the tier it could not name, and so does a
    // directory memq placed that none of tierOf's three shapes names, which
    // no directory reaches against today's memq and which would otherwise be
    // the one placed target exiting in the clean answer's silence.
    placedTier = 'memory';
    const tier = tierOf(memq, site.dir);
    if (tier === null) {
        notChecked('the tier its directory belongs to could not be named, so no tier rule was applied');
        return;
    }
    placedTier = tier;

    if (tier !== 'project') {
        // Four forms rather than one, because the write this refuses could
        // have been any of four things and each takes a different command:
        // creating a record, changing an existing record's index
        // description, changing an existing record's body, and changing the
        // `triggers:` line it declares, which is a shape this same guard
        // screens at triggersFault and which the `triggers` verb corrects
        // without touching the body. Naming one
        // of them sends the other authors to a command that refuses or,
        // worse, to one that exits 0 having never opened the record: a bare
        // --update against a record that is not there refuses and says to
        // drop the flag, and against one that is there it rewrites the index
        // line alone, so an author with a body watches it go nowhere.
        // Creating is the form a blocked write most often wanted, these
        // tiers having no hand-edit path for a record to exist by.
        //
        // The body form is gated on the engine store signals because memq
        // refuses a shared-tier body repair while they are set, which is the
        // environment a fleet worker runs in and the one where this guard's
        // shared tiers are the redirected store. Under them that operation
        // has no route at all, and the line says so rather than naming a
        // command that exits 1: the create and description forms still run
        // there, so the deny always names a way to do what can be done.
        //
        // The trigger form closes under those signals rather than forking,
        // and it closes on the vector rather than on the CLI: the standing
        // grant a fleet worker runs under (hooks/memq-grant.js) withholds the
        // `triggers` verb whichever way its tier is named, so on the one
        // process that reads this branch the command gets no prompt-free
        // allow and there is nobody in the loop to approve it. Naming it there
        // would be naming a command that cannot run, which is what the body
        // form's own fork exists to avoid, and memq says the same thing in the
        // same place: its no-trigger note names the state rather than the verb
        // under these signals. The merge is no answer either, being that same
        // withheld verb.
        const fix = sharedTierFix(memq, compact, tier, site.dir);
        const triggerFlag = sharedTierTriggerFlag(memq, compact, tier, site.dir);
        const triggerRoute = memq.storeSignalsPresent()
            ? 'there is no route from this process: it carries the engine store signals, and the '
                + 'standing grant an unattended worker runs under withholds the `triggers` verb '
                + 'that writes that line, so the declaration waits for an attended session.'
            : 'memq triggers <name> <type>:<pattern> ' + triggerFlag + ' --replace '
                + '--confirm-shared, which states the triggers: line whole in place of the one '
                + 'the record carries and leaves its body and its other fields where they are. '
                + 'Without --replace it merges into that line instead, and a --replace naming no '
                + 'entry at all takes the line off.';
        const bodyRoute = memq.storeSignalsPresent()
            ? 'there is no route from this process: it carries the engine store signals, and '
                + 'memq refuses a shared-tier body repair under them, because the .bak such a '
                + 'repair leaves behind does not sync.'
            : fix + ' --update --body "<text>" --confirm-shared, which replaces the body and '
                + 'carries the record\'s frontmatter across, leaving the text it replaced in a '
                + '.bak beside the record. That keeps every pinned:, tags: and supersedes: '
                + 'line, with one exception: where the record opens with --- and has no '
                + 'closing --- within 40 lines, memq counts that text as body rather than '
                + 'frontmatter, so the new body replaces it and the fields written inside it '
                + 'go with it.';
        say('Blocked: the ' + tier + ' memory tier is authored by memq, never by the Write, Edit '
            + 'or MultiEdit tools, whoever is writing. A hand-written record there misses the '
            + 'CLI\'s refusals and its index line. Four forms author it, one per thing a write '
            + 'can be doing. To create a record that does not exist yet: ' + fix + ' with no '
            + '--update, and --body "<text>" for its body. To change an existing record\'s '
            + 'index description: ' + fix + ' --update, which never opens the record file, so '
            + 'its body and its frontmatter stay byte for byte as they are. To change an '
            + 'existing record\'s body: ' + bodyRoute + ' To change the recognition triggers an '
            + 'existing record declares: ' + triggerRoute + ' The memory-system skill\'s pinning '
            + 'section says how a pin is set and revoked.');
        process.exit(2);       // deny
    }

    // One read serves both the edit base and the untouched-block comparison
    // below, so the two cannot be made about different states of the file.
    const disk = readTarget(site.file);
    const result = resultingText(toolName, input, disk);
    if (typeof result.text !== 'string') {
        notChecked(result.cause);
        return;                                 // allowed, and said so
    }
    const block = memq.frontmatterBlock(result.text);
    const after = blockText(memq, block);
    if (after === null) return;                 // no frontmatter, and none claimed: nothing to check

    if (result.truncated) {
        // Two shapes a head cut at the byte cap cannot answer for, and memq's
        // capped and uncapped readers can disagree about either, so no verdict
        // here would be about the record the store will read. The first is a
        // block that does not close inside the head: the capped readers never
        // see it close and read no field in it at all, while the uncapped
        // ones close it and read the fields. The second is a block whose closing
        // fence is the head's own last line, because the cut lands where the
        // byte count puts it rather than at a line end: that line may run on
        // past the cut (`--- not-a-fence`) and close nothing, which is what
        // the uncapped readers see, while the head reads as a closed block
        // whose fields are all there. Everything else is judged, a record
        // whose block closes earlier in the head included: that block is the
        // one every reader sees, capped and uncapped alike, so padding a body
        // is no way to turn a deny rule off.
        if (memq.frontmatterUnclosed(block)) {
            notChecked('this record runs past the bytes memq\'s capped readers take of it and its '
                + 'frontmatter block does not close inside them, so what it declares depends on '
                + 'which of memq\'s readers looks at it');
            return;
        }
        if (block.closer === block.lines.length - 1) {
            notChecked('this record runs past the bytes memq\'s capped readers take of it and the '
                + '--- this guard read as the close of its frontmatter block is the last line of '
                + 'those bytes, so that line may run on past the cut and close nothing');
            return;
        }
    }

    if (disk.text !== null && blockText(memq, memq.frontmatterBlock(disk.text)) === after) {
        return;                                 // the block is untouched: allow
    }

    const answer = frontmatterFault(memq, compact, result.text, block, site.dir, site.file, cwd);
    if (answer === null) return;                // checked, and nothing to refuse: allow
    if (answer.cause !== undefined) {
        notChecked(answer.cause);
        return;
    }

    say('Blocked: this project-tier memory record cannot land as written. ' + answer.fault
        + ' The memory-system skill carries the frontmatter rules.');
    process.exit(2);           // deny
}

try {
    main();
} catch {
    // Fail open, and say so where there is a record to say it about: a throw
    // out of a reader is a check that did not happen, and the placed tier is
    // what keeps the line off every other write on the machine.
    if (placedTier !== null) notChecked('the check itself failed');
}
process.exit(0);
