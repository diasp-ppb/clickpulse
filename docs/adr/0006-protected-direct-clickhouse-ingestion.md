# ADR 0006: Protected Direct ClickHouse Ingestion (async_insert)

## Status
Accepted

## Context
In earlier iterations, we evaluated routing web analytics events through OpenTelemetry's `/v1/logs` endpoint. However, modeling structured web domain events as generic application logs created impedance mismatch:
1. **Unnecessary Wrapping:** A simple 10-field web event was wrapped in 60+ lines of nested protobuf/JSON structures.
2. **Schema Contortion:** OTel dumps records into generic log tables (`signoz_logs.logs`), storing attributes in key/value string arrays. This required complex Materialized Views using `attributes_string_value[indexOf(...)]` array lookups, degrading query ergonomics and performance.
3. **Log Pollution:** Web pageviews were mingled with microservice operational logs.

Direct ingestion to specific ClickHouse tables (`clickpulse.analytics_events`) offers optimal schema design and SIMD columnar performance. However, exposing a database directly to edge traffic poses risks:
- Connection and traffic floods.
- Infrastructure or network outages leading to permanent data loss.
- Blast radius if database credentials leak.

---

## Decision

ClickPulse adopts **Protected Direct ClickHouse Ingestion** using native Asynchronous Inserts (`async_insert=1`) backed by a **Three-Shield Database Protection Model**:

```
[Browser Client]
       │  POST /api/analytics
       ▼
[Edge Ingestion Worker]
       │
       ├─► [Shield 1: Zero Trust Network (Cloudflare Access Service Token)]
       │   Port 8123 is closed to public; only worker token can reach tunnel.
       │
       ├─► [Shield 2: Sandboxed User Profile]
       │   INSERT-only on analytics_events (NO SELECT/DROP/ALTER).
       │   Settings profile caps RAM at 50 MB and execution time at 2s.
       │   Enforces async_insert=1 on the server side.
       │
       ▼ (Direct Write)
[ClickHouse: clickpulse.analytics_events]
       │
       ▼ (If ClickHouse Unreachable / Outage)
[Shield 3: Shock Absorber (Cloudflare D1 Spool)]
Spools events locally; auto-drains when server connectivity recovers.
```

### 1. Ingestion Protocol: Native HTTP with `async_insert = 1`
The Edge Worker posts flat, typed JSON rows directly to ClickHouse:
```
POST https://clickhouse.yourdomain.com/?query=INSERT+INTO+clickpulse.analytics_events+FORMAT+JSONEachRow&async_insert=1&wait_for_async_insert=0
```
With `async_insert=1`, ClickHouse buffers incoming rows in RAM on the server and flushes them in batches every 200ms or 10,000 rows. This eliminates the need for an external buffer or collector while maintaining high-throughput batch writes.

### 2. Shield 1: Zero Trust Network Perimeter
ClickHouse is never exposed to the public internet:
- Exposed strictly through a Cloudflare Zero Trust Tunnel.
- Protected by a Cloudflare Access policy requiring a **Service Token** (`CF-Access-Client-Id` and `CF-Access-Client-Secret`).
- Direct public curls and port scans are blocked at the Cloudflare edge.

### 3. Shield 2: ClickHouse Sandboxed User & Resource Ceilings
The Edge Worker uses an unprivileged user bound to an explicit safety profile:
- **Zero Read Access:** `0` `SELECT` privileges. Cannot read past visitor history or query logs.
- **No DDL:** Cannot alter or drop tables.
- **Resource Limits:** Queries taking > 2 seconds or consuming > 50 MB of memory are automatically terminated.

### 4. Shield 3: Edge Shock Absorber (D1 Spool)
The Edge Worker sets an aggressive 800ms timeout on the ClickHouse connection. If ClickHouse is undergoing maintenance, restarting, or experiencing network hiccups:
- The worker immediately falls back to spooling the event into **Cloudflare D1**.
- The client receives `200 OK` instantly with zero data loss.
- Spooled events drain into ClickHouse once connectivity is restored.

---

## Sanitization Policy
All documentation, examples, and configuration files must strictly use generic placeholders (e.g., `https://clickhouse.yourdomain.com`, `example.com`, `your-service-token-id`) to prevent accidental leakage of private infrastructure endpoints or internal domain names.

---

## Consequences
- **Positive:**
  - Sub-millisecond direct table ingestion into strongly typed columns.
  - Zero log pollution in SigNoz or APM stores.
  - Maximum database resilience: protected from floods, memory exhaustion, unauthorized reads, and infrastructure outages.
  - Fully compliant with infrastructure sanitization best practices.
- **Negative:**
  - Requires setting up a Cloudflare Access Service Token or basic auth on the tunnel route.
