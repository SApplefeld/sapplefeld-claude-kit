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

## Sections of Work

### 1. One shared path renderer, with the channel's two properties. Model: opus

Lift the home-eliding renderer out of `kit-compact-checkpoint.js` into a shared library the hooks
already depend on, exported under one name, keeping its `path.relative` containment (a text prefix
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
