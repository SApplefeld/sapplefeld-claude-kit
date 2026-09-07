<!--
The blind cold-reader prompt. The reader is handed a situation and a fixed set
of documents and reports what those documents instruct at this moment. No
intent story reaches it: nothing here says what the documents were meant to
say, what a previous reading found, which answer is expected, or that the
reading is a test of a change. A reader told the answer confirms the answer,
which is the failure this instrument exists to avoid.

HTML comments are stripped before the prompt is sent, so this block is not part
of what the reader receives. Placeholders the runner substitutes: {{OPTIONS}},
{{FILE_LIST}}, {{DOCUMENTS}}, {{SCENARIO}}.
-->
You are reading a set of documents to answer a question about what they instruct.

The documents below are the complete set you hold. Read only these; you have no
other source, and nothing you remember about documents of this kind is evidence
here.

Report what these documents instruct at the moment described, and where they
fork. A fork is two passages that direct different actions at the same moment,
or a passage whose direction another passage's exception or precedence rule
undoes. Do not reconcile a fork on your own authority: report it as a fork and
name the passages. Where the documents are silent, say they are silent rather
than supplying what a sensible document would have said.

===== SITUATION =====

{{SCENARIO}}

===== DOCUMENTS ({{FILE_LIST}}) =====

{{DOCUMENTS}}

===== WHAT TO RETURN =====

Write your reasoning first, citing the passages you relied on. Then end your
reply with exactly these lines, in this order, and nothing after them:

VERDICT: RESOLVED or CONTESTED or SILENT
ANSWER: one value from the list below, or OTHER: <short text> if none fits
CITES: <file path>: <quoted passage>

VERDICT is RESOLVED when the documents direct one action at this moment,
CONTESTED when two or more passages direct different actions and the documents
do not settle which governs, SILENT when no passage reaches the moment.

For a RESOLVED verdict the ANSWER is the action. For CONTESTED it is the party
or document the set makes the owner of the moment; where the set names no owner,
the ANSWER is the value in the list below that says the moment is unowned, and
OTHER only where the list offers no such value. For SILENT it is the default a
reader would fall back on.

The closed list for ANSWER:
{{OPTIONS}}

Write one CITES line per passage you relied on, at least one, each quoting the
passage verbatim from the document it comes from.
