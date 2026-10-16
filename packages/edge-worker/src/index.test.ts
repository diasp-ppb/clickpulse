import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";

describe("Edge Worker Ingestion Handler (index.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles CORS OPTIONS preflight request", async () => {
    const req = new Request("https://edge.clickpulse.io/api/analytics", {
      method: "OPTIONS"
    });

    // Default configuration allows all (*)
    const resDefault = await worker.fetch(req, {});
    expect(resDefault.status).toBe(204);
    expect(resDefault.headers.get("Access-Control-Allow-Origin")).toBe("*");

    // Specific allowed origins fallback
    const resConfigured = await worker.fetch(req, { ALLOWED_ORIGINS: "https://example.com" });
    expect(resConfigured.status).toBe(204);
    expect(resConfigured.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
  });

  it("handles GET healthcheck request", async () => {
    const req = new Request("https://edge.clickpulse.io/health", { method: "GET" });
    const res = await worker.fetch(req, {});

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("clickpulse-edge");
  });

  it("rejects non-POST/non-GET methods with 405", async () => {
    const req = new Request("https://edge.clickpulse.io/api/analytics", { method: "DELETE" });
    const res = await worker.fetch(req, {});

    expect(res.status).toBe(405);
    const body: any = await res.json();
    expect(body.error).toBe("Method not allowed");
  });

  it("rejects invalid payloads with 422 Unprocessable Entity", async () => {
    const req = new Request("https://edge.clickpulse.io/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: "", event: "invalid_type" })
    });

    const res = await worker.fetch(req, {});
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 502 Bad Gateway if ClickHouse fails and D1 is not configured", async () => {
    // Mock fetch to simulate ClickHouse failure
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("clickhouse")) {
        return new Response("Database unavailable", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    });

    const validPayload = {
      site_id: "example.com",
      session_id: "c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd",
      event: "pageview",
      path: "/",
      ts: Date.now()
    };

    const req = new Request("https://edge.clickpulse.io/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "1.2.3.4",
        "user-agent": "Mozilla/5.0"
      },
      body: JSON.stringify(validPayload)
    });

    const env = {
      CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com"
      // DB (D1) not configured
    };

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.error).toContain("Failed to persist event to any configured destination");
  });

  it("spools to D1 buffer if ClickHouse fails and D1 is configured", async () => {
    // Mock ClickHouse failure
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("clickhouse")) {
        return new Response("Part merge failure", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });

    const runMock = vi.fn().mockResolvedValue({ success: true });
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const mockD1: any = {
      prepare: prepareMock
    };

    const validPayload = {
      site_id: "example.com",
      session_id: "c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd",
      event: "pageview",
      path: "/",
      ts: Date.now()
    };

    const req = new Request("https://edge.clickpulse.io/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "1.2.3.4",
        "user-agent": "Mozilla/5.0"
      },
      body: JSON.stringify(validPayload)
    });

    const env = {
      CLICKHOUSE_ENDPOINT: "https://clickhouse.example.com",
      DB: mockD1
    };

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
