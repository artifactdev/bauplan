// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OCR_ERROR_CODES, OCR_MAX_BYTES, ocrDraftSchema } from "@/lib/ocr";
import { prepareDraft, resolveSettings, settingsView, type OcrSettingsStore } from "./config";
import { downloadModel, getModelStatuses, hasModels, deleteModel, modelPath } from "./models";
import { processDocument, validateDocument } from "./index";
import { connectionSample } from "./sample";
import de from "@/locales/de/ocr.json";
import en from "@/locales/en/ocr.json";

const tesseract = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  setParameters: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock("tesseract.js", () => ({
  createWorker: tesseract.createWorker,
  OEM: { LSTM_ONLY: 1 },
  PSM: { AUTO: "3", SINGLE_BLOCK: "6" },
}));

const enabledSettings = { enabled: true, language: "de+en" as const };
const config = { version: 2 as const, settings: enabledSettings };
const sample = { bytes: connectionSample(), mime: "image/png", name: "test.png" };
let root = "";

function store(value: string | null = null): OcrSettingsStore {
  return {
    readOcrSettings: vi.fn(async () => value),
    writeOcrSettings: vi.fn(async () => {}),
  };
}

async function installModels() {
  const directory = join(root, "ocr-models");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "deu.traineddata.gz"), gzipSync("deu test model")),
    writeFile(join(directory, "eng.traineddata.gz"), gzipSync("eng test model")),
  ]);
}

async function textPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("BAUPLAN 12345 invoice total 123.45 euro", { x: 40, y: 700 });
  return pdf.save();
}

async function scanPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 130]);
  const image = await pdf.embedPng(connectionSample());
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 130 });
  return pdf.save();
}

async function mixedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Readable embedded invoice text with a sufficient number of characters", {
    x: 40,
    y: 700,
  });
  const page = pdf.addPage([600, 130]);
  const image = await pdf.embedPng(connectionSample());
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 130 });
  return pdf.save();
}

/** PNG with a QR code, generated locally by the ZXing writer. */
async function qrPng(text: string): Promise<Uint8Array> {
  const writer = await import("zxing-wasm/writer");
  const file = await readFile(createRequire(import.meta.url).resolve("zxing-wasm/writer/zxing_writer.wasm"));
  const wasmBinary = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  await writer.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
  const { image } = await writer.writeBarcode(text, { format: "QRCode", scale: 6 });
  return new Uint8Array(await image!.arrayBuffer());
}

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), "bauplan-ocr-test-"));
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv("OCR_URL", "http://legacy-service.invalid");
  tesseract.createWorker.mockResolvedValue({
    recognize: tesseract.recognize,
    setParameters: tesseract.setParameters,
    terminate: tesseract.terminate,
  });
  tesseract.recognize.mockResolvedValue({ data: { text: "BAUPLAN 12345" } });
  tesseract.setParameters.mockResolvedValue({});
  tesseract.terminate.mockResolvedValue({});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("local OCR settings and model lifecycle", () => {
  it("ignores legacy external destinations and safely migrates settings without credentials", async () => {
    const legacy = JSON.stringify({
      version: 1,
      settings: {
        enabled: true,
        provider: "docling",
        baseUrl: "https://old-provider.example",
        language: "de",
      },
      secret: { ciphertext: "never-used" },
    });
    const view = await settingsView(store(legacy));
    expect(view).toEqual({
      enabled: true,
      language: "de",
      source: "saved",
      legacySettings: true,
    });
    expect(await settingsView(store())).toEqual({
      enabled: false,
      language: "de+en",
      source: "unconfigured",
      legacySettings: false,
    });
    expect((await resolveSettings(store(legacy))).settings).toEqual({
      enabled: true,
      language: "de",
    });
    expect(await prepareDraft({ settings: enabledSettings })).toEqual(config);
    expect(
      ocrDraftSchema.safeParse({
        settings: { ...enabledSettings, baseUrl: "https://not-allowed.example" },
      }).success,
    ).toBe(false);
  });

  it("fails explicitly for corrupt persisted settings rather than falling back to OCR_URL", async () => {
    await expect(resolveSettings(store("{broken"))).rejects.toMatchObject({
      code: "invalidSettings",
    });
    await expect(resolveSettings(store("{}"))).rejects.toMatchObject({
      code: "invalidSettings",
    });
  });

  it("downloads only a fixed language package, validates gzip data and persists atomically", async () => {
    const model = gzipSync("test traineddata");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(model, { headers: { "content-type": "application/gzip" } }));
    await downloadModel("de");
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int/deu.traineddata.gz",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(await getModelStatuses()).toEqual([
      { language: "de", installed: true, size: model.byteLength },
      { language: "en", installed: false, size: null },
    ]);
    expect(await hasModels("de")).toBe(true);
    expect(await hasModels("de+en")).toBe(false);
    expect(await readFile(modelPath("de"))).toEqual(model);
  });

  it("rejects invalid or oversized model responses without installing them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not a model"));
    await expect(downloadModel("en")).rejects.toMatchObject({ code: "modelDownloadFailed" });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(new Uint8Array(10 * 1024 * 1024 + 1)),
    );
    await expect(downloadModel("en")).rejects.toMatchObject({ code: "modelDownloadFailed" });
    expect((await getModelStatuses())[1]?.installed).toBe(false);
  });

  it("prevents removing a model required by active settings and permits removing an unused one", async () => {
    await installModels();
    await expect(deleteModel("de", store(JSON.stringify(config)), false)).rejects.toMatchObject({
      code: "modelInUse",
    });
    await deleteModel(
      "de",
      store(JSON.stringify({ ...config, settings: { enabled: false, language: "de+en" } })),
      false,
    );
    expect((await getModelStatuses())[0]?.installed).toBe(false);
    await expect(deleteModel("en", store(), true)).rejects.toMatchObject({ code: "busy" });
  });
});

describe("local image and PDF recognition", () => {
  it("validates image signatures, upload limits and the complete PDF page count", async () => {
    await expect(validateDocument(sample)).resolves.toBeNull();
    await expect(
      validateDocument({ ...sample, mime: "image/jpeg", bytes: new Uint8Array([255, 216, 255]) }),
    ).resolves.toBeNull();
    await expect(validateDocument({ ...sample, mime: "image/svg+xml" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      validateDocument({ ...sample, bytes: new Uint8Array(OCR_MAX_BYTES + 1) }),
    ).rejects.toMatchObject({ code: "tooLarge" });
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 10; i++) pdf.addPage();
    const ten = { bytes: await pdf.save(), mime: "application/pdf" };
    await expect(validateDocument(ten)).resolves.toBe(10);
    pdf.addPage();
    await expect(validateDocument({ ...ten, bytes: await pdf.save() })).rejects.toMatchObject({
      code: "tooManyPages",
    });
    await expect(
      validateDocument({ ...ten, bytes: Buffer.from("%PDF-invalid") }),
    ).rejects.toMatchObject({
      code: "invalidPdf",
    });
  });

  it("requires downloaded models and recognizes a local image without HTTP OCR", async () => {
    await expect(processDocument(config, sample)).rejects.toMatchObject({ code: "modelMissing" });
    await installModels();
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await processDocument(config, sample);
    expect(result).toMatchObject({
      provider: "tesseract",
      text: "BAUPLAN 12345",
      pages: null,
      tables: null,
    });
    expect(tesseract.createWorker).toHaveBeenCalledWith(
      "deu+eng",
      1,
      expect.objectContaining({
        langPath: join(root, "ocr-models"),
        gzip: true,
        cacheMethod: "none",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prefers embedded PDF text and OCRs only scan pages in mixed PDFs", async () => {
    await installModels();
    const result = await processDocument(config, {
      bytes: await mixedPdf(),
      mime: "application/pdf",
      name: "mixed.pdf",
    });
    expect(result.pages).toHaveLength(2);
    expect(result.pages?.[0]?.text).toMatch(/Readable embedded invoice text/);
    expect(result.pages?.[1]?.text).toBe("BAUPLAN 12345");
    expect(tesseract.recognize).toHaveBeenCalledTimes(1);
  });

  it("renders and OCRs scanned PDF pages in-process", async () => {
    await installModels();
    const result = await processDocument(config, {
      bytes: await scanPdf(),
      mime: "application/pdf",
      name: "scan.pdf",
    });
    expect(result.pages).toEqual([{ page: 1, text: "BAUPLAN 12345" }]);
    expect(result.text).toBe("BAUPLAN 12345");
  });

  it("reads the image a second time as one text block only when asked", async () => {
    await installModels();
    tesseract.recognize.mockResolvedValueOnce({ data: { text: "Summe 2B,9B" } }).mockResolvedValueOnce({ data: { text: "Summe 28,98" } });
    const secondPass = vi.fn(() => true);
    const result = await processDocument(config, sample, { secondPass });
    expect(secondPass).toHaveBeenCalledWith("Summe 2B,9B");
    expect(result).toMatchObject({ text: "Summe 2B,9B", alternates: ["Summe 28,98"] });
    expect(tesseract.setParameters.mock.calls.map(([p]) => p.tessedit_pageseg_mode).slice(-2)).toEqual(["6", "3"]);

    tesseract.recognize.mockClear();
    const plain = await processDocument(config, sample, { secondPass: () => false });
    expect(plain.alternates).toEqual([]);
    expect(tesseract.recognize).toHaveBeenCalledTimes(1);
  });

  it("decodes QR codes in images locally", async () => {
    await installModels();
    const payload = "BCD\n002\n1\nSCT\n\nMalermeister Weber\nDE89370400440532013000\nEUR2380.00";
    const bytes = await qrPng(payload);
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await processDocument(config, { bytes, mime: "image/png", name: "qr.png" });
    expect(result.codes).toEqual([payload]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns XML attachments of e-invoice PDFs", async () => {
    await installModels();
    const pdf = await PDFDocument.load(await textPdf());
    await pdf.attach(new TextEncoder().encode("<Invoice><IssueDate>2026-02-03</IssueDate></Invoice>"), "xrechnung.xml", {
      mimeType: "application/xml",
    });
    await pdf.attach(new TextEncoder().encode("ignored"), "notes.txt", { mimeType: "text/plain" });
    const result = await processDocument(config, { bytes: await pdf.save(), mime: "application/pdf", name: "e.pdf" });
    expect(result.xml).toEqual(["<Invoice><IssueDate>2026-02-03</IssueDate></Invoice>"]);
    expect(result.codes).toEqual([]);
  });

  it("limits concurrent recognition and releases slots when jobs finish", async () => {
    await installModels();
    const finish: ((value: { data: { text: string } }) => void)[] = [];
    tesseract.recognize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        }),
    );
    const first = processDocument(config, sample);
    const second = processDocument(config, sample);
    await vi.waitFor(() => expect(tesseract.recognize).toHaveBeenCalledTimes(2));
    await expect(processDocument(config, sample)).rejects.toMatchObject({ code: "busy" });
    finish.forEach((resolve) => resolve({ data: { text: "BAUPLAN 12345" } }));
    await expect(first).resolves.toMatchObject({ text: "BAUPLAN 12345" });
    await expect(second).resolves.toMatchObject({ text: "BAUPLAN 12345" });
    const next = processDocument(config, sample);
    await vi.waitFor(() => expect(tesseract.recognize).toHaveBeenCalledTimes(3));
    finish[2]?.({ data: { text: "BAUPLAN 12345" } });
    await expect(next).resolves.toMatchObject({ text: "BAUPLAN 12345" });
  });

  it("rejects disabled settings and localized error catalogues remain complete", async () => {
    await expect(
      processDocument({ ...config, settings: { enabled: false, language: "de+en" } }, sample),
    ).rejects.toMatchObject({ code: "unconfigured" });
    for (const code of OCR_ERROR_CODES) expect(de[code] && en[code]).toBeTruthy();
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(ocrDraftSchema.safeParse({ settings: enabledSettings }).success).toBe(true);
  });
});
