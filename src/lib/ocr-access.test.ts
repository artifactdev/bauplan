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
    users: [
      { id: "admin-1", email: "admin@example.test", name: "Admin", role: "admin" },
      { id: "member-1", email: "member@example.test", name: "Member", role: "member" },
      { id: "pending-1", email: "pending@example.test", name: "Pending", role: "pending" },
    ],
    repo: {
      readAppearance: vi.fn(async () => ({ primaryColor: "#0e6375", mode: "system" })),
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
        contacts: [],
      })),
      readFile: vi.fn(async () => new Uint8Array([66, 77])),
      insert: vi.fn(async (_table: string, row: Record<string, unknown>) => ({
        id: "task-1",
        ...row,
      })),
      update: vi.fn(async () => {}),
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
  listUsers: async () => harness.state.users,
}));
vi.mock("@/server/ocr", () => ({
  processDocument: vi.fn(async () => ({
    provider: "tesseract",
    text: "BAUPLAN 12345\nRechnung\nGesamtbetrag 12,50",
    pages: null,
    tables: null,
    warnings: [],
    codes: [],
    xml: [],
    alternates: [],
  })),
  ocrIsActive: () => false,
}));
vi.mock("@/server/ocr/models", () => ({
  hasModels: vi.fn(async () => true),
  getModelStatuses: vi.fn(async () => [
    { language: "de", installed: true, size: 100 },
    { language: "en", installed: true, size: 100 },
  ]),
  downloadModel: vi.fn(async () => {}),
  deleteModel: vi.fn(async () => {}),
}));

import {
  deleteOcrModel,
  downloadOcrModel,
  getOcrModels,
  getOcrSettings,
  saveOcrSettings,
  testOcrSettings,
  resetOcrSettings,
  getAppearance,
  saveAppearance,
  getTaskAssignees,
  createRow,
  updateRow,
} from "./data.functions";
import { analyzeDocument } from "./ocr.functions";
import { processDocument } from "@/server/ocr";
import { hasModels } from "@/server/ocr/models";

const draft = {
  settings: {
    enabled: true,
    language: "de+en" as const,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.state.user = null;
  harness.state.users = [
    { id: "admin-1", email: "admin@example.test", name: "Admin", role: "admin" },
    { id: "member-1", email: "member@example.test", name: "Member", role: "member" },
    { id: "pending-1", email: "pending@example.test", name: "Pending", role: "pending" },
  ];
  harness.state.repo.readOcrSettings.mockResolvedValue(null);
});

describe("Task assignment functions", () => {
  it("only exposes active admin and member accounts to signed-in project users", async () => {
    harness.state.user = { id: "member-1", role: "member" };
    await expect(getTaskAssignees()).resolves.toEqual([
      { id: "admin-1", label: "Admin" },
      { id: "member-1", label: "Member" },
    ]);
    harness.state.user = { id: "pending-1", role: "pending" };
    await expect(getTaskAssignees()).rejects.toThrow("Unauthorized");
  });
  it("validates active assignees before creating or updating tasks", async () => {
    harness.state.user = { id: "member-1", role: "member" };
    await expect(
      createRow({
        data: { table: "tasks", row: { title: "Check roof", assignee_id: "pending-1" } },
      }),
    ).rejects.toThrow("tasks.assignee_not_available");
    expect(harness.state.repo.insert).not.toHaveBeenCalled();
    await createRow({
      data: { table: "tasks", row: { title: "Check roof", assignee_id: "member-1" } },
    });
    expect(harness.state.repo.insert).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({ assignee_id: "member-1" }),
    );
    await expect(
      updateRow({
        data: { table: "tasks", id: "task-1", patch: { assignee_id: "deleted-user" } },
      }),
    ).rejects.toThrow("tasks.assignee_not_available");
    expect(harness.state.repo.update).not.toHaveBeenCalled();
  });
});

describe("Private account appearance server functions", () => {
  it.each([null, "pending"])("rejects appearance reads and writes for %s", async (role) => {
    harness.state.user = role ? { id: "blocked", role } : null;
    await expect(getAppearance()).rejects.toThrow("Unauthorized");
    await expect(
      saveAppearance({ data: { primaryColor: "#295cc5", mode: "dark" } }),
    ).rejects.toThrow("Unauthorized");
    expect(harness.state.repo.readAppearance).not.toHaveBeenCalled();
    expect(harness.state.repo.writeAppearance).not.toHaveBeenCalled();
  });
  it.each(["admin", "member"])("uses only the authenticated %s identity", async (role) => {
    harness.state.user = { id: "self", role };
    expect(await getAppearance()).toEqual({ primaryColor: "#0e6375", mode: "system" });
    expect(harness.state.repo.readAppearance).toHaveBeenCalledWith("self");
    await saveAppearance({ data: { primaryColor: "#6d28d9", mode: "light" } });
    expect(harness.state.repo.writeAppearance).toHaveBeenCalledWith("self", {
      primaryColor: "#6d28d9",
      mode: "light",
    });
  });
  it("rejects unknown values and identity overrides before writing", async () => {
    harness.state.user = { id: "self", role: "member" };
    for (const data of [
      { primaryColor: "invalid", mode: "dark" },
      { primaryColor: "#295cc5", mode: "invalid" },
      { primaryColor: "#295cc5", mode: "dark", userId: "other" },
    ]) {
      // Exercise runtime input validation, including untyped HTTP callers.
      await expect(
        saveAppearance({ data: data as { primaryColor: string; mode: "dark" } }),
      ).rejects.toThrow();
    }
    expect(harness.state.repo.writeAppearance).not.toHaveBeenCalled();
  });
});

describe("OCR server-function authorization and orchestration", () => {
  it.each([null, "pending", "member"])("rejects admin settings actions for %s", async (role) => {
    harness.state.user = role ? { id: "user", role } : null;
    for (const operation of [
      () => getOcrSettings(),
      () => getOcrModels(),
      () => saveOcrSettings({ data: draft }),
      () => testOcrSettings({ data: draft }),
      () => downloadOcrModel({ data: { language: "de" } }),
      () => deleteOcrModel({ data: { language: "de" } }),
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
      expect.stringContaining('"version":2'),
    );
    expect(await getOcrModels()).toMatchObject({
      data: [
        { language: "de", installed: true },
        { language: "en", installed: true },
      ],
      error: null,
    });
    expect(await downloadOcrModel({ data: { language: "de" } })).toEqual({
      data: true,
      error: null,
    });
    expect(await deleteOcrModel({ data: { language: "de" } })).toEqual({
      data: true,
      error: null,
    });
    await resetOcrSettings();
    expect(harness.state.repo.writeOcrSettings).toHaveBeenLastCalledWith(null);
  });
  it("refuses to enable OCR when the selected language models are missing", async () => {
    harness.state.user = { id: "admin", role: "admin" };
    vi.mocked(hasModels).mockResolvedValueOnce(false);
    expect(await saveOcrSettings({ data: draft })).toEqual({
      data: null,
      error: "modelMissing",
    });
    expect(harness.state.repo.writeOcrSettings).not.toHaveBeenCalled();
  });
  it("tests a draft by actual conversion without saving or reading a private upload", async () => {
    harness.state.user = { id: "admin", role: "admin" };
    expect(await testOcrSettings({ data: draft })).toEqual({ data: { warnings: [] }, error: null });
    expect(processDocument).toHaveBeenCalledWith(
      expect.objectContaining({ settings: draft.settings, version: 2 }),
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
      codes: [],
      xml: [],
      alternates: [],
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
      JSON.stringify({
        version: 1,
        settings: { ...draft.settings, provider: "tesseract", baseUrl: "http://old-service" },
        secret: null,
      }),
    );
    const result = await analyzeDocument({
      data: { documentId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(result).toMatchObject({ error: null, result: { amount: 12.5 } });
    expect(processDocument).toHaveBeenCalledWith(
      expect.objectContaining({ settings: draft.settings, version: 2 }),
      expect.objectContaining({ name: "test.bmp" }),
      expect.objectContaining({ secondPass: expect.any(Function) }),
    );
  });
});
