/**
 * ClickPulse: Lightweight, Cookieless Web Analytics Tracker
 * Size: < 1.5 KB gzipped | Zero Dependencies | Privacy-First
 */

import { getOrCreateSessionId } from "./session";
import { registerOutboundClickListener } from "./outbound";

export interface ClickPulseConfig {
  endpoint: string;
  siteId: string;
  autoPageview?: boolean;
  trackOutbound?: boolean;
  outboundDomains?: string[];
  sessionTimeoutMs?: number;
}

export interface TrackingPayload {
  site_id: string;
  session_id: string;
  event: string;
  path: string;
  referrer: string | null;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  data?: Record<string, unknown>;
  ts: number;
}

class ClickPulseTracker {
  private config: ClickPulseConfig;
  private cleanupOutbound?: () => void;

  constructor(config: ClickPulseConfig) {
    this.config = {
      autoPageview: true,
      trackOutbound: true,
      ...config
    };

    if (this.config.autoPageview) {
      this.pageview();
    }

    if (this.config.trackOutbound) {
      this.cleanupOutbound = registerOutboundClickListener(
        (outbound) => this.track("outbound_click", outbound),
        this.config.outboundDomains
      );
    }
  }

  public track(eventType: string, data?: Record<string, unknown>): void {
    try {
      const { sessionId } = getOrCreateSessionId(this.config.sessionTimeoutMs);
      const urlParams = new URLSearchParams(window.location.search);

      const payload: TrackingPayload = {
        site_id: this.config.siteId,
        session_id: sessionId,
        event: eventType.slice(0, 50),
        path: window.location.pathname.slice(0, 255),
        referrer: document.referrer ? document.referrer.slice(0, 500) : null,
        ts: Date.now()
      };

      const utmSource = urlParams.get("utm_source");
      const utmMedium = urlParams.get("utm_medium");
      const utmCampaign = urlParams.get("utm_campaign");

      if (utmSource) payload.utm_source = utmSource.slice(0, 100);
      if (utmMedium) payload.utm_medium = utmMedium.slice(0, 100);
      if (utmCampaign) payload.utm_campaign = utmCampaign.slice(0, 100);

      if (data && typeof data === "object") {
        payload.data = data;
      }

      this.send(payload);
    } catch {
      // Silent fail to ensure user experience is never impacted
    }
  }

  public pageview(title?: string): void {
    this.track("pageview", { title: title || document.title });
  }

  public destroy(): void {
    if (this.cleanupOutbound) {
      this.cleanupOutbound();
    }
  }

  private send(payload: TrackingPayload): void {
    const jsonStr = JSON.stringify(payload);

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([jsonStr], { type: "application/json" });
      const sent = navigator.sendBeacon(this.config.endpoint, blob);
      if (sent) return;
    }

    if (typeof fetch !== "undefined") {
      fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonStr,
        keepalive: true
      }).catch(() => {});
    }
  }
}

// Global initialization helper
let defaultTracker: ClickPulseTracker | null = null;

export function init(config: ClickPulseConfig): ClickPulseTracker {
  if (defaultTracker) {
    defaultTracker.destroy();
  }
  defaultTracker = new ClickPulseTracker(config);
  return defaultTracker;
}

export function track(eventType: string, data?: Record<string, unknown>): void {
  if (defaultTracker) {
    defaultTracker.track(eventType, data);
  }
}

export function pageview(title?: string): void {
  if (defaultTracker) {
    defaultTracker.pageview(title);
  }
}

// Auto-initialize when embedded via <script data-site="..." data-endpoint="...">
if (typeof document !== "undefined") {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript) {
    const siteId = currentScript.getAttribute("data-site");
    const endpoint = currentScript.getAttribute("data-endpoint") || "/api/analytics";

    if (siteId) {
      const autoInit = () => {
        init({ siteId, endpoint });
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", autoInit, { once: true });
      } else {
        autoInit();
      }
    }
  }
}
