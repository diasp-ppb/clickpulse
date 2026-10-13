import { describe, it, expect } from "vitest";
import { computeVisitorId } from "./hash";

describe("Anonymous Visitor Hash (computeVisitorId)", () => {
  it("computes a deterministic 64-character SHA-256 hex string", async () => {
    const hash = await computeVisitorId(
      "my-site",
      "192.168.1.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "secret-salt-123"
    );

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces identical hashes for identical inputs on the same day", async () => {
    const hash1 = await computeVisitorId("siteA", "1.2.3.4", "UA-String", "salt");
    const hash2 = await computeVisitorId("siteA", "1.2.3.4", "UA-String", "salt");

    expect(hash1).toBe(hash2);
  });

  it("produces completely different hashes when salt or site changes", async () => {
    const base = await computeVisitorId("siteA", "1.2.3.4", "UA-String", "salt-1");
    const differentSalt = await computeVisitorId("siteA", "1.2.3.4", "UA-String", "salt-2");
    const differentSite = await computeVisitorId("siteB", "1.2.3.4", "UA-String", "salt-1");

    expect(base).not.toBe(differentSalt);
    expect(base).not.toBe(differentSite);
  });
});
