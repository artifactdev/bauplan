import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ocrSettingsSchema,
  type OcrDraft,
  type OcrSettings,
  type OcrSettingsView,
} from "@/lib/ocr";
import { OcrError } from "./errors";

const envelopeSchema = z.object({
  version: z.literal(1),
  nonce: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
});
const storedSchema = z.object({
  version: z.literal(1),
  settings: ocrSettingsSchema,
  secret: envelopeSchema.nullable(),
});
export type StoredOcrSettings = z.infer<typeof storedSchema>;
export interface OcrSettingsStore {
  readOcrSettings(): Promise<string | null>;
  writeOcrSettings(value: string | null): Promise<void>;
}
const defaults: OcrSettings = {
  enabled: false,
  provider: "tesseract",
  baseUrl: "",
  language: "de+en",
};
const aad = Buffer.from("bauplan:ocr-settings:v1");

function encryptionKey() {
  const value = process.env["OCR_SETTINGS_KEY"];
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new OcrError("secretKey");
  return Buffer.from(value, "hex");
}

export function encryptSecret(secret: string): z.infer<typeof envelopeSchema> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    version: 1,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSecret(secret: z.infer<typeof envelopeSchema>): string {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(secret.nonce, "base64"),
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new OcrError("secretKey");
  }
}

export async function resolveSettings(
  store: OcrSettingsStore,
): Promise<StoredOcrSettings & { source: OcrSettingsView["source"] }> {
  const raw = await store.readOcrSettings();
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new OcrError("invalidSettings");
    }
    const result = storedSchema.safeParse(parsed);
    if (!result.success) throw new OcrError("invalidSettings");
    return { ...result.data, source: "saved" };
  }
  const url = process.env["OCR_URL"];
  const result = ocrSettingsSchema.safeParse(
    url ? { ...defaults, enabled: true, baseUrl: url } : defaults,
  );
  if (!result.success) throw new OcrError("invalidSettings");
  return {
    version: 1,
    settings: result.data,
    secret: null,
    source: url ? "environment" : "unconfigured",
  };
}

export async function settingsView(store: OcrSettingsStore): Promise<OcrSettingsView> {
  const current = await resolveSettings(store);
  return { ...current.settings, source: current.source, hasApiKey: current.secret !== null };
}

export async function prepareDraft(
  store: OcrSettingsStore,
  draft: OcrDraft,
): Promise<StoredOcrSettings> {
  const current = await resolveSettings(store);
  let secret = current.secret;
  if (draft.secretAction === "delete") secret = null;
  if (draft.secretAction === "replace") {
    if (!draft.apiKey?.trim() || /[\r\n]/.test(draft.apiKey)) throw new OcrError("secretMissing");
    secret = encryptSecret(draft.apiKey);
  }
  if (draft.secretAction === "keep" && secret) {
    if (
      draft.settings.baseUrl !== current.settings.baseUrl ||
      draft.settings.provider !== current.settings.provider
    )
      throw new OcrError("secretDestination");
    decryptSecret(secret);
  }
  return { version: 1, settings: draft.settings, secret };
}
