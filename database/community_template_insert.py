import base64
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

from admin_db import ensure_admin_schema
from user_persistence import ensure_user


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "nail_studio.db"
UPLOAD_DIR = ROOT / "assets" / "uploads" / "community-templates"


def slug(value):
    text = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return text or "template"


def decode_data_url(data_url):
    match = re.match(r"^data:(image/(?:png|jpe?g|webp));base64,(.+)$", data_url or "", re.I | re.S)
    if not match:
        raise ValueError("image must be a png/jpg/webp data URL")
    mime_type = match.group(1).lower()
    ext = "jpg" if mime_type == "image/jpeg" else mime_type.split("/")[-1]
    return mime_type, ext, base64.b64decode(match.group(2))


def csv_values(*values):
    parts = []
    for value in values:
        if isinstance(value, list):
            parts.extend(value)
        elif value:
            parts.extend(str(value).split(","))
    cleaned = []
    for part in parts:
        text = str(part).strip()
        if text and text not in cleaned:
            cleaned.append(text)
    return ",".join(cleaned)


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    template_name = (payload.get("templateName") or payload.get("template_name") or "").strip()
    image = payload.get("image") or ""
    if not template_name:
        raise ValueError("templateName is required")
    if not image:
        raise ValueError("image is required")

    now = int(time.time() * 1000)
    template_id = payload.get("templateId") or f"community_{now}_{slug(template_name)}"
    gallery_id = payload.get("galleryId") or "cgallery_community_001"
    gallery_template_id = f"gt_{template_id}"
    mime_type, ext, image_bytes = decode_data_url(image)

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    relative_path = Path("assets") / "uploads" / "community-templates" / f"{template_id}.{ext}"
    output_path = ROOT / relative_path
    output_path.write_bytes(image_bytes)

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        ensure_admin_schema(connection)
        user = ensure_user(connection, payload.get("userId"), payload.get("recoveryCode"))
        user_id = user.get("userId")
        username = user.get("username") or "Community Creator"
        asset_id = f"asset_{template_id}_cover"

        connection.execute(
            """
            INSERT OR REPLACE INTO assets (
              asset_id, owner_user_id, asset_type, mime_type, url, width, height
            ) VALUES (?, ?, 'community_template_image', ?, ?, ?, ?)
            """,
            (
                asset_id,
                user_id,
                mime_type,
                relative_path.as_posix(),
                int(payload.get("width") or 0) or None,
                int(payload.get("height") or 0) or None,
            ),
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO community_galleries (community_gallery_id, gallery_name, description)
            VALUES (?, 'Community Gallery', 'User uploaded public templates')
            """,
            (gallery_id,),
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO templates (
              template_id, author_user_id, source_type, template_name, template_title, description,
              template_type, design_type, nail_shape, material_type, shape_categories,
              style_categories, material_categories, topic_tags, tags, template_object_json,
              cover_asset_id, image_asset_id, image_asset_ids, author_display_name,
              author_level, visibility, status, heat_count, published_at, updated_at
            ) VALUES (?, ?, 'community', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'active', ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                template_id,
                user_id,
                template_name,
                payload.get("templateTitle") or template_name,
                payload.get("description") or "",
                payload.get("templateType") or "design",
                payload.get("designType") or "nail",
                payload.get("nailShape") or "",
                payload.get("materialType") or "",
                csv_values(payload.get("shapeCategories"), payload.get("nailShape")),
                csv_values(payload.get("styleCategories")),
                csv_values(payload.get("materialCategories"), payload.get("materialType")),
                csv_values(payload.get("topicTags")),
                csv_values(payload.get("tags")),
                payload.get("templateObjectJson") or None,
                asset_id,
                asset_id,
                json.dumps([asset_id], ensure_ascii=False),
                payload.get("authorDisplayName") or username,
                payload.get("authorLevel") or user.get("userKind") or "Member",
                int(payload.get("heatCount") or 0),
                payload.get("publishedAt") or time.strftime("%Y-%m-%d"),
            ),
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO gallery_templates (
              gallery_template_id, gallery_type, gallery_id, template_id, user_id, sort_order
            ) VALUES (?, 'community', ?, ?, ?, ?)
            """,
            (gallery_template_id, gallery_id, template_id, user_id, int(payload.get("sortOrder") or 0)),
        )
        connection.commit()
    finally:
        connection.close()

    print(json.dumps({
        "ok": True,
        "templateId": template_id,
        "assetId": asset_id,
        "galleryId": gallery_id,
        "imageUrl": relative_path.as_posix(),
        "user": user,
        "template": {
            "template_id": template_id,
            "source_type": "community",
            "template_name": template_name,
            "template_title": payload.get("templateTitle") or template_name,
            "description": payload.get("description") or "",
            "design_type": payload.get("designType") or "nail",
            "nail_shape": payload.get("nailShape") or "",
            "material_type": payload.get("materialType") or "",
            "style_categories": csv_values(payload.get("styleCategories")),
            "material_categories": csv_values(payload.get("materialCategories"), payload.get("materialType")),
            "tags": csv_values(payload.get("tags")),
            "author_user_id": user_id,
            "author_display_name": username,
            "author_level": payload.get("authorLevel") or user.get("userKind") or "Member",
            "heat_count": int(payload.get("heatCount") or 0),
            "like_count": 0,
            "favorite_count": 0,
            "comment_count": 0,
            "published_at": payload.get("publishedAt") or time.strftime("%Y-%m-%d"),
            "image_url": relative_path.as_posix(),
            "image_list": [relative_path.as_posix()],
            "category_ids": [
                gallery_id,
                f"community:{gallery_id}",
                payload.get("nailShape") or "",
                payload.get("materialType") or "",
                f"type-{payload.get('designType') or 'nail'}",
            ],
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
