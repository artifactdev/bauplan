import { z } from "zod";
import {
  OCR_MAX_RESPONSE_BYTES,
  type OcrLanguage,
  type OcrRecognition,
  type OcrSettings,
} from "@/lib/ocr";
import { OcrError, isOcrErrorCode } from "./errors";

export type OcrInput = { bytes: Uint8Array; mime: string; name: string };
type Connection = { settings: OcrSettings; apiKey: string | null; signal: AbortSignal };

async function request(
  connection: Connection,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (connection.apiKey) headers.set("X-Api-Key", connection.apiKey);
  const response = await fetch(`${connection.settings.baseUrl}${path}`, {
    ...init,
    headers,
    redirect: "manual",
    signal: connection.signal,
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new OcrError("redirect");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new OcrError("authentication");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new OcrError("invalidResponse");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > OCR_MAX_RESPONSE_BYTES) throw new OcrError("responseTooLarge");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OcrError("invalidResponse");
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(json);
    if (
      connection.settings.provider === "tesseract" &&
      error.success &&
      isOcrErrorCode(error.data.error)
    )
      throw new OcrError(error.data.error);
    throw new OcrError("providerFailure");
  }
  return json;
}

const textResponse = z.object({ text: z.string() });
const capabilities = z.object({
  protocol: z.literal(1),
  languages: z.array(z.enum(["de", "en", "de+en"])),
});
const legacyHealth = z.object({ ok: z.literal(true) });

async function tesseract(connection: Connection, input: OcrInput): Promise<OcrRecognition> {
  const info = await request(connection, "/capabilities");
  const caps = capabilities.safeParse(info);
  const warnings: string[] = [];
  if (!caps.success) {
    if (!legacyHealth.safeParse(info).success) throw new OcrError("invalidResponse");
    if (connection.settings.language !== "de+en") throw new OcrError("languageUnsupported");
    warnings.push("legacyLanguage");
  } else if (!caps.data.languages.includes(connection.settings.language))
    throw new OcrError("languageUnsupported");
  const result = textResponse.safeParse(
    await request(connection, "/ocr", {
      method: "POST",
      headers: {
        "Content-Type": input.mime,
        ...(caps.success ? { "X-OCR-Language": connection.settings.language } : {}),
      },
      body: new Blob([Uint8Array.from(input.bytes)]),
    }),
  );
  if (!result.success) throw new OcrError("invalidResponse");
  return { provider: "tesseract", text: result.data.text, pages: null, tables: null, warnings };
}

const pageNumber = z.number().int().min(1).max(10);
const provenance = z.array(z.object({ page_no: pageNumber }));
const cellSchema = z.object({
  text: z.string(),
  start_row_offset_idx: z.number().int().nonnegative(),
  start_col_offset_idx: z.number().int().nonnegative(),
  row_span: z.number().int().positive(),
  col_span: z.number().int().positive(),
});
const doclingResponse = z.object({
  status: z.string(),
  errors: z.array(z.unknown()),
  document: z.object({
    text_content: z.string(),
    json_content: z.object({
      pages: z.record(z.object({ page_no: pageNumber })),
      texts: z.array(z.object({ text: z.string(), prov: provenance })),
      tables: z.array(
        z.object({
          prov: provenance,
          data: z.object({
            num_rows: z.number().int().nonnegative(),
            num_cols: z.number().int().nonnegative(),
            table_cells: z.array(cellSchema),
          }),
        }),
      ),
    }),
  }),
});

export function normalizeDocling(value: unknown): OcrRecognition {
  const status = z.object({ status: z.string() }).safeParse(value);
  if (status.success && status.data.status !== "success")
    throw new OcrError(status.data.status === "partial_success" ? "partial" : "providerFailure");
  const parsed = doclingResponse.safeParse(value);
  if (!parsed.success) throw new OcrError("invalidResponse");
  if (parsed.data.errors.length) throw new OcrError("partial");
  const doc = parsed.data.document.json_content;
  const pages = Object.values(doc.pages)
    .sort((a, b) => a.page_no - b.page_no)
    .map((p) => ({
      page: p.page_no,
      text: doc.texts
        .filter((t) => t.prov.some((prov) => prov.page_no === p.page_no))
        .map((t) => t.text)
        .join("\n"),
    }));
  if (!pages.length || new Set(pages.map((p) => p.page)).size !== pages.length)
    throw new OcrError("invalidResponse");
  const knownPages = new Set(pages.map((p) => p.page));
  if (
    [...doc.texts, ...doc.tables].some((item) => item.prov.some((p) => !knownPages.has(p.page_no)))
  )
    throw new OcrError("invalidResponse");
  const tables = doc.tables.map((table) => {
    if (
      table.data.table_cells.some(
        (cell) =>
          cell.start_row_offset_idx + cell.row_span > table.data.num_rows ||
          cell.start_col_offset_idx + cell.col_span > table.data.num_cols,
      )
    )
      throw new OcrError("invalidResponse");
    return {
      pages: [...new Set(table.prov.map((p) => p.page_no))],
      rows: table.data.num_rows,
      columns: table.data.num_cols,
      cells: table.data.table_cells.map((cell) => ({
        text: cell.text,
        row: cell.start_row_offset_idx,
        column: cell.start_col_offset_idx,
        rowSpan: cell.row_span,
        columnSpan: cell.col_span,
      })),
    };
  });
  return {
    provider: "docling",
    text: parsed.data.document.text_content,
    pages,
    tables,
    warnings: [],
  };
}

const doclingLanguages: Record<OcrLanguage, string[]> = {
  de: ["de"],
  en: ["en"],
  "de+en": ["de", "en"],
};

async function docling(connection: Connection, input: OcrInput): Promise<OcrRecognition> {
  const form = new FormData();
  form.append("files", new Blob([Uint8Array.from(input.bytes)], { type: input.mime }), input.name);
  for (const format of ["text", "json"]) form.append("to_formats", format);
  for (const language of doclingLanguages[connection.settings.language])
    form.append("ocr_lang", language);
  for (const [key, value] of Object.entries({
    target_type: "inbody",
    pipeline: "standard",
    ocr_preset: "easyocr",
    do_ocr: "true",
    do_table_structure: "true",
    image_export_mode: "placeholder",
    include_images: "false",
    include_page_images: "false",
    do_code_enrichment: "false",
    do_formula_enrichment: "false",
    do_picture_classification: "false",
    do_picture_description: "false",
    do_chart_extraction: "false",
    document_timeout: "170",
    abort_on_error: "true",
  }))
    form.append(key, value);
  return normalizeDocling(
    await request(connection, "/v1/convert/file", { method: "POST", body: form }),
  );
}

export async function recognize(connection: Connection, input: OcrInput): Promise<OcrRecognition> {
  try {
    const result = await (connection.settings.provider === "tesseract"
      ? tesseract(connection, input)
      : docling(connection, input));
    if (!result.text.trim()) throw new OcrError("emptyText");
    return result;
  } catch (error) {
    if (error instanceof OcrError) throw error;
    if (connection.signal.aborted) throw new OcrError("timeout");
    throw new OcrError("unreachable");
  }
}
