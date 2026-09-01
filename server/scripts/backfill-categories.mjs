// Give already-stored products a generic "category" + search "tags" without
// re-rasterising or re-running vision. Text-only Gemini calls over product
// names, in batches, until every row has a category.
//
//   node scripts/backfill-categories.mjs [--batch 60] [--dry]

import '../src/loadEnv.js';

import {productsMissingCategory, applyCategories} from '../src/db.js';
import {categorizeProducts} from '../src/gemini.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const batchArg = args.indexOf('--batch');
const BATCH = batchArg >= 0 ? Math.max(1, +args[batchArg + 1] || 60) : 60;

let done = 0;
let calls = 0;
let tokens = 0;

for (;;) {
  const rows = productsMissingCategory(BATCH);
  if (!rows.length) {
    break;
  }

  const items = rows.map((r, i) => ({
    ref: i + 1,
    name: r.name,
    info: r.info || '',
  }));

  const {result, usage} = await categorizeProducts(items);
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
    `batch ${calls}: ${updates.length}/${rows.length} categorised` +
      (sample ? `  — ${sample}` : ''),
  );

  if (!dry) {
    applyCategories(updates);
  }
  done += updates.length;

  if (updates.length === 0) {
    console.warn(
      'no rows categorised this batch — stopping so we do not loop forever',
    );
    break;
  }
  if (dry) {
    console.log('(--dry: not written; stopping after one batch)');
    break;
  }
}

console.log(
  `\ndone: ${done} product(s) updated · ${calls} Gemini call(s) · ${tokens} tokens`,
);
