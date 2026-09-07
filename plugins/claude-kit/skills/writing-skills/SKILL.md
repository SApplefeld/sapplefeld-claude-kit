---
name: writing-skills
description: "Use when creating a skill for this kit, editing one, or deciding whether a wording change to a behavior-shaping skill will actually change behavior. Also use when amending curated prose the kit ships: a skill, an agent charter, the output style, a README, a plan doc, or a doc under docs/. Triggers: adding a new SKILL.md, reworking a skill's rules, correcting a claim a curated document states, a skill that reads well but agents ignore under pressure, or a kaizen change to the kit's own skills."
---

# Writing Skills

A skill is behavior-shaping prose, not documentation. One that reads well but does not change what an agent does under pressure is decoration. Treat a skill change like a code change: name the failure it fixes, pick the form that fixes that failure, and confirm it works before trusting it.

## When a skill earns its place

- **Create when:** the technique is non-obvious, recurs across efforts, and is general. A single project's convention is not a skill; it goes in that project's CLAUDE.md.
- **Do not create when:** it is a one-off, a restatement of standard practice, or something a hook or regex can enforce mechanically. Automate the mechanical ones; reserve skills for judgment.
- **The kit stays lean.** Every skill is paid for in every session's skill list. A new skill must beat the alternative of one more paragraph in an existing skill. When in doubt, fold it in rather than add a file.

## Anatomy

- One SKILL.md, in the kit's voice: direct, opinionated, anti-dogma, no em dashes. Add a reference file only when the body genuinely outgrows the size of the kit's other skills, and gate it the way csharp-style and sql-style do: the SKILL.md covers routine work and names the territories that need the reference.
- **Frontmatter: always quote the description.** An unquoted value containing a colon-space breaks the YAML silently and drops all skill metadata. `name` and `description` are the two that matter.
- Body: the principle, the rules that carry judgment, the antipatterns. Tables and lists for what gets scanned; prose for the why. A flowchart only for a decision where the agent might genuinely go wrong, never for linear steps.
- **One owner per rule.** Every rule has exactly one owning site; every other mention is a pointer or an operational residue at its point of action, never a restatement. A rule stated twice is two rules a week later: the 2026-07-14 stabilization audit found a dozen drifted copies, one in outright contradiction. When editing a rule, grep for its key phrases across the kit and fix the owner, not the nearest copy.
- The plan-doc header and structure is one such rule, owned outside this skill: `curating-docs/SKILL.md`'s "machine contract" section is the frozen shape external tooling parses. Point at it rather than restating any of its lines here.

## The description states the trigger, not the workflow

The description is how a future session decides whether to load the skill. Write it as "Use when..." plus the symptoms that pull it in, and stop. Do not summarize the skill's process there: an agent that reads a process summary acts on the summary and skips the body, so a step the body insists on gets dropped.

A description that summarizes the workflow gets acted on in place of the body: a summary reading "code review between tasks" yields one review where the body specifies two.

## Match the form to the failure

Name the failure first, then pick the form that fixes it. The form that bulletproofs one failure backfires on another:

| The failure | The form that fixes it | The form that backfires |
|---|---|---|
| Knows the rule, skips it under pressure | Prohibition plus a rationalization table plus a red-flags list | Soft "prefer..." guidance |
| Complies, but the output is wrong-shaped (bloated, buried, restated) | A positive recipe: state what the output IS, its parts in order | A prohibition list ("don't restate", "never narrate") |
| Omits a required element from something it already produces | A structural slot: a REQUIRED field in the template it fills | Prose reminders near the template |
| Behavior should depend on a condition | A conditional on an observable predicate ("if the brief exists, reference it") | An unconditional rule plus exemption clauses |

Three rules govern any rule you write, not just the four forms above:

- **No nuance clauses.** "Don't X unless it matters" reopens the negotiation. Express a real exception as its own conditional on something observable.
- **Exemption clauses do not scope.** "This limit excludes code blocks" still suppresses code blocks. If part of the output must be exempt, restructure so the rule cannot reach it.
- **Close every enumeration with its class.** A list of instances (a rationalization table, a blocker set, an antipattern list) reads as exhaustive the moment it ships, so an unlisted variant presents itself as licensed. State the class the instances belong to right where the list ends ("the table is instances, not the boundary"; "the set is closed"), so a novel variant meets the rule even though no row names it.

## State facts the reader can check and correct

The rules above govern the form of a rule. These two govern the facts a rule stands on, which go stale on their own schedule and take the rule with them.

- **When two framings of one fact are both true, ship the one the reader can verify from where they sit.** "`memq recall` returns the whole memory store as one bounded digest" and "the memory store is available in bulk" are the same fact, but only the first names something the reader can run and watch happen. A framing the reader cannot check is one they take on trust, and a rule taken on trust is one they cannot repair: when the fact underneath it moves, the reader has no way to notice, so they keep obeying a rule that now describes nothing. Name the file, the command, the observable event, or the artifact the fact lives in, and pick the framing that makes it findable.
- **A fact base drawn from observed instances states its lists as open unless the contract closes them.** Closure comes from the contract (a schema, an enum, a validated surface with a published shape), never from the sample agreeing with itself. This is the enumeration rule's failure in the fact layer rather than the rule layer, and it hides differently: an enumeration extracted from a single fully-observed sample reads as exhaustive to whoever wrote it, because every field it lists really was present and nothing contradicted it. The reader then branches on a field's absence as if absence carried meaning, and that branch is wrong for every instance the sample never contained. So write the list as open and say what would close it, or cite the contract that already does.

Those two are instances rather than the boundary. The class is any fact a rule rests on that the reader cannot check for themselves or cannot see the edges of, and a new way of putting a fact out of the reader's reach meets the rule even though neither bullet names it.

## What a sentence has to earn

Whether a sentence belongs at all is the doctrine's call rather than this skill's. Its "Documents ship the current state; the journey lives in git" bullet (`skills/operating-instructions/SKILL.md` under the kit plugin root) sorts state from journey and states its own exemptions, append-only history among them. This section adds the shape the surviving sentences take, at authoring rather than only at review.

A sentence in the kit's own voice, in any curated prose it ships, is one idea, in the literal phrase, pointing where another site owns the rule. Those three sentence-shape bars, the term the doctrine defers to this section by, in order:

- **One idea.** A sentence carrying a rule together with the bound that limits it is one idea and stays whole, since splitting it lets the rule be read without its bound. Every other sentence is one idea too, and a word count past forty is the diagnostic that finds a second idea rather than the bar itself. Uniform sentence length is its own defect, so the count is read per sentence and never as a target. A paragraph makes one point, or says in the paragraph why its parts must be read together.
- **The literal phrase.** Where a literal phrase for the thing exists, the sentence uses it. A metaphor stands where it is the established term for the thing and is mannered prose everywhere else: metaphor and flourish substituted for direct statement, written to display the writer, dragging in connotations the writer did not choose. The fix for mannered prose is that literal phrase.
- **A pointer where another site owns the rule.** The one-owner rule under Anatomy above states which forms a mention may take; this bar adds no form to it and no exception.

The three are instances of one class: prose that costs the reader more to read than it changes for them. A form of it none of them names is inside the bar.

## The paragraph is the edit unit for curated prose

**When an amendment corrects a claim a curated document states, the edit unit is the paragraph, never the sentence.** Re-derive the whole paragraph from the corrected claim, then check the claim's other carriers: the neighbouring clauses that qualified or restated it, and any sibling surface stating the same behavior. Those two are instances rather than the boundary. The unit is the claim across every surface carrying it, and the paragraph is that unit's smallest case, so a surface carrying the claim is inside the rule whether or not anything here names it; the carriers this kit keeps producing are a doctrine parity copy, the output style's register block, an agent charter, a test's assertion message, a memory record, and a README's payload map, and that list is instances rather than the boundary too. A sentence patch leaves the seam speaking the old claim, so the paragraph reads as self-contradicting where the fix and its neighbour now disagree, or a sibling goes on stating the version you just corrected. An amendment that corrects no claim is outside the rule and takes whatever edit it needs, a typo fix, an added bullet, and a label rename among them.

A carrier on another surface is not automatically yours to edit in place. Four dispositions cover the shapes this kit produces, and they are instances rather than the boundary: a carrier fitting none of them is named as such and routed deliberately, never edited in place by default. Where the one-owner rule above applies, fix the owner rather than the nearest copy. Where the surfaces are a deliberate byte-identical set, every copy lands in one edit or none does, since a partial edit reds the parity pin by design, and the set is as large as the pin says rather than as large as the pair you first thought of. Where the claim is a deliberate restatement across surfaces the section's scope already covers, it lands on every one of them in the same edit, because a restatement corrected on one surface alone is the drift the restatement was pinned against. And where a carrier sits in a file the section's `Files in scope:` never listed, it is an out-of-scope surface: it takes the route the executing-work skill's fix-round step owns (`skills/executing-work/SKILL.md` under the kit plugin root), rather than an in-place edit the post-review scope check never sees.

The writer this rule exists for is an orchestrator's main thread, which no dispatch brief reaches: it makes scattered corrections to curated documents between review rounds, with no brief and no reviewer standing between the edit and the commit. That origin is why the rule sits on the writer's side rather than in a reviewer's brief, and it narrows nothing: the rule binds every writer amending curated prose. What stands downstream differs by surface, so do not assume a backstop. A document under `docs/`, a README, or a plan doc is read whole by the finishing prose pass only where it is a document in the effort's own scope on an effort whose deliverable is documents, which are together the sole conditions under which that pass reviews it at all; a skill or an agent charter is read as a diff by the section's code pair unless a plan-local amendment says otherwise, which is to say the surfaces this rule was written from have no standing backstop at all, and on a code effort neither does the first group.

## Know it works before you trust it

A skill you wrote and never tested is a guess. The honest test is to watch an agent's behavior with and without the wording:

1. **RED:** give a fresh subagent a realistic task that tempts the failure, without the new guidance. Watch it fail; record the rationalization verbatim. If it does not fail, there is nothing to fix, so stop.
2. **GREEN:** add the minimal guidance addressing that specific failure. Re-run. The agent should now comply.
3. **REFACTOR:** if it finds a new loophole, add the counter and re-run until it holds. For discipline rules, combine pressures (time plus sunk cost plus authority); single pressures are weak tests.

Run several reps, since one sample lies, and read every flagged result yourself, since template echoes masquerade as both failures and successes. This is the standard for any change to behavior-shaping content, the kit's own skills included.

In the kit's own repository, where the probe set lives, a change touching a file a probe's shape under `test/probes/` names, in a passage the probe's scenario turns on, runs the probe runner's before-and-after pair for that moment. The check is the changed and untracked paths, read against the same `<sha>` the before leg takes, against the shapes' `files:` lists, and then the changed hunks against those probes' scenarios, a hunk no scenario turns on running nothing and being recorded as such where the reading is. Where the probe is `ruled`, the pair stands in for the reps above as the RED and GREEN. Where it is `proposed`, the after leg alone is run and recorded as evidence for the operator's rulings batch, since a before leg over a proposed probe buys nothing for its paid readers, and the reps above stand. The pair measures movement rather than failure, so a before leg that matches is not step 1's nothing-to-fix case. Its readings close at four: a matching pair on a moment the change did not mean to move is a reading that held; a before-leg mismatch the after leg matches is the repair; a mismatch both legs carry is the corpus's, recorded as such; and an after-leg mismatch the before leg lacks takes the intent test below, as does a matching pair on a moment the change meant to move, which is a finding rather than a reading that held. An errored or unparsed pair, or one in a leg recorded unavailable, is re-run once as finishing-work's step 5 directs, and where it errors again is none of these and stands in for nothing, so the reps above run; a designed shape's rows and a designed-agreed row enter none of these either and take finishing-work's step 5 dispositions. Rows from a shape naming no changed file read one corpus in both legs and are no reading at all. The before leg is `node tools/probe-corpus/run.mjs --only <moments> --before <sha>`. The after leg is the same command with no `--before` and its own moment list. The after leg's `<moments>` is the comma-joined list of every moment the check above kept, and the before leg's is that list narrowed to the `ruled` ones, since a pair is a reading only where both legs ran the moment. `<sha>` is the parent of the change's first commit resolved to a sha, or `HEAD` where the change is uncommitted; a root-commit change takes the `<sha>` finishing-work's pre-step-1 derivation yields, which leaves the before leg unrun as that skill's step 5 records it. The pair runs once at the section's close over the section's whole change rather than at each fix round, and inside a finishing pass the set's runs are finishing-work's step 5's alone. It takes the box claim step 5 names, and the section's lane runs once that claim is released. `tools/probe-corpus/README.md` owns what each leg reads and what each row status means, and finishing-work's step 5 owns how the run is spawned, when a leg is re-run and what each row counts for. What this bar adds is the intent test on a ruled probe's after-leg mismatch the before leg lacks: a move the change intended is a re-ruling to ask the operator for, and any other is a finding. A change whose only shape-named files are the repo's `home/*.md` files is seen by neither leg, since the runner reads a `home/` entry from the reader's home directory rather than from the repo, so it takes the reps above with the cache staging below. A matching leg pair is one sample, accepted as one because a second costs a paid reader per probe-and-shape pair, and the raw replies the runner keeps are read as the flagged results above are. The reading, or both where a pair ran, is recorded on the line executing-work's Chapter template holds for it in `Decisions / Surprises`, or in the turn's close-out status where no section Chapter exists.

**A doctrine edit is invisible to same-session subagents.** They never see a fresh read of the deployed file: at best they inherit the CLAUDE.md snapshot taken when the session started, and where the harness's subagent inheritance is off they see no doctrine at all, so a GREEN probe for a doctrine change runs in a fresh session (a headless `claude -p`), never as a subagent of the session that made the edit - a subagent GREEN silently re-tests the old wording. And `~/.claude/claude-kit-doctrine.md` is not the file to stage the probe wording in: the doctrine-refresh hook rewrites it from the installed plugin's operating-instructions skill at every session start, the probe sessions' own starts included, so a hand-deployed copy survives only until the first probe boots. Where the probe pair above does not supply the GREEN, stage the candidate wording in the installed plugin cache's copy of that skill for the probe run and restore it after; the real change ships through the normal commit and goes live when the plugin updates.

**Doctrine-adjacent rules have a contaminated RED.** A test subagent that inherits the global CLAUDE.md (the harness's subagent inheritance, on in this setup) already complies with doctrine, so a rule that restates or sharpens doctrine can show no RED failure there; that contamination is production-faithful rather than a test defect, and where the inheritance is off, a RED is genuine. Absence of failure there is weak evidence, not proof the rule is dead weight. Judge such a rule on its distinct value instead: point-of-action encoding survives compaction and reaches contexts the doctrine does not (a headless worker mid-loop, a session whose doctrine was summarized away). If you ship a rule whose RED did not reproduce, record that it stands on that rationale, not on a demonstrated failure; a rule with neither a reproduced RED nor that rationale is the guidance-from-imagination antipattern, so leave it out.

## Antipatterns

- A narrative ("the time we fixed X") instead of a reusable technique.
- A harness-injection fact stated as unconditional ("subagents load X", "memory is injected into Y") when it hinges on a user setting: a settings flip silently falsifies the prose with no test to catch it. State the safe assumption instead; where the fact must be stated, name the setting it depends on.
- A description that summarizes the workflow.
- A prohibition aimed at a wrong-shaped-output problem (use a recipe).
- Guidance written from imagination instead of an observed failure.
- A new skill where one paragraph in an existing skill would have done.
