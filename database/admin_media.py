import json
import sqlite3
import sys

from admin_db import DB_PATH, ensure_admin_schema


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    item_kind = str(payload.get("itemKind") or "product")
    row_id = str(payload.get("id") or "").strip()
    if not row_id:
        raise ValueError("id is required")

    with sqlite3.connect(DB_PATH) as connection:
        ensure_admin_schema(connection)
        if item_kind == "asset":
            row = connection.execute(
                "SELECT base64_data AS image_base64, url AS image_url FROM assets WHERE asset_id=?",
                (row_id,),
            ).fetchone()
        elif item_kind == "template":
            row = connection.execute(
                """
                SELECT a.base64_data AS image_base64, a.url AS image_url
                FROM templates t
                LEFT JOIN assets a ON a.asset_id = COALESCE(t.cover_asset_id, t.image_asset_id)
                WHERE t.template_id=?
                """,
                (row_id,),
            ).fetchone()
        elif item_kind == "promo":
            row = connection.execute(
                "SELECT image_base64, image_url FROM promotional_assets WHERE promo_asset_id=?",
                (row_id,),
            ).fetchone()
        elif item_kind == "reward":
            row = connection.execute(
                "SELECT image_base64, image_url FROM rewards WHERE reward_id=?",
                (row_id,),
            ).fetchone()
        else:
            row = connection.execute(
                """
                SELECT COALESCE(NULLIF(p.image_base64, ''), a.base64_data, '') AS image_base64,
                       COALESCE(NULLIF(p.image_url, ''), a.url, '') AS image_url
                FROM products p
                LEFT JOIN assets a ON a.asset_id = p.cover_asset_id
                WHERE p.product_id=?
                """,
                (row_id,),
            ).fetchone()
    if not row:
        raise ValueError("image record not found")
    image_base64, image_url = row
    print(json.dumps({"ok": True, "image_base64": image_base64 or "", "image_url": image_url or ""}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
