/**
 * ClickPulse: Automated Cloudflare D1 Spool Buffer Drainer
 * Flushes spooled offline buffer events from Cloudflare D1 back into ClickHouse.
 */

import { Env } from "./index";

export interface DrainResult {
  processed: number;
  success: boolean;
}

export async function drainD1Buffer(
  env: Env,
  batchSize: number = 500
): Promise<DrainResult> {
  if (!env.DB || !env.CLICKHOUSE_ENDPOINT) {
    return { processed: 0, success: false };
  }

  // 1. Fetch un-synced events ordered by id
  const selectQuery = `
    SELECT id, created_at, site_id, event_type, visitor_id, session_id,
           path, referrer, utm_source, utm_medium, utm_campaign,
           country, device_type, browser, event_data
    FROM clickpulse_buffer
    ORDER BY id ASC
    LIMIT ?;
  `;

  let results: any[] = [];
  try {
    const queryRes = await env.DB.prepare(selectQuery).bind(batchSize).all();
    results = queryRes.results || [];
  } catch (err: any) {
    console.error("Failed to query D1 buffer:", err.message);
    return { processed: 0, success: false };
  }

  if (results.length === 0) {
    return { processed: 0, success: true };
  }

  // 2. Format rows as JSONEachRow
  const rows = results.map((row) => ({
    created_at: row.created_at,
    site_id: row.site_id,
    event_type: row.event_type,
    visitor_id: row.visitor_id,
    session_id: row.session_id,
    path: row.path || "/",
    referrer: row.referrer || "",
    utm_source: row.utm_source || "",
    utm_medium: row.utm_medium || "",
    utm_campaign: row.utm_campaign || "",
    country: row.country || "",
    device_type: row.device_type || "desktop",
    browser: row.browser || "other",
    event_data: row.event_data || "{}"
  }));

  const db = env.CLICKHOUSE_DATABASE || "clickpulse";
  const table = env.CLICKHOUSE_TABLE || "analytics_events";
  const url = `${env.CLICKHOUSE_ENDPOINT.replace(
    /\/$/,
    ""
  )}/?query=INSERT+INTO+${db}.${table}+FORMAT+JSONEachRow&async_insert=1&wait_for_async_insert=0&date_time_input_format=best_effort`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (env.CLICKHOUSE_USER) {
    headers["X-ClickHouse-User"] = env.CLICKHOUSE_USER;
  }
  if (env.CLICKHOUSE_PASSWORD) {
    headers["X-ClickHouse-Key"] = env.CLICKHOUSE_PASSWORD;
  }
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }

  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");

  try {
    const chResp = await fetch(url, {
      method: "POST",
      headers,
      body: ndjson
    });

    if (!chResp.ok) {
      const errText = await chResp.text().catch(() => "");
      console.error(`ClickHouse drain push failed (HTTP ${chResp.status}):`, errText);
      return { processed: 0, success: false };
    }

    // 3. Delete drained records up to max ID
    const maxId = results[results.length - 1].id;
    await env.DB.prepare("DELETE FROM clickpulse_buffer WHERE id <= ?")
      .bind(maxId)
      .run();

    return { processed: results.length, success: true };
  } catch (err: any) {
    console.error("ClickHouse drain connection error:", err.message);
    return { processed: 0, success: false };
  }
}
