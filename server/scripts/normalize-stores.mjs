// One-time cleanup for flyers stored before store-name normalization existed
// (e.g. "NOFRILLS" and "No Frills" as two separate values). Purely
// deterministic — no Gemini call, safe to re-run any time.
//
//   node scripts/normalize-stores.mjs

import '../src/loadEnv.js';

import {distinctStores, renameStore} from '../src/db.js';
import {normalizeStore} from '../src/stores.js';

let changed = 0;
for (const raw of distinctStores()) {
  const normalized = normalizeStore(raw);
  if (normalized && normalized !== raw) {
    const n = renameStore(raw, normalized);
    console.log(`"${raw}" -> "${normalized}" (${n} flyer(s))`);
    changed += n;
  }
}

console.log(changed ? `\ndone: ${changed} flyer row(s) updated` : 'nothing to normalize');
