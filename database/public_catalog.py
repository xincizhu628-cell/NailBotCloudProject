import json
import sqlite3
import sys
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "nail_studio.db"


def rows(connection, query, params=()):
    cursor = connection.execute(query, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def split_values(value):
    return [item.strip() for item in str(value or "").replace("|", ",").split(",") if item.strip()]


def parse_json_list(value):
    text = str(value or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return split_values(text)
    if isinstance(data, list):
        return [str(item).strip() for item in data if str(item).strip()]
    return []


def asset_source(asset):
    if not asset:
        return ""
    if asset.get("url"):
        return asset["url"]
    if asset.get("base64_data") or asset.get("has_base64"):
        asset_id = asset.get("asset_id")
        if asset_id:
            return f"/api/admin/product-image?itemKind=asset&id={asset_id}"
        return ""
    return ""


def asset_map(connection):
    try:
        assets = rows(
            connection,
            """
            SELECT
              asset_id,
              url,
              CASE WHEN base64_data IS NOT NULL AND base64_data != '' THEN 1 ELSE 0 END AS has_base64,
              mime_type
            FROM assets
            """,
        )
    except sqlite3.OperationalError:
        return {}
    return {item["asset_id"]: item for item in assets}


def taxonomy_map(connection, target_type):
    try:
        links = rows(
            connection,
            """
            SELECT taxonomy_type, taxonomy_id, target_id
            FROM taxonomy_links
            WHERE target_type=?
            """,
            [target_type],
        )
    except sqlite3.OperationalError:
        return {}
    result = {}
    for link in links:
        item = result.setdefault(link["target_id"], [])
        item.append(f'{link["taxonomy_type"]}:{link["taxonomy_id"]}')
        item.append(str(link["taxonomy_id"]))
    return result


def load_templates(connection):
    assets = asset_map(connection)
    template_links = taxonomy_map(connection, "template")
    try:
        gallery_links = rows(
            connection,
            "SELECT gallery_type, gallery_id, template_id FROM gallery_templates",
        )
    except sqlite3.OperationalError:
        gallery_links = []
    gallery_map = {}
    for link in gallery_links:
        bucket = gallery_map.setdefault(link["template_id"], [])
        bucket.extend([str(link["gallery_id"]), f'{link["gallery_type"]}:{link["gallery_id"]}'])
    try:
        items = rows(
            connection,
            """
            SELECT
              t.template_id,
              t.source_type,
              t.template_name,
              t.template_title,
              t.description,
              t.design_type,
              t.nail_shape,
              t.material_type,
              t.shape_categories,
              t.style_categories,
              t.material_categories,
              t.topic_tags,
              t.tags,
              t.author_user_id,
              t.author_display_name,
              t.author_level,
              t.view_count,
              t.heat_count,
              t.like_count,
              t.favorite_count,
              t.comment_count,
              t.published_at,
              t.image_asset_ids,
              COALESCE(a.asset_id, '') AS image_asset_id,
              COALESCE(a.url, '') AS image_url,
              CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN 1 ELSE 0 END AS image_has_base64
            FROM templates t
            LEFT JOIN assets a ON a.asset_id = COALESCE(t.cover_asset_id, t.image_asset_id)
            WHERE t.status='active' AND t.visibility='public' AND t.source_type IN ('official', 'community')
            ORDER BY COALESCE(t.published_at, t.created_at) DESC
            """
        )
    except sqlite3.OperationalError:
        return []
    output = []
    for item in items:
        image_list = []
        for asset_id in parse_json_list(item.get("image_asset_ids")):
            source = asset_source(assets.get(asset_id))
            if source:
                image_list.append(source)
        if not image_list:
            fallback = item.get("image_url", "")
            if not fallback and item.get("image_has_base64"):
                fallback = f'/api/admin/product-image?itemKind=template&id={item["template_id"]}'
            if fallback:
                image_list.append(fallback)
        if not item.get("image_url") and image_list:
            item["image_url"] = image_list[0]
        item["image_base64"] = ""
        category_ids = []
        category_ids.extend(template_links.get(item["template_id"], []))
        category_ids.extend(gallery_map.get(item["template_id"], []))
        category_ids.extend(split_values(item["shape_categories"]))
        category_ids.extend(split_values(item["style_categories"]))
        category_ids.extend(split_values(item["material_categories"]))
        category_ids.extend(split_values(item["topic_tags"]))
        category_ids.extend(split_values(item["tags"]))
        if item["nail_shape"]:
            category_ids.extend([item["nail_shape"], f'shapes:{item["nail_shape"]}'])
        if item["material_type"]:
            category_ids.extend([item["material_type"], f'materials:{item["material_type"]}'])
        if item["design_type"]:
            category_ids.append(f'type-{item["design_type"]}')
        output.append({**item, "image_list": image_list, "category_ids": sorted(set(category_ids))})
    return output


def load_material_bases(connection):
    assets = asset_map(connection)
    try:
        items = rows(
            connection,
            """
            SELECT
              t.template_id,
              t.source_type,
              t.template_name,
              t.template_title,
              t.nail_shape,
              t.material_type,
              t.shape_categories,
              t.material_categories,
              t.image_asset_ids,
              COALESCE(a.asset_id, '') AS image_asset_id,
              COALESCE(a.url, '') AS image_url,
              CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN 1 ELSE 0 END AS image_has_base64
            FROM templates t
            LEFT JOIN assets a ON a.asset_id = COALESCE(t.cover_asset_id, t.image_asset_id)
            WHERE t.source_type='official'
              AND (t.template_id LIKE 'official_%_printing-nail-%' OR t.material_type LIKE 'm%')
            ORDER BY COALESCE(t.updated_at, t.created_at) DESC
            """
        )
    except sqlite3.OperationalError:
        return []

    output = []
    for item in items:
        image_list = []
        for asset_id in parse_json_list(item.get("image_asset_ids")):
            source = asset_source(assets.get(asset_id))
            if source:
                image_list.append(source)
        if not image_list:
            fallback = item.get("image_url", "")
            if not fallback and item.get("image_has_base64"):
                fallback = f'/api/admin/product-image?itemKind=template&id={item["template_id"]}'
            if fallback:
                image_list.append(fallback)
        if not image_list:
            continue
        item["image_base64"] = ""
        if not item.get("image_url"):
            item["image_url"] = image_list[0]
        output.append({
            **item,
            "image_list": image_list,
        })
    return output


def load_products(connection):
    product_links = taxonomy_map(connection, "product")
    try:
        items = rows(
            connection,
            """
            SELECT
              p.product_id,
              p.product_type,
              p.product_name,
              p.unit_price,
              p.product_info,
              p.style_tags,
              p.nail_shape,
              p.stock_quantity,
              p.stock_s,
              p.stock_m,
              p.stock_l,
              p.stock_xl,
              p.pickup_method,
              p.is_featured,
              p.status,
              COALESCE(NULLIF(p.image_url, ''), a.url, '') AS image_url,
              CASE
                WHEN p.image_base64 IS NOT NULL AND p.image_base64 != '' THEN 1
                WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN 1
                ELSE 0
              END AS image_has_base64
            FROM products p
            LEFT JOIN assets a ON a.asset_id = p.cover_asset_id
            WHERE p.status='active'
            ORDER BY p.created_at DESC
            """
        )
    except sqlite3.OperationalError:
        return []
    output = []
    for item in items:
        if not item.get("image_url") and item.get("image_has_base64"):
            item["image_url"] = f'/api/admin/product-image?itemKind=product&id={item["product_id"]}'
        item["image_base64"] = ""
        category_ids = []
        category_ids.extend(product_links.get(item["product_id"], []))
        category_ids.extend(split_values(item["style_tags"]))
        if item["nail_shape"]:
            category_ids.extend([item["nail_shape"], f'shapes:{item["nail_shape"]}'])
        if item["product_type"]:
            category_ids.append(f'product-type:{item["product_type"]}')
        pickup_method = str(item.get("pickup_method") or "both").strip().lower()
        if pickup_method not in {"pickup", "shipping", "both"}:
            pickup_method = "both"
        item["delivery_mode"] = pickup_method
        item["supports_pickup"] = pickup_method in {"pickup", "both"}
        item["supports_shipping"] = pickup_method in {"shipping", "both"}
        output.append({**item, "category_ids": sorted(set(category_ids))})
    return output


def load_events(connection):
    assets = asset_map(connection)
    try:
        items = rows(
            connection,
            """
            SELECT
              e.event_id,
              e.event_type,
              e.event_name,
              e.event_title,
              e.event_content,
              e.html_url,
              e.start_at,
              e.expires_at,
              e.sort_order,
              e.status,
              e.banner_asset_id,
              e.promo_asset_id,
              COALESCE(pa.image_url, '') AS promo_image_url,
              CASE WHEN pa.image_base64 IS NOT NULL AND pa.image_base64 != '' THEN 1 ELSE 0 END AS promo_image_has_base64
            FROM events e
            LEFT JOIN promotional_assets pa ON pa.promo_asset_id = e.promo_asset_id
            WHERE e.status='active'
            ORDER BY e.sort_order ASC, e.created_at DESC
            """
        )
    except sqlite3.OperationalError:
        return []
    output = []
    for item in items:
        banner = asset_source(assets.get(item.get("banner_asset_id")))
        promo = item.get("promo_image_url", "")
        if not promo and item.get("promo_image_has_base64") and item.get("promo_asset_id"):
            promo = f'/api/admin/product-image?itemKind=promo&id={item["promo_asset_id"]}'
        item["promo_image_base64"] = ""
        output.append({
            **item,
            "image": banner or promo,
        })
    return output


def load_articles(connection):
    article_links = taxonomy_map(connection, "article")
    try:
        items = rows(
            connection,
            """
            SELECT
              ar.article_id,
              ar.article_type,
              ar.title,
              ar.content,
              ar.related_topics,
              ar.heat_count,
              ar.created_at,
              u.display_name AS author_name
            FROM articles ar
            LEFT JOIN users u ON u.user_id = ar.author_user_id
            WHERE ar.status='published'
            ORDER BY ar.created_at DESC
            """
        )
    except sqlite3.OperationalError:
        return []
    output = []
    for item in items:
        category_ids = []
        category_ids.extend(article_links.get(item["article_id"], []))
        category_ids.extend(split_values(item["related_topics"]))
        if item["article_type"]:
            category_ids.append(f'article-type:{item["article_type"]}')
        output.append({**item, "category_ids": sorted(set(category_ids))})
    return output


def load_taxonomy(connection):
    def safe(query):
        try:
            return rows(connection, query)
        except sqlite3.OperationalError:
            return []

    return {
        "styles": safe("SELECT style_id AS id, style AS name, status FROM styles WHERE status='on' ORDER BY created_at ASC"),
        "shapes": safe("SELECT shape_id AS id, shape AS name, status FROM shapes WHERE status='on' ORDER BY created_at ASC"),
        "materials": safe("SELECT material_id AS id, material AS name, image, status FROM materials WHERE status='on' ORDER BY created_at ASC"),
        "topics": safe("SELECT topic_id AS id, topic AS name, status FROM topics WHERE status='on' ORDER BY created_at ASC"),
        "official_galleries": safe("SELECT official_gallery_id AS id, gallery_name AS name, status FROM official_galleries WHERE status='active' ORDER BY sort_order ASC, created_at DESC"),
        "community_galleries": safe("SELECT community_gallery_id AS id, gallery_name AS name, 'active' AS status FROM community_galleries ORDER BY created_at DESC"),
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    connection = sqlite3.connect(DB_PATH)
    try:
        print(json.dumps({
            "ok": True,
            "data": {
                "taxonomy": load_taxonomy(connection),
                "templates": load_templates(connection),
                "material_bases": load_material_bases(connection),
                "products": load_products(connection),
                "events": load_events(connection),
                "community": load_articles(connection),
            },
        }, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
