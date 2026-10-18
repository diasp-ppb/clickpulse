---
name: sre-review
description: SRE reliability review protocol for detecting single points of failure (SPOF), buffer overflow risks, and silent drop issues.
---

# SRE Reliability Review Protocol

Trigger an SRE review when modifying ingestion pipelines, network calls, D1 spool schemas, or ClickHouse client configurations.

## 1. Audit Dimensions
- **Shock Absorber Durability**: Can the edge worker buffer at least 24 hours of traffic in Cloudflare D1 during prolonged ClickHouse maintenance?
- **Drain Idempotency**: Does `packages/sync-cli` drain D1 safely without duplicating events in ClickHouse?
- **Resource Sandboxing**: Does the ClickHouse ingestion profile strictly enforce `max_memory_usage = 50MB` and `max_execution_time = 2s`?
- **Silent Failures**: Are rejected events quarantined in `clickpulse.events_rejected` with a clear reason instead of being dropped silently?
- **Network Boundaries**: Are timeouts explicitly configured on all fetch calls?
