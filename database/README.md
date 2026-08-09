# Nail Studio Local Database

This folder contains the first local database version for the AI nail website prototype.

## Files

- `schema.sql` defines the SQLite tables.
- `init_db.py` creates `data/nail_studio.db` and inserts starter sample data.

## Rebuild

From the project root:

```powershell
python database/init_db.py
```

If the bundled Codex Python runtime is needed, use the runtime path shown by Codex instead of `python`.

## Current Scope

The schema covers:

- users, members, addresses, third-party accounts
- achievements and member achievement records
- articles, templates, official/community/personal galleries, comments, user actions
- design drafts and assets
- events, tasks, task drafts, task submissions
- coupons, rewards, member awards, point transactions
- products, cart items, orders, order items, reward orders
- devices, print jobs, AI generation jobs

## Template Fields

The `templates` table includes D1 gallery display and filter fields:

- `template_name`, `template_title`, `description`
- `source_type`, `template_type`, `design_type`
- `nail_shape`, `shape_categories`, `style_categories`, `material_type`, `material_categories`
- `topic_tags`, `tags`, `event_id`
- `author_display_name`, `author_avatar_asset_id`, `author_level`
- `view_count`, `heat_count`, `like_count`, `favorite_count`, `comment_count`
- `published_at`, `created_at`, `updated_at`
