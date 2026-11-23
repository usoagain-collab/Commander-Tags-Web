"""Download Scryfall's default_cards list and write the printing manifest.

default_cards has one entry per printing (English where it exists, else the
printed language). We keep paper printings that have images and write one row
per picture to ml/data/manifest.csv: a normal card is one row, a card with a
separate image per face (transform, modal double-faced...) is one row per face.

Scryfall facts this follows (CLAUDE.md, "Scryfall data facts"):
- the bulk listing may name the link jsonl_download_uri or download_uri;
- the file may be gzip-compressed (first bytes 1f 8b) or not;
- it may be JSONL (one card per line) or one big JSON array.

Run:  uv run python -I scripts/build_manifest.py [--refresh]
"""

import argparse
import csv
import gzip
import io
import json
import sys
from pathlib import Path

import requests

ML = Path(__file__).resolve().parent.parent
DATA = ML / "data"
BULK = DATA / "bulk"
MANIFEST = DATA / "manifest.csv"

HEADERS = {
    "Accept": "application/json",
    "User-Agent": "DeckGenomeScannerML/0.1 (deckgenome.com; card scanner training data)",
}

FIELDS = [
    "id", "face", "oracle_id", "illustration_id", "name", "set", "collector_number",
    "lang", "layout", "frame", "border_color", "finishes", "released_at",
    "image_status", "image_url",
]


def bulk_entry(kind: str) -> dict:
    r = requests.get("https://api.scryfall.com/bulk-data", headers=HEADERS, timeout=60)
    r.raise_for_status()
    for entry in r.json()["data"]:
        if entry["type"] == kind:
            return entry
    raise SystemExit(f"Scryfall's bulk listing has no {kind}")


def download(entry: dict, refresh: bool) -> Path:
    url = entry.get("jsonl_download_uri") or entry.get("download_uri")
    if not url:
        raise SystemExit("default_cards entry has no download link")
    BULK.mkdir(parents=True, exist_ok=True)
    path = BULK / url.rsplit("/", 1)[-1]
    if path.exists() and not refresh:
        print(f"Using the copy already downloaded: {path.name}")
        return path
    print(f"Downloading {url} ...")
    tmp = path.with_suffix(path.suffix + ".part")
    with requests.get(url, headers={"User-Agent": HEADERS["User-Agent"]}, stream=True, timeout=120) as r:
        r.raise_for_status()
        done = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                print(f"\r  {done / 2**20:,.0f} MB", end="", flush=True)
    print()
    tmp.replace(path)
    return path


def read_cards(path: Path):
    """Yield card objects from a gzip-or-plain, JSONL-or-JSON-array file."""
    with open(path, "rb") as raw:
        gz = raw.read(2) == b"\x1f\x8b"
    opener = gzip.open if gz else open
    with opener(path, "rb") as f:
        text = io.TextIOWrapper(f, encoding="utf-8")
        first = ""
        while not first.strip():
            first = text.readline()
            if not first:
                return
        if first.lstrip().startswith("["):
            # One big JSON array: read it whole (a few GB of memory; fine on 16 GB).
            for card in json.loads(first + text.read()):
                yield card
            return
        yield json.loads(first)
        for line in text:
            line = line.strip().rstrip(",")
            if line:
                yield json.loads(line)


def rows_for(card: dict):
    if "paper" not in card.get("games", []):
        return
    if card.get("image_status") == "missing":
        return
    base = {
        "id": card["id"],
        "name": card["name"],
        "set": card["set"],
        "collector_number": card["collector_number"],
        "lang": card["lang"],
        "layout": card["layout"],
        "frame": card.get("frame", ""),
        "border_color": card.get("border_color", ""),
        "finishes": "|".join(card.get("finishes", [])),
        "released_at": card.get("released_at", ""),
        "image_status": card.get("image_status", ""),
    }
    if card.get("image_uris"):
        url = card["image_uris"].get("normal")
        if url:
            face0 = (card.get("card_faces") or [{}])[0]
            yield {
                **base,
                "face": 0,
                "oracle_id": card.get("oracle_id") or face0.get("oracle_id", ""),
                "illustration_id": card.get("illustration_id") or face0.get("illustration_id", ""),
                "image_url": url,
            }
        return
    # Each face has its own picture (transform, modal DFC, reversible...).
    for i, face in enumerate(card.get("card_faces") or []):
        url = (face.get("image_uris") or {}).get("normal")
        if not url:
            continue
        yield {
            **base,
            "face": i,
            "name": face.get("name", card["name"]),
            "oracle_id": face.get("oracle_id") or card.get("oracle_id", ""),
            "illustration_id": face.get("illustration_id", ""),
            "image_url": url,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="download a fresh default_cards file")
    args = parser.parse_args()

    entry = bulk_entry("default_cards")
    print(f"default_cards updated {entry['updated_at']}")
    path = download(entry, args.refresh)

    seen = skipped = 0
    printings = set()
    langs: dict[str, int] = {}
    tmp = MANIFEST.with_suffix(".csv.part")
    with open(tmp, "w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=FIELDS)
        writer.writeheader()
        rows = 0
        for card in read_cards(path):
            seen += 1
            wrote = False
            for row in rows_for(card):
                writer.writerow(row)
                rows += 1
                wrote = True
            if wrote:
                printings.add(card["id"])
                langs[card["lang"]] = langs.get(card["lang"], 0) + 1
            else:
                skipped += 1
            if seen % 20000 == 0:
                print(f"  read {seen:,} printings", flush=True)
    tmp.replace(MANIFEST)

    print()
    print(f"Printings in default_cards: {seen:,}")
    print(f"Skipped (not paper, or no image): {skipped:,}")
    print(f"Paper printings with images: {len(printings):,}")
    print(f"Pictures (rows; double-faced cards have one per face): {rows:,}")
    print("Languages: " + ", ".join(f"{k} {v:,}" for k, v in sorted(langs.items(), key=lambda kv: -kv[1])))
    print(f"Wrote {MANIFEST}")


if __name__ == "__main__":
    sys.exit(main())
