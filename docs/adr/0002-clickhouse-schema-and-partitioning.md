# ADR 0002: ClickHouse Schema, Partitioning & Compression Strategy

## Status
Accepted

## Context
ClickPulse is designed to handle high-throughput telemetry data on minimal compute resources (from single-node instances to enterprise clusters). Traditional relational databases (PostgreSQL, MySQL) struggle with high-write ingestion and large-scale aggregations (`uniq()`, `group by`, time-series filtering) without expensive indexing and massive RAM.

ClickHouse provides columnar storage and SIMD-accelerated aggregations, but achieving sub-millisecond query performance and 10x+ disk compression requires a carefully planned schema, sorting key (`ORDER BY`), and partition scheme.

---

## Decision

### 1. Table Engine: `MergeTree`
We use the standard `MergeTree` engine. It supports continuous background merges, automated TTL eviction, and parallel query execution.

### 2. Partitioning Strategy: `PARTITION BY toYYYYMM(created_at)`
- Partitioning by month (`toYYYYMM`) balances file descriptor overhead with query pruning.
- Dropping or detaching old partitions for data retention (or compliance) is instantaneous.

### 3. Primary / Sorting Key: `ORDER BY (site_id, event_type, toDate(created_at), session_id, created_at)`
The order of columns in the sorting key directly controls physical on-disk data organization:
1. `site_id`: Multi-tenant boundary. 99% of queries filter by a single site.
2. `event_type`: Allows pruning between `pageview` and `outbound_click` immediately.
3. `toDate(created_at)`: Date-range filtering is the most common analytics dimension.
4. `session_id`: Groups events belonging to the same session close together on disk, making session duration and bounce calculations hyper-fast.
5. `created_at`: Fine-grained chronological sorting within the session.

### 4. LowCardinality Dictionaries
String columns with low unique value counts use `LowCardinality(String)`:
- `site_id`, `event_type`, `utm_source`, `utm_medium`, `utm_campaign`, `country`, `device_type`, `browser`.
- Reduces disk space to 1-2 bytes per row via internal dictionary encoding.

### 5. Column Compression Codecs
- `created_at DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))`: Compresses monotonically increasing timestamps by > 90%.
- `visitor_id FixedString(64)`: 64-character SHA-256 hex string.
- `session_id UUID`: Binary 16-byte representation.
- `event_data String CODEC(ZSTD(3))`: JSON payload compressed with Zstandard.

### 6. Retention via Automated TTL
A table-level TTL policy is enforced:
```sql
TTL created_at + INTERVAL 18 MONTH
```
Older data is automatically dropped by background merges, keeping disk footprints strictly bounded.

---

## Consequences
- **Positive:**
  - Up to **15:1 compression ratio** compared to raw JSON.
  - Sub-10ms query execution across millions of events even on low-power CPUs.
  - Multi-tenant isolation without creating separate tables per site.
- **Negative:**
  - Mutations (`UPDATE` / `DELETE`) are expensive; ClickPulse is designed strictly as an append-only, immutable event log.
