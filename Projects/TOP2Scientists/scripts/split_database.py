#!/usr/bin/env python3
"""Split the full scientist database into on-demand search files and detail shards."""

from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import sys
from pathlib import Path

SHARD_SIZE = 400
LISTS = ("single_year", "career")

SEARCH_SCHEMA = """
CREATE TABLE affiliations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE countries (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE fields (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE subfields (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  list_type TEXT NOT NULL,
  name TEXT NOT NULL,
  affiliation_id INTEGER NOT NULL,
  country_id INTEGER NOT NULL,
  field_id INTEGER NOT NULL,
  subfield_id INTEGER NOT NULL,
  subfield2_id INTEGER NOT NULL,
  rank_global INTEGER,
  rank_subfield INTEGER,
  papers INTEGER,
  citations INTEGER,
  h_index INTEGER,
  c_score REAL,
  subfield_count INTEGER
);
CREATE VIEW records AS
SELECT
  p.id AS id,
  '' AS scopus_id,
  p.list_type AS list_type,
  p.rank_global AS rank_global,
  p.rank_subfield AS rank_subfield,
  p.name AS name,
  p.affiliation_id AS affiliation_id,
  p.country_id AS country_id,
  p.field_id AS field_id,
  p.subfield_id AS subfield_id,
  p.subfield2_id AS subfield2_id,
  IFNULL(a.name, '') AS affiliation,
  IFNULL(c.name, '') AS country,
  IFNULL(f.name, '') AS field,
  IFNULL(s1.name, '') AS subfield,
  IFNULL(s2.name, '') AS subfield2,
  p.papers AS papers,
  p.citations AS citations,
  NULL AS citations_all,
  p.h_index AS h_index,
  NULL AS h_index_all,
  NULL AS hm_index,
  NULL AS hm_index_all,
  p.c_score AS c_score,
  NULL AS c_score_all,
  NULL AS rank_global_all,
  NULL AS single_papers,
  NULL AS single_papers_all,
  NULL AS single_cites,
  NULL AS single_cites_all,
  NULL AS first_papers,
  NULL AS first_papers_all,
  NULL AS first_cites,
  NULL AS first_cites_all,
  NULL AS last_papers,
  NULL AS last_papers_all,
  NULL AS last_cites,
  NULL AS last_cites_all,
  NULL AS citing_papers,
  NULL AS citing_papers_all,
  NULL AS cite_ratio,
  NULL AS cite_ratio_all,
  NULL AS percentile,
  NULL AS self_citation_pct,
  NULL AS first_publication_year,
  NULL AS last_publication_year,
  p.subfield_count AS subfield_count
FROM people p
LEFT JOIN affiliations a ON a.id = p.affiliation_id
LEFT JOIN countries c ON c.id = p.country_id
LEFT JOIN fields f ON f.id = p.field_id
LEFT JOIN subfields s1 ON s1.id = p.subfield_id
LEFT JOIN subfields s2 ON s2.id = p.subfield2_id;
CREATE VIRTUAL TABLE name_fts USING fts5(
  name, content='people', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE affiliation_fts USING fts5(
  name, content='affiliations', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE field_fts USING fts5(
  name, content='fields', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE subfield_fts USING fts5(
  name, content='subfields', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE INDEX idx_people_rank ON people(rank_global);
CREATE INDEX idx_people_subfield_rank ON people(rank_subfield);
CREATE INDEX idx_people_affiliation ON people(affiliation_id);
CREATE INDEX idx_people_field ON people(field_id);
CREATE INDEX idx_people_subfield ON people(subfield_id);
CREATE INDEX idx_people_country ON people(country_id);
CREATE INDEX idx_people_citations ON people(citations);
CREATE INDEX idx_people_cscore ON people(c_score);
CREATE INDEX idx_people_hindex ON people(h_index);
"""

def dictionary(connection: sqlite3.Connection, sql: str, params: tuple[str, ...]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for (name,) in connection.execute(sql, params):
        if name not in mapping:
            mapping[name] = len(mapping) + 1
    return mapping


def gzip_file(path: Path) -> Path:
    compressed = path.with_suffix(path.suffix + ".gz")
    with path.open("rb") as source, gzip.open(compressed, "wb", compresslevel=9) as target:
        target.write(source.read())
    return compressed


def build_search(source: Path, list_type: str, destination: Path) -> int:
    destination.unlink(missing_ok=True)
    origin = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    database = sqlite3.connect(destination)
    try:
        database.executescript(
            "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;"
        )
        database.executescript(SEARCH_SCHEMA)
        affiliations = dictionary(
            origin,
            "SELECT DISTINCT affiliation FROM records WHERE list_type = ? ORDER BY affiliation",
            (list_type,),
        )
        countries = dictionary(
            origin,
            "SELECT DISTINCT country FROM records WHERE list_type = ? ORDER BY country",
            (list_type,),
        )
        fields = dictionary(
            origin,
            "SELECT DISTINCT field FROM records WHERE list_type = ? AND field <> '' ORDER BY field",
            (list_type,),
        )
        subfields = dictionary(
            origin,
            """
            SELECT name FROM (
              SELECT DISTINCT subfield AS name FROM records WHERE list_type = ? AND subfield <> ''
              UNION
              SELECT DISTINCT subfield2 AS name FROM records WHERE list_type = ? AND subfield2 <> ''
            ) ORDER BY name
            """,
            (list_type, list_type),
        )
        database.executemany("INSERT INTO affiliations(id, name) VALUES (?, ?)", affiliations.items() and [(i, name) for name, i in affiliations.items()])
        database.executemany("INSERT INTO countries(id, name) VALUES (?, ?)", [(i, name) for name, i in countries.items()])
        database.executemany("INSERT INTO fields(id, name) VALUES (?, ?)", [(i, name) for name, i in fields.items()])
        database.executemany("INSERT INTO subfields(id, name) VALUES (?, ?)", [(i, name) for name, i in subfields.items()])
        rows = origin.execute(
            """
            SELECT id, list_type, name, affiliation, country, field, subfield, subfield2,
                   rank_global, rank_subfield, papers, citations, h_index, c_score, subfield_count
            FROM records WHERE list_type = ?
            """,
            (list_type,),
        )
        batch: list[tuple[object, ...]] = []
        count = 0
        for row in rows:
            batch.append(
                (
                    row[0],
                    row[1],
                    row[2],
                    affiliations.get(row[3], 0),
                    countries.get(row[4], 0),
                    fields.get(row[5], 0),
                    subfields.get(row[6], 0),
                    subfields.get(row[7], 0),
                    row[8],
                    row[9],
                    row[10],
                    row[11],
                    row[12],
                    row[13],
                    row[14],
                )
            )
            if len(batch) >= 5000:
                database.executemany(
                    """
                    INSERT INTO people (
                      id, list_type, name, affiliation_id, country_id, field_id, subfield_id,
                      subfield2_id, rank_global, rank_subfield, papers, citations, h_index,
                      c_score, subfield_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    batch,
                )
                count += len(batch)
                batch.clear()
        if batch:
            database.executemany(
                """
                INSERT INTO people (
                  id, list_type, name, affiliation_id, country_id, field_id, subfield_id,
                  subfield2_id, rank_global, rank_subfield, papers, citations, h_index,
                  c_score, subfield_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
            count += len(batch)
        database.execute("INSERT INTO name_fts(name_fts) VALUES('rebuild')")
        database.execute("INSERT INTO affiliation_fts(affiliation_fts) VALUES('rebuild')")
        database.execute("INSERT INTO field_fts(field_fts) VALUES('rebuild')")
        database.execute("INSERT INTO subfield_fts(subfield_fts) VALUES('rebuild')")
        database.commit()
        database.execute("VACUUM")
    finally:
        database.close()
        origin.close()
    return count


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
    for list_type in LISTS:
        destination = data_dir / f"search-{list_type.replace('_', '-')}.db"
        print(f"Building {destination.name}")
        count = build_search(source, list_type, destination)
        compressed = gzip_file(destination)
        destination.unlink()
        print(f"  {count:,} rows, gz {compressed.stat().st_size / 1024 / 1024:.1f}MB")
    print("Writing detail shards")
    detail_count = build_details(source, data_dir / "details")
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
