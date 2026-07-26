-- Postly schema. Idempotent — safe to run repeatedly.
-- Applied with: npm run db:setup   (targets DATABASE_URL, e.g. Neon)

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_connections_platform_account
    ON social_connections (platform, account_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_platform
    ON social_connections (platform);
