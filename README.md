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
  home/CLAUDE.md                     Versioned user-level CLAUDE.md (installed by setup script)
  home/CLAUDE-FOR-FABLE.md           Leaner user-level CLAUDE.md variant for the Fable model
  settings/settings.recommended.json Permission rules + acceptEdits starting point
  setup.ps1 / setup.sh               Per-machine CLAUDE.md install + kaizen signpost (~/.claude/claude-kit.local.json) + git hook wiring
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

4. Install the user-level CLAUDE.md (plugins cannot ship memory files):
   - Windows: `.\setup.ps1`
   - WSL/macOS/Linux: `./setup.sh`

5. Merge `settings/settings.recommended.json` into `~/.claude/settings.json` (review the allow-list first - it includes `git push` for the Commit-and-Push model; remove it if you want pushes gated).

Updating: commit and push here, then `/plugin update claude-kit` on each machine. Because `plugin.json` omits `version`, every commit is a new version - no version bumping required. For private-repo background auto-updates, set `GITHUB_TOKEN` in your environment.

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
- Project CLAUDE.md files carry only project-specific facts (build commands, architecture pointers); global rules live in `home/CLAUDE.md` only.
- Each project documents its access architecture and accepted risks in `docs/security-model.md` (for example, a procedure-only or impersonation model: the roles, schema, impersonation mechanism, and any accepted-risk rationale). The security-reviewer agent reads it first, verifies the code upholds it, and re-checks accepted-risk preconditions instead of re-flagging them, which is also the document auditors ask for.

## NOTES AND KNOWN TRADEOFFS

- Plugin skills are namespaced: explicit invocation is `/claude-kit:brainstorming`. Automatic (model-invoked) triggering is unaffected.
- The format-on-edit hook rewrites .cs files on disk after Claude edits them. If a subsequent edit fails to match file contents, that is the formatter's doing - Claude re-reads and retries. Remove the PostToolUse block from `hooks/hooks.json` if this annoys more than it helps.
- Plugins are copied to a cache at install (`~/.claude/plugins/cache`); the plugin cannot reference files outside `plugins/claude-kit/`. That is why `home/` and `settings/` live outside the plugin - they are machine-setup assets, not plugin components.
- Plugin-shipped agents cannot declare their own hooks, MCP servers, or permissionMode (Claude Code security restriction). None of these agents need them.
- `settings.recommended.json` reflects the settings schema as of June 2026; verify key names against current docs if something is ignored: https://code.claude.com/docs/en/settings

END RESULT: clone, install, and every project on every machine has the same rules, the same workflow, the same reviewers, and the same recovery behavior - maintained in one place.
