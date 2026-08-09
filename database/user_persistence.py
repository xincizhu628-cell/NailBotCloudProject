import json
import hashlib
import hmac
import os
import random
import re
import sqlite3
import subprocess
import sys
import uuid

from admin_db import DB_PATH, ensure_admin_schema

ROOT = DB_PATH.parent.parent


def read_payload():
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON payload: {exc}") from exc


def make_guest_id():
    return f"guest_{uuid.uuid4().hex}"


def make_recovery_code():
    return f"NB-{uuid.uuid4().hex[:6].upper()}-{uuid.uuid4().hex[:6].upper()}"


def make_user_id():
    return f"user_{uuid.uuid4().hex}"


def hash_password(password, salt=None):
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), salt.encode("utf-8"), 120000)
    return digest.hex(), salt


def verify_password(password, password_hash, salt):
    if not password_hash or not salt:
        return False
    digest, _ = hash_password(password, salt)
    return hmac.compare_digest(digest, password_hash)


def normalize_target(target_type, target_value):
    target_type = str(target_type or "").strip().lower()
    target_value = str(target_value or "").strip()
    if target_type not in {"email", "phone"}:
        if "@" in target_value:
            target_type = "email"
        else:
            target_type = "phone"
    if target_type == "email":
        target_value = target_value.lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", target_value):
            raise ValueError("Invalid email address.")
    else:
        clean_phone = re.sub(r"[\s\-()]", "", target_value)
        if not re.match(r"^\+?\d{6,18}$", clean_phone):
            raise ValueError("Invalid phone number.")
        target_value = clean_phone
    return target_type, target_value


def make_verification_code():
    return f"{random.SystemRandom().randint(0, 999999):06d}"


def public_user(row):
    return {
        "userId": row["user_id"],
        "username": row["username"],
        "userKind": row["user_kind"] or "guest",
        "recoveryCode": row["recovery_code"],
        "email": row["email"] if "email" in row.keys() else None,
        "phone": row["phone"] if "phone" in row.keys() else None,
        "avatarText": (row["username"] or "U")[:1].upper(),
    }


def send_verification_code(target_type, target_value, code, purpose):
    payload = {
        "targetType": target_type,
        "target": target_value,
        "code": code,
        "purpose": purpose,
    }
    sender = ROOT / "verification_sender.js"
    try:
        launcher = "require('vm').runInThisContext(require('fs').readFileSync('verification_sender.js','utf8'), { filename: 'verification_sender.js' })"
        result = subprocess.run(
            ["node", "-e", launcher],
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(ROOT),
            timeout=20,
        )
        if result.stdout:
            data = json.loads(result.stdout)
            if data.get("sent"):
                return data
            return {
                **data,
                "devCode": code,
                "message": data.get("reason") or f"Verification code prepared for {target_type}.",
            }
    except Exception as exc:
        return {
            "sent": False,
            "provider": "development-code",
            "message": f"Verification sender unavailable: {exc}",
            "devCode": code,
        }
    return {
        "sent": False,
        "provider": "development-code",
        "message": f"Verification code prepared for {target_type}. Configure an email/SMS provider to send it automatically.",
        "devCode": code,
    }


def ensure_member(connection, user_id):
    member_id = f"member_{user_id}"
    connection.execute(
        """
        INSERT OR IGNORE INTO members (member_id, user_id, tier, level, points_balance)
        VALUES (?, ?, 'Aurora Member', 1, 0)
        """,
        (member_id, user_id),
    )


def ensure_user(connection, user_id=None, recovery_code=None):
    connection.row_factory = sqlite3.Row
    row = None
    if user_id:
        row = connection.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not row and recovery_code:
        row = connection.execute("SELECT * FROM users WHERE recovery_code=?", (recovery_code,)).fetchone()
    if row:
        connection.execute("UPDATE users SET last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=?", (row["user_id"],))
        return public_user(connection.execute("SELECT * FROM users WHERE user_id=?", (row["user_id"],)).fetchone())

    new_user_id = user_id if user_id else make_guest_id()
    new_recovery_code = recovery_code if recovery_code else make_recovery_code()
    username = f"Guest {new_user_id[-6:]}"
    connection.execute(
        """
        INSERT INTO users (user_id, username, user_kind, recovery_code, last_seen_at)
        VALUES (?, ?, 'guest', ?, CURRENT_TIMESTAMP)
        """,
        (new_user_id, username, new_recovery_code),
    )
    row = connection.execute("SELECT * FROM users WHERE user_id=?", (new_user_id,)).fetchone()
    return public_user(row)


def draft_primary_id(user_id, draft_id):
    clean_draft_id = str(draft_id or "AUTO-DRAFT-D2-CANVAS").strip() or "AUTO-DRAFT-D2-CANVAS"
    return f"{user_id}:{clean_draft_id}"


def save_draft(connection, payload):
    user = ensure_user(connection, payload.get("userId"), payload.get("recoveryCode"))
    content = payload.get("content")
    if not isinstance(content, dict):
        raise ValueError("Draft content must be an object.")
    draft_id = draft_primary_id(user["userId"], payload.get("draftId"))
    connection.execute(
        """
        INSERT INTO draft_cache (
          draft_id, user_id, draft_type, draft_content_json, preview_asset_id, saved_at, is_auto_draft
        )
        VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(draft_id) DO UPDATE SET
          draft_content_json=excluded.draft_content_json,
          saved_at=CURRENT_TIMESTAMP,
          is_auto_draft=excluded.is_auto_draft
        """,
        (
            draft_id,
            user["userId"],
            str(payload.get("draftType") or "design_canvas"),
            json.dumps(content, ensure_ascii=False),
            1 if payload.get("isAutoDraft") else 0,
        ),
    )
    row = connection.execute("SELECT saved_at FROM draft_cache WHERE draft_id=?", (draft_id,)).fetchone()
    return {"ok": True, "user": user, "draftId": draft_id, "savedAt": row["saved_at"] if row else None}


def load_draft(connection, payload):
    user = ensure_user(connection, payload.get("userId"), payload.get("recoveryCode"))
    requested_id = payload.get("draftId")
    if requested_id:
        row = connection.execute(
            "SELECT * FROM draft_cache WHERE draft_id=?",
            (draft_primary_id(user["userId"], requested_id),),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT * FROM draft_cache
            WHERE user_id=? AND draft_type='design_canvas' AND is_auto_draft=1
            ORDER BY saved_at DESC
            LIMIT 1
            """,
            (user["userId"],),
        ).fetchone()
    if not row:
        return {"ok": True, "user": user, "draft": None}
    return {
        "ok": True,
        "user": user,
        "draft": {
            "draftId": row["draft_id"],
            "draftType": row["draft_type"],
            "savedAt": row["saved_at"],
            "isAutoDraft": bool(row["is_auto_draft"]),
            "content": json.loads(row["draft_content_json"] or "{}"),
        },
    }


def create_auth_session(connection, user_id):
    session_id = f"sess_{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT INTO user_auth_sessions (session_id, user_id, login_date, login_at, last_seen_at, status)
        VALUES (?, ?, DATE('now', 'localtime'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        """,
        (session_id, user_id),
    )
    return session_id


def merge_guest_into_member(connection, guest_user_id, guest_recovery_code, member_user_id):
    guest_user_id = str(guest_user_id or "").strip()
    guest_recovery_code = str(guest_recovery_code or "").strip()
    if not member_user_id:
        return False
    guest = None
    if guest_user_id and guest_user_id != member_user_id:
        guest = connection.execute("SELECT * FROM users WHERE user_id=?", (guest_user_id,)).fetchone()
    if not guest and guest_recovery_code:
        guest = connection.execute("SELECT * FROM users WHERE recovery_code=?", (guest_recovery_code,)).fetchone()
    if not guest or guest["user_id"] == member_user_id or guest["user_kind"] != "guest":
        return False
    guest_id = guest["user_id"]

    for row in connection.execute("SELECT draft_id FROM draft_cache WHERE user_id=?", (guest_id,)).fetchall():
        old_draft_id = row["draft_id"]
        suffix = old_draft_id.split(":", 1)[1] if ":" in old_draft_id else old_draft_id
        new_draft_id = draft_primary_id(member_user_id, suffix)
        connection.execute(
            """
            UPDATE OR REPLACE draft_cache
            SET draft_id=?, user_id=?
            WHERE draft_id=?
            """,
            (new_draft_id, member_user_id, old_draft_id),
        )
        connection.execute("UPDATE OR IGNORE print_jobs SET draft_id=? WHERE draft_id=?", (new_draft_id, old_draft_id))

    user_tables = [
        ("addresses", "user_id"),
        ("third_party_accounts", "user_id"),
        ("assets", "owner_user_id"),
        ("articles", "author_user_id"),
        ("tags", "created_by_user_id"),
        ("templates", "author_user_id"),
        ("personal_galleries", "user_id"),
        ("gallery_templates", "user_id"),
        ("task_drafts", "user_id"),
        ("task_submissions", "user_id"),
        ("orders", "user_id"),
        ("cart_items", "user_id"),
        ("comments", "user_id"),
        ("user_actions", "user_id"),
        ("print_jobs", "user_id"),
        ("ai_jobs", "user_id"),
        ("user_auth_sessions", "user_id"),
    ]
    for table, column in user_tables:
        connection.execute(f"UPDATE OR IGNORE {table} SET {column}=? WHERE {column}=?", (member_user_id, guest_id))
        connection.execute(f"DELETE FROM {table} WHERE {column}=?", (guest_id,))

    guest_member_id = f"member_{guest_id}"
    member_id = f"member_{member_user_id}"
    for table in ("member_awards", "point_transactions", "reward_orders"):
        connection.execute(f"UPDATE OR IGNORE {table} SET member_id=? WHERE member_id=?", (member_id, guest_member_id))
        connection.execute(f"DELETE FROM {table} WHERE member_id=?", (guest_member_id,))
    connection.execute("DELETE FROM members WHERE user_id=? OR member_id=?", (guest_id, guest_member_id))
    connection.execute("DELETE FROM users WHERE user_id=?", (guest_id,))
    return True


def login_user(connection, payload):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        raise ValueError("Username and password are required.")
    row = connection.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if row:
        if row["auth_status"] != "active":
            raise ValueError("This account is not active.")
        if not verify_password(password, row["password_hash"], row["password_salt"]):
            raise ValueError("Incorrect username or password.")
        user_id = row["user_id"]
    else:
        raise ValueError("Account not found. Please create an account first.")
    connection.execute(
        "UPDATE users SET user_kind='member', last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
        (user_id,),
    )
    ensure_member(connection, user_id)
    merge_guest_into_member(connection, payload.get("guestUserId"), payload.get("guestRecoveryCode"), user_id)
    session_id = create_auth_session(connection, user_id)
    user = public_user(connection.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone())
    return {"ok": True, "user": user, "sessionId": session_id, "created": False}


def request_verification_code(connection, payload):
    target_type, target_value = normalize_target(payload.get("targetType"), payload.get("target"))
    purpose = str(payload.get("purpose") or "create_account").strip()
    if purpose not in {"create_account", "reset_password", "profile_old_contact", "profile_new_contact"}:
        raise ValueError("Unsupported verification purpose.")
    if purpose == "create_account":
        existing = connection.execute(
            "SELECT user_id FROM users WHERE email=? OR phone=? OR username=?",
            (target_value if target_type == "email" else "", target_value if target_type == "phone" else "", str(payload.get("username") or "").strip()),
        ).fetchone()
        if existing:
            raise ValueError("This username, email, or phone is already registered.")
    elif purpose == "reset_password":
        existing = connection.execute(
            "SELECT user_id FROM users WHERE email=? OR phone=?",
            (target_value if target_type == "email" else "", target_value if target_type == "phone" else ""),
        ).fetchone()
        if not existing:
            raise ValueError("No account is bound to this email or phone.")
    elif purpose == "profile_old_contact":
        session = auth_session(connection, {"sessionId": payload.get("sessionId")})
        if not session.get("ok"):
            raise ValueError("Please log in again.")
        user = session["user"]
        current_value = user.get(target_type)
        if not current_value or current_value != target_value:
            raise ValueError("This is not the contact currently bound to your account.")
    elif purpose == "profile_new_contact":
        existing = connection.execute(
            "SELECT user_id FROM users WHERE email=? OR phone=?",
            (target_value if target_type == "email" else "", target_value if target_type == "phone" else ""),
        ).fetchone()
        if existing:
            raise ValueError("This email or phone is already registered.")
    code = make_verification_code()
    code_hash, code_salt = hash_password(code)
    verification_id = f"verify_{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT INTO auth_verification_codes (
          verification_id, target_type, target_value, purpose, code_hash, code_salt, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, DATETIME(CURRENT_TIMESTAMP, '+5 minutes'))
        """,
        (verification_id, target_type, target_value, purpose, code_hash, code_salt),
    )
    send_result = send_verification_code(target_type, target_value, code, purpose)
    return {
        "ok": True,
        "verificationId": verification_id,
        "targetType": target_type,
        "target": target_value,
        "expiresInSeconds": 300,
        "delivery": send_result,
    }


def consume_verification(connection, verification_id, code, purpose):
    row = connection.execute(
        """
        SELECT * FROM auth_verification_codes
        WHERE verification_id=? AND purpose=? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        """,
        (verification_id, purpose),
    ).fetchone()
    if not row:
        raise ValueError("Verification code expired or does not exist.")
    if not verify_password(str(code or "").strip(), row["code_hash"], row["code_salt"]):
        raise ValueError("Verification code is incorrect.")
    connection.execute(
        "UPDATE auth_verification_codes SET consumed_at=CURRENT_TIMESTAMP WHERE verification_id=?",
        (verification_id,),
    )
    return row


def create_verified_account(connection, payload):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        raise ValueError("Username and password are required.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    verification = consume_verification(connection, payload.get("verificationId"), payload.get("code"), "create_account")
    duplicate = connection.execute(
        "SELECT user_id FROM users WHERE username=? OR email=? OR phone=?",
        (
            username,
            verification["target_value"] if verification["target_type"] == "email" else "",
            verification["target_value"] if verification["target_type"] == "phone" else "",
        ),
    ).fetchone()
    if duplicate:
        raise ValueError("This username, email, or phone is already registered.")
    password_hash, password_salt = hash_password(password)
    user_id = make_user_id()
    connection.execute(
        """
        INSERT INTO users (
          user_id, username, user_kind, recovery_code, password_hash, password_salt,
          auth_status, email, phone, last_seen_at
        )
        VALUES (?, ?, 'member', ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            user_id,
            username,
            make_recovery_code(),
            password_hash,
            password_salt,
            verification["target_value"] if verification["target_type"] == "email" else None,
            verification["target_value"] if verification["target_type"] == "phone" else None,
        ),
    )
    ensure_member(connection, user_id)
    merge_guest_into_member(connection, payload.get("guestUserId"), payload.get("guestRecoveryCode"), user_id)
    session_id = create_auth_session(connection, user_id)
    user = public_user(connection.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone())
    return {"ok": True, "user": user, "sessionId": session_id}


def reset_password(connection, payload):
    new_password = str(payload.get("newPassword") or "")
    if len(new_password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    verification = consume_verification(connection, payload.get("verificationId"), payload.get("code"), "reset_password")
    row = connection.execute(
        "SELECT * FROM users WHERE email=? OR phone=?",
        (
            verification["target_value"] if verification["target_type"] == "email" else "",
            verification["target_value"] if verification["target_type"] == "phone" else "",
        ),
    ).fetchone()
    if not row:
        raise ValueError("No account is bound to this email or phone.")
    password_hash, password_salt = hash_password(new_password)
    connection.execute(
        "UPDATE users SET password_hash=?, password_salt=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
        (password_hash, password_salt, row["user_id"]),
    )
    return {"ok": True, "user": public_user(row)}


def auth_session(connection, payload):
    session_id = str(payload.get("sessionId") or "").strip()
    if not session_id:
        return {"ok": False, "error": "No session."}
    row = connection.execute(
        """
        SELECT s.*, u.*
        FROM user_auth_sessions s
        JOIN users u ON u.user_id = s.user_id
        WHERE s.session_id=? AND s.status='active' AND s.login_date=DATE('now', 'localtime')
        """,
        (session_id,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Session expired."}
    connection.execute(
        "UPDATE user_auth_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE session_id=?",
        (session_id,),
    )
    connection.execute(
        "UPDATE users SET last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
        (row["user_id"],),
    )
    return {"ok": True, "user": public_user(row), "sessionId": session_id}


def profile_data(connection, payload):
    session = auth_session(connection, payload)
    if not session.get("ok"):
        return session
    user_id = session["user"]["userId"]
    user_row = connection.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
    accounts = [
        {
            "platform": row["platform"],
            "platformUserId": row["platform_user_id"],
            "username": row["username"],
            "status": row["access_status"],
            "linkedAt": row["linked_at"],
        }
        for row in connection.execute(
            """
            SELECT platform, platform_user_id, username, access_status, linked_at
            FROM third_party_accounts
            WHERE user_id=?
            ORDER BY linked_at DESC
            """,
            (user_id,),
        ).fetchall()
    ]
    user = public_user(user_row)
    user.update({
        "createdAt": user_row["created_at"],
        "lastSeenAt": user_row["last_seen_at"],
        "thirdPartyAccounts": accounts,
    })
    return {"ok": True, "user": user, "sessionId": session.get("sessionId")}


def update_profile_contact(connection, payload):
    session = auth_session(connection, {"sessionId": payload.get("sessionId")})
    if not session.get("ok"):
        return session
    contact_type, new_value = normalize_target(payload.get("targetType"), payload.get("newTarget"))
    if contact_type not in {"email", "phone"}:
        raise ValueError("Unsupported contact type.")
    old_verification = consume_verification(connection, payload.get("oldVerificationId"), payload.get("oldCode"), "profile_old_contact")
    new_verification = consume_verification(connection, payload.get("newVerificationId"), payload.get("newCode"), "profile_new_contact")
    if old_verification["target_type"] != contact_type or new_verification["target_type"] != contact_type:
        raise ValueError("Verification type does not match.")
    if new_verification["target_value"] != new_value:
        raise ValueError("New contact does not match the verified value.")
    user_id = session["user"]["userId"]
    existing = connection.execute(
        "SELECT user_id FROM users WHERE (email=? OR phone=?) AND user_id<>?",
        (new_value if contact_type == "email" else "", new_value if contact_type == "phone" else "", user_id),
    ).fetchone()
    if existing:
        raise ValueError("This email or phone is already registered.")
    connection.execute(
        f"UPDATE users SET {contact_type}=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
        (new_value, user_id),
    )
    return profile_data(connection, {"sessionId": payload.get("sessionId")})


def format_address(row):
    if not row:
        return ""
    parts = [
        row["receiver_name"],
        row["phone"],
        row["street"],
        row["city"],
        row["state"],
        row["postcode"],
        row["country"],
    ]
    return " / ".join(str(part).strip() for part in parts if str(part or "").strip())


def get_shipping_address(connection, payload):
    session = auth_session(connection, {"sessionId": payload.get("sessionId")})
    if not session.get("ok"):
        return session
    user_id = session["user"]["userId"]
    row = connection.execute(
        """
        SELECT *
        FROM addresses
        WHERE user_id=?
        ORDER BY is_default DESC, created_at DESC
        LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    return {
        "ok": True,
        "address": format_address(row),
        "addressId": row["address_id"] if row else "",
    }


def save_shipping_address(connection, payload):
    session = auth_session(connection, {"sessionId": payload.get("sessionId")})
    if not session.get("ok"):
        return session
    address_text = str(payload.get("address") or "").strip()
    if len(address_text) < 6:
        raise ValueError("Shipping address is too short.")
    user_id = session["user"]["userId"]
    existing = connection.execute(
        "SELECT address_id FROM addresses WHERE user_id=? ORDER BY is_default DESC, created_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if existing:
        address_id = existing["address_id"]
        connection.execute(
            """
            UPDATE addresses
            SET street=?, is_default=1
            WHERE address_id=? AND user_id=?
            """,
            (address_text, address_id, user_id),
        )
    else:
        address_id = f"addr_{uuid.uuid4().hex}"
        connection.execute(
            """
            INSERT INTO addresses (address_id, user_id, street, country, is_default)
            VALUES (?, ?, ?, 'Australia', 1)
            """,
            (address_id, user_id, address_text),
        )
    connection.execute(
        "UPDATE users SET default_address_id=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
        (address_id, user_id),
    )
    return get_shipping_address(connection, {"sessionId": payload.get("sessionId")})


def record_user_action(connection, payload):
    user_id = str(payload.get("userId") or "").strip()
    recovery_code = str(payload.get("recoveryCode") or "").strip()
    if not user_id and recovery_code:
        row = connection.execute("SELECT user_id FROM users WHERE recovery_code=?", (recovery_code,)).fetchone()
        user_id = row["user_id"] if row else ""
    if not user_id:
        return {"ok": False, "error": "User session is required."}
    user_row = connection.execute("SELECT user_id FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not user_row:
        return {"ok": False, "error": "User not found."}

    target_type = str(payload.get("targetType") or "").strip().lower()
    target_id = str(payload.get("targetId") or "").strip()
    action_type = str(payload.get("actionType") or "").strip().lower()
    allowed_targets = {"template", "topic", "comment", "product", "event", "draft", "coupon"}
    allowed_actions = {"view", "like", "favorite", "comment", "reply", "share", "print", "use", "cart", "purchase"}
    if target_type not in allowed_targets:
        raise ValueError("Unsupported target type.")
    if action_type not in allowed_actions:
        raise ValueError("Unsupported action type.")
    if not target_id:
        raise ValueError("Target ID is required.")

    action_id = f"action_{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT OR IGNORE INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES (?, ?, ?, ?, ?)
        """,
        (action_id, user_id, target_type, target_id, action_type),
    )
    row = connection.execute(
        """
        SELECT action_id, user_id, target_type, target_id, action_type, created_at
        FROM user_actions
        WHERE user_id=? AND target_type=? AND target_id=? AND action_type=?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (user_id, target_type, target_id, action_type),
    ).fetchone()
    return {
        "ok": True,
        "action": {key: row[key] for key in row.keys()} if row else None,
    }


def logout_user(connection, payload):
    session_id = str(payload.get("sessionId") or "").strip()
    if session_id:
        connection.execute(
            "UPDATE user_auth_sessions SET status='logged_out', last_seen_at=CURRENT_TIMESTAMP WHERE session_id=?",
            (session_id,),
        )
    return {"ok": True}


def main():
    payload = read_payload()
    action = str(payload.get("action") or "session")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        ensure_admin_schema(connection)
        if action == "session":
            result = {"ok": True, "user": ensure_user(connection, payload.get("userId"), payload.get("recoveryCode"))}
        elif action == "login":
            result = login_user(connection, payload)
        elif action == "request_code":
            result = request_verification_code(connection, payload)
        elif action == "create_account":
            result = create_verified_account(connection, payload)
        elif action == "reset_password":
            result = reset_password(connection, payload)
        elif action == "auth_session":
            result = auth_session(connection, payload)
        elif action == "profile":
            result = profile_data(connection, payload)
        elif action == "update_contact":
            result = update_profile_contact(connection, payload)
        elif action == "get_shipping_address":
            result = get_shipping_address(connection, payload)
        elif action == "save_shipping_address":
            result = save_shipping_address(connection, payload)
        elif action == "logout":
            result = logout_user(connection, payload)
        elif action == "save_draft":
            result = save_draft(connection, payload)
        elif action == "load_draft":
            result = load_draft(connection, payload)
        elif action == "record_action":
            result = record_user_action(connection, payload)
        else:
            raise ValueError(f"Unsupported action: {action}")
        connection.commit()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
