/**
 * ClickPulse: Protected Direct ClickHouse Ingestion Client
 * Posts flat event JSON directly to ClickHouse HTTP interface with async_insert=1.
 * Supports Cloudflare Access Service Tokens for Zero Trust network protection.
 */

import { ValidatedEvent } from "./schema";

export interface ClickHouseConfig {
  endpoint: string; // e.g., "https://clickhouse.yourdomain.com"
  database?: string;
  table?: string;
  user?: string;
  password?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  timeoutMs?: number;
}

export async function sendDirectToClickHouse(
  event: ValidatedEvent,
  visitorId: string,
  config: ClickHouseConfig
): Promise<Response> {
  const db = config.database || "clickpulse";
  const table = config.table || "analytics_events";
  const timeoutMs = config.timeoutMs || 800; // 800ms fast failover

  const url = `${config.endpoint.replace(/\/$/, "")}/?query=INSERT+INTO+${db}.${table}+FORMAT+JSONEachRow&async_insert=1&wait_for_async_insert=0`;

  const row = {
    created_at: new Date(event.ts).toISOString(),
    site_id: event.site_id,
    event_type: event.event,
    visitor_id: visitorId,
    session_id: event.session_id,
    path: event.path,
    referrer: event.referrer,
    utm_source: event.utm_source,
    utm_medium: event.utm_medium,
    utm_campaign: event.utm_campaign,
    country: event.country,
    device_type: event.device_type,
    browser: event.browser,
    event_data: event.event_data
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (config.user) {
    headers["X-ClickHouse-User"] = config.user;
  }
  if (config.password) {
    headers["X-ClickHouse-Key"] = config.password;
  }

  // Zero Trust Network Shield: Cloudflare Access Service Token
  if (config.cfAccessClientId && config.cfAccessClientSecret) {
    headers["CF-Access-Client-Id"] = config.cfAccessClientId;
    headers["CF-Access-Client-Secret"] = config.cfAccessClientSecret;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(row),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
