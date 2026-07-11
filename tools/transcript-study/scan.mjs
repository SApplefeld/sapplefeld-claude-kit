// Transcript-share scanner: main sessions + per-session subagents/, per-call
// billed usage with cache TTL split, compaction events, skill invocations.
// Usage: node scan.mjs <transcript-root> <output.json>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = process.argv[2];
if (!ROOT || !fs.existsSync(ROOT)) {
  console.error('Usage: node scan.mjs <transcript-root> <output.json>');
  process.exit(1);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => {
      if (typeof b === 'string') return b;
      if (b.type === 'text') return b.text || '';
      if (b.type === 'tool_result') {
        const c = b.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.map(x => x.text || '').join('\n');
      }
      return '';
    }).join('\n');
  }
  return '';
}

async function scanFile(file, kind, parentSession) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  const out = {
    file: path.basename(file), kind, parentSession,
    rows: 0, calls: [],
    compactLaunches: [], destinations: [], skillInvocations: [],
    omissionNotices: 0, nativeCompactions: 0,
    firstUserSnippet: null,
  };
  const seen = new Set();
  const seenLaunch = new Set();
  for await (const line of rl) {
    if (!line.trim()) continue;
    out.rows++;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const t = row.type || '?';
    if (row.subtype === 'compact_boundary' || row.compactMetadata) out.nativeCompactions++;
    const msg = row.message;
    if (t === 'assistant' && msg && msg.usage) {
      const u = msg.usage;
      const cw5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
      const cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const cw = (u.cache_creation_input_tokens ?? 0) || (cw5 + cw1h);
      const id = msg.id || `${row.timestamp}|${u.input_tokens}|${u.output_tokens}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.calls.push({
          id, ts: row.timestamp, model: msg.model || '?',
          in: u.input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw, cw1h,
          out: u.output_tokens ?? 0, side: !!row.isSidechain,
        });
      } else {
        const c = out.calls[out.calls.length - 1];
        if (c && c.id === id && (u.output_tokens ?? 0) > c.out) c.out = u.output_tokens;
      }
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type === 'tool_use' && (b.name === 'Bash' || b.name === 'PowerShell') && typeof b.input?.command === 'string' && b.input.command.includes('compact-cli.ts')) {
            const key = row.timestamp + '|' + b.input.command.slice(0, 80);
            if (!seenLaunch.has(key)) { seenLaunch.add(key); out.compactLaunches.push({ ts: row.timestamp, cmd: b.input.command.slice(0, 400) }); }
          }
          if (b.type === 'tool_use' && b.name === 'Skill' && b.input?.skill) {
            out.skillInvocations.push({ ts: row.timestamp, skill: b.input.skill });
          }
        }
      }
    }
    if (t === 'user' && msg) {
      const txt = textOf(msg.content);
      if (out.firstUserSnippet === null && txt.trim()) out.firstUserSnippet = txt.slice(0, 500);
      if (txt.includes('destinationSessionId')) {
        const m = txt.match(/destinationSessionId["\s:]+([0-9a-f-]{36})/);
        if (m) out.destinations.push({ ts: row.timestamp, destId: m[1] });
      }
      if (/omitted-\d+/.test(txt)) out.omissionNotices++;
    }
    if (t === 'queue-operation' && out.firstUserSnippet === null && row.content) {
      out.firstUserSnippet = String(row.content).slice(0, 500);
    }
  }
  return out;
}

const results = { folders: {} };
for (const folder of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, folder);
  if (!fs.statSync(dir).isDirectory()) continue;
  const entry = { sessions: [], subagents: [] };
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f.endsWith('.jsonl') && fs.statSync(p).isFile()) {
      entry.sessions.push(await scanFile(p, 'main', null));
    } else if (fs.statSync(p).isDirectory()) {
      const subDir = path.join(p, 'subagents');
      if (fs.existsSync(subDir)) {
        for (const sf of fs.readdirSync(subDir).filter(x => x.endsWith('.jsonl'))) {
          entry.subagents.push(await scanFile(path.join(subDir, sf), 'subagent', f));
        }
      }
    }
  }
  results.folders[folder] = entry;
  console.error(`${folder}: ${entry.sessions.length} sessions, ${entry.subagents.length} subagent files`);
}

fs.writeFileSync(process.argv[3] || 'scan-results.json', JSON.stringify(results));
console.error('done');
