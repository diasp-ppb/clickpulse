---
name: domain-modeling
description: Sharpen ClickPulse domain concepts and maintain ADR records in docs/adr/.
---

# Domain Modeling & Architecture Decision Records (ADRs)

Sharpen codebase terminology and document architectural trade-offs.

## Core Concepts
- **`site_id`**: Tenant identifier; leading column in ClickHouse primary sorting key.
- **`visitor_id`**: Pseudonymous 64-char hex string derived daily via HMAC-SHA256 (`daily_salt + IP + UserAgent`).
- **`session_id`**: Ephemeral UUID stored in browser `sessionStorage`, rolling 30-minute inactivity expiry.
- **`async_insert`**: ClickHouse native buffer mechanism writing flat rows into memory parts before disk flush.
- **`Shock Absorber`**: D1 spool table capturing events during ClickHouse downtime.

## When to write an ADR (`docs/adr/`)
Create an ADR when an architectural decision is:
1. Hard to reverse
2. Has significant impact on data durability, GDPR compliance, or network latency
3. Involves a genuine trade-off between simplicity and resilience
