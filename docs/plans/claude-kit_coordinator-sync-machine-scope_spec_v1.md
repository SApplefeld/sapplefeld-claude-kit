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

## Standing Brief Amendments

1. **Never pin curated operator prose by its wording; pin the token the sentence's identity actually rests on.** Added 2026-09-08 after section 1's review rounds surfaced the same class twice: round 1 found one such pin already in the tree, and the round that fixed it added five more. A test that matches a remedy sentence's words reds on any rewording of that sentence while proving nothing about behaviour, and every one of these sites already carried its own behavioural assertion beside the prose match. Pin a reason code, a sha, a path, a count, or a shape-level pattern over the block's structure. This binds every section of this plan, section 3's document rewrites included, where the temptation is strongest because the deliverable is prose.

2. **A finding line added to one report branch is added to every branch that can carry it, and the branch set is enumerated rather than assumed.** Added 2026-09-08 after the class surfaced twice inside section 1: the blank-machine-name lines first reached the check-mode branches alone, missing the `-Fix` refusal and the not-a-repository warning, and the round that fixed those left that same `-Fix` branch missing the inbound-own lines its check-mode siblings carry. A doctor section reports through one branch per store state, so a line added to the branch the author had open is absent from every other state that reaches the operator, and each branch reads correct on its own. Enumerate the branches, name which carry the line, and for each that does not, say why it cannot.

3. **A fix that writes process-outliving state is scoped at the moment it is written, and the scoping is pinned rather than remembered.** Added 2026-09-08 after the class surfaced twice in this plan under two different mechanisms. Ruling 8 rejected `[Console]::OutputEncoding` because the setting outlives the process and every later process attached to that console; the round that closed a separate security Major then set `NoDefaultCurrentDirectoryInExePath` in three cmd wrappers with no `setlocal`, and a batch file started from an interactive prompt runs inside the caller's own cmd.exe, so that assignment outlived every call and changed how the operator's shell resolved every later command. The two look nothing alike at the site and are one class: a write whose blast radius is the caller rather than the callee. So before shipping any state write, name what outlives the call and scope it there, and add the pin over the property rather than over the one variable, since the writer is exactly the party who cannot see the leak in a line just written.

## Sections of Work

### 1. The sync channel gains the machine axis on both sides. Model: opus

In `install-memory-sync.ps1`, add `Get-MemorySyncMachineName` (one reading, `[System.Net.Dns]::GetHostName()`, which is what `os.hostname()` returns on the platforms the kit runs) and `Test-MemorySyncCoordinatorPathIsOwn -RelativePath -Machine`, true only where the path's second segment equals the machine under a case-insensitive comparison (decision 3); the claims refusal stays in `Test-MemorySyncPathAllowed` untouched, and the two whole-index gates (`$indexGate`, run over `git ls-files` before and after the add) keep that allowlist predicate alone. The machine axis is applied to the paths the add staged, the `git diff --cached --name-only` list `Install-MemorySyncRepo` already reads after the post-add gate, and never to the whole index: a peer machine's coordinator files are tracked and unmodified on every synced box, so they appear in `ls-files` and in no staged diff, and they are never foreign. Any staged path under `coordinator/` whose machine segment is not this machine's own, a staged deletion included, returns the index to the saved tree exactly as the post-add gate does, refuses the commit, and lands in the notes the doctor prints with the word `foreign` and the machine segment it carries; the installer's result also carries a fixed `Reason` of `outbound-foreign-write`, which `sync-store.ps1` writes through `Write-SyncGateState` in place of the `commit-failed` transient it records for every other installer refusal. In `sync-store.ps1`, after `Test-SyncIncomingAllowed` returns `ok` and before the rebase, resolve `git merge-base HEAD <upstream sha>` with the same fixed sha the screen used and run `git diff --name-only --diff-filter=ACDMRT <merge base> <upstream sha>` with no pathspec, filtering its lines through `Test-MemorySyncCoordinatorPathIsOwn` in PowerShell rather than through a git pathspec, so the comparison is the predicate's and not git's, whose pathspec matching folds case where `core.ignorecase` is set; any line refuses with `inbound-foreign-write`, written as a gate through `Write-SyncGateState` (the reason code alone; the state file keeps its five keys and no fixture in `test/memory-session.test.js` changes shape), and the run ends before the rebase with the fetched tip left in place as the leak refusal leaves it. A merge base that cannot be resolved records the `unproven` transient as an unlistable tree does rather than passing. The offending paths are named by the doctor and not by the runner, which has no output channel but the state file: in `doctor.ps1`'s Memory sync branch (the one that calls `Install-MemorySyncRepo`), over a store whose fetched upstream is ahead of `HEAD`, run the same diff-shaped read and name in the notes each path it returns with the upstream sha, so the operator repairing the remote holds both. In `plugins/claude-kit/hooks/memory-session.js`, add both codes to `SYNC_REASON_TEXT` with a fixed sentence each, so the session-start line names the direction instead of falling to `SYNC_REASON_FALLBACK`. Tests in `test/memory-sync.test.js` on its existing harness: the fixture names its own coordinator directory from the running box's hostname, the same reading the code makes, and keeps a second tracked coordinator directory under a fixed foreign machine name beside it, unmodified, so a whole-index reading of the axis is what the fixture reds on; each test watched red first: an add over the fixture store carrying a modified file under the foreign directory stages nothing there, restores the index, and reports it, while the foreign directory's unmodified files stay tracked and uncounted; the same edit under the own directory commits; an upstream fixture commit touching `coordinator/<self>/board.md` refuses with `inbound-foreign-write` under `lastResult` `gate` and leaves the tree at the pre-sync commit; one touching the foreign directory's `board.md` rebases as before; one touching `coordinator/<self>/claims/` is refused by the leak screen first, so the ordering is pinned. In `test/memory-session.test.js`, one fixture per new code in the shape the `inbound-leak` fixture takes, asserting the code's fixed sentence rides the line.

Acceptance: tests green, watched red first; `node --test test/memory-sync.test.js` and `node --test test/memory-session.test.js` green with the delta named against a recorded baseline on each; the doctor's own run over this box's store root (`~/.claude`, the `$claudeDir` `doctor.ps1` passes, never the kit checkout), which carries peer machines' coordinator directories tracked and unmodified, reads its Memory sync line as before, since under the staged-diff reading those directories are not foreign.

### 2. The two runtimes' machine spellings are pinned against each other. Model: sonnet

One test asserts that the PowerShell reading `Get-MemorySyncMachineName` returns and Node's `os.hostname()` return the same string byte-exact on the running box, skipping with a named reason off Windows, which is the condition the test reads and the one that matters, since the doctor's installer runs on Windows alone, so a platform whose two readings diverge fails the suite on that platform rather than syncing every one of its own files as foreign. A second test plants a directory whose name differs from the machine's only by case and asserts it reads as this machine's own in both sync directions, refused inbound and staged as own outbound, the outbound half reachable only as a staged deletion because a case-folding filesystem cannot realize the variant spelling beside the real directory, with the variant planted through the git index (an `update-index` entry for the outbound case, an upstream fixture commit for the inbound one) rather than on disk, since a case-insensitive filesystem cannot hold both spellings beside each other. A third test guards the input the other two rest on, asserting that the running box's own name is a single directory segment rather than a traversal, since the byte-exact comparison above is satisfied by two empty readings and every fixture in the file builds a real directory from that same value.

The section also carries the cmd-wrapper interpreter hardening its own review surfaced, since a security finding of that weight is fixed before the section closes rather than routed: the two `doctor.cmd` wrappers and the `memq.cmd` text `Get-MemqCmdWrapperText` generates each scope their environment with `setlocal` and set `NoDefaultCurrentDirectoryInExePath` before launching a bare interpreter, and `test/git-guard-parity.test.js` discovers every tracked `.cmd` and `.bat` wrapper from git rather than naming them, pinning both properties with controls each way. The guard closes the interpreter hop alone; the wrapper's own name still resolves from the caller's directory first, which the wrappers state rather than imply.

Acceptance: all three tests green, the parity test watched red against a deliberately wrong constant; every tracked cmd wrapper carrying both the guard and its scoping, with the predicates watched red on an unguarded and an unscoped wrapper; delta named.

### 3. The documents state the control. Model: sonnet

Rewrite the role skill's directory-contract paragraph (the one opening "The directory sits deliberately outside") so it states the machine axis as the sync channel's rule and keeps the direct-write and audit statements it already makes; rewrite its inbox concurrency sentence per decision 2; and rewrite the two further role-skill clauses the axis falsifies, the inbox paragraph's clause that any machine on the store's remote can rebase in a write claiming this machine's own paths, and the claim-release paragraph's clause that a registry entry is one any machine on the store's remote writes through replication, so each states that replication writes a peer machine's directory and never this machine's own, while a local session still writes any of it directly. In `docs/security-model.md`, rewrite the coordinator board section's "What no control here reaches" paragraph where it states that the allowlist predicate scopes to no machine and that an upstream tree carrying this machine's own board path clears the screen and is rebased into this store, and add to the memory-store sync paragraph (the one stating that the runner screens the inbound direction as tightly as the doctor's probes screen the outbound) the diff-shaped read and its refusal, and beside it the availability residual that refusal creates: because the inbound gate fails closed, any principal that can push to the store's remote can stand a named machine's sync down by committing a path under that machine's own coordinator directory, which that machine then refuses until an operator repairs the remote. State it as the accepted cost of failing closed, beside the accepted direct-write risk the section already carries. State beside it the one known redirect of the machine reading itself: on Windows both runtimes return the value of the `_CLUSTER_NETWORK_NAME_` environment variable wherever it is set, so a process that controls the sync's environment moves this store's idea of which machine it is. Record it as a precondition rather than a hole, since that actor already holds write access to the store root and the axis narrows the sync channel rather than authenticating a writer. Also in `docs/security-model.md`, record the control section 2 added, which ships with no entry there: the `memq.cmd` residual section and the caller enumeration in the paragraph on the executable not being resolved against the repository under inspection each gain a sentence stating that the tree's cmd wrappers set `NoDefaultCurrentDirectoryInExePath` under `setlocal` before launching a bare interpreter, and that this closes the interpreter hop while the wrapper's own name still resolves from the caller's directory ahead of PATH. In `docs/architecture.md`'s coordinator directory section, add one sentence beside the sentence that any `.md` at any depth under the root syncs, stating that the channel stages only this machine's directory outbound and refuses an upstream write into it. The one reason-code surface is `SYNC_REASON_TEXT` in `memory-session.js`, which section 1 extends; no shipped document lists the codes, and none gains a list here. Every edit is present tense and states what is true now, never the change. `test/doctrine-parity.test.js` sweeps every shipped `.md`, `.ps1` and `.js` for the three allowlist sentence shapes (`re-includes only`, `admits only`, `only memory files inside`) within 240 characters after an allowlist subject word and requires each match to name the memory tiers and `coordinator`; every new sentence here, and every code comment section 1 writes, either avoids those shapes or names every root, and where the sweep reds on a rewritten paragraph the fix is the sentence, never the pin.

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

### Interim board 2 - 2026-09-08

Written at the closure-drought trigger: two review rounds adjudicated with no section closed, with
the compaction gate holding offers.

In-flight sections: section 1 has had two full review rounds and is in its third fix pass. Sections
2 and 3 not started; both depend on section 1's helper, so neither runs concurrently.

Live dispatches: one implementer-opus, dispatched with the round 2 fix list (G1 through G9). Two
implementer-opus rounds have already completed and reported DONE_WITH_CONCERNS.

Review rounds so far, both at fable (writer tier opus, reviewers one tier up, Fable the ceiling;
code pair at the frontmatter low, security at the frontmatter medium, all on the Agent tool):

- Round 1 over the section (base 07a2e98): adversarial CHANGES_REQUIRED, blind CHANGES_REQUIRED,
  security CONCERNS. All three converged independently on one defect.
- Round 2 over the fix delta (base ebc8a3c): adversarial CHANGES_REQUIRED, blind CHANGES_REQUIRED,
  security CLEAR.

Gate baseline, measured by this session on SCOTT-CLAUDE at 2026-09-08T17:08Z-17:15Z, holding the
heavy-process claim for the run. Contention at the sample: three resident dotnet processes, one
VBCSCompiler and roughly a dozen node processes, none of them a live suite (a peer seat's claim on
repo ai-os had been released at 17:07:58Z and this session waited for it rather than running beside
it):

- `node --test test/memory-sync.test.js`: tests 95, pass 95, fail 0, exit 0, duration 215.7s.
  Prior baseline this session 90/90/0 exit 0. Delta +5 tests, all added by the fix round.
- `node --test test/memory-session.test.js`: tests 87, pass 86, fail 1, exit 1, duration 29.0s.
  Identical to the prior baseline. The single failure is the standing red `a pinned directory too
  long to name faithfully stands the session down`, permanent on this box because TEMP is `D:\Temp`
  at seven characters, landing the fixture at 254 against a 260-character guard.
- Whole-tree pins whose subject these files are, all exit 0: doctrine-parity 72/72,
  doctor-encoding 12/12, git-guard-parity 11/11, memory-sync-git-guard 2/2, doctor-goal-state 22/22.
- The section's own acceptance run: `doctor.ps1` bare (there is no check flag; its parameters are
  -Fix and -Yes alone, so a bare run is the check) over this box's real `~/.claude`, which carries
  the peer NEO-CLAUDE coordinator directory tracked and unmodified, reads `[PASS] Memory sync` at
  exit 0 with no inbound-foreign-write lines. That is the criterion section 1 wrote, met on the
  live store rather than on a fixture.

Rulings adopted since interim board 1:

2. The rename channel defeated both halves of the machine axis, and it is fixed rather than
   documented. Both machine-axis reads ran `git diff --name-only` under git's default rename
   detection, which prints a rename's destination alone. Confirmed here against this repository's
   own history: commit c8fea88 carries an R080, and the default reading omits the source path that
   `--no-renames` restores. So a move of this machine's board out of its own directory was a
   deletion neither gate could see. Both reads now carry `--no-renames`, with a test per direction.
3. The NTFS 8.3 short-name observation is downgraded from Major to Minor and routed rather than
   fixed. The security review held that an upstream path spelled `coordinator/SCOTT-~1/board.md`
   would clear the ownership check and then land on this machine's real board at checkout, and
   rated it medium because the discriminating probe is write-shaped and outside a reviewer's
   charter. Three probes run here on the C: volume say otherwise: git resolves the alias in its own
   working-tree reads and refuses every write that would clobber through it, aborting the merge or
   the checkout with the own board intact, tracked and untracked alike. The residual is an
   availability defect rather than a peer write landing on the board. Not fixed here because the
   repair widens `Test-MemorySyncCoordinatorPathIsOwn`, whose comparison rule decision 3 defines
   precisely, on evidence that no longer supports the severity that motivated it. Routed to
   `docs/backlog.md` with the probe evidence.
4. The doctor's remedy text is fixed at the report level and the inbound classifier is left alone.
   Classifying an incoming own-directory change by committer identity would be a new trust rule
   this spec never wrote. The report now names both repairs instead: a genuine foreign write, and
   this machine's own history reading as foreign after a local reset or restore.
5. A blank machine name must not report under a healthy verdict. The round 2 review found the new
   blank-name line riding as verdict-neutral detail, so a store whose sync is wholly stopped could
   read PASS at exit 0 with a push recipe beside it. The brief that produced it asked only for a
   line, which was this session's error; the fix in flight makes it a failing branch.

Approval drift recorded here: a `## Standing Brief Amendments` block was added to this plan above
`## Sections of Work`, carrying one entry that bars pinning curated operator prose by its wording.
The class surfaced twice in one section, once as a pin already in the tree and once as five more
added by the round that removed it, which is the recurrence trigger. It binds sections 2 and 3 too,
and section 3 most of all, since its deliverable is prose.

Next action per section: adjudicate the round 3 fixes, re-run the section's close gate, then steps
5 through 8 to close section 1, then section 2 (sonnet), then section 3 (sonnet, whose docs/ writes
make it `Locus: inline` in the main thread).

### Chapter 1 - 2026-09-08
Completed: 1. The sync channel gains the machine axis on both sides
Implemented By: implementer-opus (the section and three fix rounds), plus the main session for the fourth review round's fixes, which were four one-site edits adjudicated against the code rather than a briefable unit of work
Metrics: review rounds 4, closed claim-exit; NEEDS_CONTEXT count 0; escalations 0; consults 0
Decisions / Surprises: The rename channel defeated both halves of the axis and was fixed rather than documented: both machine-axis reads ran under git's default rename detection, which prints a rename's destination alone, so a move of this machine's board out of its own directory was a deletion neither gate could see. Confirmed against this repository's own history, where commit c8fea88 carries an R080 whose source path the default reading omits and `--no-renames` restores. Both reads now carry `--no-renames`, with a test per direction whose control pins `diff.renames=true` so the fixture is proven rename-shaped rather than assumed. PowerShell's `,` binding tighter than `+` produced the same defect three times in this section's own deltas, twice inside one fix round: an array element built by concatenation and left unparenthesized swallows the element after it, so a refusal's remedy sentence rode inside the first note and was cut by the doctor's 200-character sanitizer. A fourth live instance was found outside this section, in the doctor's auto-compaction-window branch, and routed. The machine reading is redirectable and the shipped comment said it was not: on Windows both `[System.Net.Dns]::GetHostName()` and Node's `os.hostname()` return `$env:_CLUSTER_NETWORK_NAME_` wherever it is set, probed here in both runtimes, which leaves the two-runtime parity the axis rests on intact while making the comment's security claim false. The comment now states the redirect as the precondition it is, and section 3 states it in the security model.
Assumptions: none
Review Findings: review: code pair and security at fable, Agent tool (code pair at the frontmatter low, security at the frontmatter medium; writer tier opus, reviewers one tier up, Fable the ceiling). Round 1 adversarial CHANGES_REQUIRED, blind CHANGES_REQUIRED, security CONCERNS, all three converging independently on the rename defect. Round 2 adversarial and blind CHANGES_REQUIRED, security CLEAR. Round 3 adversarial and blind APPROVED_WITH_CONCERNS, security CLEAR, 5 Minors. Round 4 adversarial and blind APPROVED_WITH_CONCERNS, security CLEAR, 7 Minors across the three lenses. No Critical in any round and no owed Major in the last two. Addressed in round 4's fix pass: the unvalidated saved-tree value that reached `read-tree`, the two loose spellings of the object-id check, two report branches missing the blank-machine-name remedy, one inaccurate test comment, one test pin barred by the standing amendment, one test line-selection that bound to the first line carrying a sha rather than the line carrying the finding's shape, and the false security claim in the machine-reading comment. Routed rather than fixed, each with its evidence: the saved-tree read losing its restore when git prints a warning after the tree id, and the object-id guards failing open should their shared pattern ever read empty, both to `docs/backlog.md` because each changes a value reaching a git argument position and would owe a further round; the security model's now-understated sentence to section 3, which owns that document. One Minor downgraded from a prior round's Major is recorded in interim board 2 as ruling 3, with its destination.
Stamps: adjudicated 6, stamped 3. Stamped `forward-resource-arrangements-into-dispatch-briefs` (the box-claim clause rode verbatim into both implementer briefs), `release-an-exclusive-claim-at-the-operations-end-not-the-turns-end` (the claim went back when each gate ended rather than at the turn's end), and `agent-liveness-reads-the-subagents-transcript` (a dispatch's `.output` file read 0 bytes on this box, exactly as that record predicts, so the silence was not read as a dead agent). Three read and skipped as not load-bearing here. The window was accounted for by this session throughout, so no hand walk was owed.
Gate: Targeted lane plus the whole-tree pins whose subject these files are, with the contention lane beside them, since the section's delta touches machine-shared state. Measured by this session on SCOTT-CLAUDE 2026-09-08T18:33Z-18:39Z while holding the heavy-process claim, taken after waiting 150 seconds for a live foreign claim (`AI-OS: Worker`, repo ai-os, a registered seat, aged by the claim file's own modification time) to be released at 18:33:02Z rather than running beside it. `node --test test/memory-sync.test.js`: tests 100, pass 100, fail 0, exit 0, duration 267.0s, against this session's prior baseline of 95/95/0 exit 0, so +5 tests and zero failures either side. `node --test test/memory-session.test.js`: tests 87, pass 86, fail 1, exit 1, identical to its baseline; the single red is `a pinned directory too long to name faithfully stands the session down`, permanent on this box because TEMP is `D:\Temp` at seven characters, which lands the fixture at 254 against a 260-character guard so the guard is never exercised. Whole-tree pins, one run: tests 119, pass 119, fail 0, exit 0 across doctrine-parity, doctor-encoding, git-guard-parity, memory-sync-git-guard and doctor-goal-state. `node --test test/size-ratchet.test.js`: tests 101, pass 100, fail 1, exit 1. That red is collateral and pre-existing rather than this section's: this section's own growth was synced (`test/memory-sync.test.js`, cap 3108 to 3952, the one entry the sync named), and the remaining over-cap is `test/memory-session.test.js` at 3280 lines against a cap of 3240, a file byte-identical to HEAD whose cap at HEAD is that same 3240, so the ratchet reds on a clean checkout of HEAD independent of this work. Routed to `docs/backlog.md` with that evidence. The section's own acceptance leg, run here rather than taken from the implementer's report: `doctor.ps1` bare over this box's real `~/.claude` (there is no check flag; its parameters are `-Fix` and `-Yes` alone, so a bare run is the check), over a store carrying the peer NEO-CLAUDE coordinator directory tracked and unmodified, reads `[PASS ] Memory sync` at exit 0 with no inbound-foreign-write lines, which is what the staged-diff reading is supposed to produce.
Next: 2. The two runtimes' machine spellings are pinned against each other
Commit Model: Branch-and-PR
Delta: Measured by this session on SCOTT-CLAUDE 2026-09-08T18:44Z, worktree against HEAD e74701b, with no foreign uncommitted work in the tree.

```
repository: claude-kit
test/memory-sync.test.js: 3952 lines, cap 3952, +427; tests 100, +10
words: 222232 of cap 222232 across 61 curated files
test lines: 115326 of cap 115286 across 59 test files
tests: 3452
changed paths under no measured root: 5 (5 differing from HEAD, 0 untracked), which this tool does not measure and which no row above names; named-exclusion paths in the changeset: test/size-budget.json, which a root holds and no shape measures, so no row above names them
```

### Interim board 3 - 2026-09-08

Written at the compaction gate's deferral signal, at the boundary between section 2's review round
and its fix pass.

In-flight sections: section 2 implemented, verified and reviewed, with its fix pass not yet applied.
Section 3 not started; it rewrites documents this section does not touch, so it does not contend.

Live dispatches: none. The section 2 implementer (implementer-sonnet) completed and reported DONE.
The review round completed: three lenses, all three agents done, none errored.

Gate, measured by this session on SCOTT-CLAUDE 2026-09-08T19:41Z-19:53Z while holding the
heavy-process claim, taken after waiting for a live foreign claim (`AI-OS: Worker`, repo ai-os, aged
by the claim file's own modification time) which cleared at 19:41:10Z:

- `node --test test/memory-sync.test.js`: tests 103, pass 103, fail 0, exit 0, duration 305.8s,
  against this session's prior baseline of 100/100/0 exit 0. Delta +3 tests, zero failures either
  side.
- `node --test test/memory-session.test.js`: tests 87, pass 86, fail 1, exit 1, identical to its
  baseline. The single red is the standing box-local `a pinned directory too long to name faithfully
  stands the session down`, permanent here because TEMP is `D:\Temp` at seven characters.
- Whole-tree pins, one run: tests 119, pass 119, fail 0, exit 0 across doctrine-parity,
  doctor-encoding, git-guard-parity, memory-sync-git-guard and doctor-goal-state.
- `node --test test/size-ratchet.test.js`: tests 101, pass 100, fail 1, exit 1, on the same routed
  collateral over-cap as section 1.

Review round 1 over section 2 (base a2c4be5), reviewers one tier up from the sonnet writer tier at
opus, effort high, through Workflow: adversarial CHANGES_REQUIRED, blind CHANGES_REQUIRED, security
CLEAR. Both models resolved at `claude-opus-5` with no substitution, tallied from the dispatches'
own transcripts.

Rulings adopted at this boundary:

5. The outbound half of the case-variant pin can only be exercised as a deletion, and the test says
   so rather than implying wider reach. A case-folding filesystem cannot hold the variant spelling
   beside the real directory, and `git add -A` either errors on a case alias against a tracked real
   directory or purges a disk-less staged-new entry, so the only construction that survives the
   installer's own add is a path committed into HEAD through `update-index` with no file on disk,
   which git then stages as a deletion. A staged deletion is a write the axis classifies, confirmed
   at `plugins/claude-kit/doctor/install-memory-sync.ps1:1168` where nothing filters the staged list
   to paths that still exist. An addition or modification under a case-variant path is unreachable
   from a real checkout and is not exercised.

6. The size-ratchet red is not this section's and its cap is not moved. `test/memory-session.test.js`
   is byte-identical to HEAD at 3280 lines with a cap of 3240 at HEAD and unchanged here, and the
   ratchet's own failure text records that the path currently matches HEAD. The blind lens raised it
   as a Major and proposed raising the cap; raising a cap for growth this session did not make would
   loosen the ratchet and erase the signal it exists for, so the finding is recorded
   justified-not-fixed and the item stays routed in `docs/backlog.md` where section 1 put it.

7. The parity test's skip states the condition it actually tests. Two lenses converged on the skip
   claiming a missing PowerShell host while testing only the platform. The repair is the sentence
   rather than a host probe: the doctor's installer is Windows-only, so the platform check is the
   right condition, and a probe would add a process spawn to a test file for no reach it does not
   already have.

Approval drift recorded here: section 2's own requirement sentence was rewritten in this session to
state the skip condition the code implements, the adversarial and security lenses both naming the
edit. The base text read that the test skips where `pwsh` is absent; the section now states the
platform condition, which is what the harness tests and what the doctor's Windows-only installer
makes the meaningful one. The sentence sits above `## Chapters` and so inside the approval-scoped
region, which is why it is recorded here rather than left in the diff.

Next action per section: apply section 2's fix pass, re-review the fix delta, then steps 5 through 8
to close section 2, then section 3 (sonnet, `Locus: inline` because it writes under `docs/`).

### Interim board 4 - 2026-09-08

Written at the compaction gate's deferral signal (51 held offers over thirty minutes) and at the
closure-drought floor, three review rounds adjudicated since the last boundary with no section
closed.

In-flight sections: section 2 implemented and reviewed over four rounds, with its close gate queued
behind a live foreign heavy-process claim. Section 3 not started; it rewrites documents this section
does not touch, so it does not contend.

Live dispatches: none. Three review rounds ran since interim board 3, each three lenses at opus,
effort high, through Workflow, all agents done and none errored.

Gate: not yet measured for this delta. The runner is armed and waiting on the machine's claim file,
which carries a live foreign claim (`AI-OS: Worker`, repo ai-os, whose session the roster shows
busy), aged by the claim file's own modification time at 2026-09-08T20:42:42Z against a 600 second
estimate. The last measured gate remains interim board 3's, taken 2026-09-08T19:41Z-19:53Z. Waiting
rather than running beside it is the protocol's own direction: presence licenses waiting, absence
never licenses starting.

Rulings adopted at this boundary:

8. The console-encoding fix was itself the defect, and the reading moves to a temp file. The round 1
   fix set `[Console]::OutputEncoding` to read a non-ASCII hostname faithfully through stdout. Two
   lenses converged independently: the setter changes the console's own code page, which outlives
   the process and every later process attached to that console, and it can throw where no console
   is attached. The operator record `powershell-console-encoding-leaks-past-the-process` carries the
   measurement, and `test/doctor-encoding.test.js` already took the temp-file route for this exact
   reason. The reading now travels through a `mkdtempSync` directory under an explicit
   `UTF8Encoding($false)`, which also removes a BOM that a trim would have hidden from a comparison
   the spec calls byte-exact.

9. `NoDefaultCurrentDirectoryInExePath` governs a direct Node spawn and is read from the spawning
   process. Two lenses reported that a routed backlog entry contradicted the shipped comment at
   `plugins/claude-kit/hooks/kit-git-lib.js:5-11`, and both said they could not settle it because
   the discriminating probe is write-shaped. It was probed here against git 2.55.0.windows.3 with a
   decoy binary planted in the spawn's working directory: with the variable unset in the spawning
   process the decoy ran, with it set to 1 the real binary ran, and a control with no decoy present
   ran the real binary. The shipped comment is correct and the backlog entry was wrong; the entry is
   corrected. Git Bash sets the variable, which is why a probe run from that shell reads clean, and
   the same batch probe could not resolve a wrapper from the current directory until the inherited
   variable was cleared.

10. The bare-name interpreter class in the tree's cmd wrappers is closed here rather than routed. A
    security lens rated it Major; this session first downgraded it on the reasoning that an attacker
    able to plant an interpreter beside a wrapper could equally edit the script that wrapper runs,
    and the next round correctly rejected that, since `%~dp0` names the wrapper's own directory and
    never the working directory, so the plugin-payload wrapper invoked from a foreign directory is a
    real hijack the argument never covered. A security Major is fixed or raised and never routed, so
    both `doctor.cmd` wrappers and the generated `memq.cmd` now set the variable before they launch,
    which the probe above shows closes the search, and which is preferred over an absolute
    `%SystemRoot%` path because that would trade one caller-influenced value for another. A
    structural pin over every tracked cmd wrapper and over the generator, with controls both ways,
    lands in `test/git-guard-parity.test.js` so a wrapper added later is covered rather than exempt.

11. A routed class is stated by its predicate rather than by the names it happens to contain. The
    harness spawn item was sized twice from literal binary names and under-counted both times, at
    two sites and then at 54. Measured structurally over the shape of a bare-name first argument, it
    is 81 call sites across 24 files, and the entry now carries that predicate, its scope and its
    count so a repair cannot close a named list and leave the class open.

Approval drift recorded here: section 2's requirement sentence took two further edits inside the
approval-scoped region beyond the one interim board 3 records. It now carries ruling 5's
deletion-only narrowing of the outbound half, and it names the third test the section grew, a guard
on the hostname the other two rest on. The acceptance line is updated to match. The third test is a
deliberate addition rather than drift in the section's intent: the byte-exact comparison the section
asks for is satisfied by two empty readings, so without it the section's own pin can pass vacuously.

Next action per section: run section 2's close gate when the box frees, redo the parity test's red
watch against the temp-file mechanism it now uses, then steps 5 through 8 to close section 2, then
section 3 (sonnet, `Locus: inline` because it writes under `docs/`).
