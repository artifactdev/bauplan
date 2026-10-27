// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { derivePrimaryColors } from "./appearance";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1]!
    .trim()
    .split(",")
    .map((selector) => selector.trim()),
  declarations: Object.fromEntries(
    [...match[2]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((entry) => [
      entry[1]!,
      entry[2]!.trim(),
    ]),
  ),
}));

function tokens(palette: string, mode: string) {
  const values: Record<string, string> = {};
  for (const rule of rules) {
    if (
      rule.selectors.some(
        (selector) =>
          selector === ":root" ||
          selector === `:root[data-theme="${palette}"]` ||
          (mode === "dark" &&
            (selector === ":root.dark" || selector === `:root.dark[data-theme="${palette}"]`)),
      )
    ) {
      Object.assign(values, rule.declarations);
    }
  }
  const resolve = (token: string): string => {
    const value = values[`--${token}`];
    if (!value) throw new Error(`Missing token: ${token}`);
    const alias = value.match(/^var\(--([\w-]+)\)$/);
    return alias ? resolve(alias[1]!) : value;
  };
  return resolve;
}

function luminance(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected opaque sRGB token, got ${hex}`);
  const channels = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

describe("Accessible theme token contracts", () => {
  for (const mode of ["light", "dark"])
    it(`${mode} keeps text, status, control, and focus contrast above their thresholds`, () => {
      const token = tokens("base", mode);
      const textPairs = [
        ["foreground", "background"],
        ["card-foreground", "card"],
        ["popover-foreground", "popover"],
        ["muted-foreground", "card"],
        ["muted-foreground", "muted"],
        ["muted-foreground", "sidebar"],
        ["primary-foreground", "primary"],
        ["primary", "card"],
        ["accent-foreground", "accent"],
        ["sidebar-foreground", "sidebar"],
        ["sidebar-accent-foreground", "sidebar-accent"],
        ["success", "success-subtle"],
        ["warning-foreground", "warning-subtle"],
        ["destructive", "destructive-subtle"],
        ["info", "info-subtle"],
        ["success", "card"],
        ["warning", "card"],
        ["destructive", "card"],
        ["info", "card"],
      ];
      for (const [foreground, background] of textPairs) {
        expect(
          contrast(token(foreground!), token(background!)),
          `${foreground}/${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const background of ["background", "card", "popover"]) {
        for (const foreground of ["input", "ring"]) {
          expect(
            contrast(token(foreground), token(background)),
            `${foreground}/${background}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
      const chart = [1, 2, 3, 4, 5].map((index) => token(`chart-${index}`));
      expect(new Set(chart).size).toBe(5);
      for (const color of chart) expect(contrast(color, token("card"))).toBeGreaterThanOrEqual(3);
      const finance = ["budget", "planned", "committed", "expected", "paid"].map((role) =>
        token(`finance-${role}`),
      );
      expect(new Set(finance).size).toBe(5);
      for (const color of finance) expect(contrast(color, token("card"))).toBeGreaterThanOrEqual(3);
    });

  it.each(["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#fbbf24", "#0e6375"])(
    "keeps derived primary shades readable for %s",
    (color) => {
      const shades = derivePrimaryColors(color);
      for (const background of ["#ffffff", "#f5f6fa"])
        expect(contrast(shades.light, background)).toBeGreaterThanOrEqual(4.5);
      for (const background of ["#171a28", "#222638", "#2b3043"])
        expect(contrast(shades.dark, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(shades.onLight, shades.light)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(shades.onDark, shades.dark)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
