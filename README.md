# claude-kit

Scott Applefeld's personal Claude Code marketplace. One repo that every project picks up: workflow skills (brainstorm → execute → finish), four review agents, C# and T-SQL house-style guides, and compaction-recovery hooks — packaged as the `claude-kit` plugin in the `applefeld` marketplace.

## STRUCTURE

```
claude-kit/                          (repo = the marketplace)
  .claude-plugin/
    marketplace.json                 Marketplace catalog (must live here)
  plugins/
    claude-kit/                      (the plugin)
      .claude-plugin/plugin.json     Plugin manifest (no version field — every
                                     commit counts as a new version)
      skills/
        brainstorming/               Design conversation → spec in docs/plans/ + commit model
        executing-work/              Autonomous section loop: implement, verify, review, Chapter
        finishing-work/              QA, security, docs curation, final review, close-out
        cold/                        Neutral evidence-first lens for non-code, high-stakes decisions
        csharp-style/                C# house style + detailed reference
        sql-style/                   T-SQL house style + detailed reference
        scott-writing-style/         Document/prose style guide
      agents/
        adversarial-reviewer.md      Fresh-context spec-compliance + code-quality review
        qa-verifier.md               Build, tests, acceptance criteria with evidence
        security-reviewer.md         OWASP + SOC 2 review tuned to the procedure-only model
        docs-curator.md              Updates docs/, returns Drift Report
      hooks/
        hooks.json                   Hook registrations
        session-start.js             Re-injects in-progress plans on startup/resume/compaction
        format-on-edit.js            CSharpier on edited .cs files (silent when not installed)
  home/CLAUDE.md                     Versioned user-level CLAUDE.md (installed by setup script)
  settings/settings.recommended.json Permission rules + acceptEdits starting point
  setup.ps1 / setup.sh               One-time per-machine CLAUDE.md install
```

The catalog at `.claude-plugin/marketplace.json` points to the plugin with `"source": "./plugins/claude-kit"` — relative paths resolve against the repo root and work because the marketplace is added via git. Additional plugins later: add a folder under `plugins/` and a second entry in the catalog.

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

5. Merge `settings/settings.recommended.json` into `~/.claude/settings.json` (review the allow-list first — it includes `git push` for the Commit-and-Push model; remove it if you want pushes gated).

Updating: commit and push here, then `/plugin update claude-kit` on each machine. Because `plugin.json` omits `version`, every commit is a new version — no version bumping required. For private-repo background auto-updates, set `GITHUB_TOKEN` in your environment.

## THE WORKFLOW

Brainstorming produces a spec in `docs/plans/<project>_spec_v1.md` with a recorded commit model (Review-Only or Commit-and-Push). Executing-work runs the spec section by section — implement, verify, adversarial review (plus security review on sensitive surfaces), update the plan, append a Chapter, commit per the model. Finishing-work closes the effort: qa-verifier, security-reviewer, final adversarial-reviewer pass, docs-curator with Drift Report, plan closed, changes presented or pushed per the model.

Compaction recovery is deterministic: the SessionStart hook fires on startup, resume, and after every compaction, finds in-progress plans, and instructs the session to re-read them — Chapters included — before any work proceeds.

## MODEL TIERING

Token cost concentrates in implementation, so the kit splits roles by model. The main session (the strongest model, highest effort) does the thinking: brainstorming, spec writing, debugging, orchestration, and all reviews. Implementation of each Section of Work dispatches to a tiered agent — `implementer-sonnet` for mechanical, sibling-pattern work; `implementer-opus` for multi-file or nuanced sections; tier `fable` stays in the main thread for novel or security-sensitive work. The brainstorming skill assigns the tier per section at planning time; the executing-work skill dispatches, enforces a NEEDS_CONTEXT/BLOCKED escalation protocol (implementers ask instead of guessing), and takes a section over in the main thread after two failed review rounds at its tier.

Quality is protected by three things, none of which is the implementer's model: spec precision (a section only earns a cheap tier if a context-free implementer can build it from the section text alone), fresh-context adversarial review by the strong model, and the final whole-changeset review in finishing-work. The cost profile inverts the naive approach: the expensive model reads diffs and writes specs; the cheap models write the bulk of the code.

## CONVENTIONS

- Specs and plans: `docs/plans/` in each project, named `<project>_<content-type>_v1.md`, versions increment, never overwrite.
- Chapters are appended to the plan doc, not kept in a separate file. The plan doc is the single source of truth for intent and state.
- Durable learnings go to Claude Code auto memory (curate with `/memory`), not into plan docs or CLAUDE.md.
- Project CLAUDE.md files carry only project-specific facts (build commands, architecture pointers); global rules live in `home/CLAUDE.md` only.
- Each project documents its access architecture and accepted risks in `docs/security-model.md` (for TMWSuite integrations: the RESTRICTED role, ELEOS schema, impersonation model, and TRUSTWORTHY rationale). The security-reviewer agent reads it first, verifies the code upholds it, and re-checks accepted-risk preconditions instead of re-flagging them — which is also the document auditors ask for.

## NOTES AND KNOWN TRADEOFFS

- Plugin skills are namespaced: explicit invocation is `/claude-kit:brainstorming`. Automatic (model-invoked) triggering is unaffected.
- The format-on-edit hook rewrites .cs files on disk after Claude edits them. If a subsequent edit fails to match file contents, that is the formatter's doing — Claude re-reads and retries. Remove the PostToolUse block from `hooks/hooks.json` if this annoys more than it helps.
- Plugins are copied to a cache at install (`~/.claude/plugins/cache`); the plugin cannot reference files outside `plugins/claude-kit/`. That is why `home/` and `settings/` live outside the plugin — they are machine-setup assets, not plugin components.
- Plugin-shipped agents cannot declare their own hooks, MCP servers, or permissionMode (Claude Code security restriction). None of these agents need them.
- `settings.recommended.json` reflects the settings schema as of June 2026; verify key names against current docs if something is ignored: https://code.claude.com/docs/en/settings

END RESULT: clone, install, and every project on every machine has the same rules, the same workflow, the same reviewers, and the same recovery behavior — maintained in one place.
