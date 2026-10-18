/**
 * ClickPulse: Lightweight, Cookieless Web Analytics Tracker
 * Size: < 1.5 KB gzipped | Zero Dependencies | Privacy-First
 */

import { getOrCreateSessionId } from "./session";
import { registerOutboundClickListener } from "./outbound";
import { registerDeclarativeEventsListener } from "./declarative";

export interface ClickPulseConfig {
  endpoint: string;
  siteId: string;
  autoPageview?: boolean;
  trackOutbound?: boolean;
  trackDeclarative?: boolean;
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

  const c = { autoPageview: true, trackOutbound: true, trackDeclarative: true, ...config };
  const cleanups: (() => void)[] = [];

  const trackFn = (eventType: string, data?: Record<string, unknown>): void => {
    try {
      const { sessionId, isNewSession } = getOrCreateSessionId(c.sessionTimeoutMs);
      const urlParams = new URLSearchParams(location.search);

      const payload: TrackingPayload = {
        site_id: c.siteId,
        session_id: sessionId,
        event: eventType.slice(0, 50),
        path: location.pathname.slice(0, 255),
        referrer: document.referrer.slice(0, 500) || null,
        ts: Date.now()
      };

      for (const k of ["source", "medium", "campaign"] as const) {
        const v = urlParams.get(`utm_${k}`);
        if (v) payload[`utm_${k}`] = v.slice(0, 100);
      }

      if (isNewSession || (data && typeof data === "object")) {
        payload.data = Object.assign(isNewSession ? { is_new_session: true } : {}, data);
      }

      const jsonStr = JSON.stringify(payload);
      if (!navigator?.sendBeacon?.(c.endpoint, jsonStr) && typeof fetch !== "undefined") {
        fetch(c.endpoint, { method: "POST", body: jsonStr, keepalive: true }).catch(() => {});
      }
    } catch {}
  };

  const pageviewFn = (title?: string): void => {
    trackFn("pageview", { title: title || document.title });
  };

  if (c.autoPageview) {
    pageviewFn();
  }

  if (c.trackOutbound) {
    cleanups.push(
      registerOutboundClickListener(
        (outbound) => trackFn("outbound_click", outbound),
        c.outboundDomains
      )
    );
  }

  if (c.trackDeclarative) {
    cleanups.push(registerDeclarativeEventsListener(trackFn));
  }

  return (defaultTracker = {
    track: trackFn,
    pageview: pageviewFn,
    destroy: () => {
      cleanups.forEach((fn) => fn());
    }
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
  const d = (document.currentScript as HTMLScriptElement | null)?.dataset;
  if (d?.site) {
    const run = () =>
      init({
        siteId: d.site!,
        endpoint: d.endpoint || "/api/analytics",
        trackDeclarative: d.declarative !== "false"
      });
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", run, { once: true })
      : run();
  }
}
