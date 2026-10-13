import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, track, pageview, ClickPulseTracker } from "./index";

describe("ClickPulse Tracker SDK", () => {
  let trackerInstance: ClickPulseTracker | undefined;
  let sentPayloads: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    sessionStorage.clear();
    sentPayloads = [];
    document.title = "Test Page Title";

    // Mock fetch
    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      if (options?.body) {
        sentPayloads.push(JSON.parse(options.body as string));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Mock sendBeacon
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn().mockImplementation((_url, data) => {
        if (data instanceof Blob) {
          // In Node/Happy-dom, read blob synchronously or mock
          const reader = new FileReader();
          reader.readAsText(data);
        }
        return false; // Return false so fetch is invoked and payload captured in sentPayloads
      }),
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    trackerInstance?.destroy();
  });

  it("automatically tracks pageview with is_new_session: true on init", () => {
    trackerInstance = init({
      endpoint: "/api/analytics",
      siteId: "my-site",
      autoPageview: true,
      trackOutbound: false
    });

    expect(sentPayloads).toHaveLength(1);
    const payload = sentPayloads[0];

    expect(payload.site_id).toBe("my-site");
    expect(payload.event).toBe("pageview");
    expect(payload.session_id).toBeTruthy();
    expect(payload.data).toEqual(
      expect.objectContaining({
        is_new_session: true,
        title: "Test Page Title"
      })
    );
  });

  it("omits is_new_session on subsequent events within the same session", () => {
    trackerInstance = init({
      endpoint: "/api/analytics",
      siteId: "my-site",
      autoPageview: true,
      trackOutbound: false
    });

    track("button_click", { button_id: "subscribe" });

    expect(sentPayloads).toHaveLength(2);

    const firstEvent = sentPayloads[0];
    const secondEvent = sentPayloads[1];

    expect(firstEvent.data).toEqual(
      expect.objectContaining({ is_new_session: true })
    );
    expect(secondEvent.data).toEqual({ button_id: "subscribe" });
    expect(secondEvent.session_id).toBe(firstEvent.session_id);
  });

  it("extracts and truncates UTM parameters from window.location.search", () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        search: "?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale_2026",
        pathname: "/landing-page"
      },
      writable: true,
      configurable: true
    });

    trackerInstance = init({
      endpoint: "/api/analytics",
      siteId: "my-site",
      autoPageview: false,
      trackOutbound: false
    });

    track("signup_start");

    expect(sentPayloads).toHaveLength(1);
    const payload = sentPayloads[0];

    expect(payload.utm_source).toBe("google");
    expect(payload.utm_medium).toBe("cpc");
    expect(payload.utm_campaign).toBe("summer_sale_2026");

    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true
    });
  });

  it("enforces length bounds on string fields", () => {
    trackerInstance = init({
      endpoint: "/api/analytics",
      siteId: "my-site",
      autoPageview: false,
      trackOutbound: false
    });

    const veryLongEvent = "a".repeat(100);
    track(veryLongEvent);

    expect(sentPayloads).toHaveLength(1);
    expect((sentPayloads[0].event as string).length).toBe(50);
  });

  it("delegates global helper pageview() correctly", () => {
    trackerInstance = init({
      endpoint: "/api/analytics",
      siteId: "my-site",
      autoPageview: false,
      trackOutbound: false
    });

    pageview("Custom Title Override");

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].data).toEqual(
      expect.objectContaining({
        title: "Custom Title Override"
      })
    );
  });
});
