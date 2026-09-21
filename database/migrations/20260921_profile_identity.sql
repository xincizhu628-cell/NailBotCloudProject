ALTER TABLE users ADD COLUMN IF NOT EXISTS public_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_public_user_id_unique_ci ON users (lower(public_user_id)) WHERE public_user_id IS NOT NULL;
