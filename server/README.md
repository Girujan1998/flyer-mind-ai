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

Point the app at it: in the repo root, `EXPO_PUBLIC_API_BASE_URL=http://localhost:3001`
(this is the default in `app.json`; the iOS simulator can reach `localhost`, a
physical device needs your machine's LAN IP).

## API

### `POST /flyers/extract`

`multipart/form-data`, field **`file`** = the flyer PDF. Optional `?maxpages=N`.

```jsonc
{
  "pages": [
    { "page": 1, "width": 1224, "height": 1584, "image": "data:image/jpeg;base64,..." }
  ],
  "products": [
    { "id": "1-0", "page": 1, "name": "Corn", "price": "34¢", "priceValue": 0.34,
      "info": "Each. Product of Canada.", "box": [230, 60, 360, 300] }
  ],
  "usage": { "model": "gemini-3.1-flash-lite", "total": { "totalTokens": 2806, "...": "..." } },
  "meta": { "totalPages": 1, "renderedPages": 1 }
}
```

`box` is `[ymin, xmin, ymax, xmax]`, each 0–1000, normalized to that page's
`width`/`height`. Page images are returned inline as base64 data URIs so the app
can crop product tiles from them; for very large catalogues switch to serving
them as files.

### `GET /health`

`{ "ok": true, "gemini": "configured" | "missing" }`

## Config (`.env`)

| Var | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required. `MOCK` for canned data. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Any vision-capable Gemini model. |
| `PAGES_PER_REQUEST` | `1` | Pages per Gemini call, clamped 1–4. Above 3 recall drops. |
| `PORT` | `3001` | Must match the app's `EXPO_PUBLIC_API_BASE_URL`. |

Per-run token usage is logged to the console and appended to
`server/logs/gemini-usage.jsonl`.

## Deploying

`src/index.js` is a plain Express app — run it anywhere Node runs, or move
`extractFlyer` behind a serverless function. `mupdf` is WASM (no native build).
