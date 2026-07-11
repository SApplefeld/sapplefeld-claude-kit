# Operating Model: Strict Session-Tier Split, Measured

- **Status:** Complete
- **Run Mode:** interactive
- **Commit Model:** Review-Only
- **Fable Spend:** Fable-led session; sections built inline in the main thread.
- **Decided:** 2026-07-11, from the two-week transcript study (77 main sessions, 323 subagent transcripts, $5,133 API-equivalent at rates calibrated against real /usage dollar totals).

## Goal

Fold the transcript study's conclusions into the kit as posture, and make the follow-up measurement cheap. Scott's commitment: execution runs only on Opus-led sessions from here on; the kit's job is to state that rule with its evidence, steer Run Mode by attendance, and preserve the study tooling so the verification pass (after a week of post-200k-gate ledger data) is one command.

## The measured basis (recorded here so the rules cite data, not taste)

- 80% of all spend ($4,103 of $5,133) was billed on calls carrying >150k context; the dominant cost object is the orchestrator session at 430-560k average context.
- Fable-led main chains cost $1,551 vs $1,106 for Opus-led; several Fable mains were execution-shaped. Fable's cache-read meter is 2.3x Opus's, and execution main-chain cost is almost entirely context re-read.
- Reviews are ~11% of spend; the Fable premium per review is $3.50-4 (deltas: adversarial $6.99 vs $2.90 average per run, security $4.57 vs $1.11). Review tier is not a cost lever worth pulling.
- Cache is already near-optimal: 84% of cache-write tokens at 1h TTL; cold rebuilds $344 total, concentrated in overnight idles at large context. A post-compaction rewrite costs under a dollar and repays within ~2 calls.
- Chain workers capped per-section cost but were not cheaper per call (~$0.23-0.41 both styles); their advantage is the forced context reset, which the 200k check gate now gives interactive sessions too. Pending Agent SDK metering makes chain-worker turns API-billed end to end while in-session subagents stay on subscription.

## Sections of Work

### 1. Doctrine and Run Mode prose - tier: fable (inline)

- `operating-instructions/SKILL.md`, "The session model is the mode" bullet: add the measured evidence line and the no-exception rule (a small plan is not a reason to execute Fable-led; the 2.3x meter runs for the whole session that follows) and the attendance rule for chain (chain buys unattended survival, not economy; attended execution is an interactive Opus-led session with the check-gated compaction).
- `brainstorming/SKILL.md`, step 10 Run Mode paragraph: choose Run Mode by attendance (unattended stretch → `chain`; a run I will be present for → `interactive`), keeping `chain` as the headerless fallback so autonomous resumes stay safe.
- No change to executing-work (it honors the header; the advisor default is already stated) or to review tiering (the data endorses the current doctrine).

### 2. Study tooling preserved - tier: fable (inline)

`tools/transcript-study/scan.mjs`, `analyze.mjs`, `README.md`: the v3 scanner and analyzer from the 2026-07-11 study, root path as an argument, README recording the method (message-id dedup, copied-history exclusion, price table calibrated to /usage totals, subagent classification) and the re-run recipe. Node-only, read-only over a transcript share.

### 3. Records - tier: fable (inline)

- `docs/backlog.md`: add the re-study item (verify the 200k gate holds average context down, using the compaction ledger plus a fresh transcript copy, ~1 week of data); append the study's data points to the advisor and chain-vs-subagents items.
- Memory: the posture decision with its rationale and the re-study plan.
- Close-out: Chapter, archive, indexes, staged (Review-Only).

## Related

- `claude-kit_compaction-tuning_spec_v1.md` (archive sibling): the 200k trigger / 150k guard / ledger this posture depends on.
- `claude-kit_kit-doctor_spec_v1.md` (archive sibling): the install validation that keeps the machinery consistent across machines.

## Chapters

### Chapter 1: All sections (2026-07-11)

Delivered in this changeset. Commit model: Review-Only (staged with two sibling efforts, compaction-tuning and kit-doctor, all awaiting one review pass).

- **Section 1 (prose):** the doctrine gained a sibling bullet "The split is measured" beside "The session model is the mode" (structural drift from the spec's "add to the existing bullet" wording, accepted in review: content complete, the sibling keeps the original bullet's rules stable). Brainstorming's Run Mode paragraph now chooses by attendance with `chain` kept as the headerless fallback; executing-work confirmed consistent and untouched. Frontmatter descriptions untouched.
- **Section 2 (tooling):** `tools/transcript-study/` gated by reproducing the study's corpus totals exactly ($5,133.02 / $4,102.95 over-150k) before and after review fixes.
- **Section 3 (records):** backlog re-study item plus data-point appends on the advisor and chain-vs-subagents experiments; posture memory written and indexed.
- **Review (adversarial, one pass):** CHANGES_REQUIRED, resolved. The load-bearing catch: the doctrine and memory said Fable execution mains "billed 2.3x Opus" where the measured aggregate is 1.4x ($1,551 vs $1,106) and 2.3x is the meter-rate ratio; both surfaces now state the rate claim, so the re-study cannot falsify the doctrine's own headline. Also fixed: the review-premium range restated as measured deltas ($3.50-4); the orchestrator-average baseline unified to 430-560k across spec, backlog, and README; unknown-model pricing in the analyzer now warns instead of silently falling back to Sonnet rates (harness `<synthetic>` placeholder ids stay quiet); machine-specific folder-prefix strip removed; dead code removed (including a `prevTs` assignment that would have thrown after the declaration was deleted); sidechain-exclusion documented in the README method; the memory's weekly-overage figure attributed to Scott's report rather than left unanchored. Accepted as-is with reason: the order-dependent duplicate-row dedupe (harmless at current transcript shape, validated against /usage; a Map refactor is cosmetic until a transcript violates adjacency). Security review skipped with justification: prose plus two read-only local analysis scripts with no spawn, network, or write surface beyond their own output file.
- **Deviation note for the re-study:** the study measured pre-gate behavior; the backlog item carries the pass/fail criteria and points the suspicion order (executing-work step 8 wording before the engine) if context averages have not moved.
