# 8. Pre-Aggregated Materialized Views for Analytics & KPI Dashboards

Date: 2026-10-18

## Status

Accepted

## Context

As ClickPulse deployments scale into millions of events, calculating high-level KPIs over long date ranges (30-day, 90-day, or year-to-date) on raw events introduces unnecessary query latency and resource consumption:
1. **Bounce Rate & Session Duration:** Scanning the entire `clickpulse.analytics_events` table and grouping by `(visitor_id, session_id)` requires scanning raw strings, paths, and timestamps across gigabytes of compressed data.
2. **Channel & Campaign Performance:** Running domain extractions and regular expressions on `referrer` dynamically on every dashboard refresh degrades UX.

`daily_site_stats`, `daily_landing_pages` and `daily_sources` already existed in the schema. This ADR consolidates the pre-aggregation strategy and introduces `daily_session_stats`, the missing piece for session-level metrics.

## Decision

We maintain a family of pre-aggregating Materialized Views using the `AggregatingMergeTree` engine:

1. **`clickpulse.daily_session_stats` (`daily_session_stats_mv`):**
   - Maintains `pageviews` (`SimpleAggregateFunction(sum, UInt64)`), `first_seen` (`SimpleAggregateFunction(min, DateTime64)`), and `last_seen` (`SimpleAggregateFunction(max, DateTime64)`) grouped by `(site_id, date, session_id, visitor_id)`.
   - Enables bounce rate (`countIf(pageviews = 1)`) and session duration (`dateDiff('second', min(first_seen), max(last_seen))`) without scanning raw events.
   - A session can span UTC midnight, at which point `visitor_id` rotates with the daily salt and the session produces two rows. Queries must therefore aggregate by `session_id`.

2. **`clickpulse.daily_sources` (`daily_sources_mv`):**
   - Pre-classifies referrers into acquisition channels (Google, Bing, GitHub, Hacker News, Reddit, Twitter/X, LinkedIn, or bare domain) and keeps UTM parameters.
   - Pre-aggregates `visitors_state` (`uniqState(visitor_id)`) and `sessions_state` (`uniqState(session_id)`).

3. **Dashboard Alignment:**
   - Grafana KPI panels (unique visitors, sessions, pageviews, bounce rate) and the SigNoz KPI row read the pre-aggregated tables.
   - Hourly time series, device/country/outbound breakdowns and deep ad-hoc exploration stay on raw `analytics_events`, which remains the source of truth.

## Migration & Operations

**Materialized Views only capture rows inserted after creation.** Existing deployments must run `scripts/backfill-materialized-views.sql` once, with the MV creation timestamp as the cutoff, or historical dashboard ranges will read empty. See the header of that script for ordering and verification steps.

The views run inside the ingestion query, so they are subject to the `edge_ingest_limits` profile (50 MB RAM, 2 s timeout). `daily_session_stats` adds a fourth `GROUP BY` per insert batch; verify memory headroom under realistic `async_insert` batch sizes before high-traffic rollout.

## Consequences

### Positive
- Dashboard queries over 30d/90d ranges read one row per day/session instead of every raw event.
- Zero extra application-layer compute: aggregation happens in ClickHouse during ingestion.
- Large reduction in disk read I/O for KPI queries (the raw table is scanned only for hourly and event-level panels).

### Negative
- Storage overhead is higher than the other daily views because `daily_session_stats` keeps roughly one row per session (UUID + `FixedString(64)` + timestamps), not one row per day. Measure it with `system.parts` before publishing a storage budget.
- Extra CPU and memory on the ingestion path; the aggregation cost is paid on write instead of read.
- `daily_session_stats` cannot answer questions about pages viewed within a session; those still require `analytics_events`.
- TTL on the aggregated tables is 36 months, longer than the 18-month raw retention.
