/**
 * ClickPulse: Edge Ingestion Worker (Cloudflare Worker / Pages Function)
 * Ingests, validates, hashes, and dispatches web telemetry events.
 *
 * Supported Modes:
 * 1. Direct Protected ClickHouse: POST /?async_insert=1 (Zero Trust Tunnel + D1 Spool fallback)
 * 2. OpenTelemetry (OTLP/HTTP): POST /v1/logs
 * 3. Offline Buffer: Cloudflare D1 Spool
 */

import { validateAndSanitize } from "./schema";
import { computeVisitorId } from "./hash";
import { sendDirectToClickHouse } from "./clickhouse";
import { sendOtlpLog } from "./otlp";

export interface Env {
  DB?: D1Database;
  SALT_SECRET?: string;
  ALLOWED_ORIGINS?: string;

  // Direct Protected ClickHouse Ingestion (Primary)
  CLICKHOUSE_ENDPOINT?: string; // e.g., "https://clickhouse.yourdomain.com"
  CLICKHOUSE_USER?: string; // e.g., "clickpulse_worker"
  CLICKHOUSE_PASSWORD?: string;
  CLICKHOUSE_DATABASE?: string; // Defaults to "clickpulse"
  CLICKHOUSE_TABLE?: string; // Defaults to "analytics_events"
  CF_ACCESS_CLIENT_ID?: string; // Cloudflare Access Zero Trust Service Token ID
  CF_ACCESS_CLIENT_SECRET?: string; // Cloudflare Access Zero Trust Service Token Secret

  // Optional OpenTelemetry Collector Mode
  OTEL_EXPORTER_OTLP_ENDPOINT?: string; // e.g., "https://collector.yourdomain.com"
  OTEL_AUTH_TOKEN?: string;
}

function getCorsHeaders(origin: string | null, allowedOriginsStr?: string): HeadersInit {
  const allowed = allowedOriginsStr
    ? allowedOriginsStr.split(",").map((s) => s.trim())
    : ["*"];

  const allowOrigin =
    allowed.includes("*") || (origin && allowed.includes(origin))
      ? origin || "*"
      : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const corsHeaders = getCorsHeaders(origin, env.ALLOWED_ORIGINS);

    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 2. Enforce POST method only
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 3. Request Size Guard (< 4 KB)
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    if (contentLength > 4096) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    try {
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON format" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // 4. Validate and Sanitize Schema
      const validation = validateAndSanitize(rawBody, request);
      if (!validation.valid) {
        return new Response(JSON.stringify({ error: validation.reason }), {
          status: 422,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const event = validation.event;

      // 5. Compute Anonymous Visitor Hash (Zero PII, Raw IP discarded immediately)
      const clientIp =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-real-ip") ||
        "127.0.0.1";
      const userAgent = request.headers.get("user-agent") || "";
      const saltSecret = env.SALT_SECRET || "default-clickpulse-salt-change-me";

      const visitorId = await computeVisitorId(
        event.site_id,
        clientIp,
        userAgent,
        saltSecret
      );

      // 6. Ingestion Strategy
      let ingested = false;

      // Mode A: Direct Protected ClickHouse (async_insert=1)
      if (env.CLICKHOUSE_ENDPOINT) {
        try {
          const chResp = await sendDirectToClickHouse(event, visitorId, {
            endpoint: env.CLICKHOUSE_ENDPOINT,
            database: env.CLICKHOUSE_DATABASE,
            table: env.CLICKHOUSE_TABLE,
            user: env.CLICKHOUSE_USER,
            password: env.CLICKHOUSE_PASSWORD,
            cfAccessClientId: env.CF_ACCESS_CLIENT_ID,
            cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET
          });

          if (chResp.ok) {
            ingested = true;
          } else if (env.DB) {
            console.warn(`ClickHouse returned HTTP ${chResp.status}. Spooling to D1 buffer.`);
            await bufferToD1(env.DB, event, visitorId);
            ingested = true;
          }
        } catch (chErr: any) {
          if (env.DB) {
            console.warn(`Failed direct ClickHouse push: ${chErr.message}. Spooling to D1 buffer.`);
            await bufferToD1(env.DB, event, visitorId);
            ingested = true;
          } else {
            throw chErr;
          }
        }
      }

      // Mode B: OpenTelemetry OTLP Collector (Optional)
      if (!ingested && env.OTEL_EXPORTER_OTLP_ENDPOINT) {
        try {
          const otelResp = await sendOtlpLog(event, visitorId, {
            endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
            authToken: env.OTEL_AUTH_TOKEN
          });
          if (otelResp.ok) {
            ingested = true;
          } else if (env.DB) {
            console.warn(`OTel Collector returned HTTP ${otelResp.status}. Spooling to D1 buffer.`);
            await bufferToD1(env.DB, event, visitorId);
            ingested = true;
          }
        } catch (otelErr: any) {
          if (env.DB) {
            console.warn(`Failed OTel push: ${otelErr.message}. Spooling to D1 buffer.`);
            await bufferToD1(env.DB, event, visitorId);
            ingested = true;
          } else {
            throw otelErr;
          }
        }
      }

      // Mode C: Offline D1 Spool (Fallback)
      if (!ingested && env.DB) {
        await bufferToD1(env.DB, event, visitorId);
        ingested = true;
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

async function bufferToD1(db: D1Database, event: any, visitorId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO clickpulse_buffer (
        created_at, site_id, event_type, visitor_id, session_id,
        path, referrer, utm_source, utm_medium, utm_campaign,
        country, device_type, browser, event_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      new Date(event.ts).toISOString(),
      event.site_id,
      event.event,
      visitorId,
      event.session_id,
      event.path,
      event.referrer,
      event.utm_source,
      event.utm_medium,
      event.utm_campaign,
      event.country,
      event.device_type,
      event.browser,
      event.event_data
    )
    .run();
}
