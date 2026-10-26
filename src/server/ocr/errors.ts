import { OCR_ERROR_CODES, type OcrErrorCode } from "@/lib/ocr";

export class OcrError extends Error {
  constructor(public readonly code: OcrErrorCode) {
    super(code);
  }
}

export function ocrErrorCode(error: unknown): OcrErrorCode {
  const code = error instanceof OcrError ? error.code : "providerFailure";
  console.error("OCR failed", { code });
  return code;
}

export function isOcrErrorCode(value: unknown): value is OcrErrorCode {
  return typeof value === "string" && OCR_ERROR_CODES.some((code) => code === value);
}
