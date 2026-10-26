import i18n from "@/i18n";

export function ocrText(key: string): string {
  return i18n.t(key, { ns: "ocr" });
}
