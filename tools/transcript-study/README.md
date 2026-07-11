# Transcript Study

Measures where the money goes across a copied set of Claude Code transcripts:
cost by session model, main-chain vs subagent spend, reviewer tiers, context
profile (share of spend above 150k), compaction events, cache TTL mix, and
cold cache rebuilds. First run 2026-07-11 produced the operating-model posture
recorded in `docs/archive/claude-kit_operating-model_spec_v1.md`.

## Method

- Input is a share of copied project folders (`<share>\<sanitized-project>\*.jsonl`
  plus per-session `<session-id>\subagents\agent-*.jsonl`), as produced by
  copying `~/.claude/projects/<project>` folders from each machine.
- Every API call is counted once: transcript rows are one-per-content-block
  sharing a message id, so calls dedupe on `message.id` within a session, and
  again globally because compacted destination transcripts copy the source's
  usage rows verbatim.
- Context per call = `input + cache_read + cache_creation` tokens: what every
  subsequent call in the session re-bills.
- Cost uses a $/MTok table validated against real `/usage` dollar totals
  (Opus, Sonnet, Haiku exact; Fable calibrated to ~3%). Overage dollars map
  directly because overage bills at API rates.
- A "cold rebuild" is a call re-writing more than 60% of its context to cache
  at over 50k tokens: a TTL miss, usually an idle gap.
- Subagents classify by their brief's opening text; the `other` bucket is
  large because briefs vary, so treat class splits as lower bounds.
- Main-session `isSidechain` rows are excluded from main-chain cost; on
  current Claude Code versions subagent spend lives in the per-session
  `subagents\` files, which are counted separately. On a version that writes
  sidechain usage only into the main transcript, that spend would be dropped
  from totals; check for a `subagents` folder before trusting a share.
- Advisor consultations do not appear in transcripts (billed out of band) and
  cannot be measured here.

## Run

```
node scan.mjs C:\Shared\Transcripts scan-results.json
node analyze.mjs scan-results.json > analysis.json
```

Join compaction ROI per event against `~/.claude/magic-compact/ledger.jsonl`
(each ledger line's `destinationSessionId` matches a transcript whose first
new usage row gives the post-compaction context).

## Open follow-up

After ~1 week of post-200k-gate data (from 2026-07-11): re-run and verify the
check-gated compaction holds orchestrator average context near the trigger
instead of the 430-560k averages measured before it, and that Fable-led spend
concentrates in design/finishing sessions. Tracked in `docs/backlog.md`.
