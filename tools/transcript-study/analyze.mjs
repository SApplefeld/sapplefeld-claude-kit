// Cost-structure analysis over scan.mjs output: main-model choice, chain vs
// subagents, reviewer tiers, cache behavior, cold rebuilds.
// Usage: node analyze.mjs <scan-results.json> > analysis.json
// Prices are $/MTok, validated 2026-07-10 against real /usage dollar totals
// (Opus/Sonnet/Haiku reproduced exactly; Fable calibrated to ~3%). Re-check
// against a current /usage block before trusting absolute dollars.
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const PRICE = {
  'claude-fable-5':   { in: 11.5, cr: 1.15, cw: 14.375, out: 57.5 },
  'claude-opus-4-8':  { in: 5,    cr: 0.5,  cw: 6.25,   out: 25 },
  'claude-sonnet-5':  { in: 3,    cr: 0.3,  cw: 3.75,   out: 15 },
  'claude-haiku-4-5': { in: 1,    cr: 0.1,  cw: 1.25,   out: 5 },
};
const unknownModels = new Set();
function price(model) {
  for (const k of Object.keys(PRICE)) if (model.startsWith(k)) return PRICE[k];
  // A silent fallback would deflate the totals for a model id outside the
  // table; announce it so a mis-priced run is visible. Harness placeholder
  // ids like <synthetic> are not real models and stay quiet.
  if (!model.startsWith('<') && !unknownModels.has(model)) {
    unknownModels.add(model);
    console.error(`WARNING: unknown model id "${model}" priced at Sonnet rates; update PRICE.`);
  }
  return PRICE['claude-sonnet-5'];
}
const cost = c => (c.in * price(c.model).in + c.cr * price(c.model).cr + c.cw * price(c.model).cw + c.out * price(c.model).out) / 1e6;
const ctx = c => c.in + c.cr + c.cw;
const tier = m => m.startsWith('claude-fable') ? 'fable' : m.startsWith('claude-opus') ? 'opus' : m.startsWith('claude-sonnet') ? 'sonnet' : m.startsWith('claude-haiku') ? 'haiku' : 'other';

function classify(snippet) {
  const s = (snippet || '').toLowerCase();
  if (/owasp|security[- ]review/.test(s)) return 'security-review';
  if (/adversarial|spec compliance/.test(s)) return 'adversarial-review';
  if (/reviewing without the intent|diff-only review|without the spec/.test(s)) return 'blind-review';
  if (/acceptance criter|qa-verif|behavioral verification/.test(s)) return 'qa-verify';
  if (/drift report|docs-curator|curate|update the project's docs/.test(s)) return 'docs';
  if (/section of work|task brief|implement section|implementer|build the section|section name/.test(s)) return 'implementer';
  if (/lens|council|converg|take a position/.test(s)) return 'council';
  if (/search for|find every|locate|map the|explore/.test(s)) return 'scout';
  return 'other';
}

const mainById = {};
for (const [folder, entry] of Object.entries(data.folders)) {
  for (const s of entry.sessions) {
    s.folder = folder;
    s.subs = [];
    mainById[s.file.replace('.jsonl', '')] = s;
  }
}
for (const [, entry] of Object.entries(data.folders)) {
  for (const sub of entry.subagents) {
    const parent = mainById[sub.parentSession];
    if (parent) parent.subs.push(sub);
  }
}

// Global dedupe for corpus totals (compacted destinations copy history rows).
const seen = new Set();
const corpus = {
  mainByTier: {}, subByTier: {}, over150kCost: 0, totalCost: 0,
  coldRebuildCost: 0, coldEvents: 0, cw1hTokens: 0, cwTokens: 0,
  subByClass: {},
};
const sessions = [];
const ordered = Object.values(mainById).sort((a, b) => ((a.calls[0] || {}).ts || '') < ((b.calls[0] || {}).ts || '') ? -1 : 1);
for (const s of ordered) {
  const main = s.calls.filter(c => !c.side && c.model.startsWith('claude-'));
  const fresh = main.filter(c => !seen.has(c.id));
  main.forEach(c => seen.add(c.id));
  let mCost = 0, hiCost = 0, peak = 0, ctxSum = 0, cold = 0, coldCost = 0;
  const models = {};
  for (const c of fresh) {
    const cc = cost(c);
    mCost += cc; ctxSum += ctx(c);
    corpus.cwTokens += c.cw; corpus.cw1hTokens += c.cw1h || 0;
    if (ctx(c) > 150000) hiCost += cc;
    if (ctx(c) > peak) peak = ctx(c);
    models[tier(c.model)] = (models[tier(c.model)] || 0) + 1;
    // Cold rebuild: most of the context re-written to cache (miss), not warm.
    if (c.cw > 0.6 * ctx(c) && ctx(c) > 50000) {
      cold++; coldCost += (c.cw * price(c.model).cw) / 1e6;
      corpus.coldEvents++; corpus.coldRebuildCost += (c.cw * price(c.model).cw) / 1e6;
    }
  }
  const domTier = Object.entries(models).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '?';
  corpus.mainByTier[domTier] = (corpus.mainByTier[domTier] || 0) + mCost;
  corpus.totalCost += mCost; corpus.over150kCost += hiCost;

  let subCost = 0;
  const subClasses = {};
  for (const sub of s.subs) {
    let sc = 0;
    const subModels = {};
    for (const c of sub.calls) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const cc = cost(c);
      sc += cc;
      subModels[tier(c.model)] = (subModels[tier(c.model)] || 0) + 1;
      corpus.subByTier[tier(c.model)] = (corpus.subByTier[tier(c.model)] || 0) + cc;
      corpus.totalCost += cc;
      if (ctx(c) > 150000) corpus.over150kCost += cc;
    }
    subCost += sc;
    const cls = classify(sub.firstUserSnippet);
    const domSubTier = Object.entries(subModels).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '?';
    const key = `${cls}|${domSubTier}`;
    subClasses[cls] = (subClasses[cls] || 0) + sc;
    if (!corpus.subByClass[key]) corpus.subByClass[key] = { cost: 0, n: 0 };
    corpus.subByClass[key].cost += sc; corpus.subByClass[key].n++;
  }

  const snippet = (s.firstUserSnippet || '');
  sessions.push({
    folder: s.folder, id: s.file.slice(0, 8),
    tier: domTier, mainCalls: fresh.length,
    mainCost: +mCost.toFixed(2), subCost: +subCost.toFixed(2), subN: s.subs.length,
    subClasses: Object.fromEntries(Object.entries(subClasses).map(([k, v]) => [k, +v.toFixed(2)])),
    peakK: Math.round(peak / 1000), avgK: fresh.length ? Math.round(ctxSum / fresh.length / 1000) : 0,
    hiCost: +hiCost.toFixed(2), cold, coldCost: +coldCost.toFixed(2),
    launches: s.compactLaunches.length, native: s.nativeCompactions, dest: s.omissionNotices > 0,
    chainWorker: /chain-mode worker/i.test(snippet),
    firstTs: (s.calls[0] || {}).ts || null,
  });
}
sessions.sort((a, b) => (b.mainCost + b.subCost) - (a.mainCost + a.subCost));

for (const k of Object.keys(corpus)) {
  if (typeof corpus[k] === 'number') corpus[k] = +corpus[k].toFixed(2);
}
for (const k of Object.keys(corpus.mainByTier)) corpus.mainByTier[k] = +corpus.mainByTier[k].toFixed(2);
for (const k of Object.keys(corpus.subByTier)) corpus.subByTier[k] = +corpus.subByTier[k].toFixed(2);
for (const k of Object.keys(corpus.subByClass)) corpus.subByClass[k].cost = +corpus.subByClass[k].cost.toFixed(2);

console.log(JSON.stringify({ corpus, top: sessions.slice(0, 25) }, null, 1));
