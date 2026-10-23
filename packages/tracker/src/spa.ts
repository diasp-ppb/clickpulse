/**
 * ClickPulse: SPA Route Transition Listener
 * Intercepts history.pushState, history.replaceState, and popstate events.
 */

export function registerSpaListener(onNavigate: (path: string) => void): () => void {
  if (typeof window === "undefined" || !window.history) {
    return () => {};
  }

  let lastPath = location.pathname + location.search;

  const check = () => {
    const path = location.pathname;
    const cur = path + location.search;
    if (cur !== lastPath) {
      lastPath = cur;
      onNavigate(path);
    }
  };

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args) {
    origPush.apply(this, args);
    check();
  };

  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    check();
  };

  window.addEventListener("popstate", check);

  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener("popstate", check);
  };
}
