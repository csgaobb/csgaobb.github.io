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

Users open the GitHub Pages URL. The official database in `data/scientists.db.gz` loads automatically.

```bash
npm install
npm run data:setup
npm run build
npm run dev
```

GitHub Pages cannot host the raw 229 MB `scientists.db`. Publish the compressed `data/scientists.db.gz` (~81 MB) with `index.html`, `app.js`, and `app.css`.

Data: Ioannidis, J.P.A. (2026), [DOI 10.17632/btchxktzyw.9](https://doi.org/10.17632/btchxktzyw.9), CC BY-NC 3.0.
