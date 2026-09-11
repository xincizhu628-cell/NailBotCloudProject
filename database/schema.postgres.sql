-- NailBot PostgreSQL/Supabase first-pass schema.
-- Generated from database/schema.sql.
-- This import schema omits foreign keys on purpose. Create strict foreign keys
-- after data import once SQLite/Postgres type differences are cleaned up.

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  user_kind TEXT NOT NULL DEFAULT 'guest',
  recovery_code TEXT UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  auth_status TEXT NOT NULL DEFAULT 'active',
  email TEXT,
  phone TEXT,
  age INTEGER,
  gender TEXT,
  avatar_asset_id TEXT,
  default_address_id TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now(),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS user_auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  login_at TEXT NOT NULL DEFAULT now(),
  login_date TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS auth_verification_codes (
  verification_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_users (
  admin_id TEXT PRIMARY KEY,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now(),
  last_seen_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  address_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  receiver_name TEXT,
  phone TEXT,
  country TEXT,
  state TEXT,
  city TEXT,
  street TEXT,
  postcode TEXT,
  delivery_note TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS third_party_accounts (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_user_id TEXT,
  username TEXT,
  access_status TEXT NOT NULL DEFAULT 'linked',
  linked_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'Aurora Member',
  level INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS achievements (
  achievement_id TEXT PRIMARY KEY,
  achievement_name TEXT NOT NULL,
  reward_type TEXT,
  reward_ref_id TEXT,
  achievement_image_asset_id TEXT,
  condition_type TEXT,
  condition_value TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_achievements (
  member_achievement_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  gained_at TEXT NOT NULL DEFAULT now(),
  is_rewarded INTEGER NOT NULL DEFAULT 0,
  rewarded_at TEXT,
  UNIQUE(member_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  asset_type TEXT NOT NULL,
  mime_type TEXT,
  url TEXT,
  base64_data TEXT,
  sha256 TEXT UNIQUE,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotional_assets (
  promo_asset_id BIGSERIAL PRIMARY KEY,
  image_url TEXT,
  image_base64 TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_sha256
ON assets(sha256)
WHERE sha256 IS NOT NULL AND sha256 <> '';

CREATE TABLE IF NOT EXISTS articles (
  article_id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL,
  article_type TEXT,
  title TEXT NOT NULL,
  content TEXT,
  related_topics TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  heat_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS styles (
  style_id BIGSERIAL PRIMARY KEY,
  style TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'on',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shapes (
  shape_id BIGSERIAL PRIMARY KEY,
  shape TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'on',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  material_id BIGSERIAL PRIMARY KEY,
  material TEXT NOT NULL UNIQUE,
  image TEXT,
  status TEXT NOT NULL DEFAULT 'on',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  tag_id BIGSERIAL PRIMARY KEY,
  tag TEXT NOT NULL UNIQUE,
  viewed_number INTEGER NOT NULL DEFAULT 0,
  attendance_number INTEGER NOT NULL DEFAULT 0,
  created_by_type TEXT NOT NULL DEFAULT 'admin',
  created_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'on',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  topic_id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT now(),
  view_number INTEGER NOT NULL DEFAULT 0,
  attendance_number INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'on'
);

CREATE TABLE IF NOT EXISTS taxonomy_links (
  taxonomy_link_id BIGSERIAL PRIMARY KEY,
  taxonomy_type TEXT NOT NULL,
  taxonomy_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now(),
  UNIQUE(taxonomy_type, taxonomy_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS templates (
  template_id TEXT PRIMARY KEY,
  author_user_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'official',
  template_name TEXT,
  template_title TEXT,
  description TEXT,
  template_type TEXT NOT NULL DEFAULT 'nail',
  design_type TEXT NOT NULL DEFAULT 'nail',
  nail_shape TEXT,
  material_type TEXT,
  shape_categories TEXT,
  style_categories TEXT,
  material_categories TEXT,
  topic_tags TEXT,
  tags TEXT,
  event_id BIGINT,
  template_object_json TEXT,
  cover_asset_id TEXT,
  image_asset_id TEXT,
  image_asset_ids TEXT,
  author_display_name TEXT,
  author_avatar_asset_id TEXT,
  author_level TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'active',
  view_count INTEGER NOT NULL DEFAULT 0,
  heat_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  favorite_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personal_galleries (
  personal_gallery_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  gallery_name TEXT NOT NULL DEFAULT 'Personal Gallery',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS official_galleries (
  official_gallery_id TEXT PRIMARY KEY,
  gallery_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_galleries (
  community_gallery_id TEXT PRIMARY KEY,
  gallery_name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gallery_templates (
  gallery_template_id TEXT PRIMARY KEY,
  gallery_type TEXT NOT NULL,
  gallery_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  user_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT now(),
  UNIQUE(gallery_type, gallery_id, template_id)
);

CREATE TABLE IF NOT EXISTS draft_cache (
  draft_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  draft_type TEXT NOT NULL DEFAULT 'design_canvas',
  draft_content_json TEXT NOT NULL,
  preview_asset_id TEXT,
  saved_at TEXT NOT NULL DEFAULT now(),
  is_auto_draft INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  event_id BIGSERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_interaction_events (
  event_id BIGSERIAL PRIMARY KEY,
  community_action_type TEXT,
  target_area TEXT,
  min_actions INTEGER NOT NULL DEFAULT 0,
  reward_points INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT
);

CREATE TABLE IF NOT EXISTS external_social_events (
  event_id BIGSERIAL PRIMARY KEY,
  platforms TEXT,
  post_requirements TEXT,
  hashtags TEXT,
  reward_points INTEGER NOT NULL DEFAULT 0,
  tracking_rule TEXT
);

CREATE TABLE IF NOT EXISTS design_collection_events (
  event_id BIGSERIAL PRIMARY KEY,
  design_brief TEXT,
  required_shape TEXT,
  required_style TEXT,
  submission_limit INTEGER NOT NULL DEFAULT 1,
  reward_points INTEGER NOT NULL DEFAULT 0,
  judge_rule TEXT
);

CREATE TABLE IF NOT EXISTS promotion_discount_events (
  event_id BIGSERIAL PRIMARY KEY,
  promo_scope TEXT NOT NULL DEFAULT 'all_products',
  target_product_ids TEXT,
  discount_type TEXT NOT NULL DEFAULT 'percent_off',
  discount_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_spend DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_discount DOUBLE PRECISION,
  stackable INTEGER NOT NULL DEFAULT 0,
  price_rule_json TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id BIGSERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_condition_reward (
  task_id INTEGER NOT NULL,
  sequence_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  reward_type TEXT NOT NULL,
  reward_quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, sequence_id)
);

CREATE TABLE IF NOT EXISTS task_drafts (
  task_draft_id TEXT PRIMARY KEY,
  task_id BIGINT NOT NULL,
  event_id BIGINT,
  user_id TEXT NOT NULL,
  platform TEXT,
  upload_content TEXT,
  content_type TEXT,
  saved_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_submissions (
  submission_id TEXT PRIMARY KEY,
  task_id BIGINT NOT NULL,
  event_id BIGINT,
  user_id TEXT NOT NULL,
  platform TEXT,
  content_type TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by TEXT,
  reward_points INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT now(),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_records (
  task_record_id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  tasktype TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content_upload TEXT,
  upload_at TEXT NOT NULL DEFAULT now(),
  rating_result TEXT NOT NULL DEFAULT 'F',
  status TEXT NOT NULL DEFAULT 'submitted',
  current_reward TEXT,
  CHECK (rating_result IN ('F', 'D', 'C', 'B', 'A', 'S', 'pass', 'fail'))
);

CREATE TABLE IF NOT EXISTS event_participation (
  event_participation_id BIGSERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now(),
  user_id TEXT NOT NULL,
  current_total_earnpoint INTEGER NOT NULL DEFAULT 0,
  current_earned_coupon_number INTEGER NOT NULL DEFAULT 0,
  current_total_earned_template_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  post_id TEXT NOT NULL,
  comment_type TEXT NOT NULL DEFAULT 'primary',
  user_id TEXT NOT NULL,
  commented_at TEXT NOT NULL DEFAULT now(),
  comment_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  CHECK (comment_type IN ('primary', 'secondary')),
  CHECK (status IN ('visible', 'hidden'))
);

CREATE TABLE IF NOT EXISTS coupons (
  coupon_id TEXT PRIMARY KEY,
  coupon_name TEXT NOT NULL,
  coupon_type TEXT NOT NULL,
  coupon_content_json TEXT,
  discount_type TEXT,
  discount_value DOUBLE PRECISION,
  min_spend DOUBLE PRECISION,
  expiry_date TEXT,
  use_with_other_coupon INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion (
  promo_id TEXT PRIMARY KEY,
  promo_title TEXT NOT NULL,
  promo_type TEXT NOT NULL,
  promo_content TEXT,
  expire_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now(),
  CHECK (promo_type IN ('money_off', 'percent_off', 'buy_x_get_y', 'free_product'))
);

CREATE TABLE IF NOT EXISTS user_promo (
  user_promo_id TEXT PRIMARY KEY,
  promo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT now(),
  used_at TEXT,
  status TEXT NOT NULL DEFAULT 'unused',
  UNIQUE(promo_id, user_id)
);

CREATE TABLE IF NOT EXISTS rewards (
  reward_id TEXT PRIMARY KEY,
  reward_name TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  unit_point_cost INTEGER NOT NULL DEFAULT 0,
  reward_info TEXT,
  image_url TEXT,
  image_base64 TEXT,
  bound_device_id TEXT,
  bound_device_ids TEXT,
  device_channel_code TEXT,
  on_delivery INTEGER NOT NULL DEFAULT 0,
  pickup_method TEXT NOT NULL DEFAULT 'pickup',
  is_featured INTEGER NOT NULL DEFAULT 0,
  stock_quantity INTEGER,
  stock_s INTEGER NOT NULL DEFAULT 0,
  stock_m INTEGER NOT NULL DEFAULT 0,
  stock_l INTEGER NOT NULL DEFAULT 0,
  stock_xl INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_awards (
  member_award_id TEXT PRIMARY KEY,
  gain_type TEXT NOT NULL,
  member_id TEXT NOT NULL,
  coupon_id TEXT,
  reward_id TEXT,
  gain_date TEXT NOT NULL DEFAULT now(),
  expiry_date TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  is_applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS point_transactions (
  transaction_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  points_change INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  product_type TEXT,
  product_name TEXT NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  product_info TEXT,
  image_url TEXT,
  image_base64 TEXT,
  style_tags TEXT,
  nail_shape TEXT,
  bound_device_id TEXT,
  cover_asset_id TEXT,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  stock_s INTEGER NOT NULL DEFAULT 0,
  stock_m INTEGER NOT NULL DEFAULT 0,
  stock_l INTEGER NOT NULL DEFAULT 0,
  stock_xl INTEGER NOT NULL DEFAULT 0,
  on_delivery INTEGER NOT NULL DEFAULT 1,
  pickup_method TEXT NOT NULL DEFAULT 'both',
  is_featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  address_id TEXT,
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  pay_method TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  order_get_type TEXT,
  delivery_status TEXT,
  pickup_status TEXT,
  order_status TEXT NOT NULL DEFAULT 'created',
  print_code TEXT CHECK (print_code IS NULL OR print_code ~ '^[0-9]{6}$'),
  pickup_code TEXT NOT NULL DEFAULT '000000' CHECK (pickup_code ~ '^[0-9]+$'),
  created_at TEXT NOT NULL DEFAULT now(),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  order_item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_item_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS reward_orders (
  reward_order_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  address_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  point_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  parent_comment_id TEXT,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_actions (
  action_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now(),
  UNIQUE(user_id, target_type, target_id, action_type)
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  last_online_at TEXT,
  current_task_id TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_info (
  id BIGSERIAL PRIMARY KEY,
  equip_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('main_unit', 'printer')),
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  print_job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  template_id TEXT,
  draft_id TEXT,
  coupon_id TEXT,
  device_id TEXT,
  preview_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  sent_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  ai_job_id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT,
  model TEXT,
  prompt TEXT,
  reference_assets TEXT,
  output_assets TEXT,
  selected_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  error_code TEXT,
  error_message TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_templates_source ON templates(source_type, status);
CREATE INDEX IF NOT EXISTS idx_templates_author ON templates(author_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id, status);
CREATE INDEX IF NOT EXISTS idx_task_submissions_user ON task_submissions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_member_awards_member ON member_awards(member_id, is_applied);
CREATE INDEX IF NOT EXISTS idx_user_actions_target ON user_actions(target_type, target_id, action_type);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_promo_user ON user_promo(user_id, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_device ON print_jobs(device_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_taxonomy_links_target ON taxonomy_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_links_taxonomy ON taxonomy_links(taxonomy_type, taxonomy_id);
