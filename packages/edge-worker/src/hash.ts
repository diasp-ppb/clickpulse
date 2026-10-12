/**
 * ClickPulse: Anonymous Visitor Hashing
 * Computes SHA-256(site_id + ip + user_agent + daily_salt)
 * Raw IP address is NEVER stored or sent to ClickHouse.
 */

export async function computeVisitorId(
  siteId: string,
  ip: string,
  userAgent: string,
  saltSecret: string
): Promise<string> {
  // Deterministic daily salt component
  const today = new Date().toISOString().slice(0, 10);
  const input = `${siteId}:${ip}:${userAgent}:${saltSecret}:${today}`;

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
