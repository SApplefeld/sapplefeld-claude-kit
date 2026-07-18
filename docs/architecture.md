# Kit Architecture

The kit is a Claude Code plugin plus the repo material that maintains it. Almost all of it is prose: skills the model loads on demand, agent definitions, and a doctrine file that ships to the user's home directory. The exceptions are the pieces with real runtime behavior, and there are two: the Node hooks wired to session and tool events, and the compaction engine, a Bun program that rewrites session transcripts.

That split is the thing to hold onto when changing anything here. Prose surfaces are behavior-shaping text with no test but the writing-skills RED/GREEN check; the hooks and the engine are code with a real gate under `test/` and `tools/engine-tests/`.

## Repo layout

- **`plugins/claude-kit/`** is the installable payload, and the only zone an installed plugin loads. It holds `skills/` (18 skills, each a `SKILL.md` plus optional `references/`), `agents/` (reviewers, implementers by model tier, the QA verifier, the docs curator, the design facilitator, the council member), `hooks/` (Node scripts plus `hooks.json`), and `doctor/` (the Windows first-run and repair tool).
- **`home/CLAUDE.md`** is the operating doctrine, deployed to the user's home directory rather than loaded from the plugin.
- **`docs/`** is the working library: about-the-solution documents at the root, active plans in `plans/`, finished history in `archive/`. It is not part of the payload.
- **`kaizen/`** is the kit's self-improvement inbox, one note per piece of observed kit friction.
- **`settings/settings.recommended.json`** is the recommended user settings shape.
- **`tools/`** holds repo-side utilities that do not ship: `engine-tests/` (the compaction engine's Bun suite) and `transcript-study/` (the corpus analysis behind the compaction thresholds).
- **`build.ps1`, `build.sh`, `.claude-plugin/marketplace.json`** package and publish the plugin.

## Hooks

`plugins/claude-kit/hooks/hooks.json` is the wiring, and every hook is a Node script invoked with the plugin root. The events in use:

- **SessionStart** runs `session-start.js` (resume surfacing and unarchived-plan flagging), `branch-reaper-nudge.js`, `kit-version-nudge.js`, `doctrine-refresh.js`, and `relay-refresh.js`. Matchers differ per hook: the doctrine refresh also fires on `clear`, and the branch and relay hooks skip the `compact` entry.
- **PreToolUse** runs `docs-write-guard.js` on write-shaped tools, and `pr-docs-guard.js` and `merged-pr-push-guard.js` on shell tools.
- **PostToolUse** runs `format-on-edit.js` after edits.
- **Stop** runs `stop-docs-hygiene.js` and `kit-goal-stop.js`, the deterministic leash that holds a `/kit-goal` run to completion across compaction and relay session swaps.

## Compaction engine

The engine is the kit's one substantial program: it reads a session transcript, writes a new session whose transcript keeps human messages verbatim and replaces bounded slices of assistant work with summaries, and leaves the source untouched. It is the mechanism behind the compact-session skill's three modes (interactive, relay, chain) and behind the `/kit-goal` workflow's ability to shed context at section boundaries.

`docs/compaction-engine.md` is the full mechanism document: the plan model, turn segmentation and the `--keep N` fallback, the summarizer contract, the emitted transcript's single-chain guarantee, failure paths, and tuning knobs.

## External integrations

- **The `claude` CLI** is spawned headlessly by the engine to summarize, pinned to a model, with hooks disabled and all tools denied. `claude` must resolve to a native executable rather than an npm `.cmd` shim, because the prompt carries transcript-derived text on argv.
- **Bun** runs the engine and its tests. **Node** runs the hooks.
- **AutoHotkey** drives the resume relay (`skills/compact-session/relay/`), which types a `/resume` into the session's own terminal window so an unattended interactive run continues across a compaction.
- **git and the GitHub CLI** are what the branch-hygiene, PR-docs, and merged-PR-push guards observe and act on.
- **The local filesystem under `~/.claude/`** is shared state: `projects/<sanitized-cwd>/<session-id>.jsonl` for transcripts, `magic-compact/` for the omission caches, the ledger, and parse-failure debug output.
