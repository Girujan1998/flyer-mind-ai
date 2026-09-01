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
       (id, flyer_id, page, name, price, price_value, info, box, confidence, category, tags, department, has_thumb, created_at)
     VALUES
       (@id, @flyer_id, @page, @name, @price, @price_value, @info, @box, @confidence, @category, @tags, @department, @has_thumb, @created_at)`,
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
        name: pr.name || 'Unnamed item',
        price: pr.price || null,
        price_value: pr.priceValue ?? null,
        info: pr.info || null,
        box: pr.box ? JSON.stringify(pr.box) : null,
        confidence: pr.confidence ?? null,
        category: pr.category || null,
        tags: pr.tags && pr.tags.length ? JSON.stringify(pr.tags) : null,
        department: pr.department || null,
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

function buildWhere(q, department, prefix = '') {
  const col = c => `${prefix}${c}`;
  const conds = [];
  const params = [];

  const words = String(q || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  for (const w of words) {
    conds.push(
      `(${col('name')} LIKE ? OR ${col('info')} LIKE ? OR ${col(
        'category',
      )} LIKE ? OR ${col('tags')} LIKE ?)`,
    );
    const like = `%${w}%`;
    params.push(like, like, like, like);
  }

  const dep = String(department || '')
    .trim()
    .toLowerCase();
  if (dep && isDepartment(dep)) {
    conds.push(`${col('department')} = ?`);
    params.push(dep);
  }

  return {
    clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

/**
 * Paginated + text search over all stored products, newest first.
 * `q` matches name/info/category/tags; `department` filters to one aisle.
 * `baseUrl` is `http://<host>` — used to build page + thumbnail URLs.
 * Returns { products, pages, total, hasMore }.
 */
export function searchProducts(
  {q = '', department = '', limit = 20, offset = 0},
  baseUrl,
) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);

  const flat = buildWhere(q, department);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM products ${flat.clause}`)
    .get(...flat.params).n;

  const {clause, params} = buildWhere(q, department, 'p.');
  const rows = db
    .prepare(
      `SELECT p.id, p.flyer_id, p.page, p.name, p.price, p.price_value, p.info,
              p.box, p.confidence, p.category, p.tags, p.department, p.has_thumb,
              f.store, f.valid_from, f.valid_to
         FROM products p
         JOIN flyers f ON f.id = p.flyer_id
         ${clause}
        ORDER BY p.created_at DESC, p.rowid DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, lim, off);

  const products = rows.map(r => ({
    id: r.id,
    flyerId: r.flyer_id,
    page: r.page,
    name: r.name,
    price: r.price || '',
    priceValue: r.price_value,
    info: r.info || '',
    box: r.box ? JSON.parse(r.box) : null,
    confidence: r.confidence,
    category: r.category || '',
    tags: r.tags ? safeJsonArray(r.tags) : [],
    department: r.department || '',
    store: r.store || '',
    validFrom: r.valid_from || '',
    validTo: r.valid_to || '',
    thumb: r.has_thumb
      ? `${baseUrl}/thumbs/${r.flyer_id}/${r.id}.jpg`
      : null,
  }));

  // The distinct pages this result set references, with their pixel size + URL.
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

  return {products, pages, total, hasMore: off + rows.length < total};
}

export function totalProducts() {
  return stmts.countProducts.get().n;
}
