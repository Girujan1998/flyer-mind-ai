# Flyer Mind AI

Point your phone at a store's weekly flyer PDF and get a searchable catalogue of
every product, price, and deal in it — then find things by asking for them in
plain language.

A bare **React Native 0.73.9** app (iOS + Android) talking to a small
**Node / Express** service that runs **Google Gemini** vision over the flyer.

## How it works

```
flyer.pdf ──upload──▶  server: rasterise pages (mupdf)
                       └─▶ Gemini vision: every product → name, price, box,
                            category, tags, department, sale info
                       └─▶ SQLite (data/flyer.db) + page images + crop thumbs
app  ◀──────────────────  GET /products, /filters, POST /chat
```

Re-uploading the same PDF (matched by SHA-256) is free — it returns the stored
result instead of re-running Gemini.

## Features

### 📤 Upload & extract

Pick a flyer PDF; the server renders each page, sends it to Gemini vision, and
saves every product it finds with:

- **name, price, size/info** read only from that product's own tile
- **bounding box** — a normalised `[ymin, xmin, ymax, xmax]`, used for the
  in-app "show me where this is on the page" view and the crop thumbnail
- **store name + validity window** (one extra page-1 call) — "Prices in effect
  Aug 27 – Sep 2", so every product knows whether its flyer is active
- **on-sale flag** — strict: only when the tile shows a struck-through price or
  an explicit callout ("Save $2", "2 for $5", "Clearance"), not just a low price

Uploads survive a phone lock or Wi-Fi blip — the app reconnects to the same job
for up to 5 minutes rather than starting a second (wasted) Gemini pass.

### 🔎 Search

A fast, **local** search over every stored product (no AI call — it must work
offline and instantly):

- **Three-mode query classifier** at a single choke point so the results grid
  and the filter modal's "Show N" count never disagree:
  - *aisle query* ("clothing", "cleaning supplies", "appliances") → the whole
    department
  - *specific item* ("salmon", "yogurt", "ice cream") → only products that
    **are** that thing, via whole-word / category-head matching (so "salmon"
    doesn't drag in tuna, "milk" doesn't drag in "milk chocolate")
  - *everything else* (brands, typos) → per-word substring match
- **Relevance ranking** — a product whose category *is* the term outranks one
  that merely mentions it
- **Faceted filters** — department, store, flyer status (active / upcoming /
  expired / unknown), on-sale. Each facet's counts reflect the *other* filters'
  selections, so a facet you haven't touched never silently constrains the set
- **Source view** — tap a product to see its price detail, then jump to the
  exact spot on the rendered flyer page with its bounding box highlighted

### 🤖 AI Agent (Chat tab)

The Chat tab is an **AI agent, not a chatbot** — it does not hold a
conversation, answer general questions, or free-type prose. Each turn is **one
structured Gemini call** that turns the shopper's message into an *action*, and
the server then does the work deterministically:

- **`search`** — the model returns expansion `terms` (the plain noun plus
  synonyms, varieties spelled out, and a few flyer brand names), a `scope`
  (a single *item* vs. a *broad* "what X products are there"), an optional
  `must` restriction ("for kids" → `child / children / infant / toddler …`),
  and a short `intent` label. The server runs its own product lookup with those
  and replies with a templated line + the matching cards. This is what a plain
  keyword search can't do: *"I'm looking for something for a headache"* finds
  Tylenol and Advil even though neither tile says "headache".
- **`reply`** — for anything that isn't a product request, one short sentence
  pointing back to what it can do.

Design choices that keep it cheap and predictable:

- **one API call per turn** — no tool round-trips; the "tool" (product search)
  runs in-process against SQLite
- **structured output** (`responseSchema`), `temperature: 0`, no thinking
  budget, 256-token output cap → ~350–450 tokens per turn
- last-6-turns of context only, and past result sets collapse to a marker
  (searched terms + restriction) so the model never re-reads card JSON —
  a follow-up like *"just the cheap ones"* still knows the subject
- **New chat** button in the header (with a confirm) to clear the thread

Follow-ups genuinely *filter*: ask for medication, then "for kids", and the
non-kids items drop out rather than just re-sorting.

## Stack

| | |
| --- | --- |
| React Native | 0.73.9 (bare workflow, Hermes, old architecture) |
| React | 18.2.0 |
| Language | TypeScript 5.0 |
| iOS | deployment target 13.4; builds with Xcode 14.2 / CocoaPods 1.12 (RN 0.73 is the last line that builds without Xcode 15) |
| Android | compileSdk/targetSdk 34, minSdk 21, NDK 25.1.8937393, Kotlin 1.8.0, Gradle 8.3 |
| Server | Node ≥ 18, Express 4, `better-sqlite3` (synchronous), `mupdf` (WASM, no native build) |
| AI | Google Gemini (`gemini-3.1-flash-lite` by default) via REST |
| Test | Jest (`preset: react-native`) |

## Repo layout

```
App.tsx                 root — three always-mounted tabs (Upload / Search / Chat)
src/
  screens/              UploadScreen, SearchScreen, ChatScreen
  components/            ProductCard, FilterModal, ProductInfoModal, SourcePageModal, ScreenHeader
  navigation/PillNavBar  floating pill tab bar
  api/extract.ts         all server calls + shared types
  config.ts              LAN_HOST / PORT for the server
  theme.ts               palette, light/dark, spacing/radius/fonts
android/  ios/           native projects (committed — bare workflow)

server/
  src/index.js           Express routes
  src/gemini.js           vision extraction + the chat agent + backfill calls
  src/db.js               SQLite, search, the wordmatch/headmatch/tagexact UDFs
  src/pdf.js  thumbs.js   mupdf page render + per-product crops
  src/departments.js      the fixed 22-aisle list + aisle-word aliases
  scripts/                text-only backfill for older rows
  README.md               full API reference + token-cost notes
```

## Run it

### Server

```bash
cd server
npm install
cp .env.example .env          # set GEMINI_API_KEY — free key: https://aistudio.google.com/apikey
npm run dev                    # http://localhost:3001, restarts on change
```

`GEMINI_API_KEY=MOCK` returns canned products with no key — enough to exercise
the upload → render → grid flow. On startup the server prints the LAN URL and the
exact `src/config.ts` line to paste so a phone on the same Wi-Fi can reach it.
`npm run logs` follows `logs/server.log` (per-request lines + per-page token
breakdown).

### App

```bash
npm install

# iOS, first time
bundle install
bundle exec pod install --project-directory=ios

npm start                      # Metro, in its own terminal
npm run ios                    # or: npm run android
```

Set `LAN_HOST` in [`src/config.ts`](src/config.ts) to your dev machine's LAN IP
(Android emulator: use `10.0.2.2`).

## Checks

```bash
npm run lint
npm run tsc
npm test
```

## Building installables

```bash
npm run build:ios              # → build-artifacts/*.ipa   (scripts/build-ios-ipa.sh)
npm run build:android          # → build-artifacts/*.apk   (scripts/build-android-apk.sh)
```

## Config

App — [`src/config.ts`](src/config.ts): `LAN_HOST`, `PORT`, `MAX_UPLOAD_MB`
(keep in sync with the server).

Server — `server/.env` (full table in [`server/README.md`](server/README.md)):

| Var | Default | |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | required; `MOCK` for canned data |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | any vision-capable Gemini model |
| `PAGES_PER_REQUEST` | `1` | pages per vision call, 1–4 (above 3, recall drops) |
| `MAX_UPLOAD_MB` | `50` | largest PDF accepted |
| `PORT` | `3001` | must match `src/config.ts` |

`server/.env` is gitignored — the API key never leaves the server, and never
reaches the app.
