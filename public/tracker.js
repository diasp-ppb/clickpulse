var ClickPulse = (function (exports) {
  'use strict';

  // src/session.ts
  var KEY_SID = "_cp_sid";
  var KEY_ACT = "_cp_act";
  var DEFAULT_TIMEOUT_MS = 18e5;
  var memSid;
  function getOrCreateSessionId(timeoutMs = DEFAULT_TIMEOUT_MS) {
    try {
      const s = sessionStorage;
      const now = Date.now();
      const lastActive = +(s.getItem(KEY_ACT) || 0);
      const sid = s.getItem(KEY_SID);
      if (sid && lastActive && now - lastActive <= timeoutMs) {
        s.setItem(KEY_ACT, `${now}`);
        return { sessionId: sid, isNewSession: false };
      }
      const newSid = generateUUID();
      s.setItem(KEY_SID, newSid);
      s.setItem(KEY_ACT, `${now}`);
      return { sessionId: newSid, isNewSession: true };
    } catch {
      if (!memSid) {
        memSid = generateUUID();
        return { sessionId: memSid, isNewSession: true };
      }
      return { sessionId: memSid, isNewSession: false };
    }
  }
  function generateUUID() {
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(
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
      if (!href || href[0] === "#" || href.startsWith("javascript:")) return;
      let targetUrl;
      try {
        targetUrl = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      const host = targetUrl.hostname;
      if (host !== currentHost || customDomains.some((d) => host.includes(d))) {
        const title = anchor.getAttribute("data-title") || anchor.title || anchor.textContent?.trim() || host;
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

  // src/index.ts
  var defaultTracker = null;
  function init(config) {
    defaultTracker?.destroy();
    const c = { autoPageview: true, trackOutbound: true, ...config };
    let off;
    const send = (payload) => {
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
        }).catch(() => {
        });
      }
    };
    const trackFn = (eventType, data) => {
      try {
        const { sessionId, isNewSession } = getOrCreateSessionId(c.sessionTimeoutMs);
        const urlParams = new URLSearchParams(location.search);
        const payload = {
          site_id: c.siteId,
          session_id: sessionId,
          event: eventType.slice(0, 50),
          path: location.pathname.slice(0, 255),
          referrer: document.referrer ? document.referrer.slice(0, 500) : null,
          ts: Date.now()
        };
        for (const k of ["source", "medium", "campaign"]) {
          const v = urlParams.get(`utm_${k}`);
          if (v) payload[`utm_${k}`] = v.slice(0, 100);
        }
        const eventData = isNewSession ? { is_new_session: true, ...data && typeof data === "object" ? data : {} } : data && typeof data === "object" ? data : void 0;
        if (eventData) {
          payload.data = eventData;
        }
        send(payload);
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
      off = registerOutboundClickListener(
        (outbound) => trackFn("outbound_click", outbound),
        c.outboundDomains
      );
    }
    return defaultTracker = {
      track: trackFn,
      pageview: pageviewFn,
      destroy: () => off?.()
    };
  }
  function track(eventType, data) {
    defaultTracker?.track(eventType, data);
  }
  function pageview(title) {
    defaultTracker?.pageview(title);
  }
  if (typeof document !== "undefined") {
    const currentScript = document.currentScript;
    if (currentScript) {
      const siteId = currentScript.getAttribute("data-site") || currentScript.dataset?.site;
      const endpoint = currentScript.getAttribute("data-endpoint") || currentScript.dataset?.endpoint || "/api/analytics";
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

  exports.init = init;
  exports.pageview = pageview;
  exports.track = track;

  return exports;

})({});
//# sourceMappingURL=tracker.js.map
//# sourceMappingURL=tracker.js.map