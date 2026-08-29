import base64
import hashlib
import json
import sqlite3
import sys

from admin_db import DB_PATH, ensure_admin_schema, repair_mojibake_text
from admin_event_rows import event_rows
from admin_models import product_rows, rows
from admin_record_create import create_event_detail, require_promo_asset, save_task_condition_rewards
from promotion_admin import delete_promotion, update_promotion


def clean_text(value):
    if value is None:
        return ""
    return repair_mojibake_text(str(value).strip())


def clean_int(value, default=0):
    try:
        if value in (None, ""):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def clean_pickup_method(value, default="both"):
    text = clean_text(value).lower()
    if text in {"pickup", "self", "self_pickup", "自取", "自提"}:
        return "pickup"
    if text in {"shipping", "mail", "post", "delivery", "邮寄", "配送"}:
        return "shipping"
    if text in {"both", "all", "自取/邮寄", "自提/邮寄"}:
        return "both"
    return default


def clean_product_type(value, default="穿戴甲"):
    text = clean_text(value)
    key = text.lower().replace(" ", "_").replace("-", "_")
    if key in {"press_on_nail", "press_on", "presson", "wearable_nail"} or text == "穿戴甲":
        return "穿戴甲"
    if key in {"printed_nail", "printing_nail", "printable_nail"} or text == "打印甲":
        return "打印甲"
    if key in {"nail_accessory", "accessory", "accessories"} or text == "配件":
        return "配件"
    return default if not text else text


def validate_bound_device(connection, value):
    device_id = clean_text(value)
    if not device_id:
        return ""
    row = connection.execute(
        """
        SELECT equip_id
        FROM device_info
        WHERE equip_id=?
          AND type IN ('主机', 'main_unit')
          AND COALESCE(status, 'active')='active'
        """,
        (device_id,),
    ).fetchone()
    if not row:
        raise ValueError("设备不存在无法添加")
    return device_id


def image_payload(value):
    text = clean_text(value)
    if not text:
        return None
    mime_type = "image/png"
    encoded = text
    if text.startswith("data:") and "," in text:
        header, encoded = text.split(",", 1)
        if ";" in header:
            mime_type = header[5:].split(";", 1)[0] or mime_type
    raw = base64.b64decode(encoded)
    if not raw:
        return None
    return {
        "mime_type": mime_type,
        "data_url": f"data:{mime_type};base64,{encoded}",
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def resolve_local_image_asset(connection, image_base64, asset_type):
    payload = image_payload(image_base64)
    if not payload:
        return None
    existing = connection.execute(
        "SELECT asset_id, url FROM assets WHERE sha256=? LIMIT 1",
        (payload["sha256"],),
    ).fetchone()
    if existing:
        asset_id, url = existing
    else:
        asset_id = f"asset_{asset_type}_{payload['sha256'][:18]}"
        url = ""
        connection.execute(
            """
            INSERT OR REPLACE INTO assets (asset_id, asset_type, mime_type, url, base64_data, sha256)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (asset_id, asset_type, payload["mime_type"], url, payload["data_url"], payload["sha256"]),
        )
    return {
        "image_url": url or f"/api/admin/product-image?itemKind=asset&id={asset_id}",
        "image_base64": "",
    }


def stock_values(item):
    values = {
        "stock_s": clean_int(item.get("stock_s")),
        "stock_m": clean_int(item.get("stock_m")),
        "stock_l": clean_int(item.get("stock_l")),
        "stock_xl": clean_int(item.get("stock_xl")),
    }
    values["stock_quantity"] = sum(values.values())
    return values


def clean_float(value, default=0):
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def nullable_int(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def update_row(connection, table, id_column, row_id, values):
    allowed = {key: value for key, value in values.items() if value is not None}
    if not allowed:
        return
    assignments = ", ".join(f"{key}=?" for key in allowed)
    connection.execute(f"UPDATE {table} SET {assignments} WHERE {id_column}=?", [*allowed.values(), row_id])


def task_rows(connection):
    data = rows(connection, "SELECT task_id, task_name, task_type, task_title, task_content, submission_type, allowed_platforms, event_id, promo_asset_id, reward_points, expires_at, status FROM tasks ORDER BY created_at DESC")
    rewards = rows(connection, "SELECT task_id, sequence_id, type, quantity, reward_type, reward_quantity FROM task_condition_reward ORDER BY task_id, sequence_id")
    by_task = {}
    for reward in rewards:
        by_task.setdefault(str(reward["task_id"]), []).append({
            "sequence_id": reward["sequence_id"],
            "type": reward["type"],
            "quantity": reward["quantity"],
            "reward_type": reward["reward_type"],
            "reward_quantity": reward["reward_quantity"],
        })
    for item in data:
        item["condition_reward_json"] = json.dumps(by_task.get(str(item["task_id"]), []), ensure_ascii=False)
    return data


def promo_rows(connection):
    return rows(connection, "SELECT promo_asset_id, image_url, created_at FROM promotional_assets ORDER BY promo_asset_id DESC")


def device_info_rows(connection):
    return rows(connection, "SELECT id, equip_id, type, address, status, created_at, updated_at FROM device_info ORDER BY id DESC")


def official_rows(connection):
    return rows(connection, """
        SELECT
          t.template_id, t.template_name, t.design_type, t.nail_shape, t.material_type,
          CASE
            WHEN COALESCE(t.image_asset_ids, '') = '' THEN CASE WHEN t.image_asset_id IS NULL OR t.image_asset_id = '' THEN 0 ELSE 1 END
            ELSE LENGTH(t.image_asset_ids) - LENGTH(REPLACE(t.image_asset_ids, ',', '')) + 1
          END AS image_count,
          t.status,
          COALESCE(NULLIF(a.url, ''), CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN '[base64 image]' ELSE '' END) AS image,
          a.url AS image_url,
          CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN '/api/admin/product-image?itemKind=template&id=' || t.template_id ELSE a.url END AS image_preview_url,
          CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN 1 ELSE 0 END AS has_image_base64,
          '' AS image_base64
        FROM templates t
        LEFT JOIN assets a ON a.asset_id = t.cover_asset_id
        WHERE t.source_type='official'
        ORDER BY t.created_at DESC
    """)


def community_rows(connection):
    return rows(connection, """
        SELECT
          t.template_id, t.template_name, t.template_title, t.author_display_name,
          t.author_user_id, t.author_level, t.template_type, t.design_type, t.nail_shape,
          t.material_type, t.shape_categories, t.style_categories, t.material_categories,
          t.topic_tags, t.tags, t.event_id, t.visibility, t.status,
          t.view_count, t.heat_count, t.like_count, t.favorite_count, t.comment_count,
          t.published_at, t.description, t.template_object_json,
          COALESCE(NULLIF(a.url, ''), CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN '[base64 image]' ELSE '' END) AS image,
          a.url AS image_url,
          CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN '/api/admin/product-image?itemKind=template&id=' || t.template_id ELSE a.url END AS image_preview_url,
          CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN 1 ELSE 0 END AS has_image_base64,
          '' AS image_base64
        FROM templates t
        LEFT JOIN assets a ON a.asset_id = t.cover_asset_id
        WHERE t.source_type='community'
        ORDER BY t.created_at DESC
    """)


def user_rows(connection):
    return rows(connection, "SELECT user_id, username, phone, gender, created_at FROM users ORDER BY created_at DESC")


def update_record(connection, module, row_id, item, item_kind=""):
    if module == "event":
        event_type = clean_text(item.get("event_type"))
        promo_asset_id = require_promo_asset(connection, item.get("promo_asset_id"))
        update_row(connection, "events", "event_id", row_id, {
            "event_name": clean_text(item.get("event_name")),
            "event_type": event_type,
            "event_title": clean_text(item.get("event_title")),
            "event_content": clean_text(item.get("event_content")),
            "promo_asset_id": promo_asset_id,
            "html_url": clean_text(item.get("html_url")),
            "start_at": clean_text(item.get("start_at")),
            "expires_at": clean_text(item.get("expires_at")),
            "status": clean_text(item.get("status")) or "active",
        })
        if event_type:
            for table in ("community_interaction_events", "external_social_events", "design_collection_events", "promotion_discount_events"):
                connection.execute(f"DELETE FROM {table} WHERE event_id=?", (row_id,))
            create_event_detail(connection, row_id, event_type, item)
        return event_rows(connection)
    if module == "task":
        update_row(connection, "tasks", "task_id", row_id, {
            "task_name": clean_text(item.get("task_name")),
            "event_id": nullable_int(item.get("event_id")),
            "task_type": clean_text(item.get("task_type")),
            "submission_type": clean_text(item.get("submission_type")),
            "promo_asset_id": nullable_int(item.get("promo_asset_id")),
            "allowed_platforms": clean_text(item.get("allowed_platforms")),
            "reward_points": clean_int(item.get("reward_points")),
            "expires_at": clean_text(item.get("expires_at")),
            "task_content": clean_text(item.get("task_content")),
            "status": clean_text(item.get("status")) or "active",
        })
        save_task_condition_rewards(connection, row_id, item)
        return task_rows(connection)
    if module == "promo-assets":
        values = {
            "image_url": clean_text(item.get("image_url")),
            "image_base64": clean_text(item.get("image_base64")),
        }
        if not values["image_base64"]:
            values.pop("image_base64")
        update_row(connection, "promotional_assets", "promo_asset_id", row_id, values)
        return promo_rows(connection)
    if module == "promotion":
        return update_promotion(connection, row_id, item)
    if module == "product":
        if item_kind == "reward":
            values = {
                "reward_name": clean_text(item.get("reward_name")),
                "reward_type": clean_text(item.get("reward_type")),
                "unit_point_cost": clean_int(item.get("unit_point_cost")),
                "image_url": clean_text(item.get("image_url")),
                "image_base64": clean_text(item.get("image_base64")),
                "reward_info": clean_text(item.get("reward_info")),
                "bound_device_id": validate_bound_device(connection, item.get("bound_device_id")),
                "pickup_method": clean_pickup_method(item.get("pickup_method"), "pickup"),
                "is_featured": clean_int(item.get("is_featured"), 0),
                "status": clean_text(item.get("status")) or "active",
            }
            values.update(stock_values(item))
            resolved_image = resolve_local_image_asset(connection, values["image_base64"], "reward-products")
            if resolved_image:
                values.update(resolved_image)
            if not values["image_base64"]:
                values.pop("image_base64")
            update_row(connection, "rewards", "reward_id", row_id, values)
        else:
            values = {
                "product_name": clean_text(item.get("product_name")),
                "product_type": clean_product_type(item.get("product_type")),
                "unit_price": clean_float(item.get("unit_price")),
                "nail_shape": clean_text(item.get("nail_shape")),
                "style_tags": clean_text(item.get("style_tags")),
                "image_url": clean_text(item.get("image_url")),
                "image_base64": clean_text(item.get("image_base64")),
                "product_info": clean_text(item.get("product_info")),
                "bound_device_id": validate_bound_device(connection, item.get("bound_device_id")),
                "pickup_method": clean_pickup_method(item.get("pickup_method"), "both"),
                "is_featured": clean_int(item.get("is_featured"), 0),
                "status": clean_text(item.get("status")) or "active",
            }
            values.update(stock_values(item))
            resolved_image = resolve_local_image_asset(connection, values["image_base64"], "products")
            if resolved_image:
                values.update(resolved_image)
            if not values["image_base64"]:
                values.pop("image_base64")
            update_row(connection, "products", "product_id", row_id, values)
        return product_rows(connection)
    if module == "official":
        update_row(connection, "templates", "template_id", row_id, {
            "template_name": clean_text(item.get("template_name")),
            "design_type": clean_text(item.get("design_type")),
            "nail_shape": clean_text(item.get("nail_shape")),
            "material_type": clean_text(item.get("material_type")),
            "status": clean_text(item.get("status")) or "active",
        })
        return official_rows(connection)
    if module == "community":
        values = {
            "template_name": clean_text(item.get("template_name")),
            "template_title": clean_text(item.get("template_title")),
            "author_user_id": clean_text(item.get("author_user_id")) or None,
            "author_display_name": clean_text(item.get("author_display_name")),
            "author_level": clean_text(item.get("author_level")),
            "template_type": clean_text(item.get("template_type")) or "nail",
            "design_type": clean_text(item.get("design_type")),
            "nail_shape": clean_text(item.get("nail_shape")),
            "material_type": clean_text(item.get("material_type")),
            "shape_categories": clean_text(item.get("shape_categories")),
            "style_categories": clean_text(item.get("style_categories")),
            "material_categories": clean_text(item.get("material_categories")),
            "topic_tags": clean_text(item.get("topic_tags")),
            "tags": clean_text(item.get("tags")),
            "event_id": clean_text(item.get("event_id")) or None,
            "visibility": clean_text(item.get("visibility")) or "public",
            "status": clean_text(item.get("status")) or "active",
            "view_count": clean_int(item.get("view_count")),
            "heat_count": clean_int(item.get("heat_count")),
            "like_count": clean_int(item.get("like_count")),
            "favorite_count": clean_int(item.get("favorite_count")),
            "comment_count": clean_int(item.get("comment_count")),
            "published_at": clean_text(item.get("published_at")),
            "description": clean_text(item.get("description")),
            "template_object_json": clean_text(item.get("template_object_json")),
        }
        image_base64 = clean_text(item.get("image_base64"))
        image_url = clean_text(item.get("image_url"))
        if image_base64 or image_url:
            asset_id = f"asset_{row_id}"
            connection.execute(
                """
                INSERT OR REPLACE INTO assets (
                  asset_id, owner_user_id, asset_type, mime_type, url, base64_data
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (asset_id, values["author_user_id"], "community_template_image", "image/png" if image_base64.startswith("data:image/png") else "", image_url, image_base64),
            )
            values["cover_asset_id"] = asset_id
            values["image_asset_id"] = asset_id
        update_row(connection, "templates", "template_id", row_id, values)
        return community_rows(connection)
    if module == "users":
        update_row(connection, "users", "user_id", row_id, {
            "username": clean_text(item.get("username")),
            "phone": clean_text(item.get("phone")),
            "gender": clean_text(item.get("gender")),
        })
        return user_rows(connection)
    if module == "device-info":
        device_type = clean_text(item.get("type")) or "主机"
        if device_type not in {"主机", "打印机"}:
            raise ValueError("Device type must be 主机 or 打印机.")
        update_row(connection, "device_info", "id", row_id, {
            "equip_id": clean_text(item.get("equip_id")),
            "type": device_type,
            "address": clean_text(item.get("address")),
            "status": clean_text(item.get("status")) or "active",
        })
        connection.execute("UPDATE device_info SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (row_id,))
        return device_info_rows(connection)
    raise ValueError(f"Unsupported update module: {module}")


def delete_record(connection, module, row_id, item_kind=""):
    if module == "event":
        connection.execute("DELETE FROM task_submissions WHERE event_id=?", (row_id,))
        connection.execute("DELETE FROM task_drafts WHERE event_id=?", (row_id,))
        connection.execute("DELETE FROM tasks WHERE event_id=?", (row_id,))
        connection.execute("UPDATE templates SET event_id=NULL WHERE event_id=?", (row_id,))
        for table in ("community_interaction_events", "external_social_events", "design_collection_events", "promotion_discount_events"):
            connection.execute(f"DELETE FROM {table} WHERE event_id=?", (row_id,))
        connection.execute("DELETE FROM events WHERE event_id=?", (row_id,))
        return event_rows(connection)
    if module == "task":
        connection.execute("DELETE FROM task_submissions WHERE task_id=?", (row_id,))
        connection.execute("DELETE FROM task_drafts WHERE task_id=?", (row_id,))
        connection.execute("DELETE FROM task_condition_reward WHERE task_id=?", (row_id,))
        connection.execute("DELETE FROM tasks WHERE task_id=?", (row_id,))
        return task_rows(connection)
    if module == "promo-assets":
        connection.execute("UPDATE events SET promo_asset_id=NULL WHERE promo_asset_id=?", (row_id,))
        connection.execute("UPDATE tasks SET promo_asset_id=NULL WHERE promo_asset_id=?", (row_id,))
        connection.execute("DELETE FROM promotional_assets WHERE promo_asset_id=?", (row_id,))
        return promo_rows(connection)
    if module == "promotion":
        return delete_promotion(connection, row_id)
    if module == "product":
        if item_kind == "reward":
            connection.execute("DELETE FROM rewards WHERE reward_id=?", (row_id,))
        else:
            connection.execute("DELETE FROM products WHERE product_id=?", (row_id,))
        return product_rows(connection)
    if module == "device-info":
        connection.execute("DELETE FROM device_info WHERE id=?", (row_id,))
        return device_info_rows(connection)
    if module in {"official", "community"}:
        connection.execute("DELETE FROM gallery_templates WHERE template_id=?", (row_id,))
        connection.execute("DELETE FROM comments WHERE target_type='template' AND target_id=?", (row_id,))
        connection.execute("DELETE FROM user_actions WHERE target_type='template' AND target_id=?", (row_id,))
        connection.execute("DELETE FROM templates WHERE template_id=?", (row_id,))
        return official_rows(connection) if module == "official" else community_rows(connection)
    if module == "users":
        member = connection.execute("SELECT member_id FROM members WHERE user_id=?", (row_id,)).fetchone()
        member_id = member[0] if member else None
        if member_id:
            connection.execute("DELETE FROM reward_orders WHERE member_id=?", (member_id,))
            connection.execute("DELETE FROM point_transactions WHERE member_id=?", (member_id,))
            connection.execute("DELETE FROM member_awards WHERE member_id=?", (member_id,))
            connection.execute("DELETE FROM member_achievements WHERE member_id=?", (member_id,))
            connection.execute("DELETE FROM members WHERE member_id=?", (member_id,))
        order_ids = [row[0] for row in connection.execute("SELECT order_id FROM orders WHERE user_id=?", (row_id,)).fetchall()]
        for order_id in order_ids:
            connection.execute("DELETE FROM order_items WHERE order_id=?", (order_id,))
        connection.execute("DELETE FROM orders WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM addresses WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM third_party_accounts WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM cart_items WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM task_submissions WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM task_drafts WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM draft_cache WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM gallery_templates WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM personal_galleries WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM comments WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM user_actions WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM articles WHERE author_user_id=?", (row_id,))
        connection.execute("UPDATE templates SET author_user_id=NULL WHERE author_user_id=?", (row_id,))
        connection.execute("UPDATE ai_jobs SET user_id=NULL WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM print_jobs WHERE user_id=?", (row_id,))
        connection.execute("DELETE FROM users WHERE user_id=?", (row_id,))
        return user_rows(connection)
    raise ValueError(f"Unsupported delete module: {module}")


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    action = payload.get("action") or "update"
    module = clean_text(payload.get("module"))
    row_id = payload.get("id")
    item_kind = clean_text(payload.get("itemKind"))
    item = payload.get("item") or {}
    if row_id in (None, ""):
        raise ValueError("id is required")

    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_admin_schema(connection)
        if action == "delete":
            updated_rows = delete_record(connection, module, row_id, item_kind)
        else:
            updated_rows = update_record(connection, module, row_id, item, item_kind)
        connection.commit()
        print(json.dumps({"ok": True, "module": module, "id": row_id, "rows": updated_rows}, ensure_ascii=False))
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
