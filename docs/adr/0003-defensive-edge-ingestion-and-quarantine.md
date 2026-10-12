# ADR 0003: Defensive Edge Ingestion and Quarantine Pattern

## Status
Accepted

## Context
Any public web telemetry endpoint (e.g., `/api/analytics`) is publicly accessible by design. Without defensive architecture, endpoints are vulnerable to:
1. **Spam & Bad Data:** Scrapers or malicious actors submitting corrupt JSON, random strings, or spam URLs.
2. **Cardinality Bombing:** Attackers injecting millions of unique path names or random property keys to blow up memory dictionaries.
3. **High Ingestion Costs & Resource Exhaustion:** Malicious loops consuming edge function invocations or storage quotas.
4. **Data Corruption:** Bad schema data polluting production dashboards and analytics reports.

---

## Decision

We implement a **Multi-Layer Defensive Ingestion & Quarantine Pipeline**:

```
[Browser Request]
       │
       ▼
1. Edge Perimeter (Optional WAF or In-Handler Checks)
   - Method == POST
   - Content-Length <= 4096 bytes
   - Origin header check against site allowed domains
       │
       ▼
2. Edge Payload Validation
   - Strict event_type allowlist (pageview, outbound_click, custom:*)
   - String limits: path <= 255 chars, referrer <= 500 chars
   - Timestamp sanity: |client_ts - server_ts| <= 300 seconds
   - Property limits: max 10 custom properties, primitive values only
       │
       ▼
3. Edge Buffering (Cloudflare D1 / Queue)
   - Store validated payload + metadata (country, device, user_agent_hash)
       │
       ▼
4. ETL Drain & Quarantine
   - Parse & validate batch
   - Valid events  ───► INSERT INTO clickpulse.analytics_events
   - Invalid events ───► INSERT INTO clickpulse.events_rejected (Quarantine)
```

### 1. In-Handler Validation Rules
- **Method & Size:** Only `POST` requests under 4 KB are accepted.
- **Allowed Origins:** The `Origin` header is compared against the authorized domain list for the `site_id`.
- **Clock Drift Bounds:** Events with timestamps skewed by more than 5 minutes from server clock are rejected, preventing historical backfill tampering.
- **Payload Limits:** Maximum 10 key-value pairs in custom properties; strings truncated to 255 characters.

### 2. The Quarantine Table (`events_rejected`)
Rather than silently dropping invalid records during the ETL process, failing rows are directed to a quarantine table:
```sql
CREATE TABLE IF NOT EXISTS clickpulse.events_rejected
(
    rejected_at   DateTime64(3, 'UTC'),
    site_id       String,
    raw_payload   String,
    rejection_reason LowCardinality(String),
    source_ip_hash FixedString(64)
)
ENGINE = MergeTree()
ORDER BY (rejection_reason, rejected_at)
TTL rejected_at + INTERVAL 14 DAY;
```
This enables SREs and developers to debug legitimate tracking issues (e.g., frontend bug producing bad formats) while isolating production metrics from pollution.

### 3. ClickHouse User Least Privilege
The ETL sync pipeline connects to ClickHouse using an unprivileged database user (`clickpulse_writer`) granted **only** `INSERT` privileges on `clickpulse.analytics_events` and `clickpulse.events_rejected`. It has no permissions to run `ALTER`, `DROP`, or `SELECT` queries.

---

## Consequences
- **Positive:**
  - Production dashboards remain 100% clean and trustworthy.
  - Zero risk of cardinality explosion in ClickHouse.
  - SRE observability over bad actors and tracking errors via the quarantine table.
- **Negative:**
  - Slight CPU overhead at edge for string truncation and schema checks (< 2ms per request).
