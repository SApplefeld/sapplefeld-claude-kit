import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { compactTranscript } from "./compact";
import { appendLedgerEntry, readLastMainChainUsage } from "./ledger";
import {
  appendCustomTitle,
  createTranscriptSession,
  resolveSessionTitle,
} from "./transcript";

// Agent-invokable compaction entry point.
//
// Usage:
//   bun compact-cli.ts --transcript <path to source .jsonl> [--keep N] [--summarizer-model <model id>]
//                      [--check] [--min-context <tokens>] [--force]
//
// Must run with cwd inside the project the transcript belongs to; session-ID
// resolution for the summarizer is project-scoped (enforced below). --check
// is exempt: it spawns nothing and may be run from anywhere.
//
// The source transcript is never modified (copy-on-write), except a
// best-effort "[UNCOMPACTED]" relabel so the resume picker distinguishes the
// stale original from the compacted successor. On success, prints a JSON
// result with the destination session ID to stdout and exits 0. On failure,
// no-op, or a guard skip, exits nonzero with the reason on stderr.

// The tunable thresholds, in context tokens (input + cache read + cache
// creation of the last main-chain call). Calibrated 2026-07-10 from the
// transcript-corpus ROI analysis (docs/plans/claude-kit_compaction-tuning_spec_v1.md):
// post-compaction floors measured 50-57k, and events with deltas under ~100k
// were break-even to negative, so compaction below 150k costs more than it
// saves; above 200k every call bills 3-5x the floor, so waiting is the
// expensive choice.
const CHECK_TRIGGER_TOKENS = 200_000;
const MIN_COMPACTION_CONTEXT_TOKENS = 150_000;

type CliArguments = {
  transcriptPath: string;
  keepTurns: number;
  summarizerModel: string | undefined;
  check: boolean;
  force: boolean;
  minContextTokens: number;
};

async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2));

  const source = Bun.file(args.transcriptPath);
  if (!(await source.exists())) {
    fail(`Source transcript not found: ${args.transcriptPath}`);
  }

  if (args.check) {
    await runCheck(args);
    return;
  }

  // The summarizer resumes its analysis copy by session ID, and the CLI
  // resolves session IDs against the project directory of the current cwd. A
  // cwd outside the transcript's project makes resolution fail or, worse,
  // fuzzy-match an unrelated session and summarize the wrong conversation, so
  // a mismatch is a hard error, not a warning.
  const transcriptProjectDir = basename(dirname(args.transcriptPath));
  const cwdProjectDir = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
  if (transcriptProjectDir !== cwdProjectDir) {
    fail(
      `Transcript belongs to project directory "${transcriptProjectDir}" but the current working directory resolves to "${cwdProjectDir}". Run this from the repo the transcript belongs to.`,
    );
  }

  // Skip guard: a compaction lands the session on a ~50-60k floor, so with
  // less than ~100k of context above that floor the summarizer spend plus the
  // post-compaction reload eats the savings. Skipping is a policy result, not
  // a failure, and uses the same exit code as nothing-to-compact.
  const usageBefore = await readLastMainChainUsage(args.transcriptPath);
  if (
    !args.force
    && usageBefore !== null
    && usageBefore.contextTokens < args.minContextTokens
  ) {
    process.stderr.write(
      `Compaction skipped: last main-chain context is ${usageBefore.contextTokens} tokens, below the ${args.minContextTokens}-token minimum where compaction pays for itself. Pass --force (or a lower --min-context) to compact anyway.\n`,
    );
    process.exit(2);
  }

  const startedAt = Date.now();
  const destination = await createTranscriptSession(args.transcriptPath);
  const compacted = await compactTranscript(
    args.transcriptPath,
    destination.transcriptPath,
    destination.sessionId,
    args.keepTurns,
    ...(args.summarizerModel === undefined ? [] : [args.summarizerModel]),
  ).catch(async (error: unknown) => {
    await unlink(destination.transcriptPath).catch(() => undefined);
    // The omission cache is saved before the destination transcript is
    // written, so a late failure can strand it; the path mirrors
    // cacheDirectory() in omission.ts, which stays vendored-verbatim.
    await unlink(
      `${homedir()}/.claude/magic-compact/${destination.sessionId}.json`,
    ).catch(() => undefined);
    fail(
      `Compaction failed; source untouched: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (!compacted) {
    await unlink(destination.transcriptPath).catch(() => undefined);
    process.stderr.write(
      "Compaction skipped: no older assistant turns to compact.\n",
    );
    process.exit(2);
  }

  try {
    const title = await resolveSessionTitle(args.transcriptPath);
    if (title !== null) {
      const label = title.startsWith("[UNCOMPACTED] ")
        ? title
        : `[UNCOMPACTED] ${title}`;
      await appendCustomTitle(
        args.transcriptPath,
        sessionIdFromPath(args.transcriptPath),
        label,
      );
    }
  } catch {
    // Best-effort labeling; compaction already succeeded.
  }

  // Telemetry, best-effort: compaction already succeeded, so a ledger problem
  // is a warning, never a failure.
  try {
    await appendLedgerEntry({
      timestamp: new Date().toISOString(),
      sourceSessionId: sessionIdFromPath(args.transcriptPath),
      destinationSessionId: destination.sessionId,
      project: transcriptProjectDir,
      contextBeforeTokens: usageBefore?.contextTokens ?? null,
      model: usageBefore?.model ?? null,
      keepTurns: args.keepTurns,
      sourceTranscriptBytes: source.size,
      destinationTranscriptBytes: Bun.file(destination.transcriptPath).size,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    process.stderr.write(
      `Warning: compaction succeeded but the ledger write failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      status: "compacted",
      destinationSessionId: destination.sessionId,
      destinationTranscriptPath: destination.transcriptPath,
      resumeCommand: `/resume ${destination.sessionId}`,
    })}\n`,
  );
}

function parseArguments(argv: string[]): CliArguments {
  let transcriptPath: string | undefined;
  // Default keeps the newest turn: compaction is invoked from a turn that is
  // still in flight, and summarizing it would soften the freshest context.
  let keepTurns = 1;
  let summarizerModel: string | undefined;
  let check = false;
  let force = false;
  let minContextTokens = MIN_COMPACTION_CONTEXT_TOKENS;

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--transcript":
        transcriptPath = requireValue(flag, value);
        index++;
        break;
      case "--keep": {
        const parsed = Number(requireValue(flag, value));
        if (!Number.isInteger(parsed) || parsed < 0) {
          fail(`--keep must be a non-negative integer, received: ${value}`);
        }
        keepTurns = parsed;
        index++;
        break;
      }
      case "--summarizer-model":
        summarizerModel = requireValue(flag, value);
        index++;
        break;
      case "--check":
        check = true;
        break;
      case "--force":
        force = true;
        break;
      case "--min-context": {
        const parsed = Number(requireValue(flag, value));
        if (!Number.isInteger(parsed) || parsed < 0) {
          fail(
            `--min-context must be a non-negative integer, received: ${value}`,
          );
        }
        minContextTokens = parsed;
        index++;
        break;
      }
      default:
        fail(`Unknown argument: ${flag}`);
    }
  }

  if (!transcriptPath) {
    fail(
      "Usage: bun compact-cli.ts --transcript <path> [--keep N] [--summarizer-model <model id>] [--check] [--min-context <tokens>] [--force]",
    );
  }

  return {
    transcriptPath,
    keepTurns,
    summarizerModel,
    check,
    force,
    minContextTokens,
  };
}

// Read-only threshold check for a boundary decision: reports the last
// main-chain billed context and whether it clears the compaction trigger.
// Exits 0 with a JSON result whenever a billed usage row exists; a transcript
// with none exits 1 (nothing to measure). The recommendation is the payload,
// not the exit code.
async function runCheck(args: CliArguments): Promise<void> {
  const usage = await readLastMainChainUsage(args.transcriptPath);
  if (usage === null) {
    fail(
      "No billed main-chain usage rows found; nothing to measure. Is this a live session transcript?",
    );
  }

  const recommendation =
    usage.contextTokens >= CHECK_TRIGGER_TOKENS ? "compact" : "skip";
  const reason =
    recommendation === "compact"
      ? `context ${usage.contextTokens} >= trigger ${CHECK_TRIGGER_TOKENS}: every further call re-bills this context, so compact at the next boundary`
      : usage.contextTokens < args.minContextTokens
        ? `context ${usage.contextTokens} < minimum ${args.minContextTokens}: a compaction now would cost more than it saves (a run without --force exits 2)`
        : `context ${usage.contextTokens} < trigger ${CHECK_TRIGGER_TOKENS}: compaction is allowed but not yet worth interrupting for`;

  process.stdout.write(
    `${JSON.stringify({
      status: "check",
      contextTokens: usage.contextTokens,
      model: usage.model,
      measuredAt: usage.timestamp,
      trigger: CHECK_TRIGGER_TOKENS,
      minContext: args.minContextTokens,
      recommendation,
      reason,
    })}\n`,
  );
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

function sessionIdFromPath(transcriptPath: string): string {
  const fileName = transcriptPath.replace(/\\/g, "/").split("/").at(-1) ?? "";
  return fileName.endsWith(".jsonl") ? fileName.slice(0, -".jsonl".length) : fileName;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
