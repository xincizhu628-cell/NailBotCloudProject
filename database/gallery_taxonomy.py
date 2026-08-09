import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "nail_studio.db"
SCHEMA_PATH = ROOT / "database" / "schema.sql"


def rows(connection, query, params=()):
    cursor = connection.execute(query, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def main():
    connection = sqlite3.connect(DB_PATH)
    try:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        data = {
            "official_galleries": rows(
                connection,
                """
                SELECT official_gallery_id AS id, gallery_name AS name, description, sort_order, status
                FROM official_galleries
                WHERE status='active'
                ORDER BY sort_order ASC, created_at DESC
                """,
            ),
            "community_galleries": rows(
                connection,
                """
                SELECT community_gallery_id AS id, gallery_name AS name, description, 'active' AS status
                FROM community_galleries
                ORDER BY created_at DESC
                """,
            ),
            "shapes": rows(
                connection,
                "SELECT shape_id AS id, shape AS name, status FROM shapes WHERE status='on' ORDER BY created_at ASC",
            ),
            "styles": rows(
                connection,
                "SELECT style_id AS id, style AS name, status FROM styles WHERE status='on' ORDER BY created_at ASC",
            ),
            "materials": rows(
                connection,
                "SELECT material_id AS id, material AS name, image, status FROM materials WHERE status='on' ORDER BY created_at ASC",
            ),
        }
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
