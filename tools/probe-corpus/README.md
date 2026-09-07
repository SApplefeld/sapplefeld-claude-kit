# The scenario-probe runner

A probe is a governed moment written out as a concrete situation, a fixed set of
the documents a session would be holding when it meets that moment, and the
answer the operator ruled. The runner hands each probe's situation and documents
to a cold reader, parses the verdict the reader returns, and diffs it against the
ruling. Run against two git refs, the pair says whether a wording change moved
the answer to a moment.

The probe set is `test/probes/*.md`. The file format and its validation are in
`probe-file.mjs`; the reader's prompt is `template.md`, which is also where the
output contract the reader answers in is stated, and `parseReply` in `run.mjs` is
what reads that contract back.

The reader is the native Claude Code CLI, invoked headless. A run needs it on
PATH or named with `--claude`, and needs an authenticated `~/.claude`. Two
things are read from that directory and nothing else is: the credentials, copied
into the reader's scratch config directory, and any `home/<name>.md` file a
shape names, read live as corpus text. `--home <dir>` points both reads at
another directory.

## Running it

```
node tools/probe-corpus/run.mjs [--before <git ref>] [--only <moment>[,<moment>]]
                               [--shape <name>] [--claude <path>] [--home <dir>]
                               [--dry-run]
```

- `--before <ref>` reads each shape's files out of that commit instead of the
  worktree, so a before-and-after pair is two invocations. The ref is verified
  with `git rev-parse --verify --quiet <ref>^{commit}` before anything runs, a
  value starting with a dash is refused rather than handed to git, and every
  read names the commit that verification printed rather than the ref, so a
  branch that moves mid-run cannot make two pairs read two trees.
- `--only` and `--shape` narrow the run to the named moments and the named shape.
  A moment no probe carries is refused by name, since a run that quietly read
  the rest of the set would report on a corpus the caller never asked about.
- `--dry-run` composes every prompt and writes the report skeleton without
  invoking a reader. It is what the suite and an author checking a prompt use.
- `--claude <path>` (or the `PROBE_CLAUDE_BIN` environment variable, which the
  flag beats) points at the reader CLI. The name is resolved to a file before
  any pair runs, so a reader that is not there stops the run instead of turning
  every pair into an error. A path ending in `.js` or `.mjs` is run with the
  current Node, which is how a stand-in is driven under test.
- `--home <dir>` (or `PROBE_HOME_DIR`, which the flag beats) is the directory a
  `home/<name>` shape entry is read from and the credentials are copied from.
  It defaults to `~/.claude`. The suite runs every end-to-end case under a
  fixture home, so no test reads the operator's.

The one line a run prints on stdout is its summary, and it is the line the
Chapter template quotes:

```
probe-corpus: 12 pairs, 1 mismatches (2 on proposed rulings, 1 designed), 0 errors, exit 1, tier sonnet,opus, report .kit/probe-runs/<stamp>/report.md
```

A run that dies part way through prints the same line over the pairs it read,
naming `report.json` and marked `(partial)`, so a crashed run is not silence.

Ctrl+C stops the run at the pair it reached. The pair loop is synchronous, so an
interrupt at the terminal reaches the reader long before this process's own
handler can run, and the run reads it off the reader's termination: the signal
that killed it, or, where the platform has no signals, the exit status the runner
reads as an interruption (`0xC000013A` on Windows, the status a console program
carries out when the user interrupts it). A termination this runner itself
produced is never read that way, whatever status or signal it carries: a timeout
and a reply past the reply cap both come back with a spawn error, and each is one
`ERROR` row the run carries on from. An interrupted pair is recorded as an
`ERROR` naming the interruption, no further reader is spawned, and the run writes
`report.json`, prints the `(partial)` summary line over the pairs it read and
exits 101.

Only an interrupt that reaches the reader stops a run: a signal sent to this
process alone (a supervisor's SIGTERM, a `kill` aimed at its pid) is queued
behind the synchronous pair loop, the readers still spawn, and the handler runs
once the set has finished. Which exit code a killed run carries depends on how
far it got. A nonzero code the run itself chose wins: 101 through the
interruption path above, and a nonzero mismatch count from a run that finished.
Where the run chose nothing, or chose zero, the process exits 130 on SIGINT and
143 on SIGTERM. The credential copy is removed on every one of those routes, and
a copy the removal could not take is named on stderr and retried on exit.

Output lands in `.kit/probe-runs/<UTC stamp>/`: `report.md` and `report.json`,
each shape's files copied under `shapes/<moment>/<shape>/`, and beside them the
composed `prompt.txt` and the reader's whole raw reply. Nothing is truncated, so
every reading is re-locatable by content. `report.json` is rewritten after every
pair, so a run that dies in the middle leaves the readings it took.

A pair's status is one of `match`, `mismatch`, `UNPARSED` (a reply with no
verdict line), `designed` and `designed-agreed` (below), `ERROR` (no reading at
all: the reader failed, timed out, was interrupted or returned something other
than the JSON it promises), or `dry-run`.

A reading matches when the verdict token and the answer are both equal, trimmed
and compared without case, the answer first unwrapped of any backticks or quotes
around it. Nothing else is removed, so `send-without-asking.` is a mismatch
against `send-without-asking`: an option is a closed-list token the template asks
for verbatim, and a reader that wrote a sentence answered in prose.

The exit code is the number of mismatches on ruled probes, `UNPARSED` among
them, capped at 100. A mismatch reports and never blocks: a probe's reading is
model output, and a gate that flaked on doctrine edits would train authors to
skip the runner. The finishing pass reads the count as a gate reading in the
Chapter.

A probe whose `ruling` state is not `ruled` carries an answer the operator has
not settled, so a reader disagreeing with it is a reading to look at rather than
a gate reading. Those mismatches are counted on their own, named on the summary
line and in `report.md`'s warning, carried per row in both reports beside the
ruling state they rest on, and never added to the exit code.

A shape carrying `designed-mismatch: <slug>` is built to expose a narrow
context's own defect, and a probe's answer is one answer across all of its
shapes, so that shape reads against the answer by design. Its disagreement is
reported as `designed`, counted on its own on the summary line and in
`report.md`, and kept out of the exit code and out of the proposed-mismatch
count. Its agreement is the finding: a red that stopped being red is reported as
`designed-agreed`, warned about in `report.md`, and counted like any other
mismatch under the probe's ruling state. The marker reaches neither the prompt
nor the reader; it names the shape, and `test/probes/README.md` carries the
discipline behind it.

Errors are counted apart from mismatches and never enter the exit code, because
an error is the absence of a reading rather than a reading that disagreed:
folding the two together makes one expired token read as the corpus moving under
every probe at once. A run with errors prints a warning on stderr, carries an
error count on its summary line, and carries the count and each reader's own
reason in `report.md` and `report.json`. A run whose errors are the whole story
therefore exits 0, and the warning is what says so.

## What the runner reads

Line endings are normalised to LF on the way in, whichever mode read the file.
This checkout has `core.autocrlf` on and its older commits carry CRLF in the
blobs, so without that the same unchanged file read two ways differs in every
line and a before-and-after pair reports the encoding instead of the corpus.

A `home/<name>` entry in a shape is a file under the home directory (`~/.claude`
by default). It has no git ref, so it is read live in both modes and marked
`live` in the report.

A file the tree does not carry is handed to the reader as an absence, under
`--before` and in the worktree alike, and the report marks the row. A shape
naming a file an older tree did not carry is exactly what a before-and-after
pair measures, and a probe whose narrow shape reaches a file this checkout has
not written yet still has a reading to give.

A shape file path sits under `plugins/claude-kit/` or names one markdown file
directly under the home directory as `home/<name>.md`, written with forward
slashes and no segment that navigates. Those are the two roots `probe-file.mjs`
allows a probe file to name, and the runner imports them from there and applies
them again at the read boundary, because `runProbes` takes probes as objects and
a library caller composing its own shapes never passes the parser. With the
navigation rule alone, `home/.credentials.json`, `.git/config` and `.env` are all
paths that navigate nowhere and each would be copied into a prompt.

A path carrying `..`, `.`, an empty segment or a backslash, and an absolute path,
is refused by name in both modes before anything reads, and stops the run before
the run directory exists. Both modes need that refusal for their own reason:
`git show <commit>:<path>` neither refuses a `..` segment nor reads the file the
caller named, and the scratch copy is written at a path joined from the same
string, where an absent file written as an empty buffer would truncate whatever
it landed on. The copy's resolved path is checked against the run directory
before the write as well.

A path that reaches its target through a link, and a shape entry that names a
directory rather than a file, are refused in both modes too, by a different read
in each. In the worktree the entry is `lstat`ed and judged on what it is. At a
ref the entry's mode is read with `git ls-tree`, because a link committed to a
tree is a blob whose bytes are its target path: `git cat-file -t` calls it a blob
like any other, and without the mode read the reader would receive a path on
somebody's machine as the document. A mode that is neither `100644` nor `100755`
is refused by name. The containment judgment on what remains is
`containedRealPath` from `plugins/claude-kit/hooks/kit-read-lib.js`, the same rule
the kit's hooks read repository files under, and it is asked after a lexical
judgment that needs no filesystem, so a path that escapes is refused whether or
not its target exists. A shape file is corpus text; a shape that could name any
file on the machine would be a reader handed whatever the path points at.

Under `--before` the object's type is read with `git cat-file -t` before its
bytes are taken, so a path naming a directory is refused rather than handed to
the reader as the tree listing `git show` prints for it. Only the two things git
says about a path that is not in the tree (`does not exist in`, `exists on disk,
but not in`) count as an absence. Any other git failure stops the run, because
recording a timeout or a corrupt object as an absence would hand the reader an
empty document set and call the reading a result. The worktree draws the same
line on its `lstat`: `ENOENT` and `ENOTDIR` are the tree not carrying the path,
and any other failure, a permission refusal or a name the platform will not read
among them, stops the run rather than passing for an absence. The git binary itself is
resolved to an absolute path once at run start and spawned from the directory
that binary sits in, because the runner sits inside the repository it reads and
a spawn's working directory is one of the places a command name resolves from.

## The isolation model

The reading has to be a reading of the shape rather than of this machine, so the
reader is invoked with tools disabled (`--tools ""`), an empty setting-source
list, a minimal system prompt in place of the CLI's own, a child environment
with every `CLAUDE` and `ANTHROPIC` variable dropped (the proxy and certificate
variables `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS` and
`SSL_CERT_FILE` are inherited by design, since a box that reaches the API only
through a proxy or a local certificate authority is one where a reader stripped
of them cannot connect), `CLAUDE_CONFIG_DIR`
pointed at a scratch directory holding a copy of the credentials and nothing
else, and an empty working directory under the OS temp directory. The shape's
files are handed to the reader inside the prompt, each under a
`===== FILE: <path> =====` header, so what the reader holds about the corpus is
exactly what the runner put there and nothing it fetched.

A `CLAUDE.md` is discovered from the working directory and every directory above
it, and what sits above the OS temp directory is a property of the box rather
than of the runner, so each run walks that chain and the report's isolation line
names what it found: no `CLAUDE.md` above the reader, or the ones there are.

`tools/probe-corpus/isolation-control.mjs` is the check behind those choices. It
asks a reader to name every instruction source it holds beyond the prompt, at
four rungs: `--variant production` is the runner's own shape;
`--variant real-config` is that same argument set against the operator's real
`~/.claude`; `--variant inherit` is the least isolated call this machine can
make (the real `~/.claude`, the CLI's own system prompt and setting sources, the
repository as the working directory); and `--variant bare` is the production
shape with an empty config directory and no credentials in it. The child
environment scrub applies on every rung, the inherit one included; what varies
along the ladder is the argument set, the config directory and the working
directory.

What the ladder shows on this box:

- Production: the reader names the CLI's own identity preamble, which
  `--system-prompt` prepends rather than replaces, and system-reminder blocks
  carrying the operator's email address and the date. Neither instructs anything
  about the corpus.
- Real config: the same argument set against the operator's own `~/.claude`. The
  reader names five system-reminder blocks (the operator's email address, the
  environment, the model identity, the token budget and the date) and names no
  identity preamble among them, and it accounts for nothing else: no `CLAUDE.md`,
  no project or user instruction file, no output style, no hook or plugin text.
- Inherit: the operator's `CLAUDE.md` and the doctrine it includes, the kit's
  output style, a SessionStart hook's context, the relay plugin's instructions,
  the environment block and the available skill and agent listings.
- Bare: the reader does not run at all. It exits nonzero with `Not logged in`.

That ladder attributes the isolation. The gap between inherit and the two rungs
above it is the flags' doing: the empty setting-source list and the system-prompt
replacement are what keep this machine's instructions out, and real config holds
none of them while pointed straight at the operator's configuration directory.
The scratch config directory does two other jobs. It keeps the reader off the
operator's session state and settings, and it carries the credential the reader
authenticates from, which the bare rung is what establishes: with the
environment scrubbed and no credential in the config directory, the reader
cannot log in.

The credentials copy is refreshed before every invocation, because the token in
`.credentials.json` rotates while a run is in flight and a reading over a large
shape takes minutes. The first copy failing stops the run, since no reader in it
could authenticate. A refresh failing mid-run does not: the copy already in the
scratch is kept, the pair's row and a warning say the refresh failed, and a copy
whose token has actually rotated fails that pair as an error rather than
answering.

Newer wins, both ways, on the two files' `lstat` mtimes. A source newer than the
copy is the ordinary rotation in `~/.claude` and it is copied over. A copy newer
than the source is a rotation the reader itself performed and wrote into the
scratch, and it is kept: copying the source over it would put the token the
reader has already replaced back in front of every reader after it. A link at
either name refuses the copy and stops the run: a link's own mtime never
advances, so a link at the source would hold the real file out of every refresh,
and a link at the destination would write a live token wherever it leads.

An accepted risk rides with that: the reader and the session that started it
hold the same OAuth credential, and a refresh performed by either can rotate the
token the other is using. The copy is re-taken per invocation to keep the window
short. What a rotation inside the window produces is an `ERROR` row on the pair
that met it, which is a missing reading rather than a wrong one.

The copy lives under the OS temp directory at mode 0700 with the file at 0600,
where the platform honours POSIX modes, never inside the run directory, which is
the evidence artifact a reader of the report opens. Windows honours neither mode,
so the protection there is the access control list the temp root gives a
directory created under it, and on this box `os.tmpdir()` is `D:\Temp`, a
machine-wide directory rather than the per-user temp directory under a profile.
The copy is removed when the run
ends, when the process exits by any route, and when the run is interrupted; a
copy left by a run that died some other way is swept by the next run. Where the
platform will not remove the directory (Windows holds the working directory a
just-exited child used), the config directory holding the copy is removed on its
own, the run says so on stderr, and the empty directory is left to that sweep.

## The no-intent-story bar

The reader is never told what the documents were meant to say, what an earlier
reading found, which answer is expected, or that the reading is a test of a
change. It receives the situation, the documents, and the probe's own closed
option list, in the probe file's order. A reader handed the intent confirms the
intent, and the instrument is then measuring itself.
