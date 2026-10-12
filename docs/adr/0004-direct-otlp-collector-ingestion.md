# ADR 0004: Direct OpenTelemetry (OTLP/HTTP) Ingestion into ClickHouse

## Status
Accepted

## Context
In early prototypes, web analytics events were written into an edge database (Cloudflare D1) and drained into ClickHouse via a scheduled batch cron (Kubernetes CronWorkflow / Python CLI).

While this pull-based pattern avoided exposing inbound ports on private networks, it introduced several drawbacks:
1. **Reporting Lag:** Dashboards experienced a 15-to-60 minute delay waiting for the cron to execute.
2. **Maintenance Overhead:** Required maintaining custom ETL scripts, cron jobs, and database cleanup routines.
3. **Storage Quotas:** Cloudflare D1 free-tier write quotas could be exhausted during traffic spikes.
4. **Data Redundancy:** Events were written to D1, read from D1, written to ClickHouse, and then deleted from D1.

Modern self-hosted and cloud deployments use Zero Trust secure tunnels (such as Cloudflare Tunnels) or reverse proxies to route traffic to internal services securely without exposing firewall ports.

---

## Decision

We promote **`Edge Worker ➔ OpenTelemetry Collector ➔ ClickHouse`** to the **Primary Ingestion Architecture** for ClickPulse:

```
[Browser Client]
       │
       ▼  POST /api/analytics
[Edge Ingestion Worker]
       │  (Validates, hashes visitor_id, builds OTLP log payload)
       ▼  POST /v1/logs (OTLP over HTTP)
[OpenTelemetry Collector / SigNoz]
       │  (Batch Processor buffers in-memory: 1000 items or 5s)
       ▼  Atomic batch write
[ClickHouse DB: clickpulse.analytics_events]
```

### 1. Standardization on OTLP Semantic Conventions
The Edge Worker translates validated web analytics events directly into standard OpenTelemetry Log Records:
- `resource.attributes`: `service.name = "clickpulse"`, `site.id = event.site_id`
- `scope.name`: `"clickpulse.tracker"`
- `logRecord.timeUnixNano`: Event timestamp in nanoseconds
- `logRecord.body`: Event name (`pageview`, `outbound_click`, `custom:*`)
- `logRecord.attributes`: `session.id`, `visitor.id`, `http.target`, `http.referrer`, `utm.source`, `geo.country`, `device.type`, `browser.name`.

### 2. Solving the ClickHouse Batching Problem Natively
ClickHouse performance degrades severely when subjected to thousands of single-row HTTP writes. The OpenTelemetry Collector natively solves this through the `batch` processor:
```yaml
processors:
  batch:
    send_batch_size: 1000
    timeout: 5s
```
The collector buffers incoming HTTP calls in memory and executes bulk columnar inserts into ClickHouse every 5 seconds or whenever 1,000 events accumulate.

### 3. Native SigNoz & Open-Source Compatibility
Because the payload is standard OTLP/HTTP, it connects natively to:
- **SigNoz** via `https://signoz.yourdomain.com/v1/logs` with zero custom collector setup.
- Standalone **otel-collector-contrib** using the `clickhouseexporter`.
- Any OTLP-compatible backend (HyperDX, Grafana Loki, Datadog).

### 4. D1 as an Offline / Resiliency Fallback
Cloudflare D1 is retained as an optional fallback mechanism: if the OTel Collector endpoint is unreachable or temporarily down, the worker can spill events to D1 to guarantee zero data loss.

---

## Consequences
- **Positive:**
  - **Near Real-Time:** Dashboard updates in < 5 seconds.
  - **Zero Custom ETL Maintenance:** Eliminates the need for Python sync cron jobs.
  - **Zero D1 Quota Consumption:** No database writes on Cloudflare.
  - **True SRE Unification:** Web analytics and application APM reside in the same ClickHouse cluster via the same OpenTelemetry pipeline.
- **Negative:**
  - Requires the OTel Collector HTTP endpoint (`/v1/logs`) to be reachable from the edge worker (easily satisfied via Cloudflare Tunnels or public edge ingress).
