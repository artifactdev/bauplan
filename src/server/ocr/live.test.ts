// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { processDocument } from "./index";
import { encryptSecret, type StoredOcrSettings } from "./config";
import { connectionSample } from "./sample";
import type { OcrProvider } from "@/lib/ocr";
import { extractFromText } from "@/lib/ocr-parse";

async function invoicePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.drawText("BAUPLAN 12345\nRechnung vom 26.10.2026\nGesamtbetrag 123,45 EUR\nVielen Dank", {
    x: 40,
    y: 700,
    size: 18,
  });
  return pdf.save();
}

async function scannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 130]);
  const image = await pdf.embedPng(connectionSample());
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 130 });
  return pdf.save();
}

async function tablePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.drawText("Rechnung BAUPLAN", { x: 50, y: 700, size: 24 });
  for (const y of [620, 570, 520])
    page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 1 });
  for (const x of [50, 350, 550])
    page.drawLine({ start: { x, y: 520 }, end: { x, y: 620 }, thickness: 1 });
  for (const [text, x, y] of [
    ["Position", 65, 590],
    ["Betrag", 365, 590],
    ["Material", 65, 540],
    ["12,50", 365, 540],
  ] as const) {
    page.drawText(text, { x, y, size: 18 });
  }
  return pdf.save();
}

const providers: { provider: OcrProvider; url: string | undefined }[] = [
  { provider: "tesseract", url: process.env["OCR_TEST_TESSERACT_URL"] },
  { provider: "docling", url: process.env["OCR_TEST_DOCLING_URL"] },
];

for (const { provider, url } of providers) {
  describe.skipIf(!url)(`live ${provider} (requires explicit OCR_TEST_*_URL)`, () => {
    function config(language: "de" | "en" | "de+en" = "de+en"): StoredOcrSettings {
      const key = process.env["OCR_TEST_API_KEY"];
      return {
        version: 1,
        settings: { provider, enabled: true, baseUrl: url!, language },
        secret: key ? encryptSecret(key) : null,
      };
    }
    for (const language of ["de", "en", "de+en"] as const) {
      it(`recognizes the real raster test in ${language}`, async () => {
        const result = await processDocument(config(language), {
          bytes: connectionSample(),
          mime: "image/png",
          name: "test.png",
        });
        expect(result.text).toMatch(/BAUPLAN/i);
        expect(result.text).toContain("12345");
        if (provider === "docling") expect(result.pages).toHaveLength(1);
      }, 180_000);
    }
    it("reads a complete embedded-text invoice PDF", async () => {
      const result = await processDocument(config(), {
        bytes: await invoicePdf(),
        mime: "application/pdf",
        name: "invoice.pdf",
      });
      expect(extractFromText(result.text).amount).toBe(123.45);
      if (provider === "docling") expect(result.pages).toHaveLength(1);
    }, 180_000);
    it("reads a real scanned PDF without an embedded text layer", async () => {
      const result = await processDocument(config(), {
        bytes: await scannedPdf(),
        mime: "application/pdf",
        name: "scan.pdf",
      });
      expect(result.text).toMatch(/BAUPLAN/i);
      expect(result.text).toContain("12345");
    }, 180_000);
    it.skipIf(provider !== "docling")(
      "normalizes actual table structure",
      async () => {
        const result = await processDocument(config(), {
          bytes: await tablePdf(),
          mime: "application/pdf",
          name: "table.pdf",
        });
        expect(result.tables?.length).toBeGreaterThan(0);
        const table = result.tables![0]!;
        expect(table.rows).toBeGreaterThanOrEqual(2);
        expect(table.columns).toBe(2);
        expect(table.pages).toEqual([1]);
        expect(table.cells.map((cell) => cell.text).join(" ")).toMatch(/Material/);
      },
      180_000,
    );
    it.skipIf(!process.env["OCR_TEST_API_KEY"])(
      "rejects an incorrect API key",
      async () => {
        const wrong = { ...config(), secret: encryptSecret("incorrect-test-key") };
        await expect(
          processDocument(wrong, {
            bytes: connectionSample(),
            mime: "image/png",
            name: "test.png",
          }),
        ).rejects.toMatchObject({ code: "authentication" });
      },
      180_000,
    );
  });
}
