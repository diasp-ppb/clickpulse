---
name: edge-clickhouse-qa
description: QA protocol for Edge Worker ingestion and ClickHouse pipeline. Use when updating packages/edge-worker, packages/sync-cli, or schema definitions.
---

# Edge & ClickHouse Ingestion QA Protocol

Follow this checklist whenever modifying `packages/edge-worker/`, `packages/sync-cli/`, or ClickHouse schemas.

## 1. Verification Dimensions
1. **Direct Ingestion Headers**:
   - Verify `async_insert=1` and `wait_for_async_insert=0` are sent on ClickHouse HTTP requests.
   - Verify Cloudflare Access headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) are passed when configured.
2. **HMAC Anonymization**:
   - Verify daily rotating salt is hashed with client IP and User-Agent via Web Crypto SHA-256.
   - Ensure raw IP is never logged or forwarded to ClickHouse.
3. **Shock Absorber Failover**:
   - Verify that ClickHouse HTTP 5xx, network timeout, or connection failures immediately trigger D1 buffer spooling (`schema-d1.sql`).
   - Confirm worker returns HTTP 202 Accepted even during ClickHouse degradation when D1 is available.
4. **Schema Alignment**:
   - Verify payload schema matches column names and types in `schema.sql` (`created_at`, `site_id`, `event_type`, `visitor_id`, `session_id`, `path`, `referrer`, etc.).

## 2. Test Verification
```bash
# Focused worker tests
npx vitest run packages/edge-worker/

# Full typecheck
npm run typecheck
```
