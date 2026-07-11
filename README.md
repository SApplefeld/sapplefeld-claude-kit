# claude-kit

Scott Applefeld's personal Claude Code marketplace. One repo that every project picks up: workflow skills (brainstorm, execute, finish) with a drive-to-completion contract and per-section model down-selection, discipline skills (systematic debugging, responding to review, skill authoring, kaizen self-improvement, a multi-lens design council, and cold judgment calls), fresh-context review agents, C# and T-SQL house-style guides, a hardened compaction-recovery hook, and deliberate low-loss session compaction with a headless continuation chain, packaged as the `claude-kit` plugin in the `applefeld` marketplace.

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
        operating-instructions/      Always-apply operating doctrine; canonical single source, delivered per surface
        brainstorming/               Design conversation, spec in docs/plans/, scope-check, commit model
        executing-work/              Autonomous section loop with the completion contract: implement, verify, review, Chapter
        finishing-work/              QA, security, docs curation, final review, close-out, integration per commit model
        compact-session/             Low-loss compaction at section boundaries + the headless continuation chain (bundles the vendored engine)
        systematic-debugging/        Root-cause discipline before any fix
        responding-to-review/        How to weigh and answer review findings; no performative agreement
        writing-skills/              Authoring and testing the kit's own behavior-shaping skills
        kaizen/                      Capture kit friction, reflect into briefs, apply improvements
        design-council/              Opt-in multi-lens pressure-test for a hard-to-reverse design fork
        cold/                        Neutral evidence-first lens for non-code judgment calls
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
        qa-verifier.md               Build, tests, acceptance criteria with evidence
        security-reviewer.md         OWASP + SOC 2 review; procedure-only model where a project uses it
        docs-curator.md              Updates docs/, returns Drift Report
        council-member.md            Read-only lens on the design council (one per lens)
        design-facilitator.md        Neutral convergence judge for the design council
      hooks/
        hooks.json                   Hook registrations
        session-start.js             Re-injects in-progress plans on startup/resume/compaction
        format-on-edit.js            CSharpier on edited .cs files (silent when not installed)
      doctor/
        doctor.ps1                   The kit doctor (ships with the plugin, so installed machines have it):
                                     policy, bun (with consented winget install under -Fix), engine smoke runs
                                     including the compaction --check layer, claude CLI shape and login probe,
                                     ANTHROPIC_API_KEY hazard, doctrine import + freshness, signpost, hooks,
                                     relay state + AutoHotkey. Flags: -Fix, -Yes (unattended installs), -NoProbe.
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

5. Merge `settings/settings.recommended.json` into `~/.claude/settings.json` (review the allow-list first - it includes `git push` for the Commit-and-Push model; remove it if you want pushes gated).

6. Operating doctrine (single-sourced as the `operating-instructions` skill, which rides plugin auto-update):
   - Claude Code (once per machine): add `@claude-kit-doctrine.md` to `~/.claude/CLAUDE.md`. The `doctrine-refresh` hook rewrites that imported file from the installed skill each session, so the doctrine loads always-on and stays current; the hook offers to add the line if it is missing.
   - Cowork / Chat (once per account): add to your account personal preferences: `Before any non-trivial task, consult the operating-instructions skill.` Plugins cannot write account preferences and Cowork/Chat do not read `~/.claude`, so this one line is the only manual step there.

7. Verify the machine (Windows): run the doctor. On a clone, `.\doctor.cmd` from the repo root; on an install-only machine, `/claude-kit:kit-doctor` in any session (the doctor ships inside the plugin payload), or the payload path directly: `<plugin cache>\doctor\doctor.cmd`. One pass covers execution policy, bun resolution, real smoke runs of the compaction engine including its `--check` threshold layer, the `claude` CLI shape and a live login probe (the summarizer needs `claude /login` once per machine; `-NoProbe` skips the probe), the `ANTHROPIC_API_KEY` hazard, the doctrine import and content freshness, the kaizen signpost, git hooks, and the resume relay's state including AutoHotkey v2. `-Fix` applies the safe durable repairs and offers a consented bun install via winget (`-Yes` pre-answers for unattended runs). Arming the resume relay stays a deliberate separate step (`plugins/claude-kit/skills/compact-session/relay/arm-resume-relay.ps1`); the doctor reports its state but never arms it.

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

Brainstorming produces a spec in `docs/plans/<project>_spec_v1.md` with a recorded commit model: Review-Only (stage, Scott reviews the diff), Branch-and-PR (feature branch and a PR, for shared repos), or Commit-and-Push (land on main and auto-tear-down any worktree branch it used). At a hard, hard-to-reverse design fork it can offer a read-only design council (`design-council`) that pressure-tests the candidate approaches through blind, independent lens positions and facilitator-run convergence rounds, returning a recommendation or a clean fork for Scott, offered and never automatic. Executing-work runs the spec section by section under the completion contract (it drives every remaining unblocked section to done rather than pausing at boundaries): implement, verify with evidence, a paired review (spec-anchored adversarial plus blind diff-only, with security review added on sensitive surfaces), update the plan, append a Chapter, commit per the model. Finishing-work closes the effort: qa-verifier, security-reviewer, final adversarial-reviewer pass, docs-curator with Drift Report, plan closed, changes presented, pushed, or opened as a PR per the model.

Compaction recovery is deterministic: the SessionStart hook fires on startup, resume, and after every compaction, finds in-progress plans, and instructs the session to re-read them - Chapters included - before any work proceeds.

## MODEL TIERING

Token cost concentrates in implementation, so the kit splits roles by model. The main session orchestrates: brainstorming, spec writing, debugging, orchestration, and all reviews. Implementation of each Section of Work dispatches to a tiered agent - `implementer-haiku` for pure transcription (an exact sibling to clone and a self-surfacing gate, both named in the brief); `implementer-sonnet` for mechanical, sibling-pattern work; `implementer-opus` for multi-file or nuanced sections; `implementer-fable`, which inherits the session model (or takes the explicit `fable` override from a below-fable session) so the top tier always runs the strongest model available, for sections that need the strongest model but can still be built from a precise brief. Tier picks the model; briefability picks the locus: a section is marked `fable (inline)` and stays in the main thread only when its spec is likely to evolve in contact with the code or it is too small to be worth a brief. The brainstorming skill assigns the tier per section at planning time; the executing-work skill dispatches, enforces a NEEDS_CONTEXT/BLOCKED escalation protocol (implementers ask instead of guessing), and escalates a twice-failed section (Fable-led, into the main thread; on a lower-model session, one re-dispatch to `implementer-fable` at the `fable` override first). The haiku tier is the exception to the two-failure rule: a single Critical-finding review re-dispatches it at sonnet, because a Critical from a transcription section means it was mis-banded and review rounds cost more than the tier delta saved.

The session model is the mode, because Fable bills per call to API credits with no plan coverage. A Fable-led session is for design: brainstorming, specs, adjudication, and the finishing pass of a high-stakes effort. A session on a lower model (Opus-led) executes an approved spec plan-covered, and Fable enters only by explicit model override at the judgment moments: sections the spec tiered `fable` (the tier is standing spend authorization, named in the spec's `Fable Spend` header line), the escalation after a section fails review twice, and the finishing-pass adversarial and security reviews, which run at Fable by default. The opt-out is explicit, never silent: on a cost hold the spec header records `Fable Spend: none (cost hold)`, finishing reviews run at the session model, and fable-tier sections build at the session model with the downgrade flagged in the Chapter. `docs-curator` pins to `model: opus` and `qa-verifier` to `model: sonnet` rather than inheriting the session model: their work is disciplined evidence-gathering and doc-writing, not novel judgment, so they do not ride a Fable-led session up to per-call prices (the curator keeps opus because classifying drift as mistake versus deviation gates the finishing run; the verifier's evidence-per-criterion contract makes a false PASS hard, so it rides the cheaper pin). The reviewer agents (`adversarial-reviewer`, `blind-reviewer`, `security-reviewer`, `council-member`) stay unpinned deliberately, inheriting the session model and picking up the finishing-pass override above.

Quality is protected by three things, none of which is the implementer's model: spec precision (a section only earns a cheap tier if a context-free implementer can build it from the section text alone), fresh-context adversarial review by the strong model, and the final whole-changeset review in finishing-work. The cost profile inverts the naive approach: the expensive model reads diffs and writes specs; the cheap models write the bulk of the code. Read-only recon is banded the same way (doctrine, Orchestrating fan-out work): a closed fact-check rides the harness default (haiku) because a wrong answer is self-surfacing at confirmation time; open discovery gets an explicit sonnet override, because the failure confirmation cannot catch is the miss.

## CONVENTIONS

- Specs and plans: `docs/plans/` in each project, named `<project>_<content-type>_v1.md`, versions increment, never overwrite.
- Chapters are appended to the plan doc, not kept in a separate file. The plan doc is the single source of truth for intent and state.
- Durable learnings go to Claude Code auto memory (curate with `/memory`), not into plan docs or CLAUDE.md.
- Project CLAUDE.md files carry only project-specific facts (build commands, architecture pointers); global rules live in the operating-instructions skill (delivered always-on in Code via the `~/.claude/CLAUDE.md` import of `@claude-kit-doctrine.md`, and available as a skill in Cowork/Chat).
- Each project documents its access architecture and accepted risks in `docs/security-model.md` (for example, a procedure-only or impersonation model: the roles, schema, impersonation mechanism, and any accepted-risk rationale). The security-reviewer agent reads it first, verifies the code upholds it, and re-checks accepted-risk preconditions instead of re-flagging them, which is also the document auditors ask for.

## NOTES AND KNOWN TRADEOFFS

- Plugin skills are namespaced: explicit invocation is `/claude-kit:brainstorming`. Automatic (model-invoked) triggering is unaffected.
- The format-on-edit hook rewrites .cs files on disk after Claude edits them. If a subsequent edit fails to match file contents, that is the formatter's doing - Claude re-reads and retries. Remove the PostToolUse block from `hooks/hooks.json` if this annoys more than it helps.
- Plugins are copied to a cache at install (`~/.claude/plugins/cache`); the plugin cannot reference files outside `plugins/claude-kit/`. That is why `home/` and `settings/` live outside the plugin - they are machine-setup assets, not plugin components.
- Plugin-shipped agents cannot declare their own hooks, MCP servers, or permissionMode (Claude Code security restriction). None of these agents need them.
- `settings.recommended.json` reflects the settings schema as of June 2026; verify key names against current docs if something is ignored: https://code.claude.com/docs/en/settings

END RESULT: clone, install, and every project on every machine has the same rules, the same workflow, the same reviewers, and the same recovery behavior - maintained in one place.
