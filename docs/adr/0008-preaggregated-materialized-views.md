# 8. Pre-Aggregated Materialized Views for Hyper-Fast Analytics & KPI Dashboards

Date: 2026-10-18

## Status

Accepted

## Context

As ClickPulse deployments scale into millions of events, calculating high-level KPIs over long date ranges (30-day, 90-day, or year-to-date) on raw events introduces unnecessary query latency and resource consumption:
1. **Bounce Rate & Session Duration:** Scanning the entire `clickpulse.analytics_events` table and grouping by `(visitor_id, session_id)` requires scanning raw strings, paths, and timestamps across gigabytes of compressed data.
2. **Channel & Campaign Performance:** Running domain extractions and regular expressions on `referrer` dynamically on every dashboard refresh degrades UX.

## Decision

We introduce dedicated pre-aggregating Materialized Views into ClickHouse using the `AggregatingMergeTree` engine:

1. **`clickpulse.daily_session_stats` (`daily_session_stats_mv`):**
   - Automatically maintains `hits` (`SimpleAggregateFunction(sum, UInt32)`), `first_seen` (`SimpleAggregateFunction(min, DateTime64)`), and `last_seen` (`SimpleAggregateFunction(max, DateTime64)`) grouped by `(site_id, date, session_id, visitor_id)`.
   - Enables sub-millisecond calculation of bounce rates (`countIf(hits = 1)`) and average session duration (`dateDiff('second', min(first_seen), max(last_seen))`).

2. **`clickpulse.daily_sources` (`daily_sources_mv`):**
   - Pre-classifies referrers into standard acquisition channels (Google, Bing, GitHub, Hacker News, Reddit, Twitter/X, LinkedIn, or domain) and UTM parameters.
   - Pre-aggregates `visitors_state` (`uniqState(visitor_id)`) and `sessions_state` (`uniqState(session_id)`).

3. **Dashboard Alignment:**
   - Dashboards in SigNoz and Grafana leverage these pre-aggregated tables for high-level stat panels and historical time series, falling back to raw `analytics_events` only for deep ad-hoc event exploration.

## Consequences

### Positive
- Sub-millisecond dashboard loading times on 30d/90d ranges.
- Zero extra application-layer compute overhead (ClickHouse performs stream aggregation during `async_insert`).
- Exponential reduction in disk read I/O for dashboard queries.

### Negative
- Small storage footprint overhead (< 5% of raw event table size).
- TTL retention on aggregated tables set to 36 months to ensure long-term historical trend reporting.
