"""Extract base64 image columns from SQLite to files before R2 upload."""

from __future__ import annotations

import argparse
import base64
import mimetypes
import re
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "nail_studio.db"
DEFAULT_OUT = ROOT / "migration_export" / "db_extracted_assets"


SPECS = [
    ("assets", "asset_id", "base64_data", "url"),
    ("products", "product_id", "image_base64", "image_url"),
    ("rewards", "reward_id", "image_base64", "image_url"),
    ("promotional_assets", "promo_asset_id", "image_base64", "image_url"),
]


def parse_data_url(value: str):
    match = re.match(r"^data:([^;,]+);base64,(.+)$", value or "", re.I | re.S)
    if not match:
        return "image/png", ".png", base64.b64decode(value)
    mime_type = match.group(1)
    ext = mimetypes.guess_extension(mime_type) or ".png"
    return mime_type, ext, base64.b64decode(match.group(2), validate=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    db_path = Path(args.db)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        for table, id_col, base64_col, _url_col in SPECS:
            try:
                rows = connection.execute(
                    f'SELECT "{id_col}", "{base64_col}" FROM "{table}" WHERE COALESCE("{base64_col}", "") != ""'
                ).fetchall()
            except sqlite3.OperationalError:
                continue
            for row in rows:
                try:
                    _mime_type, ext, payload = parse_data_url(row[base64_col])
                except Exception as error:
                    print(f"[skip] {table}/{row[id_col]}: {error}")
                    continue
                target = out_dir / "db-extracted" / table / f"{row[id_col]}{ext}"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                count += 1

    print(f"Extracted {count} database base64 assets to {out_dir}")


if __name__ == "__main__":
    main()
