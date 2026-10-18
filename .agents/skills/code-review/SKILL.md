---
name: code-review
description: Standard operating procedure for peer code review and quality gates on git diffs before merging.
---

# ClickPulse Peer Code Review Protocol

Inspect `git diff` against `AGENTS.md` before finalizing changes.

## 1. Review Checklist

### A. Client Tracker (`packages/tracker/`)
- [ ] **Bundle Size Budget**: Built output `public/tracker.min.js` remains `< 1.5 KB` gzipped.
- [ ] **Privacy Invariants**: Zero cookies used; strictly `sessionStorage` with 30m rolling expiration.
- [ ] **Browser Resilience**: Proper fallback from `sendBeacon` to `fetch(..., { keepalive: true })`.

### B. Edge Ingestion & Worker (`packages/edge-worker/`)
- [ ] **Streaming Ingestion**: `async_insert=1` and `wait_for_async_insert=0` properly configured.
- [ ] **Failover Buffer**: D1 spooling fallback executes cleanly on ClickHouse timeout or failure.
- [ ] **Zero Trust & Security**: Cloudflare Access tokens verified; no secrets committed.

### C. ClickHouse & Data Architecture
- [ ] **Schema Correctness**: Table definitions in `schema.sql` preserve partitioning by month and composite sorting keys.
- [ ] **Query Efficiency**: No unindexed scans in dashboards or reporting queries.

### D. Automated Quality Gate
- [ ] `npm test` passes with 100% green tests.
- [ ] `npm run typecheck` passes with zero type errors.
