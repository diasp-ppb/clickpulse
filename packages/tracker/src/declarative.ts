/**
 * ClickPulse: Declarative Custom Event Tracking via HTML Data Attributes
 * Listens for clicks on elements with data-clickpulse or data-clickpulse-event.
 */

export function registerDeclarativeEventsListener(
  trackFn: (event: string, data?: Record<string, unknown>) => void
): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  function handleClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement | null)?.closest?.(
      "[data-clickpulse],[data-clickpulse-event]"
    ) as HTMLElement | null;

    if (!el) return;

    const eventName = el.dataset.clickpulse || el.dataset.clickpulseEvent;
    if (!eventName) return;

    let props: Record<string, unknown> | undefined;

    for (const [key, val] of Object.entries(el.dataset)) {
      if (key !== "clickpulse" && key !== "clickpulseEvent" && val !== undefined) {
        if (!props) props = {};
        const cleanKey = key.replace(/^clickpulse|^prop/, "");
        const finalKey = cleanKey
          ? cleanKey.charAt(0).toLowerCase() + cleanKey.slice(1)
          : key;
        props[finalKey] = val;
      }
    }

    trackFn(eventName, props);
  }

  document.addEventListener("click", handleClick, { passive: true });
  return () => document.removeEventListener("click", handleClick);
}
