---
name: scott-writing-style
description: "Guide to writing in the style of Scott Applefeld. Use whenever asked for a document, draft, or other written output that will be sent by Scott Applefeld or intended to mimic his style."
---

# Scott's Writing Structure - Outline Skill

Rules reverse-engineered from a set of the author's own documents (technical proposals, benefit analyses, architecture docs, and email replies).

Follow these rules when drafting in Scott's voice. Where the samples disagree, the dominant pattern is listed first and the exception is flagged.

---

## 1. OPENING

- Open with a **blunt declarative statement of the core premise**, not a question, not a quote, not a scene.
- Opening paragraph = **1 to 3 sentences, 25–55 words**.
- The opening sentence starts with a frame-setter: `"First, it's fundamentally important to understand…"`, `"The following diagram provides a high-level introduction to…"`, `"The most valuable resource to the business is…"`, `"To provide a complete solution for…"`.
- Never open with a question.
- Never open with a quote, anecdote, or scene-setting.
- **Email exception**: If the piece is an email reply, open with a one-line personal acknowledgement (`"Thanks [Name]!"`) before the frame-setter. Keep the acknowledgement to one line.

## 2. WHAT COMES SECOND

After the opener, deliver **context/definition before verdict**. The second move is always one of:

- A definitional clarification: what the thing under discussion actually is.
- A scope statement: what this document will and will not cover.
- A goal statement: the outcome the reader should expect.

Do **not** state the verdict or recommendation second. Verdicts land at the end of a section or the end of the piece, after the reasoning.

## 3. BODY - NUMBER OF SECTIONS

- Default: **4 to 6 top-level sections**.
  - Across the samples this ranged from 4 to 6 sections. Proposals and benefit docs sat at 5 to 6 (some numbered, some with an extra unnumbered features section); architecture docs ran 4 major components plus sub-sections; email replies stayed at 4 (for example: Goal, Approach, Cost, Timeframe).
- Hard floor: 4. Hard ceiling: 6 top-level sections. If you exceed 6, collapse.
- Most sections have **2 to 3 nested sub-sections** when the topic needs drill-down. Nest at most two levels deep (section → sub-section → bullet list). Never go three levels deep in prose.

## 4. SECTION HEADERS

- Headers are **short noun phrases**, 2–4 words, Title Case or ALL CAPS.
  - Examples: `INTEGRATION DESIGN`, `DEMILITARIZED ZONE`, `PROTECTING DATABASE`, `END RESULT`, `Improving Retention`, `Back Office Efficiencies`, `Driver Efficiencies`, `Safety Monitoring`, `GOAL`, `APPROACH`, `COST`, `TIMEFRAME`.
- Never question-form headers.
- Never command/imperative headers ("Do this", "Fix that").
- Never full-sentence headers.
- Technical/internal docs use ALL CAPS headers. Client-facing proposals and benefit docs use Title Case. Pick one style per document and stay consistent.
- Sub-section headers follow the same rule: short noun phrase, often 2–3 words, Title Case (`Turnover Costs`, `Pay Drivers Sooner`, `Quick Workflow Execution`).

## 5. SECTION LENGTH

- Average section body: **90–180 words** before any sub-sections or bullets.
- Each section opens with a **single declarative sentence that states the section's thesis**, followed by 2–4 paragraphs of 2–4 sentences each.
- If a section would exceed ~220 words without structure, break it into sub-sections rather than letting it run long.
- Sub-sections are typically **40–100 words**.

## 6. PATTERNS USED REPEATEDLY

Use these. They are the signature moves.

**Opening-sentence thesis per section.** Every section's first sentence states the point of the section in plain language. The rest of the section supports it.

**"However" pivots.** Build the case, then pivot with `However,` or `By comparison,` or `Comparatively,`. This appears in every sample. It's the core rhetorical move - set up the reasonable-sounding status quo, then pivot to the reason it isn't sufficient.

**Numbered lists for enumerated mechanics.** When listing steps, components, or ranked items, use numbered lists with lettered sub-items (1 → a → i). This appears across the proposal, benefit, and architecture samples.

**Bulleted lists for catalogs and field definitions.** When listing non-ranked items (fields, data points, options), use bullets. Each bullet is typically **bold term + colon or line break + explanation**.

**Italics for emphasis on a single word.** Pattern: `"any user"`, `"every"` record, `"all"`, `"nothing"`, a key technical term, `"per year"`. One italicized word per sentence, max. Used to stress magnitude, universality, or a key technical term.

**Bold numerics for anchoring quantitative claims.** In benefit and cost analyses especially: `**$X,XXX,XXX**`, `**X% reduction**`, `**$X.XX per unit per month**`, `**XX%**`. Bold the number and its unit together.

**Concrete numbers over adjectives.** Every claim of impact is backed by a number - a concrete percentage, a specific dollar figure per unit per day, a time span in minutes, a duration in seconds. Never write "significantly faster" without following it with the actual figure.

**Short summary paragraph at the end of each section.** 1–2 sentences restating the conclusion. Then move on.

**Concrete examples after abstract explanation.** After stating an abstract rule, introduce a single named example (`"The classic simple example for this is X. Let's say I want to update X…"`), walk through it, and resolve it.

**Prose paragraphs, not wall-of-bullets.** Even in technical docs, the *reasoning* lives in prose. Bullets are reserved for catalogs and field lists, not for decomposing arguments.

**No em dashes.** Per the kit's global style rule, do not use em dashes in Scott's documents; use commas, periods, parentheses, or colons. (The original samples used them sparingly; the kit no longer does, because em dashes now read as an AI-writing tell.)

**Parenthetical asides for caveats.** `"(as some of our customers have…)"`, `"(not every customer does)"`, `"(option A, option B, option C)"`. Use parentheses for scope-limiting caveats rather than a new sentence.

**Sentence length varies deliberately.** Long explanatory sentences (30–50 words) interleaved with short landing sentences (5–12 words) at the end of a paragraph. `"The answer to solve this? Impersonation."` `"This is a difficult problem."`

**First-person plural voice in technical/proposal writing.** `"We create a new role with restricted permissions."` `"We came up with a few cost models."` `"We've never yet seen anyone…"` This is the default. Switch to first-person singular only for subjective framing: `"In my opinion…"` or `"I do not have a reference study for…"`.

## 7. CLOSING

- Close with a **restatement of the end state / net result**, not a gut punch, not a rhetorical question, not a rallying cry.
- The final section is frequently labeled `END RESULT`, `Aftermath`, `Resolution`, or functions as a summary even without an explicit header.
- Structure of close: 2–4 short sentences that tell the reader *what you now have* after applying the design/approach/process. Past tense or present-indicative, not future-promise.
- Example patterns: `"The ultimate result of this design is that we have…"`, `"This creates a model where…"`, `"That fixed the issue since the initial change, and for all punches moving forward."`
- **Email exception**: Emails close with an invitation to respond (`"I look forward to your feedback and thoughts. Let me know if you'd like to touch base via a call…"`) + signoff. That's the only place a CTA appears.
- No motivational closes. No exclamation marks at the end of a document body (email signoffs excepted). No "Remember:" or "The takeaway is:" hand-holding.

## 8. NEVER DO

Conspicuously absent across all the samples:

- **No question-form headers.** Ever.
- **No rhetorical questions in the body prose.** The single exception is the self-answer device `"The answer to solve this? Impersonation."` - used maybe once per document, never more.
- **No emoji.** Zero.
- **No motivational language.** No "unlock", "leverage", "empower", "transform", "revolutionize", "game-changer", "world-class", "cutting-edge".
- **No marketing hype adjectives unsupported by numbers.** "Significant" appears, but always followed by the figure that justifies it.
- **No opening anecdote or story.** No "Picture this…", no customer quote, no scene.
- **No listicle-only documents.** Prose carries the argument; bullets support it.
- **No three-level-deep bullet nesting in prose sections.** Nesting appears only in field/parameter catalogs.
- **No headers longer than ~5 words.**
- **No "In conclusion" / "To summarize" signposting.** The final section simply states the result.
- **No second person ("you") as the primary voice.** `"you"` appears occasionally for instructional framing (`"if you choose to…"`) but the dominant voice is `we` in proposal/technical work.
- **No contractions in technical documentation.** Contractions appear in emails (`"we've"`, `"I'll"`, `"don't"`) but are rare in the formal technical PDFs.
- **No Oxford-comma inconsistency within a document.** Pick and stick.
- **No passive voice as the default.** Active construction: "We create…", "We deny…", "We block permissions…". Passive is reserved for describing third-party system behavior.
- **No hedging stacked deep.** One hedge per claim max (`"typically"`, `"usually"`, `"in most cases"`). Never `"it could potentially perhaps in some cases…"`.

---

## CONTRADICTIONS ACROSS THE SAMPLES

Flagged honestly:

1. **Header case**: Technical PDFs use ALL CAPS (`INTEGRATION DESIGN`). Benefit and integration docs use Title Case (`Improving Retention`, `Architecture Diagram`). Proposal-style emails use ALL CAPS (`GOAL`, `APPROACH`). No strict rule - pick based on formality: ALL CAPS for internal/technical and for proposal-style enumerations, Title Case for longer Title Case reports.

2. **Opener formality**: The formal documents open cold with the thesis. The emails open with a one-line thank-you first. Rule: emails get the courtesy line, documents don't.

3. **Section count**: Status/review writing is denser (a few major buckets with many nested items) than the proposal-style docs (4–6 roughly parallel sections). Status/review writing nests more; proposal/explanatory writing stays flatter.

4. **First-person singular vs plural**: Benefit analyses use `"In my opinion"` sparingly. Direct 1:1 emails use `"I"` frequently (`"I think"`, `"I suspect"`, `"I'd love your feedback"`). Technical security/architecture docs stay in `"we"`. Rule: use `I` only when the piece is a direct 1:1 communication expressing personal judgment; use `we` for company-voice deliverables.

## STRONGEST PATTERNS (IF YOU REMEMBER NOTHING ELSE)

1. Every section opens with a one-sentence thesis, then supports it.
2. Every impact claim is anchored to a specific number.
3. `However,` / `By comparison,` is the core pivot - set up, then pivot.
4. Close with an `END RESULT`-style net-state paragraph, not a call to action.
5. No questions as headers, no emoji, no hype adjectives, no opening anecdote.