import json
import re
import sqlite3
import sys
import time
from pathlib import Path

from admin_db import DB_PATH, ensure_admin_schema


TABLES = {
    "styles": {
        "id": "style_id",
        "label": "style",
        "fields": ["style_id", "style", "status", "created_at", "updated_at"],
        "mutable": ["style", "status"],
    },
    "shapes": {
        "id": "shape_id",
        "label": "shape",
        "fields": ["shape_id", "shape", "status", "created_at", "updated_at"],
        "mutable": ["shape", "status"],
    },
    "materials": {
        "id": "material_id",
        "label": "material",
        "fields": ["material_id", "material", "image", "status", "created_at", "updated_at"],
        "mutable": ["material", "image", "status"],
    },
    "tags": {
        "id": "tag_id",
        "label": "tag",
        "fields": ["tag_id", "tag", "viewed_number", "attendance_number", "created_by_type", "created_by_user_id", "status", "created_at", "updated_at"],
        "mutable": ["tag", "status"],
    },
    "topics": {
        "id": "topic_id",
        "label": "topic",
        "fields": ["topic_id", "topic", "created_at", "view_number", "attendance_number", "status"],
        "mutable": ["topic", "status"],
    },
}


def slug(value):
    text = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return text or str(int(time.time() * 1000))


def ensure_schema(connection):
    ensure_admin_schema(connection)


def rows(connection, table):
    meta = TABLES[table]
    fields = ", ".join(meta["fields"])
    order_column = "created_at" if "created_at" in meta["fields"] else meta["id"]
    result = connection.execute(f"SELECT {fields} FROM {table} ORDER BY {order_column} DESC").fetchall()
    return [dict(zip(meta["fields"], row)) for row in result]


def create_item(connection, table, item):
    meta = TABLES[table]
    label_key = meta["label"]
    label = str(item.get(label_key) or item.get("name") or "").strip()
    if not label:
        raise ValueError(f"{label_key} is required")
    status = "off" if item.get("status") == "off" else "on"
    payload = {
        label_key: label,
        "status": status,
    }
    if table == "materials":
        payload["image"] = str(item.get("image") or "").strip()
    if table == "tags":
        payload["created_by_type"] = "member" if item.get("created_by_type") == "member" else "admin"
        payload["created_by_user_id"] = item.get("created_by_user_id") or None

    columns = list(payload.keys())
    placeholders = ", ".join("?" for _ in columns)
    updates = ", ".join(f"{column}=excluded.{column}" for column in columns)
    timestamp_update = ", updated_at=CURRENT_TIMESTAMP" if "updated_at" in meta["fields"] else ""
    connection.execute(
        f"""
        INSERT INTO {table} ({", ".join(columns)})
        VALUES ({placeholders})
        ON CONFLICT({label_key}) DO UPDATE SET {updates}{timestamp_update}
        """,
        [payload[column] for column in columns],
    )
    item_id = connection.execute(f"SELECT {meta['id']} FROM {table} WHERE {label_key}=?", (label,)).fetchone()[0]
    return item_id


def update_item(connection, table, item_id, item):
    meta = TABLES[table]
    allowed = [field for field in meta["mutable"] if field in item]
    if not allowed:
        return
    values = []
    assignments = []
    for field in allowed:
        value = item[field]
        if field == "status":
            value = "off" if value == "off" else "on"
        assignments.append(f"{field}=?")
        values.append(value)
    if "updated_at" in meta["fields"]:
        assignments.append("updated_at=CURRENT_TIMESTAMP")
    values.append(item_id)
    connection.execute(f"UPDATE {table} SET {', '.join(assignments)} WHERE {meta['id']}=?", values)


def delete_item(connection, table, item_id):
    meta = TABLES[table]
    connection.execute("DELETE FROM taxonomy_links WHERE taxonomy_type=? AND taxonomy_id=?", [table, item_id])
    connection.execute(f"DELETE FROM {table} WHERE {meta['id']}=?", [item_id])


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    action = payload.get("action") or "list"
    table = payload.get("table")
    if table and table not in TABLES:
        raise ValueError("Unsupported taxonomy table")

    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(connection)
        if action == "list":
            data = {name: rows(connection, name) for name in TABLES}
            print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
            return
        if not table:
            raise ValueError("table is required")
        if action == "create":
            item_id = create_item(connection, table, payload.get("item") or {})
        elif action == "update":
            item_id = str(payload.get("id") or "").strip()
            update_item(connection, table, item_id, payload.get("item") or {})
        elif action == "delete":
            item_id = str(payload.get("id") or "").strip()
            delete_item(connection, table, item_id)
        else:
            raise ValueError("Unsupported action")
        connection.commit()
        print(json.dumps({"ok": True, "table": table, "id": item_id, "data": rows(connection, table)}, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
