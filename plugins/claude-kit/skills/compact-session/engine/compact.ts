import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { loadOmissionCache, saveOmissionCache } from "./omission";
import { pruneTranscriptRow } from "./prune";
import {
  buildAssistantTurns,
  copyTranscriptToNewSession,
  isRecord,
  readActiveTranscriptRows,
  readPreservedMetadataEntries,
  type Turn,
  type TranscriptRow,
  writeTranscriptEntries,
} from "./transcript";

export type Plan = {
  prefixTurns: Turn[];
  summarizedTurns: Turn[];
  preservedTurns: Turn[];
  baseRow: TranscriptRow;
};

// The summarizer runs headless; an unpinned spawn inherits the harness default
// model, which can be an API-billed tier. Callers may override per invocation.
const DEFAULT_SUMMARIZER_MODEL = "claude-sonnet-5";

// Hooks are disabled for the summarizer spawn: a Stop hook can extend the turn
// past the XML output and poison parseSummaries. Because hooks are off and the
// resumed transcript contains untrusted tool output, the summarizer's tool
// surface is denied outright; summarization needs no tools, and a poisoned row
// must not be able to drive allowlisted ones.
const SUMMARIZER_SETTINGS = JSON.stringify({
  disableAllHooks: true,
  permissions: {
    deny: [
      "Bash",
      "Write",
      "Edit",
      "NotebookEdit",
      "WebFetch",
      "WebSearch",
      "Agent",
    ],
  },
});

// Summarization time scales with the resumed context: a ~925k-token
// transcript measures ~250s end to end, so the ceiling sits well above the
// 1M context window's worst case. A spawn killed at this timeout produces
// empty stdout and stderr, which the error message below names explicitly.
const SUMMARIZER_TIMEOUT_MS = 600_000;

const RETRIEVE_SCRIPT_PATH = `${import.meta.dir}/retrieve.ts`;

const POST_COMPACTION_NOTICE = `<post-compaction-notice>
A compaction operation has just been applied to all messages above. You may have to reread certain files to regain context. Certain historical tool input/output may have been omitted due to length. If the exact I/O of an omitted tool call needs to be retrieved and cannot be replicated via a new tool call, run the following in Bash with the Content ID from the omission notice:

bun "${RETRIEVE_SCRIPT_PATH}" <Content ID>
</post-compaction-notice>`;

export async function compactTranscript(
  sourceTranscriptPath: string,
  destinationTranscriptPath: string,
  sessionId: string,
  keepTurns: number,
  summarizerModel: string = DEFAULT_SUMMARIZER_MODEL,
): Promise<boolean> {
  const rows = await readActiveTranscriptRows(sourceTranscriptPath);
  const plan = createPlan(rows, keepTurns);
  if (plan.summarizedTurns.length === 0) {
    return false;
  }

  const summaries = await generateSummaries(
    sourceTranscriptPath,
    plan.summarizedTurns,
    plan.preservedTurns[0] ?? null,
    summarizerModel,
  );
  const missing = plan.summarizedTurns
    .map((_, index) => index)
    .filter(index => !summaries.has(index));
  if (missing.length > 0) {
    process.stderr.write(
      `Warning: the summarizer skipped ${missing.length} of ${plan.summarizedTurns.length} turns ` +
        `(1-based: ${missing.map(index => index + 1).join(", ")}); those turns are preserved verbatim ` +
        `instead of summarized. Nothing is lost, but a verbatim turn that lands before this compaction's ` +
        `summary rows is never re-summarized by a later compaction, so the lost compression is permanent ` +
        `for those turns.\n`,
    );
  }
  const compactedRows = await buildCompactedRows(plan, summaries, sessionId);
  const metadataEntries = await readPreservedMetadataEntries(
    sourceTranscriptPath,
    plan.baseRow.sessionId,
    sessionId,
  );
  await writeTranscriptEntries(destinationTranscriptPath, [
    ...metadataEntries,
    ...compactedRows,
  ]);
  return true;
}

function createPlan(rows: TranscriptRow[], keepTurns: number): Plan {
  const baseRow = rows.find(
    row => row.type === "user" || row.type === "assistant",
  );
  if (!baseRow) {
    throw new Error(
      "Transcript does not contain compactable conversation rows.",
    );
  }

  const turns = buildAssistantTurns(rows);
  const compactionStartIndex =
    turns.findLastIndex(turn => turn.rows.some(isMagicCompactSummaryRow)) + 1;
  const compactionEndIndex =
    keepTurns <= 0
      ? turns.length
      : Math.max(compactionStartIndex, turns.length - keepTurns);

  return {
    prefixTurns: turns.slice(0, compactionStartIndex),
    summarizedTurns: turns.slice(compactionStartIndex, compactionEndIndex),
    preservedTurns: turns.slice(compactionEndIndex),
    baseRow,
  };
}

async function generateSummaries(
  transcriptPath: string,
  turns: Turn[],
  nextTurn: Turn | null,
  summarizerModel: string,
): Promise<Map<number, string>> {
  const analysis = await copyTranscriptToNewSession(transcriptPath);
  const prompt = buildCompactionPrompt(turns, nextTurn);

  // The spawn's environment drops ANTHROPIC_API_KEY: the CLI treats an
  // inherited key as its auth source, which disables the claude.ai login and
  // fails (or API-bills) the summarizer. Scrubbing it makes the summarizer
  // authenticate like an interactive session and bill to the subscription.
  // Consequence: a machine whose only auth is an API key cannot summarize.
  const summarizerEnv: Record<string, string | undefined> = {
    ...process.env,
  };
  delete summarizerEnv.ANTHROPIC_API_KEY;

  try {
    // Resume by session ID: the CLI's --resume accepts a session ID or search
    // term, not a file path. The analysis copy sits in the active project
    // directory named by its session ID, so ID resolution finds it.
    // "claude" must resolve to a native executable; a .cmd shim would route
    // this argv (which carries transcript-derived prompt text) through
    // cmd.exe's parser and reopen metacharacter injection.
    const spawnStartedAt = Date.now();
    const summaryProcess = Bun.spawn(
      [
        "claude",
        "-p",
        "--resume",
        analysis.sessionId,
        "--model",
        summarizerModel,
        "--settings",
        SUMMARIZER_SETTINGS,
        prompt,
      ],
      {
        env: summarizerEnv,
        stdout: "pipe",
        stderr: "pipe",
        timeout: SUMMARIZER_TIMEOUT_MS,
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(summaryProcess.stdout).text(),
      new Response(summaryProcess.stderr).text(),
      summaryProcess.exited,
    ]);

    if (exitCode !== 0) {
      // The CLI reports some failures (notably "Not logged in") on stdout
      // with an empty stderr; surface whichever stream carries the reason.
      // Both streams derive from the untrusted transcript, so control
      // sequences are stripped and the tail is capped before the text reaches
      // a terminal or an orchestrating agent's error handling. A spawn killed
      // at the timeout produces no output at all; name that case rather than
      // raising an empty reason.
      const elapsedSeconds = Math.round((Date.now() - spawnStartedAt) / 1000);
      const reason =
        sanitizeSpawnOutput(stderr)
        || sanitizeSpawnOutput(stdout)
        || (elapsedSeconds >= Math.floor(SUMMARIZER_TIMEOUT_MS / 1000)
          ? `no output; killed at the ${Math.floor(SUMMARIZER_TIMEOUT_MS / 1000)}s summarizer timeout`
          : "no output");
      throw new Error(
        `Summary generation failed (exit ${exitCode} after ${elapsedSeconds}s): ${reason}`,
      );
    }

    return parseSummaries(stdout, turns.length, turns.map(getUserPromptText));
  } finally {
    await unlink(analysis.transcriptPath).catch(() => undefined);
  }
}

// Strips ANSI escape and other control sequences (newlines kept) and caps the
// tail at 500 characters, so untrusted spawn output cannot steer a terminal
// or flood an error message.
function sanitizeSpawnOutput(text: string): string {
  return text
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .trim()
    .slice(-500);
}

export async function buildCompactedRows(
  plan: Plan,
  summaries: Map<number, string>,
  sessionId: string,
): Promise<TranscriptRow[]> {
  const rows: TranscriptRow[] = [];
  const copiedUuids = new Map<string, string>();
  const completedToolUseIds = collectCompletedToolUseIds(plan.summarizedTurns);
  const toolNamesById = collectToolNamesById(plan.summarizedTurns);
  const omissionCache = await loadOmissionCache(sessionId);
  const timestamp = new Date().toISOString();
  const lastOriginalRow = sourceTurns(plan)
    .flatMap(turn => turn.rows)
    .at(-1);
  if (!lastOriginalRow) {
    throw new Error("Compaction plan has no source rows.");
  }

  const boundaryUuid = randomUUID();
  rows.push({
    ...copySessionFields(plan.baseRow, sessionId, timestamp),
    type: "user",
    uuid: boundaryUuid,
    parentUuid: null,
    isMeta: true,
    message: {
      id: `msg_${randomUUID()}`,
      role: "user",
      content: POST_COMPACTION_NOTICE,
    },
    logicalParentUuid: lastOriginalRow.uuid,
    magicCompact: {
      boundary: true,
    },
  });
  let parentUuid: string | null = boundaryUuid;

  for (const turn of plan.prefixTurns) {
    parentUuid = copyTurnRows(
      turn,
      rows,
      copiedUuids,
      sessionId,
      timestamp,
      parentUuid,
    );
  }

  for (const [index, turn] of plan.summarizedTurns.entries()) {
    // A turn the summarizer skipped is preserved verbatim, whole rows, the
    // same copy path preservedTurns take: compression is lost for that one
    // turn, content is not. parseSummaries has already enforced the
    // too-many-missing ceiling. Checked before the userRows copy below, which
    // copyTurnRows would otherwise duplicate.
    const summary = summaries.get(index);
    if (summary === undefined) {
      parentUuid = copyTurnRows(
        turn,
        rows,
        copiedUuids,
        sessionId,
        timestamp,
        parentUuid,
      );
      continue;
    }

    for (const row of turn.userRows) {
      const copied = copyRow(row, sessionId, timestamp, parentUuid);
      copiedUuids.set(row.uuid, copied.uuid);
      rows.push(copied);
      parentUuid = copied.uuid;
    }

    const firstAssistant = turn.rows.find(row => row.type === "assistant");
    if (!firstAssistant) {
      throw new Error("Turn missing assistant row for summary shape.");
    }

    const copied = createAssistantSummaryRow(
      firstAssistant,
      sessionId,
      timestamp,
      parentUuid,
      summary,
    );
    copiedUuids.set(firstAssistant.uuid, copied.uuid);
    rows.push(copied);
    parentUuid = copied.uuid;

    for (const row of turn.rows) {
      if (turn.userRows.includes(row) || !isToolRow(row)) {
        continue;
      }

      const copiedToolRow = copyRow(
        row,
        sessionId,
        timestamp,
        row.parentUuid
          ? (copiedUuids.get(row.parentUuid) ?? parentUuid)
          : parentUuid,
      );
      keepOnlyToolBlocks(copiedToolRow);
      pruneTranscriptRow(copiedToolRow, {
        cache: omissionCache,
        sessionId,
        completedToolUseIds,
        toolNamesById,
      });
      copiedUuids.set(row.uuid, copiedToolRow.uuid);
      rows.push(copiedToolRow);
      parentUuid = copiedToolRow.uuid;
    }
  }

  for (const turn of plan.preservedTurns) {
    parentUuid = copyTurnRows(
      turn,
      rows,
      copiedUuids,
      sessionId,
      timestamp,
      parentUuid,
    );
  }

  await saveOmissionCache(sessionId, omissionCache);
  return rows;
}

function copyTurnRows(
  turn: Turn,
  rows: TranscriptRow[],
  copiedUuids: Map<string, string>,
  sessionId: string,
  timestamp: string,
  initialParentUuid: string | null,
): string | null {
  let parentUuid = initialParentUuid;
  for (const row of turn.rows) {
    const copied = copyRow(
      row,
      sessionId,
      timestamp,
      row.parentUuid
        ? (copiedUuids.get(row.parentUuid) ?? parentUuid)
        : parentUuid,
    );
    copiedUuids.set(row.uuid, copied.uuid);
    rows.push(copied);
    parentUuid = copied.uuid;
  }
  return parentUuid;
}

function copyRow(
  row: TranscriptRow,
  sessionId: string,
  timestamp: string,
  parentUuid: string | null,
): TranscriptRow {
  const copied = structuredClone(row) as TranscriptRow;
  copied.uuid = randomUUID();
  copied.parentUuid = parentUuid;
  copied.sessionId = sessionId;
  copied.timestamp = timestamp;
  return copied;
}

function collectCompletedToolUseIds(turns: Turn[]): Set<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    for (const row of turn.rows) {
      if (!isRecord(row.message)) {
        continue;
      }
      const content = row.message["content"];
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content) {
        if (
          isRecord(block)
          && block["type"] === "tool_result"
          && block["is_error"] !== true
          && typeof block["tool_use_id"] === "string"
        ) {
          ids.add(block["tool_use_id"]);
        }
      }
    }
  }
  return ids;
}

function collectToolNamesById(turns: Turn[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const turn of turns) {
    for (const row of turn.rows) {
      if (!isRecord(row.message)) {
        continue;
      }
      const content = row.message["content"];
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content) {
        if (
          isRecord(block)
          && block["type"] === "tool_use"
          && typeof block["id"] === "string"
          && typeof block["name"] === "string"
        ) {
          names.set(block["id"], block["name"]);
        }
      }
    }
  }
  return names;
}

function isToolRow(row: TranscriptRow): boolean {
  if (!isRecord(row.message)) {
    return false;
  }

  const content = row.message["content"];
  return (
    Array.isArray(content)
    && content.some(
      block =>
        isRecord(block)
        && (block["type"] === "tool_use" || block["type"] === "tool_result"),
    )
  );
}

function keepOnlyToolBlocks(row: TranscriptRow): void {
  if (!isRecord(row.message)) {
    return;
  }

  const content = row.message["content"];
  if (!Array.isArray(content)) {
    return;
  }

  row.message["content"] = content.filter(
    block =>
      isRecord(block)
      && (block["type"] === "tool_use" || block["type"] === "tool_result"),
  );
}

function isMagicCompactSummaryRow(row: TranscriptRow): boolean {
  const magicCompact = row["magicCompact"];
  return isRecord(magicCompact) && magicCompact["summary"] === true;
}

function sourceTurns(plan: Plan): Turn[] {
  return [...plan.prefixTurns, ...plan.summarizedTurns, ...plan.preservedTurns];
}

function createAssistantSummaryRow(
  source: TranscriptRow,
  sessionId: string,
  timestamp: string,
  parentUuid: string | null,
  summary: string,
): TranscriptRow {
  const copied = structuredClone(source) as TranscriptRow;
  copied.uuid = randomUUID();
  copied.parentUuid = parentUuid;
  copied.sessionId = sessionId;
  copied.timestamp = timestamp;
  copied.message = {
    ...source.message,
    id: `msg_${randomUUID()}`,
    role: "assistant",
    content: [{ type: "text", text: summary }],
    stop_reason: "end_turn",
    stop_sequence: null,
  };
  copied["magicCompact"] = { summary: true };
  return copied;
}

function copySessionFields(
  row: TranscriptRow,
  sessionId: string,
  timestamp: string,
): TranscriptRow {
  const copied = structuredClone(row) as TranscriptRow;
  copied.sessionId = sessionId;
  copied.timestamp = timestamp;
  copied.isSidechain = false;
  delete copied.message;
  return copied;
}

function buildCompactionPrompt(turns: Turn[], nextTurn: Turn | null): string {
  return `<system>
# Attention: Conversation Compaction Required

The current conversation is reaching the maximum allowed conversation size. In order to continue, earlier unsummarized parts of the conversation must be summarized.

## Next Task

In order to continue, a subset of earlier non-compacted **assistant turns** of this conversation must be summarized. An assistant turn encompasses all messages (including tool calls and results) sent by an assistant between one user request and the next user request.

Next task: Summarize the conversation by **outputting exactly the XML structure shown below** but with all assistant turns summarized. Replace all placeholder text with your summary of the turn. **Your response should start with the <summary> tag and end with the closing </summary> tag.**

${buildXmlTemplate(turns, nextTurn)}

## Output Guidelines:

- **Output the truncated text within the <user> </user> tags exactly** according to the XML template above
  - User prompts are intentionally truncated to a short snippet for brevity.
  - Therefore, only output THE SNIPPET SHOWN. DO NOT OUTPUT the entire user prompt.
- **Echo every index attribute exactly as given**: each <user index="N"> and <assistant index="N"> pair in the template must appear in your output with the same index. Never renumber, merge, or skip an index; if two adjacent user snippets look similar, they are still separate turns and each keeps its own indexed pair.
- Output your summary for assistant turns within the <assistant> </assistant> tags
  - You are **only responsible** for summarizing the specific assistant turns specified within the XML structure
  - Do not summarize any other assistant turns not specified in the XML template above.
- Do not think. Do not call any tools. Output the summary ONLY.
- **Follow the template.** Your response should start with the <summary> tag and end with the closing </summary> tag.

## Summarization Guidelines:

- Summarize everything between one user message and the next
- Keep your summaries short and direct
  - Try to keep your summaries under 200 words whenever possible
  - You may go over 200 words to preserve summary quality if the assistant turn was genuinely long
- In your summary, include:
  - Relevant decisions and thought process, including plans if any was presented
  - Very brief bullet point summary of your workflow
  - Final results and summarized output to the user
- All tool calls are preserved and automatically included with your summary
  - Therefore, you **do not need to restate details about what tools you used or with what arguments**
- Do not mention this summarization process; your summaries should naturally replace the assistant's turn within the flow of the conversation
</system>`;
}

function buildXmlTemplate(turns: Turn[], nextTurn: Turn | null): string {
  const parts: string[] = [];
  parts.push("<summary>");
  parts.push(
    ...turns.map((turn, index) =>
      `
<user index="${index}">
${getUserPromptText(turn)}
</user>
<assistant index="${index}">
[**Replace: Your summary of the assistant turn**]
</assistant>
`.trim(),
    ),
  );

  if (nextTurn) {
    parts.push(
      `
<user>
${getUserPromptText(nextTurn)}
</user>
[**Do not add an <assistant> summary for the final <user> above; it marks where summarization stops and the template ends here.**]
`.trim(),
    );
  }
  parts.push("</summary>");
  return parts.join("\n");
}

// The anchor text for one turn: the first 300 chars of the whole user text,
// whitespace-normalized, with angle brackets stripped. The whole text, not
// the first line, because machine-generated user rows (task notifications,
// command wrappers) open with a constant tag line and only differ from line 2
// on; first-line anchors made most of an orchestrator session's anchors
// byte-identical, and the summarizer merged or dropped indistinguishable
// turns. Angle brackets are stripped because anchor text is untrusted
// transcript content echoed inside the response XML: a literal </user> or
// <assistant index="K"> inside an anchor would otherwise be ingested by the
// parse regexes as structure. Template and echo pass through the same
// transform, so the anchor cross-check in parseSummaries is unaffected.
export function getUserPromptText(turn: Turn): string {
  const text = turn.userRows
    .map(row => getUserText(row))
    .filter(Boolean)
    .join("\n");
  const normalized = text.trim().replace(/\s+/g, " ").replace(/[<>]/g, "");
  return normalized.length <= 300
    ? `${normalized}\n...`
    : `${normalized.slice(0, 300).trim()}...`;
}

// Extracts the per-turn summaries from the summarizer's response as a sparse
// index-to-summary map. Primary path: the template's index attributes make
// the turn-to-summary mapping explicit, so an occasional skipped turn
// degrades to preserve-verbatim instead of failing the whole compaction, and
// the echoed <user index> anchor text is cross-checked against the template's
// anchors so a renumbered response cannot silently attach summaries to the
// wrong turns. Within a complete index set, a turn whose echoed anchor
// disagrees also degrades to preserve-verbatim (the set being complete rules
// out a dropped-turn shift, so the mismatch reads as a paraphrased anchor,
// not misalignment). A duplicate or over-range index, more than half the
// turns missing or degraded, an anchor mismatch within a sparse set, or a
// sparse response with no verifiable anchors is a garbage response and
// throws. One extra pair at exactly expectedCount is ignored: models
// regularly continue the numbering onto the trailing next-turn anchor.
// Fallback path: a response with no indexed assistant blocks at all (a model
// that ignored the attributes) is parsed by position under the legacy
// exact-count contract, tolerating attributes on the tags it pairs.
export function parseSummaries(
  responseText: string,
  expectedCount: number,
  anchors: string[] = [],
): Map<number, string> {
  const start = responseText.indexOf("<summary>");
  const end = responseText.lastIndexOf("</summary>");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      "Summary response did not include a complete <summary> block.",
    );
  }
  const summary = responseText.slice(start, end + "</summary>".length);

  const indexed = new Map<number, string>();
  for (const match of summary.matchAll(
    /<assistant\s+index=["']?(\d+)["']?\s*>([\s\S]*?)<\/assistant>/g,
  )) {
    const index = Number(match[1]);
    if (index === expectedCount) {
      continue; // the trailing next-turn anchor, unrequested but common
    }
    if (index > expectedCount) {
      throw new Error(
        `Summary index ${index} is outside the ${expectedCount} requested turns.`,
      );
    }
    if (indexed.has(index)) {
      throw new Error(`Summary index ${index} appears more than once.`);
    }
    indexed.set(index, match[2]!.trim());
  }
  if (indexed.size > 0) {
    const missingCount = expectedCount - indexed.size;
    if (missingCount * 2 > expectedCount) {
      throw new Error(
        `Expected ${expectedCount} summaries, received ${indexed.size}; more than half are missing.`,
      );
    }

    // Anchor cross-check: an index attribute alone cannot prove alignment (a
    // model that renumbers AND drops a turn stays fully in range), so each
    // echoed <user index="K"> snippet is compared against the template's
    // anchor for turn K. The set's completeness picks the failure mode. A
    // COMPLETE set is positionally sound (every requested turn has exactly
    // one summary, so a dropped-turn shift is impossible): a mismatching or
    // blanked echo there is treated as the model paraphrasing an anchor it
    // could not reproduce (machine-generated command/notification boilerplate
    // survives getUserPromptText poorly), and that turn degrades to
    // preserve-verbatim instead of failing the run, subject to the same
    // more-than-half ceiling as missing turns. A SPARSE set is accepted only
    // when every present pair's anchor verifies, because a sparse set with a
    // mismatched or missing echo is indistinguishable from renumber-and-drop.
    const echoedAnchors = new Map<number, string>();
    for (const match of summary.matchAll(
      /<user\s+index=["']?(\d+)["']?\s*>([\s\S]*?)<\/user>/g,
    )) {
      const index = Number(match[1]);
      if (!echoedAnchors.has(index)) {
        echoedAnchors.set(index, match[2]!.trim());
      }
    }
    if (anchors.length > 0) {
      const mismatched: number[] = [];
      for (const [index] of indexed) {
        const echoed = echoedAnchors.get(index);
        if (echoed === undefined) {
          if (missingCount > 0) {
            throw new Error(
              `Sparse summary set has no echoed <user index="${index}"> anchor to verify alignment against.`,
            );
          }
          continue;
        }
        if (!anchorsAgree(anchors[index] ?? "", echoed)) {
          if (missingCount > 0) {
            throw new Error(
              `Echoed anchor for summary index ${index} does not match the requested turn; the response appears renumbered.`,
            );
          }
          mismatched.push(index);
        }
      }
      for (const index of mismatched) {
        indexed.delete(index);
      }
      if (
        mismatched.length > 0
        && (expectedCount - indexed.size) * 2 > expectedCount
      ) {
        throw new Error(
          `${mismatched.length} echoed anchors do not match their requested turns; `
            + `degrading them to verbatim would leave more than half of the ${expectedCount} turns unsummarized.`,
        );
      }
    }
    return indexed;
  }

  // Legacy positional pairing: pair each echoed <user> block with the
  // <assistant> block that follows it and take exactly the first
  // expectedCount pairs, tolerating attributes on either tag (a hybrid
  // response that indexes users but not assistants lands here). Models
  // regularly append one unrequested summary for the trailing next-turn
  // <user> anchor; positional pairing ignores the extra and still fails
  // loudly on a true miss. Without assistant indexes there is no way to
  // prove which summary belongs to which turn, so this path keeps the
  // exact-count requirement.
  const segments = [
    ...summary.matchAll(/<(user|assistant)\b[^>]*>([\s\S]*?)<\/\1>/g),
  ].map(match => ({ tag: match[1]!, text: match[2]!.trim() }));
  const matches: string[] = [];
  for (
    let index = 0;
    index < segments.length && matches.length < expectedCount;
    index++
  ) {
    const current = segments[index]!;
    const next = segments[index + 1];
    if (current.tag === "user" && next?.tag === "assistant") {
      matches.push(next.text);
      index++;
    }
  }
  if (matches.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} summaries, received ${matches.length} user/assistant pairs.`,
    );
  }
  return new Map(matches.map((text, index) => [index, text]));
}

// True when an echoed anchor plausibly restates the template anchor: both are
// whitespace-normalized and compared on the first 40 chars, prefix in either
// direction, so a model that trims or lightly rewraps the snippet still
// verifies while a different turn's anchor does not. Two turns sharing their
// first 40 chars would verify against each other; the whole-text anchor
// builder makes that rare (task ids and command names land inside the
// window).
function anchorsAgree(templateAnchor: string, echoedAnchor: string): boolean {
  const normalize = (s: string) =>
    s.replace(/\s+/g, " ").replace(/\.\.\.$/, "").trim().slice(0, 40);
  const a = normalize(templateAnchor);
  const b = normalize(echoedAnchor);
  if (a.length === 0 || b.length === 0) {
    return a.length === b.length;
  }
  return a.startsWith(b) || b.startsWith(a);
}

function getUserText(row: TranscriptRow): string {
  if (!isRecord(row.message)) {
    return "";
  }

  const content = row.message["content"];
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map(block =>
      isRecord(block) && typeof block["text"] === "string" ? block["text"] : "",
    )
    .filter(Boolean)
    .join("\n");
}
