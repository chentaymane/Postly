-- Social account connections established via the dashboard OAuth flow.
-- Applied on fresh Postgres boot; for an existing DB, run this manually.
\connect postly

CREATE TABLE IF NOT EXISTS social_connections (
    id               BIGSERIAL PRIMARY KEY,
    platform         TEXT NOT NULL,              -- pinterest | facebook | instagram | x | linkedin | tiktok
    account_name     TEXT,                       -- human-readable handle/username
    account_id       TEXT,                       -- platform's account/user id
    access_token     TEXT NOT NULL,
    refresh_token    TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes           TEXT,
    -- Platform-specific config: Pinterest board_id/boards, FB page_id, IG business id, etc.
    extra            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status           TEXT NOT NULL DEFAULT 'connected',   -- connected | expired | revoked
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One connection per (platform, account). Re-connecting the same account updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_connections_platform_account
    ON social_connections (platform, account_id);

CREATE INDEX IF NOT EXISTS idx_social_connections_platform
    ON social_connections (platform);
