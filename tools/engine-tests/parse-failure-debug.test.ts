// Pins parseSummariesWithDebugCapture: on a parseSummaries throw, the raw
// summarizer response is persisted to ~/.claude/magic-compact/debug/ and the
// file's path is folded into the propagated error message, so a field
// failure leaves evidence instead of being destroyed by cleanup. A
// successful parse must write nothing, and a debug write that cannot
// succeed must never mask the original parseSummaries error.
// Run: bun test tools/engine-tests/
import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import {
  parseSummaries,
  parseSummariesWithDebugCapture,
} from "../../plugins/claude-kit/skills/compact-session/engine/compact";

const debugDirectory = join(homedir(), ".claude", "magic-compact", "debug");

// A response with no <summary> block at all, so parseSummaries throws
// deterministically regardless of expectedCount or anchors.
const unparsableResponse = "the summarizer emitted no xml at all, just prose";

function twoEntrySuccessResponse(): string {
  return `<summary>
<user index="0">
anchor 0
...
</user>
<assistant index="0">
summary 0
</assistant>
<user index="1">
anchor 1
...
</user>
<assistant index="1">
summary 1
</assistant>
</summary>`;
}

describe("parseSummariesWithDebugCapture", () => {
  const writtenPaths: string[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const path of writtenPaths.splice(0)) {
      await unlink(path).catch(() => undefined);
    }
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("a parse failure writes the raw response to a debug file and names its path in the error", async () => {
    const sourceSessionId = randomUUID();
    let caught: Error | undefined;
    try {
      await parseSummariesWithDebugCapture(
        unparsableResponse,
        2,
        [],
        sourceSessionId,
      );
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);

    const match = caught!.message.match(
      /Raw summarizer response saved to (.+\.txt)$/,
    );
    expect(match).not.toBeNull();
    const debugPath = match![1]!;
    writtenPaths.push(debugPath);

    expect(caught!.message).toContain("complete <summary> block");

    expect(await Bun.file(debugPath).exists()).toBe(true);
    expect(await Bun.file(debugPath).text()).toBe(unparsableResponse);

    // Colons are illegal in a Windows path segment; the persisted name
    // replaces them with hyphens so the write does not fail there.
    const fileName = debugPath.replace(/\\/g, "/").split("/").at(-1)!;
    expect(fileName.startsWith(`${sourceSessionId}-`)).toBe(true);
    expect(fileName).toMatch(
      /^.+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.txt$/,
    );
    expect(fileName).not.toContain(":");
  });

  test("a successful parse writes no debug file", async () => {
    const sourceSessionId = randomUUID();
    const entriesBefore = await readdir(debugDirectory).catch(
      () => [] as string[],
    );

    const map = await parseSummariesWithDebugCapture(
      twoEntrySuccessResponse(),
      2,
      ["anchor 0\n...", "anchor 1\n..."],
      sourceSessionId,
    );
    expect(map.size).toBe(2);

    const entriesAfter = await readdir(debugDirectory).catch(
      () => [] as string[],
    );
    expect(entriesAfter).toEqual(entriesBefore);
  });

  test("a debug write that cannot succeed still surfaces the original parse error, unmodified", async () => {
    const directError = (() => {
      try {
        parseSummaries(unparsableResponse, 2, []);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(directError).not.toBeNull();

    // A plain file pre-created at the exact path the write needs to create as
    // a directory forces mkdir(..., { recursive: true }) to fail with EEXIST
    // on every platform, unlike an illegal filename character (Windows-only,
    // and unreachable in practice since sourceSessionId always derives from a
    // filename the host itself produced).
    const doomedBase = join(tmpdir(), `doomed-debug-base-${randomUUID()}`);
    tempDirs.push(doomedBase);
    await mkdir(join(doomedBase, ".claude", "magic-compact"), {
      recursive: true,
    });
    await writeFile(
      join(doomedBase, ".claude", "magic-compact", "debug"),
      "occupies the path the debug write needs as a directory",
    );

    let caught: Error | undefined;
    try {
      await parseSummariesWithDebugCapture(
        unparsableResponse,
        2,
        [],
        randomUUID(),
        doomedBase,
      );
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toBe(directError);
    expect(caught!.message).not.toContain("saved to");
  });
});
