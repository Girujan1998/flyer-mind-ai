// Cross-flyer product identity: groups `products` rows (one per flyer
// sighting) into `canonical_products` so price history/trends/deal-quality
// mean anything. Two stages per product still missing a link:
//
//   1. Cheap SQL shortlist (db.js canonicalCandidatesForProduct) — same
//      department, category/tag overlap against existing canonical products.
//      Category text alone is never trusted enough to auto-link (a
//      brand-stripped category like "chips" covers Lay's, Pringles and a
//      Frito-Lay variety pack at wildly different prices) — this only
//      narrows the field.
//   2. Every product batches into one Gemini call (gemini.js
//      matchCanonicalProducts), which sees the full product NAME and decides
//      whether it's really the same thing as one of its candidates, or
//      proposes a new canonical product.
//
// Shared by the one-off backfill script (server/scripts/match-canonical-products.mjs)
// and the fire-and-forget pass index.js kicks off after every upload.

import {
  applyCanonicalMatches,
  canonicalCandidatesForProduct,
  productsMissingCanonical,
} from './db.js';
import {matchCanonicalProducts} from './gemini.js';

const START_BATCH = 40;

/**
 * Runs until no products are left without a canonical link (or one dry-run
 * batch, with `dry: true`). Returns `{ done, created, calls, tokens }`.
 */
export async function runCanonicalMatchingBatch({
  batchSize = START_BATCH,
  dry = false,
  log = console.log,
} = {}) {
  let size = batchSize;
  let done = 0;
  let created = 0;
  let calls = 0;
  let tokens = 0;

  for (;;) {
    const rows = productsMissingCanonical(size);
    if (!rows.length) {
      break;
    }

    const withCandidates = rows.map(r => ({
      ...r,
      candidates: canonicalCandidatesForProduct(r, 5),
    }));

    const items = withCandidates.map((r, i) => ({
      ref: i + 1,
      name: r.name,
      info: r.info || '',
      category: r.category || '',
      candidates: r.candidates.map((c, j) => ({
        ref: j + 1,
        canonicalName: c.canonicalName,
        category: c.category,
      })),
    }));

    const {result, usage} = await matchCanonicalProducts(items);
    calls++;
    tokens += usage?.totalTokens || 0;

    const matches = withCandidates
      .map((r, i) => {
        const m = result.get(i + 1);
        if (!m) {
          return null;
        }
        const picked = m.matchRef > 0 ? r.candidates[m.matchRef - 1] : null;
        return picked
          ? {productId: r.id, canonicalId: picked.id, priceValue: r.price_value, store: r.store}
          : {
              productId: r.id,
              newCanonical: {
                canonicalName: m.canonicalName || r.category || r.name,
                category: r.category || '',
                department: r.department || '',
                tags: r.tags ? JSON.parse(r.tags) : [],
              },
              priceValue: r.price_value,
              store: r.store,
            };
      })
      .filter(Boolean);

    const linked = matches.filter(m => m.canonicalId).length;
    log(
      `canonical-match batch (size ${rows.length}): ${linked} linked to an existing product, ` +
        `${matches.length - linked} new canonical product(s)`,
    );

    if (!dry) {
      const result = applyCanonicalMatches(matches);
      created += result.createdCount;
    }
    done += matches.length;

    if (dry) {
      log('(--dry: not written; stopping after one batch)');
      break;
    }

    if (matches.length === 0) {
      if (size <= 5) {
        log(`stuck on ${rows.length} row(s) even at size ${size} — stopping. Re-run later.`);
        break;
      }
      size = Math.max(5, Math.floor(size / 3));
      log(`  → retrying with smaller batches (size ${size})`);
    } else if (matches.length === rows.length && size < batchSize) {
      size = Math.min(batchSize, size * 2);
    }
  }

  return {done, created, calls, tokens};
}
