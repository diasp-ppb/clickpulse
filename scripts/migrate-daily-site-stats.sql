-- ============================================================================
-- ClickPulse: migrate daily_site_stats to the SimpleAggregateFunction schema
-- ============================================================================
-- Deployments created before the `pageviews` fix have:
--   * pageviews UInt64            (plain column)
--   * no session_starts column
--
-- In an AggregatingMergeTree, a plain column is NOT summed during merges: each
-- merge keeps an arbitrary row's value, so pageviews collapses to the size of
-- the last batch (observed in production as ~1 pageview/day). `uniq` states are
-- unaffected. This script rebuilds the table from analytics_events.
--
-- Order of operations:
--   1. Deploy schema.sql (it creates the new tables/views; IF NOT EXISTS leaves
--      the legacy daily_site_stats untouched).
--   2. Pause the edge worker (and drain the D1 spool) to avoid a write gap.
--   3. Capture the cutoff while ingestion is paused:
--        SELECT now();
--   4. Replace every `__CUTOFF__` below with that timestamp.
--   5. Run this script once as an admin user (NOT the edge ingest user).
--   6. Run scripts/backfill-materialized-views.sql but SKIP section 1
--      (daily_site_stats was already rebuilt here).
--   7. Resume the edge worker and run the verification queries at the bottom.
--
-- WARNING: this script TRUNCATES clickpulse.daily_site_stats and rebuilds it
-- from raw events (18-month raw retention). Do not run it twice.
-- ============================================================================

-- 1. Make the existing column an aggregate and add the missing column.
--    ADD COLUMN appends at the end, so inserts below use an explicit column list.
ALTER TABLE clickpulse.daily_site_stats
    MODIFY COLUMN pageviews SimpleAggregateFunction(sum, UInt64);

ALTER TABLE clickpulse.daily_site_stats
    ADD COLUMN IF NOT EXISTS session_starts SimpleAggregateFunction(sum, UInt64) DEFAULT 0;

-- 2. Replace the old materialized view (it does not populate session_starts).
DROP TABLE IF EXISTS clickpulse.daily_site_stats_mv;

-- 3. Discard the corrupted aggregate values and rebuild from raw events.
TRUNCATE TABLE clickpulse.daily_site_stats;

CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse.daily_site_stats_mv
TO clickpulse.daily_site_stats
AS
SELECT
    toDate(created_at) AS date,
    site_id,
    toUInt64(count()) AS pageviews,
    toUInt64(countIf(visitParamExtractBool(event_data, 'is_new_session') = 1)) AS session_starts,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
GROUP BY site_id, date;

INSERT INTO clickpulse.daily_site_stats
    (date, site_id, pageviews, session_starts, visitors_state, sessions_state)
SELECT
    toDate(created_at) AS date,
    site_id,
    toUInt64(count()) AS pageviews,
    toUInt64(countIf(visitParamExtractBool(event_data, 'is_new_session') = 1)) AS session_starts,
    uniqState(visitor_id) AS visitors_state,
    uniqState(session_id) AS sessions_state
FROM clickpulse.analytics_events
WHERE event_type = 'pageview'
  AND created_at < toDateTime64('__CUTOFF__', 3, 'UTC')
GROUP BY site_id, date;

-- ============================================================================
-- Verification: raw vs. rebuilt totals for a fixed day.
-- Replace 2026-01-01 with a day that exists in your dataset.
-- ============================================================================
-- SELECT 'raw' AS source, count() AS pageviews, uniq(session_id) AS sessions,
--        countIf(visitParamExtractBool(event_data, 'is_new_session') = 1) AS session_starts
-- FROM clickpulse.analytics_events
-- WHERE site_id = 'example.com' AND event_type = 'pageview' AND toDate(created_at) = '2026-01-01'
-- UNION ALL
-- SELECT 'mv', sum(pageviews), uniqMerge(sessions_state), sum(session_starts)
-- FROM clickpulse.daily_site_stats
-- WHERE site_id = 'example.com' AND date = '2026-01-01';
