import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from admin_db import DB_PATH, ensure_admin_schema


SESSION_HOURS = 8
PBKDF2_ITERATIONS = 180_000


def utc_now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.replace(microsecond=0).isoformat()


def hash_password(password, salt=None):
    if salt is None:
        salt_bytes = secrets.token_bytes(16)
    else:
        salt_bytes = base64.b64decode(salt)
    password_bytes = str(password or "").encode("utf-8")
    digest = hashlib.pbkdf2_hmac("sha256", password_bytes, salt_bytes, PBKDF2_ITERATIONS)
    return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt_bytes).decode("ascii")


def verify_password(password, stored_hash, stored_salt):
    test_hash, _ = hash_password(password, stored_salt)
    return hmac.compare_digest(test_hash, stored_hash or "")


def ensure_default_admin(connection):
    admin_id = os.environ.get("ADMIN_DEFAULT_ID", "admin")
    password = os.environ.get("ADMIN_DEFAULT_PASSWORD", "admin123")
    display_name = os.environ.get("ADMIN_DEFAULT_NAME", "Main Admin")
    existing = connection.execute("SELECT COUNT(*) FROM admin_users").fetchone()[0]
    if existing:
        return
    password_hash, password_salt = hash_password(password)
    connection.execute(
        """
        INSERT INTO admin_users (admin_id, display_name, password_hash, password_salt, role, status)
        VALUES (?, ?, ?, ?, 'admin', 'active')
        """,
        (admin_id, display_name, password_hash, password_salt),
    )


def public_admin(row):
    if not row:
        return None
    return {
        "adminId": row["admin_id"],
        "displayName": row["display_name"] or row["admin_id"],
        "role": row["role"],
        "status": row["status"],
    }


def login(connection, payload):
    admin_id = str(payload.get("adminId") or payload.get("admin_id") or "").strip()
    password = str(payload.get("password") or "")
    if not admin_id or not password:
        return {"ok": False, "error": "Admin ID and password are required."}
    row = connection.execute(
        "SELECT * FROM admin_users WHERE admin_id=?",
        (admin_id,),
    ).fetchone()
    if not row or row["status"] != "active" or not verify_password(password, row["password_hash"], row["password_salt"]):
        return {"ok": False, "error": "Admin ID or password is incorrect."}
    session_id = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(hours=SESSION_HOURS)
    connection.execute(
        "INSERT INTO admin_sessions (session_id, admin_id, expires_at) VALUES (?, ?, ?)",
        (session_id, admin_id, iso(expires_at)),
    )
    connection.execute(
        "UPDATE admin_users SET last_login_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE admin_id=?",
        (admin_id,),
    )
    return {
        "ok": True,
        "admin": public_admin(row),
        "session": {
            "token": session_id,
            "maxAge": SESSION_HOURS * 60 * 60,
            "expiresAt": iso(expires_at),
        },
    }


def session(connection, payload):
    token = str(payload.get("token") or "").strip()
    if not token:
        return {"ok": False, "error": "No admin session."}
    row = connection.execute(
        """
        SELECT s.session_id, s.expires_at, u.*
        FROM admin_sessions s
        JOIN admin_users u ON u.admin_id = s.admin_id
        WHERE s.session_id=?
        """,
        (token,),
    ).fetchone()
    if not row or row["status"] != "active":
        return {"ok": False, "error": "Admin session is invalid."}
    try:
        expires_at = datetime.fromisoformat(row["expires_at"])
    except ValueError:
        expires_at = utc_now() - timedelta(seconds=1)
    if expires_at <= utc_now():
        connection.execute("DELETE FROM admin_sessions WHERE session_id=?", (token,))
        return {"ok": False, "error": "Admin session has expired."}
    connection.execute("UPDATE admin_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE session_id=?", (token,))
    return {"ok": True, "admin": public_admin(row), "expiresAt": row["expires_at"]}


def logout(connection, payload):
    token = str(payload.get("token") or "").strip()
    if token:
        connection.execute("DELETE FROM admin_sessions WHERE session_id=?", (token,))
    return {"ok": True}


def create_admin(connection, payload):
    admin_id = str(payload.get("adminId") or payload.get("admin_id") or "").strip()
    display_name = str(payload.get("displayName") or payload.get("display_name") or "").strip()
    password = str(payload.get("password") or "")
    role = str(payload.get("role") or "admin").strip() or "admin"
    status = "active" if str(payload.get("status") or "active").strip() != "disabled" else "disabled"
    if not admin_id:
        return {"ok": False, "error": "Admin ID is required."}
    if len(password) < 6:
        return {"ok": False, "error": "Password must be at least 6 characters."}
    exists = connection.execute("SELECT 1 FROM admin_users WHERE admin_id=?", (admin_id,)).fetchone()
    if exists:
        return {"ok": False, "error": "This Admin ID already exists."}
    password_hash, password_salt = hash_password(password)
    connection.execute(
        """
        INSERT INTO admin_users (admin_id, display_name, password_hash, password_salt, role, status)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (admin_id, display_name or admin_id, password_hash, password_salt, role, status),
    )
    row = connection.execute("SELECT * FROM admin_users WHERE admin_id=?", (admin_id,)).fetchone()
    return {"ok": True, "admin": public_admin(row)}


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    action = payload.get("action") or "session"
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        ensure_admin_schema(connection)
        ensure_default_admin(connection)
        if action == "login":
            result = login(connection, payload)
        elif action == "create_admin":
            result = create_admin(connection, payload)
        elif action == "logout":
            result = logout(connection, payload)
        elif action == "ensure":
            result = {"ok": True}
        else:
            result = session(connection, payload)
        connection.commit()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise
