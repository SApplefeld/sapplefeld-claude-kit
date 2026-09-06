# Ownership map

Each moment the kit governs has one owning document. The owner states the rule whole: the grant, its bounds, and its carve-outs together. Every other document that touches the moment points at the owner, or copies the owner's text whole under a parity pin or a build step. A document that carries part of a rule it does not own is the defect this map exists to make visible.

The doctrine's "Which text governs" section states the ranking this map serves: the harness, then the operator's live word, then a positional grant for its assigned scope, then the doctrine for principles and authorization scope, then the owning skill for mechanics, then every other surface as a pointer or a whole copy. The map answers the one question the ranking leaves open: which skill owns the moment.

How to read a row: the moment is the situation a session is in; the owner is the document whose text is the rule there; the third column names the surfaces that point at the owner or carry a pinned copy, so a reader who met the rule somewhere else knows where the whole of it lives. "Doctrine" means the operating-instructions skill body and its mirror, which are one text. A hook named in the owner column is the mechanical enforcement of a rule the named prose owns.

How to amend: a row changes when ownership moves, and the move lands in the same change as the prose that moves. A new skill adds its rows. A moment found governed by two documents with no stated precedence goes under Unowned or contested below, never silently into one owner's column, because assigning an owner is the operator's ruling.

## Intake and design

| Moment | Owner | Points at it or copies it |
|---|---|---|
| A design conversation for a new feature or non-trivial change: scope check, the questions asked, the spec written | `brainstorming` | doctrine (The execution loop), README |
| Which model tier executes a section, and the tier bands | `brainstorming` | doctrine (Orchestrating fan-out work), `executing-work` (routing) |
| The scout sweep that derives a section's files in scope where a design changes a contract or a shared surface | `brainstorming` | `executing-work` |
| A hard-to-reverse architecture fork pressure-tested by several lenses | `design-council` | `brainstorming` (offers it) |
| A verdict on a decision whose framing carries the operator's own preference | `cold` | doctrine (Match my precision) |
| What a prompt, brief, spec, or handoff does not state, and how each gap is routed | doctrine (Enumerate the gaps at intake) | `executing-work`, `brainstorming` |
| A plan doc's name, format, `Status` lifecycle, the admissible `Commit Model` values, and the `docs/` taxonomy | `curating-docs` | doctrine (Keep `docs/` as a curated library), `brainstorming`, `executing-work`, `finishing-work`, `docs/plans/README.md` |
| Archiving a completed plan, pruning the backlog, refreshing indexes and cross-references | `curating-docs` | doctrine, `finishing-work`, `docs-curator` charter |

## Execution

| Moment | Owner | Points at it or copies it |
|---|---|---|
| The section loop: implement, verify, review, Chapter, and the completion contract that keeps it running | `executing-work` | doctrine (Close each section with a Chapter), `kit-goal` |
| A dispatch brief's fields, which are standing and which conditional, and the standing directives forwarded verbatim | `executing-work` | doctrine (Before you send), `docs/architecture.md` |
| Scouts: banding, the return contract, and what a scout may and may not do | `executing-work` | doctrine (Act on found work) |
| The review roster for a section: the code pair, the document pair an `Audience:` line summons, the reviewer-model rule and the effort table | `executing-work` | doctrine (Dispatch is requested standing), reviewer charters |
| A section's `Standing Brief Amendments` block and its re-read at every section open | `executing-work` | `docs/architecture.md` |
| Which surfaces a subagent may write, and that `docs/` is the curator's and the main session's alone | `executing-work` (routing), enforced by `hooks/docs-write-guard.js` | reviewer and implementer charters |
| Killing or replacing a dispatched agent for a reason other than a stall | `executing-work` | doctrine (No completion notification is not a stall signal) |
| A dispatched agent gone quiet: the probe, the wedge hallmark, the cadence, and the windows per dispatch shape | `finishing-work` (Unavailability is the gate failing to run at full strength) | doctrine (Probe a dispatched agent), `executing-work` |
| The chapter checkpoint that lets a leashed run compact at a section boundary | `executing-work` (the boundary steps) | doctrine (Close each section with a Chapter), `kit-goal`, `hooks/kit-compact-gate.js` |
| A reasoning dead end or a decision the spec does not cover: the consult triggers and mechanics | `consult` | doctrine (Orchestration mechanics live in the skills), `executing-work`, `finishing-work` |
| Weighing a review finding or an operator correction before acting on it | `responding-to-review` | reviewer charters |
| Root-causing a failure before proposing a fix | `systematic-debugging` | doctrine (Root-cause from the real state) |
| Whether a change earns a test, what retires one already in the tree, the shape it takes, the cost it spawns, the lane mechanics, and the red protocol | `testing-discipline` | doctrine (Write tests independent by construction; Make the test earn its green; After each step, run the lane) |
| Which lane each gate moment takes and how the delta is reported against its baseline | doctrine (After each step, run the lane the moment calls for) | `testing-discipline`, `executing-work` |
| Starting a heavy process on a shared machine: the poll, the claim, and the box budget | `role` (the claim protocol) | doctrine (One heavy process at a time is a per-machine budget), `testing-discipline`, `executing-work` (brief clause) |
| Reading a large file to find one thing: the outline principle | doctrine (When you are hunting for something in a large file) | `csharp-style`, `sql-style` (the recipes) |
| C# and T-SQL house style, and the outline recipes for each | `csharp-style`, `sql-style` | doctrine (Defaults) |
| A document written in the operator's voice | `scott-writing-style` | `prose-reviewer` charter |

## Finishing

| Moment | Owner | Points at it or copies it |
|---|---|---|
| The whole-effort finishing pass: QA verification, the finishing reviews, docs curation, memory close, drift routing, close-out | `finishing-work` | doctrine (Finish deliberately, then bank what you learned) |
| The pull request at finishing, and integration per commit model at the close | `finishing-work` | `executing-work` (points forward), `hooks/pr-docs-guard.js` (docs committed before the PR) |
| A record that lives only on a frozen PR branch: the strand-check | `finishing-work` and `branch-hygiene` | doctrine (Pushed is not merged) |
| Reaping merged branches, recovering stranded commits, what may be deleted without asking | `branch-hygiene` | `hooks/branch-reaper-nudge.js` |
| What the store recorded during the effort, the after-query, decay, and the applied-stamp ledger | `memory-system` | `finishing-work` (calls it), doctrine (The kit memory store has an extension layer) |

## Git acts

| Moment | Owner | Points at it or copies it |
|---|---|---|
| Whether this session may commit or push at all, and what form an authorization takes | doctrine (Name the rollback and stop for a yes; Which text governs) | `executing-work` (Branch check), `role` (delegation exclusions), the output style checklist |
| The admissible `Commit Model` header values and the parked state an unknown value produces | `curating-docs` | `executing-work`, `kit-goal` |
| Where in the section loop the commit and the push land under each commit model | `executing-work` | doctrine (Treat durable artifacts as the recovery mechanism), implementer charters |
| Staging on a checkout another session may commit to: stage only your files, read the staged list, hold the index window narrow | doctrine (Stay in scope; On a checkout another session may commit to) | `executing-work`, implementer charters (the whole-worktree prohibition) |
| The commit message's three layers and the `-F <file>` write | doctrine (A commit title is the index line; Write commit messages via `git commit -F`) | implementer charters |
| The memory store's own commits and pushes: the sync path, the allowlist, the lock | `memory-system` | `kit-doctor`, `coordinator`, `role` |

## Coordination and seats

| Moment | Owner | Points at it or copies it |
|---|---|---|
| Reading the roster, messaging a peer session, and acting on a message one sent | `peer-sessions` | doctrine (Peer sessions are a coordination surface, not a record) |
| The standing of a `## Dispatch Authorization` section and the trace a citing session performs | `peer-sessions` (the trace) and `kit-goal` (the section's format) | `coordinator`, `executing-work` |
| A peer handing a leashed session work: never, information only | `peer-sessions` | `kit-goal` |
| Taking a seat with `/role`, the registry entry, the coordinator-directory contract | `role` | `peer-sessions`, `coordinator`, README |
| A standing operational grant: the rail, its on-switch record, its exclusions, and each grant's owning skill | `role` | doctrine (Which text governs), `coordinator` |
| The machine coordinator's runbook, the board, and every bar on what a board line may carry | `coordinator` | `role`, `peer-sessions`, `standing-watch` |
| A seat running git in the memory store: exactly as any other session on this machine may, with a read of the store's own history routed rather than performed | `coordinator` (the seat's git standing) | `role` (the standing-grant rail's exclusions), `memory-system` (the sync path) |
| A repeating watch over a live system: the tick order, the ledger, the wake prompt | `standing-watch` | `coordinator` (its named overrides) |
| Reporting where a long-running session stands without disturbing it | `recap` | doctrine (Close with the board) |
| Parking a session at its next safe point when the operator or a relayed drain window asks, with everything durable committed and a resume path recorded | `park` | `coordinator` (the update window), `recap` (safe to park, parks nothing), `executing-work`, `kit-goal`, `peer-sessions`, `hooks/session-start.js` (what a stopped session left behind) |
| Arming a completion leash, the canonical condition, and the Stop hook that enforces it | `kit-goal` | `executing-work`, `peer-sessions`, `hooks/kit-goal-stop.js` |
| Dispatching this session's own subagents, and the standing request that covers it | doctrine (Dispatch is requested standing) | `executing-work`, `finishing-work`, `consult` (where and how, never wider) |

## Memory, self-improvement, and the kit's own prose

| Moment | Owner | Points at it or copies it |
|---|---|---|
| Recall, the outcome journal, applied stamps, tags, decay, the shared tiers, `memq`, and the four remedies for a record gone bad | `memory-system` | doctrine (The kit memory store has an extension layer; A recalled memory contradicted by evidence) |
| Project-tier memory frontmatter | `memory-system`, enforced by `hooks/memory-frontmatter-guard.js` | `finishing-work` |
| Capturing kit friction, the capture bar, the weekly pass, briefs | `kaizen` | doctrine (When the kit itself creates friction, capture it), `coordinator`, `role` |
| Validating and repairing the machine's kit install | `kit-doctor` | `memory-system`, README |
| Writing or amending a skill, a charter, the output style, or any curated prose the kit ships, and proving a wording change moves behavior | `writing-skills` | doctrine (Match a document's length to its job), `kaizen`, `docs/architecture.md` |
| The communication register: decision asks, the close-out status, the board recap | doctrine (Craft and communication; Write every decision ask to the client-briefing register) | the output style (a pinned copy of the register core) |
| Shell encoding, background-run markers, readiness waits, and the harness's isolation screen | doctrine (Environment and tooling discipline) | the active shell's tool description (the specifics) |

## Unowned or contested

A moment listed here has two documents speaking to it with no stated precedence, or none at all. A session that meets one declares the reading it takes under the intake gap check and reports the gap in its close-out; it does not resolve the contest by editing either document, since the assignment is the operator's ruling. A row leaves this section when the ruling lands and the losing text is brought current.

| Moment | The surfaces in tension |
|---|---|
| When a pull request opens under Branch-and-PR, and who opens it | `executing-work` places the PR in the finishing pass; `curating-docs` describes a draft opened at the first section close and refreshed each section; `finishing-work` opens it via host detection with no draft to flip |
| Whether a plan header reading Branch-and-PR authorizes the pushes that model directs | The doctrine's authorization sentence names Commit-and-Push alone; `executing-work` directs the first-green push and the close push under Branch-and-PR |
| Deleting a stranded branch once its commits are recovered | `branch-hygiene`'s recovery steps license the delete; its auto-delete rule rules out `git branch -D` on any branch outside the merged set |
| A commit model that commits locally and never pushes | No such value exists; Review-Only forbids the commit as well as the push, so a session asked to commit without pushing has no header to stand on |
