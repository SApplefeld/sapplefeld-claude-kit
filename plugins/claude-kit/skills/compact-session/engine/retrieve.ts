import { readOmittedContent } from "./omission";

// Retrieves original tool I/O that compaction moved to the omission cache.
//
// Usage:
//   bun retrieve.ts <Content ID>
//
// Content IDs appear in omission notices inside compacted transcripts, in the
// form <session-suffix>:omitted-###. Prints the original content to stdout, or
// exits 2 if the ID resolves to nothing.

const contentId = Bun.argv[2];
if (!contentId) {
  process.stderr.write("Usage: bun retrieve.ts <Content ID>\n");
  process.exit(1);
}

const content = await readOmittedContent(contentId);
if (content === null) {
  process.stderr.write(`No cached content found for: ${contentId}\n`);
  process.exit(2);
}

process.stdout.write(content);
