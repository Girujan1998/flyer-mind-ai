// Give already-stored products a coarse "department" (store aisle). Cheap:
// pass 1 assigns a department to each DISTINCT category and bulk-applies it to
// every product sharing that category; pass 2 mops up anything with no category
// by looking at the name. Run backfill-categories.mjs first.
//
//   node scripts/backfill-departments.mjs [--batch 50] [--dry]

import '../src/loadEnv.js';

import {
  distinctCategoriesMissingDepartment,
  productsMissingDepartment,
  applyDepartmentsByCategory,
  applyDepartmentsById,
} from '../src/db.js';
import {assignDepartments} from '../src/gemini.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bArg = args.indexOf('--batch');
const START = bArg >= 0 ? Math.max(1, +args[bArg + 1] || 50) : 50;

let calls = 0;
let tokens = 0;

async function runPass(label, load, apply, textOf) {
  let size = START;
  let done = 0;
  for (;;) {
    const rows = load(size);
    if (!rows.length) break;

    const items = rows.map((r, i) => ({ref: i + 1, text: textOf(r)}));
    const {result, usage, finishReason} = await assignDepartments(items);
    calls++;
    tokens += usage?.totalTokens || 0;

    const updates = rows
      .map((r, i) => {
        const d = result.get(i + 1);
        return d ? {...r, department: d} : null;
      })
      .filter(Boolean);

    const sample = updates
      .slice(0, 4)
      .map(u => `${textOf(u)} -> ${u.department}`)
      .join('  ·  ');
    console.log(
      `${label} batch ${calls} (size ${rows.length}): ${updates.length} assigned` +
        (finishReason && finishReason !== 'STOP' ? ` [${finishReason}]` : '') +
        (sample ? `  — ${sample}` : ''),
    );

    if (!dry) apply(updates);
    done += updates.length;

    if (dry) {
      console.log('(--dry: not written; stopping after one batch)');
      break;
    }
    if (updates.length === 0) {
      if (size <= 5) {
        console.warn(`${label}: stuck on ${rows.length} row(s) — stopping.`);
        break;
      }
      size = Math.max(5, Math.floor(size / 3));
      console.warn(`  → retrying with smaller batches (size ${size})`);
    } else if (updates.length === rows.length && size < START) {
      size = Math.min(START, size * 2);
    }
  }
  return done;
}

const byCat = await runPass(
  'categories',
  distinctCategoriesMissingDepartment,
  applyDepartmentsByCategory,
  r => r.category,
);

const byName = dry
  ? 0
  : await runPass(
      'leftovers',
      productsMissingDepartment,
      applyDepartmentsById,
      r => r.name,
    );

console.log(
  `\ndone: ${byCat} categor${byCat === 1 ? 'y' : 'ies'} + ${byName} loose ` +
    `product(s) departmented · ${calls} Gemini call(s) · ${tokens} tokens`,
);
