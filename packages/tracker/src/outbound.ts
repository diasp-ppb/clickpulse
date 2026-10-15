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
  const currentHost = location.hostname;

  function handleClick(e: MouseEvent) {
    const anchor = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || /^#|javascript:/.test(href)) return;

    let targetUrl: URL;
    try {
      targetUrl = new URL(anchor.href, location.href);
    } catch {
      return;
    }

    const host = targetUrl.hostname;
    if (host !== currentHost || customDomains.some((d) => host.includes(d))) {
      const title =
        anchor.dataset?.title ||
        anchor.title ||
        anchor.textContent?.trim() ||
        host;

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
