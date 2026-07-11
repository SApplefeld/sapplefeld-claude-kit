import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { isRecord } from "./transcript";

// Compaction telemetry. One JSON line per successful compaction, appended to
// the ledger beside the omission caches. The ledger holds metadata only
// (token counts, session IDs, byte sizes), never conversation content, and is
// the data feed for tuning the trigger and guard thresholds in compact-cli.ts
// against real usage. contextBeforeTokens and model are null when the source
// transcript had no readable billed usage (reachable only via --force); null
// means unmeasured, so analysis can never mistake it for a real value.

export type MainChainUsage = {
  contextTokens: number;
  model: string | null;
  timestamp: string | null;
};

export type LedgerEntry = {
  timestamp: string;
  sourceSessionId: string;
  destinationSessionId: string;
  project: string;
  contextBeforeTokens: number | null;
  model: string | null;
  keepTurns: number;
  sourceTranscriptBytes: number;
  destinationTranscriptBytes: number;
  durationMs: number;
};

const LEDGER_PATH = `${homedir()}/.claude/magic-compact/ledger.jsonl`;

// The last billed context of the session's main chain: input plus cache-read
// plus cache-creation tokens of the newest non-sidechain assistant row that
// carries real usage. This is what every subsequent call in the session
// re-bills, so it is the number the trigger and guard decide on. Synthetic
// rows (harness-injected, no API call behind them) and sidechain (subagent)
// rows are skipped. Returns null when no such row exists.
export async function readLastMainChainUsage(
  transcriptPath: string,
): Promise<MainChainUsage | null> {
  const text = await Bun.file(transcriptPath).text();
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !isRecord(row)
      || row["type"] !== "assistant"
      || row["isSidechain"] === true
    ) {
      continue;
    }
    const message = row["message"];
    if (!isRecord(message)) {
      continue;
    }
    const model = message["model"];
    if (typeof model !== "string" || model.startsWith("<")) {
      continue;
    }
    const usage = message["usage"];
    if (!isRecord(usage)) {
      continue;
    }
    const contextTokens =
      tokenCount(usage["input_tokens"])
      + tokenCount(usage["cache_read_input_tokens"])
      + cacheCreationTokens(usage);
    if (contextTokens <= 0) {
      continue;
    }
    return {
      // The model string is transcript-derived and echoed into the check JSON
      // and the ledger; anything outside the model-id charset is dropped
      // rather than propagated.
      contextTokens,
      model: /^[A-Za-z0-9._:-]{1,64}$/.test(model) ? model : null,
      timestamp: typeof row["timestamp"] === "string" ? row["timestamp"] : null,
    };
  }
  return null;
}

export async function appendLedgerEntry(entry: LedgerEntry): Promise<void> {
  await mkdir(dirname(LEDGER_PATH), { recursive: true });
  await appendFile(LEDGER_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

// Cache-creation tokens appear either as a flat count or broken out by TTL,
// depending on CLI version; accept both shapes.
function cacheCreationTokens(usage: Record<string, unknown>): number {
  const flat = tokenCount(usage["cache_creation_input_tokens"]);
  if (flat > 0) {
    return flat;
  }
  const nested = usage["cache_creation"];
  if (!isRecord(nested)) {
    return 0;
  }
  return (
    tokenCount(nested["ephemeral_5m_input_tokens"])
    + tokenCount(nested["ephemeral_1h_input_tokens"])
  );
}
