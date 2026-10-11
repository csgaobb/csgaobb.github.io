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

The page loads `data/search-single-year.db.gz` first. `data/search-career.db.gz` loads only when that list is opened. A profile loads one shard from `data/details/`. The header QR code is `assets/TOP2Scientists.png`.

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
- `data/search-single-year.db.gz`
- `data/search-career.db.gz`
- `data/details/`

Data: Ioannidis, J.P.A. (2026), [DOI 10.17632/btchxktzyw.9](https://doi.org/10.17632/btchxktzyw.9), CC BY-NC 3.0.
