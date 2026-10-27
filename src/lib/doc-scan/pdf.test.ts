// @vitest-environment node
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { validateDocument } from "@/server/ocr";
import { buildScanPdf, createScanFile, pageSize, scanTimestamp } from "./pdf";

function jpeg(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillText("Rechnung 123,45 EUR", 10, 30);
  return { jpeg: new Uint8Array(canvas.toBuffer("image/jpeg")), width, height };
}

describe("scan PDF", () => {
  it("gives every page the image's aspect ratio with an A4 long edge", () => {
    const [w, h] = pageSize(1000, 1414);
    expect(h).toBeCloseTo(841.89);
    expect(w / h).toBeCloseTo(1000 / 1414);
    const [lw, lh] = pageSize(1600, 900);
    expect(lw).toBeCloseTo(841.89);
    expect(lh).toBeLessThan(lw);
  });

  it("combines pages in order into one PDF", async () => {
    const bytes = await buildScanPdf([jpeg(400, 566), jpeg(600, 300), jpeg(300, 300)], "Scan");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    const [first, second, third] = pdf.getPages().map((p) => p.getSize());
    expect(first!.height).toBeGreaterThan(first!.width);
    expect(second!.width).toBeGreaterThan(second!.height);
    expect(third!.width).toBeCloseTo(third!.height);
    expect(pdf.getTitle()).toBe("Scan");
  });

  it("refuses to build an empty PDF", async () => {
    await expect(buildScanPdf([])).rejects.toThrow();
  });

  it("creates an upload-ready PDF file that the server-side OCR accepts", async () => {
    const file = await createScanFile(
      [jpeg(500, 700), jpeg(500, 700)],
      "Scan 2026-03-14 09-05.pdf",
    );
    expect(file.type).toBe("application/pdf");
    expect(file.name).toBe("Scan 2026-03-14 09-05.pdf");
    const pages = await validateDocument({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime: file.type,
    });
    expect(pages).toBe(2);
  });

  it("formats file-system safe timestamps", () => {
    expect(scanTimestamp(new Date(2026, 2, 4, 9, 5))).toBe("2026-03-04 09-05");
  });
});
