-- ============================================================================
-- ClickPulse: ClickHouse Production Schema
-- Engine: MergeTree with optimal codecs, TTL, and materialized views
-- ============================================================================

CREATE DATABASE IF NOT EXISTS clickpulse;

-- ----------------------------------------------------------------------------
-- 1. Main Analytics Events Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clickpulse.analytics_events
(
    created_at   DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    site_id      LowCardinality(String),
    event_type   LowCardinality(String),
    visitor_id   FixedString(64),
    session_id   UUID,
    path         String,
    referrer     String,
    utm_source   LowCardinality(String),
    utm_medium   LowCardinality(String),
    utm_campaign LowCardinality(String),
    country      LowCardinality(FixedString(2)),
    device_type  LowCardinality(String),
    browser      LowCardinality(String),
    event_data   String CODEC(ZSTD(3))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, event_type, toDate(created_at), session_id, created_at)
TTL created_at + INTERVAL 18 MONTH
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------------------
-- 2. Quarantine Table for Rejected / Malformed Events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clickpulse.events_rejected
(
    rejected_at      DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    site_id          String,
    raw_payload      String CODEC(ZSTD(3)),
    rejection_reason LowCardinality(String),
    source_ip_hash   FixedString(64)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(rejected_at)
ORDER BY (rejection_reason, rejected_at)
TTL rejected_at + INTERVAL 14 DAY
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------------------
-- 3. Daily Aggregated Materialized View (Hyper-fast KPI dashboards)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clickpulse.daily_site_stats
(
    date             Date,
    site_id          LowCardinality(String),
    pageviews        UInt64,
    visitors_state   AggregateFunction(uniq, FixedString(64)),
    sessions_state   AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date)
TTL date + INTERVAL 36 MONTH;

CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse.daily_site_stats_mv
TO clickpulse.daily_site_stats
AS
SELECT
    toDate(created_at) AS date,
    site_id,
    count() AS pageviews,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
GROUP BY site_id, date;

-- ----------------------------------------------------------------------------
-- 4. SigNoz OTLP Integration (Real-Time Ingestion Bridge)
-- If sending OTLP logs directly to SigNoz (/v1/logs), this Materialized View
-- automatically streams incoming 'clickpulse' logs from SigNoz's log store
-- into clickpulse.analytics_events with flat, typed columns in real-time.
-- ----------------------------------------------------------------------------
-- CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse.signoz_bridge_mv
-- TO clickpulse.analytics_events
-- AS
-- SELECT
--     timestamp AS created_at,
--     attributes_string_value[indexOf(attributes_string_key, 'site.id')] AS site_id,
--     body AS event_type,
--     attributes_string_value[indexOf(attributes_string_key, 'visitor.id')] AS visitor_id,
--     toUUIDOrDefault(attributes_string_value[indexOf(attributes_string_key, 'session.id')]) AS session_id,
--     attributes_string_value[indexOf(attributes_string_key, 'http.target')] AS path,
--     attributes_string_value[indexOf(attributes_string_key, 'http.referrer')] AS referrer,
--     attributes_string_value[indexOf(attributes_string_key, 'utm.source')] AS utm_source,
--     attributes_string_value[indexOf(attributes_string_key, 'utm.medium')] AS utm_medium,
--     attributes_string_value[indexOf(attributes_string_key, 'utm.campaign')] AS utm_campaign,
--     attributes_string_value[indexOf(attributes_string_key, 'geo.country')] AS country,
--     attributes_string_value[indexOf(attributes_string_key, 'device.type')] AS device_type,
--     attributes_string_value[indexOf(attributes_string_key, 'browser.name')] AS browser,
--     '{}' AS event_data
-- FROM signoz_logs.logs
-- WHERE attributes_string_value[indexOf(attributes_string_key, 'service.name')] = 'clickpulse'
--    OR resources_string_value[indexOf(resources_string_key, 'service.name')] = 'clickpulse';

-- ----------------------------------------------------------------------------
-- 5. Database Hardening & Sandboxed User (Zero-Trust Security)
-- Protects ClickHouse from connection spikes, memory exhaustion, and unauthorized reads.
-- ----------------------------------------------------------------------------

-- A. Ingestion Role: Strictly INSERT-only on analytics_events (NO SELECT, NO DROP, NO ALTER)
CREATE ROLE IF NOT EXISTS clickpulse_edge_ingest;
GRANT INSERT ON clickpulse.analytics_events TO clickpulse_edge_ingest;

-- B. Safety Profile: Limits RAM & execution time per request, enables async_insert
CREATE SETTINGS PROFILE IF NOT EXISTS edge_ingest_limits
SETTINGS
    max_execution_time = 2,           -- Terminates any query taking > 2 seconds
    max_memory_usage = 50000000,      -- Hard ceiling of 50 MB RAM per write
    async_insert = 1,                 -- Enforces server-side RAM batching
    wait_for_async_insert = 0;        -- Returns 200 OK immediately without blocking

-- C. Sandboxed Worker User: Bound strictly to the ingest role and safety profile
-- CREATE USER IF NOT EXISTS clickpulse_worker
--     IDENTIFIED WITH sha256_password BY 'replace_with_secure_password'
--     DEFAULT ROLE clickpulse_edge_ingest
--     SETTINGS PROFILE edge_ingest_limits;

-- D. Dashboard Reader Role (Used by SigNoz / Grafana):
-- CREATE ROLE IF NOT EXISTS clickpulse_reader;
-- GRANT SELECT ON clickpulse.* TO clickpulse_reader;


