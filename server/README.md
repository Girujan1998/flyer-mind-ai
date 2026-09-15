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
  **not** printed (common on some circulars) the model assumes the current
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

## Canonical products — price history across flyers

`category`/`tags` are free text per Gemini call, so the same real-world item
can land under different text in different flyers ("berries" one week,
"strawberries" the next) — not stable enough to compare a price against its
own history. `canonical_products` is a second, stable identity layer every
`products` row (a "sighting" — one flyer, one date, one store, one price)
links to via `canonical_product_id`, so price history/trend/deal-quality
features group by canonical product instead of raw category text.

Matching runs in two stages, for every product still missing a link:

1. A cheap SQL shortlist — same `department` only, category/tag overlap
   against existing canonical products (the `wordmatch`/`headmatch`/`tagexact`
   functions already used for search, just pointed at `canonical_products`).
2. One batched Gemini call per ~40 products (`matchCanonicalProducts` in
   `src/gemini.js`) picks a candidate or proposes a new canonical product,
   from the full product **name** — category text alone is never trusted to
   auto-link (a brand-stripped category like `"chips"` covers Lay's, Pringles
   and a Frito-Lay variety box at very different prices).

It runs automatically, fire-and-forget, right after every upload (no added
latency on the upload response) — `src/canonicalMatch.js`. To (re)process the
existing backlog by hand:

```bash
node scripts/match-canonical-products.mjs [--batch 40] [--dry]
```

`GET /products` includes `canonicalProductId`/`canonicalName` on every row
once linked (`null`/`""` until the matching pass catches up — usually
seconds). See **API** below for `/price-history` and `/price-insight`.

## Price alerts

`price_alerts` rows (`canonical_product_id`, `target_price`, `comparison`)
belong to an anonymous per-install `users` id the app sends as `X-User-Id` —
no login. Alert matching rides the same canonical-matching pass: once a new
sighting is linked, any open alert on that canonical product whose price
condition it satisfies gets resolved right there, in the same transaction.
See `POST /alerts` / `GET /alerts` below. There's no push-notification
delivery yet — alerts are visible in-app via `GET /alerts` only.

## On sale vs. just listed

Each product also carries, from the same vision call:

- **`wasPrice`** — the struck-through / "reg." price when the tile shows one
  (`"$5.99"`), else `""`. A "was" price that isn't actually higher than the
  current price is dropped (common misread).
- **`promoText`** — a verbatim deal callout (`"Save $2"`, `"2 for $5"`,
  `"Clearance"`), else `""`.
- **`onSale`** — `true` when `wasPrice` **or** `promoText` is set. Strict: a
  plain flyer price with no discount wording is **not** "on sale".

Filter with `GET /products?sale=1`; `GET /filters` returns `saleCount`.
Existing products predate this and are all `onSale:false` until re-extracted —
there is no reliable text-only backfill (the was-price was never stored).

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
  "store": "Some Grocer", "validFrom": "2026-08-27", "validTo": "2026-09-02",
  "failedPages": [], "reused": false
}
```

### `GET /products?q=<text>&department=&store=&status=&limit=20&offset=0`

Paginated search over every stored product, newest first. Each query word must
match the product's **name, info, category, or tags**. `department`, `store` and
`status` are comma-separated multi-selects that further narrow the set:

- `department=laundry,frozen` — one of the fixed aisles (`src/departments.js`)
- `store=Some Grocer,Another Market` — exact store name
- `status=valid,expired` — `valid` \| `upcoming` \| `expired` \| `unknown`,
  computed from the flyer dates vs. the server's clock
- `sale=1` — only products with a `wasPrice` or `promoText`

```jsonc
{
  "products": [
    { "id": "…", "flyerId": "…", "page": 1, "name": "Corn", "price": "34¢",
      "priceValue": 0.34, "info": "…", "box": [230,60,360,300], "confidence": 95,
      "category": "corn", "tags": ["vegetable","produce","cob"],
      "department": "vegetables",
      "wasPrice": "48¢", "promoText": "Save 14¢", "onSale": true,
      "store": "Some Grocer", "validFrom": "2026-08-27", "validTo": "2026-09-02",
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

### `GET /filters?q=&department=&store=&status=`

Options for the app's filter modal, each list `[{ value, count }]`, plus the
`total` the whole selection returns:

```jsonc
{
  "departments": [{ "value": "pantry", "count": 47 }, …],
  "stores":      [{ "value": "Some Grocer", "count": 294 }],
  "statuses":    [{ "value": "valid", "count": 294 }, { "value": "expired", "count": 432 }],
  "saleCount": 61,
  "total": 294
}
```

Takes the same filter params as `/products`. Counts are **faceted**: each
section's numbers reflect the *other* sections' selections but not its own, so
an untouched section is never a constraint and picking within a section never
zeroes its own rows. `statuses` omits any state no matching product is in.

### `GET /departments`

`{ "departments": [{ "department": "pantry", "count": 80 }, …] }` — every aisle
that has products, busiest first.

### `GET /price-history/<canonicalProductId>?store=&months=`

Chronological price sightings for one canonical product across every flyer
it's appeared in — "$4.99 today; previous: $5.49, $4.49, $5.99". `store`
narrows to one retailer; `months` to a trailing window.

```jsonc
{
  "history": [
    { "price": "$4.99", "priceValue": 4.99, "onSale": false, "store": "Some Grocer",
      "validFrom": "2026-08-27", "validTo": "2026-09-02", "flyerId": "…", "page": 3 }
  ]
}
```

### `GET /price-insight/<canonicalProductId>?store=`

One aggregate over the same history — deal quality, lowest-price tracking,
retailer comparison and sale-frequency, all from real `price_value` numbers
(never a model guess). `404` if the canonical product has no history yet.

```jsonc
{
  "currentPrice": 4.99, "min90d": 3.99, "median90d": 4.49,
  "isLowestIn3Months": false, "isLowestIn6Months": false, "isLowestIn12Months": false,
  "dealQuality": "average", "saleFrequencyDays": 24,
  "byStore": [{ "store": "Some Grocer", "latestPrice": 4.99, "lowestPrice": 3.99 }],
  "sightings": 6
}
```

### `GET /alerts` · `POST /alerts`

Both require an `X-User-Id` header (the app's anonymous per-install id).
`GET` lists this device's alerts, open ones first. `POST` creates one:

```jsonc
// POST body
{ "canonicalProductId": "…", "targetPrice": 4.99, "comparison": "lte", "store": "" }
// -> { "id": "…" }
```

`comparison` is `"lte"` (default) or `"lt"`. An alert resolves automatically
(`resolvedAt`/`resolvedProductId` set) the next time a matching sighting's
price satisfies it — see **Price alerts** above.

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
| `MAX_UPLOAD_MB` | `50` | Largest flyer PDF accepted. Held in memory — keep in sync with `MAX_UPLOAD_MB` in the app's `src/config.ts`. |
| `PORT` | `3001` | Must match `LAN_HOST`/`PORT` in the app's `src/config.ts`. |

Per-run token usage is logged to the console and appended to
`server/logs/gemini-usage.jsonl`.

## Deploying

`src/index.js` is a plain Express app — run it anywhere Node runs, or move
`extractFlyer` behind a serverless function. `mupdf` is WASM (no native build).
