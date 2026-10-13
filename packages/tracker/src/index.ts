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

export interface ClickPulseTracker {
  track: (eventType: string, data?: Record<string, unknown>) => void;
  pageview: (title?: string) => void;
  destroy: () => void;
}

// Global tracker instance
let defaultTracker: ClickPulseTracker | null = null;

export function init(config: ClickPulseConfig): ClickPulseTracker {
  defaultTracker?.destroy();

  const c = { autoPageview: true, trackOutbound: true, ...config };
  let off: (() => void) | undefined;

  const send = (payload: TrackingPayload) => {
    const jsonStr = JSON.stringify(payload);
    if (navigator?.sendBeacon) {
      const blob = new Blob([jsonStr], { type: "text/plain" });
      if (navigator.sendBeacon(c.endpoint, blob)) return;
    }
    if (typeof fetch !== "undefined") {
      fetch(c.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: jsonStr,
        keepalive: true
      }).catch(() => {});
    }
  };

  const trackFn = (eventType: string, data?: Record<string, unknown>): void => {
    try {
      const { sessionId, isNewSession } = getOrCreateSessionId(c.sessionTimeoutMs);
      const urlParams = new URLSearchParams(location.search);

      const payload: TrackingPayload = {
        site_id: c.siteId,
        session_id: sessionId,
        event: eventType.slice(0, 50),
        path: location.pathname.slice(0, 255),
        referrer: document.referrer ? document.referrer.slice(0, 500) : null,
        ts: Date.now()
      };

      for (const k of ["source", "medium", "campaign"] as const) {
        const v = urlParams.get(`utm_${k}`);
        if (v) payload[`utm_${k}`] = v.slice(0, 100);
      }

      const eventData = isNewSession
        ? { is_new_session: true, ...(data && typeof data === "object" ? data : {}) }
        : data && typeof data === "object"
          ? data
          : undefined;

      if (eventData) {
        payload.data = eventData;
      }

      send(payload);
    } catch {}
  };

  const pageviewFn = (title?: string): void => {
    trackFn("pageview", { title: title || document.title });
  };

  if (c.autoPageview) {
    pageviewFn();
  }

  if (c.trackOutbound) {
    off = registerOutboundClickListener(
      (outbound) => trackFn("outbound_click", outbound),
      c.outboundDomains
    );
  }

  return (defaultTracker = {
    track: trackFn,
    pageview: pageviewFn,
    destroy: () => off?.()
  });
}

export function track(eventType: string, data?: Record<string, unknown>): void {
  defaultTracker?.track(eventType, data);
}

export function pageview(title?: string): void {
  defaultTracker?.pageview(title);
}

// Auto-initialize when embedded via <script data-site="..." data-endpoint="...">
if (typeof document !== "undefined") {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript) {
    const siteId = currentScript.getAttribute("data-site") || currentScript.dataset?.site;
    const endpoint =
      currentScript.getAttribute("data-endpoint") ||
      currentScript.dataset?.endpoint ||
      "/api/analytics";

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
