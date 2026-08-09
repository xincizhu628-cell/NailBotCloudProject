import json
import sqlite3
import sys
import uuid
from pathlib import Path

from admin_db import DB_PATH, ensure_admin_schema
from user_persistence import ensure_user


def read_payload():
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def row_dict(row):
    return {key: row[key] for key in row.keys()} if row else None


def ensure_social_schema(connection):
    ensure_admin_schema(connection)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS comments (
          comment_id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          parent_comment_id TEXT,
          user_id TEXT NOT NULL,
          content TEXT NOT NULL,
          like_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'published',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (parent_comment_id) REFERENCES comments(comment_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS user_actions (
          action_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, target_type, target_id, action_type),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS user_comments (
          comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id TEXT NOT NULL,
          comment_type TEXT NOT NULL DEFAULT 'primary',
          user_id TEXT NOT NULL,
          commented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          comment_content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'visible',
          CHECK (comment_type IN ('primary', 'secondary')),
          CHECK (status IN ('visible', 'hidden')),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )


def template_author(connection, template_id):
    row = connection.execute(
        """
        SELECT
          t.template_id,
          t.author_user_id,
          t.author_display_name,
          t.author_level,
          t.author_avatar_asset_id,
          t.source_type,
          t.like_count,
          t.comment_count,
          u.username,
          u.user_kind,
          u.created_at AS user_created_at,
          m.tier,
          m.level
        FROM templates t
        LEFT JOIN users u ON u.user_id = t.author_user_id
        LEFT JOIN members m ON m.user_id = t.author_user_id
        WHERE t.template_id=?
        """,
        (template_id,),
    ).fetchone()
    if not row:
        return None
    name = row["username"] or row["author_display_name"]
    if not name:
        return None
    level_parts = []
    if row["author_level"]:
        level_parts.append(row["author_level"])
    if row["tier"]:
        level_parts.append(row["tier"])
    if row["level"]:
        level_parts.append(f'Lv.{row["level"]}')
    return {
        "userId": row["author_user_id"] or "",
        "name": name,
        "avatarText": (name or "?")[:2].upper(),
        "meta": " · ".join([item for item in [row["author_user_id"], *level_parts] if item]) or "",
        "sourceType": row["source_type"],
        "likeCount": row["like_count"] or 0,
        "commentCount": row["comment_count"] or 0,
    }


def template_counts(connection, template_id):
    row = connection.execute(
        "SELECT like_count, comment_count FROM templates WHERE template_id=?",
        (template_id,),
    ).fetchone()
    return {
        "likes": row["like_count"] if row else 0,
        "comments": row["comment_count"] if row else 0,
    }


def comment_rows(connection, template_id):
    rows = connection.execute(
        """
        SELECT
          c.comment_id,
          c.parent_comment_id,
          c.user_id,
          c.content,
          c.like_count,
          c.created_at,
          u.username
        FROM comments c
        LEFT JOIN users u ON u.user_id = c.user_id
        WHERE c.target_type='template'
          AND c.target_id=?
          AND c.status='published'
        ORDER BY c.created_at ASC
        """,
        (template_id,),
    ).fetchall()
    comments = []
    by_id = {}
    for row in rows:
        item = {
            "id": row["comment_id"],
            "parentId": row["parent_comment_id"] or "",
            "user": row["username"] or row["user_id"] or "User",
            "userId": row["user_id"],
            "text": row["content"],
            "likes": row["like_count"] or 0,
            "createdAt": row["created_at"],
            "replies": [],
        }
        by_id[item["id"]] = item
        if item["parentId"] and item["parentId"] in by_id:
            by_id[item["parentId"]]["replies"].append(item)
        else:
            comments.append(item)
    return comments


def update_template_comment_count(connection, template_id):
    count = connection.execute(
        """
        SELECT COUNT(*) AS total
        FROM comments
        WHERE target_type='template' AND target_id=? AND status='published'
        """,
        (template_id,),
    ).fetchone()["total"]
    connection.execute("UPDATE templates SET comment_count=?, updated_at=CURRENT_TIMESTAMP WHERE template_id=?", (count, template_id))
    return count


def detail(connection, payload):
    template_id = str(payload.get("templateId") or "").strip()
    if not template_id:
        raise ValueError("templateId is required.")
    author = template_author(connection, template_id)
    comments = comment_rows(connection, template_id)
    counts = template_counts(connection, template_id)
    return {
        "ok": True,
        "templateId": template_id,
        "author": author,
        "comments": comments,
        "counts": {
            "comments": len(flatten_comments(comments)),
            "likes": counts["likes"],
        },
    }


def flatten_comments(comments):
    output = []
    for comment in comments:
        output.append(comment)
        output.extend(flatten_comments(comment.get("replies") or []))
    return output


def active_user(connection, payload):
    return ensure_user(connection, payload.get("userId"), payload.get("recoveryCode"))


def like_template(connection, payload):
    user = active_user(connection, payload)
    template_id = str(payload.get("templateId") or "").strip()
    if not template_id:
        raise ValueError("templateId is required.")
    connection.execute("UPDATE templates SET like_count=COALESCE(like_count, 0)+1, updated_at=CURRENT_TIMESTAMP WHERE template_id=?", (template_id,))
    connection.execute(
        """
        INSERT OR IGNORE INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES (?, ?, 'template', ?, 'like')
        """,
        (f"action_{uuid.uuid4().hex}", user["userId"], template_id),
    )
    count = connection.execute("SELECT like_count FROM templates WHERE template_id=?", (template_id,)).fetchone()
    return {"ok": True, "user": user, "likeCount": count["like_count"] if count else 0}


def add_comment(connection, payload):
    user = active_user(connection, payload)
    template_id = str(payload.get("templateId") or "").strip()
    content = str(payload.get("content") or "").strip()
    parent_id = str(payload.get("parentCommentId") or "").strip()
    if not template_id:
        raise ValueError("templateId is required.")
    if not content:
        raise ValueError("Comment content is required.")
    comment_id = f"comment_{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT INTO comments (comment_id, target_type, target_id, parent_comment_id, user_id, content)
        VALUES (?, 'template', ?, ?, ?, ?)
        """,
        (comment_id, template_id, parent_id or None, user["userId"], content),
    )
    connection.execute(
        """
        INSERT INTO user_comments (post_id, comment_type, user_id, comment_content)
        VALUES (?, ?, ?, ?)
        """,
        (template_id, "secondary" if parent_id else "primary", user["userId"], content),
    )
    comment_count = update_template_comment_count(connection, template_id)
    connection.execute(
        """
        INSERT OR IGNORE INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES (?, ?, 'template', ?, ?)
        """,
        (f"action_{uuid.uuid4().hex}", user["userId"], template_id, "reply" if parent_id else "comment"),
    )
    return {"ok": True, "user": user, "commentId": comment_id, "commentCount": comment_count, "comments": comment_rows(connection, template_id)}


def like_comment(connection, payload):
    user = active_user(connection, payload)
    comment_id = str(payload.get("commentId") or "").strip()
    if not comment_id:
        raise ValueError("commentId is required.")
    connection.execute("UPDATE comments SET like_count=COALESCE(like_count, 0)+1 WHERE comment_id=?", (comment_id,))
    connection.execute(
        """
        INSERT OR IGNORE INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES (?, ?, 'comment', ?, 'like')
        """,
        (f"action_{uuid.uuid4().hex}", user["userId"], comment_id),
    )
    row = connection.execute("SELECT target_id, like_count FROM comments WHERE comment_id=?", (comment_id,)).fetchone()
    return {"ok": True, "user": user, "templateId": row["target_id"] if row else "", "likeCount": row["like_count"] if row else 0}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    payload = read_payload()
    action = str(payload.get("action") or "detail")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
      connection.row_factory = sqlite3.Row
      ensure_social_schema(connection)
      if action == "detail":
          result = detail(connection, payload)
      elif action == "like_template":
          result = like_template(connection, payload)
      elif action == "add_comment":
          result = add_comment(connection, payload)
      elif action == "like_comment":
          result = like_comment(connection, payload)
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
