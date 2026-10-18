---
name: architecture-keeper
description: Guide to maintain architecture documentation, data flow diagrams, and ADRs in docs/.
---

# Architecture Keeper Protocol

Maintain `README.md` and `docs/adr/` as the single source of truth for ClickPulse system design.

## 1. Living Documentation Points
- **README Data Flow Diagram**: Keep the Mermaid flowchart in `README.md` in sync whenever components, shields, or buffers change.
- **ADRs (`docs/adr/NNNN-<slug>.md`)**: Record architectural decisions when trade-offs involve data durability, privacy guarantees, or external integrations.
- **ClickHouse Queries (`docs/clickhouse-queries.md`)**: Update query examples and explain plans whenever table schemas evolve.
