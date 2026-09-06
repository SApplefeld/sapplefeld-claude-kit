# A memory record says who wrote it, and a machine-scoped record can anchor a file inside the store

Status: Ready
Commit Model: Commit-and-Push
Created: 2026-09-02

Session model: any executor session in the kit repo; three sections, tiers per section. Authored by the KIT: Expert seat from the 2026-09-02 kaizen pass. Anchors are authoring-time; re-locate every hit by content.

## Dispatch Authorization

Authorized 2026-09-02 by the operator, first-hand on the allowlisted relay thread, to be appended to the kit worker's armed queue: the author field and the store-relative anchors as designed here, eleventh in the queue. The operator's word was the answer to a decision batch the KIT: Expert seat put on the relay, choosing the recommended option of appending the pass's four code-and-design specs to the worker's queue in the order code batch, liveness, claim writer, provenance; that seat recorded it here and ran the append. Per the peer-sessions trace rule this section is a warrant only for a citing session that did not author it, and the receiving session performs its own trace: the grant is the operator's message on the Expert session's relay thread, and the plan arms only by the operator's word or the Expert seat's append under it.

## Goal

The memory store records who committed a record and nothing records who wrote one. On a shared checkout with several seats, an uncommitted record can be attributed only by asking every seat in turn, and the store's own sync can publish it first under a message no seat wrote. The coordinator seat measured the cost as a rate: three sets of unclaimed records in twelve hours from at least two authors, each resolved by an asking round, with a fourth seat holding clean work uncommitted meanwhile so as not to sweep the others. The expert seat then established by complement enumeration that the shared tiers' frontmatter grammar carries exactly three keys and no authorship key at all, so a practice fix has nowhere to stamp; the field has to be born in the authoring grammar.

A second gap sits in the same tier. The anchor verb records which files a project-tier record is about and reports drift when they change, and it refuses the two shared tiers on the ground that they have no root and no tree. A machine-scoped operator-tier record asserting a fact about a file inside the store has a root: the store is a git repository, and the record and the file it describes sit in one tree. The tier holding a machine's hard-won, machine-specific facts is therefore the one tier with no drift detection, and one such record went false a day after it was written, sat unchallenged for three days, and was republished onto a board in three places.

When this plan is done: every shared-tier record written by `memq add-type` or `memq add-operator` carries an `author:` field the CLI writes, every read surface that prints a record's provenance prints it, and the project-tier guard accepts the same field at the write door; a machine-scoped operator-tier record can anchor a path that resolves inside the store root, with the same drift readings the project tier gets; and one pin settles the open question whether a `.md.bak` beside a live `.md` can shadow it.

## Evidence

- `kaizen/notes-SCOTT-CLAUDE.md` 2026-08-30, the authorship note, its refinement, and the expert seat's correction establishing the closed three-key grammar (`tags:`, `machine:`, `supersedes:`) and the three-layer door model (guard on the shared tiers, discipline on the shell channel, inert past the readers).
- `kaizen/notes-ASR-CLAUDE.md`, the second note: drift detection scoped to tier rather than to whether the record makes a checkable claim, with the observed false record about a board's sync exclusion.
- `kaizen/notes-SCOTT-CLAUDE.md` 2026-08-30, the `.md.bak` note: confirmed that a `.bak` alone resolves as a record on the memq of that date, and not tested whether it shadows a live sibling. The memory-system skill now states `.md.bak` is outside the memory-filename grammar and swept by no listing; the pin in section 3 is what turns that statement into a test.
- The memory-system skill's frontmatter rules: fields read at the top level and under `metadata:`, the guard's `MEMQ_FIELDS` placement check, and the `machine:` field's identifier gate (`plugins/claude-kit/skills/memory-system/SKILL.md`, the sections "Where a hand-written frontmatter field lands", "The `machine:` field", and "The frontmatter guard").

## Decisions

Decided 2026-09-02 by the Expert seat under standing adjudication; reversible at arming.

1. **The field is `author:` in the frontmatter, written by the CLI, and it is provenance rather than credential.** Its value is the calling session's registry name where a registry entry exists for the session id in the shell environment, and the session id otherwise; both are unauthenticated, and the field narrows an honest writer without authenticating one, exactly as `machine:` does. Alternative: a sidecar beside the record, declined because a field that travels with the record survives every rename and archive move the tiers already perform.
2. **The project tier takes the field at the write door as optional, never required.** The guard validates its placement like every other memq field and refuses nothing for its absence, because the Write tool is the sanctioned project-tier authoring path and a required field there would refuse every record the harness's own memory feature writes.
3. **Store-relative anchors are admitted for a record carrying `machine:` matching this host.** The anchor verb resolves a path against the store root for such a record and refuses every other shared-tier record as today, so a path is anchored only where the machine that wrote the fact is the machine reading the tree. Drift surfaces report the operator tier only on this host and say `not checked (record is scoped to another machine)` elsewhere.

## Sections of Work

### 1. The `author:` field. Model: opus

`memq add-type` and `memq add-operator` write `author:` at the top level beside `tags:`; `--update` leaves it as written, since it records the creating writer. `get`, `recall`, and `find`'s lexical block print it where they print provenance. The frontmatter guard adds it to `MEMQ_FIELDS` with the placement check and no value rule beyond the record-name charset. The memory-system skill's reference table, its frontmatter-field section, and its "shared store with no authorship" reasoning are updated to state the field, its source, and its ceiling. Tests: a created record carries the field with the registry name where an entry exists and the id otherwise; `--update` preserves it; the guard accepts it at the top level and under `metadata:` and refuses it under any other key.

Acceptance: tests green and watched red first; `node --test test/memq*.test.js test/memory-frontmatter-guard*.test.js` green with delta named against a recorded baseline; skill text updated with no em dashes.

### 2. Store-relative anchors for machine-scoped operator records. Model: opus

`memq anchor --operator <name> <path>...` is admitted where the record's `machine:` matches `os.hostname()` caselessly, resolving each path against the store root and refusing a path outside it under the existing anchor grammar; every other `--operator` and every `--type` call refuses as today with the refusal naming the machine rule. `get`, `decay-scan`, and `recall` report drift for those records on the matching host and the not-checked cause on any other. The session-start drift line counts them under its own bound. Tests over a fixture store: anchor admitted on a matching host, refused on a non-matching one, drift reported when the anchored store file changes, not-checked reported off-host.

Acceptance: the four tests green, watched red first; the memory-system skill's anchor section updated; targeted lane green with delta named.

### 3. The backup-shadow pin. Model: sonnet

One test: a live `<name>.md` beside a `<name>.md.bak` with different bodies resolves to the live body on `get`, appears once in `recall`, and the `.bak` alone, with the `.md` removed, resolves to nothing. Where the third case fails, the section stops and reports rather than fixing, since the fix belongs to the listing grammar the memory-system skill already claims.

Acceptance: the pin green, or a Chapter naming the failing case with the listing code it points at.

## Out of Scope

- Authenticating any writer. Provenance only.
- Cross-tier anchors and anchors on non-machine-scoped shared records.
- Rewriting existing records to add the field; they stay unclaimed by construction and the skill says so.

## Related

- Kaizen triage record `kaizen/archive/2026-09-02-pass-triage.md`.
- `claude-kit_liveness-by-session-identity_spec_v1.md`: the same "narrows an honest writer" ceiling applied to the coordinator directory.
- `../archive/claude-kit_write-time-neighbours_spec_v1.md`: the pre-lock neighbours block on the same two creation paths this plan's `author:` field is written on.
