-- Postly schema. Idempotent — safe to run repeatedly.
-- Applied with: npm run db:setup   (targets DATABASE_URL, e.g. Neon)

-- Application users (multi-tenant: every connection and post belongs to one).
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness so Foo@x.com and foo@x.com are the same account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS post_logs (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    run_id          UUID,
    platform        TEXT NOT NULL,
    status          TEXT NOT NULL,
    post_id         TEXT,
    error_message   TEXT,
    theme           TEXT,
    product_name    TEXT,
    tone            TEXT,
    caption         TEXT,
    hashtags        TEXT,
    cta             TEXT,
    image_url       TEXT,
    destination_url TEXT,
    raw_request     JSONB,
    raw_response    JSONB
);

CREATE INDEX IF NOT EXISTS idx_post_logs_run_id   ON post_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_post_logs_platform ON post_logs (platform);
CREATE INDEX IF NOT EXISTS idx_post_logs_status   ON post_logs (status);
CREATE INDEX IF NOT EXISTS idx_post_logs_created  ON post_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS social_connections (
    id               BIGSERIAL PRIMARY KEY,
    platform         TEXT NOT NULL,
    account_name     TEXT,
    account_id       TEXT,
    access_token     TEXT NOT NULL,
    refresh_token    TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes           TEXT,
    extra            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status           TEXT NOT NULL DEFAULT 'connected',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_connections_platform
    ON social_connections (platform);

-- ---------------------------------------------------------------------------
-- Multi-tenancy: scope connections and logs to a user.
-- Written as idempotent ALTERs so existing databases upgrade in place.
-- ---------------------------------------------------------------------------

ALTER TABLE social_connections
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE post_logs
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

-- Uniqueness is per user: two users may each connect the same platform account.
DROP INDEX IF EXISTS uq_social_connections_platform_account;
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_conn_user_platform_account
    ON social_connections (user_id, platform, account_id);

CREATE INDEX IF NOT EXISTS idx_social_connections_user ON social_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_post_logs_user ON post_logs (user_id);

-- ---------------------------------------------------------------------------
-- Aggregator support (SocialAPI.ai): connections made through the aggregator
-- store its account id instead of a platform token.
-- ---------------------------------------------------------------------------

ALTER TABLE social_connections
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'direct';  -- direct | socialapi
ALTER TABLE social_connections
    ALTER COLUMN access_token DROP NOT NULL;
