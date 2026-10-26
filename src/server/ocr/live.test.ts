// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { processDocument } from "./index";
import { connectionSample } from "./sample";
import type { OcrLanguage } from "@/lib/ocr";

const enabled = process.env["OCR_TEST_WITH_LOCAL_MODELS"] === "1";
const config = (language: OcrLanguage) => ({
  version: 2 as const,
  settings: { enabled: true, language },
});

async function scannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 130]);
  const image = await pdf.embedPng(connectionSample());
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 130 });
  return pdf.save();
}

describe.skipIf(!enabled)(
  "local Tesseract.js integration (set OCR_TEST_WITH_LOCAL_MODELS=1)",
  () => {
    it.each(["de", "en", "de+en"] as const)(
      "recognizes the sample image using %s",
      async (language) => {
        const result = await processDocument(config(language), {
          bytes: connectionSample(),
          mime: "image/png",
          name: "test.png",
        });
        expect(result.text).toMatch(/BAUPLAN/i);
        expect(result.text).toContain("12345");
      },
      180_000,
    );

    it("reads embedded PDF text and OCRs a scanned PDF locally", async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText("BAUPLAN 12345 invoice total 123.45 euro", { x: 40, y: 700 });
      const textResult = await processDocument(config("de+en"), {
        bytes: await pdf.save(),
        mime: "application/pdf",
        name: "invoice.pdf",
      });
      expect(textResult.pages?.[0]?.text).toMatch(/BAUPLAN 12345/);

      const scanResult = await processDocument(config("de+en"), {
        bytes: await scannedPdf(),
        mime: "application/pdf",
        name: "scan.pdf",
      });
      expect(scanResult.text).toMatch(/BAUPLAN/i);
      expect(scanResult.text).toContain("12345");
    }, 180_000);
  },
);
