import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resolveUiKey } from "./legacy-ui-keys";

export const LANGUAGES = [
  { code: "de", label: "Deutsch", locale: "de-DE" },
  { code: "en", label: "English", locale: "en-GB" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];
const STORAGE_KEY = "bauplan.lang";

// Every src/locales/<lang>/<namespace>.json is loaded automatically.
const files = import.meta.glob("../locales/*/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;
const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, data] of Object.entries(files)) {
  const m = path.match(/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  (resources[m[1]!] ??= {})[m[2]!] = data;
}

function initialLanguage(): Lang {
  if (typeof window === "undefined") return "de";
  const stored = localStorage.getItem(STORAGE_KEY);
  return (stored ?? navigator.language?.slice(0, 2)) === "en" ? "en" : "de";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: initialLanguage(),
    fallbackLng: "de",
    defaultNS: "common",
    ns: ["common", "ui"],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

/**
 * Translate UI keys. Data labels and dynamic server messages still using
 * source text are resolved through the compatibility map.
 */
export function tr(key: string, options?: Record<string, unknown>): string {
  return i18n.t(resolveUiKey(key), { ns: "ui", ...options }) as string;
}

export function currentLocale() {
  return LANGUAGES.find((l) => l.code === i18n.language)?.locale ?? "de-DE";
}

export function setLanguage(lang: Lang) {
  if (typeof window === "undefined") return;
  const changed = lang !== i18n.language;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  // Reload so every label (incl. module-level lists) picks up the new language.
  if (changed) window.location.reload();
}

/** Call from useEffect: applies the stored (or browser) language on the client. */
export function syncClientLanguage() {
  if (typeof window === "undefined") return;
  document.documentElement.lang = i18n.language;
}

export default i18n;
