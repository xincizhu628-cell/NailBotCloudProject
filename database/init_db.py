import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "nail_studio.db"
SCHEMA_PATH = ROOT / "database" / "schema.sql"


def insert_many(connection, table, rows):
    if not rows:
        return
    columns = list(rows[0].keys())
    placeholders = ", ".join("?" for _ in columns)
    column_sql = ", ".join(columns)
    values = [tuple(row.get(column) for column in columns) for row in rows]
    connection.executemany(
        f"INSERT OR IGNORE INTO {table} ({column_sql}) VALUES ({placeholders})",
        values,
    )


def add_column_if_missing(connection, table, column, definition):
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def migrate_existing_database(connection):
    template_columns = {
        "template_name": "TEXT",
        "template_title": "TEXT",
        "description": "TEXT",
        "shape_categories": "TEXT",
        "style_categories": "TEXT",
        "material_categories": "TEXT",
        "topic_tags": "TEXT",
        "event_id": "TEXT",
        "author_display_name": "TEXT",
        "author_avatar_asset_id": "TEXT",
        "author_level": "TEXT",
        "heat_count": "INTEGER NOT NULL DEFAULT 0",
        "published_at": "TEXT",
    }
    for column, definition in template_columns.items():
        add_column_if_missing(connection, "templates", column, definition)


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    migrate_existing_database(connection)

    insert_many(connection, "users", [
        {
            "user_id": "user_demo_001",
            "username": "NailMuse_0826",
            "phone": "+61 400 888 266",
            "age": 26,
            "gender": "female",
        }
    ])

    insert_many(connection, "addresses", [
        {
            "address_id": "addr_demo_001",
            "user_id": "user_demo_001",
            "receiver_name": "Annie Chen",
            "phone": "+61 400 888 266",
            "country": "Australia",
            "state": "VIC",
            "city": "Box Hill",
            "street": "88 Sample Street",
            "postcode": "3128",
            "delivery_note": "Leave at reception if nobody answers.",
            "is_default": 1,
        }
    ])

    insert_many(connection, "members", [
        {
            "member_id": "member_demo_001",
            "user_id": "user_demo_001",
            "tier": "Aurora Member",
            "level": 7,
            "title": "Aurora Creator",
            "points_balance": 8420,
        }
    ])

    insert_many(connection, "achievements", [
        {
            "achievement_id": "achieve_heat_5m",
            "achievement_name": "5M Total Social Heat",
            "reward_type": "points",
            "reward_ref_id": "600",
            "condition_type": "social_heat_total",
            "condition_value": "5000000",
            "description": "Reached 5M total social heat across campaigns.",
        },
        {
            "achievement_id": "achieve_mission_100",
            "achievement_name": "Mission Master",
            "reward_type": "coupon",
            "reward_ref_id": "coupon_print_8",
            "condition_type": "task_completed_count",
            "condition_value": "100",
            "description": "Completed 100 member missions.",
        },
    ])

    insert_many(connection, "member_achievements", [
        {
            "member_achievement_id": "member_achieve_demo_001",
            "member_id": "member_demo_001",
            "achievement_id": "achieve_heat_5m",
            "is_rewarded": 1,
        }
    ])

    insert_many(connection, "events", [
        {
            "event_id": "event_aurora_week",
            "event_type": "design_campaign",
            "event_name": "Aurora Creator Week",
            "event_title": "Aurora Creator Week",
            "event_content": "High reward design uploads for AI manicure creators.",
            "start_at": "2026-07-02",
            "expires_at": "2026-07-09",
            "status": "active",
            "sort_order": 1,
        },
        {
            "event_id": "event_cat_eye_launch",
            "event_type": "social_campaign",
            "event_name": "Magnetic Cat Eye Launch",
            "event_title": "Magnetic Cat Eye Launch",
            "event_content": "Social heat bonus tasks for cat-eye nail content.",
            "start_at": "2026-07-01",
            "expires_at": "2026-07-08",
            "status": "active",
            "sort_order": 2,
        },
    ])

    insert_many(connection, "styles", [
        {"style_id": "style_elegant", "style": "Elegant", "status": "on"},
        {"style_id": "style_minimal", "style": "Minimal", "status": "on"},
        {"style_id": "style_tech", "style": "Technology", "status": "on"},
        {"style_id": "style_future", "style": "Futuristic", "status": "on"},
        {"style_id": "style_sweet", "style": "Sweet", "status": "on"},
        {"style_id": "style_chrome", "style": "Chrome", "status": "on"},
    ])

    insert_many(connection, "shapes", [
        {"shape_id": "shape_long_oval", "shape": "Long Oval", "status": "on"},
        {"shape_id": "shape_short_oval", "shape": "Short Oval", "status": "on"},
        {"shape_id": "shape_short_square", "shape": "Short Square", "status": "on"},
        {"shape_id": "shape_medium_square", "shape": "Medium Square", "status": "on"},
        {"shape_id": "shape_squoval", "shape": "Squoval", "status": "on"},
        {"shape_id": "shape_short_round", "shape": "Short Round", "status": "on"},
        {"shape_id": "shape_almond", "shape": "Almond", "status": "on"},
        {"shape_id": "shape_medium_almond", "shape": "Medium Almond", "status": "on"},
        {"shape_id": "shape_short_almond", "shape": "Short Almond", "status": "on"},
    ])

    insert_many(connection, "materials", [
        {"material_id": "m123", "material": "123 White Nail", "image": "assets/materials/material-123.png", "status": "on"},
        {"material_id": "m124", "material": "124 Regular Cat Eye", "image": "assets/materials/material-124-cateye.png", "status": "on"},
        {"material_id": "m125", "material": "125 Gilded Nail", "image": "assets/materials/material-125-gilded.png", "status": "on"},
        {"material_id": "m126", "material": "126 Rhinestone Nail", "image": "assets/materials/material-126-rhinestone.png", "status": "on"},
        {"material_id": "m127", "material": "127 Cat Eye Nail", "image": "assets/materials/material-127-cateye.png", "status": "on"},
        {"material_id": "m128", "material": "128 Gilded Nail", "image": "assets/materials/material-128-gilded.png", "status": "on"},
        {"material_id": "m130", "material": "130 Rhinestone Cat Eye", "image": "assets/materials/material-130-rhinestone-cateye.png", "status": "on"},
    ])

    insert_many(connection, "tags", [
        {"tag_id": "tag_ai_design", "tag": "AI Design", "created_by_type": "admin", "status": "on"},
        {"tag_id": "tag_aurora", "tag": "Aurora", "created_by_type": "admin", "status": "on"},
        {"tag_id": "tag_printable", "tag": "Printable", "created_by_type": "admin", "status": "on"},
    ])

    insert_many(connection, "topics", [
        {"topic_id": "topic_ai_design", "topic": "AI Design", "status": "on"},
        {"topic_id": "topic_community_upload", "topic": "Community Upload", "status": "on"},
        {"topic_id": "topic_aurora_week", "topic": "Aurora Creator Week", "status": "on"},
    ])

    insert_many(connection, "tasks", [
        {
            "task_id": "task_aurora_upload",
            "event_id": "event_aurora_week",
            "task_type": "design_upload",
            "task_name": "Aurora Pink Pattern Upload",
            "task_title": "Upload a soft pink AI manicure pattern",
            "task_content": "Upload a printable nail pattern or accessory icon for the July creator shelf.",
            "submission_type": "file",
            "allowed_platforms": "rednote,Instagram",
            "reward_points": 300,
            "start_at": "2026-07-02",
            "expires_at": "2026-07-06",
            "status": "active",
        },
        {
            "task_id": "task_cat_eye_caption",
            "event_id": "event_cat_eye_launch",
            "task_type": "social_caption",
            "task_name": "TikTok Cat Eye Caption Push",
            "task_title": "Write cat-eye launch social copy",
            "task_content": "Submit one engaging caption for cat-eye press-on nail content.",
            "submission_type": "text",
            "allowed_platforms": "tiktok,Kuaishou",
            "reward_points": 180,
            "start_at": "2026-07-01",
            "expires_at": "2026-07-04",
            "status": "active",
        },
    ])

    insert_many(connection, "coupons", [
        {
            "coupon_id": "coupon_print_8",
            "coupon_name": "$8 Print Coupon",
            "coupon_type": "fixed_discount",
            "discount_type": "fixed",
            "discount_value": 8,
            "min_spend": 0,
            "expiry_date": "2026-09-15",
            "use_with_other_coupon": 0,
            "status": "active",
        },
        {
            "coupon_id": "coupon_pink_future_15",
            "coupon_name": "Pink Future 15% Off",
            "coupon_type": "percentage_discount",
            "discount_type": "percentage",
            "discount_value": 15,
            "min_spend": 0,
            "expiry_date": "2026-08-31",
            "use_with_other_coupon": 0,
            "status": "active",
        },
    ])

    insert_many(connection, "rewards", [
        {
            "reward_id": "reward_aurora_pattern",
            "reward_name": "Limited Aurora Pattern",
            "reward_type": "digital_template",
            "unit_point_cost": 900,
            "reward_info": "Unlock a limited Aurora nail pattern.",
            "on_delivery": 0,
            "stock_quantity": 999,
        },
        {
            "reward_id": "reward_salon_kit",
            "reward_name": "Salon Care Kit",
            "reward_type": "physical_goods",
            "unit_point_cost": 2400,
            "reward_info": "A sample salon care kit for member redemption.",
            "on_delivery": 1,
            "stock_quantity": 24,
        },
    ])

    insert_many(connection, "member_awards", [
        {
            "member_award_id": "award_demo_coupon_001",
            "gain_type": "Coupon",
            "member_id": "member_demo_001",
            "coupon_id": "coupon_pink_future_15",
            "quantity": 1,
            "is_applied": 0,
        }
    ])

    insert_many(connection, "promotion", [
        {
            "promo_id": "promo_demo_threshold_001",
            "promo_title": "Member welcome $12 off",
            "promo_type": "满减优惠",
            "promo_content": '{"type":"满减优惠","min_spend":80,"amount_off":12,"summary":"满 80 减 12"}',
            "expire_date": "2026-09-30",
            "status": "active",
        },
        {
            "promo_id": "promo_demo_percent_001",
            "promo_title": "AI NailBot 15% off",
            "promo_type": "折扣优惠",
            "promo_content": '{"type":"折扣优惠","discount_percent":15,"summary":"15% OFF"}',
            "expire_date": "2026-08-31",
            "status": "active",
        },
    ])

    insert_many(connection, "user_promo", [
        {
            "user_promo_id": "userpromo_demo_threshold_001",
            "promo_id": "promo_demo_threshold_001",
            "user_id": "user_demo_001",
            "status": "unused",
        },
        {
            "user_promo_id": "userpromo_demo_percent_001",
            "promo_id": "promo_demo_percent_001",
            "user_id": "user_demo_001",
            "status": "unused",
        },
    ])

    insert_many(connection, "point_transactions", [
        {
            "transaction_id": "point_demo_001",
            "member_id": "member_demo_001",
            "source_type": "achievement",
            "source_id": "achieve_heat_5m",
            "points_change": 600,
            "balance_after": 8420,
        }
    ])

    insert_many(connection, "products", [
        {
            "product_id": "P-1001",
            "product_type": "press_on_nail",
            "product_name": "Aurora Pink Almond Set",
            "unit_price": 39,
            "product_info": "A glossy almond set with soft aurora shimmer.",
            "style_tags": "aurora,pink,almond,gloss",
            "nail_shape": "almond",
            "stock_quantity": 28,
            "on_delivery": 1,
        },
        {
            "product_id": "P-1002",
            "product_type": "press_on_nail",
            "product_name": "Milky French Long Oval",
            "unit_price": 42,
            "product_info": "Clean long oval French tips with a translucent milky base.",
            "style_tags": "french,white,long oval,bridal",
            "nail_shape": "long-oval",
            "stock_quantity": 18,
            "on_delivery": 1,
        },
    ])

    insert_many(connection, "devices", [
        {"device_id": "device_boxhill_1", "device_name": "Boxhill1", "location": "Box Hill", "status": "online"},
        {"device_id": "device_boxhill_2", "device_name": "Boxhill2", "location": "Box Hill", "status": "online"},
        {"device_id": "device_chadstone_maita", "device_name": "Chadstone Maita", "location": "Chadstone", "status": "offline"},
        {"device_id": "device_dfo_south_wharf", "device_name": "DFO South Wharf", "location": "South Wharf", "status": "offline"},
    ])

    insert_many(connection, "personal_galleries", [
        {
            "personal_gallery_id": "pgallery_demo_001",
            "user_id": "user_demo_001",
            "gallery_name": "Personal Gallery",
        }
    ])

    insert_many(connection, "official_galleries", [
        {
            "official_gallery_id": "ogallery_factory_001",
            "gallery_name": "Official Factory Gallery",
            "description": "Imported official printable nail templates from the manufacturer backend.",
            "sort_order": 1,
            "status": "active",
        },
        {
            "official_gallery_id": "ogallery_ai_featured_001",
            "gallery_name": "Official AI Featured Gallery",
            "description": "Curated official AI nail-art designs and seasonal featured templates.",
            "sort_order": 2,
            "status": "active",
        },
    ])

    insert_many(connection, "community_galleries", [
        {
            "community_gallery_id": "cgallery_public_001",
            "gallery_name": "Community Gallery",
            "description": "Public user-submitted nail templates.",
        }
    ])

    insert_many(connection, "templates", [
        {
            "template_id": "template_official_pearl_circuit",
            "author_user_id": "user_demo_001",
            "source_type": "official",
            "template_name": "Pearl Circuit",
            "template_title": "Pearl Circuit Long Oval",
            "description": "A soft pearl circuit nail template for futuristic salon printing.",
            "template_type": "design",
            "design_type": "nail",
            "nail_shape": "long-oval",
            "material_type": "m123",
            "shape_categories": "long-oval",
            "style_categories": "tech,elegant,minimal",
            "material_categories": "white-nail",
            "topic_tags": "AI Design,Aurora",
            "tags": "pearl,circuit,pink,printable",
            "event_id": "event_aurora_week",
            "author_display_name": "Nail Art Yihe",
            "author_level": "Official",
            "visibility": "public",
            "status": "active",
            "view_count": 1280,
            "heat_count": 4200,
            "like_count": 218,
            "favorite_count": 86,
            "comment_count": 32,
            "published_at": "2026-07-01",
        },
        {
            "template_id": "template_community_cloud_ribbon",
            "author_user_id": "user_demo_001",
            "source_type": "community",
            "template_name": "Cloud Ribbon",
            "template_title": "Cloud Ribbon Squoval",
            "description": "Community uploaded ribbon-style printable nail design.",
            "template_type": "design",
            "design_type": "nail",
            "nail_shape": "squoval",
            "material_type": "m125",
            "shape_categories": "squoval",
            "style_categories": "sweet,elegant",
            "material_categories": "cat-eye,gold",
            "topic_tags": "Community Upload",
            "tags": "cloud,ribbon,pink",
            "event_id": "event_aurora_week",
            "author_display_name": "NailMuse_0826",
            "author_level": "Aurora Creator",
            "visibility": "public",
            "status": "active",
            "view_count": 640,
            "heat_count": 1560,
            "like_count": 88,
            "favorite_count": 41,
            "comment_count": 11,
            "published_at": "2026-07-02",
        },
        {
            "template_id": "template_personal_auto_draft",
            "author_user_id": "user_demo_001",
            "source_type": "personal",
            "template_name": "Auto Saved Draft",
            "template_title": "Auto Saved Draft",
            "description": "The fixed first personal template draft from the design canvas.",
            "template_type": "draft",
            "design_type": "nail",
            "nail_shape": "long-oval",
            "material_type": "m123",
            "shape_categories": "long-oval",
            "style_categories": "personal,draft",
            "material_categories": "white-nail",
            "topic_tags": "Personal Draft",
            "tags": "draft,personal",
            "author_display_name": "NailMuse_0826",
            "author_level": "Personal draft",
            "visibility": "private",
            "status": "active",
            "view_count": 0,
            "heat_count": 0,
            "like_count": 0,
            "favorite_count": 0,
            "comment_count": 0,
            "published_at": "2026-07-03",
        },
    ])

    insert_many(connection, "gallery_templates", [
        {
            "gallery_template_id": "gt_official_pearl_circuit",
            "gallery_type": "official",
            "gallery_id": "ogallery_factory_001",
            "template_id": "template_official_pearl_circuit",
            "sort_order": 1,
        },
        {
            "gallery_template_id": "gt_community_cloud_ribbon",
            "gallery_type": "community",
            "gallery_id": "cgallery_public_001",
            "template_id": "template_community_cloud_ribbon",
            "user_id": "user_demo_001",
            "sort_order": 1,
        },
        {
            "gallery_template_id": "gt_personal_auto_draft",
            "gallery_type": "personal",
            "gallery_id": "pgallery_demo_001",
            "template_id": "template_personal_auto_draft",
            "user_id": "user_demo_001",
            "sort_order": 0,
        },
    ])

    insert_many(connection, "taxonomy_links", [
        {"taxonomy_link_id": "tl_template_pearl_style_elegant", "taxonomy_type": "styles", "taxonomy_id": "style_elegant", "target_type": "template", "target_id": "template_official_pearl_circuit"},
        {"taxonomy_link_id": "tl_template_pearl_style_tech", "taxonomy_type": "styles", "taxonomy_id": "style_tech", "target_type": "template", "target_id": "template_official_pearl_circuit"},
        {"taxonomy_link_id": "tl_template_pearl_shape_long_oval", "taxonomy_type": "shapes", "taxonomy_id": "shape_long_oval", "target_type": "template", "target_id": "template_official_pearl_circuit"},
        {"taxonomy_link_id": "tl_template_pearl_material_m123", "taxonomy_type": "materials", "taxonomy_id": "m123", "target_type": "template", "target_id": "template_official_pearl_circuit"},
        {"taxonomy_link_id": "tl_template_pearl_tag_ai_design", "taxonomy_type": "tags", "taxonomy_id": "tag_ai_design", "target_type": "template", "target_id": "template_official_pearl_circuit"},
        {"taxonomy_link_id": "tl_template_pearl_topic_ai_design", "taxonomy_type": "topics", "taxonomy_id": "topic_ai_design", "target_type": "template", "target_id": "template_official_pearl_circuit"},
        {"taxonomy_link_id": "tl_product_1001_shape_almond", "taxonomy_type": "shapes", "taxonomy_id": "shape_almond", "target_type": "product", "target_id": "P-1001"},
        {"taxonomy_link_id": "tl_product_1001_style_chrome", "taxonomy_type": "styles", "taxonomy_id": "style_chrome", "target_type": "product", "target_id": "P-1001"},
        {"taxonomy_link_id": "tl_event_aurora_topic", "taxonomy_type": "topics", "taxonomy_id": "topic_aurora_week", "target_type": "event", "target_id": "event_aurora_week"},
        {"taxonomy_link_id": "tl_task_aurora_tag_printable", "taxonomy_type": "tags", "taxonomy_id": "tag_printable", "target_type": "task", "target_id": "task_aurora_upload"},
    ])

    connection.commit()
    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    print(f"Database ready: {DB_PATH}")
    print(f"Tables: {len(tables)}")
    for (name,) in tables:
        count = connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        print(f"- {name}: {count}")
    connection.close()


if __name__ == "__main__":
    main()
