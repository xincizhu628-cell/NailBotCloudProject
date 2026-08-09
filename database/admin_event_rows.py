import json


def rows(connection, query, params=()):
    cursor = connection.execute(query, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def parse_json_dict(value):
    text = str(value or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def parse_json_list_text(value):
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(data, list):
        return ", ".join(str(item) for item in data)
    return text


def event_rows(connection):
    data = rows(
        connection,
        """
        SELECT
          e.event_id,
          e.event_name,
          e.event_type,
          e.event_title,
          e.event_content,
          e.promo_asset_id,
          e.html_url,
          e.start_at,
          e.expires_at,
          e.status,
          pd.promo_scope,
          pd.target_product_ids,
          pd.discount_type,
          pd.discount_value,
          pd.min_spend,
          pd.stackable,
          pd.price_rule_json
        FROM events e
        LEFT JOIN promotion_discount_events pd ON pd.event_id = e.event_id
        ORDER BY e.created_at DESC
        """,
    )
    for item in data:
        rule = parse_json_dict(item.get("price_rule_json"))
        discount_type = item.get("discount_type") or rule.get("discount_type") or ""
        item["discount_type"] = discount_type
        item["promo_scope"] = item.get("promo_scope") or "all_products"
        item["target_product_ids"] = parse_json_list_text(item.get("target_product_ids") or rule.get("target_product_ids"))
        item["min_spend"] = rule.get("activation_min_spend", item.get("min_spend") or 0)
        item["threshold_spend"] = rule.get("threshold_spend", item.get("min_spend") or 0)
        item["amount_off"] = rule.get("amount_off", item.get("discount_value") if discount_type == "threshold_amount_off" else 0)
        item["percent_value"] = rule.get("percent_value", item.get("discount_value") if discount_type == "percent_off" else 0)
        item["fixed_price_value"] = rule.get("fixed_price_value", item.get("discount_value") if discount_type == "fixed_price" else 0)
    return data
