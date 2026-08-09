from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "nail_studio.db"
SCHEMA_PATH = ROOT / "database" / "schema.sql"


def table_info(connection, table):
    return {row[1]: {"type": (row[2] or "").upper(), "pk": row[5]} for row in connection.execute(f"PRAGMA table_info({table})")}


def add_column_if_missing(connection, table, column, definition):
    if column not in table_info(connection, table):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


MOJIBAKE_MARKERS = set(
    "\u93c2\u677f\u7c35\u6d93\u5a44\u568e\u9352\u6d98\u7f13\u7ef1\u72b3\u6f57"
    "\u7039\u6a3b\u67df\u9422\u832c\u5896\u95b0\u5d84\u6b22\u9418\u8235\u20ac"
    "\u7ec0\u60e7\u5c2f\u941e\u9357\u72b1\u7d85"
)


def repair_mojibake_text(value):
    if not isinstance(value, str) or not value:
        return value
    if not any(marker in value for marker in MOJIBAKE_MARKERS):
        return value
    try:
        repaired = value.encode("gbk").decode("utf-8")
    except UnicodeError:
        return value
    if repaired and repaired != value:
        return repaired
    return value


def repair_table_text_columns(connection, table, id_column, columns):
    if not table_info(connection, table):
        return
    existing_columns = table_info(connection, table)
    columns = [column for column in columns if column in existing_columns]
    if not columns:
        return
    select_sql = f"SELECT {id_column}, {', '.join(columns)} FROM {table}"
    for row in connection.execute(select_sql).fetchall():
        row_id = row[0]
        updates = {}
        for index, column in enumerate(columns, 1):
            original = row[index]
            repaired = repair_mojibake_text(original)
            if repaired != original:
                updates[column] = repaired
        if updates:
            assignments = ", ".join(f"{column}=?" for column in updates)
            connection.execute(
                f"UPDATE {table} SET {assignments} WHERE {id_column}=?",
                [*updates.values(), row_id],
            )


def create_promotional_assets_table(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS promotional_assets (
          promo_asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_url TEXT,
          image_base64 TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def create_promotion_tables(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS promotion (
          promo_id TEXT PRIMARY KEY,
          promo_title TEXT NOT NULL,
          promo_type TEXT NOT NULL,
          promo_content TEXT,
          expire_date TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (promo_type IN ('满减优惠', '折扣优惠', '买送优惠', '免费商品'))
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS user_promo (
          user_promo_id TEXT PRIMARY KEY,
          promo_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          used_at TEXT,
          status TEXT NOT NULL DEFAULT 'unused',
          UNIQUE(promo_id, user_id),
          FOREIGN KEY (promo_id) REFERENCES promotion(promo_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )


def create_integer_event_task_tables(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT,
          event_name TEXT NOT NULL,
          event_title TEXT,
          event_content TEXT,
          banner_asset_id TEXT,
          promo_asset_id INTEGER,
          html_url TEXT,
          start_at TEXT,
          expires_at TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
          task_id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER,
          task_type TEXT NOT NULL,
          task_name TEXT NOT NULL,
          task_title TEXT,
          task_content TEXT,
          promo_asset_id INTEGER,
          submission_type TEXT NOT NULL DEFAULT 'text',
          allowed_platforms TEXT,
          reward_points INTEGER NOT NULL DEFAULT 0,
          start_at TEXT,
          expires_at TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def is_integer_primary_key(connection, table, column):
    info = table_info(connection, table).get(column)
    return bool(info and info["pk"] and "INT" in info["type"])


def migrate_events_tasks_to_integer_ids(connection):
    if is_integer_primary_key(connection, "events", "event_id") and is_integer_primary_key(connection, "tasks", "task_id"):
        add_column_if_missing(connection, "events", "promo_asset_id", "INTEGER")
        add_column_if_missing(connection, "events", "html_url", "TEXT")
        add_column_if_missing(connection, "tasks", "promo_asset_id", "INTEGER")
        return

    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("DROP INDEX IF EXISTS idx_tasks_event")

    old_events = []
    if table_info(connection, "events"):
        old_events = connection.execute(
            """
            SELECT event_id, event_type, event_name, event_title, event_content,
                   banner_asset_id, start_at, expires_at, status, sort_order, created_at
            FROM events
            ORDER BY created_at, event_name
            """
        ).fetchall()
        connection.execute("ALTER TABLE events RENAME TO events_legacy_text_ids")

    old_tasks = []
    if table_info(connection, "tasks"):
        old_task_columns = table_info(connection, "tasks")
        task_select = """
            SELECT task_id, event_id, task_type, task_name, task_title, task_content,
                   submission_type, allowed_platforms, reward_points, start_at, expires_at, status, created_at
            FROM tasks
            ORDER BY created_at, task_name
        """
        if old_task_columns:
            old_tasks = connection.execute(task_select).fetchall()
            connection.execute("ALTER TABLE tasks RENAME TO tasks_legacy_text_ids")

    create_integer_event_task_tables(connection)

    event_map = {}
    for row in old_events:
        old_id = str(row[0])
        connection.execute(
            """
            INSERT INTO events (
              event_type, event_name, event_title, event_content, banner_asset_id,
              start_at, expires_at, status, sort_order, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row[1:],
        )
        event_map[old_id] = connection.execute("SELECT last_insert_rowid()").fetchone()[0]

    task_map = {}
    for row in old_tasks:
        old_task_id = str(row[0])
        new_event_id = event_map.get(str(row[1])) if row[1] is not None else None
        connection.execute(
            """
            INSERT INTO tasks (
              event_id, task_type, task_name, task_title, task_content,
              submission_type, allowed_platforms, reward_points, start_at, expires_at, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_event_id, *row[2:]),
        )
        task_map[old_task_id] = connection.execute("SELECT last_insert_rowid()").fetchone()[0]

    if table_info(connection, "templates") and event_map:
        for old_id, new_id in event_map.items():
            connection.execute("UPDATE templates SET event_id=? WHERE event_id=?", (new_id, old_id))
    for table in ("task_drafts", "task_submissions"):
        if table_info(connection, table):
            for old_id, new_id in event_map.items():
                connection.execute(f"UPDATE {table} SET event_id=? WHERE event_id=?", (new_id, old_id))
            for old_id, new_id in task_map.items():
                connection.execute(f"UPDATE {table} SET task_id=? WHERE task_id=?", (new_id, old_id))

    connection.execute("DROP TABLE IF EXISTS events_legacy_text_ids")
    connection.execute("DROP TABLE IF EXISTS tasks_legacy_text_ids")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id, status)")
    connection.execute("PRAGMA foreign_keys = ON")


def table_sql_references_legacy_events(connection, table):
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    sql = row[0] if row else ""
    return "events_legacy_text_ids" in sql or "tasks_legacy_text_ids" in sql


def rebuild_task_activity_child_tables(connection):
    if not any(table_sql_references_legacy_events(connection, table) for table in ("task_drafts", "task_submissions")):
        return
    connection.execute("PRAGMA foreign_keys = OFF")

    draft_rows = []
    if table_info(connection, "task_drafts"):
        draft_rows = connection.execute(
            """
            SELECT task_draft_id, task_id, event_id, user_id, platform,
                   upload_content, content_type, saved_at
            FROM task_drafts
            """
        ).fetchall()
        connection.execute("ALTER TABLE task_drafts RENAME TO task_drafts_legacy_fk")

    submission_rows = []
    if table_info(connection, "task_submissions"):
        submission_rows = connection.execute(
            """
            SELECT submission_id, task_id, event_id, user_id, platform, content_type,
                   content, status, reviewed_by, reward_points, submitted_at, reviewed_at
            FROM task_submissions
            """
        ).fetchall()
        connection.execute("ALTER TABLE task_submissions RENAME TO task_submissions_legacy_fk")

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS task_drafts (
          task_draft_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          event_id TEXT,
          user_id TEXT NOT NULL,
          platform TEXT,
          upload_content TEXT,
          content_type TEXT,
          saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (task_id) REFERENCES tasks(task_id),
          FOREIGN KEY (event_id) REFERENCES events(event_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS task_condition_reward (
          task_id INTEGER NOT NULL,
          sequence_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0,
          reward_type TEXT NOT NULL,
          reward_quantity INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (task_id, sequence_id),
          FOREIGN KEY (task_id) REFERENCES tasks(task_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS task_records (
          task_record_id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          tasktype TEXT NOT NULL,
          user_id TEXT NOT NULL,
          content_upload TEXT,
          upload_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          rating_result TEXT NOT NULL DEFAULT 'F',
          status TEXT NOT NULL DEFAULT 'submitted',
          current_reward TEXT,
          CHECK (rating_result IN ('F', 'D', 'C', 'B', 'A', 'S', 'pass', 'fail')),
          FOREIGN KEY (task_id) REFERENCES tasks(task_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS event_participation (
          event_participation_id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          event_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          user_id TEXT NOT NULL,
          current_total_earnpoint INTEGER NOT NULL DEFAULT 0,
          current_earned_coupon_number INTEGER NOT NULL DEFAULT 0,
          current_total_earned_template_number INTEGER NOT NULL DEFAULT 0,
          UNIQUE(event_id, user_id),
          FOREIGN KEY (event_id) REFERENCES events(event_id),
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
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS task_submissions (
          submission_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          event_id TEXT,
          user_id TEXT NOT NULL,
          platform TEXT,
          content_type TEXT NOT NULL,
          content TEXT,
          status TEXT NOT NULL DEFAULT 'submitted',
          reviewed_by TEXT,
          reward_points INTEGER NOT NULL DEFAULT 0,
          submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          FOREIGN KEY (task_id) REFERENCES tasks(task_id),
          FOREIGN KEY (event_id) REFERENCES events(event_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
        """
    )

    for row in draft_rows:
        connection.execute(
            """
            INSERT OR REPLACE INTO task_drafts (
              task_draft_id, task_id, event_id, user_id, platform,
              upload_content, content_type, saved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )
    for row in submission_rows:
        connection.execute(
            """
            INSERT OR REPLACE INTO task_submissions (
              submission_id, task_id, event_id, user_id, platform, content_type,
              content, status, reviewed_by, reward_points, submitted_at, reviewed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )

    connection.execute("DROP TABLE IF EXISTS task_drafts_legacy_fk")
    connection.execute("DROP TABLE IF EXISTS task_submissions_legacy_fk")
    connection.execute("PRAGMA foreign_keys = ON")


def migrate_taxonomy_to_integer_ids(connection):
    specs = {
        "styles": ("style_id", ["style", "status", "created_at", "updated_at"]),
        "shapes": ("shape_id", ["shape", "status", "created_at", "updated_at"]),
        "materials": ("material_id", ["material", "image", "status", "created_at", "updated_at"]),
        "tags": ("tag_id", ["tag", "viewed_number", "attendance_number", "created_by_type", "created_by_user_id", "status", "created_at", "updated_at"]),
        "topics": ("topic_id", ["topic", "created_at", "view_number", "attendance_number", "status"]),
    }
    if all(is_integer_primary_key(connection, table, id_column) for table, (id_column, _) in specs.items()):
        return

    connection.execute("PRAGMA foreign_keys = OFF")
    taxonomy_maps = {}
    for table, (id_column, columns) in specs.items():
        if is_integer_primary_key(connection, table, id_column):
            continue
        existing = table_info(connection, table)
        if not existing:
            continue
        select_columns = [id_column, *columns]
        rows = connection.execute(f"SELECT {', '.join(select_columns)} FROM {table}").fetchall()
        connection.execute(f"ALTER TABLE {table} RENAME TO {table}_legacy_text_ids")
        connection.execute(SCHEMA_PATH.read_text(encoding="utf-8").split(f"CREATE TABLE IF NOT EXISTS {table} (", 1)[1].split(");", 1)[0].join([f"CREATE TABLE {table} (", ");"]))
        taxonomy_maps[table] = {}
        insert_columns = columns
        placeholders = ", ".join("?" for _ in insert_columns)
        for row in rows:
            old_id = str(row[0])
            connection.execute(
                f"INSERT OR IGNORE INTO {table} ({', '.join(insert_columns)}) VALUES ({placeholders})",
                row[1:],
            )
            new_id = connection.execute(f"SELECT {id_column} FROM {table} WHERE {columns[0]}=?", (row[1],)).fetchone()[0]
            taxonomy_maps[table][old_id] = new_id
        connection.execute(f"DROP TABLE IF EXISTS {table}_legacy_text_ids")

    if table_info(connection, "taxonomy_links") and not is_integer_primary_key(connection, "taxonomy_links", "taxonomy_link_id"):
        old_links = connection.execute(
            "SELECT taxonomy_type, taxonomy_id, target_type, target_id, created_at FROM taxonomy_links"
        ).fetchall()
        connection.execute("ALTER TABLE taxonomy_links RENAME TO taxonomy_links_legacy_text_ids")
        connection.execute(
            """
            CREATE TABLE taxonomy_links (
              taxonomy_link_id INTEGER PRIMARY KEY AUTOINCREMENT,
              taxonomy_type TEXT NOT NULL,
              taxonomy_id INTEGER NOT NULL,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(taxonomy_type, taxonomy_id, target_type, target_id)
            )
            """
        )
        for taxonomy_type, taxonomy_id, target_type, target_id, created_at in old_links:
            mapped_id = taxonomy_maps.get(taxonomy_type, {}).get(str(taxonomy_id))
            if mapped_id is None:
                try:
                    mapped_id = int(taxonomy_id)
                except (TypeError, ValueError):
                    continue
            connection.execute(
                """
                INSERT OR IGNORE INTO taxonomy_links (taxonomy_type, taxonomy_id, target_type, target_id, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (taxonomy_type, mapped_id, target_type, target_id, created_at),
            )
        connection.execute("DROP TABLE IF EXISTS taxonomy_links_legacy_text_ids")
    connection.execute("PRAGMA foreign_keys = ON")


def ensure_admin_schema(connection):
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    create_promotional_assets_table(connection)
    create_promotion_tables(connection)
    migrate_taxonomy_to_integer_ids(connection)
    migrate_events_tasks_to_integer_ids(connection)
    rebuild_task_activity_child_tables(connection)
    add_column_if_missing(connection, "events", "promo_asset_id", "INTEGER")
    add_column_if_missing(connection, "events", "html_url", "TEXT")
    add_column_if_missing(connection, "tasks", "promo_asset_id", "INTEGER")
    add_column_if_missing(connection, "users", "user_kind", "TEXT NOT NULL DEFAULT 'guest'")
    add_column_if_missing(connection, "users", "recovery_code", "TEXT")
    add_column_if_missing(connection, "users", "password_hash", "TEXT")
    add_column_if_missing(connection, "users", "password_salt", "TEXT")
    add_column_if_missing(connection, "users", "auth_status", "TEXT NOT NULL DEFAULT 'active'")
    add_column_if_missing(connection, "users", "email", "TEXT")
    add_column_if_missing(connection, "users", "last_seen_at", "TEXT")
    add_column_if_missing(connection, "templates", "image_asset_ids", "TEXT")
    add_column_if_missing(connection, "products", "image_url", "TEXT")
    add_column_if_missing(connection, "products", "image_base64", "TEXT")
    add_column_if_missing(connection, "products", "stock_s", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "products", "stock_m", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "products", "stock_l", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "products", "stock_xl", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "products", "pickup_method", "TEXT NOT NULL DEFAULT 'both'")
    add_column_if_missing(connection, "products", "is_featured", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "rewards", "image_url", "TEXT")
    add_column_if_missing(connection, "rewards", "image_base64", "TEXT")
    add_column_if_missing(connection, "rewards", "stock_s", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "rewards", "stock_m", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "rewards", "stock_l", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "rewards", "stock_xl", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "rewards", "pickup_method", "TEXT NOT NULL DEFAULT 'pickup'")
    add_column_if_missing(connection, "rewards", "is_featured", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(connection, "promotion", "status", "TEXT NOT NULL DEFAULT 'active'")
    add_column_if_missing(connection, "promotion", "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
    add_column_if_missing(connection, "promotion", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
    add_column_if_missing(connection, "user_promo", "assigned_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
    add_column_if_missing(connection, "user_promo", "used_at", "TEXT")
    add_column_if_missing(connection, "user_promo", "status", "TEXT NOT NULL DEFAULT 'unused'")
    repair_table_text_columns(connection, "events", "event_id", ["event_name", "event_title", "event_content"])
    repair_table_text_columns(connection, "tasks", "task_id", ["task_name", "task_title", "task_content", "allowed_platforms"])
    repair_table_text_columns(connection, "products", "product_id", ["product_name", "product_info", "style_tags", "nail_shape"])
    repair_table_text_columns(connection, "rewards", "reward_id", ["reward_name", "reward_info"])
    repair_table_text_columns(connection, "templates", "template_id", ["template_name", "template_title", "description", "topic_tags", "tags"])
    repair_table_text_columns(connection, "styles", "style_id", ["style"])
    repair_table_text_columns(connection, "shapes", "shape_id", ["shape"])
    repair_table_text_columns(connection, "materials", "material_id", ["material"])
    repair_table_text_columns(connection, "tags", "tag_id", ["tag"])
    repair_table_text_columns(connection, "topics", "topic_id", ["topic"])
    repair_table_text_columns(connection, "promotion", "promo_id", ["promo_title", "promo_type", "promo_content"])
    connection.commit()
