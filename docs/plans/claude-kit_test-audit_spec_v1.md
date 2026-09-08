# The suite is audited test by test, and every survivor names its contract

Status: Ready
Commit Model: Commit-and-Push
Created: 2026-09-03

Session model: an executor session in the kit repo, after `claude-kit_subtraction-bars_spec_v1.md` is Complete, since section 2 adjudicates against the retire classes that plan writes. Eight sections, tiers per section. Authored by the KIT: Expert seat from the operator's direction in the 2026-09-03 design dialog, which ranked it second in the cycle. It may run beside the corpus audit, which writes nothing outside scratch, and it runs before the corpus audit's follow-on cut plan, because the prose pins are tests and a prose cut with the pins still in place reds on every sentence.

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

A scratch script at `.kit/scratch/test-census.js` walks every `test/*.test.js` and writes `.kit/scratch/test-census.md`: per file, the test count, the line count, the assertion count by class, the pin classes named as `testing-discipline` names them and read there with their carve-outs rather than restated here, beside a parity-pin class over a set held byte-identical by design and a residual behavioural class for what none of them reaches, the wall clock from one run of that file alone, and for each test the commit that introduced it, read by `git log -L` over the test's name line, since a file's own introducing commit says nothing about the 655 tests inside it. The census walks tracked files only; an untracked test file is reported by name and left out. The class heuristics are stated in the report's header so a reader can judge them. The Chapter carries the per-cluster totals and the whole-suite wall clock as the baseline every later section diffs against.

Acceptance: every tracked test file appears once; the per-file test counts sum to the suite's own count from a whole run; the wall clock is captured with the run's exit code from its own marker.

Files in scope: none tracked. Scratch under `.kit/` only.

### 2. Adjudication

Model: fable

One dispatch per cluster, split into several by file region where a file is too long to read whole in one (memq is 27,000 lines) with one verdict file per source file either way, reading each test whole, never a diff, against the earn and retire classes in `testing-discipline/SKILL.md` as amended by the subtraction-bars plan. Each test gets one verdict in `.kit/scratch/test-verdicts/<file>.md`: keep, naming the earn class and the contract in one line; retire, naming the retire class; or merge, naming the surviving test. A retire verdict on a test whose introducing commit names a defect is refused by the adjudicator and recorded as keep under the defect class. The two parity pins, `test/doctrine-parity.test.js` and `test/output-style-parity.test.js`, are adjudicated by coverage rather than by test: which pinned-copy sets they cover, and which of their presence-and-tracking checks pin a pointer the ownership map names. `test/hook-canary.test.js` and `test/readonly-agent-guard.test.js` take per-test verdicts like any other file.

Acceptance: every test in the census has exactly one verdict; the verdict counts reconcile with the census; every keep names a contract; every merge names a survivor that is itself a keep.

Files in scope: none tracked. Scratch under `.kit/` only.

Tests: none. The verdict files are the section's artifact and section 8 preserves their summary.

### 3. The memq cut

Model: opus

Apply the memq cluster's verdicts: delete every retire, fold every merge into its survivor, and sweep the plan-private referents the backlog names (the 2026-08-26 item) out of the comments that survive. Run the whole gate. Lower the ratchet caps for the cluster's files to the new sizes.

Acceptance: the gate is green at the same failure set as the census baseline; the cluster's test count in the Chapter equals the verdict file's keep count and its line count is recorded beside it; the wall clock is recorded against the baseline.

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

As section 3, over the prose-pin cluster, with the coverage verdicts from section 2 applied: the doctrine-parity file keeps its byte-identical copy pins and the pointer checks the ownership map names, and loses every wording pin over a sentence that is not a pinned copy. This is the section that frees the corpus audit's follow-on plan to cut prose without a red per sentence, so its Chapter states which sentence classes are now unpinned.

Files in scope: `test/doctrine-parity.test.js`, `test/output-style-parity.test.js`, `test/hook-canary.test.js`, `test/readonly-agent-guard.test.js`, `test/size-budget.json`.

Tests: the gate, and a probe, not a committed test, that drifts one byte between the doctrine source (`plugins/claude-kit/skills/operating-instructions/SKILL.md`) and its mirror (`home/claude-kit-doctrine.md`), watches the surviving copy pin red, restores from the pre-probe copy and verifies the restore by diff; the Chapter records it.

### 7. The memory and remainder cuts

Model: opus

As section 3, over the memory cluster and then the rest, each with its own gate run and Chapter counts.

Files in scope: `test/memory-*.test.js`, every other file under `test/` the census lists, `test/size-budget.json`.

### 8. Re-baseline

Model: sonnet

The suite baseline memory (`suite-baseline-is-not-zero-fail`, in this project's memory tier outside the repository, read and written through `memq`) is updated to the cut counts. The testing-discipline skill's wall-clock baseline text, if it states one, is updated. The verdict files' per-cluster summaries are appended to this plan's final Chapter, so the record of why each survivor stays outlives scratch. The 2026-08-26 backlog item on plan-private referents is retired with receipts.

Acceptance: the memory body carries the new counts and the run they came from; the backlog item is in the Q3 snapshot; the ratchet caps equal the sizes at this section's commit.

Files in scope: `docs/backlog.md`, `docs/archive/backlog-2026-Q3.md`, `test/size-budget.json`, the project memory file by `memq`.

## Out of Scope

- Any prose cut. The corpus audit and its follow-on own those.
- Product code. A test that reveals a product defect while being read is routed to the backlog with the test kept.
- Test wall-clock engineering beyond what deletion buys.

## Assumptions

- assumed 2026-09-03 (default): no numeric cut target; the bar decides; reversal: state a target as an adjudication tiebreaker and re-run section 2.
- assumed 2026-09-03 (doctrine, `.kit/` scratch rule): the census and verdicts are scratch and only their summaries are committed, in Chapters; reversal: commit the verdict files under `docs/archive/`.
- assumed 2026-09-03 (testing-discipline, defect class): a test whose introducing commit names a defect is kept whatever its shape; reversal: allow the adjudicator to retire it when the defect's cause is pinned by a sibling.
- assumed 2026-09-03 (default): the goal-stop file's test count and the memory and remainder clusters' counts are read at the census rather than pre-written; reversal: none, the census is the record.

## Related

- `docs/plans/claude-kit_subtraction-bars_spec_v1.md`: the retire classes and the ratchet this plan cuts against and re-baselines. Must be Complete first.
- `docs/plans/claude-kit_corpus-audit_spec_v1.md`: the prose audit; runs beside this plan, and its follow-on cut waits on section 6.
- Backlog item of 2026-08-26, plan-private referents in test comments: covered by sections 3 and 8.
- `docs/archive/claude-kit_review-loop-exit_spec_v1.md`: the class-keyed exit for the review loop, and the parity pin over the class region's designed copy across executing-work and the two code-reviewer charters, which is the pin class this plan keeps; its section 4 made the size budget a ledger, so a cap this plan moves goes through `kit-size.js sync` rather than a hand edit.

## Open Questions

None.

## Chapters
