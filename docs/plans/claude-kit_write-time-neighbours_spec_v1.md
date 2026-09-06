# The store's authoring verbs show a record's nearest neighbours before writing it, and the decay scan nominates live pairs that read as one fact

Status: In Progress
Commit Model: Commit-and-Push
Created: 2026-09-04

Session model: any executor session in the kit repo; the sections below run in order, since the decay scan reuses the pairwise reading the authoring verbs introduce, the skill documents both, and the index work closes what the first section's own budget cannot. Authored by the KIT: Expert seat on a capability gap the operator proposed and the NEO-CLAUDE coordinator seat captured to the kaizen inbox (kaizen/notes-NEO-CLAUDE.md, the 2026-09-04 note on the absent write-time duplicate check), forwarded by the operator at the keyboard. Anchors are authoring-time and named by function; re-locate every hit by content.

## Dispatch Authorization

Authorized 2026-09-04 by the operator at the keyboard of the KIT: Expert session and placed 2026-09-05 by the operator on the allowlisted relay thread: armed onto the kit worker's queue third, behind the endpoint-dialect-key plan, the grant covering any session holding this plan. The keyboard instruction of 2026-09-04 also authorized drafting the spec at the proposal's recorded shape. The Expert seat authored the spec, and the arm rests on the operator's own two instructions rather than on this section, so author and warrant are different parties.

## Goal

The memory store's search is strong, and its write path consults none of it. `memq add-type` and `memq add-operator` take a name, a description and a body and write them under the tier lock, and the only duplicate check on that path is an exact-name collision, so a record that says what an existing record already says is authored against the author's own recall rather than against the store, and the overlap is noticed later, by a reader who happens to search first, or never. One session on one seat showed both outcomes with the search as the only variable: a record banked and found afterwards to overlap two existing records that covered part of it better, costing a repair, and a later write made unnecessary because the author searched first and found the fact already applied eight times. The operator tier alone holds 268 records carrying 1,080 read stamps, so the cost of an unnoticed overlap compounds with every reader. When this plan is done: the two authoring verbs run the store's own semantic search over the incoming name and description before writing and print the nearest live neighbours with their scores, flagging any at or above a floor as a likely overlap, and then write anyway; the decay scan reports live same-tier pairs at or above that floor as replacement candidates, nominating and never retiring; and the memory-system skill states both, and tells a project-tier author, whose Write no verb sees, to search first.

## Evidence

- `plugins/claude-kit/scripts/memq.js`, `cmdAddType` and `cmdAddOperator`: every validation runs before the tier lock is acquired, and the write is name, index line and record under the lock; the check the code comments call the duplicate check is `fs.existsSync` on the record's filename. Nothing on the path compares content.
- The same file, `semanticChannel`: the search's semantic block, an ordinary function in the same module scope as the two authoring verbs, so an authoring verb can call it in-process with no spawn; it lazily requires `memory-index.js`, which owns the embedder, the per-machine vector index and its absent and unusable degrades. Scores are cosine similarity from the embedder, printed raw per hit; the module's own known-answer control scores a paraphrase near 0.26 and an unrelated sentence near zero, and `SEMANTIC_FLOOR = 0.1` is the admission floor. The lexical block has no score, and the model-judged block has no number and sends the query and candidates off the machine.
- `cmdDecayScan` and `tierDecayCandidates`: hold each live record's name, description, tier, idle days, applied evidence, pin state and supersession label; they never require `memory-index.js`, so the scan has no similarity reading today and its only notion of replacement is the hand- or CLI-authored `supersedes:` pointer, which it nominates for archive whatever the idle clock.
- `plugins/claude-kit/hooks/memq-grant.js`: `find` is withheld from the fleet's prompt-free grant because it loads an embedder from a directory the command line does not name; `add-type` and `add-operator` are granted in their plain form with `--body-file`, a body-carrying `--update`, `--supersedes` and `--trigger` screened. No new flag is needed by this plan, so the screen is untouched.
- `test/memq.test.js`: `makeFakeEmbedder` and `withEmbedder` stand up a deterministic fake embedder under a temp module root, and every test runs embedder-absent by default; `test/memq-grant.test.js` is the fleet harness, whose `FLEET` constant is the engine store-signal pair. The project memory `memq-suite-has-two-store-harnesses` records which of the two refuses repair and delete.
- `plugins/claude-kit/skills/memory-system/SKILL.md`: the `add-type` and `add-operator` rows document every flag and refusal and no overlap check; the `decay-scan` row and the four-remedies paragraph describe supersession by pointer alone; no sentence tells an author to search before writing a shared-tier record.
- The project tier has no memq authoring verb: a project memory is written with the Write tool and screened only by the frontmatter guard, which checks shape and never content.

## Approach

Before the lock, on the creation path only, the two authoring verbs run the semantic channel in-process with the query composed by the index's own `embedText`, the composition every indexed record is embedded through, take the three highest-scoring live hits the search admits, ordered by raw similarity rather than the search's blended rank, across every tier and store the index reaches, archived records excluded and superseded ones labeled as the search labels them, and print them on stderr as a neighbours block: name, score, tier and store, `superseded` inside the provenance parentheses where a live record of its tier carries `supersedes:` naming it, a `machine:<scope>` segment where an operator-tier record is scoped to another box, and the word `likely overlap` on any hit at or above `NEIGHBOUR_FLOOR`. Then the command continues to its refusals and the write exactly as today. The block is three lines wherever the search admits three hits, so the floor is a label on a line the author already sees and never a gate. A `--update` runs no check: it repairs a record already there, whose neighbours were shown when it was written, and the record's own prior version would otherwise rank first against itself. Embedder absent or unusable: one line, `memq: neighbours not checked (<cause>); remedy: <remedy>; this check does not block the write`, the cause and remedy the search's own and the line reshaped because no lexical matches are served here. Whenever `KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT` is present at all, the honored pair deliberately not consulted, the check is skipped and one line names the variable that did it: the fleet grant withholds `find` because it loads an embedder from an unnamed directory, an in-process load inside a granted verb would route around that reason, and the stand-down keys on bare presence because it runs in the child while the grant is decided in the hook, so it must never be narrower than the grant condition. Around the hits the block also prints the shared fence line wherever a hit line follows, find's own rule; an expiry line in the not-checked shape when `NEIGHBOUR_TIMEOUT_MS` passes first; a partial-ranking line and a persist-failure line above the heading when the sweep behind the check was partial or could not write the index, both this tool's own words at column zero; and a count of retired records matching at or above the floor, which are never listed. The model-judged block is never used by an authoring verb, so nothing an author types leaves the machine.

The decay scan gains a pairs block on stderr after its anchor-drift block: for each tier the scan reaches, the highest-scoring live pairs at or above the floor, one line per pair with both names and the score, capped at `PAIRS_SHOWN` with a counted remainder because this is output a model reads and the candidate set grows with the square of a tier, pinned records listed, pairs already joined by a `supersedes:` pointer excluded since the store already holds their answer. It reads vectors from the index `memory-index.js` keeps and embeds what the index lacks the way the search does, so a scan on a freshly synced store still answers. It nominates and never moves: no `decay-prune` flag acts on a pair, and the remedy is the author's, a fresh record carrying `--supersedes`, a repair, or a delete, per the skill's four remedies. Embedder absent, or `KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT` present at all, or the sweep past `NEIGHBOUR_TIMEOUT_MS`: the block's heading says not checked and why.

`NEIGHBOUR_FLOOR` is one constant in `memq.js` beside the semantic constants, seeded at 0.30, above the 0.26 paraphrase control and well below the 0.59 the inbox note reports for a found duplicate. It is a seed rather than a measurement, tuned at a decay pass that has a pairs block to read, and the skill says so in the words the decay thresholds already use.

The surfaces that read or write a record's similarity were swept by a read-only scout over `memq.js`, `memory-index.js`, the hooks and the skill, searching for `duplicate`, `overlap`, `neighbour`, `similar` and `supersed`; every hit is either the exact-name check, the semantic constants, or the supersession machinery, all named above, and the Files in scope below are drawn from that return.

## Decisions

Decided 2026-09-04 by the Expert seat; reversible at arming.

1. **Warn, never refuse.** A refusal keyed on a similarity score blocks honest writes on a seed nobody has measured, and the author sees the neighbours either way; the proposal asked for exactly this.
2. **The floor is a seed at 0.30, and the block prints three lines whatever the scores.** The floor labels; it does not gate. Tune it at a decay pass with evidence, never widen speculatively.
3. **Semantic only; the judged block is never used by an authoring verb.** An authoring verb that posted a record's name and description to the model endpoint would add an egress the security model does not describe, for a ranking the author does not need; the lexical block adds nothing over a name-and-description query.
4. **Skip the check under the engine store signals rather than load the embedder there.** The grant's reason for withholding `find` is the load, and the check is a convenience the unattended vector can do without; the write still lands.
5. **The project tier is covered by instruction, not by the frontmatter guard.** The guard is a shape check at the write door of a PreToolUse hook; loading an embedder there would put seconds of latency in front of every memory Write for a check the author can run as `memq find` in their own words, which is what the skill will say.

## Standing Brief Amendments

Binding on every section opened after the entry's date, dispatched or inline. Section 2 inherits both.

1. amended 2026-09-05, at section 1's round-3 adjudication, on a consult ruling: a statement in
   `docs/security-model.md`, or in a hook's own code comments, that a section's code falsifies belongs to that
   section rather than to a later documentation section. Name the file on the section's `Files in scope:` line at
   the adjudication that finds it and make the statement true before the section closes. The reason is this
   plan's commit model: a Commit-and-Push section close pushes to main, which is this kit's install surface with
   no CI between a commit and a `claude plugin update`, so a section that publishes code while the security
   document describing it stays false publishes the falsehood. A merely absent sentence is not covered and may
   travel with the documentation section, the distinction being that a reader acts on a false statement and only
   lacks guidance from a missing one. For section 2 specifically: its pairs block prints record names from every
   tier the scan reaches on stderr, which is a further machine-wide emission path, so that path's row in
   `docs/security-model.md`'s fence table is section 2's to land, not section 3's. The prose above that
   table carries no count of its rows, deliberately, per amendment 2; do not reintroduce one.
2. amended 2026-09-05, at the same adjudication, then corrected the same day against the operator-tier memory
   `a-restated-count-is-a-cross-file-invariant`: a count restated in curated prose over a set defined
   elsewhere is an invariant with no keeper. Nothing merges it, no test asserts it, and a diff-scoped reviewer
   cannot see it falsified, because the stale sentence sits in a file the diff never touches. Three reviewers
   at full strength missed exactly this in section 1: `docs/security-model.md` read `Seven paths carry the
   memory tiers' content` over a table section 1 gave an eighth row. The repair is to delete the number, not
   to increment it, because incrementing leaves the next section to falsify it again: section 2 adds a ninth
   emission path and would have done exactly that. So when a section adds a member to a set some document
   enumerates, grep the curated documents for that set's count words and make the prose count-free, pointing
   at the enumeration as its source, unless a count can be pinned to something immutable such as a commit
   hash. The sweep is structural rather than phrase-driven: match every number word and digit across the whole document, adjudicate each hit against the class (a count over a set the sentence does not itself enumerate and that lives in another artifact), and record what was swept and any residual left unswept rather than calling the silence clean. Then run the same sweep over the repair's own output before the section closes. Section 1's first repair swept only the phrases it already knew, wrote two fresh counts of its own and missed a third that was stale in both its numbers; the structural sweep over the same file found them.

## Sections of Work

### 1. The two authoring verbs print a neighbours block before the write. Model: opus

`semanticChannel` already returns its hits and notes without printing, the printing living in `cmdFind`; call it from `cmdAddType` and `cmdAddOperator` on the creation path only, after every validation passes and before the lock, with the query composed by the index's own `embedText`, the composition every indexed record is embedded through, no tag, an empty already-shown set and the archive withheld, and order the hits by raw similarity. The channel is async by design, so the two verbs become async and `main`'s dispatch of them gains the same `.catch` backstop it gives `find`, with their usage and exit-code paths unchanged. Print the block on stderr in the shape `memq: nearest neighbours of <name>` followed by up to three lines `  <name>  <score>  (<tier>:<store>)[  superseded][  machine:<scope>][  likely overlap]`, the last label on any score at or above `NEIGHBOUR_FLOOR`, then a closing line where any hit carries the label: `memq: a likely overlap is a candidate for --supersedes, a repair, or a delete; this check does not block the write`. Embedder absent or unusable: `memq: neighbours not checked (<cause>); remedy: <remedy>; this check does not block the write`, the cause and remedy the search's own. `KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT` present at all: one line naming the variable that fired, ending `; this check does not block the write`, the pair's data gate deliberately not consulted so the child's stand-down is never narrower than the hook's grant condition. Where the search has not answered within `NEIGHBOUR_TIMEOUT_MS`, the not-checked shape prints with that as its cause. Above the heading, and only when the sweep behind the check was partial or could not persist the index, one line each says so in this tool's own words; after the hit lines, retired records matching at or above the floor are counted on one line and never listed; and the fence line prints over the hits wherever a hit line follows it. A `--update` prints no block. A hit is never the record being written, which does not exist yet on the creation path, and never an archived one. Every line of the block ends `; this check does not block the write` rather than promising the write proceeds, because refusals still sit between the block and the write: the `--supersedes` target is re-asserted after the block, and the tier lock can fail. The block is stderr only, so the success line on stdout is unchanged and every existing test of it stays green.

Acceptance, each test watched red first on the fake embedder harness: an `add-type` whose description paraphrases an existing same-tier record prints that record as a neighbour with a score at or above the floor and the label, then writes the record and its index line; the same with the neighbour in another tier and in another project's store prints its provenance; an add with no neighbour the search admits prints the heading and no lines and writes; an `--update` of an existing record prints no block; with the embedder absent the not-checked line prints and the write lands; under `test/memq.test.js`'s own engine-signal fixture the skip line prints and the write lands, and `test/memq-grant.test.js`'s plain-form `add-type` grant pin stays green; and a loopback endpoint fixture configured for the judged block records no request during an add, which pins Decision 3.

Files in scope: `plugins/claude-kit/scripts/memq.js`, `test/memq.test.js`, `test/memq-grant.test.js`, `test/size-budget.json` for the two test files' caps, and, folded in at the round-3 adjudication because this section's code falsified statements in them, `docs/security-model.md` and `plugins/claude-kit/hooks/memq-grant.js`.

Tests: lock that the block is stderr only and the write is never gated; lock the fleet skip in both directions; lock no egress. The expensive failure is a check that quietly refuses or quietly posts.

### 2. The decay scan nominates live pairs above the floor. Model: opus

In `cmdDecayScan`, after the anchor-drift block, print `memq: neighbour pairs (<tier>)` per tier the scan reaches other than the pending tier, which the index excludes and whose records await a verdict rather than a supersession, then the highest-scoring live pairs at or above `NEIGHBOUR_FLOOR` as `memq: pair  <name>  <name>  <score>`, capped at `PAIRS_SHOWN` with a counted remainder in the pinned block's shape and the pair count leading the heading, because this is output a model reads and the candidate set grows with the square of a tier, pinned records included and marked, pairs already joined by a `supersedes:` pointer in either direction excluded, pairs whose members carry differing `machine:` scopes excluded as well because one record per box is duplication by design, a scope printed on the line in the neighbours block's own segment, and `memq: no neighbour pairs (<tier>)` for a tier checked whole with none. Vectors come from the index `memory-index.js` keeps; a record the index lacks is embedded the way the search embeds it, and a record that cannot be embedded is counted on the heading, `memq: neighbour pairs (<tier>): <p> pair(s), <n> of <m> records not checked`. Embedder absent or unusable, the sweep past `NEIGHBOUR_TIMEOUT_MS`, or `KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT` present at all through the stand-down predicate the authoring verbs share: the heading reads `memq: neighbour pairs (<tier>): not checked (<cause>)`, the drift block's own idiom, and no pair lines follow. `decay-prune` is untouched: no flag acts on a pair.

Acceptance, watched red first: two live same-tier records whose bodies paraphrase each other print as one pair with their score; the same pair with a `supersedes:` pointer between them prints nothing; a pinned member prints with its mark; a cross-tier pair prints under neither tier, since a pointer cannot cross tiers and the remedy would have nowhere to land; with the embedder absent the heading names the cause; the scan's exit code and stdout are byte-identical to today's and every existing stderr block's text is unchanged, the new block following the drift block.

Files in scope: `plugins/claude-kit/scripts/memq.js`, `test/memq.test.js`, `test/size-budget.json` for its caps, and, under amendment 1 because `decay-scan` is a granted verb and this block makes it a further reach of the embedder load, `test/memq-grant.test.js` (the closure pin at its exact-set assertion), `plugins/claude-kit/hooks/memq-grant.js` (comments naming which paths reach that load), and `docs/security-model.md` (the closure sentence, the two stand-down entries, and this block's fence-table row, all main-thread writes), `plugins/claude-kit/skills/memory-system/SKILL.md` for the sentences this block falsifies (the `decay-scan` row's `Writes nothing` and the drift block's place in the order), the row's account of the block itself staying section 3's, `plugins/claude-kit/skills/finishing-work/SKILL.md` for its one sentence saying the scan only reports, and `docs/architecture.md` for the clause naming when the derived index is swept, which this block falsifies.

Tests: lock the exclusion of pointed pairs and the cross-tier silence; lock that nothing moves. The expensive failure is a pair nominated that the store already answered, which would teach a reader to skim the block.

### 3. The skill states both, and tells a project-tier author to search first. Model: sonnet
Locus: inline (writes under `docs/`, so the main thread authors it at the session's own model)

In `plugins/claude-kit/skills/memory-system/SKILL.md`: the `add-type` row gains a passage on the neighbours block, its floor, its stderr-only shape, its embedder-absent line and its fleet skip, and the `add-operator` row one sentence pointing at it; the `decay-scan` row gains the pairs block; the four-remedies paragraph gains the sentence that the scan nominates unlinked live pairs and that the remedy is the author's; the decay-lifecycle section's seeds-not-measurements sentence names `NEIGHBOUR_FLOOR` beside the thresholds it already covers; and the operator-tier and project-type-tier sections' authoring paragraphs gain the instruction to read the neighbours block before the write lands, with the project tier's own paragraph telling an author to run `memq find` in the words of the fact before a Write, since no verb sees that write. The skill is a measured file under the size ratchet, so its cap is raised in this section's diff; `docs/` is not measured.

Files in scope: `plugins/claude-kit/skills/memory-system/SKILL.md`, `test/size-budget.json`, `docs/security-model.md` for the sentence saying only the authoring verbs' check stays off the model endpoint, absent rather than false on the pairs block and travelling here under amendment 1, `docs/fleet-integration.md`, whose account of the prompt-free grant's rationale is absent rather than false on the point section 1 changed (the two authoring verbs now reach the embedder load the grant's reasoning once withheld to `find` alone, and stand down on bare `KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT`), so amendment 1 lets it travel here and it would otherwise sit in no section's scope.

### 4. The index honours the cancellation the neighbours check sends, and exports the composition it owns. Model: opus

The neighbours check and the decay scan's pairs block both bound their wait at `NEIGHBOUR_TIMEOUT_MS` through one shared race, the first also aborting the ranking pass `memq.js` owns, and
`plugins/claude-kit/scripts/memory-index.js` honours no signal, so on an expiry the embedder load and store sweep run
on. `memq` sets `process.exitCode` and never calls `process.exit()`, and nothing in the path calls `unref()`, so that
abandoned work holds the process open after the block has already said the check was skipped: the author reads the
success line and the shell does not come back. Have `query`, `sweep` and `embedAll` accept `options.signal` and check
it between embed batches and before the search, returning the typed cancelled status the caller already reads as an
`off`. No new export is needed for that, `query` and `sweep` being exported already. Separately, export `embedText`
from the same module and compose the neighbour query through it, which removes the hand-rolled `<name>: <description>`
join in favour of the index's own name rewrite; the second component still differs by design, the index embedding a
record's body where this caller holds only the description, so this narrows the gap rather than closing it.

Acceptance, watched red first: an expired neighbours check, and equally an expired pairs block on `decay-scan`, leaves no embedder work running, read as the process
exiting rather than as elapsed wall clock, with the signal check disabled as the control that the reading can speak;
a cancellation landing between embed batches stops the remaining batches; a search that is never cancelled is
unaffected in its hits, its notes and its persisted vectors; and the neighbour query composes byte-identically to
what `embedText` produces for the same name.

Files in scope: `plugins/claude-kit/scripts/memory-index.js`, `plugins/claude-kit/scripts/memq.js`,
`test/memq.test.js`, `test/size-budget.json` for its caps; folded at review: `test/memory-index.test.js`,
`test/memq-grant.test.js` (the load-site roster pin), `plugins/claude-kit/skills/memory-system/SKILL.md` (the
decay-scan row this section re-opens).

Tests: lock that a cancelled query stops rather than finishing, in a shape that fails if the signal is ignored; lock
that an uncancelled query is unchanged. The expensive failure is a signal check placed where no realistic expiry
reaches it, which tests green and leaves the hang exactly where it was.

### 5. One emitter owns the cross-store hit line. Model: opus

Three producers now hand-compose the same fenced channel's hit line: `find`'s semantic block, `find`'s model-judged
block (`judgedHitLine`), and the authoring verbs' neighbours block, and they have already drifted in format, the
judged line printing supersession inside the provenance parentheses where the other two print it as a separate token.
A sanitizing guard is a property of the output channel rather than of the producer that first needed it, so the
moment a channel gains a second producer the guard moves to a shared boundary as an exported helper, and this channel
has three. Extract one hit-line composer that takes a hit and the field flags each producer needs (score, `superseded`,
`machine:`, the overlap label, the retired label) and returns the line, with every charset reduction and cap inside
it, and route all three producers through it. Format differences that are deliberate per surface stay as flags; the
supersession placement is reconciled to the labels inside the provenance parentheses, which two of three already print (find's semantic and judged lines; the neighbours block alone printed a separate token), and the `retired` and `superseded` labels are properties of the hit rather than flags, printed wherever the hit carries them. The same channel's partial-sweep line has a third producer too: `find`'s semantic channel composes its own, and it still counts an unscannable directory as a record where the helper the authoring and decay blocks share now names directories and records apart; route it through that helper in this section.

Acceptance, watched red first: each producer's existing line tests stay green through the extraction; a byte-level
pin holds the three producers' lines identical for the same hit and the same flags; and a hit whose name or machine
value carries a character outside the store's identifier gate is reduced identically on all three surfaces, pinned
by driving each surface rather than by calling the helper directly.

Files in scope: `plugins/claude-kit/scripts/memq.js`, `test/memq.test.js`, `test/size-budget.json` for its cap.

Tests: lock the three surfaces' lines byte-identical for one hit; lock the reduction on each surface. The expensive
failure is a helper extracted and then bypassed by one producer, which tests green on the two that use it.

## Out of Scope

- Refusing a write on a similarity score, and any `--no-neighbours` or threshold flag (Decisions 1 and 2), so the fleet grant's screen is untouched.
- A content check inside the frontmatter guard (Decision 5).
- Using the lexical or the model-judged block in an authoring verb (Decision 3).
- Cross-tier supersession, which the store does not have; a cross-tier pair is reported nowhere by section 2 for that reason.
- A one-time sweep dispositioning the pairs the first scan reports across the 268 operator-tier records; that is a decay pass's adjudication, run at a close-out by the kaizen or finishing skill's own trigger.

## Assumptions

- assumed 2026-09-04 (default): Commit-and-Push, the kit's default and the worker queue's model; reversal: a header edit before arming.
- assumed 2026-09-04 (source: the scout's read of `memq.js`'s semantic constants and their known-answer control): 0.30 is a defensible seed for `NEIGHBOUR_FLOOR`; reversal: one constant, retuned at a decay pass.
- assumed 2026-09-04 (source: the scout's read of `memq.js`'s module scope): the semantic channel is reachable in-process from the authoring verbs without an export, so the check adds an embedder load per add and no spawn; reversal: none, the cost `find` already pays.
- assumed 2026-09-04 (source: the size-ratchet section of `claude-kit_subtraction-bars_spec_v1.md`): `test/size-budget.json` is on main before this plan runs, so each section raises its test and skill caps in its own diff, a cap being that file's line count for the file and the ratchet a test that fails on any measured file over its cap or absent from the budget; reversal: where the budget is absent, the clause is moot and the Chapter says so, and where it is present but untracked, it is a peer's in-flight work, so the section holds its cap edit rather than staging a file it did not author, names the hold in its Chapter, and lands the raise once the budget is on main.

## Operator Verification

None. The floor's first tuning is a decay-pass judgment the skill already routes.

## Open Questions

None.

## Related

- `docs/archive/claude-kit_memory-supersedes_spec_v1.md`: the `--supersedes` pointer and its four-remedies routing that section 2's nominations resolve into.
- `docs/archive/claude-kit_memory-recognition-reach_spec_v1.md`: the semantic index and embedder machinery section 1 reuses.
- The kaizen inbox note dated 2026-09-04 in `kaizen/notes-NEO-CLAUDE.md` on the absent write-time duplicate check, which this plan dispositions.

## Chapters

### Interim board 1 - 2026-09-05

Written at a closure drought rather than at a section close: two review-round adjudications have passed with
section 1 still open, and the compaction gate was holding an offer. Section 1 is not complete and this entry
carries no `Completed:` line.

Stage, section 1 (the two authoring verbs print a neighbours block before the write): implemented and green on
its targeted lane, three review rounds run, round 3 adjudicated. Not closed. Rounds 1 and 2 were the section's
own review and its fix round; round 3 was a fix-delta round owed because the delta changed the guard deciding
whether this CLI loads an embedder out of a directory the command line does not name, which is load-bearing for
a prompt-free command grant. Round 3 returned CHANGES_REQUIRED, CHANGES_REQUIRED and BLOCK from the adversarial,
blind and security lenses, all three resolving wholly to `claude-opus-5` at effort `max` with zero synthetic
assistant lines: 1 Critical, 5 Majors and 10 Minors, every one of which this session verified at its cited
source before recording it here.

Live dispatches: none. Implementer `a9d73328b0515c6a9` (implementer-opus) returned DONE_WITH_CONCERNS on the fix
round; workflow run `wf_27fa6754-7c1` returned all three lenses. Nothing is in flight, so this entry strands no
agent.

Gate baseline, with the moment each figure was measured. Targeted lane `node --test test/memq.test.js
test/memq-grant.test.js test/size-ratchet.test.js` read 807 tests, 807 passing, 0 failing, 0 skipped at exit 0
from the run's own marker file, measured 2026-09-05 at roughly 18:40Z by the dispatched implementer on the tree
it delivered. That figure is reported from that dispatch rather than confirmed here: this session has not re-run
the lane on the delivered tree, and doing so is the first step after the fixes below. The lane immediately before
the implementer's last fix read exit 1 with 805 passing and 2 failing, both failures caused by that round and both
fixed rather than suppressed, which is the delta the 807 stands against. The whole-gate baseline this plan will
be read against is the one plan 2 closed on: 3128 tests, 3118 passing, 1 failing, 9 skipped at exit 1, measured
2026-09-05, whose single failure is this box's standing red at `test/memory-session.test.js:993`.

Rulings adopted since the last boundary, all four this session's own:

1. The escalation ladder's comparison was run and the tier bump was deliberately not spent. Two rounds have ended
   with a surviving Critical, which is the ladder's trigger. The two Criticals are different classes and round 1's
   fixes held, but two finding classes do repeat: a dead finiteness guard this session's own round-1 brief asked
   for by a loose analogy, and the class of a documented claim this section falsifies sitting in a file the section
   does not own. The second is the dominant generator and no implementer tier can close it, the implementer having
   been correctly told those files are section 3's and correctly leaving them alone, so a fable re-dispatch would
   reproduce the finding rather than fix it. The ladder's own alternative is taken instead: a consult on the spec's
   premise, that section 1 changes the code while section 3 documents it, under a commit model whose section close
   pushes to main.
2. Section 3 was amended mid-run to route two surfaces section 1's execution falsified, `memq-grant.js`'s two
   comments about `find` being the one path loading code out of an unnamed directory, and a `docs/security-model.md`
   fence row for the neighbours block's machine-wide emission. That edit sits above `## Chapters` and is therefore
   approval drift, recorded here and named to the operator.
3. Round 3's Critical is not eligible for that routing. A Critical is fixed before the section closes whatever its
   scope, so `docs/security-model.md`'s grant-invariant sentence is repaired as part of section 1 rather than
   deferred to section 3, and section 1's `Files in scope:` widens to name that file.
4. This entry is not committed on its own. Under Commit-and-Push a doc commit to main would earn the whole gate
   ahead of it, and spending a 462-second suite on an interim entry, then a second one at the section close,
   buys nothing the worktree does not already give: a post-compaction session re-reads this plan doc from disk,
   so the entry's recovery job is served uncommitted. The entry rides with section 1's close commit instead. What
   that trades away is crash durability for this entry alone, which is named here rather than left implicit.

Next action, section 1: convene the consult on the premise above; then fix the Critical and the five Majors and
adjudicate the ten Minors; then re-run the targeted lane in this session rather than trusting the reported 807;
then the whole gate, because the close pushes to main; then Chapter 1 and the close commit. Sections 2 and 3 are
unstarted and blocked on nothing but section 1's close.

### Interim board 2 - 2026-09-05

Written on the compaction gate's own signal, which had held 13 offers over 74 minutes, at the point where the
round-3 adjudication is complete and its rulings are landed. Section 1 is still open and this entry carries no
`Completed:` line. What makes it protective rather than ceremonial: two of the adjudications below reversed a
finding's rating on evidence read at source, and until they reached this doc they existed only in one session's
context, where a compaction would have taken them and left Chapter 1 unable to record them.

Stage, section 1: code delivered and green on its targeted lane, three review rounds run and adjudicated, the
document half of the section fixed in the main thread, the code half dispatched. Not closed.

Live dispatches: one. `implementer-opus`, dispatched 2026-09-05 at about 19:50Z, asked to fix the round-3 code
findings in `plugins/claude-kit/scripts/memq.js`, `test/memq.test.js`, `test/memq-grant.test.js` and
`test/size-budget.json`: cancel the orphaned embedder query after the neighbour check's timeout rather than only
stopping the wait; route the hand-built child environment at `test/memq.test.js:27867` through the suite's
`homeChildEnv` guard, which is the finding that could otherwise write into the operator's live store; add a test
that fires `printNeighbourBlock`'s catch; delete the dead finiteness branch together with its comment; compute the
retired-record count at `NEIGHBOUR_FLOOR` rather than at the 0.1 admission floor; make the block's
`the write proceeds` promise match what the code guarantees where it prints; and align the neighbour query's
composition with the index's own `embedText`. It was told explicitly not to touch `docs/security-model.md` or
`plugins/claude-kit/hooks/memq-grant.js`, both already corrected here, and not to run the whole suite. The
consult that produced ruling 1 below has completed and is not in flight.

Gate baseline, with the moment each figure was measured. Targeted lane
`node --test test/memq.test.js test/memq-grant.test.js test/size-ratchet.test.js`: 807 tests, 807 passing, 0
failing, 0 skipped at exit 0, measured 2026-09-05 at about 18:40Z by the round-2 implementer on the tree it
delivered, and still reported rather than confirmed, since this session has not re-run it; the round-3
implementer was told to re-establish its own baseline and report the delta rather than inherit that number. The
whole gate this section's close must pass, because the push lands on main: 3128 tests, 3118 passing, 1 failing, 9
skipped at exit 1, measured 2026-09-05 at plan 2's close, whose single failure is this box's standing red,
`a pinned directory too long to name faithfully stands the session down` at `test/memory-session.test.js:993`,
which fails because this machine's temporary directory is too short to build the path the test needs. That gate
now also owes a build-stamp regeneration ahead of it, since `plugins/claude-kit/hooks/memq-grant.js` is hashed in
`plugins/claude-kit/.claude-plugin/build-info.json` and this section edits it.

Rulings adopted since interim board 1, all five:

1. The escalation ladder's consult was convened and its ruling adopted. It ran at `claude-fable-5-1`, 26 assistant
   lines, zero synthetic, so it ran at full strength. It rejected the framing this session brought it, which had
   been to fold all of section 3's documentation into section 1, and showed that move is the larger one: the
   memory-system skill file carries no false sentence today, only absent ones, while `docs/security-model.md`
   carried three false ones. The line it drew, adopted here: a statement a section's code falsifies travels with
   that section, and a merely absent statement may travel with the documentation section, because a reader acts on
   a false statement and only lacks guidance from a missing one. It found no operator fork and said so.
2. On that ruling, section 1's `Files in scope:` widened to name `docs/security-model.md` and
   `plugins/claude-kit/hooks/memq-grant.js`, and section 3's narrowed back to the skill file and its cap, which
   reverts the amendment interim board 1 recorded as ruling 2. Section 3's body lost both its routing sentence and
   an earlier clause committing a `docs/security-model.md` edit, a clause the ruling's own prescription did not
   name and which would have left section 3 promising work in a file it no longer owns. Both edits sit above
   `## Chapters`, so both are approval drift, recorded here and named to the operator on the relay thread at the
   moment they landed.
3. A falsified sentence no review round found. `docs/security-model.md` opened its emission-path account with
   `Seven paths carry the memory tiers' content into a model's context` over a table section 1 gives an eighth
   row. Three reviewers at opus and effort max missed it, because a diff-scoped lens cannot see a count falsified
   in a file the diff never touches. The first repair here incremented the count and was itself wrong: the
   operator-tier memory `a-restated-count-is-a-cross-file-invariant` holds that such a count is an invariant with
   no keeper and that the repair is to delete the number rather than increment it, since the next section
   falsifies it again, and section 2 adds a ninth path and would have. Three clauses are now count-free and point
   at the table as their source. The memory is stamped applied. The `Standing Brief Amendments` block was written
   before that correction and told section 2 to update the count, which would have institutionalized the defect;
   amendment 2 now carries the delete-rather-than-increment rule instead.
4. A Major was down-rated to a Minor on evidence read at source, and the downgrade is named here rather than left
   quiet. A reviewer rated the neighbour check's skip predicate a Major on the argument that keying on the bare
   presence of `KIT_EMBEDDER_ROOT` is wrong because that variable selects no code unless
   `KIT_EMBEDDER_ROOT_ALLOW_CODE` is `1`. Reading `embedderRoot()` in `plugins/claude-kit/scripts/memory-index.js`
   splits the cases: with `ALLOW_CODE=1` the override is honored and the embedder does load from an unnamed
   directory, so the skip is correct there; without it the skip is broader than strictly needed but safe, and the
   breadth is deliberate, since the skip runs in the child while the grant is decided in the hook, so keying on
   presence is what keeps the child's stand-down no narrower than the hook's grant condition. The predicate stays;
   the comment overstating it is the Minor. The finding took no out-of-scope route, so nothing was parked by it.
5. A security Major was re-characterized, in the opposite direction from how this session first recorded it, and
   dispositioned as documentation because no code closes it. The concern was recorded as the widened skip failing
   to cover a dropped `KIT_MEMORY_ROOT_ALLOW_DATA`; the skip fires on bare `KIT_MEMORY_ROOT`, so that case is
   covered. The real residual runs the other way: a shell that has unset the store root since the grant was
   emitted leaves the hook granting from the harness environment while the child no longer stands down, and a
   child cannot read the hook's environment, so no code fix reaches it. It is now stated in
   `docs/security-model.md` as a residual of the same class that file already names for the interpreter pin, and
   in the hook's own comments beside it.

Not committed, deliberately, on the same reasoning interim board 1 recorded and for the same trade-off: under
Commit-and-Push a doc commit to main earns the whole gate ahead of it, and spending that suite on an interim entry
and again at the close buys nothing the worktree does not already give, since a post-compaction session re-reads
this doc from disk. A second reason applies now that did not then: an implementer is in flight with unstaged work
in the tree, so there is no clean commit to make. This entry rides with section 1's close commit. What that trades
away is crash durability for the entry alone, named here rather than left implicit.

Next action, section 1: await the implementer, take its first-turn reading at the first re-block past the
first-turn window, then adjudicate its report against source rather than accepting it; run the fix-delta round if
the delta earns one under the owed-round bar, which the abort work will likely trigger by touching the timeout
path; re-run the targeted lane in this session rather than trusting any reported figure; regenerate the build
stamp for the edited hook; run the whole gate with the contention lane beside it; then Chapter 1, recording the
`Status` normalization, the harness-assumption correction from round 1, every item above, and the reversal of
interim board 1's ruling 2; then commit, push, and open the checkpoint. Sections 2 and 3 are unstarted and blocked
on nothing but section 1's close, and section 2 inherits both standing amendments.

### Interim board 3 - 2026-09-05

Written at the round-4 adjudication, on the compaction gate's signal (20 offers held over 30 minutes). Section 1
is still open and this entry carries no `Completed:` line. It is protective rather than ceremonial for the same
reason board 2 was, and more so: round 4 produced three lens verdicts and a cross-lens disagreement this session
resolved on evidence, and none of that exists anywhere but here.

Stage, section 1: code delivered and green on its own lane in this session, four review rounds run and
adjudicated, the fix set for round 4 identified and not yet applied. Not closed.

Live dispatches: none. Implementer `ae10b387b370da54a` (implementer-opus) returned DONE_WITH_CONCERNS on the
round-3 fix set and its work is verified at source. Workflow run `wf_c0418195-028` returned all three round-4
lenses and has completed. Nothing is in flight, so this entry strands no agent.

Gate figures, each with the moment it was measured and by whom.

- Targeted lane `node --test test/memq.test.js test/memq-grant.test.js test/size-ratchet.test.js`: 809 tests, 809
  passing, 0 failing, 0 skipped at exit 0, duration 286s, measured 2026-09-05 at about 21:43Z by this session on
  this tree, the exit code read from the run's own `$?` written to a marker file. This is confirmed here rather
  than reported: it replaces the 807 that stood as a reported figure through boards 1 and 2, and the delta is +2
  tests, both new in the round-3 fix, with zero failures either side.
- Pin lane `node --test test/hook-canary.test.js test/doctrine-parity.test.js`: 121 tests, 121 passing, 0 failing,
  0 skipped at exit 0, measured 2026-09-05 at about 21:52Z by this session. This lane was owed and unrun through
  three boards. The targeted lane is derived from the section's file list, and section 1 only became a
  hook-editing and `docs/`-editing section at the round-3 adjudication, so the two whole-tree pins whose subject
  those files are were never in it: `hook-canary.test.js` pins every shipped hook's bytes against the build
  manifest, and `doctrine-parity.test.js` asserts real content in `docs/security-model.md`.
- Build stamp: `./build.ps1` run at 21:50Z, exit 0, 97 files. It was owed because
  `plugins/claude-kit/hooks/memq-grant.js` is hashed into the untracked
  `plugins/claude-kit/.claude-plugin/build-info.json`, and a stale manifest fails three `hook-canary` tests with
  nothing in `git status` to say so. Verified byte-for-byte after the build: the manifest's recorded SHA-256 for
  that hook and the file's live hash are both `26a8788b4606...`.
- The whole gate this close must pass, because the push lands on main: the standing baseline is 3128 tests, 3118
  passing, 1 failing, 9 skipped at exit 1, measured 2026-09-05 at plan 2's close, whose single failure is this
  box's standing red at `test/memory-session.test.js:993`, which fails because this machine's temporary directory
  is too short to build the path the test needs. Not yet re-run for this section.

Round 4 was owed rather than optional: the fix delta touched a write outside the tree (the hand-built child
environment that could otherwise have reached the operator's live store) and the store-root handling the
prompt-free command grant turns on. It ran three lenses at `claude-opus-5` effort `max`, the capped row for an
opus-tier section, all three with zero synthetic assistant lines, so it ran at full strength. Verdicts:
CHANGES_REQUIRED (adversarial), CHANGES_REQUIRED (blind), BLOCK (security). No Critical surfaced, so the tier
ladder is not triggered by this round.

Rulings adopted at this adjudication:

1. The blind lens's gravest finding was adjudicated down on the security lens's evidence, and the disagreement is
   recorded rather than smoothed. Blind rated the hook-versus-child divergence a Major and called it arbitrary
   code execution, the capability the verb list exists to withhold. The security lens read the predicates and
   cleared it: the grant requires `KIT_MEMORY_ROOT` truthy and `KIT_MEMORY_ROOT_ALLOW_DATA` equal to `1`, the
   child skips on truthy `KIT_MEMORY_ROOT` or truthy `KIT_EMBEDDER_ROOT`, both sides test the same truthiness so
   the empty-string case agrees too, and an environment-assignment prefix cannot reach the grant at all because
   the hook refuses any command whose first word is not `node`. The only divergence left is the persistent-shell
   case round 3 already dispositioned, whose precondition is no cheaper than the interpreter-pin residual the
   security document already accepts. The specialist lens is taken over the generalist here because it read the
   predicates rather than the comments. This matters procedurally and not just for the record: a security finding
   of Major weight may never be parked, so had it stood, this section could not have closed without either a code
   fix or a leading BLOCKED to the operator.
2. Amendment 2's own class recurred three times in one session, twice authored by the repair itself, so the
   generator is fixed rather than the sentences. The count-free sweep this session ran matched the specific
   phrases it already knew about (`Seven paths`, `Six of the seven`, `the seven above`) instead of the file's
   number words structurally, and it never re-read the text the repair introduced. The consequences: the repair
   wrote two fresh counts that section 2 falsifies, `exactly three entry points` in `docs/security-model.md` and
   `Three memq paths` in the hook's comment, since section 2's pairs block makes `cmdDecayScan` a fourth reach;
   and it missed `Those ten hops (the table's seven rows, plus ...)`, stale in both numbers, the table now
   carrying eight rows and the hops numbering eleven. Amendment 2 now requires the sweep to be structural over
   number words rather than over known phrases, and to re-run over the repair's own output before the section
   closes.
3. The round-4 fix set, adjudicated finding by finding against source rather than accepted from the reports.
   Confirmed and to be fixed before this section closes: the bare-`KIT_MEMORY_ROOT` skip line claims `under the
   fleet store signals`, a condition `storeSignalsPresent()` answers false for without the data gate, with a test
   pinning the false wording and the sibling branch naming its own variable correctly; the hook's header contract
   still says `find` is the only verb that loads an embedder, the one site of three this session's comment repair
   missed and the first an auditor reads; the residual sentence this session wrote into
   `docs/security-model.md` names the grant's store bound as what limits the two verbs, when in the very state it
   describes the store root has been dropped and `memoryRoot()` falls back to a directory under the caller's own
   home, so the named bound is precisely what is absent, and the sentence omits that the block would sweep and
   print the operator's real store into an unattended worker's context; both environment-variable entries still
   close `Set without its signal, it is ignored`, which this section's code falsifies on the authoring path; the
   new fence-table row claims the store-text emission is confined to the hit loop, while the persist-failure line
   prints a filesystem error carrying the index path at column zero above the heading and outside the fence,
   reachable with zero admitted hits; and the two counts and the missed hop count from ruling 2.
4. Three findings were routed out of section 1 rather than fixed in it, and none is a Critical or a security
   Major, which may never take that route. The cancellation's remainder inside `memory-index.js` is section 4,
   appended at the round-4 adjudication that preceded this entry and named to the operator on the relay thread at
   the moment it landed; the blind lens sharpened why it is owed, since nothing cancels the embedder load and
   `memq` sets `process.exitCode` rather than calling `process.exit()`, so an embedder that stalls leaves the
   command printing its success line and then hanging until a harness timeout kills it and reports a failure for
   a write that in fact landed. The hand-copied cross-store hit line is a third producer of one fenced channel,
   the judged line at `memq.js:6198` predating this plan, and it has already drifted in format, `find` printing
   supersession inside the provenance parentheses where the block prints it as a separate token; an extraction
   serving all three is wider than this section and needs its own acceptance, so it becomes its own section
   rather than folding. And `docs/fleet-integration.md`'s grant rationale is absent rather than false, which
   amendment 1 lets travel with the documentation section, so section 3 gains it rather than letting it fall off
   the plan.
5. Minors accepted with their justifications rather than fixed. The expiry case costs about 22 seconds of serial
   wall clock because the stub must outlast a bound the child cannot override; the cost is recorded here rather
   than removed. Live neighbours are paged at three with no count of what was cut while retired ones above the
   floor carry a count, which is a real asymmetry and a deliberate one: a retired record is withheld from the
   block entirely, where a fourth live record is merely below the page the spec fixes at three lines. The label
   is decided on the raw score while the figure prints at two decimals, so a score just under the floor prints as
   the floor without the label; comparing the rounded value instead would move the predicate, so the display
   stands and the reading is noted. And the sweep behind the check writes the derived index before the tier lock
   and before the refusals that can still stop the command, which is a real ordering fact about a derived,
   sync-excluded, self-healing sidecar rather than a defect in the store.

Not committed, deliberately, on the reasoning boards 1 and 2 both recorded: under Commit-and-Push a doc commit to
main earns the whole gate ahead of it, and spending that suite on an interim entry and again at the close buys
nothing the worktree does not already give, since a post-compaction session re-reads this doc from disk. The
entry rides with section 1's close commit. What that trades away is crash durability for the entry alone.

Next action, section 1: apply the round-4 fix set, the `docs/` half in the main thread because the docs-write
guard denies a subagent that write and the code half dispatched; strengthen amendment 2 per ruling 2 and re-run
its sweep structurally over `docs/security-model.md` including the repair's own output; reconcile the spec's
section-1 paragraph and Approach with what the code actually prints, which the round found drifted in five
places; then the targeted lane and the pin lane again in this session; rebuild the stamp again if the hook is
edited further; run the whole gate with the contention lane beside it, because the close pushes to main; then
Chapter 1 and the close commit. Sections 2, 3 and 4 are unstarted and blocked on nothing but section 1's close;
section 2 inherits both standing amendments, and section 3 has gained a file.

### Chapter 1 - 2026-09-05

Completed: 1. The two authoring verbs print a neighbours block before the write
Commit Model: Commit-and-Push

Shipped. `add-type` and `add-operator` call the semantic channel `find` already uses, on the creation path only,
after every validation and before the tier lock, and print a neighbours block on stderr: a heading carrying the typed
name, up to three hit lines (name, score, tier and store, `superseded` where the record points at a successor,
`machine:<scope>` where an operator-tier record is scoped to one box, `likely overlap` at or above `NEIGHBOUR_FLOOR`),
the shared fence line wherever a hit line follows, a retired-record count where retired records match at or above the
floor, two sweep lines above the heading when the sweep behind the check was partial or could not persist the index,
and a closing line where any hit carries the label. Every line ends `; this check does not block the write`, because
the `--supersedes` re-assertion and the tier lock still sit between the block and the write. The wait is bounded by
`NEIGHBOUR_TIMEOUT_MS` through an `AbortController` the ranking pass honours at its resumption; the embedder load and
store sweep in `memory-index.js` honour no signal, which is section 4. Two stand-downs, each printing one line naming
the variable that fired: bare `KIT_MEMORY_ROOT` and bare `KIT_EMBEDDER_ROOT`, keyed on presence rather than on the
honored pair so the child's stand-down is never narrower than the hook's grant condition. Nothing an author types
reaches the model-judged block. The files: `plugins/claude-kit/scripts/memq.js`, `plugins/claude-kit/hooks/memq-grant.js`
(comments only), `docs/security-model.md`, `test/memq.test.js`, `test/memq-grant.test.js`, `test/size-budget.json`, and
`kaizen/notes-SCOTT-CLAUDE.md` carrying two notes this session captured, both attributed to this session by sweeping the
harness transcripts for their text. Delivered in this changeset.

Rounds. Four: the section's review and fix round, then two fix-delta rounds. Round 3 (three lenses, opus, effort max)
found the orphaned embedder query the timeout left running and a hand-built child environment in the tests that could
have written into the operator's live store. Round 4 (same tiers) found the bare-store-root skip line claiming `the
fleet store signals`, a condition `storeSignalsPresent()` answers false for without the data gate; the hook's header
still calling `find` the only verb that loads an embedder; and in `docs/security-model.md` two `Set without its signal,
it is ignored` clauses the stand-down falsifies, the new fence-table row's claim that store text is confined to the hit
loop (the persist-failure line prints a filesystem error holding the index path at column zero, reachable with no
admitted hit), a residual sentence naming the grant's store bound as the limit in the one state where the root has been
dropped, the stale `ten hops, seven rows` tally, and the superlative the new row ties. All fixed here. A blind lens
rated the hook-versus-child divergence arbitrary code execution; the security lens cleared it at the predicates (both
sides test the same truthiness; `w[0] !== 'node'` refuses an environment-assignment prefix) and the specialist reading
was taken, which is recorded because a standing security Major could not have been parked.

Decisions and surprises. The plan's Approach and section-1 text drifted from the code in five places and were
reconciled to what prints. Amendment 2's own class recurred three times, twice authored by the repair, so the
amendment now requires a structural sweep over number words and a re-sweep of the repair's own output; the structural
sweep over `docs/security-model.md` returned 179 candidates, 20 outward-referring, all adjudicated as enumerated inline
or not a set, with one pre-existing count left and named (`:673`, `eleven surfaces ... ten of them`, enumerated beside
it, predating this plan). The implementer's sweep of `memq-grant.js` found seven same-file counts over `GRANTED_VERBS`
and the flag screen and left them, on the reasoning that amendment 2's defect is the cross-file case; adopted. Eleven
curly apostrophes at `docs/security-model.md:710-716` predate this plan and are left. A Minor to attribute the 0.59
figure was already satisfied at `memq.js:528-533`, which names it a seed rather than a measurement. Three findings
routed out: the cancellation remainder (section 4), the shared cross-store hit-line emitter, three producers already
drifted in format (new section 5), and `docs/fleet-integration.md`'s absent grant rationale (section 3's scope). The
build stamp had to be rebuilt twice, since it hashes hook bytes and nothing in `git status` shows it stale. A peer
session (AI-OS: Worker) asked after this session's heavy-process claim at twice its stated estimate; the estimate was
refreshed on disk and the peer waited, and it reported that its own implementer had earlier read the unrefreshed claim
as residue and returned rather than proceed, which the first kaizen note here already generalizes. This session's
model tag read Opus 5 at the round-4 dispatch and Fable 5.1 by this close, a switch the second kaizen note is about.

Gate. Targeted lane `node --test test/memq.test.js test/memq-grant.test.js test/size-ratchet.test.js`: 809 tests, 809
passing, 0 failing, 0 skipped, exit 0 read from the run's own marker, duration 226s, baseline on the same lane
809/809/0/0 at exit 0 before the round-4 fixes. Pin lane `node --test test/hook-canary.test.js
test/doctrine-parity.test.js`: 121/121/0/0, exit 0, after `./build.ps1` (exit 0) with the hook's SHA-256 verified equal
to the manifest's. Whole gate `node --test test/*.test.js`: 3147 tests, 3137 passing, 1 failing, 9 skipped, exit 1,
duration 507s, against the recorded baseline 3128/3118/1/9 at exit 1; the one failure is this box's standing red,
`a pinned directory too long to name faithfully stands the session down`, so the delta is +19 tests and the same
single known failure. Contention lane beside it: the process list polled clean of runners and builds before the spawn
and sampled mid-run, where every `node --test` child belonged to this gate.

Next: 2. The decay scan nominates live pairs above the floor. Both standing amendments bind it, and amendment 2 is
now the structural form. Sections 3, 4 and 5 follow in order.

### Chapter 2 - 2026-09-06

Completed: 2. The decay scan nominates live pairs above the floor
Commit Model: Commit-and-Push

Shipped. `decay-scan` prints a neighbour-pairs block on stderr after its anchor-drift block: per tier the scan reaches
other than the pending tier, a heading leading with the pair count and naming the records the check could not read
(`memq: neighbour pairs (project): 1 pair, 1 of 3 records not checked`), the highest-scoring live pairs at or above
`NEIGHBOUR_FLOOR` as `memq: pair  <name>  <name>  <score>[  pinned: <name>][  machine:<scope>]`, capped at
`PAIRS_SHOWN` with a counted remainder in the pinned block's shape, pairs joined by a `supersedes:` pointer in either
direction excluded, pairs whose members carry differing `machine:` scopes excluded as two facts by design, and
`memq: no neighbour pairs (<tier>)` for a tier read whole with none. A tier whose directory exists and cannot be listed
prints the drift block's own unexamined wording through a `tierRecordNames` helper both blocks now share. The vectors
come from the derived semantic index, brought up to date the way a `find` brings it up to date, which makes that
per-machine, sync-excluded sidecar the one file the scan writes. The wait is bounded by the race the authoring block
uses, extracted into `raceNeighbourTimeout`; the stand-down is the shared `pinnedRootStandDown` (bare presence of
`KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT`, wider than the grant condition by design); the partial-sweep and
persist-failure lines above the heading are composed by `sweepPartialLine` and `sweepPersistLine`, which both blocks
call. Each tier's lines compose into one write so a throw yields the whole tier or its not-checked heading, never
both. The pair lines print at column zero in the tool's own voice and unfenced, the shape of the pinned and drift
blocks beside them. The scan's stdout and exit code are byte-identical to before. `cmdDecayScan` is async and
`main` gives it the `.catch` backstop the authoring verbs have. Files: `plugins/claude-kit/scripts/memq.js`,
`plugins/claude-kit/hooks/memq-grant.js` (comments), `docs/security-model.md`, `docs/architecture.md`,
`plugins/claude-kit/skills/memory-system/SKILL.md` and `plugins/claude-kit/skills/finishing-work/SKILL.md` (sentences
the block falsified), `test/memq.test.js`, `test/memq-grant.test.js`, `test/size-budget.json`. Delivered in this
changeset.

Deviations from the approved spec, all above `## Chapters` and each named to the operator on the relay where the
broker accepted the message (two attempts at the cap notice were refused by the broker at about 00:23Z and are
recorded here instead). The pair list is capped at `PAIRS_SHOWN` where the spec said one line per live pair: all
three round-1 lenses and the file's own stated rule for model-read output that grows with the store called for the
cap, the operator tier alone being tens of thousands of candidate pairs; reversal is one constant. Pairs of differing
`machine:` scope are excluded, a rule the spec did not carry, because the store's one-record-per-box family is
duplication by design and the block's remedies would destroy one box's record. The pending tier gets no heading, the
index excluding it. The stand-down keys on bare presence rather than the engine store signals, section 1's adjudicated
rule. The heading carries a pair count and a denominator the spec did not spell. Section 2's `Files in scope:` widened
under amendment 1 to the closure pin, the hook's comments, the security document, two skill files and
`docs/architecture.md`; the `memory-index.js` clause was dropped, no export having been needed (`sweep` already
embeds what the index lacks). Section 4 gained the pairs block's sweep as a second caller of the embedder work
`memory-index.js` cannot yet cancel; section 5 gained `find`'s own partial line as a third producer of the shared
channel.

Rounds. Four: a three-lens round, a fix round, a second three-lens round over the fixes, a second fix round, an
adversarial lens over that delta, a third fix round, and a final adversarial lens over it, all at opus effort max.
Round 1 found the clean heading printed over a tier that could not be listed (Critical by the blind lens), the
unbounded wait ahead of the scan's own stdout, the unread partial-sweep counts, and the uncapped list. Round 2 found
the header contracts in `memq.js` and the hook still saying the scan writes nothing, the security document's fence
claim falsified by the unfenced row this section added, the row omitting its own sweep lines, the shared partial
line counting an unscannable directory as a record, and a weakened ordering pin. Round 3 found my own row sentence
asserting the stand-down equals the grant condition where it is deliberately wider, the pair line blind to
`machine:` scope, and no pin on the authoring block's partial line after the shared helper changed it. Round 4 found
the row omitting the `machine:` segment and the per-tier guard heading's failure text, and asked for the spec
deviations' record, which is this Chapter. All fixed here; the Minors accepted rather than fixed: a directory named
`<name>.md` inside a tier counts as a record the check could not read (pre-existing, shared with the drift block);
a second deliberately long expiry case (about 22 s) sits in `test/memq.test.js` beside section 1's, proving the scan
carries on to its candidate list after the bound; the skill's `decay-scan` row glosses the block in one clause,
which section 3 must not duplicate; the pairwise cosine pass after the bounded sweep is unbounded and grows with the
square of a tier, milliseconds at these sizes and noted in the constant's comment.

Named because it changed a closed section's product: the shared partial line the authoring block prints (section 1,
pushed at `ed264a6`) now names unreadable directories apart from records and appends the carried clause only when a
record was carried; a cross-surface pin holds the two callers' count clause identical. Named because it sits on the
close-out path until section 4 lands: on an expiry the scan prints its not-checked heading and continues, and the
embedder work runs on behind it, so a stalled embedder can hold the process open after the candidate list has
printed; section 4 is next and closes it for both callers.

Gate. Targeted lane `node --test test/memq.test.js test/memq-grant.test.js test/size-ratchet.test.js
test/hook-canary.test.js test/doctrine-parity.test.js` (the pin lane folded in, the hook and the security document
both being in scope): 948 tests, 948 passing, 0 failing, 0 skipped, exit 0 read from the run's own marker, 436 s; the same lane before the
three fix rounds read 941/940/1/0 at exit 1, the one red a skill word cap this session's own sentence raised and then
lifted. Build stamp rebuilt after each hook edit and the hook's SHA-256 verified equal to the manifest's. Whole gate
`node --test test/*.test.js`: 3165 tests, 3155 passing, 1 failing, 9 skipped, exit 1, 902 s, against the section-1 close baseline
3147/3137/1/9 at exit 1; the one failure is this box's standing red, `a pinned directory too long to name faithfully stands the session down`. Contention lane: the
process list polled before each spawn, one peer session (AI-OS: Worker) running builds and suites on this box under
its own claim in alternation with this session's, both sides waiting on the other's claim file and messaging at
release; two of this session's whole-gate runs took 646 s where the prior run took 507 s, with the peer's read-only
reviewers the only other load known, reported rather than measured.

Next: 3. The skill states both, and tells a project-tier author to search first. Then 4 and 5 in order. Section 3
must not duplicate the one-clause gloss of the pairs block already in the skill's `decay-scan` row, and gains
`docs/fleet-integration.md` for the grant rationale.

### Chapter 3 - 2026-09-06

Completed: 3. The skill states both, and tells a project-tier author to search first
Implemented By: main session (`Locus: inline`, the section writing under `docs/`; the session's own model, Fable)
Metrics: review rounds 3 (the pair, then one adversarial lens over each fix delta); NEEDS_CONTEXT 0; escalations 0;
consults 0
Decisions / Surprises: The section carried its `Model: sonnet` on the heading line and no locus, so a `Locus: inline` line
was added under it, and its `Files in scope:` widened to `docs/security-model.md` for the sentence saying only the
authoring verbs' check stays off the model endpoint (absent on the pairs block, travelling under amendment 1); both
edits sit above `## Chapters` and are approval drift by construction. The spec said the two authoring rows gain one
sentence each; the `add-type` row took a passage and the `add-operator` row one sentence pointing at it, and the spec
text was reconciled. The `decay-scan` row's one-clause gloss of the pairs block was replaced in place by the full
statement rather than kept beside it, per Chapter 2's constraint. Two lenses in two rounds attributed a reversed
`superseded` direction to the spec's Approach and section 1 body; both sentences were read and say the token is
labeled as the search labels it, so the spec was left alone and only the skill's clause was corrected, twice, the
second time for an ambiguous parse rather than a wrong claim. Chapter 1's own line carries the reversed wording and
stays, Chapters being journal. The KIT: Expert seat worked the same checkout throughout: it committed and pushed
6812993 and 3f375b6 under two announced windows (a Defender script, a new reviewer-uncap plan and two index lines),
cleared here since neither touched a file of this section, and left a third window's files dirty in the tree during
this section's gates, named on the Gate line; none of this section's five files carried content this session did not
write, re-read before staging.
Assumptions: (decided 2026-09-06, section 3) route (b): `NEIGHBOUR_FLOOR`'s numeric value is not restated in the skill,
the reader being sent to memq's source for it, on amendment 2's reasoning that a value kept elsewhere is unkept here.
Review Findings: Round 1 (adversarial and blind, both at fable, effort high): the add-type row's claim that every line
carries the no-block suffix (a Major on both lenses), its claim that the hit lines are drawn from the archive (a Major
on both), and the project-tier instruction equating `find`'s semantic block with the neighbours check (a Major on the
blind lens); Minors on the superseded and store fields, the conditional closing line, the machine-scope reasoning, a
twice-stated stand-down, the scan row's not-checked causes, the pinned mark's plurality, the security document's
mechanism wording and wrap, the fleet document's per-tier lines and creation path, and a past-tense seeds sentence.
All fixed. Round 2 (one adversarial lens over the delta): the `superseded` token described backwards (Major), the
lexical dedupe that withholds a `find` hit from the semantic block (Major); Minors on the machine-scope condition, a
missing failure cause, the two withheld-pair reasons, the count's wording and the block's shape. All fixed. Round 3
(one adversarial lens over that delta): the `superseded` clause readable as the pointer's mirror (Major, wording); the
two sweep lines, the conditional fence and the untiered failure line (Minors). All fixed in a delta of four clauses
read against the emitting lines by this session and not lensed again, an author re-read rather than a round.
blind: reviewed the skill and the budget file; docs/ paths withheld.
Stamps: adjudicated 2, stamped 1 (`forward-resource-arrangements-into-dispatch-briefs`, operator tier: every brief
carried the peer's heavy-process claim as a binding workspace constraint); skipped 1 (`vm-bringup-defender-exclusions`,
nudged by a diff of a peer's file this section never used).
Gate: Targeted lane `node --test test/size-ratchet.test.js test/doctrine-parity.test.js` (the two tests reading the
changed files): 149 tests, 149 passing, 0 failing, 0 skipped, exit 0 read from the run's own marker; the same lane read red three times mid-section on this skill's word cap,
lifted each time to the measured count (28224 to 28980), and once on two files of the Expert seat's in-flight window,
which that seat trimmed. Whole gate `node --test test/*.test.js`, run before the push because main is the install
surface: 3165 tests, 3155 passing, 1 failing, 9 skipped, exit 1, 451 s, against the section-2 close baseline 3165/3155/1/9 at exit 1; the one failure is this box's
standing red, `a pinned directory too long to name faithfully stands the session down`. Measured on the main checkout at HEAD e00d1e3 with no foreign dirty file beside this
section's five dirty files. Contention lane: the heavy-process claim read
before every spawn; the AI-OS: Worker seat held it for a section-8 lane and then a section-9 implementer, and this
session's whole gate started only once that claim had aged past its estimate, under a claim of its own, released after.
Next: 4. The index honours the cancellation the neighbours check sends, and exports the composition it owns. Then 5.
Commit Model: Commit-and-Push

### Interim board 4 - 2026-09-06

Written at section 4's round-1 adjudication, on the compaction gate's signal (30 offers held over 3 minutes).
Section 4 is open and this entry carries no `Completed:` line.

Stage, section 4: implemented by implementer-opus (dispatch `a79c16026cad12f26`, model override opus, first-turn
reading 43 assistant lines all `claude-opus-5`, zero synthetic), returned DONE_WITH_CONCERNS; verified at source by
this session (diff read, three end-to-end cases re-run here: 3/3 exit 0, both expiry cases exiting at 22 s where the
pre-change control was killed at the 40 s ceiling). Review round 1 run and adjudicated; the fix set is dispatched
and not yet verified. Not closed.

Live dispatches: the same implementer, resumed via SendMessage on `.kit/verify/s4-fix1-brief.md` (three Majors,
seven Minors, two extra files in scope: `test/memq-grant.test.js` and `test/memory-index.test.js`); its resumed
run read 45 assistant lines all `claude-opus-5` at the first-turn window. Workflow run `wf_7aaff9f0-fdf`
(adversarial-reviewer and blind-reviewer, both opus at effort max via the Workflow route, both read
`claude-opus-5` only) has completed.

Gate figures, each with its moment. Targeted lane `node --test test/memory-index.test.js test/memq-grant.test.js
test/size-ratchet.test.js test/doctrine-parity.test.js` after the grant-pin fold and the cap raise: 133/133 exit 0
on the ratchet and grant files (`.kit/verify/lane-s4b.exit`), following 242/241/1 exit 1 on the four-file run whose
one red was the grant test's line cap (`lane-s4a`). The implementer's own `node --test test/memq.test.js`:
697/697 exit 0, 264.9 s (`s4-memq.exit`), measured on the main checkout at HEAD f1b77fc with the section's own
files dirty and nothing foreign. Whole gate: not yet run this section; the section-3 close baseline is
3165/3155/1/9 exit 1 at HEAD e00d1e3, the one red the standing TEMP-path failure.

Rulings adopted since Chapter 3, all at round 1 against the code: (1) the cancellation comments and two test
titles overclaimed; the load is one uninterruptible await and the abort is read when it returns, so the wording
states that residual. (2) A cancelled sweep persists what it embedded, the module's own failed-record rule, against
the implementer's declared assumption that it writes nothing: at HEAD an expired check still wrote the index, and
discarding the work leaves a slow store never building one. (3) This session's own fold of the grant pin anchored
the neighbours block on the require, which loads no embedder; the pin now holds every load-reaching line after the
stand-down. Minors adopted: the unreachable cancelled branch in the pairs block deleted, the key-set pin derived
from a completed sweep, the stalled-load margin cut to 500 ms, a positive sidecar control beside the two absence
assertions, three comment corrections. The out-of-scope surface the implementer named (the grant pin) folded at
adjudication, `Files in scope:` to be widened at the Chapter. Security reviewer not dispatched: the product code
adds no boundary, and the test harness change reuses the suite's own spawner.

Next action, section 4: verify the fix delta at source, run one adversarial lens over it (the delta touches the
index's persistence rule, which the between-batches test exercises directly, so the lens is judgment rather than an
owed round), close gate on the targeted lane plus the full memq file, whole gate before the push, Chapter 4, commit,
push, checkpoint. Then section 5.

### Chapter 4 - 2026-09-06

Completed: 4. The index honours the cancellation the neighbours check sends, and exports the composition it owns
Implemented By: implementer-opus (dispatch `a79c16026cad12f26`, model override opus, first-turn reading all
`claude-opus-5`, zero synthetic, on the initial run and on both resumes)
Metrics: review rounds 2 (the pair at round 1; one adversarial lens over the fix delta at round 2), plus an author
re-read of the round-2 fix delta; NEEDS_CONTEXT 0; escalations 0; consults 0
Decisions / Surprises: The section's `Files in scope:` widened above `## Chapters` (approval drift, deliberate) with
three folds: `test/memory-index.test.js` (the index lane the spec's Tests line implies), `test/memq-grant.test.js`
(the load-site roster pin, which the neighbours block's new lazy require of memory-index reddened; folded by this
session at round-1 adjudication and hardened at round 2), and `plugins/claude-kit/skills/memory-system/SKILL.md`
(section 3's decay-scan row, which this section's expiry behaviour falsified: the step-5 re-open, corrected under
amendment 1's reasoning rather than routed). The persistence rule was decided at round 1 against the implementer's
declared assumption: a sweep cancelled after its embedding persists what it embedded, and at round 2 it also names
the records it never reached in `failed` with the reason `the sweep was cancelled before this memory was embedded`,
so a caller deriving partial from `failed` and `carried` reads a cancelled pass as partial. The embedder load is one
uninterruptible await: the abort is read where the load returns, at each batch boundary and between per-item
retries, and a stack that never resolves its load still holds the process open; the comments and both end-to-end
test titles state that residual. The pairs block's fall-through on a `cancelled` status rests on
`raceNeighbourTimeout` aborting and resolving EXPIRED in one timer callback; the dead branch stays deleted and the
dependency is stated at both sites. One observation left as is: `sweepPartialLine` would word a cancelled record as
unreadable or unembeddable, but no surface reads a cancelled sweep's facts today (the pairs block returns at its
expiry and the channel answers `off` first), so the wording is unreachable for that status and untouched.
The size ratchet measures test files in lines and skills in words; the initial brief said words for the test caps,
and the implementer used the tool's own measure. The two end-to-end expiry cases cost about 21 s each of serial
wall clock in `test/memq.test.js`, spec-mandated (the acceptance reads the exit, not elapsed time). The KIT: Expert
seat committed d496125 (the kaizen inbox only) to this checkout mid-section; none of this section's files carried
content this session or its implementer did not write, re-read before staging. Interim board 4 was written mid-section
on the compaction gate's nudge and rides in this commit.
Assumptions: (decided 2026-09-06, section 4) route (b): the new index-lane cases live in `test/memory-index.test.js`
and the process-exit cases in `test/memq.test.js`, each beside the harness it drives. (decided 2026-09-06, section 4)
route (b): the security reviewer was not dispatched; the product code adds no boundary and the test harness change
(`runHome`'s spawn-options argument, spread first so `homeChildEnv`'s `cwd`, `encoding` and `env` cannot be
overridden) reuses the suite's own spawner.
Review Findings: Round 1 (adversarial and blind, both opus at max via the Workflow route): the cancellation comments
and two test titles overclaiming the abort's reach (Major, both lenses); a cancelled sweep discarding its embedded
vectors (Major, both); the grant pin's neighbours-block anchor on a line that loads no embedder (Major, adversarial).
All fixed. Minors (unreachable branch, hand-written key set, stalled-load margin, missing positive control, three
comment corrections) all fixed. Round 2 (one adversarial lens at opus/max over the fix delta): a cancelled sweep's
unreached records absent from `failed` (Major); the pairs block's fall-through resting on an unstated cross-function
ordering (Major, comments at both sites); the memory-system skill's decay-scan row falsified (Major, folded); the
query cancellation test's second case never producing a partial index (Major, planted 40 and a third case added for
the pre-ranking check). Nine Minors (a false `exactly as find does`, an undercounted read-point list, embedText's
doc, the scope line, a self-comparing assertion, a same-verb positive control, the ceiling arithmetic, a structural
`/\bmi\./` pattern for the grant pin with a withheld control, a title possessive) all fixed. The round-2 fix delta
was read by this session against the code (noteUnreached, the skill sentence, the persistence comment) rather than
lensed again: its subject is exercised directly by the between-batches and query cases, each shown red then green.
blind: reviewed the six code and test files; docs/ paths withheld.
Stamps: adjudicated 4, stamped 2 (`size-ratchet-counts-words-after-the-frontmatter-strip`, project tier: the
skill cap raised to the ratchet's own reading; `proceeding-past-an-aged-claim-is-not-taking-it`, operator tier: the
close gate waited on the AI-OS: Worker seat's claim rather than writing beside it); skipped 2
(`coordinator-traps-ledger-maintenance`, `autocrlf-rewrites-a-file-without-changing-it`, both read by nudge, neither
steering).
Gate: Targeted lane `node --test test/memory-index.test.js test/memq-grant.test.js test/size-ratchet.test.js
test/doctrine-parity.test.js`: 242 tests, 242 passing, 0 failing, 0 skipped, exit 0 read from
the run's own marker (`.kit/verify/lane-s4c.exit`); the implementer's own runs of the same lane read 242/242 exit 0
after each fix round, reddening only on the size ratchet until the caps were raised to the measured figures. Full
`node --test test/memq.test.js`: 697 tests, 697 passing, 0 failing, 0 skipped, exit 0, 266 s, against the
implementer's 697/697 exit 0 at 264.9 s on the pre-fix tree. Whole gate `node --test test/*.test.js`, run before
the push because main is the install surface: 3174 tests, 3164 passing, 1 failing, 9 skipped,
exit 1, 517 s, against the section-3 close baseline 3165/3155/1/9 at exit 1; the one failure is this box's standing
red, `a pinned directory too long to name faithfully stands the session down`. Measured on the main checkout at HEAD d496125 with 1 foreign dirty files (ocs/plans/claude-kit_write-time-neighbours_spec_v1.md) beside
this section's eight dirty files. Contention lane: the heavy-process claim read before every spawn; the AI-OS: Worker
seat held it at the close (written 05:51:25Z, estimate 900 s); this session's gates started at 06:06:30Z once that
claim had aged past its estimate, proceeding past it rather than writing beside it, so the gates ran under no claim of
their own; the holder deleted its claim during the run. The process poll before the wait showed only the idle MSBuild
node-reuse workers.
Next: 5. One emitter owns the cross-store hit line. Then finishing-work.
Commit Model: Commit-and-Push

### Interim board 5 - 2026-09-06

Written at section 5's round-1 adjudication, on the compaction gate's signal (1 offer held). Section 5 is open
and this entry carries no `Completed:` line.

Stage, section 5: implemented by implementer-opus (dispatch `ad338b4aa9f1954c5`, model override opus, first-turn
reading 80 assistant lines all `claude-opus-5`, zero synthetic), returned DONE_WITH_CONCERNS; verified at source
by this session (the composer `hitLine` read whole, the three producer sites read, byte-level CR and dash checks
zero on all three files, the three new tests re-run here 3/3 exit 0). Review round 1 run and adjudicated; the fix
set is dispatched and not yet verified. Not closed.

Live dispatches: the same implementer, resumed via SendMessage on `.kit/verify/s5-fix1-brief.md` (three Majors,
five Minors). Workflow run `wf_4af1eadc-8d0` (adversarial-reviewer, blind-reviewer and security-reviewer, all opus
at effort max via the Workflow route; the two admitted lenses read 51 and 46 assistant lines all `claude-opus-5` at
the first-turn window and the third was queued behind them on this four-core box, per the operator memory
`a-queued-agent-looks-identical-to-one-that-never-started`) has completed.

Gate figures, each with its moment. The implementer's full `node --test test/memq.test.js`: 700/700/0/0 exit 0,
266.8 s (`.kit/verify/s5-memq.exit`), and `node --test test/size-ratchet.test.js test/doctrine-parity.test.js`
149/149 exit 0 (`s5-lane.exit`), both measured on the main checkout at HEAD 62d242f with the section's three files
dirty and nothing foreign; against the section-4 close's memq figure 697/697 exit 0 (three tests added). Whole gate:
not yet run this section; the section-4 close baseline is 3174/3164/1/9 exit 1 at HEAD d496125, the one red the
standing TEMP-path failure.

Rulings adopted since Chapter 4. (1) At the approach read, against the code: the spec's premise that two of three
producers print supersession as a separate token is inverted; find's semantic and judged lines both carry `retired`
and `superseded` inside the provenance parentheses (14 test pins) and only the neighbours block printed the token
(0 pins). Reconciled to the parenthesised form on the spec's own stated reason (the majority form), a route (b)
assumption; the spec's section-5 sentence was amended to match at this adjudication (approval drift, deliberate),
and all three lenses confirmed the resolution sound and fully applied. (2) The implementer's declared assumption
that `retired` and `superseded` are properties of the hit rather than flags, printed wherever the hit carries them,
is accepted with its reason (a dropped label reads as a live record) and recorded as a deviation from the spec's
flag list. (3) The acceptance's name-reduction case is unreachable on every surface (`isMemoryFilename` and
`mi.recordPath` gate every path a hit arrives by), and so is the implementer's machine-field substitute
(`machineIdentityOrNull` is strictly narrower than the display cap): the reachable in-composer reduction is the
store segment, which `isStoreSegment` admits to 260 characters and `tierProvenanceLabel` caps at 80, so the pin is
rewritten over that field on all three surfaces (round-1 Major). (4) Find's persist-failure note routed through
`sweepPersistLine` too, beyond the spec's partial-line instruction, inheriting the empty-sweep suppression;
accepted as intended with a positive find pin owed. (5) The skill's add-type row (line 30) and
`docs/security-model.md`'s neighbours row (line 58) enumerate the fields in the order the new line prints them and
are not falsified; no edit. Round-1 Majors: the reduction pin green at HEAD (ruling 3); a test comment placing the
identifier gate at display where it runs at admission; `sweepPartialLine`'s header miscounting its callers (the
amendment-2 class). Minors: an `!== null` scope guard that would print `machine:undefined` for a hit shape lacking
the field; the persist pin (ruling 4); a blocking `runHome` beside a live in-process server; one overstating test
comment; the pairs block's pre-existing gate comment. All adopted. The implementer's one outward emission is
recorded: while checking a newline count it ran `memq find` under its real HOME, which posted the query and ten
candidate records' names, tiers and descriptions to the operator's configured model endpoint, the call an attended
`find` makes; nothing to roll back, and the check was replaced by an in-suite assertion.

Next action, section 5: verify the fix delta at source, decide whether it earns a round of its own (the delta is a
test rewrite, comment repairs and one guard change; the store-segment pin exercises the composer directly), close
gate on the ratchet lane plus the full memq file, whole gate before the push, Chapter 5, commit, push, checkpoint.
Then finishing-work for this plan.

### Chapter 5 - 2026-09-06

Completed: 5. One emitter owns the cross-store hit line
Implemented By: implementer-opus (dispatch `ad338b4aa9f1954c5`, model override opus, first-turn reading 80 assistant
lines all `claude-opus-5`, zero synthetic; resumed once via SendMessage for the fix round)
Metrics: review rounds 1 (adversarial, blind and security lenses, all opus at max via the Workflow route), plus an
author re-read of the fix delta; NEEDS_CONTEXT 0; escalations 0; consults 0
Decisions / Surprises: The spec's premise was inverted at the approach read: find's semantic and judged lines both
carried `retired` and `superseded` inside the provenance parentheses (14 pins) and only the neighbours block printed
the separate token (0 pins), so the reconciliation went to the parenthesised form on the spec's own stated reason,
the majority form, and the section's sentence above `## Chapters` was amended to say so (approval drift, deliberate;
all three lenses confirmed the resolution sound and fully applied). The composer is `hitLine(h, flags)` with
`{ score, machine, overlap }` as flags and `retired`/`superseded` read off the hit; find's semantic line appends its
applied tokens after it, the judged line its why clause, the neighbours block passes the overlap flag. The
acceptance's name-reduction case is unreachable on every surface (`isMemoryFilename` and `mi.recordPath` gate every
path a hit arrives by), and so was the implementer's first substitute, the machine field (`machineIdentityOrNull`
is strictly narrower than the display cap); the reachable in-composer reduction is the store segment, admitted to 260
characters by `isStoreSegment` and cut at 80 by `tierProvenanceLabel`, and the pin was rewritten over that field on
all three surfaces with the cut read off the rendered line rather than mirrored from the cap. Find's persist-failure
note went through `sweepPersistLine` beside the partial line the spec named, inheriting the empty-sweep suppression,
accepted with a positive find pin. The size ratchet's cap rose to the tool's own reading. The implementer made one
outward emission, recorded here because it cannot be recalled: while checking a newline count it ran `memq find`
under its real HOME, which posted the query and ten candidate records' names, tiers and descriptions to the
operator's configured model endpoint, the call an attended find makes; nothing to roll back locally, and the check
was replaced by an in-suite assertion. Interim board 5 was written mid-section on the compaction gate's nudge and
rides in this commit.
Assumptions: (decided 2026-09-06, section 5) route (b): supersession reconciled to the parenthesised form, the spec
amended. (decided 2026-09-06, section 5) `retired` and `superseded` are properties of the hit rather than flags,
printed wherever the hit carries them, since a dropped label reads as a live record. (decided 2026-09-06, section 5)
find's persist note routed through the shared helper with its suppression. (decided 2026-09-06, section 5) find's
sweep subjects read `this search` and `these results`, in the register of the existing `this ranking` and `these
neighbours`. (decided 2026-09-06, section 5) the security reviewer was dispatched at round 1 because the section
touches the sanitizing boundary of an output channel.
Review Findings: Round 1: the reduction pin green at HEAD and duplicating existing coverage (Major, adversarial);
a test comment placing the identifier gate at display where it runs at admission (Major, all three); the
`sweepPartialLine` header miscounting its callers after the change (Major, blind). Minors: an `!== null` scope guard
that would print `machine:undefined` for a hit shape lacking the field; the persist routing untested in the positive
direction; a blocking `runHome` beside a live in-process server; one overstating test comment; the pairs block's
pre-existing gate comment. All adopted and applied; the memory-system skill's add-type row (line 30) and
`docs/security-model.md`'s neighbours row (line 58) were adjudicated not falsified, no edit. The fix delta (two test
rewrites each shown red, the store-segment one by bypass probe restored from a pre-probe copy and verified by diff
and md5, the persist one by pointing the assertion at the old wording; comment repairs; one guard) was read by this
session against the code rather than lensed again.
blind: reviewed the three code and test files; docs/ paths withheld.
Stamps: adjudicated 3, stamped 1 (`a-queued-agent-looks-identical-to-one-that-never-started`, operator tier: the
third review lens was read as queued behind the two admitted ones rather than never started); skipped 2
(`function-hooks-prototype-ships-behind-a-flag`, `forward-resource-arrangements-into-dispatch-briefs`, both read by
nudge, neither steering).
Gate: Targeted lane `node --test test/size-ratchet.test.js test/doctrine-parity.test.js`: 149 tests, 149 passing,
0 failing, 0 skipped, exit 0 read from the run's own marker (`.kit/verify/lane-s5c.exit`); the
implementer's own runs read 149/149 exit 0 after each round. Full `node --test test/memq.test.js`: 701 tests,
701 passing, 0 failing, 0 skipped, exit 0, 256 s, against the section-4 close's 697/697
exit 0 (four tests added net). Whole gate `node --test test/*.test.js`, run before the push because main is the
install surface: 3178 tests, 3168 passing, 1 failing, 9 skipped, exit 1, 388 s,
against the section-4 close baseline 3174/3164/1/9 at exit 1; the one failure is this box's standing red,
`a pinned directory too long to name faithfully stands the session down`. Measured on the main checkout at HEAD 62d242f with 1 foreign dirty files (ocs/plans/claude-kit_write-time-neighbours_spec_v1.md) beside
this section's four dirty files. Contention lane: the heavy-process claim read before the spawn and found empty, the
process poll showed only the Discord relays, the kit sidecar daemon, a `dsh web` and `ccstatusline`, this session's
claim written at 2026-09-06T11:27:16.487Z (estimate 1800 s) and released after the runs.
Next: finishing-work for this plan.
Commit Model: Commit-and-Push

### Interim board 6 - 2026-09-06

Written mid-finishing on the compaction gate's signal (2 offers held), at the adjudication of the finishing reviews.
No section is open; the plan is in its finishing pass and this entry carries no `Completed:` line.

Stage: finishing-work steps 1 to 3 done, step 4 (docs curation) next. Base ref derived by the Chapter walk:
3afe49702dc4598cd460da3621437c4bddd06b75 (parent of ed264a6, the first commit appending a Chapter); the changeset
listing against it carries sibling efforts' commits (reviewer-uncap, kaizen captures, fleet tooling) as expected
surfacings, and the effort's own files are the union of the five sections' `Files in scope:` lines plus the folds
recorded in Chapters 3 and 4. Step 1, qa-verifier (session model, no override): PASS on every acceptance clause of
all five sections with the test names as evidence; whole gate `node --test test/*.test.js` 3178 tests, 3168
passing, 1 failing, 9 skipped, exit 1 read from `.kit/verify/fin-qa-whole.exit`, 417 s, zero delta against the
section-5 close (3178/3168/1/9), the one red this box's standing `a pinned directory too long to name faithfully`
failure; the repo defines no separate contention-lane command, the machine-shared tests run inside the whole gate;
process poll clean; the heavy-process claim held by this session around the run and released after. Steps 2 and 3
in parallel, both at the session's own fable tier at the reviewers' frontmatter effort high, tree bracket clean on
both sides of each: security-reviewer CLEAR, no Critical or Major, two Minors; adversarial-reviewer
APPROVED_WITH_CONCERNS, no Critical or Major, five Minors, all six recorded deviations adjudicated justified.

Minors and dispositions. Security 1 (adopted): `docs/security-model.md` row 58 closed its stand-down clause as
"the grant condition" where row 59 and `docs/fleet-integration.md` say wider than it; reworded to row 59's form.
Security 2 (recorded, no edit): on the attended path an embedder load that never resolves keeps the process open
after the record is written; stated in the timeout constant's comment and Chapter 4, unreachable under the grant.
Adversarial 1 (adopted): `test/memq-grant.test.js` closure comment counted three roots where `ROOTS` holds four;
now names the array. Adversarial 2 (adopted, folded with security 1): row 58 described the `superseded` label as a
separate token and by the pointer's mirror; now the parenthesised label where a live record carries `supersedes:`
naming it. Adversarial 3 (adopted): a structural pin beside the section-5 byte pin asserting `tierProvenanceLabel`
is read at one site, inside `hitLine`, and that the three producers compose through it; shown red by the bypass
probe (`.kit/verify/fin-pin-red.exit` 1, `2 !== 1` on the label-site count) and restored from
`.kit/verify/fin-preprobe-memq.js` verified by diff and md5, green after (`fin-pin-green.exit` 0); the test-file cap
raised to the ratchet's reading. Adversarial 4 (adopted, approval drift above `## Chapters`, deliberate): the
Approach and section 1 still said the query `<name>: <description>` (section 4 routed it through `embedText`),
the separate token (section 5 reconciled it), and `one box` for the machine scope where the channel labels only a
foreign box; all three reconciled to the shipped behaviour. Adversarial 5 (adopted): `docs/architecture.md`'s sweep
sentence names the authoring verbs' check beside find and the scan. The security lens reported five dirty files
outside the effort at its read; this session's own tree captures before and after each round were clean and
identical, so that report is the session-start snapshot in the lens's context rather than a peer write. Targeted
lane after the fixes `node --test test/size-ratchet.test.js test/doctrine-parity.test.js test/memq-grant.test.js`:
204/204 exit 0 (`.kit/verify/fin-lane.exit`).

Two outward emissions on this pass, both the call an attended `find` makes: this session's own `memq find` for the
contention lane's definition posted its query to the operator's endpoint, the same act Chapter 5 records against
the implementer.

Next action: docs-curator (step 4), then the close-out Chapter, archive, backlog prune, index refresh, the handoff
gate, commit and push.
