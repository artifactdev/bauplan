import { PDFDocument } from "pdf-lib";
import {
  OCR_MAX_BYTES,
  OCR_MAX_PAGES,
  OCR_MIMES,
  OCR_TIMEOUT_MS,
  type OcrRecognition,
} from "@/lib/ocr";
import { decryptSecret, type StoredOcrSettings } from "./config";
import { OcrError } from "./errors";
import { recognize, type OcrInput } from "./providers";

let active = 0;

export async function validateDocument(input: OcrInput): Promise<number | null> {
  if (input.bytes.length > OCR_MAX_BYTES) throw new OcrError("tooLarge");
  if (!input.bytes.length) throw new OcrError("unreadable");
  if (!OCR_MIMES.some((mime) => mime === input.mime)) throw new OcrError("unsupported");
  const b = input.bytes;
  const starts = (...values: number[]) => values.every((v, i) => b[i] === v);
  if (input.mime === "application/pdf") {
    if (Buffer.from(b.subarray(0, 1024)).indexOf("%PDF-") < 0) throw new OcrError("invalidPdf");
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(b, { throwOnInvalidObject: true });
    } catch {
      throw new OcrError("invalidPdf");
    }
    const count = pdf.getPageCount();
    if (!count) throw new OcrError("invalidPdf");
    if (count > OCR_MAX_PAGES) throw new OcrError("tooManyPages");
    return count;
  }
  const valid =
    input.mime === "image/png"
      ? starts(137, 80, 78, 71, 13, 10, 26, 10)
      : input.mime === "image/jpeg"
        ? starts(255, 216, 255)
        : input.mime === "image/bmp"
          ? starts(66, 77)
          : starts(73, 73, 42, 0) || starts(77, 77, 0, 42);
  if (!valid) throw new OcrError("unsupported");
  return null;
}

export async function processDocument(
  config: StoredOcrSettings,
  input: OcrInput,
): Promise<OcrRecognition> {
  if (!config.settings.enabled || !config.settings.baseUrl) throw new OcrError("unconfigured");
  if (active >= 2) throw new OcrError("busy");
  active++;
  const signal = AbortSignal.timeout(OCR_TIMEOUT_MS);
  try {
    const pageCount = await validateDocument(input);
    signal.throwIfAborted();
    const result = await recognize(
      {
        settings: config.settings,
        apiKey: config.secret ? decryptSecret(config.secret) : null,
        signal,
      },
      input,
    );
    if (pageCount !== null && result.pages && result.pages.length !== pageCount)
      throw new OcrError("partial");
    return result;
  } catch (error) {
    if (signal.aborted) throw new OcrError("timeout");
    throw error;
  } finally {
    active--;
  }
}
