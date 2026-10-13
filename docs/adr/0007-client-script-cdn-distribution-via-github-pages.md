# ADR 0007: Client Script CDN Distribution via GitHub Pages

## Status
Accepted

## Context
The browser tracking script (`tracker.min.js`, 1.35 KB gzipped) must be embedded across multiple independent consumer properties (such as client websites, blogs, and landing pages).

We evaluated how to deliver the script to client browsers:

1. **Vendoring in Consumer Repositories (Direct File Copy):**
   - *Problem:* Violates DRY (Don't Repeat Yourself). Every update, performance improvement, or bugfix in the tracker requires manually copying `tracker.min.js` and opening commits across multiple repositories.
2. **Serving from the Edge Ingestion Worker (Cloudflare Worker):**
   - *Problem:* Consumes worker CPU execution time and edge invocations on static asset delivery that should ideally be cached by a pure static CDN.
3. **Third-Party NPM CDNs (jsDelivr, unpkg, cdnjs):**
   - *Problem:* Generic CDN domains (`cdn.jsdelivr.net`, `unpkg.com`) are frequently targeted by aggressive browser extensions and ad-blockers, reducing tracking coverage.
4. **GitHub Pages (Static Global CDN):**
   - *Benefits:* Powered by Fastly's global edge network, includes automated SSL, free bandwidth, and is tightly coupled with the repository's git lifecycle.

---

## Decision

We adopt **GitHub Pages** as the primary, automated CDN distribution mechanism for `tracker.min.js` and `tracker.js`.

### 1. Delivery Architecture
- Standalone tracker builds are generated into the [`public/`](../../public/) directory:
  - `tracker.min.js` (2.5 KB uncompressed / 1.25 KB gzipped, minified IIFE).
  - `tracker.js` (unminified with source maps for local debugging).
- GitHub Pages serves the directory directly from:
  ```
  https://<organization>.github.io/clickpulse/tracker.min.js
  ```

### 2. Automated CI/CD Deployment via GitHub Actions
A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) runs on every push to `main`:
1. Checks out the repository.
2. Installs dependencies and executes `npm run build`.
3. Deploys the built `public/` directory to GitHub Pages via the official `actions/deploy-pages` action.

### 3. Consumer Integration Pattern
Consumer websites embed the tracker using a single `<script>` tag pointing to GitHub Pages, while directing event telemetry to the ingestion worker via `data-endpoint`:

```html
<script defer
  src="https://<organization>.github.io/clickpulse/tracker.min.js"
  data-site="my-website"
  data-endpoint="https://analytics.yourdomain.com/api/analytics">
</script>
```

---

## Consequences

- **Positive:**
  - **Zero Maintenance in Consumer Apps:** Client applications never have to vendor or update `.js` files in their static directories.
  - **High Performance:** Global edge delivery with sub-15ms response times backed by Fastly.
  - **Zero Infrastructure Cost:** $0 bandwidth and compute costs.
  - **Clean Separation of Concerns:** Static asset delivery is completely decoupled from the telemetry ingestion compute layer.
- **Negative:**
  - Requires explicitly specifying the `data-endpoint` attribute on consumer sites since the script origin (`github.io`) differs from the analytics ingestion origin (`yourdomain.com`).
