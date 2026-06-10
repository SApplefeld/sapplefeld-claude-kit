# claude-kit

Scott Applefeld's personal Claude Code kit. One repo that every project picks up: workflow skills (brainstorm → execute → finish), four review agents, C# and T-SQL house-style guides, and compaction-recovery hooks. Installed as a personal plugin from a one-person marketplace.

## STRUCTURE

```
claude-kit/
  .claude-plugin/plugin.json    Plugin manifest
  marketplace.json              One-person marketplace listing this plugin
  skills/
    brainstorming/              Design conversation → spec in docs/plans/ + commit model
    executing-work/             Autonomous section loop: implement, verify, review, Chapter
    finishing-work/             QA, security, docs curation, final review, close-out
    csharp-style/               C# house style + detailed reference
    sql-style/                  T-SQL house style + detailed reference
    scott-writing-style/        Document/prose style guide
  agents/
    adversarial-reviewer.md     Fresh-context spec-compliance + code-quality review
    qa-verifier.md              Build, tests, acceptance criteria with evidence
    security-reviewer.md        OWASP + SOC 2 review tuned to the procedure-only model
    docs-curator.md             Updates docs/, returns Drift Report
  hooks/
    hooks.json                  Hook registrations
    session-start.js            Re-injects in-progress plan docs on startup/resume/compaction
    format-on-edit.js           CSharpier on edited .cs files (silent when not installed)
  home/CLAUDE.md                Versioned user-level CLAUDE.md (installed by setup script)
  settings/settings.recommended.json   Permission rules + acceptEdits starting point
  setup.ps1 / setup.sh          One-time per-machine CLAUDE.md install
```

## INSTALL (per machine)

1. Push this repo to a private GitHub repository.

2. In Claude Code:
   ```
   /plugin marketplace add <your-github-username>/claude-kit
   /plugin install claude-kit@applefeld
   ```
   Choose user scope (or pass `--scope user`) so every project picks it up. If the marketplace's relative source (`"./"`) is rejected by your Claude Code version, change `marketplace.json` to the explicit form:
   `"source": { "github": { "repo": "<your-github-username>/claude-kit" } }`

3. Install the user-level CLAUDE.md (plugins cannot ship memory files):
   - Windows: `.\setup.ps1`
   - WSL/macOS/Linux: `./setup.sh`

4. Merge `settings/settings.recommended.json` into `~/.claude/settings.json` (review the allow-list first — it includes `git push` for the Commit-and-Push model; remove it if you want pushes gated).

Updating: commit and push changes here, then `/plugin update claude-kit` (or reinstall) on each machine.

## THE WORKFLOW

Brainstorming produces a spec in `docs/plans/<project>_spec_v1.md` with a recorded commit model (Review-Only or Commit-and-Push). Executing-work runs the spec section by section — implement, verify, adversarial review (plus security review on sensitive surfaces), update the plan, append a Chapter, commit per the model. Finishing-work closes the effort: qa-verifier, security-reviewer, final adversarial-reviewer pass, docs-curator with Drift Report, plan closed, changes presented or pushed per the model.

Compaction recovery is deterministic: the SessionStart hook fires on startup, resume, and after every compaction, finds in-progress plans, and instructs the session to re-read them — Chapters included — before any work proceeds.

## CONVENTIONS

- Specs and plans: `docs/plans/` in each project, named `<project>_<content-type>_v1.md`, versions increment, never overwrite.
- Chapters are appended to the plan doc, not kept in a separate file. The plan doc is the single source of truth for intent and state.
- Durable learnings go to Claude Code auto memory (curate with `/memory`), not into plan docs or CLAUDE.md.
- Project CLAUDE.md files carry only project-specific facts (build commands, architecture pointers); global rules live in `home/CLAUDE.md` only.
- Each project documents its access architecture and accepted risks in `docs/security-model.md` (for TMWSuite integrations: the RESTRICTED role, ELEOS schema, impersonation model, and TRUSTWORTHY rationale). The security-reviewer agent reads it first, verifies the code upholds it, and re-checks accepted-risk preconditions instead of re-flagging them — which is also the document auditors ask for.

## NOTES AND KNOWN TRADEOFFS

- The format-on-edit hook rewrites .cs files on disk after Claude edits them. If a subsequent edit fails to match file contents, that is the formatter's doing — Claude re-reads and retries. Remove the PostToolUse block from `hooks/hooks.json` if this annoys more than it helps.
- Plugin-shipped agents cannot declare their own hooks, MCP servers, or permissionMode (Claude Code security restriction). None of these agents need them.
- `settings.recommended.json` reflects the settings schema as of June 2026; verify key names against current docs if something is ignored: https://code.claude.com/docs/en/settings

END RESULT: clone, install, and every project on every machine has the same rules, the same workflow, the same reviewers, and the same recovery behavior — maintained in one place.
