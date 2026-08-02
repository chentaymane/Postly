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
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'direct';  -- direct | socialapi | zernio
ALTER TABLE social_connections
    ALTER COLUMN access_token DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Brand profile: the store/product context injected into every AI prompt,
-- plus autopilot settings.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brand_profiles (
    user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    store_name         TEXT,
    store_url          TEXT,
    products           TEXT,      -- what you sell
    audience           TEXT,      -- who buys it
    benefits           TEXT,      -- why they buy it
    default_tone       TEXT,
    auto_enabled       BOOLEAN NOT NULL DEFAULT false,
    auto_posts_per_day INT     NOT NULL DEFAULT 1,
    auto_times         JSONB   NOT NULL DEFAULT '["10:00"]'::jsonb,  -- HH:MM, UTC
    auto_platforms     JSONB   NOT NULL DEFAULT '[]'::jsonb,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Review queue: generated posts wait here as drafts until approved,
-- then are published immediately or scheduled via the aggregators.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS queued_posts (
    id                BIGSERIAL PRIMARY KEY,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform          TEXT NOT NULL,
    -- draft | scheduled | published | failed | unconfirmed
    -- "unconfirmed" means the platform never answered: the post may be live.
    status            TEXT NOT NULL DEFAULT 'draft',
    theme             TEXT,
    tone              TEXT,
    caption           TEXT,
    hashtags          TEXT,
    cta               TEXT,
    pin_title         TEXT,
    pin_description   TEXT,
    image_url         TEXT,
    destination_url   TEXT,
    scheduled_at      TIMESTAMPTZ,
    published_post_id TEXT,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queued_posts_user   ON queued_posts (user_id, status);
CREATE INDEX IF NOT EXISTS idx_queued_posts_status ON queued_posts (status, scheduled_at);

-- ---------------------------------------------------------------------------
-- Post templates: saved form setups the user can reuse on the Create page.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS post_templates (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    theme           TEXT,
    product_name    TEXT,
    description     TEXT,
    tone            TEXT,
    destination_url TEXT,
    platforms       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_templates_user ON post_templates (user_id);

-- Carousel support: all slide URLs (image_url stays = first slide).
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS image_urls JSONB;

-- ---------------------------------------------------------------------------
-- Video posts. The app writes the narrated script and the scene images; the
-- local render worker (worker/) turns them into an MP4 with Piper TTS +
-- FFmpeg and posts the finished URL back.
-- ---------------------------------------------------------------------------

ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'single';  -- single | carousel | video
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS script JSONB;          -- [{ narration, image_prompt, image_url }]
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS video_status TEXT;     -- pending | rendering | ready | failed
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS video_error TEXT;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS render_claimed_at TIMESTAMPTZ;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;

-- The worker's job query: oldest unrendered video first.
CREATE INDEX IF NOT EXISTS idx_queued_posts_render
    ON queued_posts (video_status, render_claimed_at) WHERE format = 'video';

-- ---------------------------------------------------------------------------
-- Automations: named recurring rules. Each one decides what kind of post to
-- make, in which format, for which platforms, at which hours — and whether it
-- schedules straight away or drops drafts into Review for approval.
-- Replaces the single set of auto_* columns on brand_profiles.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS automations (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    post_type       TEXT NOT NULL DEFAULT 'mixed',    -- promo | tips | engage | mixed
    format          TEXT NOT NULL DEFAULT 'single',   -- single | carousel | video
    platforms       JSONB NOT NULL DEFAULT '[]'::jsonb,
    times           JSONB NOT NULL DEFAULT '["10:00"]'::jsonb,  -- HH:MM, UTC
    theme           TEXT,        -- optional; falls back to the brand profile
    tone            TEXT,
    approval        TEXT NOT NULL DEFAULT 'review',   -- review (draft) | auto (schedule)
    last_run_at     TIMESTAMPTZ,
    last_run_status TEXT,        -- ok | partial | failed
    last_run_detail TEXT,
    run_count       INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_user ON automations (user_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations (enabled);

-- Ties every generated post back to the automation that made it.
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS automation_id BIGINT REFERENCES automations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_queued_posts_automation ON queued_posts (automation_id);

-- One-time migration of the old brand_profiles autopilot into an automation.
INSERT INTO automations (user_id, name, enabled, post_type, format, platforms, times, tone, approval)
SELECT bp.user_id, 'Daily autopilot', bp.auto_enabled, 'mixed', 'single',
       bp.auto_platforms, bp.auto_times, bp.default_tone, 'auto'
  FROM brand_profiles bp
 WHERE bp.auto_enabled = true
   AND NOT EXISTS (SELECT 1 FROM automations a WHERE a.user_id = bp.user_id);

-- ---------------------------------------------------------------------------
-- Click tracking. Posts link to /r/<post_id> instead of straight to the store,
-- so every visit is attributed to the exact post and platform that earned it
-- before being redirected on (with UTM tags for the store's own analytics).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS link_clicks (
    id         BIGSERIAL PRIMARY KEY,
    post_id    BIGINT REFERENCES queued_posts(id) ON DELETE CASCADE,
    user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    referrer   TEXT,
    user_agent TEXT,
    country    TEXT
);

CREATE INDEX IF NOT EXISTS idx_link_clicks_user ON link_clicks (user_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_link_clicks_post ON link_clicks (post_id);
CREATE INDEX IF NOT EXISTS idx_link_clicks_platform ON link_clicks (platform);

-- ---------------------------------------------------------------------------
-- Bring-your-own-keys. Postly is multi-tenant, so every user supplies their
-- own provider credentials rather than sharing the operator's. Secrets are
-- sealed with AES-256-GCM (lib/secretbox.js) and never stored in the clear.
--
-- A user may hold SEVERAL keys of the same kind: aggregator free tiers cap
-- connected accounts per key, so adding a second key adds capacity.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_credentials (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,        -- zernio | socialapi | groq | openrouter
    label        TEXT,                 -- user's own name for the key
    secret       TEXT NOT NULL,        -- sealed, never plaintext
    hint         TEXT,                 -- masked fingerprint, safe to display
    status       TEXT NOT NULL DEFAULT 'unverified',  -- unverified | ok | invalid
    last_error   TEXT,
    verified_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user ON user_credentials (user_id, kind);

-- Which key a connection was made with: publishing must reuse the same one,
-- and deleting a key has to make its connections unusable rather than silently
-- publishing through somebody else's quota.
ALTER TABLE social_connections
    ADD COLUMN IF NOT EXISTS credential_id BIGINT
    REFERENCES user_credentials(id) ON DELETE SET NULL;

-- Onboarding progress, so the wizard knows what is still missing.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
