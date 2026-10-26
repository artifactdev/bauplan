import { z } from "zod";

export const OCR_MAX_BYTES = 25 * 1024 * 1024;
export const OCR_MAX_PAGES = 10;
export const OCR_TIMEOUT_MS = 180_000;
export const OCR_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const OCR_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
] as const;
export const ocrProvider = z.enum(["tesseract", "docling"]);
export const ocrLanguage = z.enum(["de", "en", "de+en"]);
export type OcrProvider = z.infer<typeof ocrProvider>;
export type OcrLanguage = z.infer<typeof ocrLanguage>;

export const ocrBaseUrl = z
  .string()
  .max(1000)
  .transform((value, ctx) => {
    try {
      const url = new URL(value.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
      return url.toString().replace(/\/+$/, "");
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalidUrl" });
      return z.NEVER;
    }
  });

export const ocrSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: ocrProvider,
    baseUrl: z.union([z.literal(""), ocrBaseUrl]),
    language: ocrLanguage,
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.baseUrl)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: "invalidUrl" });
  });
export type OcrSettings = z.infer<typeof ocrSettingsSchema>;
export const ocrDraftSchema = z.object({
  settings: ocrSettingsSchema,
  secretAction: z.enum(["keep", "replace", "delete"]),
  apiKey: z.string().max(1000).optional(),
});
export type OcrDraft = z.infer<typeof ocrDraftSchema>;
export type OcrSettingsView = OcrSettings & {
  source: "environment" | "saved" | "unconfigured";
  hasApiKey: boolean;
};

export const OCR_CAPABILITIES = {
  tesseract: { pages: false, tables: false, searchablePdf: false },
  docling: { pages: true, tables: true, searchablePdf: false },
} as const;

export const OCR_ERROR_CODES = [
  "unconfigured",
  "invalidUrl",
  "invalidSettings",
  "secretKey",
  "secretMissing",
  "secretDestination",
  "notFound",
  "unreadable",
  "unsupported",
  "tooLarge",
  "tooManyPages",
  "invalidPdf",
  "busy",
  "timeout",
  "unreachable",
  "authentication",
  "redirect",
  "providerFailure",
  "invalidResponse",
  "responseTooLarge",
  "emptyText",
  "partial",
  "languageUnsupported",
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
  provider: OcrProvider;
  text: string;
  pages: { page: number; text: string }[] | null;
  tables: OcrTable[] | null;
  warnings: string[];
};
