#!/usr/bin/env python3
"""Write detail shards and the on-demand search index."""

from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import sys
from pathlib import Path

SHARD_SIZE = 400


def detail_record(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "scopusId": row["scopus_id"] or "",
        "listType": row["list_type"],
        "rankGlobal": row["rank_global"],
        "rankSubfield": row["rank_subfield"],
        "name": row["name"],
        "affiliation": row["affiliation"],
        "country": row["country"],
        "field": row["field"],
        "subfield": row["subfield"],
        "subfield2": row["subfield2"],
        "papers": row["papers"],
        "citations": row["citations"],
        "citationsAll": row["citations_all"],
        "hIndex": row["h_index"],
        "hIndexAll": row["h_index_all"],
        "hmIndex": row["hm_index"],
        "hmIndexAll": row["hm_index_all"],
        "cScore": row["c_score"],
        "cScoreAll": row["c_score_all"],
        "rankGlobalAll": row["rank_global_all"],
        "singlePapers": row["single_papers"],
        "singlePapersAll": row["single_papers_all"],
        "singleCites": row["single_cites"],
        "singleCitesAll": row["single_cites_all"],
        "firstPapers": row["first_papers"],
        "firstPapersAll": row["first_papers_all"],
        "firstCites": row["first_cites"],
        "firstCitesAll": row["first_cites_all"],
        "lastPapers": row["last_papers"],
        "lastPapersAll": row["last_papers_all"],
        "lastCites": row["last_cites"],
        "lastCitesAll": row["last_cites_all"],
        "citingPapers": row["citing_papers"],
        "citingPapersAll": row["citing_papers_all"],
        "citeRatio": row["cite_ratio"],
        "citeRatioAll": row["cite_ratio_all"],
        "percentile": row["percentile"],
        "selfCitationPct": row["self_citation_pct"],
        "firstPublicationYear": row["first_publication_year"],
        "lastPublicationYear": row["last_publication_year"],
        "subfieldCount": row["subfield_count"],
        "metricsLoaded": True,
    }


def write_shard(directory: Path, bucket: int, records: list[dict[str, object]]) -> None:
    payload = json.dumps({str(record["id"]): record for record in records}, separators=(",", ":")).encode()
    path = directory / f"{bucket:04d}.json.gz"
    with gzip.open(path, "wb", compresslevel=9) as target:
        target.write(payload)


def build_details(source: Path, directory: Path) -> int:
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.json.gz"):
        stale.unlink()
    connection = sqlite3.connect(source)
    connection.row_factory = sqlite3.Row
    bucket: int | None = None
    batch: list[dict[str, object]] = []
    count = 0
    try:
        for row in connection.execute("SELECT * FROM records ORDER BY id"):
            record_bucket = int(row["id"]) // SHARD_SIZE
            if bucket is None:
                bucket = record_bucket
            if record_bucket != bucket:
                write_shard(directory, bucket, batch)
                batch = []
                bucket = record_bucket
            batch.append(detail_record(row))
            count += 1
        if bucket is not None and batch:
            write_shard(directory, bucket, batch)
    finally:
        connection.close()
    return count


def manifest_counts(source: Path) -> dict[str, int]:
    connection = sqlite3.connect(source)
    try:
        career, single_year, institutions, countries, fields, subfields = connection.execute(
            """
            SELECT
              SUM(list_type = 'career'),
              SUM(list_type = 'single_year'),
              COUNT(DISTINCT NULLIF(affiliation, '')),
              COUNT(DISTINCT NULLIF(country, '')),
              COUNT(DISTINCT NULLIF(field, '')),
              COUNT(DISTINCT NULLIF(subfield, ''))
            FROM records
            """
        ).fetchone()
    finally:
        connection.close()
    return {
        "totalCareer": int(career or 0),
        "totalSingleYear": int(single_year or 0),
        "institutions": int(institutions or 0),
        "countries": int(countries or 0),
        "fields": int(fields or 0),
        "subfields": int(subfields or 0),
        "shardSize": SHARD_SIZE,
    }


def split(source: Path, data_dir: Path) -> None:
    if not source.exists():
        raise RuntimeError(f"Missing source database: {source}")
    data_dir.mkdir(parents=True, exist_ok=True)
    counts = manifest_counts(source)
    (data_dir / "manifest.json").write_text(json.dumps(counts, indent=2) + "\n")
    print(f"Manifest {counts['totalSingleYear']:,} single-year, {counts['totalCareer']:,} career")
    from build_index import build_indexes

    build_indexes(source, data_dir)
    for stale in data_dir.glob("search-*.db.gz"):
        stale.unlink()
    details = data_dir / "details"
    if any(details.glob("*.json.gz")):
        print("Detail shards already present")
    else:
        print("Writing detail shards")
        detail_count = build_details(source, details)
        print(f"  {detail_count:,} detail records")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=root / "data" / "scientists.db")
    parser.add_argument("--data-dir", type=Path, default=root / "data")
    args = parser.parse_args()
    split(args.source, args.data_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, sqlite3.Error) as error:
        print(f"Split failed: {error}", file=sys.stderr)
        raise SystemExit(1)
