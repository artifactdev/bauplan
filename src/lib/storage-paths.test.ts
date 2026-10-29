import { describe, expect, it } from "vitest";
import {
  collectionFolder,
  documentFolder,
  folderName,
  isSafeStoragePath,
  relocatedPath,
} from "./storage-paths";

describe("storage paths", () => {
  it("derives readable folder names", () => {
    expect(folderName("Küche & Bad", "x")).toBe("Kueche-Bad");
    expect(folderName("Café", "x")).toBe("Cafe");
    expect(folderName("  ../  ", "Fallback")).toBe("Fallback");
    expect(folderName(null, "Fallback")).toBe("Fallback");
    expect(documentFolder("Rechnung")).toBe("documents/Rechnung");
    expect(documentFolder("")).toBe("documents/Sonstiges");
    expect(collectionFolder("Wohnzimmer Ideen")).toBe("collections/Wohnzimmer-Ideen");
  });

  it("accepts flat and nested paths but rejects traversal", () => {
    expect(isSafeStoragePath("abc-file.pdf")).toBe(true);
    expect(isSafeStoragePath("documents/Rechnung/abc-file.pdf")).toBe(true);
    expect(isSafeStoragePath("../secret")).toBe(false);
    expect(isSafeStoragePath("documents/../x")).toBe(false);
    expect(isSafeStoragePath("/etc/passwd")).toBe(false);
    expect(isSafeStoragePath("a\\b")).toBe(false);
    expect(isSafeStoragePath("a/b/c/d")).toBe(false);
    expect(isSafeStoragePath("")).toBe(false);
  });

  it("keeps the file name when relocating", () => {
    expect(relocatedPath("abc-file.pdf", "documents/Plan")).toBe("documents/Plan/abc-file.pdf");
    expect(relocatedPath("documents/Plan/abc-file.pdf", "documents/Foto")).toBe(
      "documents/Foto/abc-file.pdf",
    );
  });
});
