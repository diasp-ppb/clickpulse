import { describe, it, expect } from "vitest";
import { validateAndSanitize } from "./schema";

describe("Edge Worker Schema Validation & Sanitization", () => {
  const createMockRequest = (headers: Record<string, string> = {}) => {
    return new Request("https://edge.clickpulse.io/api/analytics", {
      method: "POST",
      headers: new Headers({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ...headers
      })
    });
  };

  it("accepts valid standard payloads (pageview, outbound_click, session_start)", () => {
    const req = createMockRequest();
    const raw = {
      site_id: "example.com",
      session_id: "c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd",
      event: "pageview",
      path: "/pricing",
      referrer: "https://google.com",
      utm_source: "google",
      utm_medium: "search",
      utm_campaign: "launch",
      utm_term: "analytics",
      utm_content: "header_cta",
      ts: Date.now(),
      data: { is_new_session: true, plan: "pro" }
    };

    const result = validateAndSanitize(raw, req);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.site_id).toBe("example.com");
      expect(result.event.event).toBe("pageview");
      expect(result.event.utm_term).toBe("analytics");
      expect(result.event.utm_content).toBe("header_cta");
      expect(result.event.device_type).toBe("desktop");
      expect(result.event.browser).toBe("Chrome");
      expect(JSON.parse(result.event.event_data)).toEqual({
        is_new_session: true,
        plan: "pro"
      });
    }
  });

  it("accepts custom:* prefixed events", () => {
    const req = createMockRequest();
    const raw = {
      site_id: "example.com",
      session_id: "c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd",
      event: "custom:checkout_completed",
      ts: Date.now()
    };

    const result = validateAndSanitize(raw, req);
    expect(result.valid).toBe(true);
  });

  it("rejects invalid or missing site_id", () => {
    const req = createMockRequest();
    const result = validateAndSanitize(
      { session_id: "123", event: "pageview" },
      req
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("site_id");
    }
  });

  it("rejects disallowed event types", () => {
    const req = createMockRequest();
    const result = validateAndSanitize(
      {
        site_id: "example.com",
        session_id: "123",
        event: "arbitrary_unallowed_event"
      },
      req
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("Disallowed or invalid event_type");
    }
  });

  it("rejects timestamps with drift exceeding 5 minutes", () => {
    const req = createMockRequest();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const result = validateAndSanitize(
      {
        site_id: "example.com",
        session_id: "123",
        event: "pageview",
        ts: tenMinutesAgo
      },
      req
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("Timestamp drift exceeds 5 minutes");
    }
  });

  it("truncates oversized strings defensively", () => {
    const req = createMockRequest();
    const longPath = "/page/" + "x".repeat(300);
    const longRef = "https://example.com/" + "y".repeat(600);

    const result = validateAndSanitize(
      {
        site_id: "example.com",
        session_id: "123",
        event: "pageview",
        path: longPath,
        referrer: longRef,
        ts: Date.now()
      },
      req
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.path.length).toBeLessThanOrEqual(255);
      expect(result.event.referrer.length).toBeLessThanOrEqual(500);
    }
  });

  it("sanitizes custom event data to primitive values only and caps at 10 keys", () => {
    const req = createMockRequest();
    const rawData: Record<string, any> = {};
    for (let i = 0; i < 15; i++) {
      rawData[`key_${i}`] = `value_${i}`;
    }
    rawData["nested_obj"] = { ignored: true }; // Should be omitted or ignored

    const result = validateAndSanitize(
      {
        site_id: "example.com",
        session_id: "123",
        event: "pageview",
        data: rawData,
        ts: Date.now()
      },
      req
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      const parsed = JSON.parse(result.event.event_data);
      expect(Object.keys(parsed).length).toBeLessThanOrEqual(10);
      expect(parsed["nested_obj"]).toBeUndefined();
    }
  });
});
