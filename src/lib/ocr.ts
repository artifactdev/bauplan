import { z } from "zod";

export const OCR_MAX_BYTES = 25 * 1024 * 1024;
export const OCR_MAX_PAGES = 10;
export const OCR_TIMEOUT_MS = 180_000;
export const OCR_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
] as const;
export const ocrLanguage = z.enum(["de", "en", "de+en"]);
export type OcrLanguage = z.infer<typeof ocrLanguage>;
export const OCR_LANGUAGES = ["de", "en"] as const;
export type OcrModelLanguage = (typeof OCR_LANGUAGES)[number];
export const OCR_CAPABILITIES = { pages: true, tables: false, searchablePdf: false } as const;

export const ocrSettingsSchema = z
  .object({
    enabled: z.boolean(),
    language: ocrLanguage,
  })
  .strict();
export type OcrSettings = z.infer<typeof ocrSettingsSchema>;
export const ocrDraftSchema = z.object({ settings: ocrSettingsSchema });
export type OcrDraft = z.infer<typeof ocrDraftSchema>;
export type OcrSettingsView = OcrSettings & {
  source: "saved" | "unconfigured";
  legacySettings: boolean;
};

export const OCR_ERROR_CODES = [
  "unconfigured",
  "invalidSettings",
  "notFound",
  "unreadable",
  "unsupported",
  "tooLarge",
  "tooManyPages",
  "invalidPdf",
  "busy",
  "timeout",
  "modelMissing",
  "modelDownloadFailed",
  "modelInUse",
  "processingFailed",
  "emptyText",
  "partial",
  "testFailed",
] as const;
export type OcrErrorCode = (typeof OCR_ERROR_CODES)[number];

export type OcrTable = {
  pages: number[];
  rows: number;
  columns: number;
  cells: { text: string; row: number; column: number; rowSpan: number; columnSpan: number }[];
};
export type OcrRecognition = {
  provider: "tesseract";
  text: string;
  pages: { page: number; text: string }[] | null;
  tables: null;
  warnings: string[];
};

export type OcrModelStatus = {
  language: OcrModelLanguage;
  installed: boolean;
  size: number | null;
};
