# The store sync writes only this machine's coordinator directory and refuses an upstream write into it

Status: In Progress
Commit Model: Branch-and-PR
Created: 2026-09-03

Session model: any executor session in the kit repo; three sections in order, since section 2 pins the helper section 1 introduces and section 3 rewrites the paragraphs that today state the gap as accepted. Authored by the KIT: Expert seat on a finding the SCOTT-CLAUDE machine coordinator seat routed on the operator's keyboard instruction. Anchors are authoring-time and named by function rather than line; re-locate every hit by content.

## Goal

The memory store's sync allowlist admits `coordinator/<machine>/**/*.md` from every direction with no machine axis: the outbound add stages any machine's coordinator markdown this machine happens to have modified, and the inbound screen admits an upstream tree that rewrites this machine's own board, registry entries or inbox. Both sides run one predicate, `Test-MemorySyncPathAllowed` in `plugins/claude-kit/doctor/install-memory-sync.ps1`, and the inbound screen in `plugins/claude-kit/doctor/sync-store.ps1` (`Test-SyncIncomingAllowed`) reads the whole upstream tree by that predicate rather than the change it is about to replay. So the board's single-writer contract, which the role skill states and which a cold successor seat resumes the whole machine from, holds today by the accident that no machine edits another's files, and the role skill's directory-contract paragraph says exactly that. When this plan is done: a sync from this machine can stage nothing under another machine's coordinator directory; an upstream change under this machine's own coordinator directory stands the intake down loudly with its own reason code, the same fail-closed shape an inbound leak already takes; the sync state names the direction by reason code and the doctor's notes name the path; and the three documents that state the absence as accepted state the control instead.

## Evidence

- `Get-MemorySyncIgnoreText` and `Get-MemorySyncAllowedLeafPatterns` in `install-memory-sync.ps1`: the coordinator block re-includes `.md` at any depth under `/coordinator/` and excludes only `claims/` and the transient forms. No machine segment appears.
- `Test-MemorySyncPathAllowed`, same file: the coordinator branch returns true for any `coordinator/<anything>/...` leaf matching `*.md`, and the comment beside the claims refusal states that the outgoing add and the inbound screen share this one answer.
- `Test-SyncIncomingAllowed` in `sync-store.ps1`: screens every entry of `ls-tree -r <upstream sha>` and returns `leak` on the first disallowed one; it never reads which entries changed, so a rewrite of an admitted path is invisible to it by construction.
- `plugins/claude-kit/skills/role/SKILL.md`, the paragraph opening "The directory sits deliberately outside": states that nothing scopes a machine's directory to that machine's own writers, that the inbound screen runs the same predicate, and that a bounded audit is the whole compensating control. This plan changes the fact that paragraph describes, so section 3 rewrites it.
- The coordinator seat's report, 2026-09-03, read from the store's tracked `.gitignore`: lines 49 through 52 admit the coordinator tree, line 60 excludes claims, no machine segment anywhere. The claims exclusion's landing commit is reported by that seat and not re-verified here.
- Machine identity on this box: Node's `os.hostname()`, `[System.Net.Dns]::GetHostName()` and `$env:COMPUTERNAME` all return `SCOTT-CLAUDE`. That agreement is one machine's reading, so section 2 pins it rather than assuming it.

## Approach

The machine is the axis, and its spelling is the one the directory contract already keys on: the role skill names the machine's directory as `coordinator/<os.hostname()>/`, so the PowerShell side reads the same identity and a pin holds the two runtimes' spellings equal. Outbound, the machine axis reads the paths the add staged (`git diff --cached --name-only`) and never the whole index, so a peer machine's coordinator files, tracked and unmodified on every synced box, are never foreign; a staged change under another machine's directory returns the index to what it held before the add, refuses the commit, is reported as foreign in the same notes the doctor already prints for a disallowed path, and is recorded in the sync state under its own fixed reason code, `outbound-foreign-write`. Inbound, the screen keeps its whole-tree read for the leak axis and gains a second, diff-shaped read for this one: the entries that differ between the merge base and the upstream commit, filtered to this machine's own directory, and any entry there refuses the intake with a new fixed reason code, `inbound-foreign-write`, standing the run down exactly as `inbound-leak` does, with no merge and no push. The state file carries the code alone, since its shape is fixed and the session-start line reads nothing else from it; the doctor is what names the offending paths and the upstream commit, by running the same read over the refused tip the runner leaves fetched. Refusal rather than silent revert is deliberate: the existing gate's direction is that a store whose contents the machine cannot vouch for is not rebased into the live root, and a foreign write to this machine's board is the same class, whose repair is the operator's to make with the offending commit and path named by the doctor.

Two things this plan does not do. It does not authenticate a writer: a local session can still write any file in the directory directly, which the role skill states and the security model accepts, and the machine axis narrows the sync channel only. And it does not scope reads: every machine still receives every other machine's coordinator directory, since reading a peer machine's board is what the directory exists for.

## Decisions

Decided 2026-09-03 by the Expert seat; reversible at arming.

1. **Fail closed on an inbound foreign write, matching the leak gate.** A silent local-wins revert would rebase over the foreign commit and leave a store whose history carries a write the machine never saw. The refusal records its code in the sync state and leaves the tip fetched, the doctor's read over that tip names the commit and the path, and the operator repairs the upstream.
2. **The Admin request inbox is inside the scope, not exempted.** The role skill contemplates two machines appending to one `admin-requests.md` across a sync window and names that as an unresolved concurrency gap; under this plan a machine writes only its own inbox, so the cross-machine append is refused outbound and the gap closes by construction rather than by a merge rule. A request for another machine's Admin seat goes to that machine's coordinator over messaging, which the peer-sessions skill already routes. This is the one decision the operator may want to reverse at arming, since it removes a path the contract text currently entertains; the exemption, if taken, is `admin-requests.md` alone with the union merge the journals already use.
3. **Case-folded matching on the machine segment.** Git paths are case-sensitive, but the working tree the runner writes sits on NTFS, which holds one directory for every spelling of a name, so a path whose machine segment matches this machine's name under a case fold lands in this machine's own directory on the disk the write reaches; the PowerShell reading therefore compares case-insensitively in both directions, refusing a case variant of this machine's directory inbound as a write to its own and reading such a variant as own outbound, which is the same comparison the role skill makes on a hostname for the delegation record. The pin in section 2 holds the two runtimes' readings of the current hostname equal, which is the one divergence the channel can produce on its own. A directory named by an earlier hostname, where the box was renamed after the directory was written, reads as foreign by construction; no test reads that case, and its repair is the operator's rename of the directory.

## Sections of Work

### 1. The sync channel gains the machine axis on both sides. Model: opus

In `install-memory-sync.ps1`, add `Get-MemorySyncMachineName` (one reading, `[System.Net.Dns]::GetHostName()`, which is what `os.hostname()` returns on the platforms the kit runs) and `Test-MemorySyncCoordinatorPathIsOwn -RelativePath -Machine`, true only where the path's second segment equals the machine under a case-insensitive comparison (decision 3); the claims refusal stays in `Test-MemorySyncPathAllowed` untouched, and the two whole-index gates (`$indexGate`, run over `git ls-files` before and after the add) keep that allowlist predicate alone. The machine axis is applied to the paths the add staged, the `git diff --cached --name-only` list `Install-MemorySyncRepo` already reads after the post-add gate, and never to the whole index: a peer machine's coordinator files are tracked and unmodified on every synced box, so they appear in `ls-files` and in no staged diff, and they are never foreign. Any staged path under `coordinator/` whose machine segment is not this machine's own, a staged deletion included, returns the index to the saved tree exactly as the post-add gate does, refuses the commit, and lands in the notes the doctor prints with the word `foreign` and the machine segment it carries; the installer's result also carries a fixed `Reason` of `outbound-foreign-write`, which `sync-store.ps1` writes through `Write-SyncGateState` in place of the `commit-failed` transient it records for every other installer refusal. In `sync-store.ps1`, after `Test-SyncIncomingAllowed` returns `ok` and before the rebase, resolve `git merge-base HEAD <upstream sha>` with the same fixed sha the screen used and run `git diff --name-only --diff-filter=ACDMRT <merge base> <upstream sha>` with no pathspec, filtering its lines through `Test-MemorySyncCoordinatorPathIsOwn` in PowerShell rather than through a git pathspec, so the comparison is the predicate's and not git's, whose pathspec matching folds case where `core.ignorecase` is set; any line refuses with `inbound-foreign-write`, written as a gate through `Write-SyncGateState` (the reason code alone; the state file keeps its five keys and no fixture in `test/memory-session.test.js` changes shape), and the run ends before the rebase with the fetched tip left in place as the leak refusal leaves it. A merge base that cannot be resolved records the `unproven` transient as an unlistable tree does rather than passing. The offending paths are named by the doctor and not by the runner, which has no output channel but the state file: in `doctor.ps1`'s Memory sync branch (the one that calls `Install-MemorySyncRepo`), over a store whose fetched upstream is ahead of `HEAD`, run the same diff-shaped read and name in the notes each path it returns with the upstream sha, so the operator repairing the remote holds both. In `plugins/claude-kit/hooks/memory-session.js`, add both codes to `SYNC_REASON_TEXT` with a fixed sentence each, so the session-start line names the direction instead of falling to `SYNC_REASON_FALLBACK`. Tests in `test/memory-sync.test.js` on its existing harness: the fixture names its own coordinator directory from the running box's hostname, the same reading the code makes, and keeps a second tracked coordinator directory under a fixed foreign machine name beside it, unmodified, so a whole-index reading of the axis is what the fixture reds on; each test watched red first: an add over the fixture store carrying a modified file under the foreign directory stages nothing there, restores the index, and reports it, while the foreign directory's unmodified files stay tracked and uncounted; the same edit under the own directory commits; an upstream fixture commit touching `coordinator/<self>/board.md` refuses with `inbound-foreign-write` under `lastResult` `gate` and leaves the tree at the pre-sync commit; one touching the foreign directory's `board.md` rebases as before; one touching `coordinator/<self>/claims/` is refused by the leak screen first, so the ordering is pinned. In `test/memory-session.test.js`, one fixture per new code in the shape the `inbound-leak` fixture takes, asserting the code's fixed sentence rides the line.

Acceptance: tests green, watched red first; `node --test test/memory-sync.test.js` and `node --test test/memory-session.test.js` green with the delta named against a recorded baseline on each; the doctor's own run over this box's store root (`~/.claude`, the `$claudeDir` `doctor.ps1` passes, never the kit checkout), which carries peer machines' coordinator directories tracked and unmodified, reads its Memory sync line as before, since under the staged-diff reading those directories are not foreign.

### 2. The two runtimes' machine spellings are pinned against each other. Model: sonnet

One test asserts that the PowerShell reading `Get-MemorySyncMachineName` returns and Node's `os.hostname()` return the same string byte-exact on the running box, skipping with a named reason where `pwsh` is absent, so a platform whose two readings diverge fails the suite on that platform rather than syncing every one of its own files as foreign. A second test plants a directory whose name differs from the machine's only by case and asserts it reads as this machine's own in both sync directions, refused inbound and staged as own outbound, with the variant planted through the git index (an `update-index` entry for the outbound case, an upstream fixture commit for the inbound one) rather than on disk, since a case-insensitive filesystem cannot hold both spellings beside each other.

Acceptance: both tests green, the first watched red against a deliberately wrong constant; delta named.

### 3. The documents state the control. Model: sonnet

Rewrite the role skill's directory-contract paragraph (the one opening "The directory sits deliberately outside") so it states the machine axis as the sync channel's rule and keeps the direct-write and audit statements it already makes; rewrite its inbox concurrency sentence per decision 2; and rewrite the two further role-skill clauses the axis falsifies, the inbox paragraph's clause that any machine on the store's remote can rebase in a write claiming this machine's own paths, and the claim-release paragraph's clause that a registry entry is one any machine on the store's remote writes through replication, so each states that replication writes a peer machine's directory and never this machine's own, while a local session still writes any of it directly. In `docs/security-model.md`, rewrite the coordinator board section's "What no control here reaches" paragraph where it states that the allowlist predicate scopes to no machine and that an upstream tree carrying this machine's own board path clears the screen and is rebased into this store, and add to the memory-store sync paragraph (the one stating that the runner screens the inbound direction as tightly as the doctor's probes screen the outbound) the diff-shaped read and its refusal. In `docs/architecture.md`'s coordinator directory section, add one sentence beside the sentence that any `.md` at any depth under the root syncs, stating that the channel stages only this machine's directory outbound and refuses an upstream write into it. The one reason-code surface is `SYNC_REASON_TEXT` in `memory-session.js`, which section 1 extends; no shipped document lists the codes, and none gains a list here. Every edit is present tense and states what is true now, never the change. `test/doctrine-parity.test.js` sweeps every shipped `.md`, `.ps1` and `.js` for the three allowlist sentence shapes (`re-includes only`, `admits only`, `only memory files inside`) within 240 characters after an allowlist subject word and requires each match to name the memory tiers and `coordinator`; every new sentence here, and every code comment section 1 writes, either avoids those shapes or names every root, and where the sweep reds on a rewritten paragraph the fix is the sentence, never the pin.

Acceptance: doctrine-parity lane green with delta named; a whole-file read of each touched document for any further sentence the axis falsifies, each one found named in the report; no em dashes.

## Out of Scope

- Authenticating a writer at any point in the channel; the security model's accepted risk on direct writes stands.
- The machine-local claims directory, already excluded and unchanged.
- The Node-side git calls the `store-git-channel-guard` plan hardens; the two plans touch the same files and neither depends on the other, so they order by whichever arms first.

## Assumptions

- plan review 2026-09-08 (plan-reviewer at fable, effort high): 12 findings, 12 fixed, 0 assumed, 0 asked, 0 discarded.

## Related

- `claude-kit_store-git-channel-guard_spec_v1.md`: the same sync path, a different axis.
- `plugins/claude-kit/skills/role/SKILL.md`, the coordinator directory contract.
- `docs/security-model.md`, the memory store's sync section.

## Chapters

### Interim board 1 - 2026-09-08

Written at the compaction gate's signal (nine held offers over thirty minutes), at the boundary
between section 1's verified implementation and its review round.

In-flight sections: section 1 implemented and verified, review round not yet dispatched. Sections 2
and 3 not started, and both depend on section 1's helper, so neither runs concurrently.

Live dispatches: none. The section 1 implementer (implementer-opus) has completed and reported
DONE_WITH_CONCERNS twice: once on the original brief, once on a resumed brief carrying the tier-root
ruling below.

Gate baseline, measured by this session on this box 2026-09-08T16:0x-16:2xZ, uncontended (the
claims directory was empty at the spawn and this session held the claim for the run):

- `node --test test/memory-sync.test.js`: tests 90, pass 90, fail 0, exit 0. Recorded baseline
  before this section, measured 2026-09-08T15:38Z under light contention: tests 79, pass 79,
  fail 0, exit 0. Delta +11 tests, all added by this section, zero failures either side.
- `node --test test/memory-session.test.js`: tests 87, pass 86, fail 1, exit 1. Recorded baseline
  2026-09-08T15:45Z: tests 85, pass 84, fail 1, exit 1. Delta +2 tests, both added here and both
  passing. The single failure is the standing red `a pinned directory too long to name faithfully
  stands the session down`, which project memory `suite-baseline-is-not-zero-fail` records as
  permanent on this box: TEMP is `D:\Temp`, seven characters, landing the fixture at 254 against a
  260-character guard, so the guard is never exercised. Not a regression and not this plan's to fix.

Rulings adopted since the arm:

1. A coordinator path at the tier root carries no machine segment, so the outbound axis does not
   reach it and the allowlist governs it alone. The implementer's first cut read any path under
   `coordinator/` that the ownership predicate rejected as foreign, which made a two-segment
   `coordinator/<file>.md` refuse the whole commit and restore the whole index, so one stray file
   would stop this machine syncing anything. The Goal's own words settle it: the channel stages
   nothing under another machine's directory, and a tier-root path is under no machine's directory.
   The narrowing is outbound-only; `Test-MemorySyncCoordinatorPathIsOwn` is unchanged, because
   inbound refuses only paths that predicate calls own and a tier-root path must stay unrefused
   there. Confirmed latent rather than live: `git ls-files "coordinator/*"` over the live store
   returns 55 paths and no two-segment one, under a control that spoke on the three-segment branch.

Next action per section: dispatch section 1's review round (adversarial-reviewer and blind-reviewer
in parallel, plus the security-reviewer, whose trigger this section meets on configuration and
process-execution surfaces), then steps 4 through 8 for section 1, then section 2.
