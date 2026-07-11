# Kit Doctor: Payload-Shipped, Complete, One Command

- **Status:** Complete
- **Run Mode:** interactive
- **Commit Model:** Review-Only
- **Fable Spend:** Fable-led session; sections built inline in the main thread.
- **Decided:** 2026-07-10. Goal (Scott's words): push to GitHub, update the plugin everywhere, run one doctor command (or `/kit-doctor`) and get everything validated with tips for anything missing.

## Why

The doctor lives at the repo root, outside the plugin payload, so machines that install the kit as a plugin (no clone) have nothing to run: the exact machines where steps get missed. Audit of `doctor.ps1` (2026-07-10) also found four coverage gaps proven to matter in the field: no doctrine content-freshness receipt (the refresh hook syncs it, but nothing verifies), no CLI login check (the summarizer failure mode observed on the NEO box, where a credentials file existed while the CLI was not logged in, so only a live probe is honest), no AutoHotkey v2 detection behind the relay checks, and no smoke test of the compaction engine's new `--check` layer. `-Fix` also cannot install Bun; it only PATH-wires an existing install.

## Design decisions

- **The doctor ships in the payload** at `plugins/claude-kit/doctor/`, so every plugin update delivers the current doctor. Repo-root `doctor.ps1`/`doctor.cmd` become thin forwarders (habit and README compatibility).
- **Clone detection gates the dev-only checks.** Kaizen signpost writing and `core.hooksPath` wiring apply only when the doctor runs from a real git clone (`.git` present at the root whose `plugins/claude-kit` is this payload). From an installed-plugin cache, those become validation of an existing signpost (or INFO that no clone is registered on this machine, which is fine for non-dev boxes). The signpost's `kitRepoPath` must never point into a plugin cache.
- **Bun is the only doctor-side install.** `-Fix` prompts for consent (`-Yes` answers all prompts, for unattended runs) and runs `winget install --id Oven-sh.Bun -e`. AutoHotkey stays owned by `arm-resume-relay.ps1`, which already installs it; the doctor detects and points there.
- **The login probe is live, not file-based.** Presence of `~/.claude/.credentials.json` was proven meaningless on 2026-07-10. The probe runs `claude -p --model claude-haiku-4-5` from a scratch cwd with `ANTHROPIC_API_KEY` scrubbed (the summarizer's auth path), then deletes the probe's project transcript dir. Costs one Haiku call; `-NoProbe` skips it. Not-logged-in is WARN, not FAIL: everything but the summarizer works without it, and the remediation is one command only the user can run (`claude /login`).
- **Doctrine freshness compares content, newline-normalized**, against the payload's operating-instructions skill body using the same frontmatter-strip semantics as `doctrine-refresh.js`. Drift is WARN with "any Claude Code session with the plugin installed rewrites it" as the remediation, because the hook, not the doctor, owns the sync.

## Sections of Work

### 1. Payload doctor - tier: fable (inline)

Files: new `plugins/claude-kit/doctor/doctor.ps1` (the full script), new `plugins/claude-kit/doctor/doctor.cmd` (bypass wrapper), root `doctor.ps1` and `doctor.cmd` reduced to forwarders.

Flags: `-Fix` (safe durable repairs plus consent-gated Bun install), `-Yes` (answer all prompts yes), `-NoProbe` (skip the login probe).

Checks, in order: execution policy (unchanged); Bun (unchanged resolution, plus the install prompt); engine usage-banner smoke (unchanged); engine `--check` smoke (crafted one-row transcript in `%TEMP%`, expect exit 0 and `"status":"check"` JSON, then delete it); claude CLI shape (unchanged); CLI login probe (new, as designed above); ANTHROPIC_API_KEY scopes (unchanged); doctrine import line plus content freshness (new); kaizen signpost and git hooks (clone-gated as designed); relay state (unchanged) plus AutoHotkey v2 detection at the arm script's two known paths when the relay is armed.

Acceptance: from the repo clone, check mode reports every check with no FAILs beyond real machine state; the login probe on this machine reports the known not-logged-in WARN and leaves no session debris; `--check` smoke passes; root wrappers produce identical output and exit codes to the payload script; from a simulated cache layout (payload copied outside a clone), dev-only checks correctly downgrade and nothing tries to write a signpost.

### 2. kit-doctor skill and cross-references - tier: fable (inline)

Files: new `plugins/claude-kit/skills/kit-doctor/SKILL.md`; pointer updates in `plugins/claude-kit/skills/compact-session/SKILL.md` (prerequisites) and `README.md` (file map and quick-start paths).

The skill body: locate the doctor (`CLAUDE_PLUGIN_ROOT\doctor\doctor.ps1` first, then the signpost's `kitRepoPath\plugins\claude-kit\doctor\`, then a `doctor.cmd` in the cwd tree), run check mode via the `.cmd` wrapper (execution-policy-proof), interpret PASS/WARN/FAIL for the user, and run `-Fix` only on the user's word, naming that `-Fix -Yes` may install Bun via winget before running it. Description states triggers only.

Acceptance: skill frontmatter description is trigger-only; body conditionals are on observable predicates (paths that exist, flag results); both cross-reference files point at the payload location.

### 3. Verification and close-out - tier: fable (inline)

Real runs on this machine per section 1 acceptance, adversarial plus security review over the changeset (the doctor spawns processes and prompts for installs; the probe touches auth-adjacent surface), findings adjudicated, Chapter, archive via curating-docs, staging (Review-Only).

## Related

- `claude-kit_compaction-tuning_spec_v1.md` (archive sibling): shipped the `--check`/ledger layer this doctor now smoke-tests, and surfaced the login failure mode the probe detects.
- `claude-kit_compact-session_spec_v1.md`, `claude-kit_resume-relay_spec_v1.md` (archive siblings): the capabilities whose prerequisites the doctor verifies.

## Chapters

### Chapter 1: Payload doctor and forwarders (2026-07-10)

Shipped in this changeset: `plugins/claude-kit/doctor/doctor.ps1` and `doctor.cmd` (the doctor now ships with the plugin), root `doctor.ps1`/`doctor.cmd` as guarded forwarders. Commit model: Review-Only (staged, not committed). Baseline preserved: the adversarial reviewer diffed the payload script against `git show HEAD:doctor.ps1` and confirmed all ten legacy checks survived the move with none weakened.

- New checks, all verified live on this machine: doctrine content freshness (WARN here was confirmed a true positive by independent diff: installed copy 119 chars behind this clone, exactly the plugin-lag case the WARN describes); CLI login probe (correctly detected this box's not-logged-in state, ran inside a 120s-bounded job, restored ANTHROPIC_API_KEY, deleted both its scratch cwd and its project transcript dir, zero debris after a handle-race retry was added); engine `--check` smoke against a crafted one-row transcript; AutoHotkey v2 detection under the relay check.
- `-Fix` now offers a consented Bun install (`winget install --id Oven-sh.Bun -e --source winget`), with a winget-presence guard, real exit-code reporting, `-Yes` for unattended runs, and explicit decline on a redirected stdin.
- **The review Critical, fixed with RED/GREEN receipts:** `/plugin marketplace add` clones the whole repo (with `.git`) under `~/.claude/plugins/marketplaces/`, so structural clone detection misclassified the installed cache as a dev clone (reproduced: check mode from a simulated marketplace layout reported "repo clone" before the fix). The gate now also requires the payload to live outside `~/.claude`; after the fix the same layout reports "installed plugin" in check and `-Fix` modes, and the real signpost's mtime and content were verified untouched through a `-Fix` run.
- Signpost semantics hardened per review: `-Fix` writes the signpost only when missing or invalid; a valid signpost aimed at a different clone is never silently retargeted (the FIXED output names it and how to retarget deliberately).

### Chapter 2: kit-doctor skill and cross-references (2026-07-10)

Shipped: `plugins/claude-kit/skills/kit-doctor/SKILL.md` (locate with a plugin.json shape check before invoking, check-first-always, `-Fix` on my word, `-Yes` named before use and required for tool-shell installs, interpretation guide); compact-session prerequisites and README (file map, install step 7) now point at the payload doctor. Adjudicated from review: the skill description's leading capability clause stays; writing-skills bans process summaries, not capability statements, and the kit's sibling skills share the shape.

### Chapter 3: Verification, reviews, close-out (2026-07-10)

- Security review: CONCERNS, resolved. The Major was the same clone-gate defect as the adversarial Critical (both confirmed it against this machine's real marketplace cache). Minors fixed: signpost overwrite guard, `--source winget` pin. Accepted risk, on record: `--check`-style local file probing and same-user trust on locally resolved paths (single-user tool).
- Adversarial review: CHANGES_REQUIRED, resolved. Beyond the Critical: forwarder now fails loudly when the payload script is missing; root `doctor.cmd` usage comment covers all flags; winget guard and exit-code reporting; user-PATH null guard; probe timeout; `$env:ProgramFiles` for AHK; consent decline on empty answer; spec's transcript-row wording corrected. Accepted: no further hardening of the probe beyond the 120s bound.
- Evidence: RED run (pre-fix misclassification) and GREEN runs (check and `-Fix` from the marketplace layout, signpost untouched) captured above; full clone run exit 0 with the two known WARNs (login, doctrine lag); forwarder exit codes match; test layout `_doctor-gate-test` removed.
- Remaining machine state this effort observed but did not change: this box's CLI stays logged out until `claude /login` (the doctor now says so), and the installed plugin lags the clone until the next push + `/plugin marketplace update` (the doctrine WARN clears itself after).
