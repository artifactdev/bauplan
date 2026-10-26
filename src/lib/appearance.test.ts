import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_CACHE_KEY,
  DEFAULT_APPEARANCE,
  MODES,
  PALETTES,
  appearanceBootstrap,
  appearanceSchema,
  parseAppearanceCache,
  resolveMode,
} from "./appearance";

describe("Appearance contracts and pre-paint bootstrap", () => {
  it("defaults to Current and System and validates every palette/mode combination", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ palette: "current", mode: "system" });
    for (const palette of PALETTES)
      for (const mode of MODES) {
        expect(appearanceSchema.parse({ palette, mode })).toEqual({ palette, mode });
        expect(parseAppearanceCache(JSON.stringify({ palette, mode }))).toEqual({ palette, mode });
      }
    expect(appearanceSchema.safeParse({ palette: "red", mode: "dark" }).success).toBe(false);
    expect(parseAppearanceCache('{"palette":"blue","mode":"invalid"}')).toBeNull();
    expect(parseAppearanceCache('{"palette":["blue"],"mode":"dark"}')).toBeNull();
    expect(parseAppearanceCache(null)).toBeNull();
  });
  it("resolves System per device, without overriding explicit modes", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });
  it("applies the cached choice before React and survives storage failures", () => {
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ palette: "violet", mode: "dark" }));
    window.eval(appearanceBootstrap);
    expect(document.documentElement.dataset["theme"]).toBe("violet");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.eval(appearanceBootstrap);
    expect(document.documentElement.dataset["theme"]).toBe("current");
    expect(warning).toHaveBeenCalled();
    storage.mockRestore();
    warning.mockRestore();
    localStorage.clear();
  });
});
