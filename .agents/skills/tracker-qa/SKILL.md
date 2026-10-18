---
name: tracker-qa
description: Quality assurance and verification protocol for the client-side tracker. Use when modifying packages/tracker to verify bundle size, browser compatibility, and privacy compliance.
---

# Tracker QA Protocol

Follow this checklist whenever modifying `packages/tracker/`.

## 1. Quality & Privacy Guardrails
1. **Bundle Size Budget (< 1.5 KB gzipped)**:
   - Run `npm run build`
   - Check compressed size: `gzip -c public/tracker.min.js | wc -c`
   - Must be strictly `<= 1536 bytes`.
2. **Zero Cookies**:
   - Never access or set `document.cookie`.
   - Ensure session state remains strictly in `sessionStorage`.
3. **Session Lifecycle**:
   - Verify 30-minute rolling expiration: new activity resets timestamp; 30 min inactivity generates new `session_id`.
   - Initial session event must carry `{ is_new_session: true }` in `event_data`.
4. **Transport Resilience**:
   - `navigator.sendBeacon` used when available.
   - Graceful fallback to `fetch(..., { keepalive: true })`.

## 2. Test Verification
```bash
# Focused tracker tests
npx vitest run packages/tracker/

# Build and verify bundle
npm run build
```
