/**
 * ClickPulse Edge Worker: Schema Validation & Sanitization
 */

export interface ValidatedEvent {
  site_id: string;
  session_id: string;
  event: string;
  path: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  country: string;
  device_type: string;
  browser: string;
  event_data: string;
  ts: number;
}

const ALLOWED_EVENT_TYPES = new Set([
  "pageview",
  "outbound_click",
  "session_start",
  "search",
  "signup",
  "conversion"
]);

const BOT_PATTERNS = [
  "bot",
  "spider",
  "crawl",
  "slurp",
  "headless",
  "puppeteer",
  "playwright",
  "selenium",
  "webdriver",
  "lighthouse",
  "ahrefs",
  "semrush",
  "pingdom",
  "uptimerobot",
  "facebookexternalhit",
  "slackbot",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "python-requests",
  "curl",
  "wget"
];

export function isBot(userAgent: string, request?: Request): boolean {
  if (userAgent) {
    const ua = userAgent.toLowerCase();
    if (BOT_PATTERNS.some((pattern) => ua.includes(pattern))) {
      return true;
    }
  }

  if (request) {
    const cf = (request as any).cf;
    if (cf) {
      if (cf.botManagement?.verifiedBot === true) return true;
      if (typeof cf.botManagement?.score === "number" && cf.botManagement.score < 30) return true;
      if (typeof cf.clientTrustScore === "number" && cf.clientTrustScore < 30) return true;
    }
  }

  return false;
}

export type ValidationResult =
  | { valid: true; event: ValidatedEvent; isBot: boolean }
  | { valid: false; reason: string };

export function validateAndSanitize(
  raw: any,
  request: Request
): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, reason: "Payload must be a JSON object" };
  }

  // 1. Site ID
  const siteId = typeof raw.site_id === "string" ? raw.site_id.trim() : "";
  if (!siteId || siteId.length > 100) {
    return { valid: false, reason: "Invalid or missing site_id" };
  }

  // 2. Session ID (UUID)
  const sessionId = typeof raw.session_id === "string" ? raw.session_id.trim() : "";
  if (!sessionId || sessionId.length > 64) {
    return { valid: false, reason: "Invalid session_id" };
  }

  // 3. Event Type (Allow standard list or 'custom:*')
  const event = typeof raw.event === "string" ? raw.event.trim().toLowerCase() : "";
  const isAllowed = ALLOWED_EVENT_TYPES.has(event) || event.startsWith("custom:");
  if (!event || !isAllowed || event.length > 50) {
    return { valid: false, reason: `Disallowed or invalid event_type: ${event}` };
  }

  // 4. Timestamp Sanity (|client_ts - server_ts| <= 5 minutes)
  const serverTime = Date.now();
  const clientTime = typeof raw.ts === "number" ? raw.ts : serverTime;
  if (Math.abs(serverTime - clientTime) > 5 * 60 * 1000) {
    return { valid: false, reason: "Timestamp drift exceeds 5 minutes" };
  }

  // 5. Sanitized path & referrer
  const path = (typeof raw.path === "string" ? raw.path : "/").slice(0, 255);
  const referrer = (typeof raw.referrer === "string" ? raw.referrer : "").slice(0, 500);

  // 6. UTM parameters
  const utm_source = (typeof raw.utm_source === "string" ? raw.utm_source : "").slice(0, 100);
  const utm_medium = (typeof raw.utm_medium === "string" ? raw.utm_medium : "").slice(0, 100);
  const utm_campaign = (typeof raw.utm_campaign === "string" ? raw.utm_campaign : "").slice(0, 100);

  // 7. Request metadata from Cloudflare headers
  const cf = (request as any).cf || {};
  const country = (cf.country || "").slice(0, 2).toUpperCase();

  const userAgent = request.headers.get("user-agent") || "";
  const botDetected = isBot(userAgent, request);
  const { device_type, browser } = parseUserAgent(userAgent);

  // 8. Custom data (max 10 keys, primitive types)
  const sanitizedData: Record<string, string | number | boolean> = {};
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
    const keys = Object.keys(raw.data).slice(0, 10);
    for (const key of keys) {
      const val = raw.data[key];
      if (typeof val === "string") {
        sanitizedData[key.slice(0, 50)] = val.slice(0, 255);
      } else if (typeof val === "number" || typeof val === "boolean") {
        sanitizedData[key.slice(0, 50)] = val;
      }
    }
  }
  if (botDetected) {
    sanitizedData.is_bot = true;
  }
  const event_data = Object.keys(sanitizedData).length > 0 ? JSON.stringify(sanitizedData) : "{}";

  return {
    valid: true,
    isBot: botDetected,
    event: {
      site_id: siteId,
      session_id: sessionId,
      event,
      path,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      country,
      device_type,
      browser,
      event_data,
      ts: clientTime
    }
  };
}

function parseUserAgent(ua: string): { device_type: string; browser: string } {
  const uaLower = ua.toLowerCase();
  let device_type = "desktop";
  if (uaLower.includes("mobile") || uaLower.includes("android") || uaLower.includes("iphone")) {
    device_type = "mobile";
  } else if (uaLower.includes("ipad") || uaLower.includes("tablet")) {
    device_type = "tablet";
  }

  let browser = "other";
  if (uaLower.includes("firefox")) browser = "Firefox";
  else if (uaLower.includes("edg/")) browser = "Edge";
  else if (uaLower.includes("chrome") || uaLower.includes("crios")) browser = "Chrome";
  else if (uaLower.includes("safari")) browser = "Safari";

  return { device_type, browser };
}
