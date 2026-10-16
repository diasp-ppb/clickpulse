/**
 * ClickPulse: Anonymous Visitor Hashing
 * Computes HMAC-SHA-256(salt_secret, site_id + ip + user_agent + date)
 * Raw IP address is NEVER stored or sent to ClickHouse.
 */

export async function computeVisitorId(
  siteId: string,
  ip: string,
  userAgent: string,
  saltSecret: string
): Promise<string> {
  // Deterministic daily date component (UTC)
  const today = new Date().toISOString().slice(0, 10);
  // Delimit fields with newlines to prevent delimiter-injection attacks (e.g. colons in IPv6 or User-Agent)
  const message = `${siteId}\n${ip}\n${userAgent}\n${today}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(saltSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
