import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { dataContext } from "./data.functions";
import { extractFromText, type Extraction } from "./ocr-parse";
import type { OcrErrorCode } from "./ocr";

export { DOC_TYPES, type DocType, type Extraction } from "./ocr-parse";

/** Provider-independent OCR followed by rule-based business-field extraction. */
export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((d: unknown) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }): Promise<{ result: Extraction | null; error: OcrErrorCode | null; warnings: string[]; text?: string }> => {
    const { resolveSettings } = await import("@/server/ocr/config");
    const { processDocument } = await import("@/server/ocr");
    const { OcrError, ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      const ws = await context.repo.getAll();
      const doc = ws.documents.find((x) => x.id === data.documentId);
      if (!doc?.storage_path) throw new OcrError("notFound");
      const bytes = await context.repo.readFile(doc.storage_path);
      if (!bytes) throw new OcrError("unreadable");
      const config = await resolveSettings(context.repo);
      const result = await processDocument(config, { bytes, mime: doc.mime_type ?? "", name: doc.name });
      const extraction = extractFromText(result.text, ws.trades.map((t) => t.name));
      // Raw text only leaves the server in dev builds, for debugging the rule-based parser.
      if (import.meta.env.DEV) return { result: extraction, error: null, warnings: result.warnings, text: result.text };
      return { result: extraction, error: null, warnings: result.warnings };
    } catch (error) {
      return { result: null, error: ocrErrorCode(error), warnings: [] };
    }
  });
