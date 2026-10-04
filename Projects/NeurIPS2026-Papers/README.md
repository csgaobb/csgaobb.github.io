# NeurIPS 2026 Paper Explorer

## About

NeurIPS 2026 Paper Explorer provides researchers with a fast, efficient, and convenient interface for finding papers in the NeurIPS 2026 program.

The portal supports:

- Search by paper title, author, Paper ID, or abstract
- Exact-author filtering by clicking an author name
- Oral and Poster filtering
- arXiv and code availability filtering
- Keyword highlighting, sorting, pagination, and shareable search URLs
- Direct links to OpenReview, arXiv, PDF, and code when available

Abstracts are loaded only when needed, while full-abstract search runs in a background worker to keep the interface responsive.

## NeurIPS 2026 Overview

Based on the current dataset, the NeurIPS 2026 program includes:

- **7,900** accepted papers
- **112** Oral papers
- **7,788** Poster papers
- **3,496** papers with arXiv links
- **919** papers with code or project links

## Usage

For the best experience, serve the project over HTTP:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Use the search field selector to search titles, authors, Paper IDs, or full abstracts. Multiple unquoted keywords use AND matching. Click an author name to filter by that exact author.

The page can also be opened directly through `index.html`, although serving it over HTTP is recommended for reliable background-worker support.

## Data Source

Paper metadata is derived from:

[hongsong-wang/NeurIPS2026](https://github.com/hongsong-wang/NeurIPS2026)

The local source snapshot is stored at `data/source-index.html`.

This is an independent browsing interface and is not an official NeurIPS website.
