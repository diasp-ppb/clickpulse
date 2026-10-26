/**
 * ClickPulse: Automated Cloudflare D1 Spool Buffer Drainer
 * Flushes spooled offline buffer events from Cloudflare D1 back into ClickHouse.
 *
 * Delivery contract:
 * - Rows are only removed from D1 after ClickHouse confirms the insert. The
 *   drain uses `wait_for_async_insert=1` (unlike the fire-and-forget ingestion
 *   path): a 200 from ClickHouse must mean "persisted", because deleting the
 *   spooled row removes the only remaining copy of the event.
 * - Each cron run is bounded in batches and wall-clock time, so a large
 *   backlog is drained progressively instead of timing out the Worker.
 * - Ingest success and spool cleanup are handled separately: if the DELETE
 *   fails, the run is reported as failed (rows may be re-inserted -> possible
 *   duplicates) rather than silently claiming success.
 */

import type { Env } from "./env";

export interface DrainResult {
  /** Events successfully inserted into ClickHouse during this run. */
  processed: number;
  /** Number of batches inserted during this run. */
  batches: number;
  /** True only when the whole drain cycle completed without errors. */
  success: boolean;
  /** True when the run stopped at a batch/time bound with events still pending. */
  hasMore: boolean;
  /** Human readable failure reason (present when success is false). */
  error?: string;
}

export const DEFAULT_BATCH_SIZE = 500;
export const MAX_BATCHES_PER_RUN = 10;

const TIME_BUDGET_MS = 8_000;
const CLICKHOUSE_TIMEOUT_MS = 5_000;

interface SpoolRow {
  id: number;
  created_at: string;
  site_id: string;
  event_type: string;
  visitor_id: string;
  session_id: string;
  path?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  country?: string | null;
  device_type?: string | null;
  browser?: string | null;
  event_data?: string | null;
}

const SELECT_QUERY = `
  SELECT id, created_at, site_id, event_type, visitor_id, session_id,
         path, referrer, utm_source, utm_medium, utm_campaign,
         country, device_type, browser, event_data
  FROM clickpulse_buffer
  ORDER BY id ASC
  LIMIT ?;
`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toClickHouseRows(rows: SpoolRow[]) {
  return rows.map((row) => ({
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
}

async function pushBatch(
  env: Env,
  rows: SpoolRow[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = env.CLICKHOUSE_DATABASE || "clickpulse";
  const table = env.CLICKHOUSE_TABLE || "analytics_events";
  const url =
    `${env.CLICKHOUSE_ENDPOINT!.replace(/\/$/, "")}/?query=INSERT+INTO+${db}.${table}+FORMAT+JSONEachRow` +
    "&async_insert=1&wait_for_async_insert=1&date_time_input_format=best_effort";

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

  const body = toClickHouseRows(rows).map((r) => JSON.stringify(r)).join("\n");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLICKHOUSE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        error: `ClickHouse insert failed (HTTP ${response.status}): ${errText.slice(0, 500)}`
      };
    }

    return { ok: true };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, error: `ClickHouse insert timed out after ${CLICKHOUSE_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `ClickHouse connection error: ${errorMessage(err)}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function drainD1Buffer(
  env: Env,
  batchSize: number = DEFAULT_BATCH_SIZE,
  maxBatches: number = MAX_BATCHES_PER_RUN
): Promise<DrainResult> {
  const notConfigured = (error: string): DrainResult => ({
    processed: 0,
    batches: 0,
    success: false,
    hasMore: false,
    error
  });

  if (!env.DB) {
    return notConfigured("D1 spool database is not configured");
  }
  if (!env.CLICKHOUSE_ENDPOINT) {
    return notConfigured("ClickHouse endpoint is not configured");
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0 || !Number.isInteger(maxBatches) || maxBatches <= 0) {
    return notConfigured(`Invalid drain bounds (batchSize=${batchSize}, maxBatches=${maxBatches})`);
  }

  let processed = 0;
  let batches = 0;
  const deadline = Date.now() + TIME_BUDGET_MS;

  while (batches < maxBatches && Date.now() < deadline) {
    let rows: SpoolRow[];
    try {
      const result = await env.DB.prepare(SELECT_QUERY).bind(batchSize).all<SpoolRow>();
      rows = (result.results || []) as SpoolRow[];
    } catch (err) {
      return {
        processed,
        batches,
        success: false,
        hasMore: false,
        error: `D1 buffer read failed: ${errorMessage(err)}`
      };
    }

    if (rows.length === 0) {
      return { processed, batches, success: true, hasMore: false };
    }

    const push = await pushBatch(env, rows);
    if (!push.ok) {
      return { processed, batches, success: false, hasMore: true, error: push.error };
    }

    processed += rows.length;

    // Rows are in ClickHouse now; only then is it safe to clear the spool.
    const minId = rows[0].id;
    const maxId = rows[rows.length - 1].id;
    try {
      await env.DB.prepare("DELETE FROM clickpulse_buffer WHERE id >= ? AND id <= ?")
        .bind(minId, maxId)
        .run();
    } catch (err) {
      return {
        processed,
        batches,
        success: false,
        hasMore: true,
        error:
          `D1 spool cleanup failed after a successful ClickHouse insert ` +
          `(ids ${minId}-${maxId}); the next run may re-insert duplicates: ${errorMessage(err)}`
      };
    }

    batches++;
  }

  // Stopped on a bound rather than on an empty buffer: more rows may remain.
  return { processed, batches, success: true, hasMore: true };
}
