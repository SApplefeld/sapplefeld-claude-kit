# The lean kit program

Program, non-executable: no `Status:` header, no leash, never armed. It is the map of a sequence of plans the operator and the KIT: Expert seat designed together on 2026-09-09, so that any session, after any compaction or restart, can read where the sequence stands and pick it up. Each stage is its own plan with its own spec; this document names them, their order, the gates between them, and the decisions that bind all of them. Update it when a stage changes state. The seat that closes a stage writes the next line here in the same commit.

## Why

Two measurements taken on 2026-09-09 from the repo's own plan docs and git history.

Review rounds per section, by the week the plan was written. Read from every `review rounds N` Metrics line in every plan doc.

| Plan week | claude-kit mean rounds | claude-kit sections at 5 or more | AI-OS mean rounds |
|---|---|---|---|
| Aug 15 | 2.9 of 16 | 5 | 1.6 of 13 |
| Aug 22 | 2.1 of 82 | 9 | 0.9 of 9 |
| Aug 29 | 3.1 of 30 | 5 | 1.9 of 19 |
| Sep 1 | 4.3 of 24 | 9 | 3.2 of 5 |

Rule text every reviewer applies, in words, at the main commit nearest each date.

| File | Jul 15 | Aug 22 | Aug 29 | Sep 8 |
|---|---|---|---|---|
| executing-work skill | 3,667 | 11,900 | 18,465 | 21,823 |
| finishing-work skill | 1,533 | 4,570 | 15,512 | 18,127 |
| adversarial reviewer charter | 782 | 1,002 | 2,492 | 3,403 |
| doctrine | 6,133 | 6,635 | 9,241 | 10,905 |

The whole rule corpus on 2026-09-08 is 202,910 words: 26 skill bodies at 176,617, 16 agent charters at 24,677, the output style at 1,616. A clone carries 2.8 million words, of which the archived plans are 1,039,496 and the tests 764,017.

The reading: every stuck review produced rules, nothing retired one, and reviewers a tier above the writer reading whole files under 20,000 words of rules could always name one more class. The exit condition asked for a round with no new class. The rules were the fix for the loops and the cause of them. Four repos on the operator's machines show the same curve with the same timing, and the kit is what they share.

## Decisions that bind every stage

Decided 2026-09-09 by the operator at the keyboard and on the relay thread.

1. **Growth is declared, never discovered.** A plan that adds rule text states, per rule file, the net words it adds and a one-paragraph reason. The plan reviewer judges the reason before arming. The file's size cap moves by the declared amount when the section commits. The cap is checked at section close against the declared allowance, never at a review round, and a miss is a one-line decision ask to the operator, never a rewrite round. Undeclared growth is the only thing that fails. Reviewers raise no word-count or phrasing findings. The operator does not adjudicate every raise; the process is the sanity check.
2. **The why lives in a ledger, not in the rule.** Each rule has a rationale ledger entry, keyed by claim, in the owning skill's references directory, loaded by nobody by default and read by the audit and by any session about to change a rule. Rule text says what happens. The ledger says why. Git says when.
3. **Lean is defined.** Rule text is what needs to happen, not the journey, not the explanation, not the thousand examples. A sentence is one idea, about twenty words; a rule and its bound are two sentences. One example survives only where the rule cannot be stated without it.
4. **One owner per moment.** The ownership map names the owner; every other document points. Copies exist only where a pin keeps them byte-identical and the copy earns its load cost.
5. **The archive leaves the tree after the ledger is built, by tag and delete.** History keeps every file. A tag on the last commit that carries them recovers any one with one command. Neither a separate archive repo nor an archive branch, since a branch downloads with every clone and a second repo is a second place to lose things.
6. **Cheaper later rounds.** Round 1 of a section runs three lenses one tier above the writer. Every round after runs one lens at the writer's tier, unless round 1 found a Critical, and a Critical found later re-raises the next round.
7. **The Expert seat adds no net rule words until the audit has run.** Recorded in operator memory as `expert-seat-adds-no-net-rule-words-until-the-corpus-audit`.

## Stages

Each stage is a plan under `docs/plans/`. The filename is the handle. The gate is what must be true before the next stage starts.

**Stage 0. Tourniquet.** `claude-kit_review-loop-provenance_spec_v1.md`. Every review finding names the spec bullet it traces to, a design stop at round 3 for a finding that traces to nothing, and a five-round backstop that turns a section into a `BLOCKED:` to the operator. Runs in the `KIT: Loop Worker` session on main, armed 2026-09-09. Gate: plan Complete, `claude plugin update`, global restart on every machine.

**Stage 1. Corpus audit.** `claude-kit_corpus-audit_spec_v1.md`, amended 2026-09-09 to run over a claims list rather than the prose. A dedicated Fable session in its own worktree, concurrent with stage 0 since the audit writes only under `docs/`. Its passes, in order: cold readers extract every claim from every rule file as an imperative sentence with its bound, its class (rule, mechanic, pointer, or rationale and example), and its source line; the conflict and bloat sweeps run over that list; the warm judge attaches each claim's provenance and writes the ledger; the ruling brief goes to the operator; the rewrite is written as the stage 3 plan with a declared word target per file, in load order. Gate: ledger committed, ruling brief answered, stage 3 spec written Ready.

**Stage 2. Review tier decay.** One section of rule text carrying decision 6 into the reviewer dispatch ladder. Written when the operator says so, queued behind stage 0. Gate: none beyond its own close.

**Stage 3. The rewrite.** The follow-on plan stage 1 writes, one section per rule file in load order: executing-work, finishing-work, the reviewer charters, the doctrine and its two copies, then the rest. Each section carries its declared word target. `claude-kit_test-audit_spec_v1.md` rides beside it rather than after it: every test that pins wording retires, every test that pins structure stays, because the rewrite reds the wording pins by construction. Gate: whole gate green against the retired-pin baseline, plugin update, global restart.

**Stage 4. Lean tree.** A plan that tags the last commit carrying `docs/archive/` and `kaizen/archive/`, deletes both from the tree, changes the close-out ritual so a plan's last commit is its archive and the docs index keeps one line with the sha, and re-cites the six memories that name archive paths by commit instead. Gate: a fresh clone carries the payload, the tests, the current plans, and the documents about the solution, and nothing else.

**Stage 5. The stored queue resumes.** The eight plans stored at `.kit/goal-state.stored-2026-09-09-before-provenance-first.json` on SCOTT-CLAUDE, re-armed in the order the note beside it gives. The first of them, `claude-kit_coordinator-sync-machine-scope_spec_v1.md`, waits on the operator's ruling about its section 2 test harness; the Expert seat's recommendation is on the relay thread of 2026-09-09.

## Where the state is

- This document: the stage list and each stage's gate. A stage's own plan doc carries its Chapters.
- `.kit/goal-state.stored-2026-09-09-before-provenance-first.json` and the `.md` beside it, on SCOTT-CLAUDE: the stored queue and the re-arm commands.
- Operator memory `expert-seat-adds-no-net-rule-words-until-the-corpus-audit`: decision 7 with the numbers behind it.
- The relay thread of 2026-09-09: the dialog these decisions came from.

A session picking this up after a compaction reads this document, then the coordinator board, then the plan doc of the stage that is In Progress, in that order.

## Log

- 2026-09-09: program written. Stage 0 armed in `KIT: Loop Worker`. Stage 1 amendment in progress at the Expert seat; the Fable session arms it once the amendment is on main.
