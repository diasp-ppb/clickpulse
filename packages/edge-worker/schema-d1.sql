-- ============================================================================
-- ClickPulse: Cloudflare D1 Shock Absorber Buffer Schema
-- SQLite syntax for Cloudflare D1 edge database spool.
-- Drained by packages/sync-cli into ClickHouse.
-- ============================================================================

CREATE TABLE IF NOT EXISTS clickpulse_buffer (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    site_id      TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    visitor_id   TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    path         TEXT,
    referrer     TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    country      TEXT,
    device_type  TEXT,
    browser      TEXT,
    event_data   TEXT
);

CREATE INDEX IF NOT EXISTS idx_clickpulse_buffer_site_event ON clickpulse_buffer (site_id, event_type);
CREATE INDEX IF NOT EXISTS idx_clickpulse_buffer_created_at ON clickpulse_buffer (created_at);
