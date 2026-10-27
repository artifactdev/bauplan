export type PdfPageImage = { jpeg: Uint8Array; width: number; height: number };

/** Long page edge in PDF points (A4: 297 mm). */
const LONG_EDGE_PT = 841.89;

/** Page size in points: the image's aspect ratio with the long edge of an A4 sheet. */
export function pageSize(width: number, height: number): [number, number] {
  const scale = LONG_EDGE_PT / Math.max(width, height);
  return [width * scale, height * scale];
}

/** Combines JPEG page images (in order) into one PDF. pdf-lib is loaded on demand. */
export async function buildScanPdf(pages: PdfPageImage[], title?: string): Promise<Uint8Array> {
  if (!pages.length) throw new Error("No pages");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  if (title) pdf.setTitle(title);
  pdf.setCreator("Bauplan");
  pdf.setProducer("Bauplan document scanner");
  for (const page of pages) {
    const image = await pdf.embedJpg(page.jpeg);
    const [w, h] = pageSize(page.width, page.height);
    pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return pdf.save();
}

export async function createScanFile(pages: PdfPageImage[], name: string): Promise<File> {
  const bytes = await buildScanPdf(pages, name.replace(/\.pdf$/i, ""));
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

/** File-system safe timestamp, e.g. "2026-03-14 09-05". */
export function scanTimestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}`;
}
