import { z } from "zod";
import {
  ocrSettingsSchema,
  type OcrDraft,
  type OcrSettings,
  type OcrSettingsView,
} from "@/lib/ocr";
import { OcrError } from "./errors";

export type StoredOcrSettings = { version: 2; settings: OcrSettings };
export interface OcrSettingsStore {
  readOcrSettings(): Promise<string | null>;
  writeOcrSettings(value: string | null): Promise<void>;
}

const defaults: OcrSettings = { enabled: false, language: "de+en" };
const storedSchema = z.object({
  version: z.literal(2),
  settings: ocrSettingsSchema,
});
const legacySchema = z.object({
  version: z.literal(1),
  settings: z.object({
    enabled: z.boolean().optional(),
    language: z.enum(["de", "en", "de+en"]).optional(),
  }),
});

export async function resolveSettings(
  store: OcrSettingsStore,
): Promise<StoredOcrSettings & { source: OcrSettingsView["source"]; legacySettings: boolean }> {
  const raw = await store.readOcrSettings();
  if (raw === null)
    return { version: 2, settings: defaults, source: "unconfigured", legacySettings: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OcrError("invalidSettings");
  }
  const current = storedSchema.safeParse(parsed);
  if (current.success) return { ...current.data, source: "saved", legacySettings: false };
  const legacy = legacySchema.safeParse(parsed);
  if (!legacy.success) throw new OcrError("invalidSettings");
  return {
    version: 2,
    settings: {
      enabled: legacy.data.settings.enabled ?? false,
      language: legacy.data.settings.language ?? "de+en",
    },
    source: "saved",
    legacySettings: true,
  };
}

export async function settingsView(store: OcrSettingsStore): Promise<OcrSettingsView> {
  const current = await resolveSettings(store);
  return { ...current.settings, source: current.source, legacySettings: current.legacySettings };
}

export async function prepareDraft(draft: OcrDraft): Promise<StoredOcrSettings> {
  const result = ocrSettingsSchema.safeParse(draft.settings);
  if (!result.success) throw new OcrError("invalidSettings");
  return { version: 2, settings: result.data };
}
