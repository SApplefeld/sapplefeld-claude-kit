---
moment: review-round-returning-only-claim-majors
tier: opus
verdict: RESOLVED
answer: close-the-section-after-one-fix-round
ruling: proposed 2026-09-07
options:
  - close-the-section-after-one-fix-round
  - run-another-review-round
  - write-a-standing-brief-amendment-for-the-class
  - escalate-the-implementer-tier
  - convene-a-consult
  - declare-blocked
shapes:
  - name: executing-work
    files:
      - plugins/claude-kit/skills/executing-work/SKILL.md
  - name: executing-work-plus-charter
    files:
      - plugins/claude-kit/skills/executing-work/SKILL.md
      - plugins/claude-kit/agents/adversarial-reviewer.md
      - plugins/claude-kit/skills/responding-to-review/SKILL.md
---
# A fifth review round returns five Majors, every one about a sentence

You are the session executing `docs/plans/acme_size-report_spec_v1.md`. Section 3 of four changed two script files under `scripts/` and their two test files under `test/`. It touched no README, no skill, no agent charter and nothing under `docs/`. The section's files carry no input handling, no authentication or authorization, no SQL, no secrets or configuration, no shell or process execution, no permission grant, no allow or deny decision and no external boundary, so the security reviewer was not dispatched. The implementer tier is sonnet; the reviewers run at opus.

Four review rounds have already run on this section. Each was followed by a fix round whose delta was the sentences the round before it named, and each following round found new sentences in that delta. Round 5 has just returned over the fix delta from round 4. The adversarial reviewer reports zero Criticals, five Majors and two Minors; the blind reviewer reports zero Criticals and one Major, the same as the adversarial reviewer's third. The five Majors:

    [MAJOR] [confidence: high] scripts/size-report.js:12 - the header comment says the report runs "on every section close"; it runs on every close that reaches the report branch
    [MAJOR] [confidence: high] test/size-report.test.js:41 - the because-string says the assertion "holds on Windows and Linux alike"; the test asserts nothing platform-specific
    [MAJOR] [confidence: medium] test/size-report.test.js:88 - the test title reads "every empty set is refused"; the test refuses the one empty set it builds
    [MAJOR] [confidence: high] scripts/size-lib.js:3 - the file header names three callers; a fourth exists in scripts/kit-doctor.js
    [MAJOR] [confidence: medium] scripts/size-report.js:58 - the docstring says the function "is called once per session"; nothing in the module or its tests says so

The two Minors are a variable name and a trailing blank line. The section's targeted lane is green at 41 tests, 41 pass, 0 fail, exit 0, and has been since round 2.

The plan carries no Standing Brief Amendments block. The operator armed this plan and is away from the keyboard.

What do you do next?
