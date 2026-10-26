import { z } from "zod";

export const PALETTES = ["current", "blue", "green", "violet"] as const;
export const MODES = ["light", "dark", "system"] as const;
export const appearanceSchema = z
  .object({
    palette: z.enum(PALETTES),
    mode: z.enum(MODES),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = { palette: "current", mode: "system" };
export const APPEARANCE_CACHE_KEY = "bauplan.appearance";

export function resolveMode(mode: Appearance["mode"], prefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

// Self-contained so the same validation can run in the pre-paint script.
export function parseAppearanceCache(raw: string | null): Appearance | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (!("palette" in value) || !("mode" in value)) return null;
    const { palette, mode } = value;
    if (palette !== "current" && palette !== "blue" && palette !== "green" && palette !== "violet")
      return null;
    if (mode !== "light" && mode !== "dark" && mode !== "system") return null;
    return { palette, mode };
  } catch (error) {
    console.warn("Invalid appearance browser cache", error);
    return null;
  }
}

export function applyAppearance(value: Appearance, prefersDark: boolean) {
  const root = document.documentElement;
  root.dataset["theme"] = value.palette;
  root.classList.toggle("dark", resolveMode(value.mode, prefersDark) === "dark");
  root.style.colorScheme = resolveMode(value.mode, prefersDark);
}

export const appearanceBootstrap = `(() => {
  let value = ${JSON.stringify(DEFAULT_APPEARANCE)};
  try { value = (${parseAppearanceCache.toString()})(localStorage.getItem(${JSON.stringify(APPEARANCE_CACHE_KEY)})) || value; }
  catch (error) { console.warn("Appearance browser storage unavailable", error); }
  const dark = value.mode === "dark" || (value.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = value.palette;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();`;
