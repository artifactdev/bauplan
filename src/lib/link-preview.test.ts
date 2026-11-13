import { describe, expect, it } from "vitest";
import { linkScreenshotUrl } from "./link-preview";

describe("linkScreenshotUrl", () => {
  it("builds a cached thum.io screenshot URL for public web links", () => {
    expect(linkScreenshotUrl("https://example.com/bath?finish=light")).toBe(
      "https://image.thum.io/get/width/800/crop/450/maxAge/24/noanimate/https://example.com/bath?finish=light",
    );
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://localhost",
    "http://127.0.0.1",
    "http://10.2.3.4",
    "http://172.20.1.1",
    "http://192.168.1.10",
    "http://[::1]",
    "https://user:pass@example.com",
    "https://example.test",
    "https://example.com:8443",
  ])("rejects unsafe or unsupported target %s", (url) => {
    expect(linkScreenshotUrl(url)).toBeNull();
  });
});
