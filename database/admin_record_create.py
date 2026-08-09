import json
import re
import sqlite3
import sys
import time
import json
from pathlib import Path

from admin_db import DB_PATH, ensure_admin_schema, repair_mojibake_text
from admin_event_rows import event_rows
from promotion_admin import create_promotion
from promotion_pricing import normalize_rule


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


def clean_json_text(value):
    text = clean_text(value)
    if not text:
        return ""
    try:
        json.loads(text)
        return text
    except Exception:
        raise ValueError("Template object JSON must be valid JSON.")


def nullable_int(value):
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def require_promo_asset(connection, value):
    promo_asset_id = nullable_int(value)
    if promo_asset_id is None:
        return None
    row = connection.execute(
        "SELECT promo_asset_id FROM promotional_assets WHERE promo_asset_id=?",
        (promo_asset_id,),
    ).fetchone()
    if not row:
        raise ValueError(f"Promotional asset #{promo_asset_id} does not exist.")
    return promo_asset_id


def clean_float(value, default=0):
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def nullable_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_bool_int(value):
    return 1 if str(value).strip().lower() in {"1", "true", "yes", "on"} else 0


def comma_list(value):
    return [part.strip() for part in clean_text(value).replace("\n", ",").split(",") if part.strip()]
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def make_id(prefix, label):
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", clean_text(label).lower()).strip("-")
    slug = slug[:32] or "item"
    return f"{prefix}-{slug}-{int(time.time() * 1000)}"


def rows(connection, query, params=()):
    cursor = connection.execute(query, params)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def task_rows(connection):
    data = rows(
        connection,
        """
        SELECT task_id, task_name, task_type, task_title, task_content, submission_type,
               allowed_platforms, event_id, promo_asset_id, reward_points, expires_at, status
        FROM tasks
        ORDER BY created_at DESC
        """,
    )
    rewards = rows(
        connection,
        """
        SELECT task_id, sequence_id, type, quantity, reward_type, reward_quantity
        FROM task_condition_reward
        ORDER BY task_id, sequence_id
        """,
    )
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


def parse_condition_reward(value):
    if isinstance(value, list):
        raw_items = value
    else:
        text = clean_text(value)
        raw_items = json.loads(text or "[]")
    if not isinstance(raw_items, list):
        raise ValueError("condition_reward must be a list.")
    allowed_types = {"like", "comment", "share", "post"}
    allowed_rewards = {"point", "coupon", "limited_template"}
    parsed = []
    for index, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            continue
        condition_type = clean_text(item.get("type"))
        reward_type = clean_text(item.get("reward_type"))
        if not condition_type and not reward_type:
            continue
        if condition_type not in allowed_types:
            raise ValueError("Condition type must be like, comment, share, or post.")
        if reward_type not in allowed_rewards:
            raise ValueError("Reward type must be point, coupon, or limited_template.")
        if item.get("quantity") in (None, "") and reward_type != "limited_template" and item.get("reward_quantity") in (None, ""):
            continue
        quantity = clean_int(item.get("quantity"), 0)
        reward_quantity = 1 if reward_type == "limited_template" else clean_int(item.get("reward_quantity"), 0)
        if quantity <= 0:
            raise ValueError("Condition quantity must be greater than 0.")
        if reward_quantity <= 0:
            raise ValueError("Reward quantity must be greater than 0.")
        parsed.append({
            "sequence_id": index,
            "type": condition_type,
            "quantity": quantity,
            "reward_type": reward_type,
            "reward_quantity": reward_quantity,
        })
    return parsed


def save_task_condition_rewards(connection, task_id, item):
    connection.execute("DELETE FROM task_condition_reward WHERE task_id=?", (task_id,))
    if clean_text(item.get("task_type")) != "community_action":
        return []
    rewards = parse_condition_reward(item.get("condition_reward_json") or item.get("condition_reward") or "[]")
    for reward in rewards:
        connection.execute(
            """
            INSERT INTO task_condition_reward (
              task_id, sequence_id, type, quantity, reward_type, reward_quantity
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                reward["sequence_id"],
                reward["type"],
                reward["quantity"],
                reward["reward_type"],
                reward["reward_quantity"],
            ),
        )
    return rewards


def create_event(connection, item):
    event_name = clean_text(item.get("event_name"))
    if not event_name:
        raise ValueError("Event name is required.")
    event_type = clean_text(item.get("event_type"))
    if not event_type:
        raise ValueError("Event type is required.")
    promo_asset_id = require_promo_asset(connection, item.get("promo_asset_id"))
    connection.execute(
        """
        INSERT INTO events (
          event_type, event_name, event_title, event_content, promo_asset_id,
          html_url, start_at, expires_at, status, sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_type,
            event_name,
            clean_text(item.get("event_title")) or event_name,
            clean_text(item.get("event_content")),
            promo_asset_id,
            clean_text(item.get("html_url")),
            clean_text(item.get("start_at")),
            clean_text(item.get("expires_at")),
            clean_text(item.get("status")) or "active",
            clean_int(item.get("sort_order"), 0),
        ),
    )
    event_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
    create_event_detail(connection, event_id, event_type, item)
    return event_id, event_rows(connection)


def create_event_detail(connection, event_id, event_type, item):
    if event_type == "community_interaction":
        connection.execute(
            """
            INSERT OR REPLACE INTO community_interaction_events (
              event_id, community_action_type, target_area, min_actions, reward_points, rules_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                clean_text(item.get("community_action_type")) or "mixed",
                clean_text(item.get("target_area")),
                clean_int(item.get("min_actions"), 0),
                clean_int(item.get("community_reward_points"), 0),
                clean_json_text(item.get("community_rules_json")) or None,
            ),
        )
        return
    if event_type == "external_social":
        connection.execute(
            """
            INSERT OR REPLACE INTO external_social_events (
              event_id, platforms, post_requirements, hashtags, reward_points, tracking_rule
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                json.dumps(comma_list(item.get("platforms")), ensure_ascii=False),
                clean_text(item.get("post_requirements")),
                json.dumps(comma_list(item.get("hashtags")), ensure_ascii=False),
                clean_int(item.get("social_reward_points"), 0),
                clean_text(item.get("tracking_rule")),
            ),
        )
        return
    if event_type == "design_collection":
        connection.execute(
            """
            INSERT OR REPLACE INTO design_collection_events (
              event_id, design_brief, required_shape, required_style, submission_limit, reward_points, judge_rule
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                clean_text(item.get("design_brief")),
                clean_text(item.get("required_shape")),
                clean_text(item.get("required_style")),
                clean_int(item.get("submission_limit"), 1),
                clean_int(item.get("design_reward_points"), 0),
                clean_text(item.get("judge_rule")),
            ),
        )
        return
    if event_type == "promotion_discount":
        target_ids = comma_list(item.get("target_product_ids"))
        discount_type = clean_text(item.get("discount_type")) or "percent_off"
        if discount_type == "threshold_amount_off":
            discount_value = clean_float(item.get("amount_off"), 0)
            discount_threshold = clean_float(item.get("threshold_spend"), 0)
        elif discount_type == "fixed_price":
            discount_value = clean_float(item.get("fixed_price_value"), 0)
            discount_threshold = clean_float(item.get("min_spend"), 0)
        else:
            discount_type = "percent_off"
            discount_value = clean_float(item.get("percent_value"), 0)
            discount_threshold = clean_float(item.get("min_spend"), 0)
        activation_min_spend = clean_float(item.get("min_spend"), 0)
        effective_min_spend = max(activation_min_spend, discount_threshold)
        rule = {
            "discount_type": discount_type,
            "discount_value": discount_value,
            "min_spend": effective_min_spend,
            "activation_min_spend": activation_min_spend,
            "threshold_spend": clean_float(item.get("threshold_spend"), 0),
            "amount_off": clean_float(item.get("amount_off"), 0),
            "percent_value": clean_float(item.get("percent_value"), 0),
            "fixed_price_value": clean_float(item.get("fixed_price_value"), 0),
            "max_discount": None,
            "target_product_ids": target_ids,
        }
        extra_rule_text = clean_text(item.get("price_rule_json"))
        if extra_rule_text:
            extra_rule = json.loads(extra_rule_text)
            if isinstance(extra_rule, dict):
                rule.update(extra_rule)
        normalize_rule(rule)
        connection.execute(
            """
            INSERT OR REPLACE INTO promotion_discount_events (
              event_id, promo_scope, target_product_ids, discount_type, discount_value,
              min_spend, max_discount, stackable, price_rule_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                clean_text(item.get("promo_scope")) or "all_products",
                json.dumps(target_ids, ensure_ascii=False),
                rule["discount_type"],
                clean_float(rule.get("discount_value"), 0),
                clean_float(rule.get("min_spend"), 0),
                None,
                clean_bool_int(item.get("stackable")),
                json.dumps(rule, ensure_ascii=False),
            ),
        )
        return
    raise ValueError(f"Unsupported event_type: {event_type}")


def create_task(connection, item):
    task_name = clean_text(item.get("task_name"))
    if not task_name:
        raise ValueError("Task name is required.")
    connection.execute(
        """
        INSERT INTO tasks (
          event_id, task_type, task_name, task_title, task_content, promo_asset_id,
          submission_type, allowed_platforms, reward_points, start_at, expires_at, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            nullable_int(item.get("event_id")),
            clean_text(item.get("task_type")) or "design_upload",
            task_name,
            clean_text(item.get("task_title")) or task_name,
            clean_text(item.get("task_content")),
            nullable_int(item.get("promo_asset_id")),
            clean_text(item.get("submission_type")) or "text",
            clean_text(item.get("allowed_platforms")),
            clean_int(item.get("reward_points"), 0),
            clean_text(item.get("start_at")),
            clean_text(item.get("expires_at")),
            clean_text(item.get("status")) or "active",
        ),
    )
    task_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
    save_task_condition_rewards(connection, task_id, item)
    return task_id, task_rows(connection)


def create_promo_asset(connection, item):
    image_url = clean_text(item.get("image_url"))
    image_base64 = clean_text(item.get("image_base64"))
    if not image_url and not image_base64:
        raise ValueError("Image URL or base64 data is required.")
    connection.execute(
        "INSERT INTO promotional_assets (image_url, image_base64) VALUES (?, ?)",
        (image_url, image_base64),
    )
    promo_asset_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
    return promo_asset_id, rows(
        connection,
        "SELECT promo_asset_id, image_url, created_at FROM promotional_assets ORDER BY promo_asset_id DESC",
    )


def device_info_rows(connection):
    return rows(connection, "SELECT id, equip_id, type, address, status, created_at, updated_at FROM device_info ORDER BY id DESC")


def create_device_info(connection, item):
    equip_id = clean_text(item.get("equip_id"))
    if not equip_id:
        raise ValueError("Equip ID is required.")
    device_type = clean_text(item.get("type")) or "主机"
    if device_type not in {"主机", "打印机"}:
        raise ValueError("Device type must be 主机 or 打印机.")
    connection.execute(
        """
        INSERT INTO device_info (equip_id, type, address, status)
        VALUES (?, ?, ?, ?)
        """,
        (
            equip_id,
            device_type,
            clean_text(item.get("address")),
            clean_text(item.get("status")) or "active",
        ),
    )
    row_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
    return row_id, device_info_rows(connection)


def community_rows(connection):
    return rows(
        connection,
        """
        SELECT
          t.template_id, t.template_name, t.template_title, t.author_display_name,
          t.author_user_id, t.author_level, t.template_type, t.design_type, t.nail_shape,
          t.material_type, t.shape_categories, t.style_categories, t.material_categories,
          t.topic_tags, t.tags, t.event_id, t.visibility, t.status,
          t.view_count, t.heat_count, t.like_count, t.favorite_count, t.comment_count,
          t.published_at, t.description, t.template_object_json,
          COALESCE(NULLIF(a.url, ''), CASE WHEN a.base64_data IS NOT NULL AND a.base64_data != '' THEN '[base64 image]' ELSE '' END) AS image,
          a.url AS image_url,
          a.base64_data AS image_base64
        FROM templates t
        LEFT JOIN assets a ON a.asset_id = t.cover_asset_id
        WHERE t.source_type='community'
        ORDER BY t.created_at DESC
        """,
    )


def create_community_template(connection, item):
    template_name = clean_text(item.get("template_name"))
    if not template_name:
        raise ValueError("Template name is required.")
    now = int(time.time() * 1000)
    template_id = clean_text(item.get("template_id")) or make_id("community-template", template_name)
    author_user_id = clean_text(item.get("author_user_id")) or None
    image_base64 = clean_text(item.get("image_base64"))
    image_url = clean_text(item.get("image_url"))
    cover_asset_id = clean_text(item.get("cover_asset_id")) or None
    if image_base64 or image_url:
        cover_asset_id = cover_asset_id or f"asset_{template_id}_{now}"
        connection.execute(
            """
            INSERT OR REPLACE INTO assets (
              asset_id, owner_user_id, asset_type, mime_type, url, base64_data
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                cover_asset_id,
                author_user_id,
                "community_template_image",
                "image/png" if image_base64.startswith("data:image/png") else "",
                image_url,
                image_base64,
            ),
        )
    image_asset_id = clean_text(item.get("image_asset_id")) or cover_asset_id
    connection.execute(
        """
        INSERT OR REPLACE INTO templates (
          template_id, author_user_id, source_type, template_name, template_title, description,
          template_type, design_type, nail_shape, material_type, shape_categories,
          style_categories, material_categories, topic_tags, tags, event_id,
          template_object_json, cover_asset_id, image_asset_id, author_display_name,
          author_level, visibility, status, view_count, heat_count, like_count,
          favorite_count, comment_count, published_at, updated_at
        ) VALUES (?, ?, 'community', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            template_id,
            author_user_id,
            template_name,
            clean_text(item.get("template_title")) or template_name,
            clean_text(item.get("description")),
            clean_text(item.get("template_type")) or "nail",
            clean_text(item.get("design_type")) or "nail",
            clean_text(item.get("nail_shape")),
            clean_text(item.get("material_type")),
            clean_text(item.get("shape_categories")),
            clean_text(item.get("style_categories")),
            clean_text(item.get("material_categories")),
            clean_text(item.get("topic_tags")),
            clean_text(item.get("tags")),
            clean_text(item.get("event_id")) or None,
            clean_json_text(item.get("template_object_json")) or None,
            cover_asset_id,
            image_asset_id,
            clean_text(item.get("author_display_name")) or "Community Creator",
            clean_text(item.get("author_level")),
            clean_text(item.get("visibility")) or "public",
            clean_text(item.get("status")) or "active",
            clean_int(item.get("view_count")),
            clean_int(item.get("heat_count")),
            clean_int(item.get("like_count")),
            clean_int(item.get("favorite_count")),
            clean_int(item.get("comment_count")),
            clean_text(item.get("published_at")) or time.strftime("%Y-%m-%d"),
        ),
    )
    return template_id, community_rows(connection)


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    module = clean_text(payload.get("module"))
    item = payload.get("item") or {}
    if not isinstance(item, dict):
        raise ValueError("item must be an object.")

    handlers = {
        "event": create_event,
        "task": create_task,
        "promo-assets": create_promo_asset,
        "promotion": create_promotion,
        "community": create_community_template,
        "device-info": create_device_info,
    }
    if module not in handlers:
        raise ValueError(f"Unsupported create module: {module}")

    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_admin_schema(connection)
        record_id, updated_rows = handlers[module](connection, item)
        connection.commit()
        print(json.dumps({"ok": True, "module": module, "id": record_id, "rows": updated_rows}, ensure_ascii=False))
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
        sys.exit(1)
