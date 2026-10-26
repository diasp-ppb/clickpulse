import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drainD1Buffer } from "./drain";
import type { Env } from "./env";

function makeRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    created_at: "2026-10-18T20:00:00.000Z",
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
    event_data: "{}",
    ...overrides
  };
}

function makeDb(
  batches: any[][],
  opts: { deleteError?: Error; selectError?: Error } = {}
) {
  const queue = [...batches];

  const deleteRun = vi.fn().mockImplementation(async () => {
    if (opts.deleteError) throw opts.deleteError;
    return { success: true };
  });
  const deleteBind = vi.fn().mockReturnValue({ run: deleteRun });

  const selectAll = vi.fn().mockImplementation(async () => {
    if (opts.selectError) throw opts.selectError;
    return { results: queue.length > 0 ? queue.shift() : [] };
  });

  const prepare = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("SELECT")) {
      return { bind: vi.fn().mockReturnValue({ all: selectAll }) };
    }
    return { bind: deleteBind };
  });

  return { db: { prepare } as any, prepare, selectAll, deleteBind, deleteRun };
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com",
    CLICKHOUSE_USER: "sync_worker",
    CLICKHOUSE_PASSWORD: "secret_password",
    CF_ACCESS_CLIENT_ID: "cf-id",
    CF_ACCESS_CLIENT_SECRET: "cf-secret",
    ...overrides
  };
}

describe("D1 Spool Buffer Drain (drain.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails safely when D1 or the ClickHouse endpoint is not configured", async () => {
    const resNoDb = await drainD1Buffer({ CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com" });
    expect(resNoDb.success).toBe(false);
    expect(resNoDb.processed).toBe(0);
    expect(resNoDb.error).toContain("D1");

    const resNoCh = await drainD1Buffer({ DB: {} as any });
    expect(resNoCh.success).toBe(false);
    expect(resNoCh.processed).toBe(0);
    expect(resNoCh.error).toContain("ClickHouse");
  });

  it("returns success when no records are in the D1 buffer", async () => {
    const { db, prepare } = makeDb([[]]);

    const res = await drainD1Buffer(baseEnv({ DB: db }));

    expect(res).toEqual({ processed: 0, batches: 0, success: true, hasMore: false });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("drains a batch, waits for ClickHouse to persist it, then clears the spool", async () => {
    const { db, deleteBind, deleteRun } = makeDb([[makeRow(101), makeRow(102, { path: "/pricing" })], []]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const res = await drainD1Buffer(baseEnv({ DB: db }));

    expect(res).toEqual({ processed: 2, batches: 1, success: true, hasMore: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, reqOptions] = fetchSpy.mock.calls[0] as [string, any];
    expect(url).toContain("https://clickhouse.example.com/?query=INSERT+INTO+clickpulse.analytics_events");
    expect(url).toContain("async_insert=1");
    // Critical: the spooled row is the only remaining copy, so the insert must
    // be acknowledged by ClickHouse before deletion.
    expect(url).toContain("wait_for_async_insert=1");
    expect(reqOptions.headers["CF-Access-Client-Id"]).toBe("cf-id");
    expect(reqOptions.headers["X-ClickHouse-User"]).toBe("sync_worker");

    const lines = reqOptions.body.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).path).toBe("/docs");
    expect(JSON.parse(lines[1]).path).toBe("/pricing");

    expect(deleteBind).toHaveBeenCalledWith(101, 102);
    expect(deleteRun).toHaveBeenCalledTimes(1);
  });

  it("keeps records in D1 when ClickHouse responds with an error", async () => {
    const { db, deleteRun } = makeDb([[makeRow(50)]]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ClickHouse Out of Memory", { status: 500 })
    );

    const res = await drainD1Buffer(baseEnv({ DB: db }));

    expect(res.processed).toBe(0);
    expect(res.success).toBe(false);
    expect(res.hasMore).toBe(true);
    expect(res.error).toContain("HTTP 500");
    expect(deleteRun).not.toHaveBeenCalled();
  });

  it("reports a failed run if D1 cleanup fails after a successful insert", async () => {
    const { db, selectAll } = makeDb([[makeRow(7), makeRow(8)]], {
      deleteError: new Error("D1 write quota exceeded")
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    const res = await drainD1Buffer(baseEnv({ DB: db }));

    expect(res.success).toBe(false);
    expect(res.processed).toBe(2);
    expect(res.error).toContain("cleanup failed");
    expect(res.error).toContain("duplicates");
    // No silent retry loop: the run stops and surfaces the inconsistency.
    expect(selectAll).toHaveBeenCalledTimes(1);
  });

  it("loops until the buffer is empty", async () => {
    const { db } = makeDb([[makeRow(1)], [makeRow(2)], []]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const res = await drainD1Buffer(baseEnv({ DB: db }));

    expect(res).toEqual({ processed: 2, batches: 2, success: true, hasMore: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stops at maxBatches and flags that more events are pending", async () => {
    const { db } = makeDb([[makeRow(1)], [makeRow(2)], [makeRow(3)]]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const res = await drainD1Buffer(baseEnv({ DB: db }), 500, 2);

    expect(res).toEqual({ processed: 2, batches: 2, success: true, hasMore: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("aborts the ClickHouse request when it hangs", async () => {
    vi.useFakeTimers();
    const { db } = makeDb([[makeRow(9)]]);

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const pending = drainD1Buffer(baseEnv({ DB: db }));
    await vi.advanceTimersByTimeAsync(5_100);
    const res = await pending;

    expect(res.success).toBe(false);
    expect(res.error).toContain("timed out");
  });

  it("fails cleanly when the D1 read itself errors", async () => {
    const { db } = makeDb([], { selectError: new Error("D1 unavailable") });

    const res = await drainD1Buffer(baseEnv({ DB: db }));

    expect(res.success).toBe(false);
    expect(res.error).toContain("D1 buffer read failed");
  });
});
