import i18n from "@/i18n";

export function ocrText(key: string): string {
  return i18n.t(key, { ns: "ocr" });
}

/** Dev builds only: prints what OCR recognised so the parser rules can be checked. */
export function logOcrResult(
  source: string,
  r: { result: unknown; error: string | null; warnings: string[]; text?: string },
): void {
  if (!import.meta.env.DEV) return;
  console.groupCollapsed(`[OCR] ${source}`);
  console.log("extraction", r.result);
  if (r.error) console.log("error", r.error);
  if (r.warnings.length) console.log("warnings", r.warnings);
  if (r.text !== undefined) console.log("text\n" + r.text);
  console.groupEnd();
}
