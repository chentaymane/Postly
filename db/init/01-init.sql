-- Postly database initialization.
-- Runs automatically on FIRST Postgres boot (empty data dir) via
-- /docker-entrypoint-initdb.d. To re-run, remove the postgres_data volume:
--   docker compose down -v && docker compose up -d
--
-- n8n keeps its own system tables in the POSTGRES_DB database (default: n8n).
-- We keep application logs in a separate `postly` database so the two never
-- collide.

CREATE DATABASE postly;

\connect postly

-- One row per publish attempt, per platform.
CREATE TABLE IF NOT EXISTS post_logs (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Correlates all platform rows produced by a single webhook submission.
    run_id          UUID,
    platform        TEXT NOT NULL,              -- facebook | instagram | x | linkedin | pinterest | tiktok
    status          TEXT NOT NULL,             -- success | fail | skipped
    post_id         TEXT,                       -- ID/URL returned by the platform on success
    error_message   TEXT,                       -- populated on failure
    -- Original request + generated artifacts, kept for auditing/retries.
    theme           TEXT,
    product_name    TEXT,
    tone            TEXT,
    caption         TEXT,
    hashtags        TEXT,
    cta             TEXT,
    image_url       TEXT,                       -- final composed image
    destination_url TEXT,
    raw_request     JSONB,                      -- full inbound webhook payload
    raw_response    JSONB                       -- full platform API response
);

CREATE INDEX IF NOT EXISTS idx_post_logs_run_id   ON post_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_post_logs_platform ON post_logs (platform);
CREATE INDEX IF NOT EXISTS idx_post_logs_status   ON post_logs (status);
CREATE INDEX IF NOT EXISTS idx_post_logs_created  ON post_logs (created_at DESC);
