/**
 * ClickPulse Edge Worker: Direct OpenTelemetry (OTLP/HTTP) Exporter
 * Formats validated web events into standard OTLP JSON logs and sends them to OTel Collector / SigNoz.
 */

import { ValidatedEvent } from "./schema";

export interface OtlpExportOptions {
  endpoint: string;
  authToken?: string;
}

export async function sendOtlpLog(
  event: ValidatedEvent,
  visitorId: string,
  options: OtlpExportOptions
): Promise<Response> {
  const url = options.endpoint.endsWith("/v1/logs")
    ? options.endpoint
    : `${options.endpoint.replace(/\/$/, "")}/v1/logs`;

  // Parse custom event_data if present to attach as attributes
  let parsedCustomData: Record<string, unknown> = {};
  try {
    parsedCustomData = JSON.parse(event.event_data || "{}");
  } catch {
    parsedCustomData = {};
  }

  const customAttributes = Object.entries(parsedCustomData).map(([key, val]) => ({
    key: `custom.${key}`,
    value:
      typeof val === "number"
        ? Number.isInteger(val)
          ? { intValue: val.toString() }
          : { doubleValue: val }
        : typeof val === "boolean"
        ? { boolValue: val }
        : { stringValue: String(val) }
  }));

  const logAttributes = [
    { key: "event.name", value: { stringValue: event.event } },
    { key: "event.domain", value: { stringValue: "web_analytics" } },
    { key: "site.id", value: { stringValue: event.site_id } },
    { key: "session.id", value: { stringValue: event.session_id } },
    { key: "visitor.id", value: { stringValue: visitorId } },
    { key: "http.target", value: { stringValue: event.path } },
    { key: "http.referrer", value: { stringValue: event.referrer } },
    { key: "utm.source", value: { stringValue: event.utm_source } },
    { key: "utm.medium", value: { stringValue: event.utm_medium } },
    { key: "utm.campaign", value: { stringValue: event.utm_campaign } },
    { key: "geo.country", value: { stringValue: event.country } },
    { key: "device.type", value: { stringValue: event.device_type } },
    { key: "browser.name", value: { stringValue: event.browser } },
    ...customAttributes
  ];

  const otlpPayload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "clickpulse" } },
            { key: "service.namespace", value: { stringValue: "web-analytics" } },
            { key: "site.id", value: { stringValue: event.site_id } }
          ]
        },
        scopeLogs: [
          {
            scope: {
              name: "clickpulse.tracker",
              version: "0.1.0"
            },
            logRecords: [
              {
                timeUnixNano: (BigInt(event.ts) * 1_000_000n).toString(),
                severityNumber: 9, // INFO
                severityText: "INFO",
                body: { stringValue: event.event }, // 'pageview', 'outbound_click', etc.
                attributes: logAttributes
              }
            ]
          }
        ]
      }
    ]
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (options.authToken) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
    // Support SigNoz Ingestion Key header convention if applicable
    headers["signoz-access-token"] = options.authToken;
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(otlpPayload)
  });
}
