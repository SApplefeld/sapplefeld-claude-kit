// Pins the segmented plan contract end to end: createPlan bounds only the
// summarized group (--keep N counts real human-bounded turns, falling back to
// segments only when the compactable turns number N or fewer and counting
// turns would leave nothing to summarize), prefix turns stay whole, and
// buildCompactedRows emits one summary row per segment with every tool row
// present exactly once on a single unbroken parent chain. The chain is
// asserted through a real write-and-reread, because a fork strands rows only
// at resume time: the reader follows one parent chain and silently drops the
// losing branch.
// Run: bun test tools/engine-tests/
import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSingleParentChain,
  buildCompactedRows,
  createPlan,
  getUserPromptText,
} from "../../plugins/claude-kit/skills/compact-session/engine/compact";
import {
  estimateRowTokens,
  readActiveTranscriptRows,
  SEGMENT_TOKEN_BUDGET,
  writeTranscriptEntries,
  type TranscriptRow,
  type Turn,
} from "../../plugins/claude-kit/skills/compact-session/engine/transcript";

// Payload sized as a fraction of the budget in estimated tokens (chars/4 over
// serialized message content), so fixtures read as budget math.
function payload(budgetFraction: number): string {
  return "x".repeat(Math.round(SEGMENT_TOKEN_BUDGET * 4 * budgetFraction));
}

// The splitter's own estimate, summed over rows, so a fixture is measured by
// the same rule the splitter packs against and the two cannot drift.
function estimatedTokens(rows: TranscriptRow[]): number {
  return rows.reduce((sum, row) => sum + estimateRowTokens(row), 0);
}

// Fixture rows carry strictly increasing timestamps, like a real
// transcript's. readActiveTranscriptRows breaks its leaf tie by strict
// timestamp comparison, so uniform timestamps would leave that tie-break
// inert and hand the tests a reader ordering no production transcript
// produces.
let nextTimestampMs = Date.parse("2026-01-01T00:00:00.000Z");
function nextTimestamp(): string {
  nextTimestampMs += 1000;
  return new Date(nextTimestampMs).toISOString();
}

function makeRow(
  uuid: string,
  type: TranscriptRow["type"],
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): TranscriptRow {
  return {
    type,
    uuid,
    parentUuid: null,
    sessionId: "src",
    timestamp: nextTimestamp(),
    message,
    ...extra,
  };
}

function humanRow(id: string, text: string): TranscriptRow {
  return makeRow(id, "user", { id: `msg-${id}`, role: "user", content: text });
}

type StepOptions = {
  text?: string | null;
  toolName?: string;
  toolResultText?: string;
};

// One assistant step: a text row, optionally followed by a tool_use row of the
// same assistant message and its tool_result row. text: null makes a tool-only
// step, whose step-opening row is itself a tool_use row.
function makeStep(id: string, options: StepOptions = {}): TranscriptRow[] {
  const messageId = `msg-${id}`;
  const rows: TranscriptRow[] = [];
  if (options.text !== null) {
    rows.push(
      makeRow(`${id}-text`, "assistant", {
        id: messageId,
        role: "assistant",
        content: [{ type: "text", text: options.text ?? `answer for ${id}` }],
      }),
    );
  }
  if (options.toolName) {
    rows.push(
      makeRow(`${id}-tooluse`, "assistant", {
        id: messageId,
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: `tool-${id}`,
            name: options.toolName,
            input: {},
          },
        ],
      }),
    );
    rows.push(
      makeRow(`${id}-toolresult`, "user", {
        id: `msg-${id}-result`,
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `tool-${id}`,
            content: options.toolResultText ?? `result for ${id}`,
          },
        ],
      }),
    );
  }
  return rows;
}

// One assistant message issuing two tool calls at once: two assistant rows
// sharing a message id, each with its own tool_use, followed by both
// tool_results. This is the topology parallel tool calls leave in a real
// transcript, and the one shape makeStep cannot produce.
function makeParallelStep(
  id: string,
  options: { toolResultText?: string } = {},
): TranscriptRow[] {
  const messageId = `msg-${id}`;
  const toolUseRow = (suffix: string, name: string): TranscriptRow =>
    makeRow(`${id}-${suffix}`, "assistant", {
      id: messageId,
      role: "assistant",
      content: [
        { type: "tool_use", id: `tool-${id}-${suffix}`, name, input: {} },
      ],
    });
  const resultRow = (suffix: string): TranscriptRow =>
    makeRow(`${id}-${suffix}-result`, "user", {
      id: `msg-${id}-${suffix}-result`,
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `tool-${id}-${suffix}`,
          content: options.toolResultText ?? `result ${suffix} for ${id}`,
        },
      ],
    });
  return [
    toolUseRow("anchor", "Bash"),
    toolUseRow("sibling", "Read"),
    resultRow("anchor"),
    resultRow("sibling"),
  ];
}

// Restores the fork that chainRows flattens: a parallel step's sibling shares
// the anchor's parent rather than following it, and each tool_result parents
// to the row that issued its tool_use. Two rows then share one parent, which
// is what makes the emitted chain's linearization load-bearing.
function linkParallelSteps(rows: TranscriptRow[]): TranscriptRow[] {
  const byUuid = new Map(rows.map(row => [row.uuid, row]));
  for (const row of rows) {
    const id = /^(.+)-sibling$/.exec(row.uuid)?.[1];
    if (id === undefined) {
      continue;
    }
    const anchor = byUuid.get(`${id}-anchor`)!;
    row.parentUuid = anchor.parentUuid;
    byUuid.get(`${id}-anchor-result`)!.parentUuid = anchor.uuid;
    byUuid.get(`${id}-sibling-result`)!.parentUuid = row.uuid;
  }
  return rows;
}

// A prior compaction's summary row, which is what createPlan scans for to
// place compactionStartIndex.
function priorCompactionRow(): TranscriptRow {
  return makeRow(
    "prior-summary",
    "assistant",
    {
      id: "msg-prior",
      role: "assistant",
      content: [{ type: "text", text: "an earlier summary" }],
    },
    { magicCompact: { summary: true } },
  );
}

// Links a flat row list into a single parent chain, the shape
// readActiveTranscriptRows produces.
function chainRows(rows: TranscriptRow[]): TranscriptRow[] {
  let parent: string | null = null;
  for (const row of rows) {
    row.parentUuid = parent;
    parent = row.uuid;
  }
  return rows;
}

// The field shape: a prior compaction boundary, one oversized human-bounded
// turn, then short trailing turns. steps builds the oversized turn's body.
function fieldShapeRows(
  steps: TranscriptRow[][],
  trailingPrompts: string[],
): TranscriptRow[] {
  return chainRows([
    humanRow("h0", "the already-summarized question"),
    priorCompactionRow(),
    humanRow("h1", "the oversized question"),
    ...steps.flat(),
    ...trailingPrompts.flatMap((prompt, index) => [
      humanRow(`h${index + 2}`, prompt),
      ...makeStep(`tail${index}`, { text: "short answer", toolName: "Edit" }),
    ]),
  ]);
}

// The oversized turn LAST, behind short ones. This is the shape that
// discriminates the slice ordering: --keep must preserve the oversized turn
// whole, whereas counting segments would leave only its final segment in
// preservedTurns and hand the rest of it to the summarizer. shortTurns sets
// how many short turns lead it, which is what holds the compactable turn
// count above --keep N: at or below N the keep count is expressed in
// segments instead, and the whole-turn slice this fixture discriminates does
// not apply.
function trailingOversizedRows(shortTurns = 1): TranscriptRow[] {
  return chainRows([
    humanRow("h0", "the already-summarized question"),
    priorCompactionRow(),
    humanRow("h1", "the short question"),
    ...makeStep("s1", { text: "short answer", toolName: "Edit" }),
    ...(shortTurns > 1
      ? [
          humanRow("h1b", "the second short question"),
          ...makeStep("s2", { text: "short answer", toolName: "Edit" }),
        ]
      : []),
    humanRow("h2", "the oversized trailing question"),
    ...makeStep("b1", { text: payload(0.6), toolName: "Bash" }),
    ...makeStep("b2", { text: payload(0.6), toolName: "Read" }),
    ...makeStep("b3", { text: payload(0.6), toolName: "Grep" }),
  ]);
}

// No prior compaction boundary and a single human prompt, the shape an
// autonomous run leaves behind: every row belongs to one human-bounded turn.
function singleOversizedTurnRows(): TranscriptRow[] {
  return chainRows([
    humanRow("h1", "the only question"),
    ...makeStep("b1", { text: payload(0.6), toolName: "Bash" }),
    ...makeStep("b2", { text: payload(0.6), toolName: "Read" }),
    ...makeStep("b3", { text: payload(0.6), toolName: "Grep" }),
  ]);
}

// A prior compaction boundary followed by exactly turnCount oversized
// human-bounded turns, so a test can place the compactable turn count on
// either side of keepTurns.
function oversizedTurnsAfterPrefix(turnCount: number): TranscriptRow[] {
  return chainRows([
    humanRow("h0", "the already-summarized question"),
    priorCompactionRow(),
    ...Array.from({ length: turnCount }, (_, index) => [
      humanRow(`h${index + 1}`, `oversized question ${index + 1}`),
      ...makeStep(`t${index}a`, { text: payload(0.6), toolName: "Bash" }),
      ...makeStep(`t${index}b`, { text: payload(0.6), toolName: "Read" }),
    ]).flat(),
  ]);
}

function toolBlockIds(
  rows: TranscriptRow[],
  blockType: "tool_use" | "tool_result",
): string[] {
  const idKey = blockType === "tool_use" ? "id" : "tool_use_id";
  const ids: string[] = [];
  for (const row of rows) {
    const content = row.message?.["content"];
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content as Record<string, unknown>[]) {
      if (block["type"] === blockType && typeof block[idKey] === "string") {
        ids.push(block[idKey] as string);
      }
    }
  }
  return ids;
}

function isSummaryRow(row: TranscriptRow): boolean {
  return (
    (row["magicCompact"] as { summary?: boolean } | undefined)?.summary === true
  );
}

// The text of each summary row in emission order. The prefix turn carries the
// earlier compaction's own summary row, so this list always opens with it.
function summaryTexts(rows: TranscriptRow[]): string[] {
  return rows.filter(isSummaryRow).flatMap(row => {
    const content = row.message?.["content"];
    return Array.isArray(content)
      ? (content as Record<string, unknown>[])
          .filter(block => block["type"] === "text")
          .map(block => String(block["text"]))
      : [];
  });
}

describe("createPlan segmentation", () => {
  test("the field shape plans to multiple bounded segments instead of one mega-entry", () => {
    // Three human-bounded turns, the middle one oversized, keep 1. Before
    // segmentation this planned to a single summarized entry, which rendered
    // a one-pair template and made every summarizer index past 0 a hard throw.
    const steps = [
      makeStep("b1", { text: payload(0.6), toolName: "Bash" }),
      makeStep("b2", { text: payload(0.6), toolName: "Read" }),
      makeStep("b3", { text: payload(0.6), toolName: "Grep" }),
    ];
    const rows = fieldShapeRows(steps, ["the preserved question"]);
    const plan = createPlan(rows, 1);

    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.preservedTurns.length).toBe(1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);

    // The nextTurn anchor generateSummaries hands the summarizer comes from
    // plan.preservedTurns[0], which must be a real unsegmented turn: a
    // continuation segment there would put a synthetic anchor in the
    // template.
    expect(getUserPromptText(plan.preservedTurns[0]!)).not.toMatch(
      /^\(continuation \d+\) /,
    );

    // The packing rule bounds a segment by the budget only when every chunk
    // it packs fits: an indivisible chunk over the budget stands alone and
    // exceeds it. The per-step check below keeps the fixture's sizing honest
    // but bounds the chunks only loosely (a chunk is a step plus whatever
    // rides with it, such as the turn's leading user rows); the per-segment
    // check is the assertion that matters.
    for (const step of steps) {
      expect(estimatedTokens(step)).toBeLessThan(SEGMENT_TOKEN_BUDGET);
    }
    for (const segment of plan.summarizedTurns) {
      expect(estimatedTokens(segment.rows)).toBeLessThanOrEqual(
        SEGMENT_TOKEN_BUDGET,
      );
    }

    // The segments partition the one oversized turn, in order, without loss.
    const oversizedRows = rows.slice(
      rows.findIndex(row => row.uuid === "h1"),
      rows.findIndex(row => row.uuid === "h2"),
    );
    expect(plan.summarizedTurns.flatMap(segment => segment.rows)).toEqual(
      oversizedRows,
    );

    // Only the first segment carries the turn's user row; the rest anchor on
    // their continuation overrides.
    expect(plan.summarizedTurns[0]!.userRows.length).toBe(1);
    for (const segment of plan.summarizedTurns.slice(1)) {
      expect(segment.userRows).toEqual([]);
      expect(getUserPromptText(segment)).toMatch(/^\(continuation \d+\) /);
    }
  });

  test("a plan whose turns are all under budget is unchanged", () => {
    const rows = fieldShapeRows(
      [makeStep("b1", { text: "short", toolName: "Bash" })],
      ["the preserved question"],
    );
    const plan = createPlan(rows, 1);
    expect(plan.summarizedTurns.length).toBe(1);
    expect(plan.summarizedTurns[0]!.userRows.length).toBe(1);
    expect(plan.summarizedTurns[0]!.anchorOverride).toBeUndefined();
  });

  test("--keep 1 preserves the trailing oversized turn whole, not its last segment", () => {
    const rows = trailingOversizedRows();
    const oversizedRows = rows.slice(rows.findIndex(row => row.uuid === "h2"));
    const plan = createPlan(rows, 1);

    expect(plan.preservedTurns.length).toBe(1);
    const preserved = plan.preservedTurns[0]!;
    expect(preserved.anchorOverride).toBeUndefined();
    expect(preserved.userRows.length).toBe(1);
    expect(getUserPromptText(preserved)).toContain(
      "the oversized trailing question",
    );

    // The whole turn survives, over budget and all: preserved turns are never
    // summarized, so nothing bounds their span.
    expect(preserved.rows).toEqual(oversizedRows);
    expect(estimatedTokens(preserved.rows)).toBeGreaterThan(
      SEGMENT_TOKEN_BUDGET,
    );

    // Only the short turn is summarized, and it needs no segmenting.
    expect(plan.summarizedTurns.length).toBe(1);
    expect(getUserPromptText(plan.summarizedTurns[0]!)).toContain(
      "the short question",
    );
  });

  test("--keep 2 counts real turns, so the oversized turn's segments never enter the count", () => {
    // Three compactable turns against --keep 2, so the keep count is
    // expressed in whole turns and the oversized turn's segments are never
    // candidates for it.
    const rows = trailingOversizedRows(2);
    const plan = createPlan(rows, 2);

    // The last two real turns are preserved, whole and unsegmented,
    // identified by their own human prompts rather than by count alone.
    expect(plan.preservedTurns.length).toBe(2);
    expect(getUserPromptText(plan.preservedTurns[0]!)).toContain(
      "the second short question",
    );
    expect(getUserPromptText(plan.preservedTurns[1]!)).toContain(
      "the oversized trailing question",
    );
    for (const turn of plan.preservedTurns) {
      expect(turn.anchorOverride).toBeUndefined();
      expect(turn.userRows.length).toBe(1);
    }

    // The prefix turn is likewise never segmented, and the one turn left over
    // is short enough to need no segmenting.
    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.prefixTurns[0]!.anchorOverride).toBeUndefined();
    expect(plan.summarizedTurns.length).toBe(1);
    expect(getUserPromptText(plan.summarizedTurns[0]!)).toContain(
      "the short question",
    );
    expect(plan.summarizedTurns[0]!.anchorOverride).toBeUndefined();
  });
});

describe("createPlan segment-granular keep", () => {
  test("a lone oversized turn with --keep 1 summarizes segments and preserves the last one", () => {
    // Counting whole turns here leaves nothing to summarize at all, which is
    // how an autonomous run stays permanently uncompactable: the CLI skips on
    // an empty summarized group.
    const rows = singleOversizedTurnRows();
    const plan = createPlan(rows, 1);

    expect(plan.prefixTurns).toEqual([]);
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);
    expect(plan.preservedTurns.length).toBe(1);

    // Every entry is a segment of the one turn, in order, without loss.
    expect(
      [...plan.summarizedTurns, ...plan.preservedTurns].flatMap(
        turn => turn.rows,
      ),
    ).toEqual(rows);
    for (const segment of plan.summarizedTurns) {
      expect(estimatedTokens(segment.rows)).toBeLessThanOrEqual(
        SEGMENT_TOKEN_BUDGET,
      );
    }

    // The turn's own user row opens the first summarized entry; the preserved
    // entry is the trailing continuation segment, which anchors on its
    // override because it has no user rows of its own.
    expect(plan.summarizedTurns[0]!.userRows.length).toBe(1);
    expect(plan.summarizedTurns[0]!.anchorOverride).toBeUndefined();
    const preserved = plan.preservedTurns[0]!;
    expect(preserved.userRows).toEqual([]);
    expect(preserved.anchorOverride).toBeDefined();
    expect(getUserPromptText(preserved)).toMatch(/^\(continuation \d+\) /);
    expect(preserved.rows).toEqual(
      rows.slice(rows.length - preserved.rows.length),
    );
  });

  test("a lone turn under the budget still plans nothing to summarize", () => {
    // One segment, preserved, so compactTranscript skips instead of paying a
    // summarizer call to compact a small session.
    const rows = chainRows([
      humanRow("h1", "the only question"),
      ...makeStep("b1", { text: "short answer", toolName: "Bash" }),
    ]);
    const plan = createPlan(rows, 1);

    expect(plan.summarizedTurns).toEqual([]);
    expect(plan.preservedTurns.length).toBe(1);
    expect(plan.preservedTurns[0]!.anchorOverride).toBeUndefined();
    expect(plan.preservedTurns[0]!.userRows.length).toBe(1);
    expect(plan.preservedTurns[0]!.rows).toEqual(rows);
  });

  test("fewer segments than --keep N preserves all of them and summarizes nothing", () => {
    // Two short compactable turns against --keep 3: the segmented compactable
    // stretch is shorter than the keep count, so the whole stretch is
    // preserved rather than having its head handed to the summarizer.
    const rows = chainRows([
      humanRow("h1", "the first question"),
      ...makeStep("s1", { text: "short answer", toolName: "Bash" }),
      humanRow("h2", "the second question"),
      ...makeStep("s2", { text: "short answer", toolName: "Read" }),
    ]);
    const plan = createPlan(rows, 3);

    expect(plan.summarizedTurns).toEqual([]);
    expect(plan.preservedTurns.length).toBe(2);
    expect(plan.preservedTurns.flatMap(turn => turn.rows)).toEqual(rows);
  });

  test("compactable turns numbering exactly --keep N fall back to segments", () => {
    // The boundary the fallback condition turns on. At exactly keepTurns the
    // whole-turn slice is already empty, so segments are the only way to
    // express the keep, and requiring strictly fewer would leave this shape
    // uncompactable.
    const rows = oversizedTurnsAfterPrefix(2);
    const plan = createPlan(rows, 2);

    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(0);
    expect(plan.preservedTurns.length).toBe(2);

    // Both compactable turns are segmented and partitioned across the two
    // groups, prefix untouched.
    const compactableRows = rows.slice(rows.findIndex(row => row.uuid === "h1"));
    expect(
      [...plan.summarizedTurns, ...plan.preservedTurns].flatMap(
        turn => turn.rows,
      ),
    ).toEqual(compactableRows);
    expect(plan.prefixTurns[0]!.anchorOverride).toBeUndefined();
    for (const segment of plan.summarizedTurns) {
      expect(estimatedTokens(segment.rows)).toBeLessThanOrEqual(
        SEGMENT_TOKEN_BUDGET,
      );
    }
  });

  test("one more compactable turn than --keep N keeps whole-turn semantics", () => {
    // One past the boundary, so the fallback must not fire: the kept tail is
    // whole turns, over budget and unsegmented, and only the earlier turn is
    // summarized. This is the direction that catches a fallback widened to
    // cases the turn count can already express.
    const rows = oversizedTurnsAfterPrefix(3);
    const plan = createPlan(rows, 2);

    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.preservedTurns.length).toBe(2);
    expect(getUserPromptText(plan.preservedTurns[0]!)).toContain(
      "oversized question 2",
    );
    expect(getUserPromptText(plan.preservedTurns[1]!)).toContain(
      "oversized question 3",
    );
    for (const turn of plan.preservedTurns) {
      expect(turn.anchorOverride).toBeUndefined();
      expect(turn.userRows.length).toBe(1);
      expect(estimatedTokens(turn.rows)).toBeGreaterThan(SEGMENT_TOKEN_BUDGET);
    }
    expect(plan.preservedTurns.flatMap(turn => turn.rows)).toEqual(
      rows.slice(rows.findIndex(row => row.uuid === "h2")),
    );

    // Only the first compactable turn is summarized, and it is segmented.
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);
    expect(plan.summarizedTurns.flatMap(turn => turn.rows)).toEqual(
      rows.slice(
        rows.findIndex(row => row.uuid === "h1"),
        rows.findIndex(row => row.uuid === "h2"),
      ),
    );
  });

  test("an oversized trailing turn at the keep boundary falls back to segments", () => {
    // Two compactable turns against --keep 2, with the oversized one last.
    // Counting whole turns preserves both and summarizes nothing, so the keep
    // is expressed in segments: the tail of the oversized turn is preserved
    // and its head joins the short turn in the summarized group.
    const rows = trailingOversizedRows();
    const plan = createPlan(rows, 2);

    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.preservedTurns.length).toBe(2);
    expect(plan.summarizedTurns.length).toBe(2);

    // Both preserved entries are continuation segments of the oversized turn,
    // so its opening rows are summarized rather than kept.
    for (const segment of plan.preservedTurns) {
      expect(segment.userRows).toEqual([]);
      expect(getUserPromptText(segment)).toMatch(/^\(continuation \d+\) /);
    }

    // The short turn survives whole as the first summarized entry, and the
    // oversized turn's own user row opens the second.
    expect(getUserPromptText(plan.summarizedTurns[0]!)).toContain(
      "the short question",
    );
    expect(plan.summarizedTurns[0]!.anchorOverride).toBeUndefined();
    expect(getUserPromptText(plan.summarizedTurns[1]!)).toContain(
      "the oversized trailing question",
    );

    const compactableRows = rows.slice(rows.findIndex(row => row.uuid === "h1"));
    expect(
      [...plan.summarizedTurns, ...plan.preservedTurns].flatMap(
        turn => turn.rows,
      ),
    ).toEqual(compactableRows);
  });

  test("the preserved tail is the greedy remainder, measured against the budget", () => {
    // Five steps that pack two-per-segment only when both fit, so the last
    // segment is whatever is left over. Nothing floors that remainder: the
    // keep is a count of segments, so --keep 1 preserves as little verbatim
    // context as the packing happens to leave. The numbers below are a
    // measurement of that packing, not a guarantee the code makes, and they
    // exist so a change that shrinks the tail toward nothing is visible.
    const rows = chainRows([
      humanRow("h1", "the only question"),
      ...makeStep("b1", { text: payload(0.5), toolName: "Bash" }),
      ...makeStep("b2", { text: payload(0.5), toolName: "Read" }),
      ...makeStep("b3", { text: payload(0.5), toolName: "Grep" }),
      ...makeStep("b4", { text: payload(0.5), toolName: "Edit" }),
      ...makeStep("b5", { text: "a short closing step", toolName: "Bash" }),
    ]);
    const plan = createPlan(rows, 1);

    expect(plan.summarizedTurns.length).toBe(3);
    expect(plan.preservedTurns.length).toBe(1);

    // The tail carries the last full step plus the short one that still fit
    // beside it, a little over half the budget.
    const preserved = plan.preservedTurns[0]!;
    expect(preserved.rows.map(row => row.uuid)).toEqual([
      "b4-text",
      "b4-tooluse",
      "b4-toolresult",
      "b5-text",
      "b5-tooluse",
      "b5-toolresult",
    ]);
    const preservedTokens = estimatedTokens(preserved.rows);
    expect(preservedTokens).toBeGreaterThan(SEGMENT_TOKEN_BUDGET * 0.45);
    expect(preservedTokens).toBeLessThan(SEGMENT_TOKEN_BUDGET * 0.55);
  });

  test("--keep 0 summarizes the lone oversized turn entirely", () => {
    // Nothing is held back, so the whole turn is segmented into the
    // summarized group. The segment-granular keep condition cannot reach this
    // shape at all: at keepTurns 0 it holds only for an empty compactable
    // list, and this one has a turn in it.
    const rows = singleOversizedTurnRows();
    const plan = createPlan(rows, 0);

    expect(plan.preservedTurns).toEqual([]);
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);
    expect(plan.summarizedTurns.flatMap(turn => turn.rows)).toEqual(rows);
  });
});

describe("buildCompactedRows over a segmented plan", () => {
  const sessionIds: string[] = [];
  const transcriptPaths: string[] = [];

  // Cleanup runs per test, not at suite end: buildCompactedRows writes real
  // entries under ~/.claude/magic-compact/, and an interrupted run then
  // strands at most one test's artifacts instead of the whole suite's.
  afterEach(async () => {
    for (const sessionId of sessionIds.splice(0)) {
      await unlink(
        join(homedir(), ".claude", "magic-compact", `${sessionId}.json`),
      ).catch(() => undefined);
    }
    for (const path of transcriptPaths.splice(0)) {
      await unlink(path).catch(() => undefined);
    }
  });

  function newSessionId(): string {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    return sessionId;
  }

  // Tool-only steps, so every segment after the first opens on a tool_use row.
  // That is the shape where the entry's first assistant row is emitted twice,
  // once as the summary row and once for its tool blocks, and it is routine
  // for continuation segments because they open on a step boundary.
  function toolFirstPlanRows(): TranscriptRow[] {
    return fieldShapeRows(
      ["b1", "b2", "b3", "b4"].map(id =>
        makeStep(id, {
          text: null,
          toolName: "Bash",
          toolResultText: payload(0.7),
        }),
      ),
      ["the preserved question"],
    );
  }

  test("every tool row survives exactly once on one chain across segment boundaries", async () => {
    const sessionId = newSessionId();
    const sourceRows = toolFirstPlanRows();
    const plan = createPlan(sourceRows, 1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);
    // The path under test: the segments' opening assistant rows carry tool
    // blocks, so each is emitted both as a summary row and as a tool row.
    for (const segment of plan.summarizedTurns.slice(1)) {
      expect(segment.rows[0]!.uuid).toMatch(/-tooluse$/);
    }

    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);

    expect(rows[0]!.magicCompact).toEqual({ boundary: true });
    // One summary row per segment, in segment order, after the prefix turn's
    // inherited summary row.
    expect(summaryTexts(rows)).toEqual([
      "an earlier summary",
      ...plan.summarizedTurns.map((_, index) => `summary ${index}`),
    ]);

    const uuids = rows.map(row => row.uuid);

    // Every tool_use and tool_result of the source appears exactly once, in
    // source order. Pruning rewrites payloads but never the ids.
    const sourceUses = toolBlockIds(sourceRows, "tool_use");
    const sourceResults = toolBlockIds(sourceRows, "tool_result");
    expect(toolBlockIds(rows, "tool_use")).toEqual(sourceUses);
    expect(toolBlockIds(rows, "tool_result")).toEqual(sourceResults);

    expectToolPairsResumable(rows);

    // Resume-time proof: the reader follows one parent chain, so a stranded
    // branch shows up here as rows that vanish rather than as a bad assertion
    // above. Everything after the boundary row (which the reader strips as
    // the compaction marker) must survive the round trip.
    const path = join(tmpdir(), `${sessionId}.jsonl`);
    transcriptPaths.push(path);
    await writeTranscriptEntries(path, rows);
    const active = await readActiveTranscriptRows(path);
    expect(active.map(row => row.uuid)).toEqual(uuids.slice(1));
    expect(summaryTexts(active)).toEqual(summaryTexts(rows));
    expect(toolBlockIds(active, "tool_use")).toEqual(sourceUses);
    expect(toolBlockIds(active, "tool_result")).toEqual(sourceResults);
  });

  test("a segment the summarizer skipped degrades to verbatim without loss or duplication", async () => {
    const sessionId = newSessionId();
    const sourceRows = toolFirstPlanRows();
    const plan = createPlan(sourceRows, 1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(2);

    // One segment index missing, exactly what parseSummaries returns for a
    // response the summarizer left a pair out of.
    const skipped = 1;
    const summaries = new Map(
      plan.summarizedTurns
        .map((_, index) => [index, `summary ${index}`] as const)
        .filter(([index]) => index !== skipped),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);

    // The skipped index contributes no summary row; every other segment does.
    expect(summaryTexts(rows)).toEqual([
      "an earlier summary",
      ...plan.summarizedTurns
        .map((_, index) => index)
        .filter(index => index !== skipped)
        .map(index => `summary ${index}`),
    ]);

    const uuids = rows.map(row => row.uuid);

    // The skipped segment's rows are carried through whole, once each: its
    // tool ids appear exactly as often as in the source, and its rows are not
    // replaced by a summary row.
    const skippedRows = plan.summarizedTurns[skipped]!.rows;
    for (const id of toolBlockIds(skippedRows, "tool_use")) {
      expect(toolBlockIds(rows, "tool_use").filter(x => x === id).length).toBe(
        1,
      );
    }
    expect(toolBlockIds(rows, "tool_use")).toEqual(
      toolBlockIds(sourceRows, "tool_use"),
    );
    expect(toolBlockIds(rows, "tool_result")).toEqual(
      toolBlockIds(sourceRows, "tool_result"),
    );

    expectToolPairsResumable(rows);

    const path = join(tmpdir(), `${sessionId}.jsonl`);
    transcriptPaths.push(path);
    await writeTranscriptEntries(path, rows);
    const active = await readActiveTranscriptRows(path);
    expect(active.map(row => row.uuid)).toEqual(uuids.slice(1));
  });

  // Parallel tool rows in every copy path: inside the oversized turn that
  // gets segmented (summarized, and verbatim when a segment is skipped), and
  // inside the preserved trailing turn.
  function parallelPlanRows(): TranscriptRow[] {
    return linkParallelSteps(
      chainRows([
        humanRow("h0", "the already-summarized question"),
        priorCompactionRow(),
        humanRow("h1", "the oversized question"),
        ...["p1", "p2", "p3", "p4"].flatMap(id =>
          makeParallelStep(id, { toolResultText: payload(0.7) }),
        ),
        humanRow("h2", "the preserved question"),
        ...makeParallelStep("p5"),
      ]),
    );
  }

  // Asserts the fixture actually forks: at least one parent uuid is shared
  // by two rows. The parallel tests are void without that property, and it
  // lives in row linkage, not in the uuid naming convention linkParallelSteps
  // matches on, so a fixture rename cannot silently turn the topology linear
  // while these tests stay green.
  function expectForkedTopology(rows: TranscriptRow[]): void {
    const childCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.parentUuid !== null) {
        childCounts.set(
          row.parentUuid,
          (childCounts.get(row.parentUuid) ?? 0) + 1,
        );
      }
    }
    expect([...childCounts.values()].some(count => count > 1)).toBe(true);
  }

  // The rows createPlan sees in production come from readActiveTranscriptRows,
  // not from raw file order: the reader walks the parent chain and re-inserts
  // a parallel step's off-chain branch after its on-chain sibling. Writing the
  // fixture out and reading it back hands the tests that exact ordering, with
  // a completeness check that the reader itself lost no tool rows.
  async function readSourceRows(
    fixtureRows: TranscriptRow[],
  ): Promise<TranscriptRow[]> {
    const path = join(tmpdir(), `source-${randomUUID()}.jsonl`);
    transcriptPaths.push(path);
    await writeTranscriptEntries(path, fixtureRows);
    const sourceRows = await readActiveTranscriptRows(path);
    expect([...toolBlockIds(sourceRows, "tool_use")].sort()).toEqual(
      [...toolBlockIds(fixtureRows, "tool_use")].sort(),
    );
    expect([...toolBlockIds(sourceRows, "tool_result")].sort()).toEqual(
      [...toolBlockIds(fixtureRows, "tool_result")].sort(),
    );
    return sourceRows;
  }

  // The reread is the real assertion: two source rows sharing a parent is
  // exactly what forks an emitted chain, and the reader follows one chain, so
  // a fork shows up here as rows that vanish.
  async function expectFullRoundTrip(
    sessionId: string,
    rows: TranscriptRow[],
    sourceRows: TranscriptRow[],
  ): Promise<void> {
    const uuids = rows.map(row => row.uuid);
    expectToolPairsResumable(rows);

    const path = join(tmpdir(), `${sessionId}.jsonl`);
    transcriptPaths.push(path);
    await writeTranscriptEntries(path, rows);
    const active = await readActiveTranscriptRows(path);
    expect(active.map(row => row.uuid)).toEqual(uuids.slice(1));
    expect(toolBlockIds(active, "tool_use")).toEqual(
      toolBlockIds(sourceRows, "tool_use"),
    );
    expect(toolBlockIds(active, "tool_result")).toEqual(
      toolBlockIds(sourceRows, "tool_result"),
    );
  }

  test("parallel tool rows survive summarized segments and the preserved turn", async () => {
    const sessionId = newSessionId();
    const fixtureRows = parallelPlanRows();
    expectForkedTopology(fixtureRows);
    const sourceRows = await readSourceRows(fixtureRows);
    const plan = createPlan(sourceRows, 1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(2);
    // The preserved turn carries a parallel step of its own, so copyTurnRows
    // is exercised on the shape too.
    expect(
      plan.preservedTurns[0]!.rows.some(row => row.uuid === "p5-sibling"),
    ).toBe(true);

    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);
    await expectFullRoundTrip(sessionId, rows, sourceRows);
  });

  test("parallel tool rows survive a segment degraded to verbatim", async () => {
    const sessionId = newSessionId();
    const fixtureRows = parallelPlanRows();
    expectForkedTopology(fixtureRows);
    const sourceRows = await readSourceRows(fixtureRows);
    const plan = createPlan(sourceRows, 1);

    const skipped = 1;
    const summaries = new Map(
      plan.summarizedTurns
        .map((_, index) => [index, `summary ${index}`] as const)
        .filter(([index]) => index !== skipped),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);
    // The skipped segment is the verbatim copy path, and it holds a parallel
    // step.
    expect(
      plan.summarizedTurns[skipped]!.rows.some(row =>
        row.uuid.endsWith("-sibling"),
      ),
    ).toBe(true);
    await expectFullRoundTrip(sessionId, rows, sourceRows);
  });

  // Asserts the emitted rows are a valid message sequence at the tool-pair
  // level: between a tool_use and its tool_result no assistant row of a
  // different message may appear, because the API rejects that sequence at
  // resume time as a tool_use without an immediately following tool_result.
  // A summary row landing inside a pair is exactly the shape that fails. An
  // unanswered tool_use (no tool_result anywhere in the emission) is checked
  // only against the shape segmentation could create: a summary row emitted
  // directly behind it. The guarantee is narrower than the API's: it checks
  // that no foreign assistant row sits inside a pair's span, not the
  // stricter rule that the tool_result must arrive in the immediately
  // following message.
  function expectToolPairsResumable(rows: TranscriptRow[]): void {
    const useIndex = new Map<string, number>();
    const resultIndex = new Map<string, number>();
    rows.forEach((row, index) => {
      const content = row.message?.["content"];
      if (!Array.isArray(content)) {
        return;
      }
      for (const block of content as Record<string, unknown>[]) {
        if (block["type"] === "tool_use" && typeof block["id"] === "string") {
          useIndex.set(block["id"], index);
        }
        if (
          block["type"] === "tool_result"
          && typeof block["tool_use_id"] === "string"
        ) {
          resultIndex.set(block["tool_use_id"], index);
        }
      }
    });
    expect(useIndex.size).toBeGreaterThan(0);
    for (const [id, use] of useIndex) {
      const result = resultIndex.get(id);
      if (result === undefined) {
        const next = rows[use + 1];
        if (next !== undefined && isSummaryRow(next)) {
          throw new Error(
            `Summary row ${next.uuid} sits directly behind unanswered tool_use ${id}.`,
          );
        }
        continue;
      }
      expect(result).toBeGreaterThan(use);
      const useMessageId = rows[use]!.message?.["id"];
      for (let index = use + 1; index < result; index++) {
        const row = rows[index]!;
        if (row.type === "assistant" && row.message?.["id"] !== useMessageId) {
          throw new Error(
            `Assistant row ${row.uuid} sits between tool_use ${id} and its tool_result.`,
          );
        }
      }
    }
  }

  test("a tool pair whose result arrives two assistant messages later is never split by a summary row", async () => {
    // Two whole assistant messages, each a cut candidate, sit between the
    // tool_use and its tool_result inside the oversized turn. The pair must
    // land in one segment: a cut through it would put the next segment's
    // summary row between the tool_use and the tool_result in the emitted
    // transcript, which resumes as an invalid message sequence.
    const sessionId = newSessionId();
    const sourceRows = fieldShapeRows(
      [
        makeStep("lead", { text: payload(0.6), toolName: "Bash" }),
        [
          makeRow("late-tooluse", "assistant", {
            id: "msg-late",
            role: "assistant",
            content: [
              { type: "text", text: payload(0.3) },
              { type: "tool_use", id: "tool-late", name: "Bash", input: {} },
            ],
          }),
          makeRow("mid1-text", "assistant", {
            id: "msg-mid1",
            role: "assistant",
            content: [{ type: "text", text: payload(0.6) }],
          }),
          makeRow("mid2-text", "assistant", {
            id: "msg-mid2",
            role: "assistant",
            content: [{ type: "text", text: payload(0.6) }],
          }),
          makeRow("late-toolresult", "user", {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-late",
                content: payload(0.3),
              },
            ],
          }),
        ],
        makeStep("tail", { text: payload(0.6), toolName: "Read" }),
      ],
      ["the preserved question"],
    );
    const plan = createPlan(sourceRows, 1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);
    const pairSegment = plan.summarizedTurns.find(segment =>
      segment.rows.some(row => row.uuid === "late-tooluse"),
    )!;
    expect(pairSegment.rows.some(row => row.uuid === "late-toolresult")).toBe(
      true,
    );

    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);
    expectToolPairsResumable(rows);
  });

  test("an unanswered tool_use is never followed directly by a summary row", async () => {
    // The orphan's step and the step after it share a segment: the cut
    // immediately behind an unanswered tool_use is refused, because it would
    // put the next segment's summary row directly behind the orphan, the
    // invalid sequence the API rejects at resume. An orphan that is a turn's
    // last row is a separate, unhandled shape: the next plan entry's rows
    // follow it regardless of segmentation.
    const sessionId = newSessionId();
    const sourceRows = fieldShapeRows(
      [
        [
          makeRow("dangle-text", "assistant", {
            id: "msg-dangle",
            role: "assistant",
            content: [{ type: "text", text: payload(0.6) }],
          }),
          makeRow("dangle-tooluse", "assistant", {
            id: "msg-dangle",
            role: "assistant",
            content: [
              { type: "tool_use", id: "tool-dangle", name: "Bash", input: {} },
            ],
          }),
        ],
        makeStep("b", { text: payload(0.6), toolName: "Read" }),
        makeStep("c", { text: payload(0.6), toolName: "Grep" }),
      ],
      ["the preserved question"],
    );
    const plan = createPlan(sourceRows, 1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(1);
    const orphanSegment = plan.summarizedTurns.find(segment =>
      segment.rows.some(row => row.uuid === "dangle-tooluse"),
    )!;
    expect(orphanSegment.rows.some(row => row.uuid === "b-text")).toBe(true);

    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);
    expectToolPairsResumable(rows);
  });

  test("a preserved continuation segment is copied verbatim and keeps its anchor", async () => {
    // The plan shape a lone oversized turn produces: the preserved entry is a
    // continuation segment, so it is both the tail buildCompactedRows copies
    // verbatim and the nextTurn anchor generateSummaries hands the template.
    const sessionId = newSessionId();
    const sourceRows = singleOversizedTurnRows();
    const plan = createPlan(sourceRows, 1);
    const preserved = plan.preservedTurns[0]!;
    expect(preserved.userRows).toEqual([]);
    expect(preserved.anchorOverride).toBeDefined();

    // The anchor resolves through the override rather than the missing user
    // rows, and carries real text for the parser to cross-check against.
    const anchor = getUserPromptText(preserved);
    expect(anchor).toMatch(/^\(continuation \d+\) \S/);
    expect(anchor.length).toBeGreaterThan("(continuation 1) ".length + 1);

    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);

    // The tail is the preserved segment's rows, message for message: a
    // preserved entry is never summarized or pruned, only re-identified.
    const tail = rows.slice(rows.length - preserved.rows.length);
    expect(tail.map(row => row.message)).toEqual(
      preserved.rows.map(row => row.message),
    );
    expect(tail.map(row => row.type)).toEqual(
      preserved.rows.map(row => row.type),
    );
    expect(tail.filter(isSummaryRow).length).toBe(0);

    expectToolPairsResumable(rows);

    // Resume-time proof: the preserved segment must still be there, verbatim,
    // after the destination is written and read back.
    const path = join(tmpdir(), `${sessionId}.jsonl`);
    transcriptPaths.push(path);
    await writeTranscriptEntries(path, rows);
    const active = await readActiveTranscriptRows(path);
    expect(active.map(row => row.uuid)).toEqual(
      rows.map(row => row.uuid).slice(1),
    );
    expect(
      active.slice(active.length - preserved.rows.length).map(row => row.message),
    ).toEqual(preserved.rows.map(row => row.message));
  });

  // Compacts a source transcript with --keep 1, writes the destination, and
  // returns the rows a resumed session would read back. This is the input the
  // next compaction plans against.
  async function compactAndReread(
    sessionId: string,
    sourceRows: TranscriptRow[],
  ): Promise<TranscriptRow[]> {
    const plan = createPlan(sourceRows, 1);
    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);
    const path = join(tmpdir(), `${sessionId}.jsonl`);
    transcriptPaths.push(path);
    await writeTranscriptEntries(path, rows);
    return await readActiveTranscriptRows(path);
  }

  // Further work with no human user row in it, which is what an unattended run
  // produces between boundaries. Each row is a separate assistant message, so
  // each opens its own step chunk.
  function autonomousRows(
    parentUuid: string,
    count: number,
  ): TranscriptRow[] {
    return Array.from({ length: count }, (_, index) => {
      const row = makeRow(`post${index}`, "assistant", {
        id: `msg-post${index}`,
        role: "assistant",
        content: [{ type: "text", text: payload(0.9) }],
      });
      row.parentUuid = index === 0 ? parentUuid : `post${index - 1}`;
      return row;
    });
  }

  test("a second compaction with no resume prompt has nothing to summarize", async () => {
    // A documented limitation, not an aspiration. compactionStartIndex is
    // turn-granular: every row a compaction emits, summary rows included,
    // lands inside the turn opened by the source's human user row, so on the
    // next pass that whole turn is prefix. A session that keeps running past
    // a boundary without a resume prompt therefore cannot compact again,
    // however much work it adds.
    const reread = await compactAndReread(
      newSessionId(),
      singleOversizedTurnRows(),
    );
    const rows = [...reread, ...autonomousRows(reread.at(-1)!.uuid, 4)];
    const plan = createPlan(rows, 1);

    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.summarizedTurns).toEqual([]);
    expect(plan.preservedTurns).toEqual([]);
  });

  test("a resume prompt makes a compacted session compactable again", async () => {
    // The property both target workflows rely on: the relay types a continue
    // prompt and chain mode pipes one through -p, and either delivers the
    // human user row that opens a fresh turn past the prefix. That turn is
    // the only compactable one, so the segment-granular keep applies and its
    // head is summarized.
    const reread = await compactAndReread(
      newSessionId(),
      singleOversizedTurnRows(),
    );
    const resumePrompt = humanRow("resume", "continue with the next section");
    resumePrompt.parentUuid = reread.at(-1)!.uuid;
    const rows = [
      ...reread,
      resumePrompt,
      ...autonomousRows("resume", 4),
    ];
    const plan = createPlan(rows, 1);

    expect(plan.prefixTurns.length).toBe(1);
    expect(plan.summarizedTurns.length).toBeGreaterThan(0);
    expect(plan.preservedTurns.length).toBe(1);

    // The new turn is what gets segmented; the compacted prefix is untouched.
    expect(getUserPromptText(plan.summarizedTurns[0]!)).toContain(
      "continue with the next section",
    );
    expect(
      [...plan.summarizedTurns, ...plan.preservedTurns].flatMap(
        turn => turn.rows,
      ),
    ).toEqual([resumePrompt, ...rows.slice(rows.length - 4)]);
  });

  test("prefix and preserved turns are copied whole around the segmented middle", async () => {
    const sessionId = newSessionId();
    const sourceRows = toolFirstPlanRows();
    const plan = createPlan(sourceRows, 1);
    const summaries = new Map(
      plan.summarizedTurns.map((_, index) => [index, `summary ${index}`]),
    );
    const rows = await buildCompactedRows(plan, summaries, sessionId);

    const countRowsWith = (slice: TranscriptRow[], text: string) =>
      slice.filter(row => JSON.stringify(row.message ?? {}).includes(text))
        .length;

    // The prefix turn's rows lead, whole: one emitted row per source row, none
    // replaced by a summary of this compaction's making.
    const prefixRowCount = plan.prefixTurns.flatMap((turn: Turn) => turn.rows)
      .length;
    const prefixSlice = rows.slice(1, 1 + prefixRowCount);
    expect(countRowsWith(prefixSlice, "the already-summarized question")).toBe(
      1,
    );
    expect(countRowsWith(prefixSlice, "an earlier summary")).toBe(1);

    // The preserved turn's rows trail every summary row, so the anchor
    // generateSummaries hands the summarizer as nextTurn still marks where
    // summarization stopped, and none of them is summarized.
    const preservedRowCount = plan.preservedTurns.flatMap(
      (turn: Turn) => turn.rows,
    ).length;
    const tail = rows.slice(rows.length - preservedRowCount);
    expect(countRowsWith(tail, "the preserved question")).toBe(1);
    expect(tail.filter(isSummaryRow).length).toBe(0);
    expect(rows.findLastIndex(isSummaryRow)).toBeLessThan(
      rows.length - preservedRowCount,
    );
  });
});

// The tripwire behind every emission path: buildCompactedRows constructs
// chains that satisfy it by construction today, so only direct fixtures can
// prove the guard actually fires when a future change breaks that.
describe("assertSingleParentChain", () => {
  function bareRow(uuid: string, parentUuid: string | null): TranscriptRow {
    return makeRow(
      uuid,
      "assistant",
      { id: `msg-${uuid}`, role: "assistant", content: [] },
      { parentUuid },
    );
  }

  test("an unbroken chain of distinct rows passes", () => {
    const rows = [bareRow("a", null), bareRow("b", "a"), bareRow("c", "b")];
    expect(() => assertSingleParentChain(rows)).not.toThrow();
    expect(() => assertSingleParentChain([])).not.toThrow();
  });

  test("a fork throws: two rows sharing one parent", () => {
    const rows = [bareRow("a", null), bareRow("b", "a"), bareRow("c", "a")];
    expect(() => assertSingleParentChain(rows)).toThrow(
      /chain is broken at row 2/,
    );
  });

  test("a non-null root parent throws", () => {
    const rows = [bareRow("a", "elsewhere"), bareRow("b", "a")];
    expect(() => assertSingleParentChain(rows)).toThrow(
      /row 0 .* has parent elsewhere/,
    );
  });

  test("a duplicated uuid throws even on a well-linked chain", () => {
    // Chain-valid linkage with a repeated uuid: every parent matches its
    // predecessor, so only the uniqueness check can catch it.
    const rows = [bareRow("a", null), bareRow("b", "a"), bareRow("a", "b")];
    expect(() => assertSingleParentChain(rows)).toThrow(
      /uuid a appears more than once/,
    );
  });
});
