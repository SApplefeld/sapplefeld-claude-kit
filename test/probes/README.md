# Scenario probes

One file per governed moment: frontmatter carrying the moment, the tier, the
closed option list, the context shapes and the ruled answer, then the scenario a
cold reader receives verbatim. `tools/probe-corpus/run.mjs` runs them and
`test/probe-set.test.js` pins their shape. This file is not a probe;
`listProbeFiles` excludes it by name.

A probe offers four to six options: fewer makes the answer guessable, more
splits one answer across near-identical slugs. Each probe is a flat
`test/probes/<name>.md` file, measured in words by the size ratchet, so adding
one also adds its cap entry to `test/size-budget.json`.

Every answer is a hand adjudication frozen at the ruling, on the discipline
`sidecar/batteries/README.md` states: nobody rewrites an answer from a probe
run. A disagreeing run is a finding about the corpus or about the probe.

A probe's answer is one answer across all of its shapes, so a shape built to
expose a narrow context's own defect reads as a mismatch by design and that
mismatch is the signal. One such pair stands today: the pre-send checklist probe
under `output-style-plus-executing-work`, where the reader holds the output
style's copy of the pre-send re-read and not the doctrine that copy summarizes,
which is where the stop's exception lives. A designed red is marked on the shape
itself, as the optional `designed-mismatch: <slug>` key the parser validates and
holds to a slug, with the reason in prose here and in a frontmatter comment on
the probe. The marker never reaches the reader: the runner composes a prompt out
of the scenario, the option list and the shape's files alone, so neither the key
nor its slug is in anything the reader holds, and a reader told which reading is
expected confirms it. What the marker does reach is the run's arithmetic: a
disagreement on a marked shape is reported as `designed` and stays out of the
exit code, and an agreement is reported as `designed-agreed` and counted like any
other mismatch, since a red that stopped being red is the finding.

One further pair disagrees without being designed to, and is not counted above:
the branch-and-pr pull-request probe under `full`, where cold readings report
RESOLVED with finishing-work as the owner against this probe's proposed
CONTESTED and its unowned answer. That disagreement is an open question for the
operator's ruling on the probe, not a signal a shape was built to take.
