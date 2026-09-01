# Flyer Mind AI — extraction API

Node service that takes an uploaded flyer PDF, rasterizes each page, and runs
**Google Gemini** vision to pull out every product with its price and bounding
box. Ported from `repos/SandboxDemos/flyer-ocr-extractor` (which does the same
thing in-browser); here the PDF render happens server-side with
[`mupdf`](https://www.npmjs.com/package/mupdf) so the app can just upload the file.

## Run it

```bash
cd server
npm install
cp .env.example .env          # then set GEMINI_API_KEY (free: https://aistudio.google.com/apikey)
npm run dev                    # http://localhost:3001, restarts on change
```

Set `GEMINI_API_KEY=MOCK` in `.env` to return canned products without a key —
useful for checking the render → upload → grid flow.

On startup it prints the LAN URL and the exact `src/config.ts` line to set so a
phone on the same Wi-Fi can reach it.

## Watching logs while testing on a phone

Every run appends to `logs/server.log` (as well as stdout). While the app runs
on your device:

```bash
# terminal 1 — the server
cd server && npm start          # or `npm run dev`

# terminal 2 — follow the log
cd server && npm run logs
```

You'll see one `[req] <phone-ip> POST /flyers/extract 200 41000ms` line per
upload, then the per-page `[gemini] pages N …` breakdown, a `[gemini] TOTAL`,
and any `truncated` / `FAILED` warnings. `logs/` is gitignored.

## Store name + validity window

On upload, one extra Gemini call runs against **page 1 only** to read the
retailer name and the price-validity date range ("Prices in effect Aug 27 –
Sep 2"). It is stored on the `flyers` row (`store`, `valid_from`, `valid_to`,
`meta_confidence`) and returned on every product in `GET /products`.

- Costs ~1,700–1,900 tokens per flyer (mostly the page-1 image) and **one extra
  request** — it runs in parallel with the product extraction, so no extra
  wall-clock time.
- When a flyer prints the year, both dates land exactly. When the year is
  **not** printed (common on Walmart circulars) the model assumes the current
  year — the month/day are right, the year may be off. `""` for both dates if
  no range is printed on page 1.
- `node scripts/test-flyer-meta.mjs <file.pdf> ...` runs just this call (no DB,
  no product extraction) and prints the result + token usage.

## Category, tags, department

Three levels of grouping on every product, all from the same vision call (no
extra request, ~25 extra output tokens each):

- **`category`** — brand/size-stripped type, 1-4 words: `body spray deodorant`,
  `ice cream`, `cream`.
- **`tags`** — 2-6 lowercase synonyms / aisle words:
  `["deodorant","body spray","antiperspirant"]`.
- **`department`** — one fixed store aisle (`fruit`, `vegetables`, `laundry`,
  `dairy & eggs`, `electronics`, …; full list in `src/departments.js`).

`category` and `tags` are matched by `GET /products?q=` (so "ice cream" finds
"Selection ice milk"); `department` is a filter — `GET /products?department=laundry`
— and `GET /departments` returns `{ departments: [{ department, count }] }` for
the app's filter chips.

Products stored before a field existed have it blank. Backfill with text-only
passes (names only, no images, batched — run categories first):

```bash
npm run backfill:categories                    # name -> category + tags
npm run backfill:departments                    # category -> department (cheap: per distinct category)
node scripts/backfill-categories.mjs --dry      # one batch, print, don't write
```

## Storage

Extracted products are **saved to SQLite** (`data/flyer.db`, better-sqlite3).
Images on disk under `data/`:

- `pages/<flyerId>/<page>.jpg` — the full rendered page (for the source-page view)
- `thumbs/<flyerId>/<productId>.jpg` — a small crop of each product's bounding
  box (mupdf pixmap warp), so the product list shows tiny images instead of
  loading + upscaling the whole page per card

`data/` is gitignored; delete it to start fresh. Re-uploading the exact same PDF
(matched by sha256) is not re-extracted — it returns the stored summary.

## API

### `POST /flyers/extract`

`multipart/form-data`, field **`file`** = the flyer PDF. Optional `?maxpages=N`.
Extracts, **saves to the DB**, and returns a summary only:

```jsonc
{
  "flyerId": "…", "name": "flyer.pdf",
  "savedProducts": 16, "renderedPages": 1, "totalPages": 1,
  "store": "Food Basics", "validFrom": "2026-08-27", "validTo": "2026-09-02",
  "failedPages": [], "reused": false
}
```

### `GET /products?q=<text>&department=<aisle>&limit=20&offset=0`

Paginated search over every stored product, newest first. Each query word must
match the product's **name, info, category, or tags**; `department`, if given,
filters to that one aisle (ignored if not a known department).

```jsonc
{
  "products": [
    { "id": "…", "flyerId": "…", "page": 1, "name": "Corn", "price": "34¢",
      "priceValue": 0.34, "info": "…", "box": [230,60,360,300], "confidence": 95,
      "category": "corn", "tags": ["vegetable","produce","cob"],
      "department": "vegetables",
      "store": "Food Basics", "validFrom": "2026-08-27", "validTo": "2026-09-02",
      "thumb": "http://<host>/thumbs/<flyerId>/<id>.jpg" }
  ],
  "pages": [
    { "flyerId": "…", "page": 1, "width": 1592, "height": 2060,
      "image": "http://<host>/pages/<flyerId>/1.jpg" }
  ],
  "total": 207, "hasMore": true
}
```

`box` is `[ymin, xmin, ymax, xmax]`, each 0–1000, normalized to that page's
`width`/`height`. `thumb` is the product's crop (or `null`); `pages` holds the
distinct full pages referenced by this result set (for the source-page view).

### `GET /departments`

`{ "departments": [{ "department": "pantry", "count": 80 }, …] }` — every aisle
that has products, busiest first. Powers the app's filter chips.

### `GET /pages/<flyerId>/<page>.jpg` · `GET /thumbs/<flyerId>/<id>.jpg`

The rendered page image and per-product crop (static files).

### `GET /health`

`{ "ok": true, "gemini": "configured" | "missing", "products": 207 }`

## Config (`.env`)

| Var | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required. `MOCK` for canned data. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Any vision-capable Gemini model. |
| `PAGES_PER_REQUEST` | `1` | Pages per Gemini call, clamped 1–4. Above 3 recall drops. |
| `PORT` | `3001` | Must match `LAN_HOST`/`PORT` in the app's `src/config.ts`. |

Per-run token usage is logged to the console and appended to
`server/logs/gemini-usage.jsonl`.

## Deploying

`src/index.js` is a plain Express app — run it anywhere Node runs, or move
`extractFlyer` behind a serverless function. `mupdf` is WASM (no native build).
