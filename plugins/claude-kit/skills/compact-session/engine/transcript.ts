import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, appendFile, copyFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type JsonRecord = Record<string, unknown>;

export type TranscriptRow = JsonRecord & {
  type: "user" | "assistant" | "attachment" | "system";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  message?: JsonRecord;
  subtype?: string;
  isSidechain?: boolean;
};

export type TranscriptCopy = {
  sessionId: string;
  transcriptPath: string;
};

export type Turn = {
  userRows: TranscriptRow[];
  rows: TranscriptRow[];
  // Set on continuation segments produced by splitOversizedTurns, which have
  // no user rows of their own: getUserPromptText returns this text (through
  // its usual normalization) instead of deriving the anchor from userRows.
  anchorOverride?: string;
};

export async function readActiveTranscriptRows(
  transcriptPath: string,
): Promise<TranscriptRow[]> {
  const rows = await readTranscriptRows(transcriptPath);
  const lastBoundaryIndex = rows.findLastIndex(isCompactBoundary);
  return buildActiveChain(
    lastBoundaryIndex === -1 ? rows : rows.slice(lastBoundaryIndex + 1),
  );
}

export async function copyTranscriptToNewSession(
  sourceTranscriptPath: string,
): Promise<TranscriptCopy> {
  const destination = await createTranscriptSession(sourceTranscriptPath);
  await copyFile(
    sourceTranscriptPath,
    destination.transcriptPath,
    constants.COPYFILE_EXCL,
  );
  return destination;
}

export async function createTranscriptSession(
  sourceTranscriptPath: string,
): Promise<TranscriptCopy> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const sessionId = randomUUID();
    const transcriptPath = join(
      dirname(sourceTranscriptPath),
      `${sessionId}.jsonl`,
    );

    try {
      await access(transcriptPath, constants.F_OK);
    } catch (error) {
      if (isRecord(error) && error["code"] === "ENOENT") {
        return { sessionId, transcriptPath };
      }

      throw error;
    }
  }

  throw new Error("Unable to create a unique transcript session.");
}

export async function readPreservedMetadataEntries(
  transcriptPath: string,
  sourceSessionId: string,
  destinationSessionId: string,
): Promise<JsonRecord[]> {
  const entries = await readTranscriptEntries(transcriptPath);
  return entries
    .filter(
      (entry): entry is JsonRecord =>
        isRecord(entry)
        && !isTranscriptRow(entry)
        && isPreservedMetadataEntry(entry),
    )
    .map(entry =>
      rewriteSessionMetadata(entry, sourceSessionId, destinationSessionId),
    );
}

export async function writeTranscriptEntries(
  transcriptPath: string,
  entries: JsonRecord[],
): Promise<void> {
  await Bun.write(
    transcriptPath,
    `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`,
  );
}

export async function readTranscriptRows(
  transcriptPath: string,
): Promise<TranscriptRow[]> {
  const entries = await readTranscriptEntries(transcriptPath);
  return entries.filter(isTranscriptRow);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export function buildAssistantTurns(rows: TranscriptRow[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;
  let assistantStarted = false;

  for (const row of rows) {
    if (isHumanUserRow(row)) {
      if (!currentTurn || assistantStarted) {
        currentTurn = { userRows: [], rows: [] };
        turns.push(currentTurn);
        assistantStarted = false;
      }
      currentTurn.userRows.push(row);
      currentTurn.rows.push(row);
      continue;
    }

    if (!currentTurn) {
      continue;
    }

    currentTurn.rows.push(row);
    if (row.type === "assistant" || isToolResultRow(row)) {
      assistantStarted = true;
    }
  }

  return turns.filter(turn =>
    turn.rows.some(row => row.type === "assistant" || isToolResultRow(row)),
  );
}

// Estimated token budget for one summarization segment, a chars/4 heuristic
// over each row's model-visible content (see estimateRowTokens). Segment
// size does not bound summarizer input (the summarizer resumes the full
// transcript copy). It calibrates against two axes, and tuning it moves
// both. It sets summary granularity: roughly one ~200-word summary per ~20k
// tokens of stretch. It also sizes the verbatim recent-context window on the
// segment-granular keep path in createPlan, where --keep N preserves the
// last N segments rather than the last N turns: at the default --keep 1,
// every autonomous session carries at most one segment's worth of unmodified
// recent context past a compaction.
export const SEGMENT_TOKEN_BUDGET = 20_000;

// Splits oversized turns into bounded segment pseudo-turns, so a plan entry
// never asks for a single summary of an arbitrarily long stretch (an
// autonomous run has almost no human user rows, so one turn can span
// hundreds of rows). A turn at or under the budget is returned as the same
// object, untouched. Cuts land only between step chunks (see
// buildStepChunks), so a tool_use is never separated from its tool_result
// and every segment contains at least one assistant row; a chunk over the
// budget forms its own segment rather than being split internally.
// Concatenating the segments' rows in order reproduces the original turn's
// rows exactly. The first segment keeps the turn's userRows; continuation
// segments carry userRows: [] (the emission path copies userRows per entry,
// so a repeat would emit the same row twice) and a deterministic
// anchorOverride: "(continuation N)" plus a nonempty snippet derived from
// the segment (see continuationSnippet), which getUserPromptText serves in
// place of the missing user text. N runs across the entire input list, not
// per turn: the parser's anchor cross-check compares anchors from the whole
// post-split list, and assistant openers repeat often enough that per-turn
// numbering would let two turns' continuations verify against each other.
// Every continuation anchor produced by one call is therefore distinct
// inside the parser's 40-char anchor comparison window; near-identical
// anchors are how summaries silently merge.
export function splitOversizedTurns(turns: Turn[]): Turn[] {
  let nextContinuation = 1;
  return turns.flatMap(turn => splitTurn(turn, () => nextContinuation++));
}

function splitTurn(turn: Turn, nextContinuation: () => number): Turn[] {
  const rowTokens = new Map<TranscriptRow, number>();
  let turnTokens = 0;
  for (const row of turn.rows) {
    const tokens = estimateRowTokens(row);
    rowTokens.set(row, tokens);
    turnTokens += tokens;
  }
  if (turnTokens <= SEGMENT_TOKEN_BUDGET) {
    return [turn];
  }

  const segments: TranscriptRow[][] = [];
  let current: TranscriptRow[] = [];
  let currentTokens = 0;
  for (const chunk of buildStepChunks(turn.rows)) {
    let chunkTokens = 0;
    for (const row of chunk) {
      chunkTokens += rowTokens.get(row) ?? 0;
    }
    if (
      current.length > 0
      && currentTokens + chunkTokens > SEGMENT_TOKEN_BUDGET
    ) {
      segments.push(current);
      current = [];
      currentTokens = 0;
    }
    for (const row of chunk) {
      current.push(row);
    }
    currentTokens += chunkTokens;
  }
  if (current.length > 0) {
    segments.push(current);
  }
  if (segments.length <= 1) {
    return [turn];
  }

  // Segment 0 keeps the turn's own anchor fields: its userRows and any
  // anchorOverride the turn already carried.
  return segments.map((rows, index) =>
    index === 0
      ? { ...turn, rows }
      : {
          userRows: [],
          rows,
          anchorOverride: `(continuation ${nextContinuation()}) ${continuationSnippet(rows)}`,
        },
  );
}

// Groups a turn's rows into atomic step chunks. A chunk opens at an
// assistant row that starts a new assistant message: its message id differs
// from the previous assistant row's (a missing id on one side counts as
// differing, since two rows that cannot be shown to share a message must
// not be merged into one step), or, when both ids are missing, tool results
// have arrived since the previous assistant row. Tool-pair cohesion is
// enforced, not assumed: a chunk boundary is refused wherever
// findBlockedBoundaries marks it, which keeps every answered
// tool_use/tool_result pair inside one chunk, however many assistant
// messages apart its rows land and whatever order they arrive in, and
// keeps a chunk from opening directly behind an unanswered tool_use.
// Everything else (tool results, attachments, system rows, the leading
// user rows) rides with the step it follows. The turn's first assistant
// row never opens a chunk, so in a multi-chunk turn the first chunk always
// contains an assistant row and every later chunk begins with one.
function buildStepChunks(rows: TranscriptRow[]): TranscriptRow[][] {
  const blockedBoundaries = findBlockedBoundaries(rows);

  const chunks: TranscriptRow[][] = [];
  let current: TranscriptRow[] = [];
  let lastAssistantMessageId: string | null = null;
  let sawAssistant = false;
  let sawToolResultSinceAssistant = false;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (row.type === "assistant") {
      const messageId = getMessageId(row);
      const opensNewMessage =
        sawAssistant
        && (messageId !== null || lastAssistantMessageId !== null
          ? messageId !== lastAssistantMessageId
          : sawToolResultSinceAssistant);
      if (
        opensNewMessage
        && current.length > 0
        && !blockedBoundaries[index]
      ) {
        chunks.push(current);
        current = [];
      }
      sawAssistant = true;
      sawToolResultSinceAssistant = false;
      lastAssistantMessageId = messageId;
    } else if (rowHasToolResultBlock(row)) {
      sawToolResultSinceAssistant = true;
    }
    current.push(row);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

// Marks the row indices where a chunk boundary (a cut landing immediately
// before that row) must be refused. Each tool_result pairs with the nearest
// preceding unanswered tool_use of the same id, forming an index span; a
// boundary strictly inside a span would separate the pair, so every index
// from the tool_use's successor through the tool_result is blocked. Spans
// are immune to row ordering and to re-issued ids: a tool_result with no
// preceding unanswered tool_use forms no span, and a re-issued id pairs
// each tool_result with its own preceding tool_use. A tool_use occurrence
// no span answers (an interrupted turn, a cancelled tool, a tool_result
// stranded off the active chain) blocks exactly one boundary, the one
// immediately after its row: a cut there would emit the next segment's
// summary row directly behind the unanswered tool_use, which resumes as an
// invalid message sequence, so that candidate merges into the following
// chunk instead. Tool blocks are detected by content shape on every row
// type, matching the breadth of the emission path's tool-row filter, so no
// tool_result the emitter would keep is invisible here.
function findBlockedBoundaries(rows: TranscriptRow[]): boolean[] {
  const pendingUsesById = new Map<string, number[]>();
  const spans: { use: number; result: number }[] = [];
  for (let index = 0; index < rows.length; index++) {
    for (const block of getContentBlocks(rows[index]!) ?? []) {
      if (block["type"] === "tool_use" && typeof block["id"] === "string") {
        const pending = pendingUsesById.get(block["id"]) ?? [];
        pending.push(index);
        pendingUsesById.set(block["id"], pending);
      } else if (
        block["type"] === "tool_result"
        && typeof block["tool_use_id"] === "string"
      ) {
        const use = pendingUsesById.get(block["tool_use_id"])?.pop();
        if (use !== undefined) {
          spans.push({ use, result: index });
        }
      }
    }
  }

  const blocked = new Array<boolean>(rows.length).fill(false);
  for (const { use, result } of spans) {
    for (let index = use + 1; index <= result; index++) {
      blocked[index] = true;
    }
  }
  for (const pending of pendingUsesById.values()) {
    for (const use of pending) {
      if (use + 1 < rows.length) {
        blocked[use + 1] = true;
      }
    }
  }
  return blocked;
}

// Content-shape counterpart of isToolResultRow, with no row-type
// requirement: the emission path keeps any row whose content carries a tool
// block, so the splitter's view of tool results must be at least as broad.
function rowHasToolResultBlock(row: TranscriptRow): boolean {
  return (getContentBlocks(row) ?? []).some(
    block => block["type"] === "tool_result",
  );
}

// Upper bound on a continuation snippet before anchor normalization.
// normalizeAnchorText truncates to 300 chars, but it allocates full-length
// intermediate copies first, and an assistant text block can run to
// megabytes of untrusted transcript content headed for the summarizer
// prompt, so the derivation stays bounded here.
const CONTINUATION_SNIPPET_CAP = 400;

// The anchor snippet for a continuation segment, always nonempty: the first
// nonempty assistant text (string-form message content or the first
// nonempty text block), else the distinct tool names the segment invokes in
// first-seen order, else the segment's first row uuid. An empty snippet is
// never returned: a bare "(continuation N)" anchor would be a prefix of
// every "(continuation N) ..." anchor and pass the parser's anchor
// cross-check unconditionally. getUserPromptText's normalization handles
// truncation and angle brackets downstream.
function continuationSnippet(rows: TranscriptRow[]): string {
  for (const row of rows) {
    if (row.type !== "assistant" || !isRecord(row.message)) {
      continue;
    }
    const content = row.message["content"];
    if (typeof content === "string" && content.trim() !== "") {
      return content.slice(0, CONTINUATION_SNIPPET_CAP);
    }
    for (const block of getContentBlocks(row) ?? []) {
      if (
        block["type"] === "text"
        && typeof block["text"] === "string"
        && block["text"].trim() !== ""
      ) {
        return block["text"].slice(0, CONTINUATION_SNIPPET_CAP);
      }
    }
  }

  const toolNames = new Set<string>();
  for (const row of rows) {
    for (const block of getContentBlocks(row) ?? []) {
      if (block["type"] === "tool_use" && typeof block["name"] === "string") {
        toolNames.add(block["name"]);
      }
    }
  }
  if (toolNames.size > 0) {
    return `(tool activity: ${[...toolNames].join(", ")})`.slice(
      0,
      CONTINUATION_SNIPPET_CAP,
    );
  }
  return rows[0]!.uuid;
}

function getContentBlocks(row: TranscriptRow): JsonRecord[] | null {
  if (!isRecord(row.message)) {
    return null;
  }
  const content = row.message["content"];
  return Array.isArray(content) ? content.filter(isRecord) : null;
}

// Chars/4 heuristic over the row's model-visible content: a message's
// content blocks, or an attachment row's payload. Attachment rows carry no
// message field and run to tens of kilobytes, so measuring only messages
// would score them zero and let a stretch of them overrun the budget
// unmeasured. Envelope fields (uuid, parentUuid, sessionId, timestamp) are
// not model-visible; counting them would inflate many-small-row turns far
// more than few-large-row turns and skew the budget the splitter packs
// against.
export function estimateRowTokens(row: TranscriptRow): number {
  const content = isRecord(row.message)
    ? row.message["content"]
    : row["attachment"];
  return content === undefined ? 0 : JSON.stringify(content).length / 4;
}

function buildActiveChain(rows: TranscriptRow[]): TranscriptRow[] {
  const rowsByUuid = new Map(rows.map(row => [row.uuid, row]));
  const parentUuids = new Set(
    rows
      .map(row => row.parentUuid)
      .filter((uuid): uuid is string => uuid !== null),
  );
  const terminalRows = rows.filter(row => !parentUuids.has(row.uuid));
  const hasUserAssistantChild = new Set<string>();
  for (const row of rows) {
    if (
      row.parentUuid !== null
      && (row.type === "user" || row.type === "assistant")
    ) {
      hasUserAssistantChild.add(row.parentUuid);
    }
  }

  let leaf: TranscriptRow | undefined;
  for (const terminal of terminalRows) {
    const seen = new Set<string>();
    let current: TranscriptRow | undefined = terminal;
    while (current) {
      if (seen.has(current.uuid)) {
        throw new Error("Cycle detected in transcript parentUuid chain.");
      }
      seen.add(current.uuid);
      if (current.type === "user" || current.type === "assistant") {
        if (
          !hasUserAssistantChild.has(current.uuid)
          && (!leaf || current.timestamp.localeCompare(leaf.timestamp) > 0)
        ) {
          leaf = current;
        }
        break;
      }
      current = current.parentUuid
        ? rowsByUuid.get(current.parentUuid)
        : undefined;
    }
  }
  if (!leaf) {
    return [];
  }

  const chain: TranscriptRow[] = [];
  const seen = new Set<string>();
  let current: TranscriptRow | undefined = leaf;
  while (current) {
    if (seen.has(current.uuid)) {
      throw new Error("Cycle detected in transcript parentUuid chain.");
    }
    seen.add(current.uuid);
    chain.push(current);
    current = current.parentUuid
      ? rowsByUuid.get(current.parentUuid)
      : undefined;
  }

  return recoverParallelToolRows(rows, chain.reverse(), seen);
}

function recoverParallelToolRows(
  rows: TranscriptRow[],
  chain: TranscriptRow[],
  seen: Set<string>,
): TranscriptRow[] {
  const inserts = new Map<string, TranscriptRow[]>();
  const processedMessageIds = new Set<string>();
  const assistantRows = chain.filter(row => row.type === "assistant");
  const anchorByMessageId = new Map<string, TranscriptRow>();
  for (const assistant of assistantRows) {
    const messageId = getMessageId(assistant);
    if (messageId) {
      anchorByMessageId.set(messageId, assistant);
    }
  }

  for (const assistant of assistantRows) {
    const messageId = getMessageId(assistant);
    if (!messageId || processedMessageIds.has(messageId)) {
      continue;
    }
    processedMessageIds.add(messageId);

    const siblings = rows.filter(
      row =>
        row.type === "assistant"
        && getMessageId(row) === messageId
        && !seen.has(row.uuid),
    );
    const toolResults = rows.filter(
      row =>
        isToolResultRow(row)
        && row.parentUuid !== null
        && (row.parentUuid === assistant.uuid
          || siblings.some(sibling => sibling.uuid === row.parentUuid))
        && !seen.has(row.uuid),
    );

    if (siblings.length > 0 || toolResults.length > 0) {
      siblings.sort(compareByTimestamp);
      toolResults.sort(compareByTimestamp);
      const anchor = anchorByMessageId.get(messageId) ?? assistant;
      inserts.set(anchor.uuid, [...siblings, ...toolResults]);
      for (const row of [...siblings, ...toolResults]) {
        seen.add(row.uuid);
      }
    }
  }

  return chain.flatMap(row => [row, ...(inserts.get(row.uuid) ?? [])]);
}

function compareByTimestamp(a: TranscriptRow, b: TranscriptRow): number {
  return a.timestamp.localeCompare(b.timestamp);
}

function isCompactBoundary(row: TranscriptRow): boolean {
  const magicCompact = row["magicCompact"];
  return isRecord(magicCompact) && magicCompact["boundary"] === true;
}

function isToolResultRow(row: TranscriptRow): boolean {
  if (row.type !== "user" || !isRecord(row.message)) {
    return false;
  }
  const content = row.message["content"];
  return (
    Array.isArray(content)
    && content.some(block => isRecord(block) && block["type"] === "tool_result")
  );
}

function isHumanUserRow(row: TranscriptRow): boolean {
  return row.type === "user" && !isToolResultRow(row) && row.isMeta !== true;
}

function getMessageId(row: TranscriptRow): string | null {
  return isRecord(row.message) && typeof row.message["id"] === "string"
    ? row.message["id"]
    : null;
}

function isTranscriptRow(value: unknown): value is TranscriptRow {
  return (
    isRecord(value)
    && typeof value["uuid"] === "string"
    && (value["type"] === "user"
      || value["type"] === "assistant"
      || value["type"] === "attachment"
      || value["type"] === "system")
  );
}

async function readTranscriptEntries(
  transcriptPath: string,
): Promise<unknown[]> {
  const content = await readFile(transcriptPath, "utf8");
  return content
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => JSON.parse(line) as unknown);
}

function isPreservedMetadataEntry(entry: JsonRecord): boolean {
  return PRESERVED_METADATA_TYPES.has(String(entry["type"]));
}

function rewriteSessionMetadata(
  entry: JsonRecord,
  sourceSessionId: string,
  destinationSessionId: string,
): JsonRecord {
  const copied = structuredClone(entry) as JsonRecord;
  if (copied["sessionId"] === sourceSessionId) {
    copied["sessionId"] = destinationSessionId;
  }
  return copied;
}

const PRESERVED_METADATA_TYPES = new Set([
  "custom-title",
  "ai-title",
  "last-prompt",
  "tag",
  "agent-name",
  "agent-color",
  "agent-setting",
  "mode",
  "worktree-state",
  "pr-link",
  "task-summary",
  "permission-mode",
]);

export async function resolveSessionTitle(
  transcriptPath: string,
): Promise<string | null> {
  const entries = await readTranscriptEntries(transcriptPath);
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }
    if (
      entry["type"] === "custom-title"
      && typeof entry["customTitle"] === "string"
    ) {
      customTitle = entry["customTitle"];
    } else if (
      entry["type"] === "ai-title"
      && typeof entry["aiTitle"] === "string"
    ) {
      aiTitle = entry["aiTitle"];
    }
  }
  return customTitle ?? aiTitle;
}

export async function appendCustomTitle(
  transcriptPath: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const entry = {
    type: "custom-title",
    customTitle: title,
    sessionId,
  };
  await appendFile(transcriptPath, `${JSON.stringify(entry)}\n`, {
    mode: 0o600,
  });
}
