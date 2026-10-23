/**
 * ClickPulse: Lightweight, Cookieless Web Analytics Tracker
 * Size: < 1.5 KB gzipped | Zero Dependencies | Privacy-First
 */

import { getOrCreateSessionId } from "./session";
import { registerOutboundClickListener } from "./outbound";
import { registerSpaListener } from "./spa";

export interface ClickPulseConfig {
  endpoint: string;
  siteId: string;
  autoPageview?: boolean;
  trackSpa?: boolean;
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
  const trackSpa = config.trackSpa ?? c.autoPageview;
  const cleanups: (() => void)[] = [];
  let alive = true;

  const trackFn = (
    eventType: string,
    data?: Record<string, unknown>,
    path?: string
  ): void => {
    try {
      const { sessionId, isNewSession } = getOrCreateSessionId(c.sessionTimeoutMs);
      const urlParams = new URLSearchParams(location.search);

      const payload: TrackingPayload = {
        site_id: c.siteId,
        session_id: sessionId,
        event: eventType.slice(0, 50),
        path: (path ?? location.pathname).slice(0, 255),
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

  const pageviewFn = (title?: string, path?: string): void => {
    trackFn("pageview", { title: title || document.title }, path);
  };

  if (c.autoPageview) {
    pageviewFn();
  }

  if (trackSpa) {
    cleanups.push(
      registerSpaListener((path) => {
        // Defer one macrotask so frameworks can update document.title first.
        setTimeout(() => {
          if (alive) pageviewFn(undefined, path);
        }, 0);
      })
    );
  }

  if (c.trackOutbound) {
    cleanups.push(
      registerOutboundClickListener(
        (outbound) => trackFn("outbound_click", outbound),
        c.outboundDomains
      )
    );
  }

  return (defaultTracker = {
    track: (eventType, data) => trackFn(eventType, data),
    pageview: (title) => pageviewFn(title),
    destroy: () => {
      alive = false;
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
        trackSpa: d.spa !== "false"
      });
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", run, { once: true })
      : run();
  }
}
