// Persistent store for extracted products. SQLite (better-sqlite3) at
// data/flyer.db; page JPEGs at data/pages/<flyerId>/<page>.jpg and per-product
// crop thumbnails at data/thumbs/<flyerId>/<productId>.jpg. data/ is gitignored.

import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import Database from 'better-sqlite3';

import {isDepartment} from './departments.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const PAGES_DIR = join(DATA_DIR, 'pages');
export const THUMBS_DIR = join(DATA_DIR, 'thumbs');
mkdirSync(PAGES_DIR, {recursive: true});
mkdirSync(THUMBS_DIR, {recursive: true});

const db = new Database(join(DATA_DIR, 'flyer.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  } catch {
    // already there
  }
}

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
};

export function findFlyerByHash(hash) {
  return stmts.flyerByHash.get(hash);
}

export function productCountForFlyer(flyerId) {
  return stmts.productsForFlyer.get(flyerId).n;
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

// Sort key for the default (unfiltered) list: active/undated first, then
// upcoming, then expired at the bottom. Same two `?` binds as STATUS_CASE.
const STATUS_RANK = `CASE ${STATUS_CASE}
  WHEN 'upcoming' THEN 1
  WHEN 'expired'  THEN 2
  ELSE 0
END`;

const toList = v =>
  (Array.isArray(v) ? v : String(v || '').split(','))
    .map(s => String(s).trim())
    .filter(Boolean);

const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

// { clause, params } for the shared WHERE. Both callers JOIN flyers as `f`.
function buildWhere({q, departments, stores, statuses, onSale}, today) {
  const conds = [];
  const params = [];

  for (const w of String(q || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)) {
    conds.push(
      '(p.name LIKE ? OR p.info LIKE ? OR p.category LIKE ? OR p.tags LIKE ?)',
    );
    const like = `%${w}%`;
    params.push(like, like, like, like);
  }

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

  return {clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params};
}

// The product columns every search selects. `searchProductsExpanded` appends a
// `match_score` column; `mapProductRow` ignores anything it doesn't name.
const PRODUCT_COLS = `p.id, p.flyer_id, p.page, p.name, p.price, p.price_value, p.info,
       p.box, p.confidence, p.category, p.tags, p.department,
       p.was_price, p.promo_text, p.on_sale, p.has_thumb,
       f.store, f.valid_from, f.valid_to`;

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
 * `baseUrl` is `http://<host>` — used to build page + thumbnail URLs.
 * Returns { products, pages, total, hasMore }.
 */
export function searchProducts(
  {q = '', departments, stores, statuses, onSale, limit = 20, offset = 0},
  baseUrl,
) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const today = todayIso();

  const {clause, params} = buildWhere(
    {q, departments, stores, statuses, onSale},
    today,
  );

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM products p JOIN flyers f ON f.id = p.flyer_id
         ${clause}`,
    )
    .get(...params).n;

  // Plain browse (no query, no filters): rank by flyer status so expired
  // flyers sink to the bottom. Any narrowing keeps the plain newest-first order.
  const plain = clause === '';
  const orderBy = plain
    ? `ORDER BY ${STATUS_RANK}, p.created_at DESC, p.rowid DESC`
    : 'ORDER BY p.created_at DESC, p.rowid DESC';
  const orderParams = plain ? [today, today] : [];

  const rows = db
    .prepare(
      `SELECT ${PRODUCT_COLS}
         FROM products p
         JOIN flyers f ON f.id = p.flyer_id
         ${clause}
        ${orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...params, ...orderParams, lim, off);

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
]);

/**
 * OR-search over up to 10 expansion terms (from the chat agent). Each term
 * matches p.name/info/category/tags LIKE %term%. Ranked by how many distinct
 * terms a product matches, then newest first. Returns { products, pages, terms,
 * total } — `terms` is the cleaned list actually searched.
 */
export function searchProductsExpanded(termsIn, baseUrl, {limit = 24} = {}) {
  const terms = [
    ...new Set(
      (Array.isArray(termsIn) ? termsIn : [])
        .map(t => String(t).trim().toLowerCase())
        .filter(t => t && !STOP_TERMS.has(t)),
    ),
  ].slice(0, 10);

  if (!terms.length) {
    return {products: [], pages: [], terms: [], total: 0};
  }

  const lim = Math.max(1, Math.min(50, Number(limit) || 24));
  const group =
    '(p.name LIKE ? OR p.info LIKE ? OR p.category LIKE ? OR p.tags LIKE ?)';
  const orClause = terms.map(() => group).join(' OR ');
  const scoreExpr = terms
    .map(() => `(CASE WHEN ${group} THEN 1 ELSE 0 END)`)
    .join(' + ');
  // `%term%` x4 (name/info/category/tags) per term.
  const likeParams = terms.flatMap(t => {
    const like = `%${t}%`;
    return [like, like, like, like];
  });

  const rows = db
    .prepare(
      `SELECT ${PRODUCT_COLS}, (${scoreExpr}) AS match_score
         FROM products p
         JOIN flyers f ON f.id = p.flyer_id
        WHERE ${orClause}
        ORDER BY match_score DESC, p.created_at DESC, p.rowid DESC
        LIMIT ?`,
    )
    .all(...likeParams, ...likeParams, lim); // score binds, then WHERE binds

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM products p JOIN flyers f ON f.id = p.flyer_id
        WHERE ${orClause}`,
    )
    .get(...likeParams).n;

  const products = rows.map(r => mapProductRow(r, baseUrl));
  return {products, pages: collectPages(products, baseUrl), terms, total};
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
  onSale,
} = {}) {
  const today = todayIso();
  const FROM = 'FROM products p JOIN flyers f ON f.id = p.flyer_id';

  // departments list — every filter except departments
  const dw = buildWhere({q, stores, statuses, onSale}, today);
  const deptRows = db
    .prepare(
      `SELECT p.department AS value, COUNT(*) AS n ${FROM}
        ${andWhere(dw.clause, "p.department IS NOT NULL AND p.department <> ''")}
        GROUP BY p.department ORDER BY value COLLATE NOCASE`,
    )
    .all(...dw.params);

  // stores list — every filter except stores
  const sw = buildWhere({q, departments, statuses, onSale}, today);
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
  const ow = buildWhere({q, departments, stores, statuses}, today);
  const saleCount = db
    .prepare(
      `SELECT COUNT(*) AS n ${FROM} ${andWhere(ow.clause, 'p.on_sale = 1')}`,
    )
    .get(...ow.params).n;

  // total — the whole selection
  const all = buildWhere({q, departments, stores, statuses, onSale}, today);
  const total = db
    .prepare(`SELECT COUNT(*) AS n ${FROM} ${all.clause}`)
    .get(...all.params).n;

  return {
    departments: deptRows.map(r => ({value: r.value, count: r.n})),
    stores: storeRows.map(r => ({value: r.value, count: r.n})),
    // every state that has a match, alphabetically
    statuses: [...STATUSES]
      .sort()
      .filter(s => byStatus.get(s))
      .map(s => ({value: s, count: byStatus.get(s)})),
    saleCount,
    total,
  };
}
