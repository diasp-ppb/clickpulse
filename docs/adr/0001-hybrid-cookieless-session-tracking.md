# ADR 0001: Hybrid Cookieless Session Tracking

## Status
Accepted

## Context
Traditional web analytics platforms (Google Analytics, Adobe) track users using persistent first- or third-party cookies. Under the European Union ePrivacy Directive and GDPR (as well as guidelines from CNIL, ICO, and EDPB), storing non-essential persistent identifiers on a client's device requires explicit, informed opt-in consent (the ubiquitous "cookie consent banner").

Websites implementing cookie banners face:
1. Significant UX friction and drop-off.
2. 30% to 60% loss of tracking data due to user rejections.
3. Increased bundle weight and legal compliance overhead.

We need a session and visitor tracking mechanism that fulfills two competing goals:
1. **Accurate Web Analytics:** Accurately measure unique daily visitors, distinct user sessions, bounce rates, and session durations.
2. **Strict Privacy Compliance:** 100% cookie-free, zero persistent device fingerprinting, zero storage of Personally Identifiable Information (PII) such as raw IP addresses, and fully exempt from cookie consent banner mandates.

---

## Decision

ClickPulse implements a **Hybrid Privacy Architecture** decoupling **visitor uniqueness** (handled at the edge) from **session continuity** (handled ephemerally in the browser).

### 1. Edge-Side: Cryptographic Daily Rotating Salt (`visitor_id`)
To compute daily unique visitors without storing IP addresses or cookies:
- The edge ingestion handler extracts the client's `IP` and `User-Agent`.
- It retrieves a cryptographic salt (`daily_salt`) that rotates strictly every 24 hours at 00:00 UTC.
- It computes a one-way SHA-256 hash:
  $$\text{visitor\_id} = \text{SHA-256}(\text{site\_id} + \text{client\_ip} + \text{user\_agent} + \text{daily\_salt})$$
- The client IP is immediately discarded and never logged, buffered, or sent to ClickHouse.
- At 00:00 UTC, the previous day's `daily_salt` is permanently deleted. Because the salt is destroyed, it is mathematically impossible to reverse-engineer past hashes or correlate a user's activity across multiple days.

### 2. Client-Side: Ephemeral Session Storage (`session_id`)
To compute bounce rates, session durations, and pages per session:
- The browser tracker generates a random UUID (`crypto.randomUUID()`) upon initial entry.
- This ID is stored strictly in `window.sessionStorage` alongside a timestamp of last user activity.
- A rolling **30-minute inactivity timeout** is enforced: if no interaction occurs for 30 minutes, a fresh `session_id` is generated.
- When the visitor closes the browser tab or window, the `sessionStorage` entry is automatically purged by the browser.

---

## Legal & Compliance Rationale
- **No Cross-Site Tracking:** The `session_id` is strictly scoped to the origin of the current website and does not persist across domains.
- **No Long-Term Fingerprinting:** The `visitor_id` hash resets daily.
- **Consent Exemption:** Under ePrivacy Directive Article 5(3), strictly necessary and ephemeral first-party technical identifiers used solely for anonymous audience measurement do not trigger consent banner obligations under EU regulatory interpretations.

---

## Consequences
- **Positive:**
  - 100% of traffic is measured (no consent-banner drop-off).
  - Zero PII liability: no raw IPs stored in ClickHouse.
  - Sub-second analytical calculations for unique visitors and bounce rates.
- **Negative:**
  - Cannot track multi-day user journeys (e.g., "User visited on Monday, returned on Friday"). This is an intentional privacy trade-off.
