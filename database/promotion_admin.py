import json
import re
import sqlite3
import sys
import time
import uuid

from admin_db import DB_PATH, ensure_admin_schema, repair_mojibake_text

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")

PROMO_TYPES = {"满减优惠", "折扣优惠", "买送优惠", "免费商品"}


def clean_text(value):
    if value is None:
        return ""
    return repair_mojibake_text(str(value).strip())


def clean_float(value, default=0):
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def clean_int(value, default=0):
    try:
        if value in (None, ""):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def make_promo_id(title):
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", clean_text(title).lower()).strip("-")[:28] or "promo"
    return f"promo-{slug}-{int(time.time() * 1000)}"


def rows(connection, query, params=()):
    cursor = connection.execute(query, params)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def promotion_rows(connection):
    return rows(
        connection,
        """
        SELECT
          p.promo_id,
          p.promo_title,
          p.promo_type,
          p.promo_content,
          p.expire_date,
          p.status,
          COUNT(up.user_promo_id) AS assigned_users,
          SUM(CASE WHEN up.status='used' THEN 1 ELSE 0 END) AS used_count,
          p.created_at,
          p.updated_at
        FROM promotion p
        LEFT JOIN user_promo up ON up.promo_id = p.promo_id
        GROUP BY p.promo_id
        ORDER BY p.created_at DESC
        """,
    )


def normalize_content(item):
    promo_type = clean_text(item.get("promo_type"))
    if promo_type not in PROMO_TYPES:
        raise ValueError("promo_type must be 满减优惠, 折扣优惠, 买送优惠, or 免费商品.")
    raw_content = clean_text(item.get("promo_content"))
    content = {
        "type": promo_type,
        "description": clean_text(item.get("description")),
    }
    if raw_content:
        try:
            parsed = json.loads(raw_content)
            if isinstance(parsed, dict):
                content.update(parsed)
        except json.JSONDecodeError:
            content["description"] = raw_content
    content["type"] = promo_type
    if item.get("description") not in (None, ""):
        content["description"] = clean_text(item.get("description"))
    if promo_type == "满减优惠":
        min_spend = clean_float(item.get("min_spend"), clean_float(content.get("min_spend")))
        amount_off = clean_float(item.get("amount_off"), clean_float(content.get("amount_off")))
        content.update({"min_spend": min_spend, "amount_off": amount_off, "summary": f"满 {min_spend:g} 减 {amount_off:g}"})
    elif promo_type == "折扣优惠":
        percent = clean_float(item.get("discount_percent"), clean_float(content.get("discount_percent")))
        content.update({
            "discount_percent": percent,
            "summary": f"{percent:g}% OFF",
        })
    elif promo_type == "买送优惠":
        buy_qty = clean_int(item.get("buy_quantity"), clean_int(content.get("buy_quantity"), 1))
        gift_qty = clean_int(item.get("gift_quantity"), clean_int(content.get("gift_quantity"), 1))
        gift_product = clean_text(item.get("gift_product")) or clean_text(content.get("gift_product"))
        content.update({
            "buy_quantity": buy_qty,
            "gift_quantity": gift_qty,
            "gift_product": gift_product,
            "summary": f"买 {buy_qty} 送 {gift_qty}",
        })
    elif promo_type == "免费商品":
        free_product = clean_text(item.get("free_product")) or clean_text(content.get("free_product"))
        content.update({
            "free_product": free_product,
            "summary": f"免费商品：{free_product or '指定商品'}",
        })
    return json.dumps(content, ensure_ascii=False)


def create_promotion(connection, item):
    title = clean_text(item.get("promo_title"))
    if not title:
        raise ValueError("promo_title is required.")
    promo_id = clean_text(item.get("promo_id")) or make_promo_id(title)
    promo_type = clean_text(item.get("promo_type"))
    content = normalize_content(item)
    connection.execute(
        """
        INSERT INTO promotion (
          promo_id, promo_title, promo_type, promo_content, expire_date, status
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            promo_id,
            title,
            promo_type,
            content,
            clean_text(item.get("expire_date")),
            clean_text(item.get("status")) or "active",
        ),
    )
    assign_to_demo_user(connection, promo_id)
    return promo_id, promotion_rows(connection)


def update_promotion(connection, promo_id, item):
    existing = connection.execute("SELECT * FROM promotion WHERE promo_id=?", (promo_id,)).fetchone()
    if not existing:
        raise ValueError("Promotion not found.")
    merged = {
        "promo_type": existing[2],
        "promo_content": existing[3],
    }
    merged.update(item)
    promo_type = clean_text(merged.get("promo_type"))
    if promo_type not in PROMO_TYPES:
        raise ValueError("promo_type must be 满减优惠, 折扣优惠, 买送优惠, or 免费商品.")
    connection.execute(
        """
        UPDATE promotion
        SET promo_title=?, promo_type=?, promo_content=?, expire_date=?, status=?, updated_at=CURRENT_TIMESTAMP
        WHERE promo_id=?
        """,
        (
            clean_text(item.get("promo_title")) or existing[1],
            promo_type,
            normalize_content(merged),
            clean_text(item.get("expire_date")) or existing[4],
            clean_text(item.get("status")) or existing[5] or "active",
            promo_id,
        ),
    )
    return promotion_rows(connection)


def delete_promotion(connection, promo_id):
    connection.execute("DELETE FROM user_promo WHERE promo_id=?", (promo_id,))
    connection.execute("DELETE FROM promotion WHERE promo_id=?", (promo_id,))
    return promotion_rows(connection)


def assign_to_demo_user(connection, promo_id):
    user = connection.execute("SELECT user_id FROM users ORDER BY created_at LIMIT 1").fetchone()
    if not user:
        return
    user_promo_id = f"userpromo_{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT OR IGNORE INTO user_promo (user_promo_id, promo_id, user_id, status)
        VALUES (?, ?, ?, 'unused')
        """,
        (user_promo_id, promo_id, user[0]),
    )


def public_user_promos(connection, payload):
    session_id = clean_text(payload.get("sessionId"))
    user_id = clean_text(payload.get("userId"))
    if session_id:
        row = connection.execute(
            """
            SELECT u.user_id, u.username
            FROM user_auth_sessions s
            JOIN users u ON u.user_id = s.user_id
            WHERE s.session_id=? AND s.status='active'
            """,
            (session_id,),
        ).fetchone()
        if row:
            user_id = row[0]
    if not user_id:
        row = connection.execute("SELECT user_id FROM users ORDER BY created_at LIMIT 1").fetchone()
        user_id = row[0] if row else ""
    user = connection.execute("SELECT user_id, username FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not user:
        return {"ok": True, "user": {"userId": "", "username": "Guest"}, "promos": [], "total": 0}
    data = rows(
        connection,
        """
        SELECT
          up.user_promo_id,
          up.status AS user_promo_status,
          up.assigned_at,
          up.used_at,
          p.promo_id,
          p.promo_title,
          p.promo_type,
          p.promo_content,
          p.expire_date,
          p.status
        FROM user_promo up
        JOIN promotion p ON p.promo_id = up.promo_id
        WHERE up.user_id=? AND p.status='active'
        ORDER BY up.assigned_at DESC
        """,
        (user_id,),
    )
    return {
        "ok": True,
        "user": {"userId": user[0], "username": user[1]},
        "promos": data,
        "total": len([item for item in data if item.get("user_promo_status") != "used"]),
    }


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    action = clean_text(payload.get("action") or "list")
    item = payload.get("item") or {}
    with sqlite3.connect(DB_PATH) as connection:
        ensure_admin_schema(connection)
        if action == "create":
            promo_id, data = create_promotion(connection, item)
            result = {"ok": True, "id": promo_id, "rows": data}
        elif action == "update":
            data = update_promotion(connection, clean_text(payload.get("id")), item)
            result = {"ok": True, "rows": data}
        elif action == "delete":
            data = delete_promotion(connection, clean_text(payload.get("id")))
            result = {"ok": True, "rows": data}
        elif action == "public_user_promos":
            result = public_user_promos(connection, payload)
        else:
            result = {"ok": True, "rows": promotion_rows(connection)}
        connection.commit()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
