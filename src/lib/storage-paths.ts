// Relative upload paths: documents/<category>/<file> and collections/<collection>/<file>.

export const DOCUMENTS_DIR = "documents";
export const COLLECTIONS_DIR = "collections";
export const DEFAULT_DOCUMENT_FOLDER = "Sonstiges";
export const DEFAULT_COLLECTION_FOLDER = "Allgemein";
const SEGMENT = /^[a-zA-Z0-9._-]{1,255}$/;
const MAX_DEPTH = 3;

const TRANSLITERATION: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

/** Readable, filesystem-safe folder name derived from a category or collection label. */
export function folderName(value: string | null | undefined, fallback: string): string {
  const name = (value ?? "")
    .replace(/[äöüÄÖÜß]/g, (c) => TRANSLITERATION[c] ?? c)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 60)
    .replace(/[-._]+$/g, "");
  return name || fallback;
}

export function isSafeStoragePath(p: string): boolean {
  const segments = p.split("/");
  return (
    segments.length <= MAX_DEPTH &&
    segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")
  );
}

export function storageFileName(p: string): string {
  return p.split("/").pop() ?? p;
}

export function documentFolder(category: string | null | undefined): string {
  return `${DOCUMENTS_DIR}/${folderName(category, DEFAULT_DOCUMENT_FOLDER)}`;
}

export function collectionFolder(collection: string | null | undefined): string {
  return `${COLLECTIONS_DIR}/${folderName(collection, DEFAULT_COLLECTION_FOLDER)}`;
}

/** Target path for an existing file in a folder, keeping its unique file name. */
export function relocatedPath(current: string, folder: string): string {
  return `${folder}/${storageFileName(current)}`;
}
