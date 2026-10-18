var ClickPulse = (function (exports) {
  'use strict';

  // src/session.ts
  var KEY_SID = "_cp_sid";
  var KEY_ACT = "_cp_act";
  var memSid;
  function getOrCreateSessionId(timeoutMs = 18e5) {
    try {
      const s = sessionStorage;
      const now = Date.now();
      const lastActive = +(s.getItem(KEY_ACT) || 0);
      const sid = s.getItem(KEY_SID);
      const isExisting = Boolean(sid && lastActive && now - lastActive <= timeoutMs);
      const sessionId = isExisting ? sid : generateUUID();
      s.setItem(KEY_SID, sessionId);
      s.setItem(KEY_ACT, `${now}`);
      return { sessionId, isNewSession: !isExisting };
    } catch {
      const isNewSession = !memSid;
      return { sessionId: memSid ||= generateUUID(), isNewSession };
    }
  }
  function generateUUID() {
    return globalThis.crypto?.randomUUID?.() || "10000000-1000-4000-8000-100000000000".replace(
      /[018]/g,
      (c) => (+c ^ Math.random() * 16 >> +c / 4).toString(16)
    );
  }

  // src/outbound.ts
  function registerOutboundClickListener(callback, customDomains = []) {
    const currentHost = location.hostname;
    function handleClick(e) {
      const anchor = e.target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || /^#|javascript:/.test(href)) return;
      let targetUrl;
      try {
        targetUrl = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      const host = targetUrl.hostname;
      if (host !== currentHost || customDomains.some((d) => host.includes(d))) {
        const title = anchor.dataset?.title || anchor.title || anchor.textContent?.trim() || host;
        callback({
          url: targetUrl.href,
          title: title.slice(0, 200),
          domain: host
        });
      }
    }
    document.addEventListener("click", handleClick, { passive: true });
    return () => document.removeEventListener("click", handleClick);
  }

  // src/declarative.ts
  function registerDeclarativeEventsListener(trackFn) {
    if (typeof document === "undefined") {
      return () => {
      };
    }
    function handleClick(e) {
      const el = e.target?.closest?.(
        "[data-clickpulse],[data-clickpulse-event]"
      );
      if (!el) return;
      const eventName = el.dataset.clickpulse || el.dataset.clickpulseEvent;
      if (!eventName) return;
      let props;
      for (const [key, val] of Object.entries(el.dataset)) {
        if (key !== "clickpulse" && key !== "clickpulseEvent" && val !== void 0) {
          if (!props) props = {};
          const cleanKey = key.replace(/^clickpulse|^prop/, "");
          const finalKey = cleanKey ? cleanKey.charAt(0).toLowerCase() + cleanKey.slice(1) : key;
          props[finalKey] = val;
        }
      }
      trackFn(eventName, props);
    }
    document.addEventListener("click", handleClick, { passive: true });
    return () => document.removeEventListener("click", handleClick);
  }

  // src/index.ts
  var defaultTracker = null;
  function init(config) {
    defaultTracker?.destroy();
    const c = { autoPageview: true, trackOutbound: true, trackDeclarative: true, ...config };
    const cleanups = [];
    const trackFn = (eventType, data) => {
      try {
        const { sessionId, isNewSession } = getOrCreateSessionId(c.sessionTimeoutMs);
        const urlParams = new URLSearchParams(location.search);
        const payload = {
          site_id: c.siteId,
          session_id: sessionId,
          event: eventType.slice(0, 50),
          path: location.pathname.slice(0, 255),
          referrer: document.referrer.slice(0, 500) || null,
          ts: Date.now()
        };
        for (const k of ["source", "medium", "campaign"]) {
          const v = urlParams.get(`utm_${k}`);
          if (v) payload[`utm_${k}`] = v.slice(0, 100);
        }
        if (isNewSession || data && typeof data === "object") {
          payload.data = Object.assign(isNewSession ? { is_new_session: true } : {}, data);
        }
        const jsonStr = JSON.stringify(payload);
        if (!navigator?.sendBeacon?.(c.endpoint, jsonStr) && typeof fetch !== "undefined") {
          fetch(c.endpoint, { method: "POST", body: jsonStr, keepalive: true }).catch(() => {
          });
        }
      } catch {
      }
    };
    const pageviewFn = (title) => {
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
    return defaultTracker = {
      track: trackFn,
      pageview: pageviewFn,
      destroy: () => {
        cleanups.forEach((fn) => fn());
      }
    };
  }
  function track(eventType, data) {
    defaultTracker?.track(eventType, data);
  }
  function pageview(title) {
    defaultTracker?.pageview(title);
  }
  if (typeof document !== "undefined") {
    const d = document.currentScript?.dataset;
    if (d?.site) {
      const run = () => init({
        siteId: d.site,
        endpoint: d.endpoint || "/api/analytics",
        trackDeclarative: d.declarative !== "false"
      });
      document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", run, { once: true }) : run();
    }
  }

  exports.init = init;
  exports.pageview = pageview;
  exports.track = track;

  return exports;

})({});
//# sourceMappingURL=tracker.js.map
//# sourceMappingURL=tracker.js.map