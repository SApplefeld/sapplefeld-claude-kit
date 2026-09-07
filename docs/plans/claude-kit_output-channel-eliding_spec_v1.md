# One way to render a path for a model-read channel, instead of three sanitizers that do not elide

Status: In Progress
Commit Model: Commit-and-Push
Created: 2026-09-01

Session model: any executor session in the kit repo; two sections, tiers per section. Authored by
the KIT: Worker seat during the durable-boundary plan's section 2, from a finding a consultant
raised out of scope for that plan and this seat then confirmed at the lines. Anchors are
authoring-time; re-locate every hit by content.

## Dispatch Authorization

Authorized 2026-09-02 by the operator, first-hand on the allowlisted relay thread, to be appended to the kit worker's armed queue: the single path renderer for model-read channels as designed here. The operator's word was a standing instruction to the KIT: Expert seat to append every valuable parked plan to the worker's queue; that seat recorded it here and ran the append. Per the peer-sessions trace rule this section is a warrant only for a citing session that did not author it, and the receiving session performs its own trace: the grant is the operator's message on the Expert session's relay thread, and the plan arms only by the operator's word or the Expert seat's append under it.

## Goal

The kit writes filesystem paths into channels a model reads: hook output that lands in a session's
context, and command-line reports a model is instructed to run. A path under the user's home
directory carries the operating-system account name, and `docs/security-model.md` treats keeping
that name out of those channels as a property the kit provides.

One renderer in the tree actually elides it, and it was written for one caller inside one tool.
Everywhere else, a "sanitizer" strips characters and caps a length without eliding anything, so the
account name goes through. The kit therefore has a stated property with no single place that
provides it, which is the shape that had the durable-boundary plan restating the same false claim
in three consecutive rounds.

## Evidence

Confirmed 2026-09-01 by reading the lines in this checkout.

- `plugins/claude-kit/hooks/hook-canary.js:798` emits `sanitize(hooksJson)` into a failure report
  that reaches the SessionStart `additionalContext` channel. `hooksJson` is
  `path.join(pluginRoot(), 'hooks', 'hooks.json')`, and `pluginRoot()` (`:70-72`) is
  `process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..')`, which on a marketplace install
  resolves under `~/.claude/plugins/`. So the account name reaches that channel whenever the canary
  reports this failure. The leak is on the failure branch rather than on every run, which bounds how
  often it fires and not what it carries.
- Three incompatible spellings of "sanitize" exist and two of them elide no home prefix:
  `hook-canary.js:77` (replaces non-printable with a space, caps at 200) and
  `scripts/memq.js:1755`. The third, `kit-compact-checkpoint.js:203`, DELETES non-printable
  characters and caps at 120 like the others, and routes the stripped value through that file's
  own channel elision before the cap. A fourth function, `memq.js:510` `sanitizeProjectPath`, is a different
  thing again: it flattens a whole absolute path to alphanumerics and dashes, which PRESERVES the
  account name in a new spelling rather than removing it.
- `kit-goal.js:163`, `:296` and `:338` print `sanitize(result.reason)` from the same shared library
  whose refusal reasons embed an absolute path, so that CLI's channel carries the account name on
  its failure legs. It is a second channel of the same shape rather than a second caller of one
  channel, which is why its guard belongs at its own emitters rather than in the shared library the
  two have in common.
- `kit-compact-checkpoint.js` routes every one of its own writes through two emitters that elide the
  home directory in both its literal and its flattened spelling, and a source-side pin holds them
  there. That is the shape this plan generalizes, and it carries one ordering worth reproducing:
  its sanitizer runs the strip first, the elision second and the cap last, so a value carried past
  the cap only by a home prefix the channel removes is never cut at all, and no cut can take a home
  spelling in half and leave a fragment no whole-spelling pattern matches. Whatever this plan lifts
  keeps that order.
- `kit-compact-checkpoint.js`'s `displayPath` is the tree's only home-eliding renderer taking a value
  already known to be a path; the channel elision named in the bullet above is the file's other
  home-eliding surface and takes whole composed lines instead. `displayPath` decides containment with
  `path.relative`, which is boundary-aware and case-insensitive on win32.
- The deleting-versus-replacing split matters beyond tidiness: a renderer that DELETES non-ASCII
  characters can hand an operator an actionable path that does not exist on disk, which the
  durable-boundary plan's section 2 had to fix separately in its own tool.

## Approach

Lift one renderer to a shared home, give it the two properties the channel needs (component-aware
home elision, and marking a value it altered rather than altering it silently), and move the
callers that write into model-read channels onto it. Do not unify every sanitizer in the tree: the
ones that are genuinely about character sets and caps for non-path values keep their own job. The
sweep is over what reaches a model-read channel carrying a path, not over the word "sanitize".

## Standing Brief Amendments

1. (2026-09-07, section 2) The hook canary loads nothing out of the plugin cache it probes, and
   `test/hook-canary.test.js` pins that (`the canary loads no file out of the cache it is probing`).
   The pin stands. The canary therefore reaches the shared renderer through one child process on
   the failure path only: the report lines are composed in-process from raw values (no strip, no
   cap, so no cut can bisect a home spelling), handed to a single child spawned from the same root
   as JSON, and the child requires `kit-compact-lib.js` and renders each line through
   `sanitizeForOutput` (strip, elide, cap, marked). What the parent checks on the way back is a
   shape-and-bound check and not an integrity check: it refuses the rendering whole when the child
   fails, exits nonzero, returns a different number of lines, returns a non-printable character, or
   returns a detail line that does not begin with the fixed head the parent composed for it (the
   bullet, hook, label and expectation, carried beside the line rather than found by searching it),
   and it caps every returned line. On the refused leg it prints the same lines with every
   path-derived value taken back out (`[path withheld]`) plus one note, so the diagnosis survives. The
   verdict sentence, the failure count, the bullet structure and the instructions are the parent's
   and never reach the child; the root line and each detail line's body past its head are the
   child's within the cap, which is the reach a replaced library keeps and the security document
   states. No in-process require of any cache file, guarded or not.

2. (2026-09-07, section 2) A channel with more than a handful of writers takes its guard at the write
   boundary, never per site: two review rounds each found a memq.js path site guarded per value that
   the previous round's per-site fixes had missed, which is the class the doctrine's channel-property
   rule names. So memq.js in CLI mode routes every stdout and stderr chunk through the shared `scrub`
   once at the descriptor, keeps `shownPath` as the cap over a value known to be a path, and exempts
   by name only a write a machine consumer parses for an absolute path, with that consumer stated.
   Any later section that adds a writer to a many-writer channel inherits this rule. Every cap over free
   text bound for that channel runs after the elision and after the strip, on the text that will be
   emitted, since a cut taken before either can bisect a spelling the whole-spelling match would
   otherwise have caught. The strip deletes, since a deletion inside a spelling is what reassembles
   it for the second pass; where the strip removed anything, the second pass matches with no boundary
   refusal on either edge, since a deletion after a spelling glues the next word onto it exactly as
   one before it does, so a neighbour the deletion glued onto a spelling cannot hide it, at the cost
   of an over-elision confined to text that carried a stripped character. A separator inside a
   spelling matches one or more separator characters, since a doubled separator names the same
   directory.

3. (2026-09-07, section 2) A CLI entry point that loads a kit library from the plugin cache guards
   that load before its first write and before any handler it installs: a module-scope require
   that fails prints Node's own require stack, which carries the home-anchored plugin path, on a leg
   no descriptor wrapper and no exception handler has reached yet. Under `require.main === module`
   the guarded leg prints one fixed withheld line (the failure class and the error's code, never
   the message), sets exit code 1 and skips the dispatch; loaded as a module it rethrows. Four
   sibling CLIs closed this leg in earlier rounds and the memory CLI was left open, which is the
   recurrence this amendment ends. A handler that reports an uncaught failure by writing to a
   descriptor carries a re-entrancy latch and both descriptors carry an error listener, so a
   refused pipe costs one lost line and never a loop.

4. (2026-09-07, section 2) A call into the shared renderer on any path whose failure allows is
   gated and caught at the call, never trusted to a catch above it: a PreToolUse guard's deny path,
   and every memq function such a guard reaches when it loads memq as a module, among them. Gate
   the second pass on `typeof scrubAfterStrip === 'function'` with `scrub` as the fall-through, and
   make the renderer calls behind a try/catch that yields a fixed withheld placeholder in place of
   the value, never the raw text and never a throw, so the verdict stands and only the value is
   lost. Two instances of the same class were found one round apart (the guard's own `quoted` and
   `shown`, then memq's `refusedEntryText` on the parser route the guard calls through), which is
   the recurrence rule's trigger.

## Sections of Work

### 1. One shared path renderer, with the channel's two properties. Model: opus

Lift the home-eliding renderer out of `kit-compact-checkpoint.js` into a shared library the hooks
already depend on (`kit-compact-lib.js`, whose `sanitizeForOutput` becomes the marked strip, elide
and cap, with `displayPath`, `scrub` and `homeElisionsKnown` exported beside it for a value known to
be a path, a whole composed line, and the floor reading), keeping its `path.relative` containment (a text prefix
is wrong in both directions: it over-elides a sibling whose name merely starts with the home
directory's, and on win32 under-elides a path differing only in case). Add the flattened-spelling
elision, since `sanitizeProjectPath`'s output re-encodes the same absolute path and a leading-prefix
elision leaves the account name in the middle of it; the replacement is component-aware, requiring a
following separator, a following non-alphanumeric, or end-of-string, or it reproduces the same
prefix bug in a new place. A value the renderer altered is MARKED as altered rather than silently
changed, because two of its callers hand an operator a file to delete.

The checkpoint CLI keeps calling it and loses its private copy. Its own emit choke point, if the
durable-boundary plan's section 2 has landed one by the time this runs, is the caller rather than a
second implementation: read that file first and build on what is there rather than beside it.

Tests red-first: both containment failure directions; the flattened-component case, staged so the
account name is genuinely present in the middle of the path and not only at its head; the
altered-value marking; and a pin that the renderer is exported from exactly one place.

Acceptance: one exported renderer, no private copy left in the checkpoint CLI, every new test
watched red before the change and green after, whole gate delta against a recorded baseline.

### 2. Move the model-read channels onto it, and enumerate what stays behind. Model: opus

`hook-canary.js`'s failure reports are the known caller (`:798` confirmed, and any sibling in the
same report builder). Sweep for the rest rather than fixing the one: the predicate is a value
reaching a model-read channel (a hook's `additionalContext`, stdout a model is told to run) that
was composed from a filesystem path. Report the predicate, the scope swept, and every site found,
including the sites found and deliberately left, with the rule that exempts each: a site the sweep
reached and did not change reads exactly like a site the sweep never reached, so the exemptions are
what make the sweep's silence mean anything.

Then correct `docs/security-model.md` to state the property as the code then provides it, with any
residual named. That document currently states the narrow true version plus its two open residuals,
written that way deliberately by the durable-boundary plan rather than left stale; widen it only as
far as the code earns.

Tests red-first: the canary's failure report under a home-anchored plugin root asserts the account
name is absent, watched red first.

Acceptance: no path-derived value reaches a model-read channel unelided; the sweep's exemptions are
enumerated with their rules; the security document matches the code; whole gate delta against a
recorded baseline.

## Out of Scope

- Unifying the three `sanitize` spellings as such. Two of them are about character sets and caps for
  values that are not paths, and merging those is a separate refactor with its own risk.
- `sanitizeProjectPath`'s flattening rule itself, which the harness's own directory layout fixes.
- Any change to what the canary reports or when it reports it.

## Related

- `docs/archive/claude-kit_durable-boundary_spec_v1.md`: section 2 and its Standing Brief Amendment 4,
  which is where the channel-versus-caller lesson behind this plan was ruled and recorded.
- `../archive/claude-kit_write-time-neighbours_spec_v1.md`: two model-read emission paths, the authoring verbs' neighbours block and the decay scan's pairs block, whose persist-failure line prints a filesystem error at column zero outside the fence.
- `docs/security-model.md`: the accepted-risk paragraph stating the property and its residuals.
- `docs/archive/claude-kit_endpoint-dialect-key_spec_v1.md`: the plan that started writing the
  configured model endpoint's own URL pathname onto four channels a model or an operator reads,
  memq's degrade line, the daemon's two gap records and the operator-pasteable rollup, so this
  plan's site enumeration meets a path that is a URL component rather than a filesystem one.

## Chapters

### Interim board 1 - 2026-09-07

Run started on the armed queue (plan 3 of 12) at 698ac29, the scenario-probes plan's finishing commit. Header normalized from Ready to In Progress as part of starting, recorded here as the deliberate approval-region edit it is. Step 1's approach read, at the lines rather than the plan's authoring-time anchors: the checkpoint CLI's private renderer now spans printableAscii, a marked sanitize (strip, then the channel's home elision, then the cap, marks for a stripped middle and a cut tail), displayPath (path.relative containment, relative input never elided), homeElisions (the literal and flattened spellings, both built from the raw and the printable-ASCII home, boundary deny-lists on both edges, the root and ancestor refusals), scrub (whole-line elision) and floorNote (the no-knowable-home sentence), with emitOut and emitErr as the two descriptor writes and test/kit-compact-gate.test.js pinning that no other line reaches a descriptor. The shared library the hooks already depend on, kit-compact-lib.js (eight requirers), already exports sanitizeForOutput, a strip-and-cap whose home elision is a raw split on the home text, the prefix bug in both directions the spec names, and whose comment calls the checkpoint's copy the older spelling, which is backwards today; its only outside caller is kit-registry-stamp.js. So section 1 builds on that export rather than beside it: the checkpoint's machinery moves into kit-compact-lib.js, sanitizeForOutput becomes the marked strip-scrub-cap over it, displayPath and the home-known reading are exported beside it, and the CLI keeps its two emitters and floorNote calling the library. compact-deferral-nudge.js has a third home-aware renderer, commandClausePath, eliding to $HOME for a line meant to be run rather than read; it stays where it is under the plan's own out-of-scope line and is named for section 2's enumeration. Section 2's known caller is hook-canary.js's failure report, sanitize(hooksJson) at two sites in main() and the report builder, its sanitize replacing non-printables with a space and capping at 200 with no elision.

Gate baseline: whole gate `node --test test/*.test.js` 3398/3385/1/12 exit 1, measured 2026-09-07 03:54:52Z to 04:02:27Z on this main checkout at 698ac29 (then 07cca83 plus the finishing delta, identical tree) with the foreign dirty kaizen/notes-SCOTT-CLAUDE.md; the one red is the permanent test/memory-session.test.js case; contention lane none defined in this repo. Intake gaps routed: the library that receives the renderer (route a, the spec's own words plus sanitizeForOutput's comment placing the retirement there); whether sanitizeForOutput's one caller keeps unmarked output (route b, it takes the marks, since kit-registry-stamp.js writes the same model-read channel and the spec makes marking the channel's property); the print cap stays 120 with the existing max parameter.

Next: dispatch section 1 to implementer-opus with the brief at .kit/scratch/eliding/brief-s1.md, red-first tests in test/kit-compact-gate.test.js or a new test/kit-output-channel.test.js, then the code pair at fable.

### Chapter 1 - 2026-09-07
Completed: 1. One shared path renderer, with the channel's two properties
Implemented By: implementer-opus (the move, the red-first tests and the first round's pins), main session (both fix deltas)
Metrics: review rounds 2; NEEDS_CONTEXT 0; escalations 0; consults 0
Decisions / Surprises: Built on the route the board recorded: the checkpoint CLI's whole renderer (PRINT_CAP, printableAscii, the marked sanitize, displayPath, homeElisions and its once-per-process table, scrub) moved into kit-compact-lib.js, sanitizeForOutput became the marked strip, elide and cap over it with its max parameter kept and 120 the default, and the library exports sanitizeForOutput, displayPath, scrub and homeElisionsKnown; the CLI binds those four in loadKitLibraries under its old local names, keeps emitOut, emitErr and floorNote, and carries a three-line elided() pass-through for the one line reachable before the libraries are bound. Four exported names rather than the spec's "one name" is that route, and the Approach paragraph was edited to say so (an approval-region edit, deliberate). The spec assumed the CLI's failure leg could keep printing the error text: it cannot, because the renderer now lives in the library whose load is the failure, and kit-compact-lib.js requires kit-goal-lib.js itself, so a load that failed at either leaves nothing to elide with; the implementer chose to withhold the text and name the class, and this session added the error's code (an identifier admitted only under an anchored upper-case pattern) on that withheld leg alone, since a message that survived sanitize already opens with its own code. That is a diagnostic-fidelity loss on one leg, recorded here as the deliberate deviation it is; the reversal is a one-line print of the raw message plus a pin flip, at the cost of the account name on that leg. The CLI's dead os and path requires went with the move and the guarded-region comment that counted them was corrected. The round 1 security review found the renderer's leading deny-list refused a preceding separator, so a win32 long-path prefix, a file URL and a doubled separator all carried the account name through unelided (confirmed by a probe under a fixture home before the fix); the separator was dropped from the lead class, the alphanumeric refusal alone still killing the floating /mnt/backup/home/x match, the comment block was rewritten to state the rule as it now stands, and a red-first test pins the three spellings plus the floating control. The one-place pin was widened from two files to every .js under the plugin's hooks and scripts directories, subdirectories included, with an extractor reading function statements and const, let and var bindings at any indentation and two withheld controls. Size caps raised: test/kit-compact-gate.test.js 11035 to 11054, and a new entry for test/kit-output-channel.test.js at 376. Surfaces found and routed, none edited: kit-registry-stamp.js requires the library at module scope, so its own unloadable-library leg prints a raw require stack with the home-anchored plugin path, the same shape this section closed in the checkpoint CLI (section 2's sweep, named for its enumeration); its shortValue at cap 40 now carries the marks and findingLine re-renders the composed line at 300, benign but unpinned, for section 2 to pin or exempt; the renderer's literal matches single separators only, so a JSON-escaped win32 spelling (doubled backslashes) and a percent-encoded file URL (a home carrying a space) pass unelided, neither reachable from a current emitter, both named for section 2's exemption list and for the security-model residuals; compact-deferral-nudge.js's commandClausePath stays, per the plan's out-of-scope line. The lane the implementer ran extended the brief's list with every test file naming the library (doctrine-parity, kit-goal-lib, memory-sync, memq-grant, seat-stop, 380 more tests green), flagged and carried here. The heavy-process claim was written by the implementer for its lane and by this session for the whole gate, each released on its own session id.
Assumptions: (2026-09-07, section 1, route b) the checkpoint CLI's unloadable-library leg withholds the error text and names the failure class and code rather than printing a message it cannot elide, since that leg is the only one reachable with the renderer unbound and a raw require message carries the home-anchored plugin path; (2026-09-07, section 1, route b) the one-place pin's withheld control lives in an owned temp directory rather than under .kit/, per testing-discipline's owned-temp-state rule; (2026-09-07, section 1, route b) the flattened-middle case asserts through scrub and through sanitizeForOutput at a 400 cap rather than the default, since a flattened transcript path is longer than 120 characters by construction and the cut mark would mask the elision.
Review Findings: review: code pair at fable, Agent tool (round 1 and round 2); review: security lens at fable, Agent tool (round 1 and round 2). Round 1: adversarial APPROVED_WITH_CONCERNS 0/1/5 (Major: the one-place pin read two files, fixed by the sweep above; Minors: a RangeError on a long fixture home, fixed with a setup assert; the code branch uncovered, fixed with a fixture code and an assertion; the registry-stamp marks, recorded above; the size caps, raised; comment wording, fixed); blind APPROVED_WITH_CONCERNS 0/1/3 (Major: sanitizeForOutput's contract changed under kit-registry-stamp.js with no pin, adjudicated Minor since every changed rendering lands on stdout or stderr and never in a stored field and the marks are the recorded route-b decision, carried to section 2; Minors: the cap test's RangeError, fixed; displayPath reading the home separately from the table, left, the two reads agree in every shipped process; the code suffix on one branch only, superseded by the withheld-leg-only rule); security CONCERNS 0/1/1 (Major: the leading separator refusal, fixed as above; Minor: kit-registry-stamp.js's module-scope require, routed to section 2). The fix delta touched the sanitizing regex itself, which is a security-trigger surface, so it took a round of its own. Round 2: adversarial APPROVED_WITH_CONCERNS 0/0/3 (extractor and directory reach, fixed; the code suffix on the bound branch, dropped; the test header's claim about the CLI pins, checked true against test/kit-compact-gate.test.js's display-guard tests and left); blind APPROVED_WITH_CONCERNS 0/0/4 (the registry-stamp marks, as above; the extractor, fixed; the code duplication on the bound branch, dropped; a setup failure rather than a skip on a 120-character temp path, left as a stated red); security CLEAR 0/0/2 (the JSON-escaped and percent-encoded spellings, recorded above for section 2). Both round-bracket captures matched: no agent wrote to the tree.
Stamps: adjudicated 9, stamped 0: the project record the-probe-runner-is-a-paid-box-claimed-run was read for plan 2's after leg before this plan started, and the eight operator-tier reads inside the window carry peer sessions' stamps on records (store sync screening, PreCompact facts, function hooks, ledger traps and the rest) that steered nothing in this section
Gate: targeted lane `node --test test/kit-output-channel.test.js test/kit-compact-gate.test.js test/kit-goal-stop.test.js test/compact-deferral-nudge.test.js test/chapter-boundary-nudge.test.js test/kit-goal-worktree.test.js test/registry-stamp.test.js test/doctrine-parity.test.js test/size-ratchet.test.js` 759/758/1/0 exit 1 at 04:47Z on 2026-09-07 on this main checkout with the section unstaged and the foreign dirty kaizen/notes-SCOTT-CLAUDE.md, the one red being the size ratchet against a cap set before the round 2 Minors landed twelve more test lines, raised to 376, after which `node --test test/size-ratchet.test.js test/kit-output-channel.test.js test/kit-compact-gate.test.js` 423/423/0/0 exit 0 at 04:48Z and the size check exit 0 (test lines 109835 of cap 109835, 56 files, 3332 tests); no baseline exists on that lane, and no test in it was red at the whole-gate baseline. Red-first: the new file 6/0/6 exit 1 before the move and 6/6/0 exit 0 after (the implementer's red.log and green.log under .kit/scratch/eliding/), then 7/6/1 exit 1 on the separator case before the lead fix and green after. Contention lane none defined. Whole gate: `node --test test/*.test.js` 3405/3389/4/12 exit 1, measured 2026-09-07 04:48:47Z to 04:56:27Z on this main checkout at c6143b2 with the section staged and the foreign dirty kaizen/notes-SCOTT-CLAUDE.md, no foreign heavy process observed at the poll and the box claimed for the span; three of the four reds are test/hook-canary.test.js integrity checks against a local build stamp that trailed the edited hooks (untracked build-info.json), cleared by rebuilding with build.ps1 under pwsh 7 and re-running `node --test test/hook-canary.test.js` 50/50/0/0 exit 0 at 04:58:35Z; the fourth is the permanent test/memory-session.test.js red, so against the baseline 3398/3385/1/12 the delta is +7 tests, +7 pass, the same one red
Next: 2. Move the model-read channels onto it, and enumerate what stays behind (Locus: inline for the docs/security-model.md write; the code sweep dispatched at opus), carrying the section 2 surfaces named above
Commit Model: Commit-and-Push
Delta: measured at 2026-09-07T04:58:50Z on this main checkout at c6143b2 with the section staged and the foreign dirty kaizen/notes-SCOTT-CLAUDE.md

```
repository: claude-kit
test/kit-compact-gate.test.js: 11054 lines, cap 11054, +19; tests 336, +0
test/kit-output-channel.test.js: 376 lines, cap 376, new since HEAD
words: 218775 of cap 218776 across 58 curated files
test lines: 109835 of cap 109835 across 56 test files
tests: 3332
changed paths under no measured root: 4 (4 differing from HEAD, 0 untracked), which this tool does not measure and which no row above names; named-exclusion paths in the changeset: test/size-budget.json, which a root holds and no shape measures, so no row above names them
```

### Interim board 2 - 2026-09-07

Section 2 in flight at 2026-09-07T06:19:09Z, on this main checkout at 79475ba (section 1 committed and pushed). Stage: second implementer-opus dispatch running, awaited in-turn. The first dispatch (brief at .kit/scratch/eliding/brief-s2.md) returned NEEDS_CONTEXT on a real contradiction: the brief said to bind the shared renderer in hook-canary.js through a guarded require, and test/hook-canary.test.js pins that the canary loads no file out of the cache it probes (a tampered library would execute inside the tamper detector before its bytes are hashed). It left its other work in the worktree unstaged: kit-goal.js and kit-registry-stamp.js bound to the library with withheld load-failure legs, the kit-goal callback-arity defect it introduced and fixed (Array.map passing the index as the cap), two red-first canary cases, two CLI withheld-leg cases, and a 42-file sweep (351 emitter sites) with its table. Ruling adopted by this session, written as Standing Brief Amendment 1 (approval-region edit, deliberate): the pin stands and the canary renders its failure report through one child process on the failure path only, the parent owning the verdict and the failure count and withholding the detail lines on a child failure or a line-count mismatch. The second dispatch (brief at .kit/scratch/eliding/brief-s2b.md) was asked to build that, plus three folds the first sweep left unfixed without a stated rule: memq.js failureText (an fs error path on stderr), memq-shim.js (absolute plugins root and memq path), and the probe runner under tools/probe-corpus (absolute paths on stderr), each with a red-first pin. Live dispatch: implementer-opus at opus, dispatched 05:43Z, first-turn reading 55 assistant lines and 0 synthetic at its five-minute close, transcript growing, its edits now landing on hook-canary.js, memq.js, memq-shim.js and their tests.

Gate baseline: the whole gate reading from Chapter 1 stands (3405/3389/4/12 exit 1 measured 04:48:47Z to 04:56:27Z at c6143b2 with the section staged; after the build-stamp rebuild the effective baseline is that reading with the three canary reds cleared and the one permanent memory-session red). No new whole-gate reading yet this section; contention lane none defined. The heavy-process claim is the implementer's for its lane, released on this session's id.

Next: read the second dispatch's report, verify its diff and lane, then the review round (code pair plus security lens at fable, both rounds bracketed), then docs/security-model.md rewritten in the main thread from the final residual list, then close gate, whole gate, Chapter 2, commit, push, checkpoint. This entry is committed with the plan doc alone and not pushed: the push owes the whole gate and lands with the section close.

### Interim board 3 - 2026-09-07

Section 2 at 2026-09-07T07:07:46Z on this main checkout at 224cd43: the second implementer-opus dispatch returned DONE_WITH_CONCERNS (its lane 2691/2683/1/7 exit 1 over 27 files, the one red the permanent memory-session case), and review round 1 is adjudicated. The dispatch folded Amendment 1 from whole-report withholding to per-value withholding on the child-failure leg (two pre-existing canary cases need the diagnosis kept), carried the lines as JSON rather than newline-delimited, and fixed three more memq.js sites printing a resolved absolute path; the amendment text was rewritten to the shape as built (approval-region edit, deliberate). Round 1 at fable through the Agent tool, both brackets clean: adversarial CHANGES_REQUIRED 0/3/4, blind CHANGES_REQUIRED 0/3/3, security CONCERNS 0/3/4. Majors adjudicated and sent to a fix round: memq.js projects-root line still unelided (two reviewers); memq shownPath dead cap of 260 because displayPath already caps at 120; the canary child renderer printing returned lines verbatim so a same-count replaced library can author rows (fix: parent-side strip, cap, maxBuffer and a fixed-prefix check per line, and the amendment claim narrowed to a shape-and-bound check); kit-registry-stamp.js stderr write followed by process.exit on win32 pipes; sweep coverage (the taint instrument follows declarations only, so the eleven additionalContext producers were unswept, and memory-session.js prints the memory directory whole, adjudicated exempt: the Write tool needs an absolute destination and the harness prompt already prints the home-anchored CLAUDE.md path; a control shaped like the miss, a re-sweep of the eleven producers, and the deny-reason enumeration are owed). Minors sent with it: p() registering error codes and short stdout, the probe runner fallback note once, a prose pin anchored to a path shape, memq raw err.message, the note naming a kit library. Live dispatch: implementer-opus fix round 1 at opus, brief at .kit/scratch/eliding/brief-s2-fix.md, dispatched 06:42Z, first-turn reading 62 assistant lines and 0 synthetic, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify, round 2 (the fix delta touches the child spawn and the sanitizing path, both security-trigger surfaces), then docs/security-model.md in the main thread, close gate, whole gate, Chapter 2, commit, push, checkpoint. This entry is committed with the plan doc alone and not pushed; the push lands with the section close.

### Interim board 4 - 2026-09-07

Section 2 at 2026-09-07T08:03:55Z on this main checkout at 42805cf: fix round 1 landed (implementer-opus, DONE_WITH_CONCERNS, lane 2699/2691/1/7 exit 1 over 27 files with the one permanent red; it also scrubbed kit-size.js's printed paths and pinned them, a fold, and repaired a memq-grant require-block pin its own change reddened), and review round 2 is adjudicated, both brackets clean: adversarial CHANGES_REQUIRED 0/2/2, blind CHANGES_REQUIRED 0/2/2, security CONCERNS 0/1/6. Majors: the canary's fixed-head check searched the whole line for any registered value, so a cache hook echoing its own bullet prefix as stdout emptied the head (two reviewers; fix: the head is composed and carried beside the line, never found by search); memq.js still guarded per value at its path-cap sites and each round found a fresh miss (the delete step string, backupClause, the flattened projectLabel segment carrying the account name mid-string), which is the recurrence rule's trigger, so Standing Brief Amendment 2 now binds many-writer channels to a write-boundary guard and memq takes scrub once at the descriptor in CLI mode with machine consumers enumerated; kit-size.js's bound-renderer load-failure leg was unpinned under a test name claiming it. Minors sent with the round: kit-size argument refusals before the scrub binds, a maxBuffer on the canary's runHook, try/catch around the registry-stamp writeSync legs, the sweep instrument's function-range regex widened to export and async forms with a control, the disposition tables written to .kit/scratch/eliding/enumeration.md, and the silent no-knowable-home floor recorded as a residual. Amendment 1 was rewritten to the shape-and-bound claim (approval-region edit, deliberate). Live dispatch: implementer-opus fix round 2 at opus, brief at .kit/scratch/eliding/brief-s2-fix2.md, dispatched 07:38Z, first-turn reading 77 assistant lines and 0 synthetic, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify, round 3 over the fix delta (the memq write-boundary wrapper and the canary head are both security-trigger surfaces), then docs/security-model.md in the main thread, close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed; the push lands with the section close.

### Interim board 5 - 2026-09-07

Section 2 at 2026-09-07T08:51:10Z on this main checkout at a01473b: fix round 2 landed (implementer-opus, DONE, lane 2705/2697/1/7 exit 1, +6 tests all green, memq.js guarded once at the descriptor in CLI mode with the machine-consumer enumeration showing no consumer parses an absolute path out of its output, the canary heads composed and carried by the parent, the kit-size bound-renderer leg pinned, the sweep instrument reaching export and async functions with 11 of 11 withheld controls speaking, the disposition tables written to .kit/scratch/eliding/enumeration.md), and review round 3 is adjudicated, both brackets clean: adversarial APPROVED_WITH_CONCERNS 0/1/2, blind APPROVED_WITH_CONCERNS 0/1/4, security CONCERNS 0/0/5. The two Majors are both memq.js and both inside Amendment 2's class: an uncaught synchronous throw from a verb prints Node's own trace past the descriptor wrapper (fix: try/catch around the sync dispatch plus uncaughtException and unhandledRejection backstops printing through failureText), and a memory body cut at its cap before the scrub can leave an account-name fragment (fix: elide before the cut, and the remaining path-cap sanitize sites go through shownPath). Minors sent with it: the consumer table's sidecar and test rows, residual wording (any pre-write cut; any printable text within the cap), the control re-run at the subject's depth, and the kit-size red-first citation. Live dispatch: implementer-opus fix round 3 at opus, brief at .kit/scratch/eliding/brief-s2-fix3.md, dispatched 08:25Z, first-turn reading 84 assistant lines and 0 synthetic, awaited in-turn. The docs/security-model.md rewrite is drafted at .kit/scratch/eliding/secmodel.js for the main thread to apply once this round lands.

Gate baseline unchanged from board 2. Next: read the fix report, verify, one adversarial-plus-security pass over the small delta if it earns one, apply the security-model rewrite, close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Interim board 6 - 2026-09-07

Section 2 at 2026-09-07T09:20:36Z on this main checkout at e0b4c7b: fix round 3 landed (implementer-opus, DONE_WITH_CONCERNS, memq.js CLI-leg try/catch plus uncaughtException and unhandledRejection backstops, body elided before its cap, twenty capped path values moved to elide-then-cut through shownText, lane 2707/2699/1/7 exit 1 against the s2d baseline 2705/2697/1/7, +2 for the two new cases, same one red), and review round 4 over that delta is adjudicated, both brackets clean: adversarial CHANGES_REQUIRED 0/2/3, blind CHANGES_REQUIRED 0/2/4, security CONCERNS 0/3/1. Four Majors after deduplication, all sent to fix round 4: memq.js four module-scope requires unguarded so a broken library prints the raw require stack before any guard (the loader-leg class four sibling CLIs already closed, so Standing Brief Amendment 3 records it); the new handler can loop forever on a closed stderr pipe (no error listener, no latch); the two backstops are unpinned; and the shared library strips before it elides, so a tab, NBSP or quote between a letter and the home spelling glues them and defeats the whole-spelling match (section 1 library, folded into this section as a hooks/ change). One Major downgraded to Minor with the reason: the blind lens read the drain-and-continue shape as a hang holding a store lock, but the adversarial and security lenses both read the locks as released in finally and the longest queued handle as bounded by the 20-second neighbour timeout, and a process.exit would reintroduce the win32 dropped-pipe-write defect round 1 fixed, so the drain stays and the comment states it. Minors sent with it: the no-home notice through homeElisionsKnown, the quote-strip order in shownText, the deep-store fixture margin, the fragment-at-cap pin. Live dispatch: implementer-opus fix round 4 at opus, brief at .kit/scratch/eliding/brief-s2-fix4.md, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify, one more round over the delta since it touches the shared library and the loader leg, apply the security-model rewrite (draft updated for the loader leg and the handlers), close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Interim board 7 - 2026-09-07

Section 2 at 2026-09-07T10:19:38Z on this main checkout at 3541c91: fix round 4 landed (implementer-opus, DONE_WITH_CONCERNS, memq.js four library loads guarded with a withheld line and a module-mode rethrow, the uncaught-failure latch and descriptor error listeners, both backstops pinned, the renderer and memq eliding before the strip, memq sanitize split into charsetRule for the three disk gates and an eliding display sanitize gated to CLI mode, the no-home notice, lane 2716/2708/1/7 exit 1 against the s2e baseline 2707/2699/1/7, +9 for the new cases, same one red; two files outside the brief re-shaped, the compact-deferral-nudge require pin and size-budget caps), and review round 5 over that delta is adjudicated, both brackets accounted for: adversarial APPROVED_WITH_CONCERNS 0/1/5, blind APPROVED_WITH_CONCERNS 0/1/3, security CONCERNS 0/1/2. Three distinct Majors, all sent to fix round 5: memq display sanitize caps before its second elision so a quote inside the spelling can be bisected by the cut (the cap-order class from round 3 again, so Amendment 2 gained the sentence that every cap on the channel runs after the elision and the strip, and that the strip replaces with a space rather than deletes); the strip still glues a two-character case; and memory-session.js and memory-recognition-nudge.js print index descriptions into additionalContext through module-mode sanitize unelided (the two hooks fold into this section). Residuals recorded rather than fixed: a record name beginning with the flattened home spelling prints as flattened-home in CLI mode, a queued-callback throw under a held lock leaves it to the stale rule, and the lead-boundary refusal prints its own worked example. Minors sent with it: comments, LF normalization of two files, the latch reset, the no-home test assertions. Live dispatch: implementer-opus fix round 5 at opus, brief at .kit/scratch/eliding/brief-s2-fix5.md, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify, one more round over the delta (it touches two hooks and the shared strip), apply the security-model rewrite (draft to be updated for the space-not-delete strip and the two hooks), close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Interim board 8 - 2026-09-07

Section 2 at 2026-09-07T11:05:04Z on this main checkout at d7e80b2: fix round 5 landed all but one item (implementer-opus, NEEDS_CONTEXT on M2 alone; M1 the display cap after the second elision, M3 the two hooks eliding index descriptions through the shared scrub with the memory-directory line kept absolute as its own control, the Minors, lane 2719/2711/1/7 exit 1 against the s2f baseline 2716/2708/1/7, +3, same one red; bracket accounted for, the two hooks and their tests being the M3 fold). The M2 question, ruled here on the implementer's measurement (.kit/scratch/eliding/s2g-m2-evidence.log) without a consult: replacing a stripped character with a space closes nothing and loses the inside-only case the deleting strip closes by reassembling the spelling, and a dual form still leaks the two-character input because its deleted form is glued and the lead boundary refuses it; the ruling is that the strip keeps deleting and the second elision pass drops the lead refusal only where the strip removed something, which closes the two-character case at the cost of an over-elision confined to stripped text, the direction the library declares cheap. Amendment 2's last sentence is rewritten to that rule. Live dispatch: implementer-opus fix round 5b at opus, brief at .kit/scratch/eliding/brief-s2-fix5b.md, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify, a final round over the two-round delta (library second pass, two hooks, memq cap order), apply the security-model rewrite (draft to be updated for the relaxed second pass), close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Interim board 9 - 2026-09-07

Section 2 at 2026-09-07T11:59:33Z on this main checkout at 9a40514: fix round 5b landed (implementer-opus, DONE_WITH_CONCERNS; relaxed second pass in the library, memq sanitize, shownText and failureText, the two hook emitters; lane 2721/2713/1/7 exit 1 against s2g 2719/2711/1/7, +2 tests both new, same one red). Round 6 (adversarial, blind, security, all at fable over the round 5 plus 5b delta at .kit/scratch/eliding/s2h-delta.diff) converged on one Major, confirmed by this session's own probe (.kit/scratch/eliding/probe-trailing-glue.js): the relaxed table dropped only the leading boundary, so a stripped character inside a spelling plus a name character after it still leaked the account name. Adjudicated 0 Critical: the blind reviewer's second Critical (the hooks take no pre-strip pass) is closed by the same fix, since a relaxed pass with no boundary on either edge matches at any position, and is held as a pin rather than a code change. Ruling on shape: the relaxed entries drop both edges (a one-token change whose cost Amendment 2 already accepts) over a site-anchored relaxation (offsets per deletion, more code than the cost warrants). Minors accepted: separator class `[\\/]+`; symbol-presence gate on the hooks' scrubAfterStrip binding; the frontmatter guard's fault text, which quotes values that failed the store grammar, takes the renderer order (a consumer-table exemption that did not survive the reading); enumeration residuals 1 and 8 and rows 63, 78, 89 rewritten. Declined: un-exporting resetUncaughtLatch (ruled round 5). Amendment 2 rewritten to the both-edges rule with the separator-run clause. Live dispatch: implementer-opus fix round 6 at opus, brief at .kit/scratch/eliding/brief-s2-fix6.md, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify with the probe, round 7 over the round 6 delta, apply the security-model rewrite (draft at .kit/scratch/eliding/secmodel.js, to be corrected to the both-edges rule), close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Interim board 10 - 2026-09-07

Section 2 at 2026-09-07T12:52:48Z on this main checkout at 42f02d7: fix round 6 landed (implementer-opus, DONE_WITH_CONCERNS; relaxed table on both edges, separator runs, symbol gates on the two hook emitters, the frontmatter guard eliding its fault text behind its own catch with a withheld placeholder after the canary caught a plain require turning a damaged cache into an allow; lane 2725/2717/1/7 exit 1 against s2i-baseline 2721/2713/1/7, +4 tests all new, same one red; this session's probe reads clean on all three glue shapes). Round 7 (adversarial, blind, security at fable over .kit/scratch/eliding/s2i-delta.diff) adjudicated 0 Critical, two Majors standing: memq's anchor and trigger refusal text cuts at the entry cap before any elision (security, reproduced: a seven-character prefix of the account name on the guard's deny channel and memq's stderr), and a renderer that loads but throws when called still turns the guard's deny into an allow (adversarial and security). The blind reviewer's Major, that an unloadable renderer fails memq's own module load ahead of the guard's catch, is ruled the pre-existing not-checked class the guard already takes for an unloadable memq, since no check can run without memq; downgraded to a comment correction and a pin. The scrub fall-through on a one-version-behind cache gains its pins. Minors accepted: strict pass on the parsed anchor path, comment bounds on the skew gates, one parametrized trap helper, residuals for the UNC admin share, 8.3 short names, the flattened dash-run asymmetry, and the pre-elision cap measure. Declined: compiling a UNC literal, dash runs in the flattened literal, unquoted type segments. Live dispatch: implementer-opus fix round 7 at opus, brief at .kit/scratch/eliding/brief-s2-fix7.md, awaited in-turn.

Gate baseline unchanged from board 2. Next: read the fix report, verify, round 8 over the round 7 delta, apply the security-model rewrite (draft at .kit/scratch/eliding/secmodel.js, corrected to the both-edges rule), close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Interim board 11 - 2026-09-07

Section 2 at 2026-09-07T14:22Z on this main checkout at ad743ae, under a new session: the predecessor session bound to the queue was killed at 13:38:59Z with its fix round 7 implementer mid-lane (every seat on the box restarted; confirmed from the process list, both transcripts frozen at that second), and the operator re-armed the ten remaining plans from this session's keyboard at 13:44Z, which rebound the leash here. Fix round 7 had landed before the kill: its lane markers (.kit/scratch/eliding/s2j-lane.exit, EXIT=1, 2732/2724/1/7, the one red the permanent memory-session TEMP-path case) and every red-first log are on disk, and only its report and its claim delete were lost. This session reconstructed the round 7 delta as the diff of the implementer's pre-probe copies against the worktree (.kit/scratch/eliding/s2j-delta.diff, 912 lines, 10 files) and read it whole: M1 (refusal text elides before its cap through a shared refusedEntryText), M2 (elideForChannel catches a throwing renderer and withholds the value), M3 (the one-version skew pinned in all three hooks), m1 through m5 all landed. Round 8 (adversarial, blind, security, all at the session's own model through the Agent tool, both brackets clean) converged on one Major and no Critical: the round 7 fix moved the renderer into memq's parsers unguarded, so under a throwing or one-version-behind renderer a record carrying a refused anchors or triggers entry now throws out of memq.frontmatterAnchors, reaches the guard's catch around main(), and ALLOWS, the deny-to-allow outcome M2 closed for quoted and shown reopened one layer down; confirmed at the lines (memq.js:318 module-scope binding, :3892 unguarded calls; guard :1048, :1170 no catch, :1553 the allowing catch). Two instances of that class one round apart is the recurrence rule's trigger, so Standing Brief Amendment 4 is written (approval-region edit, deliberate): a renderer call on any path whose failure allows is gated and caught at the call. Minors sent with the round: residual 12 reworded (the cut is decided on elided text, which the flattened elision can lengthen, so the cosmetic mid-annotation cut is reachable against the shipped memq), the shownCap pin asserting the anchors probe's notes, the shown comment narrowed to what the strict pass floors, and the enumeration's change-narrative phrasing made present-tense before it feeds the security document. Declined: a cut-plus-grammar-fault probe in shownCap. Live dispatch: implementer-opus fix round 8 at opus, brief at .kit/scratch/eliding/brief-s2-fix8.md.

Gate baseline unchanged from board 2. Next: read the fix report, verify, round 9 over the round 8 delta (it touches the guard's deny path and memq's parser, both security-trigger surfaces), apply the security-model rewrite, close gate, whole gate, Chapter 2, commit, push, checkpoint. Committed with the plan doc alone and not pushed.

### Chapter 2 - 2026-09-07
Completed: 2. Move the model-read channels onto it, and enumerate what stays behind
Implemented By: implementer-opus (the sweep, the canary child renderer, and fix rounds 1 through 8), main session (the round 9 Minors, the docs/security-model.md rewrite, the enumeration folds)
Metrics: review rounds 9; NEEDS_CONTEXT 2 (the canary pin contradiction, ruled as Amendment 1; the fix round 5 strip question, ruled on the implementer's measurement as Amendment 2's rewrite); escalations 0; consults 0
Decisions / Surprises: The section ran across two sessions: the predecessor bound to the queue was killed at 13:38:59Z mid fix-round-7 lane with every seat on the box, and the operator re-armed the ten-plan queue from this session's keyboard at 13:44Z; round 7's delta was reconstructed from the implementer's pre-probe copies and its lane markers on disk, and nothing of it was lost. The property is provided by one renderer and its callers as interim boards 2 through 11 record round by round: the canary renders through a child so it still loads nothing out of the cache it probes (Amendment 1); many-writer channels take the guard at the write boundary, memq scrubbing once at the descriptor with a machine-consumer enumeration (Amendment 2, with the elide, strip-by-deletion, elide-both-edges-relaxed, cap order it settled over rounds 4 through 6); every CLI guards its library load before its first write (Amendment 3); and a renderer call on a path whose failure allows is gated and caught at the call (Amendment 4, applied in round 8 to memq's refusedEntryText on the parser route the frontmatter guard and the session hook both take). Round 9 over the round 8 delta adjudicated 0 Critical and 0 Major. Brief item (b) of fix round 8 deviated on measurement: the CLI-route pin the brief asked for is unreachable because memq's CLI under a renderer that loads and throws exits 1 with nothing written to either descriptor (sanitize, failureText and the descriptor wrapper call the renderer unguarded and reportUncaught renders through the same pass), so the pin sits on the module route the rule is about; the silent CLI is recorded as enumeration residual 13 and in the security model, outside Amendment 4's class since it exits rather than allows. The sweep's predicate (a value reaching a hook's additionalContext or stdout a model is told to run, composed from a filesystem path), its scope (every .js and .mjs under the plugin's hooks and scripts directories plus tools/probe-corpus, 42 files, 351 emitter sites), its shape-following instrument with 11 of 11 withheld controls speaking, the eleven additionalContext producers, the six deny reasons, memq's machine-consumer table, the site table and the thirteen residuals live at .kit/scratch/eliding/enumeration.md, a scratch artifact; the residuals were lifted into docs/security-model.md, which now states the property as the code provides it. Sites found and left, with the rule: the memory session hook's memory-directory line stays absolute because the Write tool needs an absolute destination and the harness prompt already prints the home-anchored CLAUDE.md path; the read-only agent guard quotes the caller's own command token back; compact-deferral-nudge's commandClausePath elides to $HOME for a line meant to be run (the plan's own out-of-scope line); the sidecar capture hook forwards items the daemon authored outside any kit process; the store's own free text is cut at write time unelided because the value is the operator's record rather than its display. Foreign file kaizen/notes-SCOTT-CLAUDE.md is dirty on this checkout and is not this section's; it is left. No probe pair ran in this repository for this section: the change named no shape file under tools/probe-corpus's scenario set. Two implementer folds outside the briefs' scope were accepted and are named here: kit-size.js's printed paths scrubbed and pinned (fix round 1) and the compact-deferral-nudge require pin plus size caps re-shaped (fix round 4). The docs/security-model.md rewrite is a main-thread docs write whose only reader before this commit was its author; recorded as an author re-read rather than a round, per the re-opened-document rule.
Assumptions: (2026-09-07, section 2, route b) memq's refusal text runs its reduction whichever way memq was loaded rather than behind CHANNEL_IS_OURS, since refusal text is display text on two channels and disk text on neither; (2026-09-07, section 2, route b) the canary child failure leg withholds per value rather than per report, since two pre-existing canary cases need the diagnosis kept; (2026-09-07, section 2, route b) the security-model rewrite lifts the enumeration's residual list whole rather than a subset, since a residual named in scratch and absent from the shipped document is one the next reader cannot find
Review Findings: review: code pair at fable, Agent tool (rounds 1 through 9); review: security lens at fable, Agent tool (rounds 1 through 9); every round's verdicts, Majors and their fixes are in interim boards 3 through 11. Round 9 (over the round 8 delta): adversarial APPROVED_WITH_CONCERNS 0/0/4 (the module-route pin recorded as a deviation above; the silent CLI added as residual 13; two "now" clauses in the enumeration made present-tense; a one-line comment at the swallowing catch), blind APPROVED_WITH_CONCERNS 0/0/2 (the memq pin's control run now deletes NODE_OPTIONS so a suite launched under a preload cannot damage the undamaged control; the deep-equal assertion's message narrowed to the fixture property it actually pins), security CLEAR 0/0/2 (the skewed-library glued shape added to residual 8's guard paragraph, the strict fall-through printing a glued spelling under that skew being Amendment 4's own trade; the guard pin's placeholder match reworded to say the deny is what it proves, memq's placeholder being pinned on the module route). All six Minors fixed in the main thread. Both round 9 brackets identical (porcelain-pre-round9.txt and porcelain-post-round9.txt).
Stamps: adjudicated 13, stamped 0 over `memq unstamped --since 10h`: every hit is an operator-tier record read by a peer seat (the coordinator traps, the board clearance, the Admin precondition, the elevated-roster note) or a nudge this session did not open, and none steered this section; the three records this session did apply (a-heartbeat-stamp-measures-turn-end-not-liveness, age-a-claim-by-its-mtime-not-its-own-arithmetic, first-turn-reading-path-is-the-subagents-dir) were stamped in the turn they steered and so fall outside the list
Gate: targeted lane at section close `node --test test/memory-frontmatter-guard.test.js test/memq.test.js test/kit-output-channel.test.js test/size-ratchet.test.js` 913/911/0/2 exit 0 at 14:55Z on 2026-09-07 on this main checkout with the section unstaged and the foreign dirty kaizen/notes-SCOTT-CLAUDE.md (no baseline exists on that lane; the fix round 8 lane over 27 files read 2735/2727/1/7 exit 1 against s2j 2732/2724/1/7, +3 all new, the one red the permanent memory-session TEMP-path case); contention lane none defined in this repo; whole gate `node --test test/*.test.js` 3460/3447/1/12 exit 1, measured 2026-09-07 14:58:35Z to 15:10:21Z on this main checkout at 06bad95 with the section unstaged, the security-model rewrite in the worktree and the foreign dirty kaizen notes, after `pwsh -NoProfile -File ./build.ps1` exit 0 refreshed the build stamp, the box claimed for the span and no foreign heavy process at the poll; against the plan baseline 3398/3385/1/12 the delta is +62 tests, +62 pass, the same one red by name (`a pinned directory too long to name faithfully stands the session down`); probe set: no run called for, the changeset named no shape file
Next: finishing-work
Commit Model: Commit-and-Push
Delta: measured at 2026-09-07T15:10:35Z on this main checkout at 06bad95 with the section unstaged and the foreign dirty kaizen/notes-SCOTT-CLAUDE.md

```
repository: claude-kit
test/compact-deferral-nudge.test.js: 2121 lines, cap 2121, +4; tests 77, +0
test/hook-canary.test.js: 1659 lines, cap 1659, +332; tests 58, +8
test/kit-output-channel.test.js: 599 lines, cap 599, +223; tests 12, +5
test/memory-frontmatter-guard.test.js: 2743 lines, cap 2743, +367; tests 94, +8
test/memory-recognition-nudge.test.js: 3531 lines, cap 3531, +104; tests 121, +2
test/memory-session.test.js: 3240 lines, cap 3240, +141; tests 85, +2
test/memq-grant.test.js: 1342 lines, cap 1342, +30; tests 55, +0
test/memq-shim.test.js: 679 lines, cap 679, +76; tests 20, +2
test/memq.test.js: 30645 lines, cap 30645, HEAD size unreadable (its blob is past the git runner output ceiling), so no delta
test/probe-runner.test.js: 2735 lines, cap 2735, +153; tests 94, +3
test/size-ratchet.test.js: 2987 lines, cap 2987, +142; tests 84, +4
words: 218775 of cap 218776 across 58 curated files
test lines: 112399 of cap 112399 across 56 test files
tests: 3386
changed paths under no measured root: 14 (14 differing from HEAD, 0 untracked), which this tool does not measure and which no row above names; named-exclusion paths in the changeset: test/size-budget.json, which a root holds and no shape measures, so no row above names them
```

### Interim board 12 - 2026-09-07

Finishing pass in flight at 2026-09-07T15:50Z on this main checkout at 8bc1788 (5501342 pushed; 8bc1788 is the KIT: Expert seat's own commit removing the function-hooks spike from the armed queue, landed at 15:42:54Z while this session's review round ran, and it is what the round's bracket caught: two docs/plans files staged and then committed by that peer, no reviewer having written anything, so no restore and no suspect findings). Effort base ref c6143b2 (parent of 79475ba, the first Chapter commit), changeset 28 tracked files against it, the plan carrying no Files in scope lines so the scope cross-check surfaced only the plan doc and, after the peer commit, that peer's two docs files. Step 1: qa-verifier at its frontmatter model, Agent tool, PASS on every criterion; whole gate `node --test test/*.test.js` 3460/3447/1/12 exit 1 read from the run's own markers (.kit/scratch/eliding/qa-whole.exit and .log, finished 15:26:18Z), the one red the permanent memory-session TEMP-path case, identical to Chapter 2's reading; contention lane none defined; claim written and released by the verifier on this session's id; the verifier reported one self-caused contention, a 1.7-second single-file lane it ran beside its own whole gate, named here rather than dropped. Steps 2 and 3 in one Workflow round at fable and high (run wf_77723dbf-29f, agentType named on both), both brackets accounted for as above, resolved model claude-fable-5-1 on 87 of 87 and 47 of 47 assistant lines, no substitution: security CONCERNS 0/1/3, adversarial CHANGES_REQUIRED 0/3/6, no Critical. Majors, each confirmed at the lines by this session: kit-goal.js status prints the Dispatch Authorization sentence through safeForAuthorization, a strip-and-cap that never elides, so a home-anchored path an author writes into that sentence reaches the session context, while the sweep row and the security document record the goal CLI as covered (fix: render it through the bound sanitizeForOutput at the same cap, red-first pin); docs/security-model.md's checkpoint paragraph still says the strip runs before the elision, contradicting the code and the property paragraph below it (fix: rewrite the sentence to the elide, strip, elide, cap order); enumeration residual 7, the store's own free text cut at write time unelided, is absent from the security document while Chapter 2 claims the residual list was lifted whole (fix: add it); and the sweep's exemption enumeration lives only in gitignored scratch, so the acceptance line it satisfies is reachable from no committed surface (fix: the enumeration is appended to this plan doc below as its own entry, headings demoted so the Chapters block stays whole, and rides into the archive with the plan). Minors accepted: the JSON-escaped and single-separator residual is stale in the safe direction since Amendment 2's separator runs elide a doubled spelling (pinned at test/kit-output-channel.test.js `separators doubled inside a home spelling elide with it`), so it leaves the residual list; the POSIX-shaped lead separator run is re-entered at every position of a long run (quadratic, measured by the reviewer at 2.6 s over 65,536 slashes, reachable through a memq body at its cap), fixed by a lookbehind refusing a preceding separator on both tables; killSignal SIGKILL on the canary's render spawn; three stale comments describing the pre-round-4 strip-first order (kit-compact-lib.js, hook-canary.js twice); the library exports five names not four, so the test header, the Section 1 sentence and Chapter 1 are corrected (the Section 1 edit is an approval-region edit, deliberate, recording scrubAfterStrip as the fifth export); the registry stamp's marks on its audit output get one pin; the checkpoint CLI is added to the security document's withheld-loader sentence and the shim, which loads no library, is dropped from it; memq's printMemoryBody is gated on CHANNEL_IS_OURS like sanitize; a missing comma between two residuals. Declined: none. Live dispatch: implementer-opus fix round F1 at opus over the code items, brief at .kit/scratch/eliding/brief-f1.md, with the docs edits taken in the main thread beside it; the fix delta touches the sanitizing regex and a hook's stdout, so a second finishing round over it at fable and high is owed and follows.

Gate baseline: the QA whole gate above stands as the finishing baseline. Next: fix round F1, docs edits, round 2 over the delta, then step 4 docs-curator, step 5 close and archive, whole gate, commit, push, memory. This entry is committed with the plan doc alone and not pushed; the push lands with the finishing commit.
