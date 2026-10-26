/**
 * ClickPulse Edge Worker: Shared environment bindings.
 *
 * Kept in its own module so that consumers (ingestion handler, D1 drainer,
 * clients) can import the Env type without creating circular imports.
 */

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
