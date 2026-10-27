import { z } from "zod";

export const MODES = ["light", "dark", "system"] as const;
const LEGACY_COLORS = {
  current: "#0e6375",
  blue: "#295cc5",
  green: "#176b50",
  violet: "#6d28d9",
} as const;
const primaryColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((color) => color.toLowerCase());
export const appearanceSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record["primaryColor"] === "string") return value;
    const palette = record["palette"];
    const legacyColor =
      typeof palette === "string" && /^#[0-9a-f]{6}$/i.test(palette)
        ? palette
        : typeof palette === "string"
          ? LEGACY_COLORS[palette as keyof typeof LEGACY_COLORS]
          : undefined;
    if (!legacyColor) return value;
    const rest = { ...record };
    delete rest["palette"];
    return { ...rest, primaryColor: legacyColor };
  },
  z.object({ primaryColor: primaryColorSchema, mode: z.enum(MODES) }).strict(),
);
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = {
  primaryColor: LEGACY_COLORS.current,
  mode: "system",
};
export const APPEARANCE_CACHE_KEY = "bauplan.appearance";

export function resolveMode(mode: Appearance["mode"], prefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

export function derivePrimaryColors(hex: string) {
  const source = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (rgb: number[]) =>
    rgb
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const contrast = (a: number[], b: number[]) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0]! + 0.05) / (values[1]! + 0.05);
  };
  const shadeFor = (backgrounds: number[][], target: number[]) => {
    if (backgrounds.every((background) => contrast(source, background) >= 6)) return source;
    for (let step = 1; step <= 100; step++) {
      const ratio = step / 100;
      const shade = source.map((channel) => Math.round(channel + (target[0]! - channel) * ratio));
      if (backgrounds.every((background) => contrast(shade, background) >= 6)) return shade;
    }
    return target;
  };
  const toHex = (rgb: number[]) =>
    `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const bestForeground = (rgb: number[]) =>
    contrast(rgb, [255, 255, 255]) >= contrast(rgb, [23, 26, 40]) ? "#ffffff" : "#171a28";
  const light = shadeFor(
    [
      [255, 255, 255],
      [245, 246, 250],
    ],
    [0, 0, 0],
  );
  const dark = shadeFor(
    [
      [23, 26, 40],
      [34, 38, 56],
      [43, 48, 67],
    ],
    [255, 255, 255],
  );
  return {
    light: toHex(light),
    dark: toHex(dark),
    onLight: bestForeground(light),
    onDark: bestForeground(dark),
  };
}

export function applyAppearance(
  value: Appearance,
  prefersDark: boolean,
  derive: typeof derivePrimaryColors = derivePrimaryColors,
) {
  const root = document.documentElement;
  const mode = value.mode === "system" ? (prefersDark ? "dark" : "light") : value.mode;
  const colors = derive(value.primaryColor);
  root.dataset["theme"] = "custom";
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  root.style.setProperty("--user-primary-light", colors.light);
  root.style.setProperty("--user-primary-dark", colors.dark);
  root.style.setProperty("--user-on-primary-light", colors.onLight);
  root.style.setProperty("--user-on-primary-dark", colors.onDark);
}

// Self-contained so the same validation can run in the pre-paint script.
export function parseAppearanceCache(raw: string | null): Appearance | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const legacyColors: Record<string, string> = {
      current: "#0e6375",
      blue: "#295cc5",
      green: "#176b50",
      violet: "#6d28d9",
    };
    const palette = record["palette"];
    const primaryColor =
      typeof record["primaryColor"] === "string"
        ? record["primaryColor"]
        : typeof palette === "string" && /^#[0-9a-f]{6}$/i.test(palette)
          ? palette
          : typeof palette === "string"
            ? legacyColors[palette]
            : undefined;
    if (
      typeof primaryColor !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(primaryColor) ||
      (record["mode"] !== "light" && record["mode"] !== "dark" && record["mode"] !== "system")
    )
      return null;
    return { primaryColor: primaryColor.toLowerCase(), mode: record["mode"] };
  } catch (error) {
    console.warn("Invalid appearance browser cache", error);
    return null;
  }
}

export const appearanceBootstrap = `(() => {
  const parse = (${parseAppearanceCache.toString()});
  const derive = (${derivePrimaryColors.toString()});
  const apply = (${applyAppearance.toString()});
  let value = ${JSON.stringify(DEFAULT_APPEARANCE)};
  try { value = parse(localStorage.getItem(${JSON.stringify(APPEARANCE_CACHE_KEY)})) || value; }
  catch (error) { console.warn("Appearance browser storage unavailable", error); }
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  apply(value, prefersDark, derive);
})();`;
