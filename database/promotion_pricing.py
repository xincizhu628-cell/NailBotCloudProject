import json
import math


def money(value):
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0
    if not math.isfinite(number):
        number = 0
    return round(max(0, number), 2)


def normalize_rule(rule):
    if isinstance(rule, str):
        rule = json.loads(rule or "{}")
    rule = rule or {}
    return {
        "discount_type": str(rule.get("discount_type") or "percent_off"),
        "discount_value": money(rule.get("discount_value")),
        "min_spend": money(rule.get("min_spend")),
        "activation_min_spend": money(rule.get("activation_min_spend")),
        "threshold_spend": money(rule.get("threshold_spend")),
        "target_product_ids": [str(item).strip() for item in rule.get("target_product_ids", []) if str(item).strip()],
    }


def eligible_subtotal(items, rule):
    target_ids = set(rule["target_product_ids"])
    subtotal = 0
    for item in items or []:
        product_id = str(item.get("product_id") or item.get("id") or "")
        if target_ids and product_id not in target_ids:
            continue
        quantity = int(float(item.get("quantity") or 1))
        unit_price = money(item.get("unit_price") if "unit_price" in item else item.get("price"))
        subtotal += max(0, quantity) * unit_price
    return money(subtotal)


def calculate_promotion_price(items, rule):
    normalized = normalize_rule(rule)
    subtotal = eligible_subtotal(items, normalized)
    required_spend = max(normalized["min_spend"], normalized["activation_min_spend"], normalized["threshold_spend"] if normalized["discount_type"] == "threshold_amount_off" else 0)
    if subtotal < required_spend:
        return {
            "eligible": False,
            "subtotal": subtotal,
            "discount": 0,
            "final_total": subtotal,
            "reason": "Minimum spend has not been reached.",
        }

    discount_type = normalized["discount_type"]
    value = normalized["discount_value"]
    if discount_type == "percent_off":
        discount = subtotal * min(value, 100) / 100
    elif discount_type in {"amount_off", "threshold_amount_off"}:
        discount = value
    elif discount_type == "fixed_price":
        discount = max(0, subtotal - value)
    else:
        raise ValueError(f"Unsupported discount_type: {discount_type}")

    discount = money(min(discount, subtotal))
    return {
        "eligible": True,
        "subtotal": subtotal,
        "discount": discount,
        "final_total": money(subtotal - discount),
        "reason": "",
    }


if __name__ == "__main__":
    import sys

    payload = json.loads(sys.stdin.read() or "{}")
    print(json.dumps(calculate_promotion_price(payload.get("items", []), payload.get("rule", {})), ensure_ascii=False))
