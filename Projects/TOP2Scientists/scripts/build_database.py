#!/usr/bin/env python3
"""Stream the two official XLSX tables into an indexed SQLite database."""

from __future__ import annotations

import argparse
import math
import re
import sqlite3
import sys
import time
import zipfile
from pathlib import Path
from typing import Iterator
from xml.etree import ElementTree

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
TAG = f"{{{MAIN_NS}}}"
FILES = {
    "career": "Table_1_Authors_career_2025_pubs_since_1788_wopp_extracted_202608.xlsx",
    "single_year": "Table_1_Authors_singleyr_2025_pubs_since_1788_wopp_extracted_202608.xlsx",
}


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if not letters:
        return 0
    value = 0
    for character in letters.group():
        value = value * 26 + ord(character) - 64
    return value - 1


def cell_value(cell: ElementTree.Element, shared: list[str]) -> str:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{TAG}t"))
    node = cell.find(f"{TAG}v")
    if node is None or node.text is None:
        return ""
    if cell_type == "s":
        return shared[int(node.text)]
    return node.text


def load_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    strings: list[str] = []
    with workbook.open("xl/sharedStrings.xml") as source:
        for _, element in ElementTree.iterparse(source, events=("end",)):
            if element.tag == f"{TAG}si":
                strings.append(
                    "".join(node.text or "" for node in element.iter(f"{TAG}t"))
                )
                element.clear()
    return strings


def spreadsheet_rows(path: Path) -> Iterator[dict[str, str]]:
    with zipfile.ZipFile(path) as workbook:
        shared = load_shared_strings(workbook)
        worksheet = "xl/worksheets/sheet2.xml"
        if worksheet not in workbook.namelist():
            raise RuntimeError(f"{path.name} does not contain the expected Data sheet")
        headers: list[str] | None = None
        with workbook.open(worksheet) as source:
            for _, row in ElementTree.iterparse(source, events=("end",)):
                if row.tag != f"{TAG}row":
                    continue
                values: list[str] = []
                for cell in row.findall(f"{TAG}c"):
                    index = column_index(cell.get("r", "A1"))
                    while len(values) <= index:
                        values.append("")
                    values[index] = cell_value(cell, shared).strip()
                if headers is None:
                    headers = values
                elif any(values):
                    values.extend([""] * (len(headers) - len(values)))
                    yield dict(zip(headers, values, strict=False))
                row.clear()


def as_float(value: str) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def as_int(value: str) -> int | None:
    number = as_float(value)
    return round(number) if number is not None else None


def record(row: dict[str, str], list_type: str) -> tuple[object, ...]:
    citation_column = "nc9625 (ns)" if list_type == "career" else "nc2525 (ns)"
    rank_subfield = as_int(row.get("rank sm-subfield-1 (ns)", ""))
    subfield_count = as_int(row.get("sm-subfield-1 count", ""))
    percentile = None
    in_top2 = 0
    if rank_subfield and subfield_count:
        percentile = max(
            0.0, min(100.0, 100.0 * (1.0 - (rank_subfield - 1) / subfield_count))
        )
        in_top2 = 1 if rank_subfield / subfield_count <= 0.02 else 0
    self_fraction = as_float(row.get("self%", ""))
    self_percent = self_fraction * 100 if self_fraction is not None else None
    return (
        "",
        list_type,
        as_int(row.get("rank (ns)", "")),
        rank_subfield,
        row.get("authfull", ""),
        row.get("inst_name", ""),
        row.get("cntry", "").upper(),
        row.get("sm-field", ""),
        row.get("sm-subfield-1", ""),
        as_int(row.get("np6025", "")),
        as_int(row.get(citation_column, "")),
        as_int(row.get("h25 (ns)", "")),
        as_float(row.get("hm25 (ns)", "")),
        as_float(row.get("c (ns)", "")),
        percentile,
        self_percent,
        as_int(row.get("firstyr", "")),
        as_int(row.get("lastyr", "")),
        subfield_count,
        in_top2,
    )


SCHEMA = """
CREATE TABLE records (
  id INTEGER PRIMARY KEY,
  scopus_id TEXT NOT NULL DEFAULT '',
  list_type TEXT NOT NULL CHECK (list_type IN ('career', 'single_year')),
  rank_global INTEGER,
  rank_subfield INTEGER,
  name TEXT NOT NULL,
  affiliation TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL DEFAULT '',
  subfield TEXT NOT NULL DEFAULT '',
  papers INTEGER,
  citations INTEGER,
  h_index INTEGER,
  hm_index REAL,
  c_score REAL,
  percentile REAL,
  self_citation_pct REAL,
  first_publication_year INTEGER,
  last_publication_year INTEGER,
  subfield_count INTEGER,
  in_top2 INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idx_records_list_rank ON records(list_type, rank_global);
CREATE INDEX idx_records_list_subfield_rank
  ON records(list_type, subfield, rank_subfield);
CREATE INDEX idx_records_list_field ON records(list_type, field);
CREATE INDEX idx_records_list_country ON records(list_type, country);
CREATE INDEX idx_records_list_citations ON records(list_type, citations DESC);
CREATE INDEX idx_records_list_cscore ON records(list_type, c_score DESC);
CREATE INDEX idx_records_list_top2 ON records(list_type, in_top2, rank_global);
CREATE VIRTUAL TABLE records_fts USING fts5(
  name, affiliation, country, field, subfield,
  content='records', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
"""

INSERT = """
INSERT INTO records (
  scopus_id, list_type, rank_global, rank_subfield, name, affiliation,
  country, field, subfield, papers, citations, h_index, hm_index, c_score,
  percentile, self_citation_pct, first_publication_year, last_publication_year,
  subfield_count, in_top2
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def build(raw_dir: Path, destination: Path) -> dict[str, int]:
    missing = [filename for filename in FILES.values() if not (raw_dir / filename).exists()]
    if missing:
        raise RuntimeError(
            "Missing source files. Run scripts/download_data.py first: "
            + ", ".join(missing)
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".db.tmp")
    temporary.unlink(missing_ok=True)
    counts: dict[str, int] = {}
    connection = sqlite3.connect(temporary)
    try:
        connection.executescript(
            "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;"
        )
        connection.executescript(SCHEMA)
        for list_type, filename in FILES.items():
            started = time.monotonic()
            count = 0
            batch: list[tuple[object, ...]] = []
            print(f"Importing {filename}")
            with connection:
                for row in spreadsheet_rows(raw_dir / filename):
                    batch.append(record(row, list_type))
                    if len(batch) >= 5000:
                        connection.executemany(INSERT, batch)
                        count += len(batch)
                        batch.clear()
                        print(f"  {count:,} rows", end="\r", flush=True)
                if batch:
                    connection.executemany(INSERT, batch)
                    count += len(batch)
            counts[list_type] = count
            print(f"  {count:,} rows in {time.monotonic() - started:.1f}s")

        connection.execute("INSERT INTO records_fts(records_fts) VALUES('rebuild')")
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            [
                ("dataset_id", "btchxktzyw"),
                ("version", "9"),
                ("doi", "10.17632/btchxktzyw.9"),
                ("citation_year", "2025"),
                ("career_count", str(counts.get("career", 0))),
                ("single_year_count", str(counts.get("single_year", 0))),
            ],
        )
        connection.execute("PRAGMA optimize")
        connection.commit()
    finally:
        connection.close()
    temporary.replace(destination)
    return counts


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=root / "data" / "raw")
    parser.add_argument("--output", type=Path, default=root / "data" / "scientists.db")
    args = parser.parse_args()
    counts = build(args.raw_dir, args.output)
    print(
        f"Database ready: {args.output} "
        f"({counts.get('career', 0):,} career, "
        f"{counts.get('single_year', 0):,} single-year)"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, sqlite3.Error, zipfile.BadZipFile) as error:
        print(f"Database build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
