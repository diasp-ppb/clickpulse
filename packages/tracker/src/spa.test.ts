import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerSpaListener } from "./spa";

describe("SPA Navigation Tracking", () => {
  let cleanup: (() => void) | undefined;
  const originalLocation = window.location;

  beforeEach(() => {
    // Reset URL to a known state
    history.replaceState({}, "", "/initial");
  });

  afterEach(() => {
    cleanup?.();
  });

  it("triggers callback when history.pushState changes pathname", () => {
    const onNavigate = vi.fn();
    cleanup = registerSpaListener(onNavigate);

    history.pushState({}, "", "/dashboard");

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe("/dashboard");
  });

  it("triggers callback when history.pushState changes search query", () => {
    const onNavigate = vi.fn();
    cleanup = registerSpaListener(onNavigate);

    history.pushState({}, "", "/initial?tab=settings");

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("does not trigger callback if pushState URL is identical to current URL", () => {
    const onNavigate = vi.fn();
    cleanup = registerSpaListener(onNavigate);

    history.pushState({}, "", "/initial");

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("triggers callback on history.replaceState with new path", () => {
    const onNavigate = vi.fn();
    cleanup = registerSpaListener(onNavigate);

    history.replaceState({}, "", "/replaced-path");

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe("/replaced-path");
  });

  it("triggers callback on window popstate event", () => {
    const onNavigate = vi.fn();
    cleanup = registerSpaListener(onNavigate);

    // Simulate back/forward navigation
    history.pushState({}, "", "/next-page");
    expect(onNavigate).toHaveBeenCalledTimes(1);

    // Manually dispatch popstate after changing location
    history.replaceState({}, "", "/previous-page");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("restores original history methods and removes event listener on cleanup", () => {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    const onNavigate = vi.fn();

    cleanup = registerSpaListener(onNavigate);

    expect(history.pushState).not.toBe(origPush);

    cleanup();

    expect(history.pushState).toBe(origPush);
    expect(history.replaceState).toBe(origReplace);

    history.pushState({}, "", "/another-path");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
