// Persistent store for extracted products. SQLite (better-sqlite3) at
// data/flyer.db; page JPEGs at data/pages/<flyerId>/<page>.jpg and per-product
// crop thumbnails at data/thumbs/<flyerId>/<productId>.jpg. data/ is gitignored.

import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import Database from 'better-sqlite3';

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
    has_thumb   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
`);

const stmts = {
  flyerByHash: db.prepare('SELECT * FROM flyers WHERE hash = ?'),
  insertFlyer: db.prepare(
    `INSERT INTO flyers (id, name, hash, total_pages, rendered_pages, created_at)
     VALUES (@id, @name, @hash, @total_pages, @rendered_pages, @created_at)`,
  ),
  insertPage: db.prepare(
    `INSERT INTO pages (flyer_id, page, width, height)
     VALUES (@flyer_id, @page, @width, @height)`,
  ),
  insertProduct: db.prepare(
    `INSERT INTO products
       (id, flyer_id, page, name, price, price_value, info, box, confidence, has_thumb, created_at)
     VALUES
       (@id, @flyer_id, @page, @name, @price, @price_value, @info, @box, @confidence, @has_thumb, @created_at)`,
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
  ({name, hash, totalPages, renderedPages, pages, products, thumbs}) => {
    const flyerId = randomUUID();
    const now = new Date().toISOString();

    stmts.insertFlyer.run({
      id: flyerId,
      name,
      hash,
      total_pages: totalPages,
      rendered_pages: renderedPages,
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
        has_thumb: thumb ? 1 : 0,
        created_at: now,
      });
      i++;
    }

    return {flyerId, savedProducts: products.length};
  },
);

function whereFor(q) {
  const words = String(q || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!words.length) return {clause: '', params: []};
  return {
    clause:
      'WHERE ' +
      words.map(() => '(name LIKE ? OR info LIKE ?)').join(' AND '),
    params: words.flatMap(w => [`%${w}%`, `%${w}%`]),
  };
}

/**
 * Paginated + text search over all stored products, newest first.
 * `baseUrl` is `http://<host>` — used to build page + thumbnail URLs.
 * Returns { products, pages, total, hasMore }.
 */
export function searchProducts({q = '', limit = 20, offset = 0}, baseUrl) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const {clause, params} = whereFor(q);

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM products ${clause}`)
    .get(...params).n;

  const rows = db
    .prepare(
      `SELECT id, flyer_id, page, name, price, price_value, info, box, confidence, has_thumb
         FROM products ${clause}
        ORDER BY created_at DESC, rowid DESC
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
