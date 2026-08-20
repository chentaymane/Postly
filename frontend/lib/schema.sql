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
    -- generating | draft | scheduled | publishing | retrying | published
    --            | failed | unconfirmed
    -- "generating" is a slot claimed by a run that is still writing the post.
    -- "publishing" and "retrying" are posts claimed by the tick that is sending
    -- them, so a second tick cannot send the same post again; both are restored
    -- to where they came from if the run holding them dies.
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

-- How many times a renderer has picked this draft up. Without it a job that
-- kills the renderer every time (a dead image URL, a script FFmpeg chokes on)
-- is handed out again every 15 minutes forever, and the draft says "Rendering"
-- for the rest of its life. A capped count lets a transient failure be retried
-- and a hopeless one be reported.
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS render_attempts INT NOT NULL DEFAULT 0;

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
    kind         TEXT NOT NULL,        -- zernio | socialapi | groq | openai | gemini | anthropic
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

-- Real publish outcome, read back from the aggregator rather than assumed.
-- The API accepting a post is not the same as the platform showing it, so the
-- dashboard must count confirmed posts, not requests we sent.
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS platform_post_url TEXT;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS remote_status TEXT;      -- pending | published | failed
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Reliable scheduling.
--
-- Posting times used to be UTC-only, so "10:00" meant ten in Greenwich rather
-- than ten where the user lives. Times are now local wall-clock in the
-- automation's own timezone, which is also what keeps them fixed across DST —
-- storing a UTC instant would drift by an hour twice a year.
--
-- Existing rows default to UTC, which is exactly how they behaved before, so
-- upgrading changes nobody's schedule until they pick a zone.
-- ---------------------------------------------------------------------------

ALTER TABLE automations
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';   -- IANA name

-- How far back a missed slot may still be honoured. A cron tick that never
-- arrived (or arrived late) used to lose that slot silently for the whole day;
-- within this window the scheduler catches up instead.
ALTER TABLE automations
    ADD COLUMN IF NOT EXISTS catch_up_hours INT NOT NULL DEFAULT 6;

-- Watermark: slots at or before this instant have already been considered.
-- It is what makes a tick idempotent in time as well as in content.
ALTER TABLE automations
    ADD COLUMN IF NOT EXISTS scheduled_through TIMESTAMPTZ;

-- Existing automations start from the moment of the upgrade. Without this the
-- first tick would treat every slot inside the catch-up window as owed and post
-- several times at once, which is not the behaviour anyone asked for.
UPDATE automations SET scheduled_through = now() WHERE scheduled_through IS NULL;

ALTER TABLE automations
    ADD COLUMN IF NOT EXISTS last_error TEXT;

-- One post per (automation, slot, platform), enforced by the database rather
-- than by hoping the scheduler never runs twice. A retried tick, an overlapping
-- "Run now" and a duplicated cron delivery all collapse onto the same row.
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS slot_key TEXT;   -- '2026-08-03T10:00|pinterest'

CREATE UNIQUE INDEX IF NOT EXISTS uq_queued_posts_slot
    ON queued_posts (automation_id, slot_key)
    WHERE automation_id IS NOT NULL AND slot_key IS NOT NULL;

-- Delivery owner for a timed post:
--   'aggregator' — handed over with a time, they release it
--   'postly'     — held here, the scheduler publishes it at the minute
-- Direct platform connections cannot accept a future time, so their scheduled
-- posts used to fail outright. Now they are simply held.
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS delivery TEXT;

-- Retry bookkeeping. A transient failure (timeout, 5xx, rate limit) is retried
-- with growing backoff; a real rejection is not retried at all.
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE queued_posts
    ADD COLUMN IF NOT EXISTS failure_kind TEXT;   -- transient | permanent

-- The scheduler's own work queue: everything due, cheapest first.
CREATE INDEX IF NOT EXISTS idx_queued_posts_due
    ON queued_posts (status, scheduled_at)
    WHERE status IN ('scheduled', 'failed');

-- ---------------------------------------------------------------------------
-- Run history. "It sometimes doesn't post" is unanswerable without a record of
-- what each tick decided, so every run writes one row — including the runs that
-- deliberately did nothing.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS automation_runs (
    id            BIGSERIAL PRIMARY KEY,
    automation_id BIGINT REFERENCES automations(id) ON DELETE CASCADE,
    user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
    trigger       TEXT NOT NULL DEFAULT 'cron',   -- cron | manual | catchup
    status        TEXT NOT NULL,                  -- ok | partial | failed | skipped
    slots         INT NOT NULL DEFAULT 0,
    generated     INT NOT NULL DEFAULT 0,
    published     INT NOT NULL DEFAULT 0,
    failed        INT NOT NULL DEFAULT 0,
    detail        TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_auto
    ON automation_runs (automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_user
    ON automation_runs (user_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Scheduler heartbeat. A cron that stopped firing looks exactly like an
-- automation that decided not to post, so the tick records that it ran and the
-- app shows how long ago that was.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_state (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Repair: published_post_id used to be filled with the post's public URL
-- whenever the aggregator returned one. Every such row is unlookupable — the
-- status check and the cancel call both address /posts/<a whole URL> — so
-- those posts could never be confirmed live. Move the URL to the column that
-- means URL and clear the id, which lets reconciliation find them again.
-- ---------------------------------------------------------------------------

UPDATE queued_posts
   SET platform_post_url = COALESCE(platform_post_url, published_post_id),
       published_post_id = NULL,
       remote_status     = COALESCE(remote_status, 'published')
 WHERE published_post_id ~ '^https?://';

-- Posts already sent keep their delivery owner recorded, so the scheduler does
-- not mistake an aggregator-held post for one it needs to publish itself.
UPDATE queued_posts qp
   SET delivery = CASE WHEN sc.provider IN ('zernio','socialapi') THEN 'aggregator' ELSE 'postly' END
  FROM social_connections sc
 WHERE sc.user_id = qp.user_id
   AND sc.platform = qp.platform
   AND qp.delivery IS NULL
   AND qp.status IN ('scheduled','published');

-- ---------------------------------------------------------------------------
-- Bring your own niche.
--
-- Postly's prompts were written around one store — the examples named colouring
-- books and a five-year-old with curly hair, and every user's posts inherited
-- that. A tool that writes for anybody needs the specifics to come from the
-- user, not from the source code.
--
-- Two levels, because both are real needs: a brand-wide instruction that every
-- post should respect ("never mention discounts", "always British English"),
-- and a per-automation one that shapes just that stream ("only behind-the-
-- scenes posts"). The automation's is an addition to the brand's, not a
-- replacement — overriding silently would make the brand rule look ignored.
-- ---------------------------------------------------------------------------

ALTER TABLE brand_profiles
    ADD COLUMN IF NOT EXISTS custom_prompt TEXT;      -- applies to every post
ALTER TABLE brand_profiles
    ADD COLUMN IF NOT EXISTS niche TEXT;              -- preset id, or NULL
ALTER TABLE brand_profiles
    ADD COLUMN IF NOT EXISTS banned_words TEXT;       -- comma separated
ALTER TABLE brand_profiles
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'English';

ALTER TABLE automations
    ADD COLUMN IF NOT EXISTS custom_prompt TEXT;      -- extra rules for this one

-- A connection the connector no longer recognises is not "connected". Marking
-- it lets the UI say so instead of failing every post with "Account not found".
ALTER TABLE social_connections
    ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE social_connections
    ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;

-- A key that will not decrypt is neither valid nor invalid — it is unreadable,
-- and the user must re-enter it. Without its own state it was silently skipped.
COMMENT ON COLUMN user_credentials.status IS 'unverified | ok | invalid | unreadable';

-- ---------------------------------------------------------------------------
-- Account bookkeeping.
--
-- password_hash is nullable so a future sign-in method that does not use one
-- can exist without a sentinel hash — a fake bcrypt string would be a password
-- nobody knows that the login path would still try to compare against.
-- ---------------------------------------------------------------------------

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
