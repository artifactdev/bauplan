// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkScreenshot } from "./link-preview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLinkScreenshot", () => {
  it("downloads a PNG through thum.io", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchLinkScreenshot("https://example.com/room")).resolves.toEqual(png);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://image.thum.io/get/"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects non-image responses and unsupported targets", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchLinkScreenshot("https://example.com")).rejects.toThrow(
      "collections.link_preview_invalid_image",
    );
    await expect(fetchLinkScreenshot("http://127.0.0.1")).rejects.toThrow(
      "collections.link_preview_invalid_url",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects screenshots larger than the storage limit", async () => {
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
    oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(oversized, { headers: { "content-type": "image/png" } })),
    );

    await expect(fetchLinkScreenshot("https://example.com")).rejects.toThrow(
      "collections.link_preview_too_large",
    );
  });
});
