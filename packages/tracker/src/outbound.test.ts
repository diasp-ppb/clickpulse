import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerOutboundClickListener } from "./outbound";

describe("Outbound Click Tracking", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanup?.();
  });

  it("captures clicks on outbound links", () => {
    const callback = vi.fn();
    cleanup = registerOutboundClickListener(callback);

    const anchor = document.createElement("a");
    anchor.href = "https://external-service.com/pricing";
    anchor.textContent = "Check Pricing";
    document.body.appendChild(anchor);

    anchor.click();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      url: "https://external-service.com/pricing",
      title: "Check Pricing",
      domain: "external-service.com"
    });
  });

  it("prefers data-title attribute when present", () => {
    const callback = vi.fn();
    cleanup = registerOutboundClickListener(callback);

    const anchor = document.createElement("a");
    anchor.href = "https://github.com/clickpulse";
    anchor.setAttribute("data-title", "GitHub Repository Link");
    anchor.textContent = "Click Here";
    document.body.appendChild(anchor);

    anchor.click();

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "GitHub Repository Link",
        domain: "github.com"
      })
    );
  });

  it("ignores internal links on the same hostname", () => {
    const callback = vi.fn();
    cleanup = registerOutboundClickListener(callback);

    const anchor = document.createElement("a");
    anchor.href = `${window.location.origin}/about-us`;
    anchor.textContent = "About";
    document.body.appendChild(anchor);

    anchor.click();

    expect(callback).not.toHaveBeenCalled();
  });

  it("ignores hash links and javascript: links", () => {
    const callback = vi.fn();
    cleanup = registerOutboundClickListener(callback);

    const hashAnchor = document.createElement("a");
    hashAnchor.setAttribute("href", "#section-faq");
    document.body.appendChild(hashAnchor);
    hashAnchor.click();

    const jsAnchor = document.createElement("a");
    jsAnchor.setAttribute("href", "javascript:void(0)");
    document.body.appendChild(jsAnchor);
    jsAnchor.click();

    expect(callback).not.toHaveBeenCalled();
  });

  it("triggers for custom designated domains even on same host", () => {
    const callback = vi.fn();
    cleanup = registerOutboundClickListener(callback, ["custom-domain.com"]);

    const anchor = document.createElement("a");
    anchor.href = "https://custom-domain.com/landing";
    document.body.appendChild(anchor);
    anchor.click();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("stops tracking when cleanup is called", () => {
    const callback = vi.fn();
    cleanup = registerOutboundClickListener(callback);

    cleanup();

    const anchor = document.createElement("a");
    anchor.href = "https://external-service.com";
    document.body.appendChild(anchor);
    anchor.click();

    expect(callback).not.toHaveBeenCalled();
  });
});
