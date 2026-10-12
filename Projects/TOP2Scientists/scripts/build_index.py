#!/usr/bin/env python3
"""Build id indexes, name blocks, institution postings, and list cards."""

from __future__ import annotations

import gzip
import json
import re
import shutil
import sqlite3
from pathlib import Path

SHARD_SIZE = 400
BUCKET_PEOPLE = 1500
LISTS = ("single_year", "career")
TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

ORDERS = (
    ("subfieldRank", "rank_subfield", False),
    ("citations", "citations", False),
    ("hIndex", "h_index", False),
    ("name", "name", True),
)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    with path.open("wb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", compresslevel=9, mtime=0) as target:
            target.write(raw)


def reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def letter_name(token: str) -> str:
    character = token[0]
    if "a" <= character <= "z" or character.isdigit():
        return character
    return "u" + format(ord(character), "x")


def slug(value: str, used: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "empty"
    name = base
    suffix = 2
    while name in used:
        name = f"{base}-{suffix}"
        suffix += 1
    used.add(name)
    return name


def name_tokens(name: str) -> list[str]:
    seen: set[str] = set()
    tokens: list[str] = []
    for raw in TOKEN_RE.findall(name or ""):
        token = raw.casefold()
        if len(token) < 2 or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def institution_tokens(name: str) -> list[str]:
    words: list[str] = []
    for raw in (name or "").casefold().replace(",", " ").split():
        token = "".join(character for character in raw if character.isalnum())
        if token:
            words.append(token)
    return words


def card_record(row: sqlite3.Row) -> dict[str, object]:
    return {
        "n": row["name"],
        "a": row["affiliation"],
        "c": row["country"],
        "f": row["field"],
        "s": row["subfield"],
        "r": row["rank_global"],
        "rs": row["rank_subfield"],
        "ci": row["citations"],
        "h": row["h_index"],
        "cs": row["c_score"],
    }


def build_cards(source: Path, directory: Path) -> None:
    reset_dir(directory)
    connection = sqlite3.connect(source)
    connection.row_factory = sqlite3.Row
    bucket: int | None = None
    batch: dict[str, dict[str, object]] = {}
    try:
        for row in connection.execute("SELECT * FROM records ORDER BY id"):
            record_bucket = int(row["id"]) // SHARD_SIZE
            if bucket is None:
                bucket = record_bucket
            if record_bucket != bucket:
                write_json(directory / f"{bucket:04d}.json.gz", batch)
                batch = {}
                bucket = record_bucket
            batch[str(row["id"])] = card_record(row)
        if bucket is not None and batch:
            write_json(directory / f"{bucket:04d}.json.gz", batch)
    finally:
        connection.close()


def ordered_ids(rows: list[sqlite3.Row], column: str, textual: bool) -> tuple[list[int], int]:
    if textual:
        rows = sorted(rows, key=lambda row: ((row["name"] or "").casefold(), row["id"]))
        return [int(row["id"]) for row in rows], 0
    present = [row for row in rows if row[column] is not None]
    missing = [row for row in rows if row[column] is None]
    present.sort(key=lambda row: (row[column], row["id"]))
    missing.sort(key=lambda row: row["id"])
    return [int(row["id"]) for row in present + missing], len(missing)


def build_list(source: Path, list_type: str, directory: Path) -> dict[str, object]:
    reset_dir(directory)
    connection = sqlite3.connect(source)
    connection.row_factory = sqlite3.Row
    rows = list(connection.execute("SELECT * FROM records WHERE list_type = ?", (list_type,)))
    connection.close()
    rows.sort(key=lambda row: (row["rank_global"] is None, row["rank_global"] or 0, row["id"]))
    rank_ids = [int(row["id"]) for row in rows if row["rank_global"] is not None]
    rank_nulls = [int(row["id"]) for row in rows if row["rank_global"] is None]
    contiguous = (
        len(rank_nulls) == 0
        and len(rank_ids) > 0
        and rank_ids == list(range(rank_ids[0], rank_ids[0] + len(rank_ids)))
    )
    cscore_ids, cscore_nulls = ordered_ids(rows, "c_score", False)
    cscore_shares_rank = cscore_ids == rank_ids + rank_nulls

    orders: dict[str, object] = {
        "rank": {
            "contiguous": contiguous,
            "start": rank_ids[0] if rank_ids else 0,
            "count": len(rank_ids),
            "nulls": len(rank_nulls),
        },
        "cScore": {"sameAs": "rank"} if cscore_shares_rank else {"nulls": cscore_nulls},
    }
    if not cscore_shares_rank:
        write_json(directory / "order-cScore.json.gz", cscore_ids)
        orders["cScore"] = {"file": "order-cScore.json.gz", "nulls": cscore_nulls}
    if rank_nulls:
        write_json(directory / "order-rank.json.gz", rank_ids + rank_nulls)
        orders["rank"] = {"file": "order-rank.json.gz", "nulls": len(rank_nulls), "contiguous": False}

    for key, column, textual in ORDERS:
        ids, nulls = ordered_ids(rows, column, textual)
        file_name = f"order-{key}.json.gz"
        write_json(directory / file_name, ids)
        orders[key] = {"file": file_name, "nulls": nulls}

    facets: dict[str, list[dict[str, object]]] = {"country": [], "field": [], "subfield": []}
    columns = {"country": "country", "field": "field", "subfield": "subfield"}
    for facet, column in columns.items():
        groups: dict[str, list[int]] = {}
        for row in rows:
            name = row[column] or ""
            if not name:
                continue
            groups.setdefault(name, []).append(int(row["id"]))
        used: set[str] = set()
        facet_dir = directory / facet
        entries = []
        for name in sorted(groups, key=str.casefold):
            file_name = slug(name, used)
            ids = groups[name]
            ids.sort()
            write_json(facet_dir / f"{file_name}.json.gz", ids)
            entries.append({"name": name, "count": len(ids), "file": file_name})
        facets[facet] = entries

    letters: dict[str, dict[str, list[int]]] = {}
    for row in rows:
        for token in name_tokens(row["name"] or ""):
            bucket = letters.setdefault(letter_name(token), {})
            bucket.setdefault(token, []).append(int(row["id"]))
    name_dir = directory / "names"
    for key, payload in letters.items():
        packed = {token: sorted(set(ids)) for token, ids in payload.items()}
        write_json(name_dir / f"{key}.json.gz", packed)

    institutions: dict[str, list[int]] = {}
    for row in rows:
        name = row["affiliation"] or ""
        if name:
            institutions.setdefault(name, []).append(int(row["id"]))
    names = sorted(institutions, key=str.casefold)
    buckets: list[list[int]] = []
    bucket_people = 0
    current: list[int] = []
    assignment: list[int] = []
    for index, name in enumerate(names):
        people = institutions[name]
        if current and bucket_people + len(people) > BUCKET_PEOPLE:
            buckets.append(current)
            current = []
            bucket_people = 0
        current.append(index)
        bucket_people += len(people)
        assignment.append(len(buckets))
    if current:
        buckets.append(current)
    posting_dir = directory / "institution-ids"
    for bucket_index, members in enumerate(buckets):
        payload = {str(index): sorted(institutions[names[index]]) for index in members}
        write_json(posting_dir / f"{bucket_index:04d}.json.gz", payload)
    write_json(
        directory / "institutions.json.gz",
        {
            "names": names,
            "counts": [len(institutions[name]) for name in names],
            "buckets": assignment,
        },
    )
    catalog = {
        "listType": list_type,
        "count": len(rows),
        "shardSize": SHARD_SIZE,
        "orders": orders,
        "countries": facets["country"],
        "fields": facets["field"],
        "subfields": facets["subfield"],
        "nameLetters": sorted(letters),
        "institutionBuckets": len(buckets),
        "broadInstitutionLimit": 4000,
    }
    (directory / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(
        f"  {list_type}: {len(rows):,} people, {len(facets['country'])} countries, "
        f"{len(letters)} name blocks, {len(buckets)} institution buckets, "
        f"c-score shares rank={cscore_shares_rank}"
    )
    return catalog


def build_indexes(source: Path, data_dir: Path) -> None:
    if not source.exists():
        raise RuntimeError(f"Missing source database: {source}")
    print("Writing list cards")
    build_cards(source, data_dir / "cards")
    index_root = data_dir / "index"
    reset_dir(index_root)
    for list_type in LISTS:
        print(f"Writing {list_type} index")
        build_list(source, list_type, index_root / list_type.replace("_", "-"))
