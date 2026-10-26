import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  OCR_MAX_BYTES,
  OCR_MAX_RESPONSE_BYTES,
  OCR_ERROR_CODES,
  ocrBaseUrl,
  ocrDraftSchema,
} from "@/lib/ocr";
import {
  decryptSecret,
  encryptSecret,
  prepareDraft,
  resolveSettings,
  settingsView,
  type OcrSettingsStore,
  type StoredOcrSettings,
} from "./config";
import { normalizeDocling, recognize } from "./providers";
import { processDocument, validateDocument } from "./index";
import { connectionSample } from "./sample";
import de from "@/locales/de/ocr.json";
import en from "@/locales/en/ocr.json";

const settings = {
  enabled: true,
  provider: "tesseract" as const,
  baseUrl: "http://127.0.0.1:8000/proxy",
  language: "de+en" as const,
};
const config: StoredOcrSettings = { version: 1, settings, secret: null };
const sample = { bytes: connectionSample(), mime: "image/png", name: "test.png" };
const connection = () => ({ settings, apiKey: "private-key", signal: AbortSignal.timeout(1000) });
function store(value: string | null = null): OcrSettingsStore {
  return {
    readOcrSettings: vi.fn(async () => value),
    writeOcrSettings: vi.fn(async (next) => {
      value = next;
    }),
  };
}
const wire = () => ({
  status: "success",
  errors: [],
  document: {
    text_content: "BAUPLAN 12345\nGesamtbetrag 12,50",
    json_content: {
      pages: { "1": { page_no: 1 } },
      texts: [{ text: "BAUPLAN 12345", prov: [{ page_no: 1 }] }],
      tables: [
        {
          prov: [{ page_no: 1 }],
          data: {
            num_rows: 1,
            num_cols: 1,
            table_cells: [
              {
                text: "12,50",
                start_row_offset_idx: 0,
                start_col_offset_idx: 0,
                row_span: 1,
                col_span: 1,
              },
            ],
          },
        },
      ],
    },
  },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("OCR configuration and credentials", () => {
  it.each([
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://[::1]",
    "http://169.254.169.254",
    "http://192.168.1.2",
    "http://ocr:8000",
    "https://example.org",
    "http://example.org",
  ])("allows the explicitly requested destination %s", (url) => {
    expect(ocrBaseUrl.safeParse(url).success).toBe(true);
  });
  it.each([
    "file:///tmp/file",
    "ftp://host",
    "https://a:b@host",
    "https://host/?key=secret",
    "https://host/#fragment",
    "relative",
  ])("rejects invalid base URL %s", (url) => {
    expect(ocrBaseUrl.safeParse(url).success).toBe(false);
  });
  it("normalizes URL and preserves proxy base paths", () => {
    expect(ocrBaseUrl.parse(" HTTPS://EXAMPLE.ORG/proxy/// ")).toBe("https://example.org/proxy");
  });
  it("uses environment defaults only without saved configuration", async () => {
    vi.stubEnv("OCR_URL", "http://ocr:8000/");
    const repo = store();
    expect(await settingsView(repo)).toMatchObject({
      enabled: true,
      baseUrl: "http://ocr:8000",
      source: "environment",
      hasApiKey: false,
    });
    await repo.writeOcrSettings(
      JSON.stringify({ ...config, settings: { ...settings, enabled: false } }),
    );
    expect(await settingsView(repo)).toMatchObject({ enabled: false, source: "saved" });
    await repo.writeOcrSettings(null);
    expect((await settingsView(repo)).source).toBe("environment");
    vi.stubEnv("OCR_URL", "");
    expect(await settingsView(repo)).toMatchObject({ enabled: false, source: "unconfigured" });
  });
  it("does not silently fall back from invalid saved configuration", async () => {
    vi.stubEnv("OCR_URL", "http://ocr:8000");
    await expect(resolveSettings(store("{}"))).rejects.toMatchObject({ code: "invalidSettings" });
    await expect(resolveSettings(store("invalid-json"))).rejects.toMatchObject({
      code: "invalidSettings",
    });
  });
  it("encrypts with random authenticated nonces and never exposes ciphertext or keys in the admin DTO", async () => {
    vi.stubEnv("OCR_SETTINGS_KEY", "01".repeat(32));
    const first = encryptSecret("secret-api-key");
    const second = encryptSecret("secret-api-key");
    expect(first).not.toEqual(second);
    expect(decryptSecret(first)).toBe("secret-api-key");
    expect(JSON.stringify(first)).not.toContain("secret-api-key");
    const view = await settingsView(store(JSON.stringify({ ...config, secret: first })));
    expect(view.hasApiKey).toBe(true);
    expect(Object.keys(view).sort()).toEqual([
      "baseUrl",
      "enabled",
      "hasApiKey",
      "language",
      "provider",
      "source",
    ]);
    expect(() => decryptSecret({ ...first, tag: Buffer.alloc(16).toString("base64") })).toThrow(
      "secretKey",
    );
    vi.stubEnv("OCR_SETTINGS_KEY", "02".repeat(32));
    expect(() => decryptSecret(first)).toThrow("secretKey");
    vi.stubEnv("OCR_SETTINGS_KEY", "");
    expect(() => encryptSecret("x")).toThrow("secretKey");
    expect(() => decryptSecret(first)).toThrow("secretKey");
  });
  it("supports explicit keep/replace/delete and prevents cross-destination credential reuse", async () => {
    vi.stubEnv("OCR_SETTINGS_KEY", "03".repeat(32));
    const repo = store(JSON.stringify({ ...config, secret: encryptSecret("old-secret") }));
    expect((await prepareDraft(repo, { settings, secretAction: "keep" })).secret).not.toBeNull();
    await expect(
      prepareDraft(repo, {
        settings: { ...settings, baseUrl: "http://other" },
        secretAction: "keep",
      }),
    ).rejects.toMatchObject({ code: "secretDestination" });
    await expect(
      prepareDraft(repo, { settings: { ...settings, provider: "docling" }, secretAction: "keep" }),
    ).rejects.toMatchObject({ code: "secretDestination" });
    expect((await prepareDraft(repo, { settings, secretAction: "delete" })).secret).toBeNull();
    const next = await prepareDraft(repo, {
      settings,
      secretAction: "replace",
      apiKey: "new-secret",
    });
    expect(decryptSecret(next.secret!)).toBe("new-secret");
    await expect(
      prepareDraft(repo, { settings, secretAction: "replace", apiKey: "" }),
    ).rejects.toMatchObject({ code: "secretMissing" });
    expect(repo.writeOcrSettings).not.toHaveBeenCalled();
    vi.stubEnv("OCR_SETTINGS_KEY", "");
    expect((await prepareDraft(repo, { settings, secretAction: "delete" })).secret).toBeNull();
  });
});

describe("OCR limits and provider responses", () => {
  it("checks exact byte boundaries and content signatures", async () => {
    const bytes = new Uint8Array(OCR_MAX_BYTES);
    bytes.set([66, 77]);
    await expect(validateDocument({ ...sample, mime: "image/bmp", bytes })).resolves.toBeNull();
    await expect(
      validateDocument({ ...sample, bytes: new Uint8Array(OCR_MAX_BYTES + 1) }),
    ).rejects.toMatchObject({ code: "tooLarge" });
    await expect(validateDocument({ ...sample, mime: "image/jpeg" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(validateDocument({ ...sample, mime: "image/svg+xml" })).rejects.toMatchObject({
      code: "unsupported",
    });
  });
  it("accepts 10 PDF pages and rejects 11 before any network call", async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 10; i++) pdf.addPage();
    const input = { mime: "application/pdf", name: "test.pdf", bytes: await pdf.save() };
    await expect(validateDocument(input)).resolves.toBe(10);
    pdf.addPage();
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      processDocument(config, { ...input, bytes: await pdf.save() }),
    ).rejects.toMatchObject({ code: "tooManyPages" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      validateDocument({ ...input, bytes: Buffer.from("%PDF-invalid") }),
    ).rejects.toMatchObject({ code: "invalidPdf" });
  });
  it("normalizes real Docling field shapes without inventing capabilities", () => {
    const result = normalizeDocling(wire());
    expect(result.pages).toEqual([{ page: 1, text: "BAUPLAN 12345" }]);
    expect(result.tables?.[0]).toEqual({
      pages: [1],
      rows: 1,
      columns: 1,
      cells: [{ text: "12,50", row: 0, column: 0, rowSpan: 1, columnSpan: 1 }],
    });
    expect(() => normalizeDocling({ status: "partial_success" })).toThrow("partial");
    expect(() => normalizeDocling({ status: "failure" })).toThrow("providerFailure");
    expect(() => normalizeDocling({ status: "success", document: {} })).toThrow("invalidResponse");
    const broken = wire();
    broken.document.json_content.tables[0]!.data.table_cells[0]!.row_span = 2;
    expect(() => normalizeDocling(broken)).toThrow("invalidResponse");
  });
  it("uses fixed proxy-prefixed endpoints, secret header and requested language for modern Tesseract", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ protocol: 1, languages: ["de", "en", "de+en"] }))
      .mockResolvedValueOnce(Response.json({ text: "BAUPLAN 12345" }));
    const result = await recognize(
      { ...connection(), settings: { ...settings, language: "en" } },
      sample,
    );
    expect(result).toMatchObject({
      text: "BAUPLAN 12345",
      pages: null,
      tables: null,
      warnings: [],
    });
    expect(fetch.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8000/proxy/ocr");
    const init = fetch.mock.calls[1]?.[1];
    expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Api-Key")).toBe("private-key");
    expect(headers.get("X-OCR-Language")).toBe("en");
  });
  it("preserves legacy Tesseract with an explicit language warning; rejects unsupported overrides", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ text: "legacy text" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    expect(await recognize(connection(), sample)).toMatchObject({
      warnings: ["legacyLanguage"],
      pages: null,
    });
    await expect(
      recognize({ ...connection(), settings: { ...settings, language: "de" } }, sample),
    ).rejects.toMatchObject({ code: "languageUnsupported" });
  });
  it("uploads files to Docling with local standard pipeline and no remote source URLs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(wire()));
    await recognize({ ...connection(), settings: { ...settings, provider: "docling" } }, sample);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${settings.baseUrl}/v1/convert/file`);
    const form = fetch.mock.calls[0]?.[1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error("Missing multipart body");
    expect(form.getAll("to_formats")).toEqual(["text", "json"]);
    expect(form.getAll("ocr_lang")).toEqual(["de", "en"]);
    expect(form.get("pipeline")).toBe("standard");
    expect(form.get("ocr_preset")).toBe("easyocr");
    expect(form.get("include_images")).toBe("false");
    expect(form.get("sources")).toBeNull();
  });
  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [302, "redirect"],
    [500, "providerFailure"],
  ] as const)("reports HTTP %s explicitly", async (status, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status }));
    await expect(recognize(connection(), sample)).rejects.toMatchObject({ code });
  });
  it("rejects malformed, oversized and empty responses", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not-json"))
      .mockResolvedValueOnce(new Response("x".repeat(OCR_MAX_RESPONSE_BYTES + 1)))
      .mockResolvedValueOnce(Response.json({ protocol: 1, languages: ["de+en"] }))
      .mockResolvedValueOnce(Response.json({ text: "  " }));
    await expect(recognize(connection(), sample)).rejects.toMatchObject({
      code: "invalidResponse",
    });
    await expect(recognize(connection(), sample)).rejects.toMatchObject({
      code: "responseTooLarge",
    });
    await expect(recognize(connection(), sample)).rejects.toMatchObject({ code: "emptyText" });
  });
  it("reports timeouts and connection errors without leaking transport details", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("secret destination detail"));
    await expect(recognize(connection(), sample)).rejects.toMatchObject({
      code: "unreachable",
      message: "unreachable",
    });
    await expect(
      recognize({ ...connection(), signal: AbortSignal.abort() }, sample),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("bounds concurrency and releases slots on completion", async () => {
    const resolvers: ((value: Response) => void)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const one = processDocument(config, sample);
    const two = processDocument(config, sample);
    await expect(processDocument(config, sample)).rejects.toMatchObject({ code: "busy" });
    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    resolvers.forEach((resolve) => resolve(new Response("{}", { status: 401 })));
    await expect(one).rejects.toMatchObject({ code: "authentication" });
    await expect(two).rejects.toMatchObject({ code: "authentication" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    await expect(processDocument(config, sample)).rejects.toMatchObject({ code: "authentication" });
  });
  it("has complete German and English OCR/error translations", () => {
    for (const code of OCR_ERROR_CODES) expect(de[code] && en[code]).toBeTruthy();
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(ocrDraftSchema.safeParse({ settings, secretAction: "delete" }).success).toBe(true);
  });
});
