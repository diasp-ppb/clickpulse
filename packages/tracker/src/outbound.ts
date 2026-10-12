/**
 * ClickPulse: Outbound Link & Conversion Click Detector
 */

export interface OutboundClickEvent {
  url: string;
  title: string;
  domain: string;
  [key: string]: unknown;
}

export function registerOutboundClickListener(
  callback: (event: OutboundClickEvent) => void,
  customDomains: string[] = []
): () => void {
  const currentHost = window.location.hostname;

  function handleClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest("a") as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

    let targetUrl: URL;
    try {
      targetUrl = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }

    const isDifferentHost = targetUrl.hostname !== currentHost;
    const matchesCustomDomains = customDomains.some((d) => targetUrl.hostname.includes(d));

    if (isDifferentHost || matchesCustomDomains) {
      const title =
        anchor.getAttribute("data-title") ||
        anchor.getAttribute("title") ||
        anchor.textContent?.trim() ||
        targetUrl.hostname;

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
