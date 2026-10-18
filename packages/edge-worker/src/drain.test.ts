import { describe, it, expect, vi, beforeEach } from "vitest";
import { drainD1Buffer } from "./drain";
import { Env } from "./index";

describe("D1 Spool Buffer Drain (drain.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns processed: 0 if D1 database or ClickHouse endpoint is not configured", async () => {
    const resNoDb = await drainD1Buffer({ CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com" });
    expect(resNoDb).toEqual({ processed: 0, success: false });

    const resNoCh = await drainD1Buffer({ DB: {} as any });
    expect(resNoCh).toEqual({ processed: 0, success: false });
  });

  it("returns processed: 0 and success: true when no records are in D1 buffer", async () => {
    const mockDb: any = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] })
        })
      })
    };

    const env: Env = {
      DB: mockDb,
      CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com"
    };

    const res = await drainD1Buffer(env);
    expect(res).toEqual({ processed: 0, success: true });
    expect(mockDb.prepare).toHaveBeenCalledTimes(1);
  });

  it("drains buffered events, posts to ClickHouse, and deletes processed rows from D1", async () => {
    const mockRecords = [
      {
        id: 101,
        created_at: "2026-10-18 20:00:00.000",
        site_id: "site-a",
        event_type: "pageview",
        visitor_id: "vis-1",
        session_id: "sess-1",
        path: "/docs",
        referrer: "",
        utm_source: "",
        utm_medium: "",
        utm_campaign: "",
        country: "PT",
        device_type: "desktop",
        browser: "Chrome",
        event_data: "{}"
      },
      {
        id: 102,
        created_at: "2026-10-18 20:01:00.000",
        site_id: "site-a",
        event_type: "pageview",
        visitor_id: "vis-2",
        session_id: "sess-2",
        path: "/pricing",
        referrer: "",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "launch",
        country: "US",
        device_type: "mobile",
        browser: "Safari",
        event_data: "{}"
      }
    ];

    const deleteRunMock = vi.fn().mockResolvedValue({ success: true });
    const deleteBindMock = vi.fn().mockReturnValue({ run: deleteRunMock });

    const selectAllMock = vi.fn().mockResolvedValue({ results: mockRecords });
    const selectBindMock = vi.fn().mockReturnValue({ all: selectAllMock });

    const prepareMock = vi.fn().mockImplementation((query: string) => {
      if (query.includes("SELECT")) {
        return { bind: selectBindMock };
      }
      if (query.includes("DELETE")) {
        return { bind: deleteBindMock };
      }
      return {};
    });

    const mockDb: any = { prepare: prepareMock };

    // Mock global fetch for ClickHouse call
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const env: Env = {
      DB: mockDb,
      CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com",
      CLICKHOUSE_USER: "sync_worker",
      CLICKHOUSE_PASSWORD: "secret_password",
      CF_ACCESS_CLIENT_ID: "cf-id",
      CF_ACCESS_CLIENT_SECRET: "cf-secret"
    };

    const res = await drainD1Buffer(env, 100);

    expect(res).toEqual({ processed: 2, success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify request payload sent to ClickHouse
    const [url, reqOptions] = fetchSpy.mock.calls[0];
    expect(url).toContain("https://clickhouse.example.com/?query=INSERT+INTO+clickpulse.analytics_events");
    expect(url).toContain("async_insert=1");
    expect((reqOptions as any).headers["CF-Access-Client-Id"]).toBe("cf-id");
    expect((reqOptions as any).headers["X-ClickHouse-User"]).toBe("sync_worker");

    const lines = (reqOptions as any).body.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).path).toBe("/docs");
    expect(JSON.parse(lines[1]).path).toBe("/pricing");

    // Verify deletion called up to max id (102)
    expect(deleteBindMock).toHaveBeenCalledWith(102);
    expect(deleteRunMock).toHaveBeenCalledTimes(1);
  });

  it("does not delete records from D1 if ClickHouse responds with an error", async () => {
    const mockRecords = [
      {
        id: 50,
        created_at: "2026-10-18 20:00:00.000",
        site_id: "site-a",
        event_type: "pageview",
        visitor_id: "vis-1",
        session_id: "sess-1",
        path: "/",
        event_data: "{}"
      }
    ];

    const deleteRunMock = vi.fn();
    const selectAllMock = vi.fn().mockResolvedValue({ results: mockRecords });

    const prepareMock = vi.fn().mockImplementation((query: string) => {
      if (query.includes("SELECT")) {
        return { bind: () => ({ all: selectAllMock }) };
      }
      return { bind: () => ({ run: deleteRunMock }) };
    });

    const mockDb: any = { prepare: prepareMock };

    // ClickHouse responds 500 error
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ClickHouse Out of Memory", { status: 500 })
    );

    const env: Env = {
      DB: mockDb,
      CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com"
    };

    const res = await drainD1Buffer(env);

    expect(res.processed).toBe(0);
    expect(res.success).toBe(false);
    expect(deleteRunMock).not.toHaveBeenCalled();
  });
});
