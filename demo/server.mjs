/**
 * ClickPulse: Local Playground Dev Server & Ingestion Gateway
 * Zero-dependency Node.js server.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = parseInt(process.env.PORT || "8080", 10);
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_ENDPOINT || "http://127.0.0.1:8123";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const server = http.createServer(async (req, res) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // 2. Ingestion Endpoint: POST /api/analytics
  if (req.method === "POST" && url.pathname === "/api/analytics") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);

        // Map into ClickHouse analytics_events schema
        const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
        const userAgent = req.headers["user-agent"] || "";

        // Simple local visitor hash
        const visitorId = Buffer.from(`${payload.site_id}:${clientIp}:${userAgent.slice(0, 50)}`)
          .toString("hex")
          .slice(0, 64)
          .padEnd(64, "0");

        const row = {
          created_at: new Date(payload.ts || Date.now()).toISOString().replace("T", " ").replace("Z", ""),
          site_id: payload.site_id || "demo-store",
          event_type: (payload.event || "pageview").slice(0, 50),
          visitor_id: visitorId,
          session_id: payload.session_id || "00000000-0000-0000-0000-000000000000",
          path: (payload.path || "/").slice(0, 255),
          referrer: (payload.referrer || "").slice(0, 500),
          utm_source: payload.utm_source || "",
          utm_medium: payload.utm_medium || "",
          utm_campaign: payload.utm_campaign || "",
          country: "LOCAL",
          device_type: "desktop",
          browser: "browser",
          event_data: payload.data ? JSON.stringify(payload.data) : "{}"
        };

        const chUrl = `${CLICKHOUSE_HOST.replace(/\/$/, "")}/?query=INSERT+INTO+clickpulse.analytics_events+FORMAT+JSONEachRow&async_insert=1&wait_for_async_insert=0&date_time_input_format=best_effort`;

        try {
          const chResp = await fetch(chUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(row)
          });

          if (!chResp.ok) {
            const err = await chResp.text();
            console.warn(`[Ingest Warning] ClickHouse returned ${chResp.status}:`, err.slice(0, 200));
          } else {
            console.log(`[Ingest] Ingested '${row.event_type}' for path '${row.path}'`);
          }
        } catch (fetchErr) {
          console.warn("[Ingest Warning] ClickHouse offline (buffer simulation):", fetchErr.message);
        }

        res.writeHead(200, { "Content-Type": "application/json", ...CORS_HEADERS });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", ...CORS_HEADERS });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // 3. Serve tracker assets
  if (url.pathname === "/tracker.min.js" || url.pathname === "/tracker.js") {
    const assetPath = path.join(ROOT, "public", path.basename(url.pathname));
    if (fs.existsSync(assetPath)) {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
        ...CORS_HEADERS
      });
      fs.createReadStream(assetPath).pipe(res);
      return;
    }
  }

  // 4. Fallback to demo index.html for SPA routes
  const demoHtmlPath = path.join(__dirname, "index.html");
  if (fs.existsSync(demoHtmlPath)) {
    res.writeHead(200, { "Content-Type": "text/html", ...CORS_HEADERS });
    fs.createReadStream(demoHtmlPath).pipe(res);
    return;
  }

  res.writeHead(404, CORS_HEADERS);
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n⚡ ClickPulse Local Playground running at http://localhost:${PORT}`);
  console.log(`   Connected to ClickHouse at: ${CLICKHOUSE_HOST}\n`);
});
