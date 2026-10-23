-- ============================================================================
-- ClickPulse: One-off backfill for the pre-aggregated Materialized Views
-- ============================================================================
-- Materialized Views only process rows inserted *after* they are created.
-- Deployments that already have data in clickpulse.analytics_events must run
-- this script once, otherwise dashboards backed by the MVs will show zeros
-- for historical date ranges.
--
-- Order of operations (existing deployments):
--   1. Capture the UTC timestamp BEFORE deploying schema.sql:
--        SELECT now();
--   2. Deploy schema.sql (tables + materialized views).
--   3. Replace every `__MV_CREATED_AT__` below with the timestamp from step 1.
--   4. Run this script once, as an admin user (NOT the edge ingest user).
--   5. Run the verification queries at the bottom of this file.
--
-- WARNING: do not run twice. The `sum` columns (pageviews, session_starts) are
-- additive, so a second run double-counts them. `uniq` states are idempotent.
--
-- Memory: each INSERT aggregates an arbitrary range of raw events. On large
-- tables, run one month at a time by narrowing the `created_at` bounds below.
--
-- Keep these SELECTs in sync with the materialized view definitions in schema.sql.
-- ============================================================================


-- 1. Daily site stats --------------------------------------------------------
INSERT INTO clickpulse.daily_site_stats
SELECT
    toDate(created_at) AS date,
    site_id,
    toUInt64(count()) AS pageviews,
    toUInt64(countIf(visitParamExtractBool(event_data, 'is_new_session') = 1)) AS session_starts,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
  AND created_at < toDateTime64('__MV_CREATED_AT__', 3, 'UTC')
GROUP BY site_id, date;


-- 2. Daily landing pages -----------------------------------------------------
INSERT INTO clickpulse.daily_landing_pages
SELECT
    toDate(created_at) AS date,
    site_id,
    path,
    toUInt64(count()) AS session_starts,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE visitParamExtractBool(event_data, 'is_new_session') = 1
  AND created_at < toDateTime64('__MV_CREATED_AT__', 3, 'UTC')
GROUP BY site_id, date, path;


-- 3. Daily acquisition channels ---------------------------------------------
INSERT INTO clickpulse.daily_sources
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
    toUInt64(countIf(visitParamExtractBool(event_data, 'is_new_session') = 1)) AS session_starts,
    toUInt64(count()) AS pageviews,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
  AND created_at < toDateTime64('__MV_CREATED_AT__', 3, 'UTC')
GROUP BY site_id, date, channel, utm_source, utm_medium, utm_campaign;


-- 4. Daily session stats -----------------------------------------------------
INSERT INTO clickpulse.daily_session_stats
SELECT
    toDate(created_at) AS date,
    site_id,
    session_id,
    visitor_id,
    toUInt64(count()) AS pageviews,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
  AND created_at < toDateTime64('__MV_CREATED_AT__', 3, 'UTC')
GROUP BY site_id, date, session_id, visitor_id;


-- ============================================================================
-- Verification: raw vs. pre-aggregated totals for a fixed day.
-- Replace 2026-01-01 with a day that exists in your dataset.
-- ============================================================================
-- SELECT 'raw' AS source, count() AS pageviews, uniq(session_id) AS sessions
-- FROM clickpulse.analytics_events
-- WHERE site_id = 'example.com' AND event_type = 'pageview' AND toDate(created_at) = '2026-01-01'
-- UNION ALL
-- SELECT 'mv', sum(pageviews), uniqMerge(sessions_state)
-- FROM clickpulse.daily_site_stats
-- WHERE site_id = 'example.com' AND date = '2026-01-01';
