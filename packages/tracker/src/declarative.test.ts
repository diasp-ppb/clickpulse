import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerDeclarativeEventsListener } from "./declarative";

describe("Declarative Custom Event Tracking", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanup?.();
  });

  it("captures click on element with data-clickpulse attribute", () => {
    const callback = vi.fn();
    cleanup = registerDeclarativeEventsListener(callback);

    const button = document.createElement("button");
    button.setAttribute("data-clickpulse", "signup_click");
    button.textContent = "Sign Up";
    document.body.appendChild(button);

    button.click();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("signup_click", undefined);
  });

  it("captures event with custom properties from data-clickpulse-* attributes", () => {
    const callback = vi.fn();
    cleanup = registerDeclarativeEventsListener(callback);

    const button = document.createElement("button");
    button.setAttribute("data-clickpulse", "checkout_completed");
    button.setAttribute("data-clickpulse-plan", "enterprise");
    button.setAttribute("data-clickpulse-currency", "USD");
    document.body.appendChild(button);

    button.click();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("checkout_completed", {
      plan: "enterprise",
      currency: "USD"
    });
  });

  it("captures click on nested child inside a data-clickpulse parent", () => {
    const callback = vi.fn();
    cleanup = registerDeclarativeEventsListener(callback);

    const button = document.createElement("button");
    button.setAttribute("data-clickpulse", "cta_click");
    button.setAttribute("data-clickpulse-position", "header");

    const span = document.createElement("span");
    span.textContent = "Inner Icon";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("cta_click", {
      position: "header"
    });
  });

  it("supports data-clickpulse-event as alternate attribute", () => {
    const callback = vi.fn();
    cleanup = registerDeclarativeEventsListener(callback);

    const link = document.createElement("a");
    link.setAttribute("data-clickpulse-event", "download_whitepaper");
    link.setAttribute("data-clickpulse-format", "pdf");
    document.body.appendChild(link);

    link.click();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("download_whitepaper", {
      format: "pdf"
    });
  });

  it("does not trigger callback for clicks on elements without clickpulse attributes", () => {
    const callback = vi.fn();
    cleanup = registerDeclarativeEventsListener(callback);

    const div = document.createElement("div");
    div.textContent = "Normal content";
    document.body.appendChild(div);

    div.click();

    expect(callback).not.toHaveBeenCalled();
  });

  it("stops capturing events when cleanup is invoked", () => {
    const callback = vi.fn();
    cleanup = registerDeclarativeEventsListener(callback);

    const button = document.createElement("button");
    button.setAttribute("data-clickpulse", "btn_click");
    document.body.appendChild(button);

    cleanup();

    button.click();

    expect(callback).not.toHaveBeenCalled();
  });
});
