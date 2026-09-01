// Ad-hoc check: run ONLY the flyer-meta call (store + validity window) against
// page 1 of one or more PDFs, and print what Gemini returns plus token usage.
// Does NOT touch the DB and does NOT run product extraction.
//
//   node scripts/test-flyer-meta.mjs <file1.pdf> [file2.pdf ...]

import '../src/loadEnv.js';
import {basename} from 'node:path';
import {readFileSync} from 'node:fs';

import {renderPdf} from '../src/pdf.js';
import {extractFlyerMeta} from '../src/gemini.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/test-flyer-meta.mjs <file.pdf> ...');
  process.exit(1);
}

const totals = {calls: 0, promptTokens: 0, promptImageTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0};

for (const f of files) {
  const buf = readFileSync(f);
  const {pages} = renderPdf(buf, {maxPages: 1});
  const started = Date.now();
  const {meta, usage} = await extractFlyerMeta(pages[0].jpegBase64);
  const ms = Date.now() - started;

  console.log(`\n=== ${basename(f)} ===`);
  console.log(`  page 1 image: ${pages[0].width}x${pages[0].height}`);
  console.log(`  store:      ${JSON.stringify(meta.store)}`);
  console.log(`  validFrom:  ${meta.validFrom || '(none)'}`);
  console.log(`  validTo:    ${meta.validTo || '(none)'}`);
  console.log(`  confidence: ${meta.confidence ?? '(none)'}`);
  console.log(
    `  tokens:     prompt ${usage.promptTokens} (text ${usage.promptTextTokens}, image ${usage.promptImageTokens})  ` +
      `output ${usage.outputTokens}  thoughts ${usage.thoughtsTokens}  total ${usage.totalTokens}  (${(ms / 1000).toFixed(1)}s)`,
  );

  totals.calls++;
  totals.promptTokens += usage.promptTokens || 0;
  totals.promptImageTokens += usage.promptImageTokens || 0;
  totals.outputTokens += usage.outputTokens || 0;
  totals.thoughtsTokens += usage.thoughtsTokens || 0;
  totals.totalTokens += usage.totalTokens || 0;
}

console.log(`\n--- TOTAL over ${totals.calls} call(s) ---`);
console.log(
  `  prompt ${totals.promptTokens} (image ${totals.promptImageTokens})  ` +
    `output ${totals.outputTokens}  thoughts ${totals.thoughtsTokens}  total ${totals.totalTokens}`,
);
console.log(
  `  average/flyer: ${Math.round(totals.totalTokens / totals.calls)} total tokens`,
);
