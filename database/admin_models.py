import json
import sqlite3
import sys

from admin_event_rows import event_rows
from promotion_admin import promotion_rows

from admin_db import DB_PATH, ensure_admin_schema

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def rows(connection, query, params=()):
    cursor = connection.execute(query, params)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def options(connection, query, fallback):
    values = [row[0] for row in connection.execute(query).fetchall() if row[0]]
    merged = []
    for value in [*fallback, *values]:
        if value not in merged:
            merged.append(value)
    return [{"value": value, "label": value} for value in merged]


def product_rows(connection):
    return rows(
        connection,
        """
        SELECT 'product' AS item_kind, product_id AS id, product_name AS name, product_type AS type,
               COALESCE(NULLIF(image_url, ''), CASE WHEN image_base64 IS NOT NULL AND image_base64 != '' THEN '[base64 image]' ELSE '' END) AS image,
               image_url,
               CASE WHEN image_base64 IS NOT NULL AND image_base64 != '' THEN '/api/admin/product-image?itemKind=product&id=' || product_id ELSE image_url END AS image_preview_url,
               CASE WHEN image_base64 IS NOT NULL AND image_base64 != '' THEN 1 ELSE 0 END AS has_image_base64,
               '' AS image_base64,
               product_info AS info, nail_shape, style_tags, unit_price AS price_or_points,
               stock_quantity, stock_s, stock_m, stock_l, stock_xl,
               'S:' || COALESCE(stock_s, 0) || ' / M:' || COALESCE(stock_m, 0) || ' / L:' || COALESCE(stock_l, 0) || ' / XL:' || COALESCE(stock_xl, 0) AS stock_by_size,
               pickup_method,
               is_featured,
               status
        FROM products
        UNION ALL
        SELECT 'reward' AS item_kind, reward_id AS id, reward_name AS name, reward_type AS type,
               COALESCE(NULLIF(image_url, ''), CASE WHEN image_base64 IS NOT NULL AND image_base64 != '' THEN '[base64 image]' ELSE '' END) AS image,
               image_url,
               CASE WHEN image_base64 IS NOT NULL AND image_base64 != '' THEN '/api/admin/product-image?itemKind=reward&id=' || reward_id ELSE image_url END AS image_preview_url,
               CASE WHEN image_base64 IS NOT NULL AND image_base64 != '' THEN 1 ELSE 0 END AS has_image_base64,
               '' AS image_base64,
               reward_info AS info, '' AS nail_shape, '' AS style_tags, unit_point_cost AS price_or_points,
               stock_quantity, stock_s, stock_m, stock_l, stock_xl,
               'S:' || COALESCE(stock_s, 0) || ' / M:' || COALESCE(stock_m, 0) || ' / L:' || COALESCE(stock_l, 0) || ' / XL:' || COALESCE(stock_xl, 0) AS stock_by_size,
               pickup_method,
               is_featured,
               status
        FROM rewards
        """,
    )


def order_rows(connection):
    return rows(
        connection,
        """
        SELECT
          o.order_id, o.user_id, u.username,
          COUNT(oi.order_item_id) AS item_count,
          o.total_price, o.pay_method, o.payment_status,
          o.delivery_status, o.order_status, o.created_at, o.paid_at
        FROM orders o
        LEFT JOIN users u ON u.user_id = o.user_id
        LEFT JOIN order_items oi ON oi.order_id = o.order_id
        GROUP BY o.order_id
        ORDER BY o.created_at DESC
        """,
    )


def reward_order_rows(connection):
    return rows(
        connection,
        """
        SELECT
          ro.reward_order_id, ro.member_id, u.user_id, u.username,
          ro.reward_id, r.reward_name, ro.quantity, ro.point_cost,
          ro.status, ro.created_at
        FROM reward_orders ro
        LEFT JOIN members m ON m.member_id = ro.member_id
        LEFT JOIN users u ON u.user_id = m.user_id
        LEFT JOIN rewards r ON r.reward_id = ro.reward_id
        ORDER BY ro.created_at DESC
        """,
    )


def user_action_rows(connection):
    return rows(
        connection,
        """
        SELECT
          ua.action_id, ua.user_id, u.username,
          ua.target_type, ua.target_id, ua.action_type, ua.created_at
        FROM user_actions ua
        LEFT JOIN users u ON u.user_id = ua.user_id
        ORDER BY ua.created_at DESC
        """,
    )


def task_record_rows(connection):
    return rows(
        connection,
        """
        SELECT
          tr.task_record_id, tr.task_id, t.task_name, tr.tasktype,
          tr.user_id, u.username, tr.content_upload, tr.upload_at,
          tr.rating_result, tr.status, tr.current_reward
        FROM task_records tr
        LEFT JOIN tasks t ON t.task_id = tr.task_id
        LEFT JOIN users u ON u.user_id = tr.user_id
        ORDER BY tr.upload_at DESC
        """,
    )


def event_participation_rows(connection):
    return rows(
        connection,
        """
        SELECT
          ep.event_participation_id, ep.event_id, ep.event_name,
          ep.created_at, ep.user_id, u.username,
          ep.current_total_earnpoint,
          ep.current_earned_coupon_number,
          ep.current_total_earned_template_number
        FROM event_participation ep
        LEFT JOIN users u ON u.user_id = ep.user_id
        ORDER BY ep.created_at DESC
        """,
    )


def user_comment_rows(connection):
    return rows(
        connection,
        """
        SELECT
          uc.comment_id, uc.post_id, uc.comment_type,
          uc.user_id, u.username, uc.commented_at,
          uc.comment_content, uc.status
        FROM user_comments uc
        LEFT JOIN users u ON u.user_id = uc.user_id
        ORDER BY uc.commented_at DESC
        """,
    )


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


def print_job_rows(connection):
    return rows(
        connection,
        """
        SELECT
          pj.print_job_id, pj.user_id, u.username, pj.template_id, pj.draft_id,
          pj.coupon_id, pj.device_id, d.device_name, pj.status,
          pj.error_message, pj.created_at, pj.sent_at, pj.completed_at
        FROM print_jobs pj
        LEFT JOIN users u ON u.user_id = pj.user_id
        LEFT JOIN devices d ON d.device_id = pj.device_id
        ORDER BY pj.created_at DESC
        """,
    )


def main():
    json.loads(sys.stdin.read() or "{}")
    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_admin_schema(connection)
        status_options = [
            {"value": "active", "label": "active"},
            {"value": "draft", "label": "draft"},
            {"value": "hidden", "label": "hidden"},
        ]
        event_options = [
            {"value": row["event_id"], "label": f"#{row['event_id']} {row['event_name']}"}
            for row in rows(connection, "SELECT event_id, event_name FROM events ORDER BY created_at DESC")
        ]
        promo_options = [{"value": "", "label": "No promotional image"}] + [
            {"value": row["promo_asset_id"], "label": f"#{row['promo_asset_id']} {row['preview']}"}
            for row in rows(
                connection,
                "SELECT promo_asset_id, COALESCE(NULLIF(image_url, ''), '[base64 image]') AS preview FROM promotional_assets ORDER BY promo_asset_id DESC",
            )
        ]
        style_options = [{"value": "", "label": "Null"}] + [{"value": row["style"], "label": row["style"]} for row in rows(connection, "SELECT style FROM styles WHERE status='on' ORDER BY style")]
        shape_options = [{"value": row["shape"], "label": row["shape"]} for row in rows(connection, "SELECT shape FROM shapes WHERE status='on' ORDER BY shape")]
        material_options = [{"value": row["material_id"], "label": row["material"]} for row in rows(connection, "SELECT material_id, material FROM materials WHERE status='on' ORDER BY material")]
        topic_options = [{"value": row["topic_id"], "label": row["topic"]} for row in rows(connection, "SELECT topic_id, topic FROM topics WHERE status='on' ORDER BY topic")]
        tag_options = [{"value": row["tag_id"], "label": row["tag"]} for row in rows(connection, "SELECT tag_id, tag FROM tags WHERE status='on' ORDER BY tag")]
        visibility_options = [{"value": "public", "label": "public"}, {"value": "private", "label": "private"}, {"value": "unlisted", "label": "unlisted"}]
        event_type_options = [
            {"value": "", "label": "先选择活动类型"},
            {"value": "community_interaction", "label": "社区互动活动"},
            {"value": "external_social", "label": "站外社媒活动"},
            {"value": "design_collection", "label": "设计征集活动"},
            {"value": "promotion_discount", "label": "优惠促销活动"},
        ]
        all_event_types = ["community_interaction", "external_social", "design_collection", "promotion_discount"]
        content_event_types = ["community_interaction", "external_social", "design_collection"]
        discount_type_options = [
            {"value": "threshold_amount_off", "label": "Spend X save Y"},
            {"value": "percent_off", "label": "Percentage discount"},
            {"value": "fixed_price", "label": "Fixed price"},
        ]

        data = {
            "event": {
                "title": "创建活动",
                "editable": True,
                "idKey": "event_id",
                "filters": [
                    {"key": "event_type", "label": "活动分类", "options": event_type_options},
                    {"key": "status", "label": "状态", "options": status_options},
                ],
                "columns": ["event_id", "event_name", "event_type", "promo_asset_id", "html_url", "start_at", "expires_at", "status"],
                "fields": [
                    {"name": "event_type", "label": "Event type", "type": "select", "options": event_type_options},
                    {"name": "event_name", "label": "Event name", "type": "text", "eventTypes": all_event_types},
                    {"name": "event_title", "label": "Event title", "type": "text", "eventTypes": all_event_types},
                    {"name": "event_content", "label": "Event content", "type": "textarea", "eventTypes": content_event_types},
                    {"name": "promo_asset_id", "label": "Promotional asset ID", "type": "number", "eventTypes": all_event_types},
                    {"name": "html_url", "label": "HTML activity URL", "type": "url", "eventTypes": all_event_types},
                    {"name": "start_at", "label": "Start date", "type": "date", "eventTypes": all_event_types},
                    {"name": "expires_at", "label": "Expiry date", "type": "date", "eventTypes": all_event_types},
                    {"name": "status", "label": "Status", "type": "select", "options": status_options, "eventTypes": all_event_types},
                    {"name": "community_action_type", "label": "Community action type", "type": "select", "eventTypes": ["community_interaction"], "options": [{"value": "post", "label": "post"}, {"value": "like", "label": "like"}, {"value": "comment", "label": "comment"}, {"value": "share", "label": "share"}, {"value": "mixed", "label": "mixed"}]},
                    {"name": "target_area", "label": "Community target area", "type": "text", "eventTypes": ["community_interaction"]},
                    {"name": "platforms", "label": "Platforms", "type": "text", "eventTypes": ["external_social"]},
                    {"name": "post_requirements", "label": "Post requirements", "type": "textarea", "eventTypes": ["external_social"]},
                    {"name": "hashtags", "label": "Hashtags", "type": "text", "eventTypes": ["external_social"]},
                    {"name": "social_reward_points", "label": "Reward points", "type": "number", "eventTypes": ["external_social"]},
                    {"name": "design_brief", "label": "Design brief", "type": "textarea", "eventTypes": ["design_collection"]},
                    {"name": "required_shape", "label": "Required nail shape", "type": "select", "options": shape_options, "eventTypes": ["design_collection"]},
                    {"name": "required_style", "label": "Required style", "type": "select", "options": style_options, "eventTypes": ["design_collection"]},
                    {"name": "submission_limit", "label": "Submission limit", "type": "number", "eventTypes": ["design_collection"]},
                    {"name": "design_reward_points", "label": "Reward points", "type": "number", "eventTypes": ["design_collection"]},
                    {"name": "min_spend", "label": "Activation condition: purchase over", "type": "number", "eventTypes": ["promotion_discount"]},
                    {"name": "promo_scope", "label": "Promotion target", "type": "select", "eventTypes": ["promotion_discount"], "options": [{"value": "all_products", "label": "All products"}, {"value": "selected_products", "label": "Selected products"}]},
                    {"name": "target_product_ids", "label": "Selected product IDs", "type": "text", "eventTypes": ["promotion_discount"], "scopeValues": ["selected_products"]},
                    {"name": "discount_type", "label": "Discount type", "type": "select", "eventTypes": ["promotion_discount"], "options": discount_type_options},
                    {"name": "threshold_spend", "label": "Spend amount", "type": "number", "eventTypes": ["promotion_discount"], "discountTypes": ["threshold_amount_off"]},
                    {"name": "amount_off", "label": "Save amount", "type": "number", "eventTypes": ["promotion_discount"], "discountTypes": ["threshold_amount_off"]},
                    {"name": "percent_value", "label": "Discount percent", "type": "number", "eventTypes": ["promotion_discount"], "discountTypes": ["percent_off"]},
                    {"name": "fixed_price_value", "label": "New fixed price", "type": "number", "eventTypes": ["promotion_discount"], "discountTypes": ["fixed_price"]},
                ],
                "rows": event_rows(connection),
            },
            "task": {
                "title": "创建任务",
                "editable": True,
                "idKey": "task_id",
                "filters": [
                    {"key": "task_type", "label": "任务类型", "options": options(connection, "SELECT DISTINCT task_type FROM tasks", ["design_upload", "social_caption", "external_link", "community_action"])},
                    {"key": "status", "label": "状态", "options": status_options},
                ],
                "columns": ["task_id", "task_name", "task_type", "event_id", "promo_asset_id", "status"],
                "fields": [
                    {"name": "task_name", "label": "Task name", "type": "text"},
                    {"name": "event_id", "label": "Bind event", "type": "select", "options": event_options},
                    {"name": "task_type", "label": "Task type", "type": "select", "options": options(connection, "SELECT DISTINCT task_type FROM tasks", ["design_upload", "social_caption", "external_link", "community_action"])},
                    {"name": "submission_type", "label": "Submission type", "type": "select", "options": [{"value": "file", "label": "file"}, {"value": "text", "label": "text"}, {"value": "url", "label": "url"}]},
                    {"name": "promo_asset_id", "label": "Promotional image ID", "type": "select", "options": promo_options},
                    {"name": "allowed_platforms", "label": "Allowed platforms", "type": "text"},
                    {"name": "condition_reward_json", "label": "Condition + Reward", "type": "condition_reward", "taskTypes": ["community_action"]},
                    {"name": "expires_at", "label": "Expiry date", "type": "date"},
                    {"name": "task_content", "label": "Task content", "type": "textarea"},
                    {"name": "status", "label": "Status", "type": "select", "options": status_options},
                ],
                "rows": task_rows(connection),
            },
            "promo-assets": {
                "title": "宣传素材库管理",
                "editable": True,
                "idKey": "promo_asset_id",
                "filters": [],
                "columns": ["promo_asset_id", "image_url", "created_at"],
                "fields": [
                    {"name": "image_file", "label": "Upload image", "type": "file"},
                    {"name": "image_url", "label": "Image URL", "type": "url"},
                    {"name": "image_base64", "label": "Image base64", "type": "textarea"},
                ],
                "rows": rows(connection, "SELECT promo_asset_id, image_url, created_at FROM promotional_assets ORDER BY promo_asset_id DESC"),
            },
            "promotion": {
                "title": "优惠管理",
                "editable": True,
                "idKey": "promo_id",
                "filters": [
                    {"key": "promo_type", "label": "优惠类型", "options": [
                        {"value": "满减优惠", "label": "满减优惠"},
                        {"value": "折扣优惠", "label": "折扣优惠"},
                        {"value": "买送优惠", "label": "买送优惠"},
                        {"value": "免费商品", "label": "免费商品"},
                    ]},
                    {"key": "status", "label": "状态", "options": status_options},
                ],
                "columns": ["promo_id", "promo_title", "promo_type", "promo_content", "expire_date", "assigned_users", "used_count", "status"],
                "fields": [
                    {"name": "promo_id", "label": "Promo ID / 可留空自动生成", "type": "text"},
                    {"name": "promo_title", "label": "优惠标题", "type": "text"},
                    {"name": "promo_type", "label": "优惠类型", "type": "select", "options": [
                        {"value": "满减优惠", "label": "满减优惠"},
                        {"value": "折扣优惠", "label": "折扣优惠"},
                        {"value": "买送优惠", "label": "买送优惠"},
                        {"value": "免费商品", "label": "免费商品"},
                    ]},
                    {"name": "min_spend", "label": "满减：满多少", "type": "number", "promoTypes": ["满减优惠"]},
                    {"name": "amount_off", "label": "满减：减多少", "type": "number", "promoTypes": ["满减优惠"]},
                    {"name": "discount_percent", "label": "折扣：折扣百分比", "type": "number", "promoTypes": ["折扣优惠"]},
                    {"name": "buy_quantity", "label": "买送：购买数量", "type": "number", "promoTypes": ["买送优惠"]},
                    {"name": "gift_quantity", "label": "买送：赠送数量", "type": "number", "promoTypes": ["买送优惠"]},
                    {"name": "gift_product", "label": "买送：赠品/商品 ID", "type": "text", "promoTypes": ["买送优惠"]},
                    {"name": "free_product", "label": "免费商品：商品 ID/名称", "type": "text", "promoTypes": ["免费商品"]},
                    {"name": "description", "label": "补充说明", "type": "textarea"},
                    {"name": "expire_date", "label": "有效期", "type": "date"},
                    {"name": "status", "label": "状态", "type": "select", "options": status_options},
                ],
                "rows": promotion_rows(connection),
            },
            "product": {
                "title": "导入商品",
                "editable": True,
                "idKey": "id",
                "kindKey": "item_kind",
                "filters": [
                    {"key": "item_kind", "label": "商品模型", "options": [{"value": "product", "label": "正式商品"}, {"value": "reward", "label": "积分商品"}]},
                    {"key": "status", "label": "状态", "options": status_options},
                ],
                "columns": ["item_kind", "id", "name", "type", "image", "price_or_points", "stock_by_size", "is_featured", "pickup_method", "status"],
                "productFields": [
                    {"name": "product_name", "label": "Product name", "type": "text"},
                    {"name": "product_type", "label": "Product type", "type": "select", "options": [{"value": "穿戴甲", "label": "穿戴甲"}, {"value": "打印甲", "label": "打印甲"}, {"value": "配件", "label": "配件"}]},
                    {"name": "unit_price", "label": "Unit price", "type": "number"},
                    {"name": "nail_shape", "label": "Nail shape", "type": "select", "options": shape_options},
                    {"name": "style_tags", "label": "Style", "type": "select", "options": style_options},
                    {"name": "stock_s", "label": "Stock S", "type": "number"},
                    {"name": "stock_m", "label": "Stock M", "type": "number"},
                    {"name": "stock_l", "label": "Stock L", "type": "number"},
                    {"name": "stock_xl", "label": "Stock XL", "type": "number"},
                    {"name": "is_featured", "label": "是否精品", "type": "select", "options": [{"value": "0", "label": "No"}, {"value": "1", "label": "Yes"}]},
                    {"name": "pickup_method", "label": "支持取货方式", "type": "select", "options": [{"value": "pickup", "label": "自取"}, {"value": "shipping", "label": "邮寄"}, {"value": "both", "label": "both"}]},
                    {"name": "image_file", "label": "Upload image", "type": "file"},
                    {"name": "image_url", "label": "Image URL", "type": "url"},
                    {"name": "product_info", "label": "Product info", "type": "textarea"},
                    {"name": "status", "label": "Status", "type": "select", "options": status_options},
                ],
                "rewardFields": [
                    {"name": "reward_name", "label": "Reward name", "type": "text"},
                    {"name": "reward_type", "label": "Reward type", "type": "select", "options": [{"value": "coupon", "label": "coupon"}, {"value": "digital_template", "label": "digital_template"}, {"value": "physical_goods", "label": "physical_goods"}, {"value": "benefit", "label": "benefit"}]},
                    {"name": "unit_point_cost", "label": "Point cost", "type": "number"},
                    {"name": "stock_s", "label": "Stock S", "type": "number"},
                    {"name": "stock_m", "label": "Stock M", "type": "number"},
                    {"name": "stock_l", "label": "Stock L", "type": "number"},
                    {"name": "stock_xl", "label": "Stock XL", "type": "number"},
                    {"name": "is_featured", "label": "是否精品", "type": "select", "options": [{"value": "0", "label": "No"}, {"value": "1", "label": "Yes"}]},
                    {"name": "pickup_method", "label": "支持取货方式", "type": "select", "options": [{"value": "pickup", "label": "自取"}, {"value": "shipping", "label": "邮寄"}, {"value": "both", "label": "both"}]},
                    {"name": "image_file", "label": "Upload image", "type": "file"},
                    {"name": "image_url", "label": "Image URL", "type": "url"},
                    {"name": "reward_info", "label": "Reward info", "type": "textarea"},
                    {"name": "status", "label": "Status", "type": "select", "options": status_options},
                ],
                "rows": product_rows(connection),
            },
            "official": {
                "title": "官方模板库",
                "editable": True,
                "idKey": "template_id",
                "filters": [
                    {"key": "design_type", "label": "设计类型", "options": [{"value": "nail", "label": "甲片"}, {"value": "accessory", "label": "配件"}]},
                    {"key": "status", "label": "状态", "options": status_options},
                ],
                "columns": ["template_id", "image", "template_name", "design_type", "nail_shape", "material_type", "image_count", "status"],
                "fields": [
                    {"name": "template_name", "label": "Template name", "type": "text"},
                    {"name": "design_type", "label": "Design type", "type": "select", "options": [{"value": "nail", "label": "Nail template"}, {"value": "accessory", "label": "Accessory"}]},
                    {"name": "nail_shape", "label": "Nail shape", "type": "select", "options": shape_options},
                    {"name": "material_type", "label": "Material type", "type": "select", "options": material_options},
                    {"name": "status", "label": "Status", "type": "select", "options": status_options},
                ],
                "rows": rows(connection, """
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
                """),
            },
            "community": {
                "title": "Community Template Library",
                "editable": True,
                "idKey": "template_id",
                "filters": [
                    {"key": "design_type", "label": "Design type", "options": [{"value": "nail", "label": "nail"}, {"value": "accessory", "label": "accessory"}]},
                    {"key": "status", "label": "Status", "options": [{"value": "active", "label": "active"}, {"value": "hidden", "label": "hidden"}, {"value": "draft", "label": "draft"}]},
                ],
                "columns": ["template_id", "image", "template_name", "author_display_name", "design_type", "nail_shape", "material_type", "status"],
                "fields": [
                    {"name": "template_id", "label": "Template ID", "type": "text"},
                    {"name": "template_name", "label": "Template name", "type": "text"},
                    {"name": "template_title", "label": "Template title", "type": "text"},
                    {"name": "image_file", "label": "Upload cover image", "type": "file"},
                    {"name": "image_url", "label": "Image URL", "type": "url"},
                    {"name": "author_user_id", "label": "Author user ID", "type": "text"},
                    {"name": "author_display_name", "label": "Author", "type": "text"},
                    {"name": "author_level", "label": "Author level", "type": "text"},
                    {"name": "template_type", "label": "Template type", "type": "select", "options": [{"value": "nail", "label": "nail"}, {"value": "draft", "label": "draft"}, {"value": "design", "label": "design"}]},
                    {"name": "design_type", "label": "Design type", "type": "select", "options": [{"value": "nail", "label": "nail"}, {"value": "accessory", "label": "accessory"}]},
                    {"name": "nail_shape", "label": "Nail shape", "type": "select", "options": shape_options},
                    {"name": "material_type", "label": "Material type", "type": "select", "options": material_options},
                    {"name": "shape_categories", "label": "Shape categories", "type": "text"},
                    {"name": "style_categories", "label": "Style categories", "type": "text"},
                    {"name": "material_categories", "label": "Material categories", "type": "text"},
                    {"name": "topic_tags", "label": "Topic tags", "type": "text"},
                    {"name": "tags", "label": "Tags", "type": "text"},
                    {"name": "event_id", "label": "Bind event ID", "type": "select", "options": event_options},
                    {"name": "visibility", "label": "Visibility", "type": "select", "options": visibility_options},
                    {"name": "status", "label": "Status", "type": "select", "options": [{"value": "active", "label": "active"}, {"value": "hidden", "label": "hidden"}, {"value": "draft", "label": "draft"}]},
                    {"name": "view_count", "label": "Views", "type": "number"},
                    {"name": "heat_count", "label": "Heat", "type": "number"},
                    {"name": "like_count", "label": "Likes", "type": "number"},
                    {"name": "favorite_count", "label": "Favorites", "type": "number"},
                    {"name": "comment_count", "label": "Comments", "type": "number"},
                    {"name": "published_at", "label": "Published date", "type": "date"},
                    {"name": "description", "label": "Description", "type": "textarea"},
                    {"name": "template_object_json", "label": "Template object JSON", "type": "textarea"},
                ],
                "rows": rows(connection, """
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
                """),
            },
            "users": {
                "title": "用户管理",
                "editable": True,
                "idKey": "user_id",
                "filters": [
                    {"key": "user_kind", "label": "用户类型", "options": [{"value": "guest", "label": "guest"}, {"value": "member", "label": "member"}]},
                    {"key": "gender", "label": "性别", "options": options(connection, "SELECT DISTINCT gender FROM users", ["female", "male", "other"])},
                ],
                "columns": ["user_id", "username", "user_kind", "recovery_code", "phone", "gender", "created_at", "last_seen_at"],
                "fields": [
                    {"name": "username", "label": "Username", "type": "text"},
                    {"name": "phone", "label": "Phone", "type": "text"},
                    {"name": "gender", "label": "Gender", "type": "select", "options": [{"value": "female", "label": "female"}, {"value": "male", "label": "male"}, {"value": "other", "label": "other"}]},
                ],
                "rows": rows(connection, "SELECT user_id, username, user_kind, recovery_code, phone, gender, created_at, last_seen_at FROM users ORDER BY created_at DESC"),
                "userActions": user_action_rows(connection),
            },
            "orders": {
                "title": "订单记录",
                "editable": False,
                "idKey": "order_id",
                "filters": [
                    {"key": "payment_status", "label": "支付状态", "options": options(connection, "SELECT DISTINCT payment_status FROM orders", ["pending", "paid", "failed", "refunded"])},
                    {"key": "order_status", "label": "订单状态", "options": options(connection, "SELECT DISTINCT order_status FROM orders", ["created", "confirmed", "cancelled", "completed"])},
                ],
                "columns": ["order_id", "user_id", "username", "item_count", "total_price", "pay_method", "payment_status", "delivery_status", "order_status", "created_at", "paid_at"],
                "rows": order_rows(connection),
            },
            "reward-orders": {
                "title": "积分兑换记录",
                "editable": False,
                "idKey": "reward_order_id",
                "filters": [
                    {"key": "status", "label": "状态", "options": options(connection, "SELECT DISTINCT status FROM reward_orders", ["created", "confirmed", "shipped", "completed", "cancelled"])},
                ],
                "columns": ["reward_order_id", "member_id", "user_id", "username", "reward_id", "reward_name", "quantity", "point_cost", "status", "created_at"],
                "rows": reward_order_rows(connection),
            },
            "task-records": {
                "title": "Task Records / TR",
                "editable": False,
                "idKey": "task_record_id",
                "filters": [
                    {"key": "tasktype", "label": "Task type", "options": options(connection, "SELECT DISTINCT tasktype FROM task_records", ["community_action", "external_link", "design_upload", "social_caption"])},
                    {"key": "status", "label": "Status", "options": options(connection, "SELECT DISTINCT status FROM task_records", ["submitted", "reviewing", "approved", "rejected"])},
                ],
                "columns": ["task_record_id", "task_id", "task_name", "tasktype", "user_id", "username", "content_upload", "upload_at", "rating_result", "status", "current_reward"],
                "rows": task_record_rows(connection),
            },
            "event-participation": {
                "title": "Event Participation / EP",
                "editable": False,
                "idKey": "event_participation_id",
                "filters": [
                    {"key": "event_id", "label": "Event ID", "options": options(connection, "SELECT DISTINCT event_id FROM event_participation", [])},
                    {"key": "user_id", "label": "User ID", "options": options(connection, "SELECT DISTINCT user_id FROM event_participation", [])},
                ],
                "columns": ["event_participation_id", "event_id", "event_name", "created_at", "user_id", "username", "current_total_earnpoint", "current_earned_coupon_number", "current_total_earned_template_number"],
                "rows": event_participation_rows(connection),
            },
            "user-comments": {
                "title": "User Comments / UC",
                "editable": False,
                "idKey": "comment_id",
                "filters": [
                    {"key": "comment_type", "label": "Comment type", "options": [{"value": "primary", "label": "????"}, {"value": "secondary", "label": "????"}]},
                    {"key": "status", "label": "Status", "options": [{"value": "visible", "label": "??"}, {"value": "hidden", "label": "??"}]},
                ],
                "columns": ["comment_id", "post_id", "comment_type", "user_id", "username", "commented_at", "comment_content", "status"],
                "rows": user_comment_rows(connection),
            },
            "device-info": {
                "title": "设备信息",
                "editable": True,
                "idKey": "id",
                "filters": [
                    {"key": "type", "label": "类型", "options": [{"value": "主机", "label": "主机"}, {"value": "打印机", "label": "打印机"}]},
                    {"key": "status", "label": "状态", "options": status_options},
                ],
                "columns": ["id", "equip_id", "type", "address", "status", "created_at", "updated_at"],
                "fields": [
                    {"name": "equip_id", "label": "Equip ID", "type": "text"},
                    {"name": "type", "label": "类型", "type": "select", "options": [{"value": "主机", "label": "主机"}, {"value": "打印机", "label": "打印机"}]},
                    {"name": "address", "label": "Address", "type": "textarea"},
                    {"name": "status", "label": "Status", "type": "select", "options": status_options},
                ],
                "rows": rows(connection, "SELECT id, equip_id, type, address, status, created_at, updated_at FROM device_info ORDER BY id DESC"),
            },
            "print-jobs": {
                "title": "打印记录",
                "editable": False,
                "idKey": "print_job_id",
                "filters": [
                    {"key": "status", "label": "状态", "options": options(connection, "SELECT DISTINCT status FROM print_jobs", ["created", "sent", "completed", "failed"])},
                    {"key": "device_id", "label": "设备", "options": options(connection, "SELECT DISTINCT device_id FROM print_jobs", [])},
                ],
                "columns": ["print_job_id", "user_id", "username", "template_id", "draft_id", "coupon_id", "device_id", "device_name", "status", "error_message", "created_at", "sent_at", "completed_at"],
                "rows": print_job_rows(connection),
            },
        }
        print(json.dumps({"ok": True, "models": data}, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
