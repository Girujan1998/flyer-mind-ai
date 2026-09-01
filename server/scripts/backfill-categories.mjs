// Give already-stored products a generic "category" + search "tags" without
// re-rasterising or re-running vision. Text-only Gemini calls over product
// names, in batches, until every row has a category.
//
//   node scripts/backfill-categories.mjs [--batch 40] [--dry]

import '../src/loadEnv.js';

import {productsMissingCategory, applyCategories} from '../src/db.js';
import {categorizeProducts} from '../src/gemini.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const batchArg = args.indexOf('--batch');
const START_BATCH = batchArg >= 0 ? Math.max(1, +args[batchArg + 1] || 40) : 40;

let done = 0;
let calls = 0;
let tokens = 0;
let size = START_BATCH;

for (;;) {
  const rows = productsMissingCategory(size);
  if (!rows.length) {
    break;
  }

  const items = rows.map((r, i) => ({
    ref: i + 1,
    name: r.name,
    info: r.info || '',
  }));

  const {result, usage, finishReason} = await categorizeProducts(items);
  calls++;
  tokens += usage?.totalTokens || 0;

  const updates = rows
    .map((r, i) => {
      const c = result.get(i + 1);
      return c && c.category
        ? {id: r.id, category: c.category, tags: c.tags}
        : null;
    })
    .filter(Boolean);

  const sample = updates
    .slice(0, 3)
    .map(u => `${u.category}${u.tags.length ? ` [${u.tags.join(', ')}]` : ''}`)
    .join('  ·  ');
  console.log(
    `batch ${calls} (size ${rows.length}): ${updates.length} categorised` +
      (finishReason && finishReason !== 'STOP' ? ` [${finishReason}]` : '') +
      (sample ? `  — ${sample}` : ''),
  );

  if (!dry) {
    applyCategories(updates);
  }
  done += updates.length;

  if (dry) {
    console.log('(--dry: not written; stopping after one batch)');
    break;
  }

  if (updates.length === 0) {
    // The model gave us nothing usable for this slice. Shrink and retry;
    // give up only once we are already down to a tiny batch.
    if (size <= 5) {
      console.warn(
        `stuck on ${rows.length} row(s) even at size ${size} — stopping. ` +
          'Re-run later to retry them.',
      );
      break;
    }
    size = Math.max(5, Math.floor(size / 3));
    console.warn(`  → retrying with smaller batches (size ${size})`);
  } else if (updates.length === rows.length && size < START_BATCH) {
    size = Math.min(START_BATCH, size * 2); // recovered — grow back
  }
}

console.log(
  `\ndone: ${done} product(s) updated · ${calls} Gemini call(s) · ${tokens} tokens`,
);
