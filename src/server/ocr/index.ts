import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, OEM, PSM } from "tesseract.js";
import {
  OCR_MAX_BYTES,
  OCR_MAX_PAGES,
  OCR_MIMES,
  OCR_TIMEOUT_MS,
  type OcrLanguage,
  type OcrRecognition,
} from "@/lib/ocr";
import { decodeQrCodes } from "./codes";
import { OcrError } from "./errors";
import { hasModels, modelDirectory } from "./models";
import type { StoredOcrSettings } from "./config";

let active = 0;

function supportedImage(input: { bytes: Uint8Array; mime: string }): boolean {
  const bytes = input.bytes;
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  if (input.mime === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (input.mime === "image/jpeg") return starts(255, 216, 255);
  if (input.mime === "image/bmp") return starts(66, 77);
  return starts(73, 73, 42, 0) || starts(77, 77, 0, 42);
}

async function openPdf(bytes: Uint8Array) {
  if (Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0) throw new OcrError("invalidPdf");
  try {
    const loadingTask = getDocument({
      data: Uint8Array.from(bytes),
      useSystemFonts: true,
      stopAtErrors: true,
    });
    return { pdf: await loadingTask.promise, destroy: () => loadingTask.destroy() };
  } catch {
    throw new OcrError("invalidPdf");
  }
}

export async function validateDocument(input: {
  bytes: Uint8Array;
  mime: string;
}): Promise<number | null> {
  if (input.bytes.length > OCR_MAX_BYTES) throw new OcrError("tooLarge");
  if (!input.bytes.length) throw new OcrError("unreadable");
  if (!OCR_MIMES.some((mime) => mime === input.mime)) throw new OcrError("unsupported");
  if (input.mime !== "application/pdf") {
    if (!supportedImage(input)) throw new OcrError("unsupported");
    return null;
  }
  const { pdf, destroy } = await openPdf(input.bytes);
  try {
    if (!pdf.numPages) throw new OcrError("invalidPdf");
    if (pdf.numPages > OCR_MAX_PAGES) throw new OcrError("tooManyPages");
    return pdf.numPages;
  } finally {
    await destroy();
  }
}

function tessLanguage(language: OcrLanguage): string {
  if (language === "de+en") return "deu+eng";
  return language === "de" ? "deu" : "eng";
}

async function createOcrWorker(language: OcrLanguage) {
  if (!(await hasModels(language))) throw new OcrError("modelMissing");
  const worker = await createWorker(tessLanguage(language), OEM.LSTM_ONLY, {
    langPath: modelDirectory(),
    cacheMethod: "none",
    gzip: true,
    logger: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  return worker;
}

type OcrWorker = Awaited<ReturnType<typeof createOcrWorker>>;
/** Decides whether a page's text should be read a second time with another layout mode. */
export type SecondPass = (text: string) => boolean;
type PageResult = { text: string; alternate: string | null };

/**
 * Reads an image with automatic layout analysis. If `secondPass` asks for it, the image is
 * read again as one uniform block (PSM 6), which keeps receipt label/amount columns together.
 */
async function recognizeImage(image: Buffer, worker: OcrWorker, secondPass?: SecondPass): Promise<PageResult> {
  const text = (await worker.recognize(image)).data.text.trim();
  if (!text || !secondPass?.(text)) return { text, alternate: null };
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  try {
    const alternate = (await worker.recognize(image)).data.text.trim();
    return { text, alternate: alternate || null };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  }
}

function textFromContent(items: { str?: string; hasEOL?: boolean }[]): string {
  return items
    .map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .trim();
}

type PdfDocument = Awaited<ReturnType<typeof openPdf>>["pdf"];
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);

async function renderPage(page: PdfPage): Promise<Buffer> {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
  const scaled = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
  const context = canvas.getContext("2d");
  await page.render({
    canvas: canvas as unknown as Parameters<typeof page.render>[0]["canvas"],
    canvasContext: context as unknown as Parameters<typeof page.render>[0]["canvasContext"],
    viewport: scaled,
  }).promise;
  return canvas.encode("png");
}

/** XML attachments of a PDF, e.g. the ZUGFeRD/Factur-X invoice embedded in a PDF/A-3. */
async function xmlAttachments(pdf: PdfDocument): Promise<string[]> {
  try {
    const attachments = await pdf.getAttachments();
    const out: string[] = [];
    for (const [id, attachment] of attachments ?? []) {
      if (!/\.xml$/i.test(attachment.filename)) continue;
      const content = attachment.content ?? (await pdf.getAttachmentContent(id));
      if (content && content.length <= 5 * 1024 * 1024) out.push(new TextDecoder("utf-8").decode(content));
    }
    return out;
  } catch {
    return [];
  }
}

async function recognizePdf(
  bytes: Uint8Array,
  worker: OcrWorker,
  secondPass?: SecondPass,
): Promise<{ text: string; pages: { page: number; text: string }[]; codes: string[]; xml: string[]; alternates: string[] }> {
  const { pdf, destroy } = await openPdf(bytes);
  try {
    const pages: { page: number; text: string }[] = [];
    const codes: string[] = [];
    const alternates: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = textFromContent(
        content.items.flatMap((item) =>
          "str" in item ? [{ str: item.str, hasEOL: item.hasEOL }] : [],
        ),
      );
      if (text.replace(/\s/g, "").length < 20) {
        const image = await renderPage(page);
        codes.push(...(await decodeQrCodes(image)));
        // Totals are usually on the last page; a second pass on every page would be slow.
        const result = await recognizeImage(image, worker, number === pdf.numPages ? secondPass : undefined);
        text = result.text;
        if (result.alternate) alternates.push(result.alternate);
      } else {
        // Text PDFs can still carry a payment QR code (GiroCode) as an image.
        const operators = await page.getOperatorList();
        if (operators.fnArray.some((fn) => IMAGE_OPS.has(fn))) codes.push(...(await decodeQrCodes(await renderPage(page))));
      }
      pages.push({ page: number, text });
      page.cleanup();
    }
    return {
      text: pages
        .map((page) => page.text)
        .filter(Boolean)
        .join("\n\n"),
      pages,
      codes: [...new Set(codes)],
      xml: await xmlAttachments(pdf),
      alternates,
    };
  } finally {
    await destroy();
  }
}

export async function processDocument(
  config: StoredOcrSettings,
  input: { bytes: Uint8Array; mime: string; name: string },
  options: { secondPass?: SecondPass } = {},
): Promise<OcrRecognition> {
  if (!config.settings.enabled) throw new OcrError("unconfigured");
  if (active >= 2) throw new OcrError("busy");
  active++;
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | undefined;
  let timedOut = false;
  let releaseActive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let operation: Promise<OcrRecognition> | undefined;
  let termination: Promise<unknown> | undefined;
  const terminateWorker = () => {
    if (!worker) return Promise.resolve();
    termination ??= worker.terminate();
    return termination;
  };
  try {
    operation = (async (): Promise<OcrRecognition> => {
      const pageCount = await validateDocument(input);
      if (timedOut) throw new OcrError("timeout");
      if (!(await hasModels(config.settings.language))) throw new OcrError("modelMissing");
      if (timedOut) throw new OcrError("timeout");
      worker = await createOcrWorker(config.settings.language);
      if (timedOut) {
        await terminateWorker();
        throw new OcrError("timeout");
      }
      if (pageCount !== null) {
        const result = await recognizePdf(input.bytes, worker, options.secondPass);
        if (result.pages.length !== pageCount) throw new OcrError("partial");
        if (!result.text && !result.xml.length) throw new OcrError("emptyText");
        return { provider: "tesseract", ...result, tables: null, warnings: [] };
      }
      const codes = input.mime === "image/tiff" ? [] : await decodeQrCodes(input.bytes);
      const { text, alternate } = await recognizeImage(Buffer.from(input.bytes), worker, options.secondPass);
      if (!text) throw new OcrError("emptyText");
      return {
        provider: "tesseract",
        text,
        pages: null,
        tables: null,
        warnings: [],
        codes,
        xml: [],
        alternates: alternate ? [alternate] : [],
      };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        if (worker)
          void terminateWorker().catch(() => {
            console.error("OCR worker failed to stop after timeout");
          });
        reject(new OcrError("timeout"));
      }, OCR_TIMEOUT_MS);
    });
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (timedOut) {
      if (worker) {
        await operation?.catch((operationError: unknown) => {
          if (!(operationError instanceof OcrError && operationError.code === "timeout"))
            console.error("OCR operation stopped after timeout");
        });
      } else if (operation) {
        releaseActive = false;
        void operation.then(
          () => {
            active--;
          },
          () => {
            active--;
          },
        );
      }
      throw new OcrError("timeout");
    }
    if (error instanceof OcrError) throw error;
    throw new OcrError("processingFailed");
  } finally {
    if (timer) clearTimeout(timer);
    try {
      if (worker) await terminateWorker();
    } finally {
      if (releaseActive) active--;
    }
  }
}

export function ocrIsActive(): boolean {
  return active > 0;
}
