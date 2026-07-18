// Pins the segment splitter contract: under-budget turns pass through by
// object identity, oversized turns split only before an assistant row that
// opens a new step, a tool_use/tool_result pair stays together even when
// keeping it overshoots the budget (enforced via unresolved tool_use ids,
// including id-less and recovered-parallel row shapes), concatenated
// segment rows reproduce the original turn's rows exactly, and continuation
// segments carry empty userRows plus deterministic, nonempty anchor
// overrides that never agree with each other under the parser's
// anchorsAgree cross-check, across every turn in one splitter call.
// Run: bun test tools/engine-tests/
import { describe, expect, test } from "bun:test";
import {
  anchorsAgree,
  getUserPromptText,
} from "../../plugins/claude-kit/skills/compact-session/engine/compact";
import {
  SEGMENT_TOKEN_BUDGET,
  splitOversizedTurns,
  type TranscriptRow,
  type Turn,
} from "../../plugins/claude-kit/skills/compact-session/engine/transcript";

// Payload sized to a fraction of the budget in estimated tokens (chars/4
// over serialized message content), so fixtures read as budget math rather
// than magic character counts.
function payload(budgetFraction: number): string {
  return "x".repeat(Math.round(SEGMENT_TOKEN_BUDGET * 4 * budgetFraction));
}

// Mirrors the splitter's estimate: chars/4 over each row's model-visible
// content (a message's content blocks, or an attachment row's payload),
// envelope fields excluded.
function estimatedTokens(rows: TranscriptRow[]): number {
  return (
    rows.reduce(
      (sum, row) =>
        sum
        + JSON.stringify(row.message?.["content"] ?? row["attachment"] ?? "")
          .length,
      0,
    ) / 4
  );
}

type StepOptions = {
  text?: string | null;
  toolName?: string;
  toolResultText?: string;
};

function makeRow(
  uuid: string,
  type: TranscriptRow["type"],
  message: Record<string, unknown>,
): TranscriptRow {
  return {
    type,
    uuid,
    parentUuid: null,
    sessionId: "src",
    timestamp: "2026-01-01T00:00:00.000Z",
    message,
  };
}

// One assistant step: a text row, optionally followed by a tool_use row of
// the same assistant message and its tool_result row. text: null makes a
// tool-only step.
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
          { type: "tool_use", id: `tool-${id}`, name: options.toolName, input: {} },
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

function makeTurn(
  steps: TranscriptRow[][],
  promptText = "the opening question",
): Turn {
  const userRow = makeRow("turn-user", "user", {
    id: "msg-user",
    role: "user",
    content: promptText,
  });
  const rows = [userRow, ...steps.flat()];
  let parent: string | null = null;
  for (const row of rows) {
    row.parentUuid = parent;
    parent = row.uuid;
  }
  return { userRows: [userRow], rows };
}

// Maps each tool_use id (or tool_result tool_use_id) to the index of the
// segment whose rows carry it.
function toolBlockSegments(
  segments: Turn[],
  blockType: "tool_use" | "tool_result",
): Map<string, number> {
  const idKey = blockType === "tool_use" ? "id" : "tool_use_id";
  const locations = new Map<string, number>();
  segments.forEach((segment, segmentIndex) => {
    for (const row of segment.rows) {
      const content = row.message?.["content"];
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content as Record<string, unknown>[]) {
        if (block["type"] === blockType && typeof block[idKey] === "string") {
          locations.set(block[idKey] as string, segmentIndex);
        }
      }
    }
  });
  return locations;
}

function expectToolPairsCohere(segments: Turn[]): void {
  const uses = toolBlockSegments(segments, "tool_use");
  const results = toolBlockSegments(segments, "tool_result");
  expect(uses.size).toBeGreaterThan(0);
  for (const [id, useSegment] of uses) {
    expect(results.get(id)).toBe(useSegment);
  }
}

describe("splitOversizedTurns", () => {
  test("a turn under budget passes through as the identical object", () => {
    const turn = makeTurn([makeStep("a", { toolName: "Bash" }), makeStep("b")]);
    const result = splitOversizedTurns([turn]);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(turn);
  });

  test("an oversized turn splits before step-opening assistant rows and reassembles exactly", () => {
    const turn = makeTurn([
      makeStep("a", { text: payload(0.6), toolName: "Bash" }),
      makeStep("b", { text: payload(0.6) }),
      makeStep("c", { text: payload(0.6), toolName: "Read" }),
    ]);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBeGreaterThan(1);

    // The non-negotiable check: concatenated segment rows are the original
    // rows by object identity and order; no loss, no reorder, no duplication.
    const reassembled = segments.flatMap(segment => segment.rows);
    expect(reassembled.length).toBe(turn.rows.length);
    for (let i = 0; i < reassembled.length; i++) {
      expect(reassembled[i]).toBe(turn.rows[i]!);
    }

    // Every cut lands before an assistant row; every segment contains one.
    for (const segment of segments.slice(1)) {
      expect(segment.rows[0]!.type).toBe("assistant");
    }
    for (const segment of segments) {
      expect(segment.rows.some(row => row.type === "assistant")).toBe(true);
    }

    // Only the first segment keeps the turn's user rows.
    expect(segments[0]!.userRows).toEqual(turn.userRows);
    for (const segment of segments.slice(1)) {
      expect(segment.userRows).toEqual([]);
    }
  });

  test("a tool pair straddling the budget line stays together even when that overshoots", () => {
    const pairStep = makeStep("pair", {
      text: payload(0.5),
      toolName: "Bash",
      toolResultText: payload(0.8),
    });
    const turn = makeTurn([makeStep("lead", { text: payload(0.6) }), pairStep]);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBe(2);

    const pairSegment = segments.find(segment =>
      segment.rows.some(row => row.uuid === "pair-tooluse"),
    )!;
    expect(pairSegment.rows.some(row => row.uuid === "pair-toolresult")).toBe(
      true,
    );
    // The pair's segment overshoots the budget rather than splitting the pair.
    expect(estimatedTokens(pairSegment.rows)).toBeGreaterThan(
      SEGMENT_TOKEN_BUDGET,
    );
  });

  test("a tool pair stays together when its tool_result arrives after the next assistant message", () => {
    // The unresolved tool_use is what holds the chunk open here: the row
    // after the tool_use is a new assistant message (a cut point on its
    // own), and only the pending tool_use id forbids cutting before it.
    const rows = [
      ...makeStep("lead", { text: payload(0.6) }),
      makeRow("idless-tooluse", "assistant", {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-late", name: "Bash", input: {} },
          { type: "text", text: payload(0.3) },
        ],
      }),
      makeRow("next-text", "assistant", {
        id: "msg-next",
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
    ];
    const segments = splitOversizedTurns([makeTurn([rows])]);
    expect(segments.length).toBe(2);
    expectToolPairsCohere(segments);
  });

  test("tool pairs cohere when assistant rows carry no message id", () => {
    const rows = [
      makeRow("id1-text", "assistant", {
        role: "assistant",
        content: [{ type: "text", text: payload(0.6) }],
      }),
      makeRow("id1-tooluse", "assistant", {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-x", name: "Bash", input: {} }],
      }),
      makeRow("id1-toolresult", "user", {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-x", content: payload(0.3) },
        ],
      }),
      makeRow("id2-text", "assistant", {
        role: "assistant",
        content: [{ type: "text", text: payload(0.6) }],
      }),
      makeRow("id2-tooluse", "assistant", {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-y", name: "Read", input: {} }],
      }),
      makeRow("id2-toolresult", "user", {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-y", content: payload(0.6) },
        ],
      }),
    ];
    const segments = splitOversizedTurns([makeTurn([rows])]);
    expect(segments.length).toBe(2);
    expectToolPairsCohere(segments);
  });

  test("tool pairs cohere across the recovered-parallel row ordering", () => {
    // The shape recoverParallelToolRows produces: the anchor assistant row,
    // then its recovered sibling assistant rows (same message id), then the
    // recovered tool_results, then the next assistant message.
    const rows = [
      makeRow("par-anchor", "assistant", {
        id: "msg-par",
        role: "assistant",
        content: [
          { type: "text", text: payload(0.5) },
          { type: "tool_use", id: "tool-p1", name: "Bash", input: {} },
        ],
      }),
      makeRow("par-sibling", "assistant", {
        id: "msg-par",
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-p2", name: "Read", input: {} }],
      }),
      makeRow("par-result1", "user", {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-p1", content: payload(0.4) },
        ],
      }),
      makeRow("par-result2", "user", {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-p2", content: payload(0.4) },
        ],
      }),
      makeRow("after-text", "assistant", {
        id: "msg-after",
        role: "assistant",
        content: [{ type: "text", text: payload(0.7) }],
      }),
    ];
    const segments = splitOversizedTurns([makeTurn([rows])]);
    expect(segments.length).toBe(2);
    expectToolPairsCohere(segments);
  });

  test("a chunk that would overflow flushes the open segment first; an oversized chunk stands alone", () => {
    const hugeStep = makeStep("huge", { text: payload(2) });
    const turn = makeTurn([
      makeStep("lead", { text: payload(0.6) }),
      hugeStep,
      makeStep("tail", { text: payload(0.6) }),
    ]);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBe(3);
    // The lead segment flushed before the huge chunk was added, so it stays
    // under budget instead of absorbing the overflow.
    expect(estimatedTokens(segments[0]!.rows)).toBeLessThanOrEqual(
      SEGMENT_TOKEN_BUDGET,
    );
    expect(segments[1]!.rows.length).toBe(1);
    expect(segments[1]!.rows[0]).toBe(hugeStep[0]!);
    expect(estimatedTokens(segments[1]!.rows)).toBeGreaterThan(
      SEGMENT_TOKEN_BUDGET,
    );
  });

  test("attachment rows count toward the budget", () => {
    // Attachment rows carry their payload outside message, and real ones run
    // to tens of kilobytes. Scoring them zero would leave a turn made almost
    // entirely of attachments measuring as free and passing through unsplit.
    const steps = ["a", "b", "c", "d"].map(id => {
      const attachment: TranscriptRow = {
        type: "attachment",
        uuid: `${id}-attachment`,
        parentUuid: null,
        sessionId: "src",
        timestamp: "2026-01-01T00:00:00.000Z",
        attachment: { type: "deferred_tools_delta", addedLines: payload(0.35) },
      };
      return [...makeStep(id, { text: "tiny" }), attachment];
    });
    const turn = makeTurn(steps);

    expect(estimatedTokens(turn.rows)).toBeGreaterThan(SEGMENT_TOKEN_BUDGET);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.flatMap(segment => segment.rows)).toEqual(turn.rows);
  });

  test("continuation anchors are deterministic, unique in the 40-char window, and normalized", () => {
    // Steps b and c carry byte-identical text, so only the numbered prefix
    // can discriminate their anchors, which is exactly what the parser's
    // 40-char anchor comparison depends on.
    const sharedText = `<shared opener> ${payload(0.6)}`;
    const buildTurn = () =>
      makeTurn([
        makeStep("a", { text: payload(0.6) }),
        makeStep("b", { text: sharedText }),
        makeStep("c", { text: sharedText }),
      ]);

    // Determinism over structurally equal but distinct inputs.
    const first = splitOversizedTurns([buildTurn()]);
    const second = splitOversizedTurns([buildTurn()]);
    expect(second).toEqual(first);
    expect(first.length).toBe(3);

    const anchors = first.map(getUserPromptText);
    expect(new Set(anchors.map(anchor => anchor.slice(0, 40))).size).toBe(
      anchors.length,
    );
    for (const segment of first.slice(1)) {
      const anchor = getUserPromptText(segment);
      expect(anchor).toMatch(/^\(continuation \d+\) /);
      expect(anchor).not.toContain("<");
      expect(anchor).not.toContain(">");
      expect(anchor.endsWith("...")).toBe(true);
      expect(anchor.length).toBeLessThanOrEqual(304);
    }
  });

  test("continuation anchors from different turns never agree under the parser's cross-check", () => {
    // Two oversized turns whose continuation segments open with identical
    // text: only cross-turn continuation numbering keeps their anchors
    // apart, and anchorsAgree (prefix in either direction after stripping a
    // trailing ellipsis) is the predicate the parser actually runs.
    const sharedText = `same opener ${payload(0.6)}`;
    const turnA = makeTurn(
      [
        makeStep("a1", { text: sharedText }),
        makeStep("a2", { text: sharedText }),
        makeStep("a3", { text: sharedText }),
      ],
      "first question",
    );
    const turnB = makeTurn(
      [
        makeStep("b1", { text: sharedText }),
        makeStep("b2", { text: sharedText }),
        makeStep("b3", { text: sharedText }),
      ],
      "second question",
    );
    const segments = splitOversizedTurns([turnA, turnB]);
    expect(segments.length).toBe(6);

    const anchors = segments.map(getUserPromptText);
    for (let i = 0; i < anchors.length; i++) {
      for (let j = 0; j < anchors.length; j++) {
        if (i !== j) {
          expect(anchorsAgree(anchors[i]!, anchors[j]!)).toBe(false);
        }
      }
    }
  });

  test("a string-content assistant row contributes its text to the continuation anchor", () => {
    const stringRow = makeRow("str-text", "assistant", {
      id: "msg-str",
      role: "assistant",
      content: `string opener ${payload(0.5)}`,
    });
    const turn = makeTurn([
      makeStep("lead", { text: payload(0.8) }),
      [stringRow],
    ]);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBe(2);
    expect(getUserPromptText(segments[1]!)).toMatch(
      /^\(continuation \d+\) string opener x/,
    );
  });

  test("a segment with neither text nor tool_use still gets a nonempty distinct anchor", () => {
    const makeThinkingStep = (id: string): TranscriptRow[] => [
      makeRow(`${id}-think`, "assistant", {
        id: `msg-${id}`,
        role: "assistant",
        content: [{ type: "thinking", thinking: payload(0.6) }],
      }),
    ];
    const turn = makeTurn([
      makeStep("lead", { text: payload(0.8) }),
      makeThinkingStep("t1"),
      makeThinkingStep("t2"),
    ]);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBe(3);

    const anchor1 = getUserPromptText(segments[1]!);
    const anchor2 = getUserPromptText(segments[2]!);
    // A nonempty snippet always follows the numbered prefix; a bare
    // "(continuation N)" anchor would prefix-agree with every anchor
    // sharing its number.
    expect(anchor1).toMatch(/^\(continuation \d+\) .+/);
    expect(anchor2).toMatch(/^\(continuation \d+\) .+/);
    expect(anchorsAgree(anchor1, anchor2)).toBe(false);
  });

  test("a tool-only continuation segment anchors on its tool names", () => {
    const turn = makeTurn([
      makeStep("lead", { text: payload(0.8) }),
      makeStep("tools", {
        text: null,
        toolName: "Bash",
        toolResultText: payload(0.5),
      }),
    ]);
    const segments = splitOversizedTurns([turn]);
    expect(segments.length).toBe(2);
    expect(getUserPromptText(segments[1]!)).toMatch(
      /^\(continuation 1\) \(tool activity: Bash\)/,
    );
  });
});

describe("getUserPromptText anchor override", () => {
  test("an anchorOverride is returned through the standard normalization", () => {
    const turn: Turn = {
      userRows: [],
      rows: [],
      anchorOverride: "  (continuation 1)   <tag> spaced   text  ",
    };
    expect(getUserPromptText(turn)).toBe("(continuation 1) tag spaced text\n...");
  });

  test("a long override is truncated like user text", () => {
    const turn: Turn = {
      userRows: [],
      rows: [],
      anchorOverride: "y".repeat(1000),
    };
    const anchor = getUserPromptText(turn);
    expect(anchor.length).toBeLessThanOrEqual(304);
    expect(anchor.endsWith("...")).toBe(true);
  });

  test("a turn without an override still derives its anchor from user rows", () => {
    const row: TranscriptRow = {
      type: "user",
      uuid: "u",
      parentUuid: null,
      sessionId: "s",
      timestamp: "t",
      message: { role: "user", content: "plain question" },
    };
    expect(getUserPromptText({ userRows: [row], rows: [row] })).toBe(
      "plain question\n...",
    );
  });
});
