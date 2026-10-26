import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { cleanRow, TABLE_NAMES, type TableName } from "./schema";
import { buildSeed } from "./seed";
import {
  OCR_LANGUAGES,
  ocrDraftSchema,
  type OcrModelStatus,
  type OcrSettingsView,
  type OcrErrorCode,
} from "./ocr";
import { appearanceSchema } from "./appearance";
import { navigationSchema } from "./navigation";

/**
 * Requires a signed-in member (admin or member; pending accounts see nothing)
 * and provides the local SQLite repository.
 */
export const dataContext = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const repoMod = await import("@/server/repo");
  const { canAccessData } = await import("@/server/auth-core");
  const la = await import("@/server/local-auth");
  const u = await la.userFromToken(
    la.cookieFrom(getRequest()?.headers.get("cookie"), la.SESSION_COOKIE),
  );
  if (!u || !canAccessData(u.role)) throw new Error("Unauthorized");
  return next({ context: { repo: repoMod.sqliteRepo(), user: u } });
});

export const adminDataContext = createMiddleware({ type: "function" })
  .middleware([dataContext])
  .server(async ({ next, context }) => {
    if (context.user.role !== "admin") throw new Error("Unauthorized");
    return next();
  });

export const getAppearance = createServerFn()
  .middleware([dataContext])
  .handler(({ context }) => context.repo.readAppearance(context.user.id));

export const getNavigation = createServerFn()
  .middleware([dataContext])
  .handler(({ context }) => context.repo.readNavigation(context.user.id));

export const saveNavigation = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((data: unknown) => navigationSchema.parse(data))
  .handler(async ({ context, data }) => {
    await context.repo.writeNavigation(context.user.id, data);
    return data;
  });

export const saveAppearance = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((data: unknown) => appearanceSchema.parse(data))
  .handler(async ({ context, data }) => {
    await context.repo.writeAppearance(context.user.id, data);
    return data;
  });

type OcrAdminResult<T> = { data: T; error: null } | { data: null; error: OcrErrorCode };

export const getOcrSettings = createServerFn()
  .middleware([adminDataContext])
  .handler(async ({ context }): Promise<OcrAdminResult<OcrSettingsView>> => {
    const { settingsView } = await import("@/server/ocr/config");
    const { ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      return { data: await settingsView(context.repo), error: null };
    } catch (error) {
      return { data: null, error: ocrErrorCode(error) };
    }
  });

export const saveOcrSettings = createServerFn({ method: "POST" })
  .middleware([adminDataContext])
  .inputValidator((d: unknown) => ocrDraftSchema.parse(d))
  .handler(async ({ context, data }): Promise<OcrAdminResult<true>> => {
    const { prepareDraft } = await import("@/server/ocr/config");
    const { hasModels } = await import("@/server/ocr/models");
    const { OcrError, ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      const settings = await prepareDraft(data);
      if (settings.settings.enabled && !(await hasModels(settings.settings.language)))
        throw new OcrError("modelMissing");
      await context.repo.writeOcrSettings(JSON.stringify(settings));
      return { data: true, error: null };
    } catch (error) {
      return { data: null, error: ocrErrorCode(error) };
    }
  });

export const resetOcrSettings = createServerFn({ method: "POST" })
  .middleware([adminDataContext])
  .handler(async ({ context }) => {
    await context.repo.writeOcrSettings(null);
    return { ok: true };
  });

export const testOcrSettings = createServerFn({ method: "POST" })
  .middleware([adminDataContext])
  .inputValidator((d: unknown) => ocrDraftSchema.parse(d))
  .handler(async ({ context, data }): Promise<OcrAdminResult<{ warnings: string[] }>> => {
    const { prepareDraft } = await import("@/server/ocr/config");
    const { processDocument } = await import("@/server/ocr");
    const { connectionSample } = await import("@/server/ocr/sample");
    const { OcrError, ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      const config = await prepareDraft(data);
      const result = await processDocument(config, {
        bytes: connectionSample(),
        mime: "image/png",
        name: "bauplan-test.png",
      });
      if (!/BAUPLAN/i.test(result.text) || !/12345/.test(result.text))
        throw new OcrError("testFailed");
      return { data: { warnings: result.warnings }, error: null };
    } catch (error) {
      return { data: null, error: ocrErrorCode(error) };
    }
  });

export const getOcrModels = createServerFn()
  .middleware([adminDataContext])
  .handler(async (): Promise<OcrAdminResult<OcrModelStatus[]>> => {
    const { getModelStatuses } = await import("@/server/ocr/models");
    const { ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      return { data: await getModelStatuses(), error: null };
    } catch (error) {
      return { data: null, error: ocrErrorCode(error) };
    }
  });

export const downloadOcrModel = createServerFn({ method: "POST" })
  .middleware([adminDataContext])
  .inputValidator((d: unknown) => z.object({ language: z.enum(OCR_LANGUAGES) }).parse(d))
  .handler(async ({ data }): Promise<OcrAdminResult<true>> => {
    const { downloadModel } = await import("@/server/ocr/models");
    const { ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      await downloadModel(data.language);
      return { data: true, error: null };
    } catch (error) {
      return { data: null, error: ocrErrorCode(error) };
    }
  });

export const deleteOcrModel = createServerFn({ method: "POST" })
  .middleware([adminDataContext])
  .inputValidator((d: unknown) => z.object({ language: z.enum(OCR_LANGUAGES) }).parse(d))
  .handler(async ({ context, data }): Promise<OcrAdminResult<true>> => {
    const { deleteModel } = await import("@/server/ocr/models");
    const { ocrIsActive } = await import("@/server/ocr");
    const { ocrErrorCode } = await import("@/server/ocr/errors");
    try {
      await deleteModel(data.language, context.repo, ocrIsActive());
      return { data: true, error: null };
    } catch (error) {
      return { data: null, error: ocrErrorCode(error) };
    }
  });

export const getBackendInfo = createServerFn().handler(async () => {
  const dataDir = process.env["DATA_DIR"] || "./data";
  return {
    dataDir,
    uploadsDir: process.env["UPLOADS_DIR"] || `${dataDir}/uploads`,
  };
});

export const getWorkspace = createServerFn()
  .middleware([dataContext])
  .handler(async ({ context }) => context.repo.getAll());

const tableSchema = z.enum(TABLE_NAMES as [TableName, ...TableName[]]);

export const createRow = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((d: unknown) =>
    z.object({ table: tableSchema, row: z.record(z.unknown()) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const row = await context.repo.insert(data.table, cleanRow(data.table, data.row));
    return { id: String(row["id"]) };
  });

export const updateRow = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((d: unknown) =>
    z.object({ table: tableSchema, id: z.string(), patch: z.record(z.unknown()) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await context.repo.update(data.table, data.id, cleanRow(data.table, data.patch));
    return { ok: true };
  });

export const deleteRow = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((d: unknown) => z.object({ table: tableSchema, id: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.table === "documents") {
      const ws = await context.repo.getAll();
      const doc = ws.documents.find((x) => x.id === data.id);
      if (doc?.storage_path) await context.repo.deleteFile(doc.storage_path);
    }
    await context.repo.remove(data.table, data.id);
    return { ok: true };
  });

export const uploadDocument = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("FormData erwartet");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("Keine Datei");
    if (file.size > 25 * 1024 * 1024) throw new Error("Datei größer als 25 MB");
    const meta = JSON.parse(String(d.get("meta") ?? "{}")) as Record<string, unknown>;
    return { file, meta };
  })
  .handler(async ({ context, data }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    const mime = data.file.type || "application/octet-stream";
    const storage_path = await context.repo.putFile(data.file.name, mime, bytes);
    const row = await context.repo.insert(
      "documents",
      cleanRow("documents", {
        name: data.file.name,
        category: "Sonstiges",
        ...data.meta,
        storage_path,
        mime_type: mime,
        size: data.file.size,
      }),
    );
    return { id: String(row["id"]) };
  });

export const getFileUrl = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ context, data }) => ({ url: await context.repo.fileUrl(data.path) }));

export const loadDemoData = createServerFn({ method: "POST" })
  .middleware([dataContext])
  .handler(async ({ context }) => {
    const ws = await context.repo.getAll();
    if (ws.trades.length || ws.cost_items.length) return { ok: false };
    const seed = buildSeed();
    for (const t of TABLE_NAMES) {
      for (const row of seed[t]) await context.repo.insert(t, { id: row.id, ...cleanRow(t, row) });
    }
    if (ws.projects[0]) {
      await context.repo.update(
        "projects",
        ws.projects[0].id,
        cleanRow("projects", seed.projects[0]!),
      );
      await context.repo.remove("projects", seed.projects[0]!.id);
    }
    return { ok: true };
  });
