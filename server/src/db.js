// Persistent store for extracted products. SQLite (better-sqlite3) at
// data/flyer.db; page JPEGs at data/pages/<flyerId>/<page>.jpg and per-product
// crop thumbnails at data/thumbs/<flyerId>/<productId>.jpg. data/ is gitignored.

import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import Database from 'better-sqlite3';

import {isDepartment, matchDepartments} from './departments.js';

/** Classification of the Search-box text, memoised by the normalised query. */
const _classCache = new Map();

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const PAGES_DIR = join(DATA_DIR, 'pages');
export const THUMBS_DIR = join(DATA_DIR, 'thumbs');
mkdirSync(PAGES_DIR, {recursive: true});
mkdirSync(THUMBS_DIR, {recursive: true});

const db = new Database(join(DATA_DIR, 'flyer.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Whole-word matcher for the chat expansion search: `needle` must appear as a
// full word or phrase in `haystack` (a trailing plural s/es is tolerated). Keeps
// a clipped term like "roma" matching "roma tomato" while rejecting "Romaine",
// "Roman" and the "aromatics" tag; "vine" no longer matches "Vinegar".
const _wordRe = new Map();
db.function('wordmatch', {deterministic: true}, (haystack, needle) => {
  if (!haystack || !needle) {
    return 0;
  }
  const key = String(needle);
  let re = _wordRe.get(key);
  if (!re) {
    const n = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|[^a-z0-9])${n}(?:e?s)?(?:$|[^a-z0-9])`);
    if (_wordRe.size > 400) {
      _wordRe.clear();
    }
    _wordRe.set(key, re);
  }
  return re.test(String(haystack).toLowerCase()) ? 1 : 0;
});

// Like `wordmatch` but `needle` must be the HEAD (last word/phrase) of `haystack`.
// A chat search for "milk" then means a product whose category IS milk
// ("chocolate milk", "plant-based milk") — not "milk cake" or "ice cream".
const _headRe = new Map();
db.function('headmatch', {deterministic: true}, (haystack, needle) => {
  if (!haystack || !needle) {
    return 0;
  }
  const key = String(needle);
  let re = _headRe.get(key);
  if (!re) {
    const n = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|[^a-z0-9])${n}(?:e?s)?\\s*$`);
    if (_headRe.size > 400) {
      _headRe.clear();
    }
    _headRe.set(key, re);
  }
  return re.test(String(haystack).toLowerCase()) ? 1 : 0;
});

// True when `needle` is a COMPLETE quoted entry in the `tags` JSON string
// (plural-tolerant). Lets item-scope search fall back to tags when the category
// is a generic aisle word ("vegetables" -> tag "onions"), while NOT matching a
// multi-word tag like "ice milk" for the needle "milk".
db.function('tagexact', {deterministic: true}, (tags, needle) => {
  if (!tags || !needle) {
    return 0;
  }
  const h = String(tags).toLowerCase();
  const n = String(needle).toLowerCase();
  return h.includes(`"${n}"`) ||
    h.includes(`"${n}s"`) ||
    h.includes(`"${n}es"`)
    ? 1
    : 0;
});

db.exec(`
  CREATE TABLE IF NOT EXISTS flyers (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    hash           TEXT UNIQUE,
    total_pages    INTEGER,
    rendered_pages INTEGER,
    store          TEXT,
    valid_from     TEXT,
    valid_to       TEXT,
    meta_confidence INTEGER,
    created_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    flyer_id TEXT NOT NULL REFERENCES flyers(id) ON DELETE CASCADE,
    page     INTEGER NOT NULL,
    width    INTEGER NOT NULL,
    height   INTEGER NOT NULL,
    PRIMARY KEY (flyer_id, page)
  );
  CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    flyer_id    TEXT NOT NULL REFERENCES flyers(id) ON DELETE CASCADE,
    page        INTEGER NOT NULL,
    name        TEXT NOT NULL,
    price       TEXT,
    price_value REAL,
    info        TEXT,
    box         TEXT,
    confidence  INTEGER,
    category    TEXT,
    tags        TEXT,
    department  TEXT,
    was_price   TEXT,
    promo_text  TEXT,
    on_sale     INTEGER NOT NULL DEFAULT 0,
    has_thumb   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_products_department ON products(department);
  CREATE INDEX IF NOT EXISTS idx_flyers_valid ON flyers(valid_from, valid_to);

  -- A "canonical product" is the real-world item (e.g. "strawberries") that
  -- many products rows — one per flyer sighting, possibly with a different
  -- category string each time — get linked to via products.canonical_product_id.
  -- This is what makes price history / trends / deal-quality possible: those
  -- features group sightings by canonical product, not by raw category text.
  CREATE TABLE IF NOT EXISTS canonical_products (
    id             TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    category       TEXT,
    department     TEXT,
    tags           TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_canonical_department ON canonical_products(department);

  -- Anonymous per-install identity (no login) — just enough to own alerts.
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS price_alerts (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(id),
    canonical_product_id TEXT NOT NULL REFERENCES canonical_products(id),
    target_price         REAL NOT NULL,
    comparison           TEXT NOT NULL DEFAULT 'lte',
    store                TEXT,
    created_at           TEXT NOT NULL,
    resolved_at          TEXT,
    resolved_product_id  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_canonical ON price_alerts(canonical_product_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id);
`);

// Backfill columns onto a database created before they existed.
for (const [table, col] of [
  ['flyers', 'store TEXT'],
  ['flyers', 'valid_from TEXT'],
  ['flyers', 'valid_to TEXT'],
  ['flyers', 'meta_confidence INTEGER'],
  ['products', 'category TEXT'],
  ['products', 'tags TEXT'],
  ['products', 'department TEXT'],
  ['products', 'was_price TEXT'],
  ['products', 'promo_text TEXT'],
  ['products', 'on_sale INTEGER NOT NULL DEFAULT 0'],
  ['products', 'canonical_product_id TEXT REFERENCES canonical_products(id)'],
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  } catch {
    // already there
  }
}

// Only safe to create once the ALTER above has run on an old DB.
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_products_canonical ON products(canonical_product_id)',
);

const stmts = {
  flyerByHash: db.prepare('SELECT * FROM flyers WHERE hash = ?'),
  insertFlyer: db.prepare(
    `INSERT INTO flyers
       (id, name, hash, total_pages, rendered_pages, store, valid_from, valid_to, meta_confidence, created_at)
     VALUES
       (@id, @name, @hash, @total_pages, @rendered_pages, @store, @valid_from, @valid_to, @meta_confidence, @created_at)`,
  ),
  insertPage: db.prepare(
    `INSERT INTO pages (flyer_id, page, width, height)
     VALUES (@flyer_id, @page, @width, @height)`,
  ),
  insertProduct: db.prepare(
    `INSERT INTO products
       (id, flyer_id, page, name, price, price_value, info, box, confidence, category, tags, department, was_price, promo_text, on_sale, has_thumb, created_at)
     VALUES
       (@id, @flyer_id, @page, @name, @price, @price_value, @info, @box, @confidence, @category, @tags, @department, @was_price, @promo_text, @on_sale, @has_thumb, @created_at)`,
  ),
  updateCategory: db.prepare(
    'UPDATE products SET category = @category, tags = @tags WHERE id = @id',
  ),
  missingCategory: db.prepare(
    `SELECT id, name, info FROM products
      WHERE category IS NULL OR category = ''
      ORDER BY rowid
      LIMIT ?`,
  ),
  updateDepartmentById: db.prepare(
    'UPDATE products SET department = @department WHERE id = @id',
  ),
  updateDepartmentByCategory: db.prepare(
    `UPDATE products SET department = @department
      WHERE category = @category AND (department IS NULL OR department = '')`,
  ),
  distinctCategoriesMissingDept: db.prepare(
    `SELECT category, COUNT(*) AS n FROM products
      WHERE category IS NOT NULL AND category <> ''
        AND (department IS NULL OR department = '')
      GROUP BY category
      ORDER BY n DESC
      LIMIT ?`,
  ),
  productsMissingDept: db.prepare(
    `SELECT id, name FROM products
      WHERE department IS NULL OR department = ''
      ORDER BY rowid
      LIMIT ?`,
  ),
  departmentCounts: db.prepare(
    `SELECT department, COUNT(*) AS n FROM products
      WHERE department IS NOT NULL AND department <> ''
      GROUP BY department
      ORDER BY n DESC`,
  ),
  countProducts: db.prepare('SELECT COUNT(*) AS n FROM products'),
  productsForFlyer: db.prepare(
    'SELECT COUNT(*) AS n FROM products WHERE flyer_id = ?',
  ),

  // --- canonical products (cross-flyer product identity) -------------------
  missingCanonical: db.prepare(
    `SELECT p.id, p.name, p.info, p.category, p.tags, p.department,
            p.price_value, f.store
       FROM products p JOIN flyers f ON f.id = p.flyer_id
      WHERE p.canonical_product_id IS NULL
        AND p.category IS NOT NULL AND p.category <> ''
        AND p.department IS NOT NULL AND p.department <> ''
      ORDER BY p.rowid
      LIMIT ?`,
  ),
  insertCanonicalProduct: db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, department, tags, created_at)
     VALUES (@id, @canonical_name, @category, @department, @tags, @created_at)`,
  ),
  updateProductCanonical: db.prepare(
    'UPDATE products SET canonical_product_id = @canonical_product_id WHERE id = @id',
  ),
  canonicalExactCategory: db.prepare(
    `SELECT id, canonical_name, category FROM canonical_products
      WHERE department = @department AND lower(canonical_name) = @category
      LIMIT 5`,
  ),
  canonicalHeadMatch: db.prepare(
    `SELECT id, canonical_name, category FROM canonical_products
      WHERE department = @department AND headmatch(lower(canonical_name), @needle)
      LIMIT 5`,
  ),
  canonicalTagMatch: db.prepare(
    `SELECT id, canonical_name, category FROM canonical_products
      WHERE department = @department AND tagexact(coalesce(tags,''), @needle)
      LIMIT 5`,
  ),

  // --- users / alerts --------------------------------------------------------
  insertUserIgnore: db.prepare(
    'INSERT OR IGNORE INTO users (id, created_at) VALUES (@id, @created_at)',
  ),
  insertAlert: db.prepare(
    `INSERT INTO price_alerts
       (id, user_id, canonical_product_id, target_price, comparison, store, created_at)
     VALUES
       (@id, @user_id, @canonical_product_id, @target_price, @comparison, @store, @created_at)`,
  ),
  listAlertsByUser: db.prepare(
    `SELECT a.id, a.canonical_product_id, cp.canonical_name, a.target_price,
            a.comparison, a.store, a.created_at, a.resolved_at, a.resolved_product_id
       FROM price_alerts a JOIN canonical_products cp ON cp.id = a.canonical_product_id
      WHERE a.user_id = @user_id
      ORDER BY (a.resolved_at IS NOT NULL), a.created_at DESC`,
  ),
  openAlertsForCanonical: db.prepare(
    `SELECT id, target_price, comparison, store FROM price_alerts
      WHERE canonical_product_id = @canonical_product_id AND resolved_at IS NULL`,
  ),
  resolveAlert: db.prepare(
    `UPDATE price_alerts SET resolved_at = @resolved_at, resolved_product_id = @resolved_product_id
      WHERE id = @id`,
  ),
};

export function findFlyerByHash(hash) {
  return stmts.flyerByHash.get(hash);
}

export function productCountForFlyer(flyerId) {
  return stmts.productsForFlyer.get(flyerId).n;
}

/** Every distinct retailer name currently stored — for the store-name backfill. */
export function distinctStores() {
  return db
    .prepare("SELECT DISTINCT store FROM flyers WHERE store IS NOT NULL AND store <> ''")
    .all()
    .map(r => r.store);
}

/** Rewrite every flyer carrying `oldValue` as its store to `newValue`. Returns the row count changed. */
export function renameStore(oldValue, newValue) {
  return db.prepare('UPDATE flyers SET store = ? WHERE store = ?').run(newValue, oldValue)
    .changes;
}

/**
 * Persist one extraction. `pages` carry `jpegBase64`; `products` are the shape
 * gemini.js returns; `thumbs` is a Map<productIndex, JPEG Buffer> from
 * renderThumbs(). Returns { flyerId, savedProducts }.
 */
export const saveExtraction = db.transaction(
  ({name, hash, totalPages, renderedPages, pages, products, thumbs, meta}) => {
    const flyerId = randomUUID();
    const now = new Date().toISOString();

    stmts.insertFlyer.run({
      id: flyerId,
      name,
      hash,
      total_pages: totalPages,
      rendered_pages: renderedPages,
      store: meta?.store || null,
      valid_from: meta?.validFrom || null,
      valid_to: meta?.validTo || null,
      meta_confidence: meta?.confidence ?? null,
      created_at: now,
    });

    const pageDir = join(PAGES_DIR, flyerId);
    mkdirSync(pageDir, {recursive: true});
    for (const p of pages) {
      stmts.insertPage.run({
        flyer_id: flyerId,
        page: p.page,
        width: p.width,
        height: p.height,
      });
      writeFileSync(join(pageDir, `${p.page}.jpg`), Buffer.from(p.jpegBase64, 'base64'));
    }

    const thumbDir = join(THUMBS_DIR, flyerId);
    mkdirSync(thumbDir, {recursive: true});

    let i = 0;
    for (const pr of products) {
      const id = `${flyerId}-${pr.page}-${i}`;
      const thumb = thumbs?.get(i);
      if (thumb) {
        writeFileSync(join(thumbDir, `${id}.jpg`), thumb);
      }
      stmts.insertProduct.run({
        id,
        flyer_id: flyerId,
        page: pr.page,
        name: titleCaseName(pr.name) || 'Unnamed item',
        price: pr.price || null,
        price_value: pr.priceValue ?? null,
        info: pr.info || null,
        box: pr.box ? JSON.stringify(pr.box) : null,
        confidence: pr.confidence ?? null,
        category: pr.category || null,
        tags: pr.tags && pr.tags.length ? JSON.stringify(pr.tags) : null,
        department: pr.department || null,
        was_price: pr.wasPrice || null,
        promo_text: pr.promoText || null,
        on_sale: pr.onSale ? 1 : 0,
        has_thumb: thumb ? 1 : 0,
        created_at: now,
      });
      i++;
    }

    _classCache.clear(); // new categories/tags may change how a query classifies
    return {flyerId, savedProducts: products.length};
  },
);

/** Products with no generic category yet — for the backfill script. */
export function productsMissingCategory(limit = 200) {
  return stmts.missingCategory.all(Math.max(1, Math.min(500, Number(limit) || 200)));
}

/** Write { id, category, tags: string[] } rows from the categoriser. */
export const applyCategories = db.transaction(rows => {
  for (const r of rows) {
    stmts.updateCategory.run({
      id: r.id,
      category: r.category || null,
      tags: r.tags && r.tags.length ? JSON.stringify(r.tags) : null,
    });
  }
  _classCache.clear();
});

/** Distinct categories whose products still have no department. */
export function distinctCategoriesMissingDepartment(limit = 400) {
  return stmts.distinctCategoriesMissingDept.all(
    Math.max(1, Math.min(1000, Number(limit) || 400)),
  );
}

/** Products with no category to lean on — department assigned from name. */
export function productsMissingDepartment(limit = 60) {
  return stmts.productsMissingDept.all(
    Math.max(1, Math.min(500, Number(limit) || 60)),
  );
}

/** Bulk-set department for every product sharing each { category, department }. */
export const applyDepartmentsByCategory = db.transaction(rows => {
  for (const r of rows) {
    if (r.department) {
      stmts.updateDepartmentByCategory.run({
        category: r.category,
        department: r.department,
      });
    }
  }
});

/** Set department on individual { id, department } rows. */
export const applyDepartmentsById = db.transaction(rows => {
  for (const r of rows) {
    if (r.department) {
      stmts.updateDepartmentById.run({id: r.id, department: r.department});
    }
  }
});

/** [{ department, count }] over every product that has one, busiest first. */
export function departmentCounts() {
  return stmts.departmentCounts.all().map(r => ({
    department: r.department,
    count: r.n,
  }));
}

// ---------------------------------------------------------------------------
// Canonical products — the cross-flyer identity layer. Every `products` row is
// a "sighting" (one flyer, one date, one store, one price) of a canonical
// product; price history / deal-quality / trends all group by
// canonical_product_id instead of the raw (per-flyer, free-text) category.
// ---------------------------------------------------------------------------

/** Products not yet linked to a canonical product — for the matching pass. */
export function productsMissingCanonical(limit = 40) {
  return stmts.missingCanonical.all(Math.max(1, Math.min(200, Number(limit) || 40)));
}

/**
 * A cheap SQL shortlist of existing canonical products this one might be —
 * same department only (never merge across departments), ranked by how the
 * product's `category` relates to each candidate's `canonical_name`/`tags`
 * using the same UDFs the Search tab already matches queries with.
 *
 * `category` text alone is NOT a safe identity signal — categories are
 * brand-stripped, so "Lay's chips", "Pringles Snack Stacks" and a 16-pack of
 * Frito-Lay variety bags can all share `category: "chips"` while being
 * completely different products at completely different prices. So this only
 * ever narrows the field; every candidate still goes to Gemini (which sees
 * the full product NAME) to confirm — see matchCanonicalProducts / db.js
 * canonicalMatch.js. No auto-link path exists on purpose.
 */
export function canonicalCandidatesForProduct(
  {category, department},
  limit = 5,
) {
  const dept = department || '';
  const cat = (category || '').toLowerCase().trim();
  if (!dept || !cat) {
    return [];
  }

  const seen = new Map();
  const add = rows => {
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.set(r.id, r);
      }
    }
  };
  add(stmts.canonicalExactCategory.all({department: dept, category: cat}));
  add(stmts.canonicalHeadMatch.all({department: dept, needle: cat}));
  add(stmts.canonicalTagMatch.all({department: dept, needle: cat}));

  return [...seen.values()].slice(0, limit).map(r => ({
    id: r.id,
    canonicalName: r.canonical_name,
    category: r.category || '',
  }));
}

/**
 * Write canonical-product matches. Each entry is either
 * `{ productId, canonicalId, priceValue, store }` (links to an existing
 * canonical product) or `{ productId, newCanonical: {canonicalName, category,
 * department, tags}, priceValue, store }` (creates one first). Also resolves
 * any open price alert on that canonical product this sighting's price
 * satisfies. Returns `{ createdCount }`.
 */
export const applyCanonicalMatches = db.transaction(matches => {
  let createdCount = 0;
  const now = new Date().toISOString();

  for (const m of matches) {
    let canonicalId = m.canonicalId || null;
    if (!canonicalId && m.newCanonical) {
      canonicalId = randomUUID();
      const nc = m.newCanonical;
      stmts.insertCanonicalProduct.run({
        id: canonicalId,
        canonical_name: nc.canonicalName,
        category: nc.category || null,
        department: nc.department || null,
        tags: nc.tags && nc.tags.length ? JSON.stringify(nc.tags) : null,
        created_at: now,
      });
      createdCount++;
    }
    if (!canonicalId) {
      continue;
    }

    stmts.updateProductCanonical.run({id: m.productId, canonical_product_id: canonicalId});

    if (m.priceValue == null) {
      continue;
    }
    for (const a of stmts.openAlertsForCanonical.all({
      canonical_product_id: canonicalId,
    })) {
      if (a.store && m.store && a.store.toLowerCase() !== String(m.store).toLowerCase()) {
        continue;
      }
      const hit =
        a.comparison === 'lt' ? m.priceValue < a.target_price : m.priceValue <= a.target_price;
      if (hit) {
        stmts.resolveAlert.run({
          id: a.id,
          resolved_at: now,
          resolved_product_id: m.productId,
        });
      }
    }
  }

  return {createdCount};
});

/** "YYYY-MM-DD" `n` days before today. */
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Chronological price sightings for one canonical product — or, given an
 * array, pooled across several (used to answer a generic ask like "tomatoes"
 * over every tomato variety at once rather than one arbitrary one) —
 * optionally narrowed to one store or the last `months` months.
 */
export function priceHistory(canonicalProductIdOrIds, {store, months} = {}) {
  const ids = Array.isArray(canonicalProductIdOrIds)
    ? canonicalProductIdOrIds
    : [canonicalProductIdOrIds];
  if (!ids.length) {
    return [];
  }
  const conds = [`p.canonical_product_id IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  if (store) {
    conds.push('f.store = ?');
    params.push(store);
  }
  if (months) {
    conds.push('(f.valid_from IS NULL OR f.valid_from = \'\' OR f.valid_from >= ?)');
    params.push(daysAgoIso(Math.round(Number(months) * 30.44)));
  }

  const rows = db
    .prepare(
      `SELECT p.price, p.price_value, p.on_sale, f.store, f.valid_from, f.valid_to,
              p.flyer_id, p.page
         FROM products p JOIN flyers f ON f.id = p.flyer_id
        WHERE ${conds.join(' AND ')}
        ORDER BY f.valid_from ASC, p.created_at ASC`,
    )
    .all(...params);

  return rows.map(r => ({
    price: r.price || '',
    priceValue: r.price_value,
    onSale: !!r.on_sale,
    store: r.store || '',
    validFrom: r.valid_from || '',
    validTo: r.valid_to || '',
    flyerId: r.flyer_id,
    page: r.page,
  }));
}

/**
 * How a flyer price is actually priced — "$3.17/lb" and "$5.99/3 lb" and
 * "$4.99 each" and "2/$7" are NOT directly comparable dollar figures even
 * though `price_value` is just a plain number for all four ("carrots" has
 * real sightings at 94¢/lb, $1.99, and $2.44 — mixing per-pound and flat
 * pricing under one price trend). Returns a short key: "<n>lb"/"<n>kg" for a
 * per-weight price (n = the pound/kilogram count it's priced per, 1 if none
 * is printed), "multi<n>" for a "n/$X" multi-buy, else "flat" (a plain
 * per-item/package price).
 */
function priceBasis(priceText) {
  const s = String(priceText || '').toLowerCase();
  // "$5.99/3 lb", "/3kg" — an explicit weight count right after the slash.
  let m = s.match(/\/\s*(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilograms?)\b/);
  if (m) {
    return `${m[1]}${m[2].startsWith('k') ? 'kg' : 'lb'}`;
  }
  // "$3.17/lb", "$11.98 lb" — per a single lb/kg, no count printed.
  m = s.match(/\b(lbs?|pounds?|kgs?|kilograms?)\b/);
  if (m) {
    return `1${m[1].startsWith('k') ? 'kg' : 'lb'}`;
  }
  // "2/$7", "3 for $4" — a multi-buy count.
  m = s.match(/(\d+)\s*\/\s*\$|(\d+)\s*for\s*\$/);
  if (m) {
    return `multi${m[1] || m[2]}`;
  }
  return 'flat';
}

/**
 * Deal-quality / lowest-price / trend / retailer-compare / sale-frequency, all
 * derived from the same sighting history — one aggregate so the client and the
 * chat agent can each pull whichever field they need. Accepts one canonical
 * product id or (to answer a generic ask across several varieties) an array.
 * Returns `null` when there's no history at all.
 */
export function priceInsight(canonicalProductIdOrIds, {store} = {}) {
  const history = priceHistory(canonicalProductIdOrIds, {store});
  const priced = history.filter(h => h.priceValue != null);
  if (!priced.length) {
    return null;
  }

  const current = priced[priced.length - 1];
  const windowCutoff = daysAgoIso(90);
  const windowRows = priced.filter(h => !h.validFrom || h.validFrom >= windowCutoff);
  const windowSightings = windowRows.length ? windowRows : priced;
  // The sighting where the 90-day low actually happened — `windowSightings`
  // is already date-ordered (priceHistory sorts by valid_from ASC), and `<=`
  // keeps the LATEST tie, so "when was it lowest" answers with the most
  // recent time that price was seen, not the first.
  const minSighting = windowSightings.reduce((best, h) =>
    h.priceValue <= best.priceValue ? h : best,
  );
  const min90d = minSighting.priceValue;
  const median90d = median(windowSightings.map(h => h.priceValue));

  // A single sighting is only ever "today's own price" — with nothing else to
  // compare it against, don't claim a deal quality at all (it would otherwise
  // always compute as "great", since a lone price trivially equals its own
  // min/median).
  let dealQuality = null;
  if (priced.length >= 2) {
    if (current.priceValue <= min90d * 1.05) {
      dealQuality = 'great';
    } else if (current.priceValue <= median90d) {
      dealQuality = 'good';
    } else if (current.priceValue <= median90d * 1.15) {
      dealQuality = 'average';
    } else {
      dealQuality = 'poor';
    }
  }

  const isLowestInMonths = months => {
    const cutoff = daysAgoIso(Math.round(months * 30.44));
    const inWindow = priced.filter(h => !h.validFrom || h.validFrom >= cutoff);
    // Same reasoning as dealQuality — need at least one OTHER sighting in the
    // window, or "lowest in N months" is trivially true of the only price.
    return (
      inWindow.length >= 2 &&
      current.priceValue <= Math.min(...inWindow.map(h => h.priceValue))
    );
  };

  const saleDates = [...new Set(priced.filter(h => h.onSale && h.validFrom).map(h => h.validFrom))].sort();
  let saleFrequencyDays = null;
  if (saleDates.length >= 2) {
    const gaps = saleDates.slice(1).map((d, i) => daysBetween(saleDates[i], d));
    saleFrequencyDays = Math.round(median(gaps));
  }

  const byStoreMap = new Map();
  for (const h of priced) {
    if (!h.store) {
      continue;
    }
    const entry = byStoreMap.get(h.store) || {
      store: h.store,
      latestPrice: null,
      latestDate: '',
      lowestPrice: null,
    };
    if (!entry.latestDate || h.validFrom >= entry.latestDate) {
      entry.latestDate = h.validFrom;
      entry.latestPrice = h.priceValue;
    }
    if (entry.lowestPrice == null || h.priceValue < entry.lowestPrice) {
      entry.lowestPrice = h.priceValue;
    }
    byStoreMap.set(h.store, entry);
  }

  return {
    currentPrice: current.priceValue,
    min90d,
    // The flyer week the 90-day low actually happened, and where — so "when
    // was it lowest" has an answer, not just a number.
    min90dValidFrom: minSighting.validFrom || null,
    min90dValidTo: minSighting.validTo || null,
    min90dStore: minSighting.store || null,
    median90d,
    isLowestIn3Months: isLowestInMonths(3),
    isLowestIn6Months: isLowestInMonths(6),
    isLowestIn12Months: isLowestInMonths(12),
    dealQuality,
    saleFrequencyDays,
    byStore: [...byStoreMap.values()].map(({store: s, latestPrice, lowestPrice}) => ({
      store: s,
      latestPrice,
      lowestPrice,
    })),
    sightings: history.length,
    // True when these sightings aren't all priced the same way (some per lb/
    // kg, some flat, some a multi-buy) — the comparison above may not be
    // apples-to-apples even though every priceValue is just a plain number.
    mixedPriceUnits: new Set(priced.map(h => priceBasis(h.price))).size > 1,
  };
}

/**
 * Resolve a loose product hint ("tomatoes", "chicken breast") to the
 * canonical product(s) it names, most-sighted first.
 *
 * A generic ask means the actual item — never something that merely mentions
 * it as an ingredient. So the primary tier only ever matches on real product
 * identity: a canonical group's own name ending in the hint ("tomatoes" ->
 * "field tomatoes", "grape tomatoes", ... — ALL of them, so priceInsight can
 * pool every variety into one "tomatoes in general" answer instead of an
 * arbitrary pick), or — for a group filed under a different name (e.g. "roma
 * tomatoes" grouped as "roma tomatoes green sweet") — a linked product's own
 * category/name.
 *
 * `broad: true` (an explicit "products WITH tomatoes" / ingredient-style ask)
 * additionally unions in anything carrying the hint as a complete TAG, so a
 * pasta sauce that lists tomatoes as one ingredient can be included too —
 * added on top of the real-item matches, never in place of them, and never
 * for a plain generic ask.
 *
 * Returns `[]` if nothing matches.
 */
export function resolveCanonicalIds(hint, {broad = false} = {}) {
  const h = String(hint || '').trim().toLowerCase();
  if (!h) {
    return [];
  }

  const byNameHead = db
    .prepare(
      `SELECT cp.id, COUNT(p.id) AS n
         FROM canonical_products cp
         LEFT JOIN products p ON p.canonical_product_id = cp.id
        WHERE headmatch(lower(cp.canonical_name), ?)
        GROUP BY cp.id
        ORDER BY n DESC`,
    )
    .all(h);

  const itemIds = byNameHead.length
    ? byNameHead.map(r => r.id)
    : db
        .prepare(
          `SELECT p.canonical_product_id AS id, COUNT(*) AS n
             FROM products p
            WHERE p.canonical_product_id IS NOT NULL
              AND (headmatch(lower(coalesce(p.category,'')), ?)
                   OR wordmatch(lower(coalesce(p.name,'') || ' ' || coalesce(p.info,'')), ?))
            GROUP BY p.canonical_product_id
            ORDER BY n DESC`,
        )
        .all(h, h)
        .map(r => r.id);

  if (!broad) {
    return itemIds;
  }

  const byTag = db
    .prepare(
      `SELECT cp.id, COUNT(p.id) AS n
         FROM canonical_products cp
         LEFT JOIN products p ON p.canonical_product_id = cp.id
        WHERE tagexact(coalesce(cp.tags,''), ?)
        GROUP BY cp.id
        ORDER BY n DESC`,
    )
    .all(h)
    .map(r => r.id);
  const byProductTag = db
    .prepare(
      `SELECT p.canonical_product_id AS id, COUNT(*) AS n
         FROM products p
        WHERE p.canonical_product_id IS NOT NULL AND tagexact(coalesce(p.tags,''), ?)
        GROUP BY p.canonical_product_id
        ORDER BY n DESC`,
    )
    .all(h)
    .map(r => r.id);

  return [...new Set([...itemIds, ...byTag, ...byProductTag])];
}

/** The single best canonical product for a hint (item-scope only) — for a
 * context like a price alert that needs exactly one target. */
export function resolveCanonicalId(hint) {
  return resolveCanonicalIds(hint, {broad: false})[0] ?? null;
}

// ---------------------------------------------------------------------------
// Users + price alerts. No login — the client generates an anonymous
// per-install id; these rows just give alerts somewhere to live.
// ---------------------------------------------------------------------------

/** Ensures a user row exists (no-op if it already does). */
export function getOrCreateUser(userId) {
  stmts.insertUserIgnore.run({id: userId, created_at: new Date().toISOString()});
  return userId;
}

export function createAlert({userId, canonicalProductId, targetPrice, comparison, store}) {
  const id = randomUUID();
  stmts.insertAlert.run({
    id,
    user_id: userId,
    canonical_product_id: canonicalProductId,
    target_price: targetPrice,
    comparison: comparison === 'lt' ? 'lt' : 'lte',
    store: store || null,
    created_at: new Date().toISOString(),
  });
  return id;
}

export function listAlerts(userId) {
  return stmts.listAlertsByUser.all({user_id: userId}).map(r => ({
    id: r.id,
    canonicalProductId: r.canonical_product_id,
    canonicalName: r.canonical_name,
    targetPrice: r.target_price,
    comparison: r.comparison,
    store: r.store || '',
    createdAt: r.created_at,
    resolvedAt: r.resolved_at || null,
    resolvedProductId: r.resolved_product_id || null,
  }));
}

function safeJsonArray(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Capitalise the first letter of every word, e.g. "Selection eco compostable
 * coffee cups" -> "Selection Eco Compostable Coffee Cups". Only the leading
 * letter of each whitespace-separated token is touched, so existing caps are
 * kept ("RITZ", "GPS", "BioSteel", "iögo" -> "Iögo"). Applied both when
 * products are stored (so the DB is canonical) and on the way out of
 * searchProducts (so names extracted before this still read right); it's
 * idempotent, so running it twice is a no-op.
 */
function titleCaseName(name) {
  return (name || '').replace(
    /(^|\s)(\P{L}*)(\p{L})/gu,
    (_, sep, lead, first) => sep + lead + first.toUpperCase(),
  );
}

export const STATUSES = ['valid', 'upcoming', 'expired', 'unknown'];

// When the caller hasn't explicitly chosen statuses, the search tab should
// default to hiding expired flyers rather than showing everything.
const DEFAULT_VISIBLE_STATUSES = STATUSES.filter(s => s !== 'expired');

/**
 * `statuses` as given, or the default "everything but expired" when empty —
 * with `expired` folded back in when `includeExpired` is set, alongside
 * whatever else is in play (not as an allowlist of expired alone). When
 * `expiredOnly` is set, it wins outright: expired and nothing else.
 */
function effectiveStatuses(statuses, includeExpired, expiredOnly) {
  if (truthy(expiredOnly)) {
    return ['expired'];
  }
  const stz = toList(statuses).filter(s => STATUSES.includes(s));
  const base = stz.length ? stz : DEFAULT_VISIBLE_STATUSES;
  if (truthy(includeExpired) && !base.includes('expired')) {
    return [...base, 'expired'];
  }
  return base;
}

/** Local "YYYY-MM-DD" — compared string-wise against the flyer date columns. */
function todayIso() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A flyer's status relative to `?` (bound twice: today, today). Mirrors the
// app's flyerStatus(): unknown if no dates, upcoming if the start is still
// ahead, expired if today is past the end, else valid.
const STATUS_CASE = `CASE
  WHEN (f.valid_from IS NULL OR f.valid_from = '')
   AND (f.valid_to   IS NULL OR f.valid_to   = '') THEN 'unknown'
  WHEN f.valid_from IS NOT NULL AND f.valid_from <> '' AND f.valid_from > ? THEN 'upcoming'
  WHEN f.valid_to   IS NOT NULL AND f.valid_to   <> '' AND ? > f.valid_to   THEN 'expired'
  ELSE 'valid'
END`;

// Sort key for the default (unfiltered) list: upcoming first (it's the newest
// news — a flyer about to start), then active/undated, then expired at the
// bottom. Same two `?` binds as STATUS_CASE.
const STATUS_RANK = `CASE ${STATUS_CASE}
  WHEN 'upcoming' THEN 0
  WHEN 'expired'  THEN 2
  ELSE 1
END`;

const toList = v =>
  (Array.isArray(v) ? v : String(v || '').split(','))
    .map(s => String(s).trim())
    .filter(Boolean);

const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

const CAT_EXPR = "lower(coalesce(p.category,''))";
const TAGS_EXPR = "coalesce(p.tags,'')";

/**
 * Decide how a Search-tab query should match:
 * - `department` — an aisle word ("clothing", "appliances", "cleaning supplies")
 *   → filter by department; leftover words become rank-only `scoreTerms`.
 * - `item` — the whole query names something we stock (its head is a category
 *   head or an exact tag) → precise `headmatch`/`tagexact` match.
 * - `like` — anything else (brands, typos, "greek yogurt") → today's `LIKE %w%`.
 * Returns `{ mode, conds, params, scoreTerms }` (conds/params are the query
 * portion of the WHERE only).
 */
function classifyQuery(q) {
  const raw = String(q || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!raw) {
    return {mode: 'empty', conds: [], params: [], scoreTerms: []};
  }
  const cached = _classCache.get(raw);
  if (cached) {
    return cached;
  }
  const tokens = raw.split(' ').filter(Boolean).slice(0, 6);

  let out;
  const dep = matchDepartments(raw);
  if (dep) {
    out = {
      mode: 'department',
      conds: [`p.department IN (${dep.deptIds.map(() => '?').join(',')})`],
      params: [...dep.deptIds],
      scoreTerms: tokens.filter(t => !dep.consumed.has(t)),
    };
  } else if (
    db
      .prepare(`SELECT 1 FROM products p WHERE headmatch(${CAT_EXPR}, ?) LIMIT 1`)
      .get(raw)
  ) {
    // Something's category IS this ("salmon", "tomatoes") — show only those, not
    // products that merely mention it (a "seafood" tile tagged "salmon").
    out = {
      mode: 'item',
      conds: [`headmatch(${CAT_EXPR}, ?)`],
      params: [raw],
      scoreTerms: [raw],
    };
  } else if (
    db
      .prepare(`SELECT 1 FROM products p WHERE tagexact(${TAGS_EXPR}, ?) LIMIT 1`)
      .get(raw)
  ) {
    // No product's category is this, but it's an exact tag — e.g. "onion" on a
    // combo tile the categoriser filed under "vegetables".
    out = {
      mode: 'item',
      conds: [`(headmatch(${CAT_EXPR}, ?) OR tagexact(${TAGS_EXPR}, ?))`],
      params: [raw, raw],
      scoreTerms: [raw],
    };
  } else {
    const conds = [];
    const params = [];
    for (const w of tokens) {
      conds.push(
        '(p.name LIKE ? OR p.info LIKE ? OR p.category LIKE ? OR p.tags LIKE ?)',
      );
      const like = `%${w}%`;
      params.push(like, like, like, like);
    }
    out = {mode: 'like', conds, params, scoreTerms: tokens};
  }

  if (_classCache.size > 2000) {
    _classCache.clear();
  }
  _classCache.set(raw, out);
  return out;
}

// { clause, params, query } for the shared WHERE. Both callers JOIN flyers as `f`.
function buildWhere({q, departments, stores, statuses, onSale}, today) {
  const conds = [];
  const params = [];

  const qw = classifyQuery(q);
  conds.push(...qw.conds);
  params.push(...qw.params);

  const deps = toList(departments)
    .map(s => s.toLowerCase())
    .filter(isDepartment);
  if (deps.length) {
    conds.push(`p.department IN (${deps.map(() => '?').join(',')})`);
    params.push(...deps);
  }

  const sts = toList(stores);
  if (sts.length) {
    conds.push(`f.store IN (${sts.map(() => '?').join(',')})`);
    params.push(...sts);
  }

  const stz = toList(statuses).filter(s => STATUSES.includes(s));
  if (stz.length && stz.length < STATUSES.length) {
    conds.push(`(${STATUS_CASE}) IN (${stz.map(() => '?').join(',')})`);
    params.push(today, today, ...stz);
  }

  if (truthy(onSale)) {
    conds.push('p.on_sale = 1');
  }

  return {
    clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
    query: qw,
  };
}

// The product columns every search selects. `searchProductsExpanded` appends a
// `match_score` column; `mapProductRow` ignores anything it doesn't name.
const PRODUCT_COLS = `p.id, p.flyer_id, p.page, p.name, p.price, p.price_value, p.info,
       p.box, p.confidence, p.category, p.tags, p.department,
       p.was_price, p.promo_text, p.on_sale, p.has_thumb,
       f.store, f.valid_from, f.valid_to,
       p.canonical_product_id, cp.canonical_name`;
// Every PRODUCT_COLS query's FROM must include this alongside `JOIN flyers f`.
const CANONICAL_JOIN = 'LEFT JOIN canonical_products cp ON cp.id = p.canonical_product_id';

/** One DB row -> the API product shape. */
function mapProductRow(r, baseUrl) {
  return {
    id: r.id,
    flyerId: r.flyer_id,
    page: r.page,
    name: titleCaseName(r.name),
    price: r.price || '',
    priceValue: r.price_value,
    info: r.info || '',
    box: r.box ? JSON.parse(r.box) : null,
    confidence: r.confidence,
    category: r.category || '',
    tags: r.tags ? safeJsonArray(r.tags) : [],
    department: r.department || '',
    wasPrice: r.was_price || '',
    promoText: r.promo_text || '',
    onSale: !!r.on_sale,
    store: r.store || '',
    validFrom: r.valid_from || '',
    validTo: r.valid_to || '',
    thumb: r.has_thumb ? `${baseUrl}/thumbs/${r.flyer_id}/${r.id}.jpg` : null,
    canonicalProductId: r.canonical_product_id || null,
    canonicalName: r.canonical_name || '',
  };
}

/** The distinct flyer pages a product list references, with pixel size + URL. */
function collectPages(products, baseUrl) {
  const seen = new Set();
  const pages = [];
  for (const p of products) {
    const key = `${p.flyerId}:${p.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dims = db
      .prepare('SELECT width, height FROM pages WHERE flyer_id = ? AND page = ?')
      .get(p.flyerId, p.page);
    if (dims) {
      pages.push({
        flyerId: p.flyerId,
        page: p.page,
        width: dims.width,
        height: dims.height,
        image: `${baseUrl}/pages/${p.flyerId}/${p.page}.jpg`,
      });
    }
  }
  return pages;
}

/**
 * Paginated search over all stored products, newest first.
 * `q` matches name/info/category/tags; `departments` / `stores` / `statuses`
 * are optional arrays (or comma strings) that further narrow the set.
 * Expired flyers are hidden unless `statuses` explicitly asks for them,
 * `includeExpired` is set (folds expired in alongside everything else), or
 * `expiredOnly` is set (expired and nothing else, overriding `statuses`).
 * `baseUrl` is `http://<host>` — used to build page + thumbnail URLs.
 * Returns { products, pages, total, hasMore }.
 */
export function searchProducts(
  {
    q = '',
    departments,
    stores,
    statuses,
    includeExpired,
    expiredOnly,
    onSale,
    limit = 20,
    offset = 0,
  },
  baseUrl,
) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const today = todayIso();

  const {clause, params, query} = buildWhere(
    {
      q,
      departments,
      stores,
      statuses: effectiveStatuses(statuses, includeExpired, expiredOnly),
      onSale,
    },
    today,
  );

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM products p JOIN flyers f ON f.id = p.flyer_id
         ${clause}`,
    )
    .get(...params).n;

  // Relevance: +3 when the category IS the term, +3 when the term is the
  // category head, +2 for an exact tag, +1 for a whole-word name hit — so a
  // "salmon" search surfaces the salmon fillet above the combo tiles it's merely
  // tagged in, and "yogurt" puts plain yogurt above frozen-yogurt novelties.
  const terms = query.scoreTerms;
  const scored = terms.length > 0;
  const scoreExpr = terms
    .map(
      () =>
        `(CASE WHEN ${CAT_EXPR} = ? THEN 3 ELSE 0 END) + ` +
        `3 * headmatch(${CAT_EXPR}, ?) + 2 * tagexact(${TAGS_EXPR}, ?) + ` +
        "(CASE WHEN wordmatch(lower(coalesce(p.name,'') || ' ' || " +
        "coalesce(p.info,'')), ?) THEN 1 ELSE 0 END)",
    )
    .join(' + ');
  const scoreBinds = terms.flatMap(t => [t, t, t, t]);

  // Plain browse and a bare aisle browse rank by flyer status (expired sinks);
  // a scored query ranks by relevance; anything else stays newest-first.
  const plain = query.mode === 'empty';
  let orderBy;
  let orderParams;
  if (scored) {
    orderBy = 'ORDER BY score DESC, p.created_at DESC, p.rowid DESC';
    orderParams = [];
  } else if (plain || query.mode === 'department') {
    orderBy = `ORDER BY ${STATUS_RANK}, p.created_at DESC, p.rowid DESC`;
    orderParams = [today, today];
  } else {
    orderBy = 'ORDER BY p.created_at DESC, p.rowid DESC';
    orderParams = [];
  }

  const rows = db
    .prepare(
      `SELECT ${PRODUCT_COLS}${scored ? `, (${scoreExpr}) AS score` : ''}
         FROM products p
         JOIN flyers f ON f.id = p.flyer_id
         ${CANONICAL_JOIN}
         ${clause}
        ${orderBy}
        LIMIT ? OFFSET ?`,
    )
    // bind order = statement text: SELECT score, WHERE, ORDER (status), LIMIT/OFFSET
    .all(...scoreBinds, ...params, ...orderParams, lim, off);

  const products = rows.map(r => mapProductRow(r, baseUrl));
  const pages = collectPages(products, baseUrl);

  return {products, pages, total, hasMore: off + rows.length < total};
}

/** Broad words that would blow a query wide open — dropped before searching. */
const STOP_TERMS = new Set([
  'food',
  'grocery',
  'groceries',
  'item',
  'items',
  'product',
  'products',
  'sale',
  'deal',
  'deals',
  'cheap',
  // aisle / department words — too broad as an expansion term, and they match
  // every product carrying that tag.
  'produce',
  'dairy',
  'beverage',
  'beverages',
  'pantry',
  'frozen',
  'bakery',
  'deli',
  'meat',
  'poultry',
  'seafood',
  'fish',
  'snacks',
  'household',
  'cleaning',
  'aisle',
]);

/**
 * OR-search over up to 10 expansion terms (from the chat agent).
 *
 * - `broad: false` (default) — the query is a specific item ("milk"): a term
 *   includes a product only when it is the HEAD of `p.category` OR a complete
 *   `p.tags` entry, so "Cadbury Dairy Milk" / "Milk Cake" / "ice milk" drop out
 *   but "Yellow Onions" (category "vegetables", tag "onions") stays.
 * - `broad: true` — an umbrella query ("medication", "what milk products…"): a
 *   term matches as a whole word anywhere in name/info/category/tags.
 *
 * Ranking (`match_score`) always counts whole-word hits across the full text, so
 * a brand-name hit in the product name still floats a match to the top.
 *
 * `must` is an optional list of restriction words: when given, every result must
 * ALSO contain at least one of them (whole word, full text) — this is what lets
 * "medication for kids" narrow rather than re-rank.
 *
 * Returns { products, pages, terms, must, total }.
 */
export function searchProductsExpanded(
  termsIn,
  baseUrl,
  {limit = 24, must: mustIn = [], broad = false} = {},
) {
  const norm = list =>
    [
      ...new Set(
        (Array.isArray(list) ? list : [])
          .map(t => String(t).trim().toLowerCase())
          .filter(t => t && !STOP_TERMS.has(t)),
      ),
    ].slice(0, 10);

  const terms = norm(termsIn);
  if (!terms.length) {
    return {products: [], pages: [], terms: [], must: [], total: 0};
  }
  const must = norm(mustIn);

  const lim = Math.max(1, Math.min(50, Number(limit) || 24));
  // Full searchable text for one product; `"` and `,` in the tags JSON act as
  // word boundaries, which is what we want.
  const blob =
    "lower(coalesce(p.name,'') || ' ' || coalesce(p.info,'') || ' ' || " +
    "coalesce(p.category,'') || ' ' || coalesce(p.tags,''))";
  const catExpr = "lower(coalesce(p.category,''))";
  const tagsExpr = "coalesce(p.tags,'')";

  // Ranking: +1 for a whole-word hit anywhere, +3 when the product's category IS
  // the term (so "Lactantia Purfiltre Milk" [milk] outranks "Coconut Milk").
  const scoreExpr = terms
    .map(
      () =>
        `(CASE WHEN wordmatch(${blob}, ?) THEN 1 ELSE 0 END) + ` +
        `(CASE WHEN ${catExpr} = ? THEN 3 ELSE 0 END)`,
    )
    .join(' + ');
  const scoreBinds = terms.flatMap(t => [t, t]);

  // Inclusion: broad = whole word anywhere. item = the term is the product's
  // category head ("salmon" for category "salmon") OR a complete tag entry
  // ("salmon" tag on a "trout or salmon portions" combo tile) — so every real
  // salmon option shows, but a "frozen fish" tile that never names salmon does
  // not. Parent-category words ("fish", "seafood") are stripped by STOP_TERMS
  // before this, which is what keeps unrelated combo tiles out.
  const itemGroup = `(headmatch(${catExpr}, ?) OR tagexact(${tagsExpr}, ?))`;
  const orClause = terms
    .map(() => (broad ? `wordmatch(${blob}, ?)` : itemGroup))
    .join(' OR ');
  const inclBinds = broad ? terms : terms.flatMap(t => [t, t]);

  const mustClause = must.length
    ? ` AND (${must.map(() => `wordmatch(${blob}, ?)`).join(' OR ')})`
    : '';
  const where = `WHERE (${orClause})${mustClause}`;

  const rows = db
    .prepare(
      `SELECT ${PRODUCT_COLS}, (${scoreExpr}) AS match_score
         FROM products p
         JOIN flyers f ON f.id = p.flyer_id
         ${CANONICAL_JOIN}
        ${where}
        ORDER BY match_score DESC, p.created_at DESC, p.rowid DESC
        LIMIT ?`,
    )
    // bind order = statement text: SELECT score, WHERE (incl, must), LIMIT
    .all(...scoreBinds, ...inclBinds, ...must, lim);

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM products p JOIN flyers f ON f.id = p.flyer_id
        ${where}`,
    )
    .get(...inclBinds, ...must).n;

  const products = rows.map(r => mapProductRow(r, baseUrl));
  return {products, pages: collectPages(products, baseUrl), terms, must, total};
}

export function totalProducts() {
  return stmts.countProducts.get().n;
}

const andWhere = (clause, extra) =>
  clause ? `${clause} AND ${extra}` : `WHERE ${extra}`;

/**
 * Options for the Search filter modal, each list `[{ value, count }]`, plus the
 * `total` products the whole selection would return.
 *
 * Counts are faceted: each section's numbers reflect the OTHER sections'
 * selections but not its own, so unpicking a section always widens its options
 * and picking within a section never zeroes its own rows. An empty section is
 * simply no constraint.
 */
export function filterFacets({
  q = '',
  departments,
  stores,
  statuses,
  includeExpired,
  expiredOnly,
  onSale,
} = {}) {
  const today = todayIso();
  const FROM = 'FROM products p JOIN flyers f ON f.id = p.flyer_id';
  const effStatuses = effectiveStatuses(statuses, includeExpired, expiredOnly);

  // departments list — every filter except departments
  const dw = buildWhere({q, stores, statuses: effStatuses, onSale}, today);
  const deptRows = db
    .prepare(
      `SELECT p.department AS value, COUNT(*) AS n ${FROM}
        ${andWhere(dw.clause, "p.department IS NOT NULL AND p.department <> ''")}
        GROUP BY p.department ORDER BY value COLLATE NOCASE`,
    )
    .all(...dw.params);

  // stores list — every filter except stores
  const sw = buildWhere({q, departments, statuses: effStatuses, onSale}, today);
  const storeRows = db
    .prepare(
      `SELECT f.store AS value, COUNT(*) AS n ${FROM}
        ${andWhere(sw.clause, "f.store IS NOT NULL AND f.store <> ''")}
        GROUP BY f.store ORDER BY value COLLATE NOCASE`,
    )
    .all(...sw.params);

  // statuses list — every filter except statuses
  const tw = buildWhere({q, departments, stores, onSale}, today);
  const byStatus = new Map(
    db
      .prepare(
        `SELECT ${STATUS_CASE} AS value, COUNT(*) AS n ${FROM} ${tw.clause}
          GROUP BY value`,
      )
      .all(today, today, ...tw.params)
      .map(r => [r.value, r.n]),
  );

  // on-sale count — every filter except onSale itself
  const ow = buildWhere({q, departments, stores, statuses: effStatuses}, today);
  const saleCount = db
    .prepare(
      `SELECT COUNT(*) AS n ${FROM} ${andWhere(ow.clause, 'p.on_sale = 1')}`,
    )
    .get(...ow.params).n;

  // total — the whole selection
  const all = buildWhere(
    {q, departments, stores, statuses: effStatuses, onSale},
    today,
  );
  const total = db
    .prepare(`SELECT COUNT(*) AS n ${FROM} ${all.clause}`)
    .get(...all.params).n;

  return {
    departments: deptRows.map(r => ({value: r.value, count: r.n})),
    stores: storeRows.map(r => ({value: r.value, count: r.n})),
    // every non-expired state that has a match, alphabetically — expired is
    // offered separately via `expiredCount` and the "include expired" toggle,
    // not as one more option in this allowlist.
    statuses: [...STATUSES]
      .filter(s => s !== 'expired')
      .sort()
      .filter(s => byStatus.get(s))
      .map(s => ({value: s, count: byStatus.get(s)})),
    // how many expired products match everything else selected — i.e. what
    // turning on "include expired" would add, not a replacement for the rest.
    expiredCount: byStatus.get('expired') || 0,
    saleCount,
    total,
  };
}
