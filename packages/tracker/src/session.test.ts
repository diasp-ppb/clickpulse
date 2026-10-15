import { describe, it, expect, beforeEach, vi } from "vitest";
import { getOrCreateSessionId } from "./session";

describe("Session Management (getOrCreateSessionId)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it("generates a valid UUID and marks isNewSession: true on first call", () => {
    const { sessionId, isNewSession } = getOrCreateSessionId();

    expect(isNewSession).toBe(true);
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(sessionStorage.getItem("_cp_sid")).toBe(sessionId);
    expect(sessionStorage.getItem("_cp_act")).toBeTruthy();
  });

  it("reuses existing session and marks isNewSession: false within timeout window", () => {
    const first = getOrCreateSessionId();
    expect(first.isNewSession).toBe(true);

    const second = getOrCreateSessionId();
    expect(second.isNewSession).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("rotates session ID and sets isNewSession: true after inactivity timeout", () => {
    vi.useFakeTimers();

    const first = getOrCreateSessionId();
    expect(first.isNewSession).toBe(true);

    // Advance time by 31 minutes (exceeds default 30m timeout)
    vi.advanceTimersByTime(31 * 60 * 1000);

    const second = getOrCreateSessionId();
    expect(second.isNewSession).toBe(true);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it("keeps session active when user interacts within timeout window", () => {
    vi.useFakeTimers();

    const first = getOrCreateSessionId();

    // Advance 20 minutes (within 30m window)
    vi.advanceTimersByTime(20 * 60 * 1000);
    const middle = getOrCreateSessionId();
    expect(middle.sessionId).toBe(first.sessionId);
    expect(middle.isNewSession).toBe(false);

    // Advance another 20 minutes (total 40m, but only 20m since last active)
    vi.advanceTimersByTime(20 * 60 * 1000);
    const last = getOrCreateSessionId();
    expect(last.sessionId).toBe(first.sessionId);
    expect(last.isNewSession).toBe(false);
  });

  it("handles sessionStorage disabled or throwing gracefully", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: Access Denied");
    });

    const session = getOrCreateSessionId();
    expect(session.sessionId).toBeTruthy();
    expect(session.isNewSession).toBe(true);

    vi.restoreAllMocks();
  });

  it("generates valid RFC 4122 v4 UUID when crypto.randomUUID is unavailable", () => {
    const origCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      writable: true,
      configurable: true
    });

    const session = getOrCreateSessionId();
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    Object.defineProperty(globalThis, "crypto", {
      value: origCrypto,
      writable: true,
      configurable: true
    });
  });
});
