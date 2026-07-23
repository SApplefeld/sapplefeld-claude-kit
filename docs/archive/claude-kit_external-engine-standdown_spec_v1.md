# External-Engine Stand-Down: Scoping the Compaction Machinery to Kit-Native Runs

Status: Complete
Commit model: Commit-and-Push (this repo, and sapplefeld-ai-os with staging scoped strictly to this effort's files; that tree carries another session's in-flight Reach Section 3 work)
Fable Spend: full (Scott directed immediate execution in this Fable-led session, 2026-07-22)

## Why

Decided 2026-07-22: the AI OS (Spine) never depends on session compaction. Its Dispatch layer already continues work by spawning one fresh headless worker per section with the plan doc as state, which is deterministic where compaction's behavioral and relay planes are not (lived failure rate above 50%; the engine itself is not the failing plane). The kit's compaction machinery stays fully supported for kit-native runs (attended interactive, relay, and chain mode), and the relay hardening campaign is frozen: relay failures degrade to the manual `/resume` line by design and are not defects to chase.

The conflict this spec removes: Spine's section directive tells workers to follow executing-work, whose Run Mode check defaults an autonomous session into chain mode (a worker standing up its own nested worker chain) and whose step 8 forces the compaction contract at every section close (on a windowless VM, the relay path's own rules end the turn mid-section, which parks the run). The tripwire band nudge adds hook-level pressure toward the same machinery whenever the repo has an armed kit goal, because it checks that a goal is armed but not whose session holds it.

## The contract

An externally-driven worker is a session spawned and continued by an execution engine outside the kit (Spine's Dispatch pump). The engine declares itself through two signals, each consumed by the layer that can observe it:

1. **Environment marker.** The engine sets `KIT_EXTERNAL_ENGINE=1` on every worker spawn. Kit hooks read it and stand down deterministically.
2. **Directive sentence.** The piped section directive states that an external engine owns continuation (fresh worker per section). The skills the worker loads key on that statement.

Under either signal the worker runs the in-session loop for its directed section only: no chain mode, no step-8 compaction machinery, no relay requests. Its Chapter's Compaction line records `check not run: external engine owns continuation (fresh worker per section)`, which the tripwire validator already accepts.

Rule ownership: executing-work's Run Mode check owns the stand-down rule. Step 8 and compact-session carry pointers or operational residue only.

## Out of scope, named

- The tripwire band nudge still fires for a bystander interactive session in a repo whose kit goal another session holds (it gates on armed, not bound). Real but pre-existing, unrelated to Spine once the env marker lands, and advisory-only. Left for a future pass if it ever bites.
- kit-goal-stop needs no change: its session-identity scoping already excludes externally-driven workers (an unbound goal is claimed only by a transcript carrying a user-typed `/kit-goal` command-args span, which a piped directive never produces; a bound goal leashes only the bound session and its compaction successors).
- Chain mode itself is untouched. It remains the kit-native autonomous mechanism; this spec only stops an external engine's worker from entering it.

## Sections

### 1. executing-work carve-out (kit)

In `plugins/claude-kit/skills/executing-work/SKILL.md`: the Run Mode check gains the externally-driven-worker branch as its first conditional (the stand-down rule's owning site), and step 8 gains the matching action branch plus the Compaction-line residue. Skill-edit rationale per writing-skills: the failure is observed (the chain-default and step-8 forcing conflict above), the form is a conditional on an observable predicate (the directive sentence or the env marker), and the true GREEN is a live Spine dryrun on the VM, which only Scott can run.

### 2. compact-session scoping (kit)

In `plugins/claude-kit/skills/compact-session/SKILL.md`: one pointer line in "When to compact" (externally-driven workers never compact; executing-work owns the stand-down), and one framing sentence on relay mode (an attended-workstation convenience whose failures degrade to the manual `/resume` line by design).

### 3. context-tripwire env gate (kit)

In `plugins/claude-kit/hooks/context-tripwire.js`: the band tripwire (tooth 1) stays silent when `KIT_EXTERNAL_ENGINE` is set non-empty in the environment. The Compaction-line validator (tooth 2) stays active everywhere: it is format-only and the `check not run:` escape already passes a stand-down line. Test added to `test/context-tripwire.test.js`. Baseline: 27 pass, 0 fail (`node --test test/context-tripwire.test.js`).

### 4. Spine side (sapplefeld-ai-os)

- `WorkerSpawner` sets `KIT_EXTERNAL_ENGINE=1` in the worker's environment.
- `DispatchPump.BuildDirective` appends the stand-down sentence: the engine owns continuation, fresh worker per section, never compact this session, never enter chain mode, never write relay requests.
- `docs/architecture.md` records the invariant in the Dispatch layer section: workers never compact; a section that outgrows a context window is a spec-sizing or sequencing defect and the response is park-with-reason, not a runtime rescue.
- Tests updated where the spawner and directive are pinned.

### 5. Close-out

Relay-freeze note in the kit's `docs/backlog.md`; docs indexes refreshed; durable memory written (the stand-down contract, the relay freeze); plan flipped Complete and archived via curating-docs; both repos committed and pushed with ai-os staging limited to this effort's files.

## Related

- `docs/archive/claude-kit_compaction-tripwire_spec_v1.md` (the hook this spec gates)
- `docs/archive/claude-kit_goal-continuity_spec_v1.md` (the leash whose scoping made a kit-goal change unnecessary)
- `docs/compaction-engine.md` (the engine, unchanged here)

## Chapters

### Chapter 1 - 2026-07-22
Completed: all sections (1-5), delivered in this changeset
Implemented By: main session (Fable-led per the Fable Spend header; sections too small and design-entangled to brief out)
Metrics: review rounds 1; NEEDS_CONTEXT 0; escalations 0; advisor off (Fable-led)
Decisions / Surprises: kit-goal-stop needed no change (its session-identity binding already excludes external workers; an unbound goal is claimed only by a user-typed /kit-goal command-args span). The tripwire band nudge was the one hook gap: it gates on a goal being armed, not on who holds it. Spine set no env marker before this effort, so the contract added one rather than inferring workerhood from anything ambient. The Spine suite had no directive-text pin at all, which became a review finding.
Review Findings: adversarial review over both repos returned 3 Major, 4 Minor, 0 Critical. Majors all accepted and fixed: (1) executing-work's completion contract contradicted the stand-down (a worker had no sanctioned stop shape after its directed section); (2) the directive's stand-down sentence had no writer-side pin (added Iteration_Dispatch_DirectiveCarriesTheExternalEngineStandDown asserting both the sentence and the Compaction literal); (3) the spawner marker test passed vacuously inside a marked worker (parent sentinel added so the child's "1" must come from the spawner's overwrite). Minors: Chapter-format note and WorkerSpawner XML summary fixed; two justified without change - compact-session's "run it at every boundary" is scoped by the never-in-a-worker bullet two headings above it in the same skill, and the backlog's archive path resolves because the archive move rides this same delivery.
Compaction: 174,674 context tokens; relay armed; check skip; action none (an effort-ending boundary earns no compaction)
Next: none (single-chapter effort; close-out in the same delivery)
Commit Model: Commit-and-Push
