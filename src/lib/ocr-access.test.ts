import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type Context = Record<string, unknown>;
  type Step = (args: {
    context: Context;
    next: (value?: { context: Context }) => Promise<Context>;
  }) => Promise<Context>;
  type Middleware = { steps: Step[] };
  const state = {
    user: null as { id: string; role: string } | null,
    repo: {
      readAppearance: vi.fn(async () => ({ palette: "current", mode: "system" })),
      writeAppearance: vi.fn(async () => {}),
      readOcrSettings: vi.fn(async (): Promise<string | null> => null),
      writeOcrSettings: vi.fn(async () => {}),
      getAll: vi.fn(async () => ({
        documents: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "test.bmp",
            storage_path: "test.bmp",
            mime_type: "image/bmp",
          },
        ],
        trades: [],
      })),
      readFile: vi.fn(async () => new Uint8Array([66, 77])),
    },
  };
  return {
    state,
    createMiddleware() {
      let parents: Middleware[] = [];
      return {
        middleware(value: Middleware[]) {
          parents = value;
          return this;
        },
        server(step: Step): Middleware {
          return { steps: [...parents.flatMap((p) => p.steps), step] };
        },
      };
    },
    createServerFn() {
      let middleware: Middleware[] = [];
      let validate: (d: unknown) => unknown = (d) => d;
      return {
        middleware(value: Middleware[]) {
          middleware = value;
          return this;
        },
        inputValidator(value: (d: unknown) => unknown) {
          validate = value;
          return this;
        },
        handler(fn: (args: { context: Context; data: unknown }) => Promise<unknown>) {
          return async (options?: { data: unknown }) => {
            let context: Context = {};
            for (const step of middleware.flatMap((m) => m.steps)) {
              context = await step({
                context,
                next: async (value) => ({ ...context, ...value?.context }),
              });
            }
            return fn({ context, data: validate(options?.data) });
          };
        },
      };
    },
  };
});
vi.mock("@tanstack/react-start", () => ({
  createServerFn: harness.createServerFn,
  createMiddleware: harness.createMiddleware,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/"),
}));
vi.mock("@/server/repo", () => ({ sqliteRepo: () => harness.state.repo }));
vi.mock("@/server/local-auth", () => ({
  SESSION_COOKIE: "bp_session",
  cookieFrom: () => null,
  userFromToken: async () => harness.state.user,
}));
vi.mock("@/server/ocr", () => ({
  processDocument: vi.fn(async () => ({
    provider: "tesseract",
    text: "BAUPLAN 12345\nRechnung\nGesamtbetrag 12,50",
    pages: null,
    tables: null,
    warnings: [],
  })),
}));

import {
  getOcrSettings,
  saveOcrSettings,
  testOcrSettings,
  resetOcrSettings,
  getAppearance,
  saveAppearance,
} from "./data.functions";
import { analyzeDocument } from "./ocr.functions";
import { processDocument } from "@/server/ocr";

const draft = {
  settings: {
    enabled: true,
    provider: "tesseract" as const,
    baseUrl: "http://localhost:8000",
    language: "de+en" as const,
  },
  secretAction: "delete" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.state.user = null;
  harness.state.repo.readOcrSettings.mockResolvedValue(null);
});

describe("Private account appearance server functions", () => {
  it.each([null, "pending"])("rejects appearance reads and writes for %s", async (role) => {
    harness.state.user = role ? { id: "blocked", role } : null;
    await expect(getAppearance()).rejects.toThrow("Unauthorized");
    await expect(saveAppearance({ data: { palette: "blue", mode: "dark" } })).rejects.toThrow("Unauthorized");
    expect(harness.state.repo.readAppearance).not.toHaveBeenCalled();
    expect(harness.state.repo.writeAppearance).not.toHaveBeenCalled();
  });
  it.each(["admin", "member"])("uses only the authenticated %s identity", async (role) => {
    harness.state.user = { id: "self", role };
    expect(await getAppearance()).toEqual({ palette: "current", mode: "system" });
    expect(harness.state.repo.readAppearance).toHaveBeenCalledWith("self");
    await saveAppearance({ data: { palette: "violet", mode: "light" } });
    expect(harness.state.repo.writeAppearance).toHaveBeenCalledWith("self", { palette: "violet", mode: "light" });
  });
  it("rejects unknown values and identity overrides before writing", async () => {
    harness.state.user = { id: "self", role: "member" };
    for (const data of [
      { palette: "invalid", mode: "dark" },
      { palette: "blue", mode: "invalid" },
      { palette: "blue", mode: "dark", userId: "other" },
    ]) {
      // Exercise runtime input validation, including untyped HTTP callers.
      await expect(saveAppearance({ data: data as { palette: "blue"; mode: "dark" } })).rejects.toThrow();
    }
    expect(harness.state.repo.writeAppearance).not.toHaveBeenCalled();
  });
});

describe("OCR server-function authorization and orchestration", () => {
  it.each([null, "pending", "member"])("rejects admin settings actions for %s", async (role) => {
    harness.state.user = role ? { id: "user", role } : null;
    for (const operation of [
      () => getOcrSettings(),
      () => saveOcrSettings({ data: draft }),
      () => testOcrSettings({ data: draft }),
      () => resetOcrSettings(),
    ])
      await expect(operation()).rejects.toThrow("Unauthorized");
    expect(harness.state.repo.readOcrSettings).not.toHaveBeenCalled();
    expect(harness.state.repo.writeOcrSettings).not.toHaveBeenCalled();
    expect(processDocument).not.toHaveBeenCalled();
  });
  it("allows admins to save and reset private settings", async () => {
    harness.state.user = { id: "admin", role: "admin" };
    expect(await saveOcrSettings({ data: draft })).toEqual({ data: true, error: null });
    expect(harness.state.repo.writeOcrSettings).toHaveBeenCalledWith(
      expect.stringContaining('"version":1'),
    );
    await resetOcrSettings();
    expect(harness.state.repo.writeOcrSettings).toHaveBeenLastCalledWith(null);
  });
  it("tests a draft by actual conversion without saving or reading a private upload", async () => {
    harness.state.user = { id: "admin", role: "admin" };
    expect(await testOcrSettings({ data: draft })).toEqual({ data: { warnings: [] }, error: null });
    expect(processDocument).toHaveBeenCalledWith(
      expect.objectContaining({ settings: draft.settings }),
      expect.objectContaining({ name: "bauplan-test.png", mime: "image/png" }),
    );
    expect(harness.state.repo.writeOcrSettings).not.toHaveBeenCalled();
    expect(harness.state.repo.readFile).not.toHaveBeenCalled();
  });
  it("does not turn an empty/incorrect health-style response into test success", async () => {
    harness.state.user = { id: "admin", role: "admin" };
    vi.mocked(processDocument).mockResolvedValueOnce({
      provider: "tesseract",
      text: "ok",
      pages: null,
      tables: null,
      warnings: [],
    });
    expect(await testOcrSettings({ data: draft })).toMatchObject({
      data: null,
      error: "testFailed",
    });
  });
  it.each([null, "pending"])("rejects document analysis for %s", async (role) => {
    harness.state.user = role ? { id: "user", role } : null;
    await expect(
      analyzeDocument({ data: { documentId: "11111111-1111-4111-8111-111111111111" } }),
    ).rejects.toThrow("Unauthorized");
    expect(processDocument).not.toHaveBeenCalled();
  });
  it("lets members analyze using only the saved destination and existing extraction rules", async () => {
    harness.state.user = { id: "member", role: "member" };
    harness.state.repo.readOcrSettings.mockResolvedValue(
      JSON.stringify({ version: 1, settings: draft.settings, secret: null }),
    );
    const result = await analyzeDocument({
      data: { documentId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(result).toMatchObject({ error: null, result: { amount: 12.5 } });
    expect(processDocument).toHaveBeenCalledWith(
      expect.objectContaining({ settings: draft.settings }),
      expect.objectContaining({ name: "test.bmp" }),
    );
  });
});
