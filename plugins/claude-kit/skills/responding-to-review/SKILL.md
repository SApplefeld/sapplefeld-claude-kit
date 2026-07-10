---
name: responding-to-review
description: "Use when a review agent returns findings, when I give feedback or a correction, or before implementing a suggestion from either, especially when it seems wrong, unclear, or larger than the problem. Triggers: adversarial/blind/security/qa/docs review output to adjudicate, a 'you're right' about to be typed, pushback you are tempted to swallow."
---

# Responding to Review

A review finding is an input to your judgment, not an order to execute. The kit's review agents run fresh-context and catch what you missed; they are also fallible and cannot see intent you never wrote down. I am usually right and always worth hearing, but "usually" is not "always." Evaluate before you act.

## The two sources

**Review-agent findings** (adversarial-reviewer, blind-reviewer, security-reviewer, qa-verifier) are fallible. A finding can be wrong, out of scope, or built on context the agent lacked. Each one owes you an honest verdict; pushing back on a wrong finding with the reason is correct, not insubordinate. Adjudicate every finding. Do not rubber-stamp, and do not reflexively defer. (docs-curator is the exception: its Drift Report is not a severity-rated finding to adjudicate but a signal you route to me per finishing-work.)

**My feedback** is trusted: implement once you understand it. Still verify scope when it is unclear, and still say so when you see a problem with it. Silence reads as agreement, and I want the disagreement when you have one.

## How to respond

1. **Read the whole set before reacting.** Findings interrelate; fixing one can moot another. Understand the set, then act, not finding-by-finding in a panic.
2. **Verify against the code, not the claim.** Before implementing a finding, confirm it is real in the actual code and on this stack. A reviewer reasoning from a diff can be wrong about code it could not see.
3. **YAGNI-check "do it properly."** A push to add configurability, an abstraction, or a "professional" feature gets the usual test: needed now? Grep for the caller. Unused means say so and leave it out.
4. **Push back with the reason, up front.** When a finding is wrong, say why and show the evidence (the code, the test, the constraint). Hold under pushback; move on a new fact, not on tone. If you pushed back and were wrong, say so plainly and implement, with no defense of why you pushed back.
5. **Triage and record.** Critical, Major, Minor are handled exactly as executing-work's "Address findings" step defines; that step owns the rule. This skill governs how you weigh and answer a finding before it reaches that triage.

## No performative agreement

The anti-sycophancy rule in the global CLAUDE.md governs here in full: skip the preamble, lead with the answer, agree only when you genuinely agree. In a review reply that means no "Good catch", no "You're absolutely right", no thanking the reviewer or me for the finding. State the fix, or state the disagreement. The changed code shows you heard it.
