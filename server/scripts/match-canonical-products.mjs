// Link every already-stored product to a canonical product (the cross-flyer
// identity price history/trends/deal-quality depend on) — a cheap SQL
// shortlist first, Gemini disambiguation only for what's still ambiguous.
//
//   node scripts/match-canonical-products.mjs [--batch 40] [--dry]

import '../src/loadEnv.js';

import {runCanonicalMatchingBatch} from '../src/canonicalMatch.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const batchArg = args.indexOf('--batch');
const batchSize = batchArg >= 0 ? Math.max(1, +args[batchArg + 1] || 40) : 40;

const {done, created, calls, tokens} = await runCanonicalMatchingBatch({
  batchSize,
  dry,
});

console.log(
  `\ndone: ${done} product(s) linked · ${created} new canonical product(s) · ` +
    `${calls} Gemini call(s) · ${tokens} tokens`,
);
