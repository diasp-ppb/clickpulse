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
    pageviews        SimpleAggregateFunction(sum, UInt64),
    session_starts   SimpleAggregateFunction(sum, UInt64),
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
    countIf(visitParamExtractBool(event_data, 'is_new_session') = 1) AS session_starts,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
GROUP BY site_id, date;

-- ----------------------------------------------------------------------------
-- 4. Daily Landing Pages Materialized View (Pre-aggregated Entry Pages)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clickpulse.daily_landing_pages
(
    date             Date,
    site_id          LowCardinality(String),
    path             String,
    session_starts   SimpleAggregateFunction(sum, UInt64),
    visitors_state   AggregateFunction(uniq, FixedString(64)),
    sessions_state   AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, path)
TTL date + INTERVAL 36 MONTH;

CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse.daily_landing_pages_mv
TO clickpulse.daily_landing_pages
AS
SELECT
    toDate(created_at) AS date,
    site_id,
    path,
    count() AS session_starts,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE visitParamExtractBool(event_data, 'is_new_session') = 1
GROUP BY site_id, date, path;

-- ----------------------------------------------------------------------------
-- 5. Daily Acquisition Channels Materialized View (Referrers & UTMs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clickpulse.daily_sources
(
    date             Date,
    site_id          LowCardinality(String),
    channel          LowCardinality(String),
    utm_source       LowCardinality(String),
    utm_medium       LowCardinality(String),
    utm_campaign     LowCardinality(String),
    session_starts   SimpleAggregateFunction(sum, UInt64),
    pageviews        SimpleAggregateFunction(sum, UInt64),
    visitors_state   AggregateFunction(uniq, FixedString(64)),
    sessions_state   AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, channel, utm_source, utm_medium, utm_campaign)
TTL date + INTERVAL 36 MONTH;

CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse.daily_sources_mv
TO clickpulse.daily_sources
AS
SELECT
    toDate(created_at) AS date,
    site_id,
    CASE
        WHEN referrer = '' OR referrer IS NULL THEN 'Direct / None'
        WHEN referrer ILIKE '%google%' THEN 'Google Search'
        WHEN referrer ILIKE '%bing%' THEN 'Bing Search'
        WHEN referrer ILIKE '%github%' THEN 'GitHub'
        WHEN referrer ILIKE '%news.ycombinator.com%' THEN 'Hacker News'
        WHEN referrer ILIKE '%reddit%' THEN 'Reddit'
        WHEN referrer ILIKE '%t.co%' OR referrer ILIKE '%twitter%' OR referrer ILIKE '%x.com%' THEN 'Twitter / X'
        WHEN referrer ILIKE '%linkedin%' THEN 'LinkedIn'
        ELSE ifNull(domainWithoutWWW(referrer), referrer)
    END AS channel,
    utm_source,
    utm_medium,
    utm_campaign,
    countIf(visitParamExtractBool(event_data, 'is_new_session') = 1) AS session_starts,
    count() AS pageviews,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
GROUP BY site_id, date, channel, utm_source, utm_medium, utm_campaign;

-- ----------------------------------------------------------------------------
-- 6. Daily Session Stats Materialized View (Hyper-fast Bounce Rate & Duration)
-- Pre-aggregates hits, start time, and end time per session.
-- Enables instant bounce rate and session duration calculations across any date range.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clickpulse.daily_session_stats
(
    date             Date,
    site_id          LowCardinality(String),
    session_id       UUID,
    visitor_id       FixedString(64),
    hits             SimpleAggregateFunction(sum, UInt32),
    first_seen       SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen        SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, session_id)
TTL date + INTERVAL 36 MONTH;

CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse.daily_session_stats_mv
TO clickpulse.daily_session_stats
AS
SELECT
    toDate(created_at) AS date,
    site_id,
    session_id,
    visitor_id,
    count() AS hits,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
GROUP BY site_id, date, session_id, visitor_id;

-- ----------------------------------------------------------------------------
-- 7. SigNoz OTLP Integration (Real-Time Ingestion Bridge)
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
-- 8. Database Hardening & Sandboxed User (Zero-Trust Security)
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


