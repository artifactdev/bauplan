import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_CACHE_KEY,
  DEFAULT_APPEARANCE,
  MODES,
  appearanceBootstrap,
  appearanceSchema,
  derivePrimaryColors,
  parseAppearanceCache,
  resolveMode,
} from "./appearance";

describe("Appearance contracts and pre-paint bootstrap", () => {
  it("defaults to the original primary color and validates custom colors and modes", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ primaryColor: "#0e6375", mode: "system" });
    for (const primaryColor of ["#0e6375", "#ff0000", "#123456"])
      for (const mode of MODES) {
        expect(appearanceSchema.parse({ primaryColor, mode })).toEqual({
          primaryColor,
          mode,
        });
        expect(parseAppearanceCache(JSON.stringify({ primaryColor, mode }))).toEqual({
          primaryColor,
          mode,
        });
      }
    expect(appearanceSchema.safeParse({ primaryColor: "red", mode: "dark" }).success).toBe(false);
    expect(parseAppearanceCache('{"palette":"blue","mode":"invalid"}')).toBeNull();
    expect(parseAppearanceCache('{"palette":["blue"],"mode":"dark"}')).toBeNull();
    expect(parseAppearanceCache(null)).toBeNull();
  });
  it("migrates saved palette choices in the schema and pre-paint cache", () => {
    expect(appearanceSchema.parse({ palette: "violet", mode: "dark" })).toEqual({
      primaryColor: "#6d28d9",
      mode: "dark",
    });
    expect(parseAppearanceCache('{"palette":"blue","mode":"system"}')).toEqual({
      primaryColor: "#295cc5",
      mode: "system",
    });
  });
  it("derives primary shades with readable text in both themes", () => {
    for (const color of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#fbbf24"]) {
      const shades = derivePrimaryColors(color);
      expect(shades.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(shades.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(shades.onLight).toMatch(/^#(?:ffffff|171a28)$/);
      expect(shades.onDark).toMatch(/^#(?:ffffff|171a28)$/);
    }
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
    expect(document.documentElement.dataset["theme"]).toBe("custom");
    expect(document.documentElement.style.getPropertyValue("--user-primary-light")).toBeTruthy();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.eval(appearanceBootstrap);
    expect(document.documentElement.dataset["theme"]).toBe("custom");
    expect(warning).toHaveBeenCalled();
    storage.mockRestore();
    warning.mockRestore();
    localStorage.clear();
  });
});
