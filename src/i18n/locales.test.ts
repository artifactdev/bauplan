import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyUiKeys, resolveUiKey } from "./legacy-ui-keys";
import i18n, { tr } from "./index";

const loadLocale = (language: "de" | "en") =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), "src/locales", language, "ui.json"), "utf8"),
  ) as Record<string, string>;

const placeholderNames = (value: string) =>
  [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]).sort();

describe("UI locales", () => {
  const de = loadLocale("de");
  const en = loadLocale("en");

  it("keeps German and English UI keys in sync", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps interpolation placeholders consistent", () => {
    for (const key of Object.keys(en)) {
      expect(placeholderNames(de[key]!)).toEqual(placeholderNames(en[key]!));
    }
  });

  it("resolves legacy data labels and dynamic errors to semantic keys", () => {
    for (const [legacyKey, semanticKey] of Object.entries(legacyUiKeys)) {
      expect(en).toHaveProperty(semanticKey);
      expect(de).toHaveProperty(semanticKey);
      expect(resolveUiKey(legacyKey)).toBe(semanticKey);
    }
  });

  it("passes semantic keys through unchanged", () => {
    expect(resolveUiKey("budget.remaining")).toBe("budget.remaining");
  });

  it("translates semantic keys and legacy dynamic values", async () => {
    await i18n.changeLanguage("en");
    expect(tr("auth.sign")).toBe("Sign in");
    expect(tr("Planung")).toBe("Planning");
    await i18n.changeLanguage("de");
    expect(tr("auth.sign")).toBe("Anmelden");
    expect(tr("Planung")).toBe("Planung");
  });
});
