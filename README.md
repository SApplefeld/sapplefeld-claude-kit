# claude-kit

Scott Applefeld's personal Claude Code marketplace. One repo that every project picks up: workflow skills (brainstorm, execute, finish) with a drive-to-completion contract and per-section model down-selection, discipline skills (systematic debugging, testing discipline, responding to review, skill and curated-prose authoring, kaizen self-improvement, a multi-lens design council, and cold judgment calls), fresh-context review agents, C# and T-SQL house-style guides, and a hardened compaction-recovery hook, packaged as the `claude-kit` plugin in the `applefeld` marketplace.

## STRUCTURE

```
claude-kit/                          (repo = the marketplace)
  .claude-plugin/
    marketplace.json                 Marketplace catalog (must live here)
  plugins/
    claude-kit/                      (the plugin)
      .claude-plugin/plugin.json     Plugin manifest (no version field - every
                                     commit counts as a new version)
      skills/
        operating-instructions/      Always-apply operating doctrine; canonical single source, delivered per surface; references/ownership-map.md maps each governed moment to its owning document
        brainstorming/               Design conversation, spec in docs/plans/, scope-check, commit model
        executing-work/              Autonomous section loop with the completion contract: implement, verify, review, Chapter
        finishing-work/              QA, security, docs curation, final review, close-out, integration per commit model
        systematic-debugging/        Root-cause discipline before any fix
        testing-discipline/          Litmus for what earns a test and what retires one, the shape priced at authoring, the gate's lanes, red protocol, contention rule
        responding-to-review/        How to weigh and answer review findings; no performative agreement
        writing-skills/              Authoring and testing skills, amending curated prose the kit ships, and what a sentence has to earn to stay
        kaizen/                      Capture kit friction, reflect into briefs, apply improvements
        design-council/              Opt-in multi-lens pressure-test for a hard-to-reverse design fork
        cold/                        Neutral evidence-first lens for non-code judgment calls
        consult/                     Fresh-context single-judge ruling on a question a stuck run cannot settle
        peer-sessions/               Discover and message live peer sessions: tool contracts, sanctioned patterns, etiquette
        coordinator/                 The machine-coordinator seat's runbook: operator interface, cross-repo sequencing, resource arbitration, kaizen capture and dispatch, a board in the memory store
        role/                        The /role <Seat> takeover ritual: the coordinator-directory contract, the session registry, the heavy-process claim, the standing-grant rail whose first instance is the operator's standing delegation
        standing-watch/              Repeating watch loop over a live system you do not own: runbook, ledger, wake and sleep
        recap/                       /recap reports where one session stands without disturbing it: restate from memory, refresh, report, diff the drift
        kit-goal/                    /kit-goal <plan> arms a deterministic project-scoped completion leash
        kit-doctor/                  Validate and repair the machine's kit install (runs the payload doctor)
        branch-hygiene/              Clean up branches and worktrees after Branch-and-PR; reap merged, recover stranded
        curating-docs/               docs/ taxonomy: plan archival, backlog pruning, indexes and cross-references
        memory-system/               The memq store: recall at effort start and at a seat takeover, outcome journal, applied stamps, tags, decay and pinning, type and operator tiers, shared-tier repair and delete
        csharp-style/                C# house style + detailed reference
        sql-style/                   T-SQL house style + detailed reference
        scott-writing-style/         Document/prose style guide
      agents/
        implementer-haiku.md         Tiered implementer: pure transcription from a named sibling + self-surfacing gate
        implementer-sonnet.md        Tiered implementer: mechanical, sibling-pattern sections
        implementer-opus.md          Tiered implementer: multi-file or nuanced sections
        implementer-fable.md         Tiered implementer: top tier, inherits session model or takes the fable override
        adversarial-reviewer.md      Fresh-context spec-compliance + code-quality review
        blind-reviewer.md            Diff-only correctness review, dispatched without the spec or intent story
        prose-reviewer.md            Adversarial review of a document against its spec, fact base, and audience, accuracy before style
        blind-reader.md              Blind outside-reader review of a document, dispatched as a named persona without an intent story alongside it
        qa-verifier.md               Build, tests, acceptance criteria with evidence
        security-reviewer.md         OWASP + SOC 2 review; procedure-only model where a project uses it
        docs-curator.md              Updates docs/, returns Drift Report
        council-member.md            Read-only lens on the design council (one per lens)
        design-facilitator.md        Neutral convergence judge for the design council
        consultant.md                Fresh-context single-agent ruling on a question a stuck run cannot settle
      hooks/
        hooks.json                   Hook registrations
        session-start.js             Re-injects in-progress plans on startup/resume/compaction, flags
                                     Complete-but-unarchived plans, and reports the active backlog's
                                     item count and oldest-item age
        format-on-edit.js            CSharpier on edited .cs files (silent when not installed)
        doctrine-refresh.js          Rewrites ~/.claude/claude-kit-doctrine.md from the installed skill each session
        kit-goal.js / kit-goal-stop.js / kit-goal-lib.js
                                     The /kit-goal leash: arm command, deterministic Stop hook, shared library
        kit-compact-gate.js / kit-compact-checkpoint.js / kit-compact-lib.js
                                     Compaction scheduling: PreCompact hook that defers auto-compaction to a
                                     chapter boundary on a leashed run and to a safety ceiling on a hands-on
                                     one, the checkpoint command that marks a boundary, shared library
        kit-network-lib.js           Shared predicate for network-share paths (UNC and //server forms),
                                     kept tiny so hot hook paths can load it without paying for memq.js
        chapter-boundary-nudge.js    PostToolUse nudge that puts the boundary steps in front of a leashed
                                     run when it appends a Chapter to a plan doc, so the checkpoint the
                                     compaction gate waits on gets opened
        compact-deferral-nudge.js    PostToolUse nudge, two directives: tells a leashed run the gate
                                     holds auto-compaction offers and names the boundary steps that
                                     land one; and above a context floor, tells a session holding no leash
                                     to judge its own state durable and declare it, each once per 30 minutes
        memory-recognition-nudge.js  Nudge on four boundaries, both tool ones plus a prompt arriving and a
                                     subagent dispatching, naming a memory the session's own work touches,
                                     deduplicated per trigger per recipient per boundary class per session, capped per
                                     rolling window at the session's own boundaries and per injection at a dispatch,
                                     pointing at memq get and never carrying the record itself
        docs-write-guard.js          Denies non-curator subagent writes into docs/
        stop-docs-hygiene.js         Stop-time docs-library backstop
        seat-stop.js                 Stop hook for a registered seat: stamps its registry heartbeat and,
                                     where its status push is recent and the tree is clean, opens the
                                     compaction gate's role-boundary marker
        pr-docs-guard.js             Requires the docs work committed before the PR goes up
        merged-pr-push-guard.js      Blocks pushes to a branch whose PR already merged
        readonly-agent-guard.js      Keeps the judgment agents from mutating the tree they review
        memq-grant.js                The one hook that grants rather than denies: allows exactly one memq
                                     invocation so a fleet worker on a write-gated vector keeps the CLI
        branch-reaper-nudge.js       SessionStart nudge for reapable/stranded branches
        kit-version-nudge.js         Warns when the session is running a stale kit build
        hook-canary.js               SessionStart probe that the installed kit hooks are alive
        memory-frontmatter-guard.js  PreToolUse guard on memory records: checks a record's frontmatter
                                     at the write and keeps the write tools off the two CLI-authored
                                     shared tiers; fails open, denying only what memq would not read
        memory-usage-stamp.js        Stamps reads of memory files to the store's usage sidecar
        memory-session.js            SessionStart decay nudge, both tiers' memory indexes, and the
                                     memory write destination for a pinned or run-scoped session
      scripts/
        memq.js                      The memory-store CLI: recall (the whole store as one bounded digest, no
                                     search term), find, get, log, touch, recent, unstamped, anchor,
                                     triggers, add-type, add-operator, delete-type, delete-operator, and the
                                     decay pass (scan, prune, done) with use-extended thresholds and
                                     pinning. Inside a run an external engine spawned, reads and writes also
                                     span that run's own pending tier, which the engine adjudicates before
                                     promotion
        memq-shim.js                 Resolves the installed payload's memq.js so the PATH wrappers stay stable
        kit-goal-statusline.js       Status-line widget: the armed /kit-goal plan, sections complete of
                                     total with the last Chapter's Next pointer, and queue position
        kit-statusline.js            Launcher for the widget, installed to ~/.claude/bin by the doctor;
                                     resolves the payload through memq-shim.js so the status-line
                                     setting survives kit updates
        kit-size.js                  The size reader, and a repo-only tool despite shipping here: it
                                     measures the payload's curated prose, the home/ files that land in the
                                     user's home directory, and every test/*.test.js in lines. check is the
                                     ratchet's own gate; report opens with a subject line naming the repository,
                                     then reads the worktree against HEAD and prints one line per file whose size
                                     moved with its cap and delta, its totals, and any untracked file sitting
                                     under a measured root; init writes a budget at current sizes
      doctor/
        install-memq-shim.ps1        Installs the per-shell memq wrappers onto PATH and the status-line
                                     launcher (run by the doctor)
        install-memory-sync.ps1      Memory-sync allowlist, state, and initialization (run by the doctor)
        install-embedder.ps1         Embedder probe, install, and index health (run by the doctor)
        install-compact-window.ps1   Writes autoCompactWindow into user settings.json (run by the doctor
                                     under -Fix; backs up, verifies, and aborts rather than clobbering)
        doctor.ps1                   The kit doctor (ships with the plugin, so installed machines have it):
                                     policy, ANTHROPIC_API_KEY hazard, doctrine import + freshness, signpost,
                                     hooks (goal leash wiring and load, hook canary wiring, the memq shim),
                                     memory sync, the embedder, and the auto-compaction window. Flags:
                                     -Fix and -Yes (pre-answers prompts). Under -Fix the
                                     auto-compaction check offers to write your user settings.json, the
                                     only change it makes to harness config.
        doctor.cmd                   Execution-policy-proof wrapper (a fresh Windows box blocks .ps1 by default)
  kaizen/                            Kit self-improvement inbox (per-machine notes-*.md + briefs/)
  settings/settings.recommended.json Permission rules + acceptEdits starting point
  doctor.ps1 / doctor.cmd            Thin forwarders to the payload doctor (kept for the repo-root habit)
  setup.sh                           POSIX first-run setup: kaizen signpost + git hook wiring (until a doctor.sh exists)
  build.ps1 / build.sh               Package plugins/claude-kit -> plugins/claude-kit.zip (claude-kit/ at archive root) for manual upload
  .githooks/pre-commit               Rebuilds the zip on commit when plugin sources change (wired via core.hooksPath)
```

The catalog at `.claude-plugin/marketplace.json` points to the plugin with `"source": "./plugins/claude-kit"` - relative paths resolve against the repo root and work because the marketplace is added via git. Additional plugins later: add a folder under `plugins/` and a second entry in the catalog.

## INSTALL (per machine)

1. Push this repo to GitHub (private is fine).

2. Validate before pushing (catches structure/schema mistakes):
   ```
   claude plugin validate .
   claude plugin validate ./plugins/claude-kit
   ```

3. In Claude Code:
   ```
   /plugin marketplace add <your-github-username>/claude-kit
   /plugin install claude-kit@applefeld
   ```
   Default scope is user, so every project picks it up. If the marketplace was added before a structure fix, refresh it first: `/plugin marketplace update applefeld` (or remove and re-add).

4. Wire the dev clone (kaizen signpost + git hooks; this no longer installs a user CLAUDE.md):
   - Windows: `.\doctor.cmd -Fix` (setup and verification in one pass; the wrapper works on a fresh box, where the default execution policy blocks `.ps1` files)
   - WSL/macOS/Linux: `./setup.sh`

5. Merge `settings/settings.recommended.json` into `~/.claude/settings.json` (review the allow-list first - it includes `git push`, which every commit model but Review-Only relies on; remove it if you want pushes gated).

6. Operating doctrine (single-sourced as the `operating-instructions` skill, which rides plugin auto-update):
   - Claude Code (once per machine): add `@claude-kit-doctrine.md` to `~/.claude/CLAUDE.md`. The `doctrine-refresh` hook rewrites that imported file from the installed skill each session, so the doctrine loads always-on and stays current; the hook offers to add the line if it is missing.
   - Cowork / Chat (once per account): add to your account personal preferences: `Before any non-trivial task, consult the operating-instructions skill.` Plugins cannot write account preferences and Cowork/Chat do not read `~/.claude`, so this one line is the only manual step there.

7. Verify the machine (Windows): run the doctor. On a clone, `.\doctor.cmd` from the repo root; on an install-only machine, `/claude-kit:kit-doctor` in any session (the doctor ships inside the plugin payload), or the payload path directly: `<plugin cache>\doctor\doctor.cmd`. One pass covers execution policy, the `ANTHROPIC_API_KEY` hazard, the doctrine import and content freshness, the kaizen signpost, git hooks, the goal-leash and hook-canary wiring, the memq shim, memory sync, the embedder, and the auto-compaction window. `-Fix` applies the safe durable repairs (`-Yes` pre-answers prompts for unattended runs); it deletes nothing.

Updating. Commit and push here first. The plugin's version is the git commit SHA (`plugin.json` omits `version`), so every commit is a new version with no version bumping. How you pull that update differs by surface, and the surfaces are SEPARATE installs:

- **Desktop app (Chat, Cowork, and Code share one install).** There is no update button on the plugin card itself, and `/plugin` slash commands do not work in the Desktop chat. Open the plugin Directory (Customize) -> Plugins -> Personal -> open the plugin's marketplace (its blue marketplace link, or the Local uploads entry) -> the `...` menu -> Check for updates (it shows the latest synced commit). Then go back to the plugin and its Update button lights up; updating propagates to Chat, Cowork, and Code at once. The same `...` menu has a Sync automatically toggle, off by default for a personal marketplace, so turn it on to skip this dance on future commits.
- **Terminal CLI is a separate install** and does not share the Desktop app's plugin copy: `/plugin marketplace update applefeld` then `/plugin update claude-kit` updates the CLI only. Updating one surface family does not update the other.

The README and docs are repo-level, not plugin payload, so they need no plugin update. The doctrine rides the plugin and updates with it (no setup re-run): Code via the import + `doctrine-refresh` hook, Cowork/Chat via the skill.

### Installing where GitHub isn't reachable (zip upload)

Some environments - for example a work Cowork/Chat account that can't reach this private GitHub - can't add the marketplace by repo. For those, upload the packaged plugin zip instead:

- `build.ps1` (Windows, canonical) or `build.sh` (Linux/macOS) packages `plugins/claude-kit/` into `plugins/claude-kit.zip` with `claude-kit/` at the archive root - the layout the zip-upload flow expects. The build is deterministic (sorted entries, fixed timestamps).
- The pre-commit hook rebuilds the zip automatically whenever a commit changes plugin sources, so the artifact stays current. It's wired via `git config core.hooksPath .githooks`; on a fresh clone, run `doctor.cmd -Fix` (Windows) or `./setup.sh` (POSIX), or set that config by hand, to activate it. Run `build.ps1`/`build.sh` directly anytime you want a fresh zip without committing.
- The zip is gitignored - it's a local build artifact you carry by hand, not something committed.

## THE WORKFLOW

Every intake along the way, a prompt, a handoff, a spec, or a dispatch brief, opens with the intake gap check: list what the input does not state, then resolve each gap from an existing source, take a declared low-blast default, or ask Scott. Whatever the session decides for itself is declared on a surface he reads rather than only in a document. Brainstorming produces a spec in `docs/plans/<project>_spec_v1.md` with a recorded commit model: Review-Only (stage, Scott reviews the diff), Branch-and-PR (feature branch and a PR, for shared repos), or Commit-and-Push (land on main and auto-tear-down any worktree branch it used). At a hard, hard-to-reverse design fork it can offer a read-only design council (`design-council`) that pressure-tests the candidate approaches through blind, independent lens positions and facilitator-run convergence rounds, returning a recommendation or a clean fork for Scott, offered and never automatic. Executing-work runs the spec section by section under the completion contract (it drives every remaining unblocked section to done rather than pausing at boundaries): implement, verify with evidence, a paired review (spec-anchored adversarial plus blind diff-only, with security review added on sensitive surfaces), update the plan, append a Chapter, commit per the model. Finishing-work closes the effort: qa-verifier, security-reviewer, final adversarial-reviewer pass, docs-curator with Drift Report, plan closed, changes presented, pushed, or opened as a PR per the model.

Compaction recovery is deterministic: the SessionStart hook fires on startup, resume, and after every compaction, finds in-progress plans, and instructs the session to re-read them - Chapters included - before any work proceeds.

Compaction *placement* is deterministic too, on a leashed run. Nothing can raise a compaction on demand, but a PreCompact hook can veto one, and a denied auto attempt is re-offered every turn until it is allowed. `kit-compact-gate.js` uses that to schedule, and it schedules two populations differently. On a leashed run it defers auto-compaction while a chapter is in flight and stands aside once the chapter-close ritual has opened a checkpoint, so the context wipe falls where nothing is half-finished instead of at an arbitrary point mid-section. Every other session gets the other treatment: a hands-on one defers to a safety ceiling far above the configured trigger, so a long working stretch keeps its context instead of being compacted in the middle of a discussion, while a session being driven by a native `/goal` or `/loop` is left on the early trigger, which is what an automated run wants. Which one a session is, the gate reads from the transcript.

The kit summarizes nothing itself; the native summarizer runs unmodified. It never touches manual `/compact`, and every error path, every unreadable transcript, and every ambiguity allows, so its worst failure is the pre-gate behavior. The safety ceiling ends both deferrals, because a session held against the hard context limit dies outright. That ceiling is an absolute token count sized for the roughly 1,000,000-token window these models carry, which is the one assumption here that does not fail safe and that nothing detects; `docs/security-model.md` carries it, along with what bounds it.

The same hook keeps the backlog from rotting. In any project holding a `docs/backlog.md`, session start reports how many active items it carries, the oldest one's parked date and its age in days, and how many carry no date at all, injecting those figures and never an item's text. Anything older than 90 days is named, with its date, for a promote/retire/keep call at the next close-out.

`/kit-goal docs/plans/<plan>.md` arms a project-scoped completion leash for a run in one line, enforced by a deterministic Stop hook (no LLM evaluator) whose state lives in `.kit/` and so outlives a session boundary, unlike native `/goal`, whose state is bound to the transcript. The hook enforces on session identity, and native compaction preserves the session id, so an armed run rides its own auto-compactions with the leash intact; re-arming is the one-line recovery if a run ever resumes under a new session. The hook allows a stop only when the plan is Complete or archived, or the last message leads with `BLOCKED:` or with `WAITING:` naming dispatched work still running; otherwise it blocks with a reason naming the plan. One arming carries an ordered queue of plans, and a terminal state on any but the last advances the leash instead of releasing it. Clear an armed goal with `/kit-goal clear`.

## MODEL TIERING

Token cost concentrates in implementation, so the kit splits roles by model. The main session orchestrates: brainstorming, spec writing, debugging, orchestration, and all reviews. Implementation of each Section of Work dispatches to a tiered agent - `implementer-haiku` for pure transcription (an exact sibling to clone and a self-surfacing gate, both named in the brief); `implementer-sonnet` for mechanical, sibling-pattern work; `implementer-opus` for multi-file or nuanced sections; `implementer-fable`, which inherits the session model (or takes the explicit `fable` override from a below-fable session) so the top tier always runs the strongest model available, for sections that need the strongest model but can still be built from a precise brief. Tier picks the model; briefability picks the locus, recorded on its own `Locus: inline` line beneath the bare `Model:` tier: a section stays in the main thread only when its spec is likely to evolve in contact with the code or it is too small to be worth a brief. The brainstorming skill assigns the tier per section at planning time; the executing-work skill dispatches, enforces a NEEDS_CONTEXT/BLOCKED escalation protocol (implementers ask instead of guessing), and escalates a twice-failed section (Fable-led, into the main thread; on a lower-model session, one re-dispatch to `implementer-fable` at the `fable` override first). The haiku tier is the exception to the two-failure rule: a single Critical-finding review re-dispatches it at sonnet, because a Critical from a transcription section means it was mis-banded and review rounds cost more than the tier delta saved.

The session model is the mode. Fable is included in the plan's allotment rather than metered separately, and an exhausted allotment yields no work rather than a bill, so the question a tier answers is which model should do the work and never whether to spend. A Fable-led session is for design: brainstorming, specs, adjudication, and the finishing pass of a high-stakes effort. That is a guidance rather than a cost rule, because a Fable-led execution session burns the shared allotment fastest where it adds least, and it cannot fall back mid-session the way a dispatch can, the session model being the session. A session on a lower model (Opus-led) executes an approved spec at its own model, and Fable enters by explicit model override at the judgment moments: the per-section review round over a section whose writer tier is opus or fable (each reviewer runs one tier above the tier that built the section, with Fable as the ceiling, so a section built at sonnet or haiku gets Opus or Sonnet reviewers at `high` through the Workflow route), sections the spec tiered `fable`, the escalation after a section fails review twice, and the finishing-pass reviews, which run at Fable by default. Where Fable is unreachable for a first-aim Fable reviewer or the consultant, the stand-in is Opus at `max` to compensate for the lost tier, and a reviewer aimed below Fable re-aims one tier up instead; an implementer never takes that notch, executing-work's tier-escalation rule owning what happens to one instead. Unreachability is confirmed per finishing-work's unavailability rule, which owns both of its triggers and the wedge hallmark one of them rests on, and recorded in the Chapter with whatever evidence the trigger that fired left behind, so a downgrade nobody chose never passes unremarked. `docs-curator` pins to `model: opus` and `qa-verifier` to `model: sonnet` rather than inheriting the session model: their work is disciplined evidence-gathering and doc-writing, not novel judgment, so they do not ride a Fable-led session up to the top tier and drain the shared allotment where it buys nothing (the curator keeps opus because classifying drift as mistake versus deviation gates the finishing run; the verifier's evidence-per-criterion contract makes a false PASS hard, so it rides the cheaper pin). The reviewer agents (`adversarial-reviewer`, `blind-reviewer`, `prose-reviewer`, `blind-reader`, `security-reviewer`) pin no model deliberately, inheriting the session model and taking the per-section and finishing-pass overrides above. `blind-reader` is unpinned on the same terms and reaches the finishing-pass override rarely, because finishing-work re-runs it only for a document that changed after its section review.

Quality is protected by three things, none of which is the implementer's model: spec precision (a section only earns a cheap tier if a context-free implementer can build it from the section text alone), fresh-context adversarial review one tier above the writer with Fable at the top, and the final whole-changeset review at Fable in finishing-work, which treats a section the rule aimed below Fable, or whose round ended ungated, as uncleared. The cost profile inverts the naive approach: the expensive model reads diffs and writes specs; the cheap models write the bulk of the code. Read-only recon is banded the same way (executing-work, Delegating to subagents): a closed fact-check rides the harness default (haiku) because a wrong answer is self-surfacing at confirmation time; open discovery gets an explicit sonnet override, because the failure confirmation cannot catch is the miss.

## CONVENTIONS

- Specs and plans: `docs/plans/` in each project, named `<project>_<content-type>_v1.md`, versions increment, never overwrite.
- Chapters are appended to the plan doc, not kept in a separate file. The plan doc is the single source of truth for intent and state.
- Durable learnings go to the kit memory store, not into plan docs or CLAUDE.md. One fact per file with an index line beside it, written under the `memory-system` skill's bar and read back through `memq`; the SessionStart hook names the store's directory and its index at the start of an ordinary session. The store works the same whether Claude Code's own auto-memory is on or off.
- Project CLAUDE.md files carry what is true of that project only: build commands, architecture pointers, and the rules that hold nowhere else (a product's honesty, identity, and privacy gates, its test-suite naming), stated next to the gate tests that enforce them. Global rules live in the operating-instructions skill (delivered always-on in Code via the `~/.claude/CLAUDE.md` import of `@claude-kit-doctrine.md`, and available as a skill in Cowork/Chat), which carries only what is general and not already guaranteed by the harness; the mechanics of a workflow moment live in the skill that owns it.
- Each project documents its access architecture and accepted risks in `docs/security-model.md` (for example, a procedure-only or impersonation model: the roles, schema, impersonation mechanism, and any accepted-risk rationale). The security-reviewer agent reads it first, verifies the code upholds it, and re-checks accepted-risk preconditions instead of re-flagging them, which is also the document auditors ask for.

## NOTES AND KNOWN TRADEOFFS

- Plugin skills are namespaced: explicit invocation is `/claude-kit:brainstorming`. Automatic (model-invoked) triggering is unaffected.
- The format-on-edit hook rewrites .cs files on disk after Claude edits them. If a subsequent edit fails to match file contents, that is the formatter's doing - Claude re-reads and retries. Remove the `format-on-edit.js` command object from its PostToolUse group in `hooks/hooks.json` if this annoys more than it helps; that group holds a second command, the chapter-boundary nudge, which should stay.
- Plugins are copied to a cache at install (`~/.claude/plugins/cache`); the plugin cannot reference files outside `plugins/claude-kit/`. That is why `home/` and `settings/` live outside the plugin - they are machine-setup assets, not plugin components.
- Plugin-shipped agents cannot declare their own hooks, MCP servers, or permissionMode (Claude Code security restriction). None of these agents need them.
- `settings.recommended.json` reflects the settings schema as of June 2026; verify key names against current docs if something is ignored: https://code.claude.com/docs/en/settings

END RESULT: clone, install, and every project on every machine has the same rules, the same workflow, the same reviewers, and the same recovery behavior - maintained in one place.
