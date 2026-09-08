# The suite is audited test by test, and every survivor names its contract

Status: Ready
Commit Model: Commit-and-Push
Created: 2026-09-03

Session model: an executor session in the kit repo, after `claude-kit_subtraction-bars_spec_v1.md` is Complete, since section 2 adjudicates against the retire classes that plan writes. Eight sections, tiers per section. Authored by the KIT: Expert seat from the operator's direction in the 2026-09-03 design dialog, which ranked it second in the cycle. It may run beside the corpus audit, whose tracked writes are a curated doc, the kaizen skill and a follow-on spec, and it runs before the corpus audit's follow-on cut plan, because the prose pins are tests and a prose cut with the pins still in place reds on every sentence. The kaizen skill is ratchet-capped, so both plans can hold `test/size-budget.json` dirty on one checkout at once; when they do, this plan runs the sync, naming the corpus audit's capped path beside its own, and its commit carries the budget, so the corpus audit lands no budget edit of its own while this plan holds the file.

## Goal

The suite is 96,900 lines and 3,034 tests across 52 files at HEAD, nearly two lines of test per line of product, with 183 count-pinning assertions and two files pinning prose wording. Nobody has audited it. When this plan is done every retained test has a recorded verdict naming the contract it pins under the earn rule, every test in a retire class is gone or merged, the whole gate is green with the same single permanent failure it carries today, the wall clock is recorded against the baseline, and the size ratchet's caps sit at the cut sizes so the suite cannot grow back without a deliberate edit.

## Approach

Three moves in order: measure, judge, cut. The census is a scratch instrument, because its heuristics are one-off and the ratchet already carries the recurring measurement. The judgment is per file and reads each test whole against the bar, because a retire verdict on a test that pins a real defect is the expensive mistake, and the earn rule's fourth class ("a defect that actually happened") is only visible from the test's introducing commit. The cuts are per file cluster, each one a section, so a bad cut is one revert and the gate runs after each.

Terms this plan leans on. The whole gate is `node --test test/*.test.js` run from the repo root, read from its own exit marker (the bare directory form dies on Node 24 before running anything). The suite's one permanent failure on this machine is the memory-session path-length test, "a pinned directory too long to name faithfully stands the session down", so the green condition everywhere below is that failure set and no other. The ratchet is the subtraction-bars plan's section 4: `test/size-budget.json` holds one cap per file, words for a curated file and lines for a test file, and `test/size-ratchet.test.js` fails any file over its cap, a test count riding the reading rather than carrying a cap of its own; it exists once that plan is Complete, which is why this plan waits on it. The retire classes are the classes stated under `## What retires a test` in `skills/testing-discipline/SKILL.md` under the kit plugin root, which owns them with their carve-outs; this plan adjudicates every test against that section as it stands rather than against a copy made here, because a copy drifts and a stale one deletes coverage that a repointed test would have kept. A plan-private referent is a test comment, name or assertion message that names a plan's own section or Chapter ("Section 3's pin case"), which no reader can resolve once the plan is archived.

There is no numeric target. The bar decides, and the number falls out. A target would push the adjudicator toward the count rather than the contract, which is the failure this plan exists to correct.

The clusters, by size at HEAD, with the tests each holds:

| Cluster | Files | Lines | Tests |
|---|---|---|---|
| memq | `test/memq.test.js` | 27,084 | 655 |
| goal and gate | `test/kit-compact-gate.test.js`, `test/kit-goal-lib.test.js`, `test/kit-goal-stop.test.js` | 17,530 | 296, 158, and the goal-stop count |
| sidecar | `test/kit-sidecar-battery.test.js`, `test/kit-sidecar-daemon.test.js` | 9,322 | 123, 189 |
| prose pins | `test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/hook-canary.test.js`, `test/readonly-agent-guard.test.js` | 8,273 | per census |
| memory | `test/memory-*.test.js` | per census | per census |
| the rest | every other file under `test/` | per census | per census |

A file joins the cluster whose name prefix it shares (`memq-*` with memq, `kit-sidecar-*` with sidecar, `memory-*` with memory), so the table's file lists are the anchors rather than the whole membership. The counts marked per census are read at section 1 rather than pre-written here.

## Sections of Work

### 1. The census

Model: opus

A scratch script at `.kit/scratch/test-census.js` walks every `test/*.test.js` and writes `.kit/scratch/test-census.md`: per file, the test count, the line count, the assertion count by class, the pin classes named as `testing-discipline` names them and read there with their carve-outs rather than restated here, beside a parity-pin class over a set held byte-identical by design and a residual behavioural class for what none of them reaches, the wall clock from one run of that file alone, and for each test the commit that introduced it, read by `git log -L` over the test's name line, since a file's own introducing commit says nothing about the 655 tests inside it. The test count is the count of call sites, the reading `test/size-ratchet.test.js` takes, and a call site inside a loop (`test/output-style-parity.test.js:193`, `test/kit-goal-lib.test.js:252`, `test/kit-sidecar-battery.test.js:794`, `test/docs-write-guard.test.js:183` are instances) is one census row with its runtime instance count recorded beside it, so the census sums to the run only once those instance counts are expanded; a generated site is one verdict at section 2. The census walks tracked files only; an untracked test file is reported by name and left out. The class heuristics are stated in the report's header so a reader can judge them. The Chapter carries the per-cluster totals and the whole-suite wall clock as the baseline every later section diffs against, each wall-clock figure carrying the box's process count and free memory at the run, since growth reads as a finding only at comparable contention; those totals supersede the figures in this plan's Goal and are the receipt on which the backlog's 2026-09-05 item, the one recording that the Goal's figures are outgrown, retires at section 8.

Acceptance: every tracked test file appears once; the per-file call-site counts, with each generated site expanded by its instance count, sum to the suite's own count from a whole run; every test carries an introducing commit, read past any rename of its name line; the wall clock is captured with the run's exit code from its own marker and the box's process count and free memory beside it.

Files in scope: none tracked. Scratch under `.kit/` only.

### 2. Adjudication

Model: fable

One dispatch per cluster, split into several by file region where a file is too long to read whole in one (memq is 27,000 lines) with one verdict file per source file either way, reading each test whole, never a diff, against the earn and retire classes in `testing-discipline/SKILL.md` as amended by the subtraction-bars plan. Each test gets one verdict in `.kit/scratch/test-verdicts/<file>.md`, and a generated site is one test here, carrying its instance count from the census: keep, naming the earn class and the contract in one line; retire, naming the retire class; merge, naming the surviving test; or repair, where the retire class names a repair and the contract still needs cover, per the preamble of `## What retires a test`, naming the stable form a wording pin is re-pinned on or the new home a moved contract's test is repointed at. A retire verdict on a test whose introducing commit names a defect is refused by the adjudicator and recorded as keep under the defect class. The two parity pins, `test/doctrine-parity.test.js` and `test/output-style-parity.test.js`, are adjudicated by coverage rather than by test: the verdict file names which pinned-copy sets each file covers, and a presence-and-tracking check or a pointer pin in either file stands or falls by the retire classes alone, where the backlog's 2026-09-04 item already classes two of the doctrine pointer pins' equality legs as duplicates of the whole-body identity pin and that classing stands. `test/hook-canary.test.js` and `test/readonly-agent-guard.test.js` take per-test verdicts like any other file.

Acceptance: every test in the census outside the two parity files has exactly one verdict; the verdict counts reconcile with the census over those files, with each of the two parity files reconciled instead by its coverage verdict, which lists the pinned-copy sets it covers and the tests it keeps by name; every keep names a contract; every merge names a survivor that is itself a keep; every repair names its stable form or new home.

Files in scope: none tracked. Scratch under `.kit/` only.

Tests: none. The verdict files are the section's artifact and section 8 preserves their summary.

### 3. The memq cut

Model: opus

Apply the memq cluster's verdicts: delete every retire, fold every merge into its survivor, re-pin or repoint every repair as its verdict names, and sweep the plan-private referents the backlog names (the 2026-08-26 item) out of the surviving comments, test names and assertion messages alike, since two of the fourteen sites sit in a name and an assertion message rather than a comment; the receipt is the item's defining grep returning only its three discounted hits. Run the whole gate. Lower the ratchet caps for the cluster's files to the new sizes through `kit-size.js sync` on those named paths.

Acceptance: the gate is green at the same failure set as the census baseline; the cluster's test count in the Chapter equals the verdict file's keep count plus its repair count, with a generated site counted once, and its line count is recorded beside it; the wall clock is recorded against the baseline with the box's process count and free memory at the run beside it.

Files in scope: `test/memq.test.js`, `test/memq-*.test.js`, `test/size-budget.json`.

Tests: the gate itself, read from the run's exit marker.

### 4. The goal and gate cut

Model: opus

As section 3, over the goal and gate cluster.

Files in scope: `test/kit-compact-gate.test.js`, `test/kit-goal-lib.test.js`, `test/kit-goal-stop.test.js`, `test/size-budget.json`.

### 5. The sidecar cut

Model: opus

As section 3, over the sidecar cluster.

Files in scope: `test/kit-sidecar-*.test.js`, `test/size-budget.json`.

### 6. The prose-pin cut

Model: fable

As section 3, over the prose-pin cluster, with the coverage verdicts from section 2 applied: the doctrine-parity file keeps its byte-identical copy pins and whichever presence-and-tracking checks and pointer pins the retire classes leave standing, loses the pointer-pin equality legs the backlog's 2026-09-04 item classes as duplicates, and loses or re-pins on a stable form every wording pin over a sentence that is not a pinned copy, as its verdict names. The reconciliation for the two parity files is by coverage rather than by keep count: the Chapter records, for each, the pinned-copy sets still covered and the surviving tests by name against the coverage verdict, in place of the keep-count equality section 3 states, and the per-test files in this cluster reconcile as section 3 does. `docs/architecture.md` describes both `test/output-style-parity.test.js`, by its named-test count and what those tests pin, and `test/hook-canary.test.js`, so those two descriptions are rewritten to what the files pin after the cut. This is the section that frees the corpus audit's follow-on plan to cut prose without a red per sentence, so its Chapter states which sentence classes are now unpinned.

Files in scope: `test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/hook-canary.test.js`, `test/readonly-agent-guard.test.js`, `test/size-budget.json`, `docs/architecture.md` (its two test descriptions only).

Tests: the gate, and a probe, not a committed test, that drifts one byte between the doctrine source (`plugins/claude-kit/skills/operating-instructions/SKILL.md`) and its mirror (`home/claude-kit-doctrine.md`), watches the surviving copy pin red, restores from the pre-probe copy and verifies the restore by diff; the probe is tree-mutating and so runs with no corpus-audit reader, and no other agent, dispatched against the tree while it runs; the Chapter records it.

### 7. The memory and remainder cuts

Model: opus

As section 3, over the memory cluster and then the rest, each with its own gate run and Chapter counts.

Files in scope: `test/memory-*.test.js`, every other file under `test/` the census lists, `test/size-budget.json`.

### 8. Re-baseline

Model: sonnet

The suite baseline memory (`suite-baseline-is-not-zero-fail`, in this project's memory tier outside the repository, read and written through `memq`) is updated to the cut counts. The testing-discipline skill's wall-clock baseline text, if it states one, is updated. The verdict files' per-cluster summaries are appended to this plan's final Chapter, so the record of why each survivor stays outlives scratch. The 2026-08-26 backlog item on plan-private referents is retired with receipts, the receipt being its defining grep returning only its three discounted hits over the cut tree, and the 2026-09-05 backlog item on this plan's outgrown Goal figures is retired with the census Chapter's totals as its receipt.

Acceptance: the memory body carries the new counts and the run they came from; both backlog items are in the Q3 snapshot; the caps of the files this plan cut equal their sizes at this section's commit, moved through `kit-size.js sync` on those named paths rather than a bare sync, which would move the caps of curated files this plan never touched.

Files in scope: `docs/backlog.md`, `docs/archive/backlog-2026-Q3.md`, `test/size-budget.json`, the project memory file by `memq`.

## Out of Scope

- Any prose cut. The corpus audit and its follow-on own those.
- Product code. A test that reveals a product defect while being read is routed to the backlog with the test kept.
- Test wall-clock engineering beyond what deletion buys.

## Assumptions

- assumed 2026-09-03 (default): no numeric cut target; the bar decides; reversal: state a target as an adjudication tiebreaker and re-run section 2.
- assumed 2026-09-03 (doctrine, `.kit/` scratch rule): the census and verdicts are scratch and only their summaries are committed, in Chapters; reversal: commit the verdict files under `docs/archive/`.
- assumed 2026-09-03 (default): a test whose introducing commit names a defect is kept whatever its shape, which is stricter than testing-discipline, whose retire preamble retires a test when the defect it would catch is already caught elsewhere; reversal: allow the adjudicator to retire it when the defect's cause is pinned by a sibling.
- assumed 2026-09-03 (default): the goal-stop file's test count and the memory and remainder clusters' counts are read at the census rather than pre-written; reversal: none, the census is the record.
- plan review 2026-09-08 (plan-reviewer at fable, effort high): 14 findings, 14 fixed, 0 assumed, 0 asked, 0 discarded.

## Related

- `docs/plans/claude-kit_subtraction-bars_spec_v1.md`: the retire classes and the ratchet this plan cuts against and re-baselines. Must be Complete first.
- `docs/plans/claude-kit_corpus-audit_spec_v1.md`: the prose audit; runs beside this plan, and its follow-on cut waits on section 6.
- Backlog item of 2026-08-26, plan-private referents in test comments: covered by sections 3 and 7, retired at 8.
- Backlog item of 2026-09-05, this plan's Goal figures outgrown by the tree: the census at section 1 is its receipt, retired at 8.
- Backlog item of 2026-09-04, the two doctrine pointer pins' equality legs as duplicates of the whole-body identity pin: its classing stands at section 2 and the legs go at section 6.
- `docs/archive/claude-kit_review-loop-exit_spec_v1.md`: the class-keyed exit for the review loop, and the parity pin over the class region's designed copy across executing-work and the two code-reviewer charters, which is the pin class this plan keeps; its section 4 made the size budget a ledger, so a cap this plan moves goes through `kit-size.js sync` rather than a hand edit.

## Open Questions

None.

## Chapters
