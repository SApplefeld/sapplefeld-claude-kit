import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { compactTranscript } from "./compact";
import {
  appendCustomTitle,
  createTranscriptSession,
  resolveSessionTitle,
} from "./transcript";

// Agent-invokable compaction entry point.
//
// Usage:
//   bun compact-cli.ts --transcript <path to source .jsonl> [--keep N] [--summarizer-model <model id>]
//
// Must run with cwd inside the project the transcript belongs to; session-ID
// resolution for the summarizer is project-scoped (enforced below).
//
// The source transcript is never modified (copy-on-write), except a
// best-effort "[UNCOMPACTED]" relabel so the resume picker distinguishes the
// stale original from the compacted successor. On success, prints a JSON
// result with the destination session ID to stdout and exits 0. On failure or
// no-op, exits nonzero with the reason on stderr.

type CliArguments = {
  transcriptPath: string;
  keepTurns: number;
  summarizerModel: string | undefined;
};

async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2));

  const source = Bun.file(args.transcriptPath);
  if (!(await source.exists())) {
    fail(`Source transcript not found: ${args.transcriptPath}`);
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
      default:
        fail(`Unknown argument: ${flag}`);
    }
  }

  if (!transcriptPath) {
    fail(
      "Usage: bun compact-cli.ts --transcript <path> [--keep N] [--summarizer-model <model id>]",
    );
  }

  return { transcriptPath, keepTurns, summarizerModel };
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
