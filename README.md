# claude-kit

Scott Applefeld's personal Claude Code marketplace. One repo that every project picks up: workflow skills (brainstorm, execute, finish) with a drive-to-completion contract and per-section model down-selection, discipline skills (systematic debugging, responding to review, skill authoring, kaizen self-improvement, a multi-lens design council, and cold judgment calls), fresh-context review agents, C# and T-SQL house-style guides, and a hardened compaction-recovery hook, packaged as the `claude-kit` plugin in the `applefeld` marketplace.

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
        adversarial-reviewer.md      Fresh-context spec-compliance + code-quality review
        qa-verifier.md               Build, tests, acceptance criteria with evidence
        security-reviewer.md         OWASP + SOC 2 review; procedure-only model where a project uses it
        docs-curator.md              Updates docs/, returns Drift Report
        council-member.md            Read-only lens on the design council (one per lens)
        design-facilitator.md        Neutral convergence judge for the design council
      hooks/
        hooks.json                   Hook registrations
        session-start.js             Re-injects in-progress plans on startup/resume/compaction
        format-on-edit.js            CSharpier on edited .cs files (silent when not installed)
  kaizen/                            Kit self-improvement inbox (per-machine notes-*.md + briefs/)
  settings/settings.recommended.json Permission rules + acceptEdits starting point
  setup.ps1 / setup.sh               Dev-clone setup: kaizen signpost (~/.claude/claude-kit.local.json) + git hook wiring
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
   - Windows: `.\setup.ps1`
   - WSL/macOS/Linux: `./setup.sh`

5. Merge `settings/settings.recommended.json` into `~/.claude/settings.json` (review the allow-list first - it includes `git push` for the Commit-and-Push model; remove it if you want pushes gated).

6. Operating doctrine (single-sourced as the `operating-instructions` skill, which rides plugin auto-update):
   - Claude Code (once per machine): add `@claude-kit-doctrine.md` to `~/.claude/CLAUDE.md`. The `doctrine-refresh` hook rewrites that imported file from the installed skill each session, so the doctrine loads always-on and stays current; the hook offers to add the line if it is missing.
   - Cowork / Chat (once per account): add to your account personal preferences: `Before any non-trivial task, consult the operating-instructions skill.` Plugins cannot write account preferences and Cowork/Chat do not read `~/.claude`, so this one line is the only manual step there.

Updating. Commit and push here first. The plugin's version is the git commit SHA (`plugin.json` omits `version`), so every commit is a new version with no version bumping. How you pull that update differs by surface, and the surfaces are SEPARATE installs:

- **Desktop app (Chat, Cowork, and Code share one install).** There is no update button on the plugin card itself, and `/plugin` slash commands do not work in the Desktop chat. Open the plugin Directory (Customize) -> Plugins -> Personal -> open the plugin's marketplace (its blue marketplace link, or the Local uploads entry) -> the `...` menu -> Check for updates (it shows the latest synced commit). Then go back to the plugin and its Update button lights up; updating propagates to Chat, Cowork, and Code at once. The same `...` menu has a Sync automatically toggle, off by default for a personal marketplace, so turn it on to skip this dance on future commits.
- **Terminal CLI is a separate install** and does not share the Desktop app's plugin copy: `/plugin marketplace update applefeld` then `/plugin update claude-kit` updates the CLI only. Updating one surface family does not update the other.

The README and docs are repo-level, not plugin payload, so they need no plugin update. The doctrine rides the plugin and updates with it (no setup re-run): Code via the import + `doctrine-refresh` hook, Cowork/Chat via the skill.

### Installing where GitHub isn't reachable (zip upload)

Some environments - for example a work Cowork/Chat account that can't reach this private GitHub - can't add the marketplace by repo. For those, upload the packaged plugin zip instead:

- `build.ps1` (Windows, canonical) or `build.sh` (Linux/macOS) packages `plugins/claude-kit/` into `plugins/claude-kit.zip` with `claude-kit/` at the archive root - the layout the zip-upload flow expects. The build is deterministic (sorted entries, fixed timestamps).
- The pre-commit hook rebuilds the zip automatically whenever a commit changes plugin sources, so the artifact stays current. It's wired by the setup script via `git config core.hooksPath .githooks`; on a fresh clone, run `setup.ps1`/`setup.sh` (or set that config by hand) to activate it. Run `build.ps1`/`build.sh` directly anytime you want a fresh zip without committing.
- The zip is gitignored - it's a local build artifact you carry by hand, not something committed.

## THE WORKFLOW

Brainstorming produces a spec in `docs/plans/<project>_spec_v1.md` with a recorded commit model: Review-Only (stage, Scott reviews the diff), Branch-and-PR (feature branch and a PR, for shared repos), or Commit-and-Push (land on main and auto-tear-down any worktree branch it used). At a hard, hard-to-reverse design fork it can offer a read-only design council (`design-council`) that pressure-tests the candidate approaches through blind, independent lens positions and facilitator-run convergence rounds, returning a recommendation or a clean fork for Scott, offered and never automatic. Executing-work runs the spec section by section under the completion contract (it drives every remaining unblocked section to done rather than pausing at boundaries): implement, verify with evidence, adversarial review (plus security review on sensitive surfaces), update the plan, append a Chapter, commit per the model. Finishing-work closes the effort: qa-verifier, security-reviewer, final adversarial-reviewer pass, docs-curator with Drift Report, plan closed, changes presented, pushed, or opened as a PR per the model.

Compaction recovery is deterministic: the SessionStart hook fires on startup, resume, and after every compaction, finds in-progress plans, and instructs the session to re-read them - Chapters included - before any work proceeds.

## MODEL TIERING

Token cost concentrates in implementation, so the kit splits roles by model. The main session (the strongest model, highest effort) does the thinking: brainstorming, spec writing, debugging, orchestration, and all reviews. Implementation of each Section of Work dispatches to a tiered agent - `implementer-sonnet` for mechanical, sibling-pattern work; `implementer-opus` for multi-file or nuanced sections; tier `fable` stays in the main thread for novel or security-sensitive work. The brainstorming skill assigns the tier per section at planning time; the executing-work skill dispatches, enforces a NEEDS_CONTEXT/BLOCKED escalation protocol (implementers ask instead of guessing), and takes a section over in the main thread after two failed review rounds at its tier.

Quality is protected by three things, none of which is the implementer's model: spec precision (a section only earns a cheap tier if a context-free implementer can build it from the section text alone), fresh-context adversarial review by the strong model, and the final whole-changeset review in finishing-work. The cost profile inverts the naive approach: the expensive model reads diffs and writes specs; the cheap models write the bulk of the code.

## CONVENTIONS

- Specs and plans: `docs/plans/` in each project, named `<project>_<content-type>_v1.md`, versions increment, never overwrite.
- Chapters are appended to the plan doc, not kept in a separate file. The plan doc is the single source of truth for intent and state.
- Durable learnings go to Claude Code auto memory (curate with `/memory`), not into plan docs or CLAUDE.md.
- Project CLAUDE.md files carry only project-specific facts (build commands, architecture pointers); global rules live in the operating-instructions skill (delivered always-on in Code via the `~/.claude/CLAUDE.md` import of `@claude-kit-doctrine.md`, and available as a skill in Cowork/Chat).
- Each project documents its access architecture and accepted risks in `docs/security-model.md` (for example, a procedure-only or impersonation model: the roles, schema, impersonation mechanism, and any accepted-risk rationale). The security-reviewer agent reads it first, verifies the code upholds it, and re-checks accepted-risk preconditions instead of re-flagging them, w