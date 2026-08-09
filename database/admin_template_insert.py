import base64
import base64
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

from admin_db import ensure_admin_schema


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "nail_studio.db"
UPLOAD_DIR = ROOT / "assets" / "uploads" / "official-templates"


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


def image_payloads(payload):
    images = payload.get("images")
    if isinstance(images, list) and images:
        return [
            {
                "data": item.get("data") or item.get("image") or "",
                "width": int(item.get("width") or 0),
                "height": int(item.get("height") or 0),
            }
            for item in images[:6]
            if isinstance(item, dict) and (item.get("data") or item.get("image"))
        ]
    if payload.get("image"):
        return [{
            "data": payload.get("image"),
            "width": int(payload.get("width") or 0),
            "height": int(payload.get("height") or 0),
        }]
    return []


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    now = int(time.time() * 1000)
    template_name = payload.get("templateName") or payload.get("template_name") or "Official Template"
    template_id = payload.get("templateId") or f"official_{now}_{slug(template_name)}"
    gallery_template_id = f"gt_{template_id}"
    gallery_id = payload.get("galleryId") or "ogallery_factory_001"
    images = image_payloads(payload)
    if not images:
        raise ValueError("at least one image is required")
    if len(images) > 6:
        images = images[:6]

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved_assets = []
    for index, image in enumerate(images):
        mime_type, ext, image_bytes = decode_data_url(image["data"])
        asset_id = f"asset_{template_id}_{index + 1}"
        suffix = "" if index == 0 else f"-{index + 1}"
        relative_path = Path("assets") / "uploads" / "official-templates" / f"{template_id}{suffix}.{ext}"
        output_path = ROOT / relative_path
        output_path.write_bytes(image_bytes)
        saved_assets.append({
            "asset_id": asset_id,
            "mime_type": mime_type,
            "relative_path": relative_path.as_posix(),
            "width": image["width"],
            "height": image["height"],
        })
    primary_asset = saved_assets[0]

    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        ensure_admin_schema(connection)
        for asset in saved_assets:
            connection.execute(
                """
                INSERT OR REPLACE INTO assets (
                  asset_id, owner_user_id, asset_type, mime_type, url, width, height
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset["asset_id"],
                    payload.get("authorUserId") or None,
                    "official_template_image",
                    asset["mime_type"],
                    asset["relative_path"],
                    asset["width"] or None,
                    asset["height"] or None,
                ),
            )
        connection.execute(
            """
            INSERT OR REPLACE INTO templates (
              template_id, author_user_id, source_type, template_name, template_title, description,
              template_type, design_type, nail_shape, material_type, shape_categories,
              style_categories, material_categories, topic_tags, tags, event_id,
              template_object_json, cover_asset_id, image_asset_id, image_asset_ids, author_display_name,
              author_level, visibility, status, heat_count, published_at, updated_at
            ) VALUES (?, ?, 'official', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                template_id,
                payload.get("authorUserId") or None,
                template_name,
                payload.get("templateTitle") or template_name,
                payload.get("description") or "",
                payload.get("templateType") or "design",
                payload.get("designType") or "nail",
                payload.get("nailShape") or "",
                payload.get("materialType") or "",
                payload.get("shapeCategories") or payload.get("nailShape") or "",
                payload.get("styleCategories") or "",
                payload.get("materialCategories") or payload.get("materialType") or "",
                payload.get("topicTags") or "",
                payload.get("tags") or "",
                payload.get("eventId") or None,
                payload.get("templateObjectJson") or None,
                primary_asset["asset_id"],
                primary_asset["asset_id"],
                json.dumps([asset["asset_id"] for asset in saved_assets], ensure_ascii=False),
                payload.get("authorDisplayName") or "Nail Art Yihe",
                payload.get("authorLevel") or "Official",
                payload.get("visibility") or "public",
                payload.get("status") or "active",
                int(payload.get("heatCount") or 0),
                payload.get("publishedAt") or time.strftime("%Y-%m-%d"),
            ),
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO gallery_templates (
              gallery_template_id, gallery_type, gallery_id, template_id, sort_order
            ) VALUES (?, 'official', ?, ?, ?)
            """,
            (
                gallery_template_id,
                gallery_id,
                template_id,
                int(payload.get("sortOrder") or 0),
            ),
        )
        connection.commit()
    finally:
        connection.close()

    print(json.dumps({
        "ok": True,
        "templateId": template_id,
        "assetId": primary_asset["asset_id"],
        "assetIds": [asset["asset_id"] for asset in saved_assets],
        "galleryId": gallery_id,
        "imageUrl": primary_asset["relative_path"],
        "imageUrls": [asset["relative_path"] for asset in saved_assets],
    }))


if __name__ == "__main__":
    main()
