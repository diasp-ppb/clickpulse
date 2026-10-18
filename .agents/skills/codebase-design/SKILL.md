---
name: codebase-design
description: Vocabulary and principles for designing deep modules with narrow interfaces and high testability.
---

# Codebase Design (Deep Modules)

Design **deep modules**: substantial behavior behind a small interface, placed at a clean seam, testable through that interface.

## Core Principles
1. **Depth**: Large capability behind a minimal interface. Avoid shallow pass-through wrappers.
2. **The Deletion Test**: If deleting a module makes complexity vanish, it was shallow. If complexity reappears across callers, it earns its keep.
3. **Seams**: Introduce seams where implementations vary (e.g., ClickHouse HTTP direct vs. D1 fallback buffer).
4. **Locality**: Maintainers can reason about and change internals without touching callers.
