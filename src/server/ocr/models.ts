import { gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OCR_LANGUAGES,
  type OcrLanguage,
  type OcrModelLanguage,
  type OcrModelStatus,
} from "@/lib/ocr";
import { OcrError } from "./errors";
import type { OcrSettingsStore } from "./config";
import { resolveSettings } from "./config";

const modelCodes: Record<OcrModelLanguage, "deu" | "eng"> = { de: "deu", en: "eng" };
const MODEL_VERSION = "1.0.0";
const MODEL_DIR = "4.0.0_best_int";
const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_BYTES = 50 * 1024 * 1024;
const downloads = new Set<OcrModelLanguage>();

export function modelDirectory(): string {
  return join(process.env["DATA_DIR"] || "./data", "ocr-models");
}

export function modelPath(language: OcrModelLanguage): string {
  return join(modelDirectory(), `${modelCodes[language]}.traineddata.gz`);
}

export async function getModelStatuses(): Promise<OcrModelStatus[]> {
  return Promise.all(
    OCR_LANGUAGES.map(async (language) => {
      try {
        const info = await stat(modelPath(language));
        return { language, installed: info.isFile(), size: info.isFile() ? info.size : null };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { language, installed: false, size: null };
        throw error;
      }
    }),
  );
}

export async function hasModels(language: OcrLanguage): Promise<boolean> {
  const required = language === "de+en" ? OCR_LANGUAGES : [language];
  const installed = await getModelStatuses();
  return required.every((item) =>
    installed.some((model) => model.language === item && model.installed),
  );
}

async function readResponse(response: Response): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_COMPRESSED_BYTES)
    throw new OcrError("modelDownloadFailed");
  const reader = response.body?.getReader();
  if (!reader) throw new OcrError("modelDownloadFailed");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COMPRESSED_BYTES) throw new OcrError("modelDownloadFailed");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function downloadModel(language: OcrModelLanguage): Promise<void> {
  if (downloads.has(language)) throw new OcrError("busy");
  downloads.add(language);
  const directory = modelDirectory();
  const destination = modelPath(language);
  const temporary = join(directory, `.${modelCodes[language]}.${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    const code = modelCodes[language];
    const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}@${MODEL_VERSION}/${MODEL_DIR}/${code}.traineddata.gz`;
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new OcrError("modelDownloadFailed");
    }
    const bytes = await readResponse(response);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new OcrError("modelDownloadFailed");
    gunzipSync(bytes, { maxOutputLength: MAX_MODEL_BYTES });
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    if (error instanceof OcrError) throw error;
    throw new OcrError("modelDownloadFailed");
  } finally {
    downloads.delete(language);
  }
}

export async function deleteModel(
  language: OcrModelLanguage,
  store: OcrSettingsStore,
  hasActiveRecognition: boolean,
): Promise<void> {
  if (hasActiveRecognition) throw new OcrError("busy");
  const current = await resolveSettings(store);
  const usesLanguage =
    current.settings.enabled &&
    (current.settings.language === "de+en" || current.settings.language === language);
  if (usesLanguage) throw new OcrError("modelInUse");
  try {
    await unlink(modelPath(language));
  } catch (error) {
    if (error instanceof OcrError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
