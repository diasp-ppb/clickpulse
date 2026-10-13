var ClickPulse = (function (exports) {
  'use strict';

  // src/session.ts
  var SESSION_STORAGE_KEY = "_cp_sid";
  var ACTIVITY_STORAGE_KEY = "_cp_act";
  var DEFAULT_TIMEOUT_MS = 30 * 60 * 1e3;
  function getOrCreateSessionId(timeoutMs = DEFAULT_TIMEOUT_MS) {
    const now = Date.now();
    let isNewSession = false;
    try {
      const existingSession = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      const lastActiveStr = window.sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
      const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : 0;
      if (existingSession && lastActive && now - lastActive <= timeoutMs) {
        window.sessionStorage.setItem(ACTIVITY_STORAGE_KEY, now.toString());
        return { sessionId: existingSession, isNewSession: false };
      }
      isNewSession = true;
      const newSessionId = generateUUID();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, newSessionId);
      window.sessionStorage.setItem(ACTIVITY_STORAGE_KEY, now.toString());
      return { sessionId: newSessionId, isNewSession: true };
    } catch {
      return { sessionId: generateUUID(), isNewSession: true };
    }
  }
  function generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }

  // src/outbound.ts
  function registerOutboundClickListener(callback, customDomains = []) {
    const currentHost = window.location.hostname;
    function handleClick(e) {
      const target = e.target;
      const anchor = target?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      let targetUrl;
      try {
        targetUrl = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      const isDifferentHost = targetUrl.hostname !== currentHost;
      const matchesCustomDomains = customDomains.some((d) => targetUrl.hostname.includes(d));
      if (isDifferentHost || matchesCustomDomains) {
        const title = anchor.getAttribute("data-title") || anchor.getAttribute("title") || anchor.textContent?.trim() || targetUrl.hostname;
        callback({
          url: targetUrl.href,
          title: title.slice(0, 200),
          domain: targetUrl.hostname
        });
      }
    }
    document.addEventListener("click", handleClick, { passive: true });
    return () => document.removeEventListener("click", handleClick);
  }

  // src/index.ts
  var ClickPulseTracker = class {
    config;
    cleanupOutbound;
    constructor(config) {
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
    track(eventType, data) {
      try {
        const { sessionId } = getOrCreateSessionId(this.config.sessionTimeoutMs);
        const urlParams = new URLSearchParams(window.location.search);
        const payload = {
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
      }
    }
    pageview(title) {
      this.track("pageview", { title: title || document.title });
    }
    destroy() {
      if (this.cleanupOutbound) {
        this.cleanupOutbound();
      }
    }
    send(payload) {
      const jsonStr = JSON.stringify(payload);
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([jsonStr], { type: "text/plain" });
        const sent = navigator.sendBeacon(this.config.endpoint, blob);
        if (sent) return;
      }
      if (typeof fetch !== "undefined") {
        fetch(this.config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: jsonStr,
          keepalive: true
        }).catch(() => {
        });
      }
    }
  };
  var defaultTracker = null;
  function init(config) {
    if (defaultTracker) {
      defaultTracker.destroy();
    }
    defaultTracker = new ClickPulseTracker(config);
    return defaultTracker;
  }
  function track(eventType, data) {
    if (defaultTracker) {
      defaultTracker.track(eventType, data);
    }
  }
  function pageview(title) {
    if (defaultTracker) {
      defaultTracker.pageview(title);
    }
  }
  if (typeof document !== "undefined") {
    const currentScript = document.currentScript;
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

  exports.init = init;
  exports.pageview = pageview;
  exports.track = track;

  return exports;

})({});
//# sourceMappingURL=tracker.js.map
//# sourceMappingURL=tracker.js.map