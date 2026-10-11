#!/usr/bin/env python3
"""Download and extract the official Elsevier 2026 Top-Cited Scientists data."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import ssl
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

DATASET_ID = "btchxktzyw"
VERSION = 9
DOI = f"10.17632/{DATASET_ID}.{VERSION}"
DOWNLOAD_URL = (
    f"https://elsevier.digitalcommonsdata.com/public-api/zip/"
    f"{DATASET_ID}/download/{VERSION}"
)
WANTED_FILES = {
    "career": "Table_1_Authors_career_2025_pubs_since_1788_wopp_extracted_202608.xlsx",
    "single_year": "Table_1_Authors_singleyr_2025_pubs_since_1788_wopp_extracted_202608.xlsx",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, destination: Path) -> None:
    partial = destination.with_suffix(destination.suffix + ".part")
    print(f"Downloading {url}")
    if shutil.which("curl"):
        subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--retry",
                "3",
                "--continue-at",
                "-",
                "--output",
                str(partial),
                url,
            ],
            check=True,
        )
    else:
        request = urllib.request.Request(
            url, headers={"User-Agent": "TOP2Scientists/1.0"}
        )
        context = ssl.create_default_context()
        with urllib.request.urlopen(request, context=context, timeout=120) as response:
            with partial.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
    partial.replace(destination)


def extract_tables(archive: Path, raw_dir: Path) -> list[dict[str, object]]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[dict[str, object]] = []
    with zipfile.ZipFile(archive) as bundle:
        members = {Path(name).name: name for name in bundle.namelist()}
        for list_type, filename in WANTED_FILES.items():
            if filename not in members:
                raise RuntimeError(f"Official archive does not contain {filename}")
            target = raw_dir / filename
            if not target.exists():
                print(f"Extracting {filename}")
                with bundle.open(members[filename]) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
            extracted.append(
                {
                    "list_type": list_type,
                    "filename": filename,
                    "size": target.stat().st_size,
                    "sha256": sha256(target),
                }
            )
    return extracted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    args.data_dir.mkdir(parents=True, exist_ok=True)
    archive = args.data_dir / f"{DATASET_ID}-{VERSION}.zip"
    if args.force and archive.exists():
        archive.unlink()
    if not archive.exists():
        download(DOWNLOAD_URL, archive)
    else:
        print(f"Using existing archive: {archive}")

    try:
        with zipfile.ZipFile(archive) as bundle:
            bad_file = bundle.testzip()
            if bad_file:
                raise RuntimeError(f"Archive checksum failed for {bad_file}")
    except zipfile.BadZipFile as error:
        raise RuntimeError("Downloaded file is not a valid ZIP archive") from error

    files = extract_tables(archive, args.data_dir / "raw")
    manifest = {
        "dataset_id": DATASET_ID,
        "version": VERSION,
        "doi": DOI,
        "source_url": DOWNLOAD_URL,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "archive": {
            "filename": archive.name,
            "size": archive.stat().st_size,
            "sha256": sha256(archive),
        },
        "files": files,
        "license": "CC BY-NC 3.0",
    }
    manifest_path = args.data_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Ready: {manifest_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Data download failed: {error}", file=sys.stderr)
        raise SystemExit(1)
