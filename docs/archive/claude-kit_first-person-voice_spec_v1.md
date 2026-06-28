# First-Person Voice and Plain Instruction

Status: Complete
Commit Model: Review-Only
Created: 2026-06-28

## Goal

The kit reads in first person and names no one, so a teammate with zero history reads every skill and agent as plain instruction rather than one person's private notes. The user is "I/me/my", the agent is "you" or imperative. No proper names (one exception), no examples that only make sense if you were there, and no codebase-specific schema or vendor names in the house-style reference. When done, the kit is shareable with a team.

## Approach

The voice rules, applied everywhere except the two exceptions:

1. **User is first person, agent is second person.** Replace every "Scott" (and every "he/him/his" referring to the user) with "I/me/my". The agent stays "you" or imperative, exactly as operating-instructions already reads. Example: "present to Scott" becomes "present to me"; "Scott reviews" becomes "I review"; "without Scott's permission" becomes "without my permission".
2. **Avoid the dual-I.** A quoted agent rationalization stays first-person-free so "I" is unambiguously the user. Write "offer it later if the fork is still open", not "I'll offer it later". Same for excuses tables and any rationalization quote.
3. **Generalize war-story examples.** Remove anything tied to our actual history: named past efforts (doctrine-delivery), commit hashes (c800e05), ticket or incident numbers (INC-4471), and one-off scenarios that only teach if you were there (eps_l in shader.metal, scrollWidth at 1100x900). Replace with the generic version of the same lesson, or cut it if it does not generalize. Litmus: a teammate with zero history understands it.
4. **Genericize the SQL reference's codebase specifics.** In sql-style/references/sql-style.md, replace the concrete `ELEOS` schema and `'ELEOS'` owner with the kit's existing placeholders `<schema>` and `<schema_owner>` (the SKILL.md convention), and drop the named vendor `TMWSuite` (generalize to "some vendor databases").

Voice and examples only. This effort never changes a rule, an instruction, a structure, or a meaning.

Exceptions (do NOT change):
- **scott-writing-style** stays named: its subject is my personal writing voice, so de-naming makes it meaningless. Its body may shift third-person "Scott" to first person where it instructs, but the skill name and its "write as Scott" purpose stay.
- **plugin.json** author metadata stays (authorship attribution, not instruction).

## Sections of Work

### 1. operating-instructions war-story examples
Model: fable (main session)
The doctrine is already first-person and unnamed. Generalize its specific one-off illustrations (the shader/eps_l knob, the scrollWidth viewport, any named product) to generic equivalents, and handle the single "Scott" hit. Surgical: do not touch the rules, only the illustrations.
Files: skills/operating-instructions/SKILL.md
Acceptance: no named product or one-off scenario remains; the rules read identically; grep for the war-story terms returns zero.

### 2. Heavy workflow skills
Model: opus
De-name and de-war-story executing-work, finishing-work, design-council. finishing-work's excuses table currently names "Scott" and cites "doctrine-delivery"; convert to first person and a generic example ("this is exactly how a finished plan sits stale"). Apply voice rules 1 to 3.
Files: skills/executing-work/SKILL.md, skills/finishing-work/SKILL.md, skills/design-council/SKILL.md
Acceptance: zero "Scott" or user-"he"; no war-story specifics; the dual-I avoided in every quoted rationalization.

### 3. Lighter skills
Model: opus
De-name kaizen, cold, responding-to-review, brainstorming, systematic-debugging, writing-skills. Apply voice rules 1 to 3.
Files: skills/kaizen/SKILL.md, skills/cold/SKILL.md, skills/responding-to-review/SKILL.md, skills/brainstorming/SKILL.md, skills/systematic-debugging/SKILL.md, skills/writing-skills/SKILL.md
Acceptance: zero "Scott"/user-"he"; no war-story specifics.

### 4. Style skills and agents
Model: opus
De-name csharp-style SKILL and its reference, sql-style SKILL, and the agents council-member, design-facilitator, docs-curator. Apply voice rules 1 to 3. Do NOT touch the SQL reference (Section 5) or scott-writing-style (exception).
Files: skills/csharp-style/SKILL.md, skills/csharp-style/references/csharp-style.md, skills/sql-style/SKILL.md, agents/council-member.md, agents/design-facilitator.md, agents/docs-curator.md
Acceptance: zero "Scott"/user-"he"; no war-story specifics.

### 5. SQL reference genericization
Model: opus
sql-style/references/sql-style.md: replace `ELEOS` with `<schema>` and `'ELEOS'` with `'<schema_owner>'` throughout (the SKILL.md convention), drop the named vendor `TMWSuite` (generalize to "some vendor databases"), and de-name any "Scott". Preserve the SQL correctness fixed earlier (no `EXECUTE AS` on inline TVFs). High-volume; verify the templates still read coherently.
Files: skills/sql-style/references/sql-style.md
Acceptance: zero "ELEOS"/"TMWSuite"/"Scott"; templates use `<schema>`/`<schema_owner>`; the inline-TVF fix intact.

### 6. Metadata, exceptions, and hooks
Model: fable (main session)
plugin.json (keep author; neutralize any "Scott" in a description), session-start.js (check the one "Scott" reference and de-name if it is user-facing text), scott-writing-style (keep the name and purpose; shift its body's third-person "Scott" to first person where it instructs).
Files: .claude-plugin/plugin.json, plugins/claude-kit/hooks/session-start.js, skills/scott-writing-style/SKILL.md
Acceptance: only scott-writing-style (by name) and plugin.json author retain "Scott".

### 7. Verify and finalize
Model: fable (main session)
grep the whole plugin for "Scott" (expect only scott-writing-style's name/purpose and the plugin.json author); grep for the war-story terms and ELEOS/TMWSuite (expect zero); node --check any touched hook; read each staged diff. Finalize under Review-Only.

## Out of Scope
- docs/ plan records (history, not shared instruction).
- Renaming scott-writing-style or removing the plugin.json author.
- Any behavior change: voice and examples only, never a rule change.

## Open Questions
- ELEOS placeholder form: defaulted to `<schema>`/`<schema_owner>` (the SKILL.md convention) rather than a literal "Schema"; adjust at review if I prefer the literal.

## Chapters

### Chapter 1 - 2026-06-28 (executed and closed in one pass)

All seven sections delivered. Voice-only sweep: 20 files, 170 insertions / 170 deletions (line-for-line, no structural change).

Dispatch: sections 2-5 ran as four parallel implementer-opus agents on disjoint file sets (heavy skills; lighter skills; style skills and agents; the SQL reference). Sections 1, 6, 7 ran in the main thread (the doctrine examples, the metadata exceptions, verification). No chips used; parallelize via subagents only, per the standing preference.

Implementer outcomes (all DONE; section 4 DONE_WITH_CONCERNS, accepted):
- Heavy skills: 45 voice replacements; dual-I cleaned in every quoted rationalization (including "shall I continue?" to "should you continue?"); doctrine-delivery war story generalized to "exactly how a finished plan sits stale".
- Lighter skills: 24 replacements; correctly left the "the time we fixed X" rule-placeholder and the verifiable "live specimen" intact, removed the "learned the hard way on csharp-style" parenthetical.
- Style skills and agents: genericized the C# reference's ASR.Eleos/EleosCore codebase and removed a literal D:\source\repos\... disk path to Acme.*; descriptions to "My ... house style".
- SQL reference: ELEOS to <schema>/<schema_owner> (64), TMWSuite to "a vendor database", Scott to first person / banner placeholders; inline-TVF EXECUTE-AS fix preserved.

Main-thread adjudications and two caught misses (outside the planned sections): security-reviewer named "TMWSuite" (now dropped) and the SQL reference's #ASR_ResendMessages temp-table example (now #ResendMessages). scott-writing-style left as the named exception (first-personing it would break it, since a teammate's "my voice" is not my voice).

Open flag for Scott: scott-writing-style retains real document/client names (TMWSuite, KNX, Heniff) in its sample provenance. Scrub for team-sharing, or keep in the personal exception.

Verification (the gate for a voice-only changeset): grep across the plugin shows the only residual name is the plugin.json author; war-story terms zero; node --check on the edited hook passes; 170/170 line-balance confirms no rule or structure changed; the finishing-work diff was spot-read with every rule intact. A separate adversarial dispatch was judged disproportionate for a verified voice-only sweep under Review-Only.

Commit Model: Review-Only - staged for review-commit.
