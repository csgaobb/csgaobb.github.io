---
title: TOP2Scientists
emoji: 🔬
colorFrom: indigo
colorTo: blue
sdk: static
pinned: false
license: cc-by-nc-3.0
---

# TOP2Scientists

Static site for the official 2026 Stanford / Elsevier Top 2% Scientists lists.

Open it from a website address, such as `https://csgaobb.github.io/Projects/TOP2Scientists/`. Opening `index.html` as a local file cannot read the data beside it.

The page loads a small world-rank list first. Name search reads one letter block from `data/index/`. A profile loads one shard from `data/details/`. The header QR code is `assets/TOP2Scientists.png`.

```bash
npm install
npm run data:setup
npm run build
npm run dev
```

`npm run preview` serves the built `index.html` at `http://127.0.0.1:4173/index.html`.

Publish these files next to each other:

- `index.html`, `app.js`, `app.css`
- `assets/TOP2Scientists.png`
- `data/manifest.json`
- `data/index/`
- `data/cards/`
- `data/details/`

Data: Ioannidis, J.P.A. (2026), [DOI 10.17632/btchxktzyw.9](https://doi.org/10.17632/btchxktzyw.9), CC BY-NC 3.0.

## Changes

### 2026-10-12 — On-demand index

Search no longer opens a SQLite database in the browser.

- The first page loads `catalog.json` and one page of list cards from `data/cards/`.
- A name query downloads one letter file from `data/index/<list>/names/`. Surname and given name share that index, so either word can come first. Earlier words must match exactly; the last word may be a prefix.
- An institution query downloads `institutions.json.gz`, then only the id lists for the matched names. “Guangzhou University” also matches Guangzhou University of Chinese Medicine. A phrase that matches more than 4,000 people asks for a longer name and does not download those lists.
- Country, field, and subfield stay exact filters and each uses one id file. World rank is the contiguous person-id range. Changing to subfield rank, c-score, citations, h-index, or author name downloads that one order file.
- The career-long index loads when that tab is opened.
- Opening a person still loads one 400-person shard from `data/details/`.
- Removed the browser SQLite engine and `@sqlite.org/sqlite-wasm`. Publish `data/index/` and `data/cards/` instead of `data/search-single-year.db.gz` and `data/search-career.db.gz`.

### 2026-10-11 — SQLite search database

The published page fetched one gzip SQLite database before the first query: about 23 MB compressed and about 50 MB uncompressed for a list. Detail profiles already used 400-person shards. The English page, search scope, and source QR code were in place.
