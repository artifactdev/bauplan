import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

type Reader = typeof import("zxing-wasm/reader");
let reader: Promise<Reader> | null = null;

/** Loads the ZXing WASM reader from node_modules; the default would fetch it from a CDN. */
function loadReader(): Promise<Reader> {
  reader ??= (async () => {
    const mod = await import("zxing-wasm/reader");
    const file = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
    const bytes = await readFile(file);
    const wasmBinary = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await mod.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    return mod;
  })().catch((error: unknown) => {
    reader = null;
    throw error;
  });
  return reader;
}

/**
 * Decodes all QR codes in a PNG/JPEG/BMP image (TSE receipt codes, GiroCodes).
 * Best effort: failures never break OCR.
 */
export async function decodeQrCodes(image: Uint8Array): Promise<string[]> {
  try {
    const { readBarcodes } = await loadReader();
    const results = await readBarcodes(image, {
      formats: ["QRCode"],
      tryHarder: true,
      maxNumberOfSymbols: 8,
    });
    return results.filter((r) => r.isValid && r.text).map((r) => r.text);
  } catch {
    return [];
  }
}
