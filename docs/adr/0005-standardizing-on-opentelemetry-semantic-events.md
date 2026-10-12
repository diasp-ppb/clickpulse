# ADR 0005: Standardizing on OpenTelemetry Semantic Events

## Status
Accepted

## Context
When modeling web analytics traffic within OpenTelemetry, teams often ask: *"Does it make sense to push business and web interactions as logs?"*

OpenTelemetry natively provides three primary signals on the wire:
1. **Metrics (`/v1/metrics`):** Aggregated time-series counters and gauges. Metrics fail for web analytics because attaching high-cardinality attributes (`visitor_id`, `session_id`, `path`, `referrer`) triggers cardinality explosions and breaks Prometheus/M3 stores. Furthermore, metrics cannot calculate session bounce rates or unique daily visitors.
2. **Traces (`/v1/traces`):** Distributed execution graphs with parent-child span relationships. Web interactions (such as `pageview` or `outbound_click`) are discrete, point-in-time events. Modeling them as trace spans introduces 10x-50x payload overhead and pollutes expensive APM trace storage.
3. **Logs (`/v1/logs`):** Structured, timestamped event records with arbitrary key-value attributes.

In the official OpenTelemetry specification:
> *"An Event is simply a specialized Log Record."*
OpenTelemetry deliberately avoided creating a fourth `/v1/events` wire endpoint. Instead, the OpenTelemetry Semantic Conventions for Events define that events must be transmitted as Log Records containing `event.name` and `event.domain`.

However, simply dumping web analytics events into the default application logs table (`signoz_logs.logs`) creates serious drawbacks:
- SRE engineers troubleshooting backend outages have their search queries polluted with millions of `pageview` entries.
- Generic log schemas store attributes in key/value arrays or maps, slowing down aggregations compared to dedicated typed columns.

---

## Decision

ClickPulse officially **standardizes on the OpenTelemetry Semantic Conventions for Events** while **strictly isolating web analytics from general application logs**.

### 1. Wire Format: Standard OTLP Event Log Records
The Edge Worker constructs standard OpenTelemetry Log Records:
- **Resource Attributes:**
  - `service.name = "clickpulse"`
  - `service.namespace = "web-analytics"`
  - `site.id = event.site_id`
- **Scope:**
  - `name = "clickpulse.tracker"`
- **Log Record Attributes (OTel Semantic Conventions):**
  - `event.name`: The event identifier (`pageview`, `outbound_click`, `custom:*`).
  - `event.domain`: Strictly set to `"web_analytics"`.
  - Dimensions: `session.id`, `visitor.id`, `http.target`, `http.referrer`, `utm.source`, `utm.medium`, `utm.campaign`, `geo.country`, `device.type`, `browser.name`.

### 2. Pipeline Isolation: Dedicated Table Routing
In the OpenTelemetry Collector configuration:
- The collector exposes standard OTLP endpoints (`:4318` HTTP / `:4317` gRPC).
- Incoming logs where `service.name == "clickpulse"` are routed to a **dedicated ClickHouse exporter** writing directly to `clickpulse.analytics_events`.
- General microservice application logs remain untouched in their respective logs tables (`signoz_logs.logs`).

---

## Consequences

- **Positive:**
  - **Ecosystem Interoperability:** Works out of the box with SigNoz, Grafana Cloud, HyperDX, Datadog, or any collector speaking OTLP.
  - **Batching & Resiliency:** Directly leverages the OTel Collector's Go-based `batch` and `memory_limiter` processors, completely solving ClickHouse's single-row insert bottleneck.
  - **Zero Log Pollution:** SRE application logs remain 100% clean and free of marketing pageview noise.
  - **High Performance:** Data resides in a dedicated, typed `MergeTree` table with sub-millisecond query execution.
- **Negative:**
  - Requires maintaining the OTel Collector pipeline configuration when co-locating with existing enterprise clusters.
