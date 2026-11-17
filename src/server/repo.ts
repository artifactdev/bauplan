// Server-only storage adapters. Import this module only via dynamic import()
// inside server function handlers.
import {
  BOOL_COLS,
  cleanRow,
  NUMERIC_COLS,
  TABLE_NAMES,
  USER_APPEARANCE_TABLE,
  type TableName,
  type Workspace,
  type CalEvent,
  type BudgetPot,
  type Project,
  type Task,
} from "@/lib/schema";
import { TABLES } from "@/lib/schema";
import {
  expenseDocumentLinks,
  expenseDocuments,
  expenseTransition,
  migrateExpenseStatus,
} from "@/lib/expenses";
import type { PushJob, PushSubscriptionData } from "@/lib/push";
import type { PaperlessExportMetadata, PaperlessJobState } from "@/lib/paperless";
import { PaperlessError } from "./paperless-client";
import { calendarEtag, checkConditions, DavError, type DavConditions } from "./caldav-calendar";
import { appearanceSchema, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";
import { USER_ANALYSIS_VIEWS_TABLE, USER_NAVIGATION_TABLE } from "@/lib/schema";
import { DEFAULT_VIEWS, analysisViewsSchema, type AnalysisViews } from "@/lib/analysis";
import { migrateDatabase } from "./migrations";
import {
  convertIdeaDocuments,
  organizeUploads,
  removeEmptyParent,
  resolveUpload,
  type UploadsEnv,
} from "./uploads";
import { DEFAULT_DOCUMENT_FOLDER, documentFolder, isSafeStoragePath } from "@/lib/storage-paths";
import { validateFundingEntry } from "@/lib/funding";
import { parseTaskChecklist, taskCompletionPatch, validateTaskDates } from "@/lib/tasks";
import {
  DIARY_LINK_TABLES,
  DIARY_MEDIA_MIME_TYPES,
  parseDiaryIds,
  parseDiarySubtaskLinks,
  validateDiaryEntry,
  withoutDiarySubtasks,
} from "@/lib/diary";
import { MAX_DIARY_MEDIA_BYTES } from "@/lib/limits";
import {
  incomingDependencies,
  sameConsent,
  validateDependencyGraph,
  withoutDependency,
  type DependencyConsent,
} from "@/lib/task-dependencies";
import {
  parseNavigation,
  navigationSchema,
  DEFAULT_NAVIGATION,
  type NavigationPreferences,
} from "@/lib/navigation";

export interface Repo {
  writeCalendarEvent(
    id: string,
    value: Omit<CalEvent, "id"> | null,
    conditions: DavConditions,
    projectId?: string,
  ): Promise<{ created: boolean; etag: string | null }>;
  readNavigation(userId: string): Promise<NavigationPreferences>;
  writeNavigation(userId: string, value: NavigationPreferences): Promise<void>;
  deleteNavigation(userId: string): Promise<void>;
  readAnalysisViews(userId: string): Promise<AnalysisViews>;
  writeAnalysisViews(userId: string, value: AnalysisViews): Promise<void>;
  deleteAnalysisViews(userId: string): Promise<void>;
  getProjects(): Promise<Project[]>;
  getAll(projectId?: string): Promise<Workspace>;
  getSyncGeneration(): Promise<string>;
  exportBackup(
    maxBytes?: number,
    includeUploads?: boolean,
  ): Promise<{ database: BackupDatabase; files: BackupFile[] }>;
  restoreBackup(
    database: BackupDatabase,
    files: BackupFile[],
    requireNoUsers?: boolean,
    preserveUploads?: boolean,
  ): Promise<void>;
  insert(
    table: TableName,
    row: Record<string, unknown>,
    actorId?: string,
    projectId?: string,
    preserveLegacyExpenseSource?: boolean,
  ): Promise<Record<string, unknown>>;
  update(
    table: TableName,
    id: string,
    patch: Record<string, unknown>,
    actorId?: string,
    projectId?: string,
    preserveLegacyExpenseSource?: boolean,
  ): Promise<void>;
  remove(
    table: TableName,
    id: string,
    projectId?: string,
    dependencyConsent?: DependencyConsent,
  ): Promise<void>;
  attachIdeaPreview(
    projectId: string,
    ideaId: string,
    url: string,
    image: { name: string; storage_path: string; mime_type: string; size: number },
  ): Promise<boolean>;
  /** Stores a file in a folder relative to the uploads root, e.g. documentFolder(category). */
  putFile(name: string, mime: string, bytes: Uint8Array, folder?: string): Promise<string>;
  fileUrl(path: string): Promise<string>;
  deleteFile(path: string): Promise<void>;
  readFile(path: string, maxBytes?: number): Promise<Uint8Array | null>;
  markExpensesSubmitted(
    projectId: string,
    expenses: readonly Record<string, unknown>[],
    documents: readonly Record<string, unknown>[],
  ): Promise<void>;
  readOcrSettings(): Promise<string | null>;
  writeOcrSettings(value: string | null): Promise<void>;
  readAppearance(userId: string): Promise<Appearance>;
  writeAppearance(userId: string, value: Appearance): Promise<void>;
  deleteAppearance(userId: string): Promise<void>;
  applySyncChange(
    userId: string,
    change: SyncChange,
    projectId?: string,
  ): Promise<{
    applied: boolean;
    current: Record<string, string | number | boolean | null> | null;
  }>;
  deleteSyncOperations(userId: string): Promise<void>;
}

export type BackupDatabase = {
  tables: Record<TableName, Record<string, unknown>[]>;
  users: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  appearances: Record<string, unknown>[];
  navigation: Record<string, unknown>[];
  analysisViews?: Record<string, unknown>[];
  syncOperations: Record<string, unknown>[];
  paperless?: {
    config: Record<string, unknown>[];
    links: Record<string, unknown>[];
    jobs: Record<string, unknown>[];
  };
};

export type BackupFile = { name: string; bytes: Uint8Array };

const SYNC_GENERATION_SETTING = "workspace_generation";

export type SyncChange = {
  id: string;
  table: TableName;
  action: "create" | "update" | "delete";
  rowId: string;
  base: Record<string, unknown> | null;
  row: Record<string, unknown> | null;
  dependencyConsent?: DependencyConsent | undefined;
};

function migrateSyncExpense(row: Record<string, unknown> | null) {
  if (!row || "bank_status" in row) return row;
  const status = row["status"];
  if (
    status !== "offen" &&
    status !== "bezahlt" &&
    status !== "eingereicht" &&
    status !== "erstattet" &&
    status !== "abgelehnt"
  )
    throw new Error("expenses.invalid_payment_status");
  return { ...row, ...migrateExpenseStatus(status), document_links: null };
}

function dependencyTasks(d: SqliteDb, projectId?: string) {
  const rows = projectId
    ? d.prepare("SELECT * FROM tasks WHERE project_id = ?").all(projectId)
    : d.prepare("SELECT * FROM tasks").all();
  return rows.map((row) => normalize(row) as Task);
}

function assertTaskDependencies(d: SqliteDb, task: Record<string, unknown>) {
  validateDependencyGraph(
    [
      ...d
        .prepare("SELECT * FROM tasks")
        .all()
        .filter((row) => row["id"] !== task["id"]),
      task,
    ],
    d.prepare("SELECT * FROM events").all(),
  );
}

const PROJECT_REFERENCES: Partial<Record<TableName, { column: string; table: TableName }[]>> = {
  cost_items: [{ column: "trade_id", table: "trades" }],
  offers: [
    { column: "trade_id", table: "trades" },
    { column: "cost_item_id", table: "cost_items" },
    { column: "document_id", table: "documents" },
    { column: "contact_id", table: "contacts" },
  ],
  invoices: [
    { column: "trade_id", table: "trades" },
    { column: "cost_item_id", table: "cost_items" },
    { column: "document_id", table: "documents" },
    { column: "contact_id", table: "contacts" },
  ],
  documents: [
    { column: "trade_id", table: "trades" },
    { column: "task_id", table: "tasks" },
    { column: "cost_item_id", table: "cost_items" },
  ],
  tasks: [
    { column: "trade_id", table: "trades" },
    { column: "cost_item_id", table: "cost_items" },
    { column: "document_id", table: "documents" },
  ],
  events: [{ column: "trade_id", table: "trades" }],
  ideas: [
    { column: "document_id", table: "documents" },
    { column: "trade_id", table: "trades" },
  ],
  idea_images: [{ column: "idea_id", table: "ideas" }],
  contacts: [{ column: "trade_id", table: "trades" }],
  expenses: [
    { column: "contact_id", table: "contacts" },
    { column: "offer_id", table: "offers" },
    { column: "trade_id", table: "trades" },
    { column: "cost_item_id", table: "cost_items" },
    { column: "document_id", table: "documents" },
    { column: "budget_pot_id", table: "budget_pots" },
  ],
  funding_entries: [{ column: "budget_pot_id", table: "budget_pots" }],
  credit_terms: [{ column: "budget_pot_id", table: "budget_pots" }],
  diary_media: [{ column: "diary_entry_id", table: "diary_entries" }],
};

function assertWeatherLocation(row: Record<string, unknown>) {
  const latitude = row["weather_latitude"] ?? null;
  const longitude = row["weather_longitude"] ?? null;
  const name = row["weather_location_name"] ?? null;
  if (latitude === null && longitude === null && name === null) return;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    (name !== null && (typeof name !== "string" || name.length > 200))
  )
    throw new Error("diary.invalid_weather_location");
}

function assertProjectReferences(
  db: SqliteDb,
  table: TableName,
  row: Record<string, unknown>,
  projectId: string,
) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error("projects.not_found");
  if (row["project_id"] != null && row["project_id"] !== projectId)
    throw new Error("projects.row_not_in_project");
  for (const reference of PROJECT_REFERENCES[table] ?? []) {
    const id = row[reference.column];
    if (id == null || id === "") continue;
    if (typeof id !== "string") throw new Error("projects.related_record_not_in_project");
    const related = db.prepare(`SELECT project_id FROM ${reference.table} WHERE id = ?`).get(id);
    if (related?.["project_id"] !== projectId)
      throw new Error("projects.related_record_not_in_project");
  }

  if (table === "expenses") {
    const links = expenseDocumentLinks(row["document_links"]);
    for (const link of links) {
      if (link.document_id === row["document_id"]) throw new Error("expenses.invalid_documents");
      const related = db
        .prepare("SELECT project_id FROM documents WHERE id = ?")
        .get(link.document_id);
      if (related?.["project_id"] !== projectId)
        throw new Error("projects.related_record_not_in_project");
    }
  }
  if (table === "diary_entries") {
    for (const [column, relatedTable] of Object.entries(DIARY_LINK_TABLES)) {
      for (const id of parseDiaryIds(row[column])) {
        const related = db.prepare(`SELECT project_id FROM ${relatedTable} WHERE id = ?`).get(id);
        if (related?.["project_id"] !== projectId)
          throw new Error("projects.related_record_not_in_project");
      }
      for (const link of parseDiarySubtaskLinks(row["subtask_links"])) {
        const task = db
          .prepare("SELECT project_id, checklist FROM tasks WHERE id = ?")
          .get(link.task_id);
        if (task?.["project_id"] !== projectId)
          throw new Error("projects.related_record_not_in_project");
        if (!parseTaskChecklist(task["checklist"]).some((item) => item.id === link.subtask_id))
          throw new Error("diary.invalid_links");
      }
    }
  }
}

function pruneDiarySubtasks(
  db: SqliteDb,
  taskId: string,
  remainingIds: ReadonlySet<string>,
  projectId?: string,
) {
  const entries = projectId
    ? db.prepare("SELECT id, subtask_links FROM diary_entries WHERE project_id = ?").all(projectId)
    : db.prepare("SELECT id, subtask_links FROM diary_entries").all();
  for (const entry of entries) {
    const updated = withoutDiarySubtasks(
      { subtask_links: entry["subtask_links"] },
      taskId,
      remainingIds,
    );
    if (updated.subtask_links !== entry["subtask_links"])
      db.prepare("UPDATE diary_entries SET subtask_links = ? WHERE id = ?").run(
        updated.subtask_links,
        entry["id"],
      );
  }
}

// Uses Node's built-in node:sqlite (Node >= 22.5). Computed dynamic imports
// keep Node-only modules out of browser-side module graphs.

export type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: unknown[]): Record<string, unknown>[];
    run(...p: unknown[]): unknown;
    get(...p: unknown[]): Record<string, unknown> | undefined;
  };
};

export function attachIdeaPreviewInTransaction(
  d: SqliteDb,
  projectId: string,
  ideaId: string,
  url: string,
  image: { name: string; storage_path: string; mime_type: string; size: number },
) {
  d.exec("BEGIN IMMEDIATE");
  try {
    const project = d
      .prepare("SELECT link_previews_enabled FROM projects WHERE id = ?")
      .get(projectId);
    const idea = d
      .prepare("SELECT url, collection, document_id FROM ideas WHERE id = ? AND project_id = ?")
      .get(ideaId, projectId);
    if (!project?.["link_previews_enabled"] || !idea || idea["url"] !== url) {
      d.exec("COMMIT");
      return false;
    }
    const existingImage = d
      .prepare(
        `SELECT id FROM idea_images WHERE idea_id = ? AND
           (source = 'link_preview' OR storage_path IS NOT NULL)
         UNION ALL
         SELECT documents.id FROM ideas
         JOIN documents ON documents.id = ideas.document_id
         WHERE ideas.id = ? AND documents.storage_path IS NOT NULL LIMIT 1`,
      )
      .get(ideaId, ideaId);
    if (existingImage) {
      d.exec("COMMIT");
      return false;
    }

    const row = {
      id: crypto.randomUUID(),
      project_id: projectId,
      idea_id: ideaId,
      name: image.name,
      storage_path: image.storage_path,
      mime_type: image.mime_type,
      size: image.size,
      source: "link_preview",
      created_at: new Date().toISOString(),
    };
    assertProjectReferences(d, "idea_images", row, projectId);
    const keys = Object.keys(row);
    d.prepare(
      `INSERT INTO idea_images (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    ).run(...keys.map((key) => toSql(row[key as keyof typeof row])));
    d.exec("COMMIT");
    return true;
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

let dbPromise: Promise<SqliteDb> | null = null;

async function nodeImport<T>(name: string): Promise<T> {
  return (await import(/* @vite-ignore */ name)) as T;
}

function dataDir() {
  return process.env["DATA_DIR"] || "./data";
}

function uploadsDir(path: typeof import("node:path")) {
  return process.env["UPLOADS_DIR"] || path.join(dataDir(), "uploads");
}

async function uploadsEnv(): Promise<UploadsEnv> {
  const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
  const path = await nodeImport<typeof import("node:path")>("node:" + "path");
  return { fs, path, root: uploadsDir(path) };
}

async function openDb(): Promise<SqliteDb> {
  const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
  const path = await nodeImport<typeof import("node:path")>("node:" + "path");
  const { DatabaseSync } = await nodeImport<{
    DatabaseSync: new (f: string) => SqliteDb & { close(): void };
  }>("node:" + "sqlite");
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(uploadsDir(path), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir(), "renovierung.db"));
  try {
    migrateDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
  try {
    organizeUploads(db, await uploadsEnv());
  } catch (error) {
    console.warn("[uploads] Could not organize upload folders", error);
  }
  return db;
}

/** Shared SQLite handle (also used by the self-hosted login in local-auth.ts). */
export function getSqliteDb(): Promise<SqliteDb> {
  return (dbPromise ??= openDb());
}

export function sqliteRepo(): Repo {
  const db = () => (dbPromise ??= openDb());
  return {
    async writeCalendarEvent(id, value, conditions, projectId) {
      const d = await db();
      d.exec("BEGIN IMMEDIATE");
      try {
        if (projectId && !d.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
          throw new DavError(404, "Project not found.");
        const raw = projectId
          ? d.prepare("SELECT * FROM events WHERE id = ? AND project_id = ?").get(id, projectId)
          : d.prepare("SELECT * FROM events WHERE id = ?").get(id);
        const current = raw ? (normalize(raw) as CalEvent) : null;
        checkConditions(current ? calendarEtag(current) : null, conditions);
        if (!value) {
          if (!current) throw new DavError(404, "Appointment not found.");
          if (
            incomingDependencies(dependencyTasks(d, current.project_id ?? undefined), {
              source: "event",
              id,
            }).length
          )
            throw new DavError(409, "This work is a prerequisite. Confirm deletion in Bauplan.");
          if (projectId)
            d.prepare("DELETE FROM events WHERE id = ? AND project_id = ?").run(id, projectId);
          else d.prepare("DELETE FROM events WHERE id = ?").run(id);
          d.exec("COMMIT");
          return { created: false, etag: null };
        }
        if (!current && projectId && d.prepare("SELECT id FROM events WHERE id = ?").get(id))
          throw new DavError(409, "Resource name is already in use.", "no-uid-conflict");
        if (current && (current.caldav_uid || `${id}@bauplan`) !== value.caldav_uid)
          throw new DavError(409, "An appointment's UID cannot change.", "no-uid-conflict");
        const duplicateUid = projectId
          ? d
              .prepare(
                "SELECT id FROM events WHERE project_id = ? AND COALESCE(caldav_uid, id || '@bauplan') = ? AND id != ?",
              )
              .get(projectId, value.caldav_uid, id)
          : d
              .prepare(
                "SELECT id FROM events WHERE COALESCE(caldav_uid, id || '@bauplan') = ? AND id != ?",
              )
              .get(value.caldav_uid, id);
        if (duplicateUid)
          throw new DavError(
            403,
            "An appointment with this UID already exists.",
            "no-uid-conflict",
          );
        const next: CalEvent = {
          ...value,
          id,
          kind: current?.kind || "termin",
          trade_id: current?.trade_id || null,
          work_completed: current?.work_completed ?? false,
          created_at: current?.created_at || new Date().toISOString(),
          project_id:
            projectId ??
            current?.project_id ??
            (d.prepare("SELECT id FROM projects ORDER BY created_at, id LIMIT 1").get()?.["id"] as
              string | undefined) ??
            null,
        };
        if (typeof next.project_id === "string")
          assertProjectReferences(d, "events", next, next.project_id);
        const keys = ["id", "created_at", ...TABLES.events];
        const record: Record<string, unknown> = next;
        d.prepare(
          `INSERT INTO events (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})
          ON CONFLICT(id) DO UPDATE SET ${TABLES.events.map((key) => `${key}=excluded.${key}`).join(",")}`,
        ).run(...keys.map((key) => toSql(record[key])));
        const etag = calendarEtag(next);
        d.exec("COMMIT");
        return { created: !current, etag };
      } catch (error) {
        d.exec("ROLLBACK");
        throw error;
      }
    },
    async readNavigation(userId) {
      const row = (await db())
        .prepare(`SELECT preferences FROM ${USER_NAVIGATION_TABLE} WHERE user_id = ?`)
        .get(userId);
      return row
        ? parseNavigation(JSON.parse(String(row["preferences"])))
        : navigationSchema.parse(DEFAULT_NAVIGATION);
    },
    async writeNavigation(userId, value) {
      const valid = navigationSchema.parse(value);
      (await db())
        .prepare(
          `INSERT INTO ${USER_NAVIGATION_TABLE} (user_id, preferences) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences`,
        )
        .run(userId, JSON.stringify(valid));
    },
    async deleteNavigation(userId) {
      (await db()).prepare(`DELETE FROM ${USER_NAVIGATION_TABLE} WHERE user_id = ?`).run(userId);
    },
    async readAnalysisViews(userId) {
      const row = (await db())
        .prepare(`SELECT views FROM ${USER_ANALYSIS_VIEWS_TABLE} WHERE user_id = ?`)
        .get(userId);
      if (!row) return structuredClone(DEFAULT_VIEWS);
      const parsed = analysisViewsSchema.safeParse(JSON.parse(String(row["views"])));
      return parsed.success ? parsed.data : structuredClone(DEFAULT_VIEWS);
    },
    async writeAnalysisViews(userId, value) {
      const valid = analysisViewsSchema.parse(value);
      (await db())
        .prepare(
          `INSERT INTO ${USER_ANALYSIS_VIEWS_TABLE} (user_id, views) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET views = excluded.views`,
        )
        .run(userId, JSON.stringify(valid));
    },
    async deleteAnalysisViews(userId) {
      (await db())
        .prepare(`DELETE FROM ${USER_ANALYSIS_VIEWS_TABLE} WHERE user_id = ?`)
        .run(userId);
    },
    async readAppearance(userId) {
      const row = (await db())
        .prepare(`SELECT palette, mode FROM ${USER_APPEARANCE_TABLE} WHERE user_id = ?`)
        .get(userId);
      return row ? appearanceSchema.parse(row) : { ...DEFAULT_APPEARANCE };
    },
    async writeAppearance(userId, value) {
      const valid = appearanceSchema.parse(value);
      (await db())
        .prepare(
          `INSERT INTO ${USER_APPEARANCE_TABLE} (user_id, palette, mode) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET palette = excluded.palette, mode = excluded.mode`,
        )
        .run(userId, valid.primaryColor, valid.mode);
    },
    async deleteAppearance(userId) {
      (await db()).prepare(`DELETE FROM ${USER_APPEARANCE_TABLE} WHERE user_id = ?`).run(userId);
    },
    async applySyncChange(userId, change, projectId) {
      if (change.table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const legacyExpense =
        change.table === "expenses" && change.row !== null && !("bank_status" in change.row);
      if (change.table === "expenses")
        change = {
          ...change,
          base: migrateSyncExpense(change.base),
          row: migrateSyncExpense(change.row),
        };
      const d = await db();
      d.exec("BEGIN IMMEDIATE");
      try {
        const completed = d
          .prepare("SELECT id FROM app_sync_operations WHERE id = ? AND user_id = ?")
          .get(change.id, userId);
        if (completed) {
          d.exec("COMMIT");
          return { applied: true, current: null };
        }
        const existingRow = d
          .prepare(`SELECT * FROM ${change.table} WHERE id = ?`)
          .get(change.rowId);
        const effectiveProjectId =
          projectId ??
          (typeof change.row?.["project_id"] === "string"
            ? change.row["project_id"]
            : typeof change.base?.["project_id"] === "string"
              ? change.base["project_id"]
              : typeof existingRow?.["project_id"] === "string"
                ? existingRow["project_id"]
                : (d.prepare("SELECT id FROM projects ORDER BY created_at, id LIMIT 1").get()?.[
                    "id"
                  ] as string | undefined));
        const raw =
          change.table !== "projects" && effectiveProjectId
            ? d
                .prepare(`SELECT * FROM ${change.table} WHERE id = ? AND project_id = ?`)
                .get(change.rowId, effectiveProjectId)
            : d.prepare(`SELECT * FROM ${change.table} WHERE id = ?`).get(change.rowId);
        const current = raw ? serializeRow(normalize(raw)) : null;
        const base = change.base
          ? {
              ...change.base,
              ...(change.table === "tasks"
                ? {
                    dependencies: change.base["dependencies"] ?? null,
                    completed_at: change.base["completed_at"] ?? null,
                    completed_on: change.base["completed_on"] ?? null,
                  }
                : {}),
              ...(change.table === "events"
                ? { work_completed: change.base["work_completed"] ?? null }
                : {}),
              ...(change.table === "diary_entries"
                ? {
                    offer_ids: change.base["offer_ids"] ?? null,
                    payment_ids: change.base["payment_ids"] ?? null,
                    subtask_links: change.base["subtask_links"] ?? null,
                  }
                : {}),
            }
          : null;
        if (!sameRecord(current, base)) {
          d.exec("ROLLBACK");
          return { applied: false, current };
        }
        if (change.action === "delete") {
          if (change.table === "tasks" || change.table === "events") {
            const incoming = incomingDependencies(dependencyTasks(d, effectiveProjectId), {
              source: change.table === "tasks" ? "task" : "event",
              id: change.rowId,
            });
            if (
              (incoming.length || change.dependencyConsent !== undefined) &&
              !sameConsent(incoming, change.dependencyConsent)
            ) {
              d.exec("ROLLBACK");
              return { applied: false, current };
            }
          }
          await this.remove(
            change.table,
            change.rowId,
            effectiveProjectId,
            change.dependencyConsent,
          );
        } else if (change.action === "create") {
          if (!change.row) throw new Error("Sync create requires a row");
          await this.insert(
            change.table,
            {
              ...cleanRow(change.table, change.row),
              ...(change.table === "tasks" && !("completed_at" in change.row)
                ? { completed_at: null, completed_on: null }
                : {}),
              id: change.rowId,
              created_at: change.row["created_at"],
            },
            userId,
            effectiveProjectId,
            legacyExpense,
          );
        } else {
          if (!change.row) throw new Error("Sync update requires a row");
          await this.update(
            change.table,
            change.rowId,
            {
              ...cleanRow(change.table, change.row),
              ...(change.table === "tasks" && !("completed_at" in change.row)
                ? { completed_at: null, completed_on: null }
                : {}),
            },
            userId,
            effectiveProjectId,
            legacyExpense,
          );
        }
        d.prepare("INSERT INTO app_sync_operations (id, user_id, applied_at) VALUES (?, ?, ?)").run(
          change.id,
          userId,
          new Date().toISOString(),
        );
        d.exec("COMMIT");
        return { applied: true, current: null };
      } catch (error) {
        d.exec("ROLLBACK");
        throw error;
      }
    },
    async deleteSyncOperations(userId) {
      (await db()).prepare("DELETE FROM app_sync_operations WHERE user_id = ?").run(userId);
    },
    async getProjects() {
      return (await db())
        .prepare("SELECT * FROM projects ORDER BY created_at, id")
        .all()
        .map(normalize) as unknown as Project[];
    },
    async getAll(projectId) {
      const d = await db();
      if (projectId && !d.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
        throw new Error("projects.not_found");
      const out = {} as Record<string, unknown[]>;
      for (const t of TABLE_NAMES) {
        const rows =
          projectId && t !== "projects"
            ? d
                .prepare(`SELECT * FROM ${t} WHERE project_id = ? ORDER BY created_at, id`)
                .all(projectId)
            : d.prepare(`SELECT * FROM ${t} ORDER BY created_at, id`).all();
        out[t] = rows.map(normalize);
      }
      return out as unknown as Workspace;
    },
    async markExpensesSubmitted(projectId, expenses, documents) {
      const d = await db();
      d.exec("BEGIN IMMEDIATE");
      try {
        const documentIds = new Set<string>();
        const expenseIds = new Set<string>();
        for (const expense of expenses) {
          if (typeof expense["id"] !== "string" || expenseIds.has(expense["id"]))
            throw new Error("expenses.export_conflict");
          expenseIds.add(expense["id"]);
          const links = expenseDocuments({
            document_id: typeof expense["document_id"] === "string" ? expense["document_id"] : null,
            document_links:
              typeof expense["document_links"] === "string" ? expense["document_links"] : null,
          });
          if (!links.some((link) => link.role === "invoice"))
            throw new Error("expenses.export_conflict");
          for (const link of links) documentIds.add(link.document_id);
        }
        const suppliedIds = documents.map((document) => document["id"]);
        if (
          new Set(suppliedIds).size !== suppliedIds.length ||
          suppliedIds.length !== documentIds.size ||
          suppliedIds.some((id) => typeof id !== "string" || !documentIds.has(id))
        )
          throw new Error("expenses.export_conflict");
        for (const [table, rows] of [
          ["expenses", expenses],
          ["documents", documents],
        ] as const) {
          for (const expected of rows) {
            const current = d
              .prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id = ?`)
              .get(expected["id"], projectId);
            if (!current || !sameRecord(serializeRow(normalize(current)), expected))
              throw new Error("expenses.export_conflict");
          }
        }
        for (const expense of expenses) {
          if (expense["bank_status"] === "einzureichen")
            d.prepare("UPDATE expenses SET bank_status = ? WHERE id = ? AND project_id = ?").run(
              "eingereicht",
              expense["id"],
              projectId,
            );
        }
        d.exec("COMMIT");
      } catch (error) {
        d.exec("ROLLBACK");
        throw error;
      }
    },
    async getSyncGeneration() {
      const d = await db();
      const existing = d
        .prepare("SELECT value FROM app_settings WHERE key = ?")
        .get(SYNC_GENERATION_SETTING)?.["value"];
      if (typeof existing === "string" && existing) return existing;
      d.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run(
        SYNC_GENERATION_SETTING,
        crypto.randomUUID(),
      );
      return String(
        d.prepare("SELECT value FROM app_settings WHERE key = ?").get(SYNC_GENERATION_SETTING)?.[
          "value"
        ] ?? "",
      );
    },
    async exportBackup(maxBytes = Number.POSITIVE_INFINITY, includeUploads = true) {
      const d = await db();
      const path = await nodeImport<typeof import("node:path")>("node:" + "path");
      const fs = await nodeImport<typeof import("node:fs/promises")>("node:" + "fs/promises");
      const tables = {} as BackupDatabase["tables"];
      for (const table of TABLE_NAMES)
        tables[table] = d.prepare(`SELECT * FROM ${table} ORDER BY created_at, id`).all();
      const directory = uploadsDir(path);
      const files: BackupFile[] = [];
      let totalBytes = 0;
      const walk = async (relative: string) => {
        for (const entry of await fs.readdir(path.join(directory, relative), {
          withFileTypes: true,
        })) {
          if (!relative && entry.isDirectory() && entry.name.startsWith(".bauplan-restore-"))
            continue;
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(name);
            continue;
          }
          if (!entry.isFile() || !isSafeStoragePath(name))
            throw new Error("Das Upload-Verzeichnis enthält einen ungültigen Eintrag.");
          const filePath = path.join(directory, ...name.split("/"));
          const fileStat = await fs.stat(filePath);
          totalBytes += fileStat.size;
          if (totalBytes > maxBytes) throw new Error("Die Uploads überschreiten die Backup-Größe.");
          files.push({ name, bytes: new Uint8Array(await fs.readFile(filePath)) });
        }
      };
      if (includeUploads) await walk("");
      return {
        database: {
          tables,
          users: d.prepare("SELECT * FROM app_users ORDER BY id").all(),
          settings: d
            .prepare("SELECT * FROM app_settings WHERE key != ? ORDER BY key")
            .all(SYNC_GENERATION_SETTING),
          appearances: d.prepare(`SELECT * FROM ${USER_APPEARANCE_TABLE} ORDER BY user_id`).all(),
          navigation: d.prepare(`SELECT * FROM ${USER_NAVIGATION_TABLE} ORDER BY user_id`).all(),
          analysisViews: d
            .prepare(`SELECT * FROM ${USER_ANALYSIS_VIEWS_TABLE} ORDER BY user_id`)
            .all(),
          syncOperations: d.prepare("SELECT * FROM app_sync_operations ORDER BY id").all(),
          paperless: {
            config: d.prepare("SELECT * FROM app_paperless_config").all(),
            links: d.prepare("SELECT * FROM app_paperless_links ORDER BY document_id").all(),
            jobs: d
              .prepare("SELECT * FROM app_paperless_jobs ORDER BY id")
              .all()
              .map((job) => ({
                ...job,
                state: ["linked", "failed", "abandoned"].includes(String(job["state"]))
                  ? job["state"]
                  : "paused",
                error: ["linked", "failed", "abandoned"].includes(String(job["state"]))
                  ? job["error"]
                  : "restored",
              })),
          },
        },
        files,
      };
    },
    async restoreBackup(database, files, requireNoUsers = false, preserveUploads = false) {
      validateDependencyGraph(database.tables.tasks, database.tables.events);
      const d = await db();
      const fs = await nodeImport<typeof import("node:fs/promises")>("node:" + "fs/promises");
      const path = await nodeImport<typeof import("node:path")>("node:" + "path");
      const liveDirectory = uploadsDir(path);
      // The uploads directory is often a mount point (Docker volume) that cannot be renamed,
      // so staging happens inside it and only its entries are swapped.
      await fs.mkdir(liveDirectory, { recursive: true });
      const stageDirectory = await fs.mkdtemp(path.join(liveDirectory, ".bauplan-restore-"));
      const stageName = path.basename(stageDirectory);
      const stagedUploads = path.join(stageDirectory, "new");
      const previousUploads = path.join(stageDirectory, "previous");
      const movedOld: string[] = [];
      const movedNew: string[] = [];
      let transactionOpen = false;

      try {
        await fs.mkdir(stagedUploads);
        await fs.mkdir(previousUploads);
        for (const file of files) {
          if (!isSafeStoragePath(file.name) || file.name.startsWith(".bauplan-restore-"))
            throw new Error("Das Backup enthält einen unsicheren Dateipfad.");
          const target = path.join(stagedUploads, ...file.name.split("/"));
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, file.bytes, { flag: "wx" });
        }

        d.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        if (
          requireNoUsers &&
          Number(d.prepare("SELECT COUNT(*) AS n FROM app_users").get()?.["n"] ?? 0) > 0
        )
          throw new Error("Die Einrichtung wurde bereits abgeschlossen.");

        d.exec(
          "DELETE FROM app_paperless_access; DELETE FROM app_paperless_auto_import; DELETE FROM app_paperless_jobs; DELETE FROM app_paperless_links; DELETE FROM app_paperless_checks; DELETE FROM app_paperless_credentials; DELETE FROM app_paperless_config;",
        );
        for (const table of TABLE_NAMES) d.prepare(`DELETE FROM ${table}`).run();
        d.prepare("DELETE FROM app_users").run();
        d.prepare("DELETE FROM app_settings").run();
        d.prepare(`DELETE FROM ${USER_APPEARANCE_TABLE}`).run();
        d.prepare(`DELETE FROM ${USER_NAVIGATION_TABLE}`).run();
        d.prepare(`DELETE FROM ${USER_ANALYSIS_VIEWS_TABLE}`).run();
        d.prepare("DELETE FROM app_sync_operations").run();
        d.prepare("DELETE FROM app_sessions").run();
        d.exec(
          "DELETE FROM app_push_deliveries; DELETE FROM app_push_jobs; DELETE FROM app_push_subscriptions;",
        );

        const insertRows = (table: string, rows: Record<string, unknown>[]) => {
          for (const row of rows) {
            const keys = Object.keys(row);
            d.prepare(
              `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
            ).run(...keys.map((key) => toSql(row[key])));
          }
        };
        for (const table of TABLE_NAMES) insertRows(table, database.tables[table]);
        insertRows("app_users", database.users);
        insertRows(
          "app_settings",
          database.settings.filter((setting) => setting["key"] !== SYNC_GENERATION_SETTING),
        );
        insertRows("app_settings", [{ key: SYNC_GENERATION_SETTING, value: crypto.randomUUID() }]);
        insertRows(USER_APPEARANCE_TABLE, database.appearances);
        insertRows(USER_NAVIGATION_TABLE, database.navigation);
        insertRows(USER_ANALYSIS_VIEWS_TABLE, database.analysisViews ?? []);
        insertRows("app_sync_operations", database.syncOperations);
        if (database.paperless) {
          insertRows("app_paperless_config", database.paperless.config);
          insertRows("app_paperless_links", database.paperless.links);
          insertRows(
            "app_paperless_jobs",
            database.paperless.jobs.map((job) => ({
              ...job,
              state: ["linked", "failed", "abandoned"].includes(String(job["state"]))
                ? job["state"]
                : "paused",
              error: ["linked", "failed", "abandoned"].includes(String(job["state"]))
                ? job["error"]
                : "restored",
            })),
          );
        }

        // Older backups store files flat and link idea images as documents.
        convertIdeaDocuments(d);

        if (!preserveUploads) {
          for (const name of await fs.readdir(liveDirectory)) {
            if (name === stageName) continue;
            await fs.rename(path.join(liveDirectory, name), path.join(previousUploads, name));
            movedOld.push(name);
          }
          for (const name of await fs.readdir(stagedUploads)) {
            await fs.rename(path.join(stagedUploads, name), path.join(liveDirectory, name));
            movedNew.push(name);
          }
        }
        d.exec("COMMIT");
        transactionOpen = false;
      } catch (error) {
        const recoveryErrors: unknown[] = [];
        if (transactionOpen) {
          try {
            d.exec("ROLLBACK");
          } catch (rollbackError) {
            recoveryErrors.push(rollbackError);
          }
        }
        for (const name of movedNew) {
          try {
            await fs.rm(path.join(liveDirectory, name), { recursive: true, force: true });
          } catch (cleanupError) {
            recoveryErrors.push(cleanupError);
          }
        }
        for (const name of movedOld) {
          try {
            await fs.rename(path.join(previousUploads, name), path.join(liveDirectory, name));
          } catch (restoreError) {
            recoveryErrors.push(restoreError);
          }
        }
        try {
          await fs.rm(stageDirectory, { recursive: true, force: true });
        } catch (cleanupError) {
          recoveryErrors.push(cleanupError);
        }
        if (recoveryErrors.length)
          throw new Error(
            "Der Restore ist fehlgeschlagen und der vorherige Zustand konnte nicht vollständig wiederhergestellt werden.",
            { cause: new AggregateError([error, ...recoveryErrors]) },
          );
        throw error;
      }

      try {
        await fs.rm(stageDirectory, { recursive: true, force: true });
      } catch (error) {
        throw new Error(
          "Backup wurde wiederhergestellt, temporäre Dateien konnten aber nicht vollständig entfernt werden.",
          { cause: error },
        );
      }
      if (!preserveUploads) organizeUploads(d, await uploadsEnv());
    },
    async insert(table, row, actorId, projectId, preserveLegacyExpenseSource) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      const targetProjectId =
        table === "projects"
          ? undefined
          : (projectId ??
            (typeof row["project_id"] === "string"
              ? row["project_id"]
              : (d.prepare("SELECT id FROM projects ORDER BY created_at, id LIMIT 1").get()?.[
                  "id"
                ] as string | undefined)));
      if (table === "expenses")
        row = expenseTransition(
          row,
          undefined,
          expenseSources(d, targetProjectId),
          preserveLegacyExpenseSource,
        );
      if (projectId) assertProjectReferences(d, table, row, projectId);
      if (table === "tasks") {
        row = taskCompletionPatch(row, undefined, new Date(), true);
        validateTaskDates(row);
        if ("checklist" in row) parseTaskChecklist(row["checklist"]);
      }
      if (table === "projects") assertWeatherLocation(row);
      if (table === "diary_entries") validateDiaryEntry(row);
      if (
        table === "diary_media" &&
        (typeof row["size"] !== "number" ||
          row["size"] <= 0 ||
          row["size"] > MAX_DIARY_MEDIA_BYTES ||
          typeof row["mime_type"] !== "string" ||
          !DIARY_MEDIA_MIME_TYPES.has(row["mime_type"]) ||
          typeof row["storage_path"] !== "string" ||
          !isSafeStoragePath(row["storage_path"]))
      )
        throw new Error("diary.invalid_media");
      if (table === "funding_entries") validateFundingEntry(row, fundingSources(d));
      const id = (row["id"] as string) || crypto.randomUUID();
      const full = {
        ...row,
        ...(table === "projects" ? {} : { project_id: targetProjectId ?? null }),
        id,
        created_at: row["created_at"] ?? new Date().toISOString(),
      };
      const keys = Object.keys(full);
      if (table === "tasks") d.exec("SAVEPOINT task_notification");
      try {
        if (table === "tasks") assertTaskDependencies(d, full);
        d.prepare(
          `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ).run(...keys.map((k) => toSql((full as Record<string, unknown>)[k])));
        if (table === "tasks" && actorId) {
          queueAssignment(d, null, full, actorId);
        }
        if (table === "tasks") d.exec("RELEASE task_notification");
        return full;
      } catch (error) {
        if (table === "tasks") d.exec("ROLLBACK TO task_notification; RELEASE task_notification");
        throw error;
      }
    },
    async update(table, id, input, actorId, projectId, preserveLegacyExpenseSource) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      // File locations are managed by the server and follow category or collection changes.
      const { storage_path: _storagePath, project_id: requestedProjectId, ...managed } = input;
      if (projectId && requestedProjectId != null && requestedProjectId !== projectId)
        throw new Error("projects.row_not_in_project");
      let patch = managed;
      const d = await db();
      if (table === "expenses") {
        const existing = d.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
        if (!existing) throw new Error("projects.row_not_in_project");
        patch = expenseTransition(
          patch,
          existing,
          expenseSources(d, projectId),
          preserveLegacyExpenseSource,
        );
      }
      if (table !== "projects" && projectId) {
        const existing = d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!existing || existing["project_id"] !== projectId)
          throw new Error("projects.row_not_in_project");
        assertProjectReferences(d, table, { ...existing, ...patch }, projectId);
        if (table === "diary_entries") validateDiaryEntry({ ...existing, ...patch });
      }
      if (table === "projects" && Object.keys(patch).some((key) => key.startsWith("weather_"))) {
        const existing = d.prepare("SELECT * FROM projects WHERE id = ?").get(id);
        if (!existing) throw new Error("projects.not_found");
        assertWeatherLocation({ ...existing, ...patch });
      }
      if (table === "tasks") {
        if ("checklist" in patch) parseTaskChecklist(patch["checklist"]);
        const previous = d.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
        if (!previous) throw new Error("projects.row_not_in_project");
        patch = taskCompletionPatch(patch, previous, new Date(), true);
      }
      if (table === "funding_entries") {
        const existing = d.prepare("SELECT * FROM funding_entries WHERE id = ?").get(id);
        if (!existing) throw new Error("funding.not_found");
        validateFundingEntry({ ...existing, ...patch }, fundingSources(d));
      }
      if (
        table === "budget_pots" &&
        "deducts_from_budget" in patch &&
        !patch["deducts_from_budget"] &&
        d.prepare("SELECT id FROM funding_entries WHERE budget_pot_id = ? LIMIT 1").get(id)
      )
        throw new Error("funding.source_in_use");
      const keys = Object.keys(patch);
      if (!keys.length) return;
      const dependencyMutation = table === "tasks" || (table === "events" && "kind" in patch);
      if (dependencyMutation) d.exec("SAVEPOINT dependency_update");
      try {
        const previous =
          table === "tasks" ? d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) : undefined;
        if (table === "tasks") {
          if (!previous) throw new Error("projects.row_not_in_project");
          validateTaskDates({ ...previous, ...patch });
          if ("dependencies" in patch) assertTaskDependencies(d, { ...previous, ...patch });
        }
        if (
          table === "events" &&
          "kind" in patch &&
          patch["kind"] !== "arbeit" &&
          incomingDependencies(dependencyTasks(d, projectId), { source: "event", id }).length
        )
          throw new Error("dependencies.kind_in_use");
        d.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
          ...keys.map((k) => toSql(patch[k])),
          id,
        );
        if (table === "tasks" && "checklist" in patch && previous) {
          const remaining = new Set(parseTaskChecklist(patch["checklist"]).map((item) => item.id));
          if (parseTaskChecklist(previous["checklist"]).some((item) => !remaining.has(item.id)))
            pruneDiarySubtasks(d, id, remaining, projectId);
        }
        if (table === "tasks" && actorId) {
          if (previous) queueAssignment(d, previous, { ...previous, ...patch }, actorId);
        }
        if (dependencyMutation) d.exec("RELEASE dependency_update");
      } catch (error) {
        if (dependencyMutation) d.exec("ROLLBACK TO dependency_update; RELEASE dependency_update");
        throw error;
      }
      const scope =
        table === "documents" && "category" in patch
          ? { documents: [id] }
          : table === "idea_images" && "idea_id" in patch
            ? { ideaImages: [id] }
            : table === "ideas" && "collection" in patch
              ? { ideas: [id] }
              : null;
      if (scope) organizeUploads(d, await uploadsEnv(), scope);
    },
    async remove(table, id, projectId, dependencyConsent) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      if (table === "documents") {
        const rows = projectId
          ? d.prepare("SELECT document_links FROM expenses WHERE project_id = ?").all(projectId)
          : d.prepare("SELECT document_links FROM expenses").all();
        if (
          rows.some((row) =>
            expenseDocumentLinks(row["document_links"]).some((link) => link.document_id === id),
          )
        )
          throw new Error("expenses.document_in_use");
      }
      if (table !== "projects" && projectId) {
        const row = d.prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(id);
        if (!row || row["project_id"] !== projectId) throw new Error("projects.row_not_in_project");
      }
      if (
        table === "budget_pots" &&
        d.prepare("SELECT id FROM funding_entries WHERE budget_pot_id = ? LIMIT 1").get(id)
      )
        throw new Error("funding.source_in_use");
      d.exec("SAVEPOINT dependency_delete");
      try {
        if (table === "tasks" || table === "events") {
          const source = { source: table === "tasks" ? ("task" as const) : ("event" as const), id };
          const incoming = incomingDependencies(dependencyTasks(d, projectId), source);
          if (incoming.length && dependencyConsent === undefined)
            throw new Error("dependencies.consent");
          if (dependencyConsent !== undefined && !sameConsent(incoming, dependencyConsent))
            throw new Error("dependencies.changed");
          for (const task of incoming)
            d.prepare("UPDATE tasks SET dependencies = ? WHERE id = ?").run(
              withoutDependency(task.dependencies, source),
              task.id,
            );
        }
        const diaryReferenceColumn = Object.entries(DIARY_LINK_TABLES).find(
          ([, relatedTable]) => relatedTable === table,
        )?.[0];
        if (diaryReferenceColumn) {
          const entries = projectId
            ? d
                .prepare(
                  `SELECT id, ${diaryReferenceColumn} FROM diary_entries WHERE project_id = ?`,
                )
                .all(projectId)
            : d.prepare(`SELECT id, ${diaryReferenceColumn} FROM diary_entries`).all();
          for (const entry of entries) {
            const ids = parseDiaryIds(entry[diaryReferenceColumn]);
            if (!ids.includes(id)) continue;
            d.prepare(`UPDATE diary_entries SET ${diaryReferenceColumn} = ? WHERE id = ?`).run(
              JSON.stringify(ids.filter((linkedId) => linkedId !== id)),
              entry["id"],
            );
          }
        }
        if (table === "tasks") pruneDiarySubtasks(d, id, new Set(), projectId);
        if (table === "diary_entries")
          d.prepare("DELETE FROM diary_media WHERE diary_entry_id = ?").run(id);
        d.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        d.exec("RELEASE dependency_delete");
      } catch (error) {
        d.exec("ROLLBACK TO dependency_delete; RELEASE dependency_delete");
        throw error;
      }
    },
    async attachIdeaPreview(projectId, ideaId, url, image) {
      return attachIdeaPreviewInTransaction(await db(), projectId, ideaId, url, image);
    },
    async putFile(name, _mime, bytes, folder = documentFolder(DEFAULT_DOCUMENT_FOLDER)) {
      await db();
      const env = await uploadsEnv();
      const rel = `${folder}/${crypto.randomUUID()}-${safeName(name)}`;
      const full = resolveUpload(env, rel);
      if (!full) throw new Error("Ungültiger Speicherort.");
      env.fs.mkdirSync(env.path.dirname(full), { recursive: true });
      env.fs.writeFileSync(full, bytes);
      return rel;
    },
    async fileUrl(p) {
      return `/api/files/${encodeURIComponent(p)}`;
    },
    async deleteFile(p) {
      const env = await uploadsEnv();
      const full = resolveUpload(env, p);
      if (!full) return;
      try {
        env.fs.unlinkSync(full);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
          throw error;
      }
      removeEmptyParent(env, full);
    },
    readFile: (p, maxBytes) => readSqliteFile(p, maxBytes),
    async readOcrSettings() {
      const row = (await db())
        .prepare("SELECT value FROM app_settings WHERE key = ?")
        .get("ocr_config");
      return row ? String(row["value"]) : null;
    },
    async writeOcrSettings(value) {
      const d = await db();
      if (value === null) d.prepare("DELETE FROM app_settings WHERE key = ?").run("ocr_config");
      else
        d.prepare(
          "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run("ocr_config", value);
    },
  };
}

export async function readSqliteFile(p: string, maxBytes?: number): Promise<Uint8Array | null> {
  const env = await uploadsEnv();
  const full = resolveUpload(env, p);
  if (!full || !env.fs.existsSync(full)) return null;
  const stat = env.fs.statSync(full);
  if (!stat.isFile()) return null;
  if (maxBytes !== undefined && stat.size > maxBytes) throw new Error("expenses.export_large");
  const bytes = new Uint8Array(env.fs.readFileSync(full));
  if (maxBytes !== undefined && bytes.byteLength > maxBytes)
    throw new Error("expenses.export_large");
  return bytes;
}

export async function putSqliteFileStream(
  name: string,
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  expectedBytes: number,
  folder: string,
) {
  const env = await uploadsEnv();
  const relative = `${folder}/${crypto.randomUUID()}-${safeName(name)}`;
  const full = resolveUpload(env, relative);
  if (!full) throw new Error("Ungültiger Speicherort.");
  const fs = await nodeImport<typeof import("node:fs/promises")>("node:" + "fs/promises");
  await fs.mkdir(env.path.dirname(full), { recursive: true });
  const handle = await fs.open(full, "wx");
  const reader = source.getReader();
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("diary.media_too_large");
      let offset = 0;
      while (offset < value.byteLength) {
        const result = await handle.write(value, offset, value.byteLength - offset);
        offset += result.bytesWritten;
      }
    }
    if (size !== expectedBytes) throw new Error("diary.media_size_mismatch");
    await handle.close();
    return { storage_path: relative, size };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await reader.cancel(error);
    } catch (cancelError) {
      cleanupErrors.push(cancelError);
    }
    try {
      await handle.close();
    } catch (closeError) {
      cleanupErrors.push(closeError);
    }
    try {
      await fs.unlink(full);
    } catch (unlinkError) {
      cleanupErrors.push(unlinkError);
    }
    if (cleanupErrors.length)
      throw new AggregateError([error, ...cleanupErrors], "Diary media upload cleanup failed.");
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function sqliteFileInfo(p: string): Promise<{ size: number } | null> {
  const env = await uploadsEnv();
  const full = resolveUpload(env, p);
  if (!full) return null;
  const fs = await nodeImport<typeof import("node:fs/promises")>("node:" + "fs/promises");
  try {
    const stat = await fs.stat(full);
    return stat.isFile() ? { size: stat.size } : null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

export async function streamSqliteFile(
  p: string,
  start?: number,
  end?: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const env = await uploadsEnv();
  const full = resolveUpload(env, p);
  if (!full) return null;
  const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
  const stream = await nodeImport<typeof import("node:stream")>("node:" + "stream");
  const file = fs.createReadStream(full, {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  });
  return stream.Readable.toWeb(file) as ReadableStream<Uint8Array>;
}

export type PaperlessConfig = {
  id: number;
  instance_id: string;
  enabled: number;
  api_url: string;
  browser_url: string;
};
export type PaperlessLink = {
  document_id: string;
  instance_id: string;
  remote_id: number;
  direction: "import" | "export";
  linked_at: string;
  checksum: string;
  browser_url: string;
};
export type PaperlessJob = {
  id: string;
  document_id: string;
  instance_id: string;
  user_id: string | null;
  metadata: string;
  state: PaperlessJobState;
  task_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  checksum: string | null;
};
export type PaperlessAutoImportRule = {
  user_id: string;
  instance_id: string;
  tag_id: number;
  revision: string;
  page: number;
  next_run: string;
  lease_until: string | null;
  last_run: string | null;
  imported: number;
  skipped: number;
  failed: number;
  error: string | null;
};
function paperlessAllowed(db: SqliteDb, userId: string) {
  const row = db
    .prepare(
      `SELECT role FROM app_users WHERE id=?
    AND (role='admin' OR (role='member' AND EXISTS(
      SELECT 1 FROM app_paperless_access WHERE user_id=app_users.id)))`,
    )
    .get(userId);
  return Boolean(row);
}
function autoImportCurrent(db: SqliteDb, rule: PaperlessAutoImportRule) {
  return Boolean(
    db
      .prepare(
        `SELECT rule.user_id FROM app_paperless_auto_import rule
    JOIN app_paperless_config config ON config.instance_id=rule.instance_id AND config.enabled=1
    JOIN app_users account ON account.id=rule.user_id AND account.role IN ('admin','member')
    JOIN app_paperless_credentials credential ON credential.user_id=rule.user_id AND credential.instance_id=rule.instance_id
    WHERE rule.user_id=? AND rule.revision=? AND rule.lease_until=?
    AND (account.role='admin' OR EXISTS(SELECT 1 FROM app_paperless_access access WHERE access.user_id=account.id))`,
      )
      .get(rule.user_id, rule.revision, rule.lease_until),
  );
}

/** Private integration storage. No credential or per-user check enters Workspace. */
export function paperlessRepository(database: () => Promise<SqliteDb> = getSqliteDb) {
  return {
    async config() {
      return (await database()).prepare("SELECT * FROM app_paperless_config WHERE id = 1").get() as
        PaperlessConfig | undefined;
    },
    async configure(config: PaperlessConfig) {
      const db = await database();
      db.exec("BEGIN IMMEDIATE");
      try {
        const old = db.prepare("SELECT * FROM app_paperless_config WHERE id = 1").get();
        if (old && old["instance_id"] !== config.instance_id) {
          db.exec(
            "DELETE FROM app_paperless_auto_import; DELETE FROM app_paperless_credentials; DELETE FROM app_paperless_checks;",
          );
        }
        if (!config.enabled || (old && old["instance_id"] !== config.instance_id)) {
          db.prepare(
            "UPDATE app_paperless_jobs SET state = 'paused', error = 'configuration_changed', updated_at = ? WHERE state IN ('queued','processing','transferring')",
          ).run(new Date().toISOString());
        }
        db.prepare(
          `INSERT INTO app_paperless_config (id,instance_id,enabled,api_url,browser_url) VALUES (1,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id, enabled=excluded.enabled, api_url=excluded.api_url,browser_url=excluded.browser_url`,
        ).run(config.instance_id, config.enabled, config.api_url, config.browser_url);
        db.prepare("UPDATE app_paperless_links SET browser_url=? WHERE instance_id=?").run(
          config.browser_url,
          config.instance_id,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async credential(userId: string, instanceId: string) {
      return (await database())
        .prepare(
          "SELECT ciphertext FROM app_paperless_credentials WHERE user_id = ? AND instance_id = ?",
        )
        .get(userId, instanceId)?.["ciphertext"] as string | undefined;
    },
    async connect(userId: string, instanceId: string, ciphertext: string) {
      const db = await database();
      if (!paperlessAllowed(db, userId)) throw new PaperlessError("unauthorized");
      const config = db
        .prepare("SELECT instance_id,enabled FROM app_paperless_config WHERE id = 1")
        .get();
      if (!config || config["instance_id"] !== instanceId || !config["enabled"])
        throw new PaperlessError("configuration_changed");
      db.prepare(
        `INSERT INTO app_paperless_credentials (user_id,instance_id,ciphertext) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET instance_id=excluded.instance_id,ciphertext=excluded.ciphertext`,
      ).run(userId, instanceId, ciphertext);
    },
    async disconnect(userId: string, deleting = false) {
      const db = await database();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM app_paperless_credentials WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM app_paperless_auto_import WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM app_paperless_checks WHERE user_id = ?").run(userId);
        db.prepare(
          "UPDATE app_paperless_jobs SET state='paused',error=?,updated_at=? WHERE user_id = ? AND state IN ('queued','transferring','processing')",
        ).run(deleting ? "account_deleted" : "disconnected", new Date().toISOString(), userId);
        if (deleting)
          db.prepare("UPDATE app_paperless_jobs SET user_id = NULL WHERE user_id = ?").run(userId);
        if (deleting) db.prepare("DELETE FROM app_paperless_access WHERE user_id=?").run(userId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async allowed(userId: string) {
      return paperlessAllowed(await database(), userId);
    },
    async accessList() {
      return (await database())
        .prepare("SELECT user_id FROM app_paperless_access")
        .all()
        .map((row) => String(row["user_id"]));
    },
    async setAccess(actorId: string, userId: string, enabled: boolean) {
      const db = await database();
      db.exec("BEGIN IMMEDIATE");
      try {
        if (db.prepare("SELECT role FROM app_users WHERE id=?").get(actorId)?.["role"] !== "admin")
          throw new PaperlessError("unauthorized");
        const target = db.prepare("SELECT role FROM app_users WHERE id=?").get(userId);
        if (!target) throw new PaperlessError("user_missing");
        if (target["role"] === "admin") throw new PaperlessError("admin_access");
        if (enabled)
          db.prepare("INSERT OR IGNORE INTO app_paperless_access (user_id) VALUES (?)").run(userId);
        else {
          db.prepare("DELETE FROM app_paperless_access WHERE user_id=?").run(userId);
          db.prepare("DELETE FROM app_paperless_auto_import WHERE user_id=?").run(userId);
          db.prepare("DELETE FROM app_paperless_credentials WHERE user_id=?").run(userId);
          db.prepare("DELETE FROM app_paperless_checks WHERE user_id=?").run(userId);
          db.prepare(
            "UPDATE app_paperless_jobs SET state='paused',error='access_revoked',updated_at=? WHERE user_id=? AND state IN ('queued','transferring','processing')",
          ).run(new Date().toISOString(), userId);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async autoImport(userId: string) {
      return (await database())
        .prepare("SELECT * FROM app_paperless_auto_import WHERE user_id=?")
        .get(userId) as PaperlessAutoImportRule | undefined;
    },
    async saveAutoImport(userId: string, instanceId: string | null, tagId: number | null) {
      const db = await database();
      if (!paperlessAllowed(db, userId)) throw new PaperlessError("unauthorized");
      if (tagId === null) {
        db.prepare("DELETE FROM app_paperless_auto_import WHERE user_id=?").run(userId);
        return;
      }
      const config = db
        .prepare("SELECT instance_id,enabled FROM app_paperless_config WHERE id=1")
        .get();
      if (!config?.["enabled"] || config["instance_id"] !== instanceId)
        throw new PaperlessError("configuration_changed");
      if (
        !db
          .prepare(
            "SELECT user_id FROM app_paperless_credentials WHERE user_id=? AND instance_id=?",
          )
          .get(userId, instanceId)
      )
        throw new PaperlessError("not_connected");
      db.prepare(
        `INSERT INTO app_paperless_auto_import (user_id,instance_id,tag_id,revision,next_run)
        VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        instance_id=excluded.instance_id,tag_id=excluded.tag_id,revision=excluded.revision,
        page=1,next_run=excluded.next_run,lease_until=NULL,last_run=NULL,imported=0,skipped=0,failed=0,error=NULL`,
      ).run(userId, instanceId, tagId, crypto.randomUUID(), new Date().toISOString());
    },
    async claimAutoImport() {
      const db = await database();
      const timestamp = new Date().toISOString();
      // One durable lease keeps concurrent server workers from processing the same rule.
      return db
        .prepare(
          `UPDATE app_paperless_auto_import SET lease_until=?
        WHERE user_id=(SELECT rule.user_id FROM app_paperless_auto_import rule
          JOIN app_paperless_config config ON config.instance_id=rule.instance_id AND config.enabled=1
          JOIN app_users account ON account.id=rule.user_id AND account.role IN ('admin','member')
          JOIN app_paperless_credentials credential ON credential.user_id=rule.user_id AND credential.instance_id=rule.instance_id
          WHERE rule.next_run<=? AND (rule.lease_until IS NULL OR rule.lease_until<=?)
          AND (account.role='admin' OR EXISTS(SELECT 1 FROM app_paperless_access access WHERE access.user_id=account.id))
          ORDER BY rule.next_run LIMIT 1) RETURNING *`,
        )
        .get(new Date(Date.now() + 35 * 60_000).toISOString(), timestamp, timestamp) as
        PaperlessAutoImportRule | undefined;
    },
    async autoImportCurrent(rule: PaperlessAutoImportRule) {
      return autoImportCurrent(await database(), rule);
    },
    async finishAutoImport(
      rule: PaperlessAutoImportRule,
      result: {
        page: number;
        imported: number;
        skipped: number;
        failed: number;
        error: string | null;
      },
    ) {
      (await database())
        .prepare(
          `UPDATE app_paperless_auto_import SET page=?,last_run=?,next_run=?,
        lease_until=NULL,imported=?,skipped=?,failed=?,error=? WHERE user_id=? AND revision=? AND lease_until=?`,
        )
        .run(
          result.page,
          new Date().toISOString(),
          new Date(Date.now() + 5 * 60_000).toISOString(),
          result.imported,
          result.skipped,
          result.failed,
          result.error,
          rule.user_id,
          rule.revision,
          rule.lease_until,
        );
    },
    async document(documentId: string) {
      return (await database()).prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    },
    async link(documentId: string) {
      return (await database())
        .prepare("SELECT * FROM app_paperless_links WHERE document_id = ?")
        .get(documentId) as PaperlessLink | undefined;
    },
    async source(instanceId: string, remoteId: number) {
      return (await database())
        .prepare("SELECT * FROM app_paperless_links WHERE instance_id = ? AND remote_id = ?")
        .get(instanceId, remoteId) as PaperlessLink | undefined;
    },
    async linkDocument(
      link: Omit<PaperlessLink, "browser_url">,
      jobId?: string,
      expectedState?: PaperlessJobState,
    ) {
      const db = await database();
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!db.prepare("SELECT id FROM documents WHERE id = ?").get(link.document_id))
          throw new PaperlessError("document_missing");
        const config = db
          .prepare("SELECT instance_id,browser_url FROM app_paperless_config WHERE id = 1")
          .get();
        if (config?.["instance_id"] !== link.instance_id)
          throw new PaperlessError("configuration_changed");
        if (
          db
            .prepare(
              "SELECT document_id FROM app_paperless_links WHERE document_id = ? OR (instance_id=? AND remote_id=?)",
            )
            .get(link.document_id, link.instance_id, link.remote_id)
        )
          throw new PaperlessError("source_conflict");
        if (jobId) {
          const job = db.prepare("SELECT * FROM app_paperless_jobs WHERE id = ?").get(jobId);
          if (job?.["user_id"] && !paperlessAllowed(db, String(job["user_id"])))
            throw new PaperlessError("unauthorized");
          if (
            !job ||
            !["processing", "unknown", "paused", "failed"].includes(String(job["state"])) ||
            (expectedState && job["state"] !== expectedState)
          )
            throw new PaperlessError("job_changed");
        }
        db.prepare(
          "INSERT INTO app_paperless_links (document_id,instance_id,remote_id,direction,linked_at,checksum,browser_url) VALUES (?,?,?,?,?,?,?)",
        ).run(
          link.document_id,
          link.instance_id,
          link.remote_id,
          link.direction,
          link.linked_at,
          link.checksum,
          config["browser_url"],
        );
        if (jobId)
          db.prepare(
            "UPDATE app_paperless_jobs SET state='linked',error=NULL,updated_at=? WHERE id=?",
          ).run(new Date().toISOString(), jobId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async importDocument(
      link: Omit<PaperlessLink, "browser_url">,
      document: Record<string, unknown>,
      actorId: string,
      autoRule?: PaperlessAutoImportRule,
      projectId?: string,
    ) {
      const db = await database();
      const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
      const path = await nodeImport<typeof import("node:path")>("node:" + "path");
      const { createHash } = await nodeImport<typeof import("node:crypto")>("node:" + "crypto");
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!paperlessAllowed(db, actorId)) throw new PaperlessError("unauthorized");
        if (autoRule && !autoImportCurrent(db, autoRule))
          throw new PaperlessError("configuration_changed");
        const existing = db
          .prepare(
            "SELECT document_id FROM app_paperless_links WHERE instance_id=? AND remote_id=?",
          )
          .get(link.instance_id, link.remote_id);
        if (existing) {
          db.exec("COMMIT");
          return { documentId: String(existing["document_id"]), duplicate: true };
        }
        const config = db
          .prepare("SELECT instance_id,enabled,browser_url FROM app_paperless_config WHERE id=1")
          .get();
        if (config?.["instance_id"] !== link.instance_id || !config["enabled"])
          throw new PaperlessError("configuration_changed");
        const candidates = db
          .prepare("SELECT id,storage_path FROM documents WHERE size=?")
          .all(document["size"]);
        for (const candidate of candidates) {
          if (typeof candidate["storage_path"] !== "string") continue;
          const file = resolveUpload(
            { fs, path, root: uploadsDir(path) },
            candidate["storage_path"],
          );
          if (!file || !fs.existsSync(file)) {
            console.warn("[paperless] Duplicate check found a missing local file", candidate["id"]);
            continue;
          }
          if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== link.checksum)
            continue;
          const documentId = String(candidate["id"]);
          const linked = db
            .prepare("SELECT document_id FROM app_paperless_links WHERE document_id=?")
            .get(documentId);
          const job = db
            .prepare("SELECT state FROM app_paperless_jobs WHERE document_id=?")
            .get(documentId);
          // Keep the existing shared source and unresolved transfer tracking unchanged.
          if (
            !linked &&
            (!job || ["failed", "abandoned", "linked"].includes(String(job["state"])))
          ) {
            db.prepare(
              "INSERT INTO app_paperless_links (document_id,instance_id,remote_id,direction,linked_at,checksum,browser_url) VALUES (?,?,?,?,?,?,?)",
            ).run(
              documentId,
              link.instance_id,
              link.remote_id,
              link.direction,
              link.linked_at,
              link.checksum,
              config["browser_url"],
            );
          }
          db.exec("COMMIT");
          return { documentId, duplicate: true };
        }
        const targetProjectId =
          projectId ??
          (typeof document["project_id"] === "string"
            ? document["project_id"]
            : (db.prepare("SELECT id FROM projects ORDER BY created_at, id LIMIT 1").get()?.[
                "id"
              ] as string | undefined));
        const row = {
          ...cleanRow("documents", {
            ...document,
            project_id: targetProjectId ?? null,
          }),
          id: link.document_id,
          created_at: link.linked_at,
        };
        if (targetProjectId) assertProjectReferences(db, "documents", row, targetProjectId);
        const keys = Object.keys(row);
        db.prepare(
          `INSERT INTO documents (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ).run(...keys.map((key) => toSql(row[key as keyof typeof row])));
        db.prepare(
          "INSERT INTO app_paperless_links (document_id,instance_id,remote_id,direction,linked_at,checksum,browser_url) VALUES (?,?,?,?,?,?,?)",
        ).run(
          link.document_id,
          link.instance_id,
          link.remote_id,
          link.direction,
          link.linked_at,
          link.checksum,
          config["browser_url"],
        );
        db.exec("COMMIT");
        return { documentId: link.document_id, duplicate: false };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async claim(
      documentId: string,
      userId: string,
      instanceId: string,
      metadata: PaperlessExportMetadata,
      retry = false,
    ) {
      const db = await database();
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!paperlessAllowed(db, userId)) throw new PaperlessError("unauthorized");
        if (!db.prepare("SELECT id FROM documents WHERE id = ?").get(documentId))
          throw new PaperlessError("document_missing");
        const config = db
          .prepare("SELECT instance_id,enabled FROM app_paperless_config WHERE id=1")
          .get();
        if (config?.["instance_id"] !== instanceId || !config["enabled"])
          throw new PaperlessError("configuration_changed");
        if (
          db
            .prepare("SELECT document_id FROM app_paperless_links WHERE document_id = ?")
            .get(documentId)
        ) {
          db.exec("COMMIT");
          return false;
        }
        const existing = db
          .prepare("SELECT * FROM app_paperless_jobs WHERE document_id = ?")
          .get(documentId);
        if (
          existing &&
          existing["state"] !== "abandoned" &&
          (!retry ||
            existing["user_id"] !== userId ||
            !["failed", "unknown", "paused", "abandoned"].includes(String(existing["state"])))
        ) {
          db.exec("COMMIT");
          return false;
        }
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO app_paperless_jobs (id,document_id,instance_id,user_id,metadata,state,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?)
          ON CONFLICT(document_id) DO UPDATE SET id=excluded.id,instance_id=excluded.instance_id,user_id=excluded.user_id,metadata=excluded.metadata,state='queued',task_id=NULL,error=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at,checksum=NULL`,
        ).run(
          crypto.randomUUID(),
          documentId,
          instanceId,
          userId,
          JSON.stringify(metadata),
          now,
          now,
        );
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async job(documentId: string) {
      return (await database())
        .prepare("SELECT * FROM app_paperless_jobs WHERE document_id = ?")
        .get(documentId) as PaperlessJob | undefined;
    },
    async jobs() {
      return (await database())
        .prepare(
          "SELECT * FROM app_paperless_jobs WHERE state IN ('queued','processing') ORDER BY created_at LIMIT 50",
        )
        .all() as PaperlessJob[];
    },
    async transition(
      id: string,
      from: PaperlessJobState,
      state: PaperlessJobState,
      patch: { taskId?: string; error?: string | null; checksum?: string } = {},
    ) {
      const db = await database();
      const result = db
        .prepare(
          `UPDATE app_paperless_jobs SET state=?,updated_at=?,error=?,task_id=COALESCE(?,task_id),checksum=COALESCE(?,checksum) WHERE id=? AND state=?`,
        )
        .run(
          state,
          new Date().toISOString(),
          patch.error ?? null,
          patch.taskId ?? null,
          patch.checksum ?? null,
          id,
          from,
        ) as { changes: number };
      return result.changes === 1;
    },
    async recover() {
      (await database())
        .prepare(
          "UPDATE app_paperless_jobs SET state='unknown',error='submission_unknown',updated_at=? WHERE state='transferring'",
        )
        .run(new Date().toISOString());
    },
    async accepted(id: string, taskId: string) {
      // A disconnect/configuration edit during submission must not discard the accepted task ID.
      (await database())
        .prepare(
          `UPDATE app_paperless_jobs SET task_id=?,updated_at=?,
        state=CASE WHEN state='transferring' THEN 'processing' ELSE state END
        WHERE id=? AND state IN ('transferring','paused','unknown')`,
        )
        .run(taskId, new Date().toISOString(), id);
    },
    async check(
      userId: string,
      documentId: string,
      state: "verified" | "inaccessible" | "unknown",
    ) {
      const now = new Date().toISOString();
      const db = await database();
      if (!paperlessAllowed(db, userId)) throw new PaperlessError("unauthorized");
      db.prepare(
        `INSERT INTO app_paperless_checks (user_id,document_id,state,checked_at,last_verified_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,document_id) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,last_verified_at=COALESCE(excluded.last_verified_at,app_paperless_checks.last_verified_at)`,
      ).run(userId, documentId, state, now, state === "verified" ? now : null);
    },
    async states(userId: string) {
      const db = await database();
      return {
        role: db.prepare("SELECT role FROM app_users WHERE id = ?").get(userId)?.["role"],
        documents: db.prepare("SELECT id FROM documents").all(),
        links: db.prepare("SELECT * FROM app_paperless_links").all() as PaperlessLink[],
        jobs: db.prepare("SELECT * FROM app_paperless_jobs").all() as PaperlessJob[],
        checks: db.prepare("SELECT * FROM app_paperless_checks WHERE user_id = ?").all(userId),
      };
    },
  };
}
export const paperlessRepo = paperlessRepository();

/* ------------------------------- helpers ------------------------------- */

function fundingSources(db: SqliteDb) {
  return db
    .prepare("SELECT id, deducts_from_budget FROM budget_pots")
    .all()
    .map((row) => ({
      id: String(row["id"]),
      deducts_from_budget: Boolean(row["deducts_from_budget"]),
    }));
}

function expenseSources(db: SqliteDb, projectId?: string): BudgetPot[] {
  const rows = projectId
    ? db.prepare("SELECT * FROM budget_pots WHERE project_id = ?").all(projectId)
    : db.prepare("SELECT * FROM budget_pots").all();
  return rows.map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    deducts_from_budget: Boolean(row["deducts_from_budget"]),
    notes: typeof row["notes"] === "string" ? row["notes"] : null,
  }));
}

function normalize(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  delete out["user_id"];
  for (const k of Object.keys(out)) {
    if (NUMERIC_COLS.has(k) && out[k] !== null) out[k] = Number(out[k]);
    if (BOOL_COLS.has(k)) out[k] = Boolean(out[k]);
  }
  return out;
}

function toSql(v: unknown) {
  if (typeof v === "boolean") return v ? 1 : 0;
  return v ?? null;
}

function sameRecord(a: Record<string, unknown> | null, b: Record<string, unknown> | null) {
  if (a === null || b === null) return a === b;
  const canonical = (value: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  return canonical(a) === canonical(b);
}

function serializeRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? value
        : String(value),
    ]),
  ) as Record<string, string | number | boolean | null>;
}

function safeName(n: string) {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

function queueAssignment(
  db: SqliteDb,
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
  actorId: string,
) {
  const recipient = next["assignee_id"];
  if (recipient === previous?.["assignee_id"]) return;
  db.prepare(
    "DELETE FROM app_push_deliveries WHERE job_id IN (SELECT id FROM app_push_jobs WHERE kind = 'assignment' AND resource_id = ?)",
  ).run(next["id"]);
  db.prepare("DELETE FROM app_push_jobs WHERE kind = 'assignment' AND resource_id = ?").run(
    next["id"],
  );
  if (
    typeof recipient !== "string" ||
    !recipient ||
    recipient === actorId ||
    next["status"] === "erledigt"
  )
    return;
  const now = new Date();
  insertPushJob(
    db,
    {
      id: crypto.randomUUID(),
      kind: "assignment",
      table: "tasks",
      resourceId: String(next["id"]),
      recipient,
      version: crypto.randomUUID(),
      dueAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    },
    now,
  );
}

function insertPushJob(db: SqliteDb, job: PushJob, now: Date) {
  db.prepare(
    `INSERT OR IGNORE INTO app_push_jobs
    (id, kind, resource_table, resource_id, recipient, version, due_at, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.kind,
    job.table,
    job.resourceId,
    job.recipient,
    job.version,
    job.dueAt,
    job.expiresAt,
    now.toISOString(),
  );
}

export type PushDevice = {
  id: string;
  userId: string;
  subscription: PushSubscriptionData;
  language: "de" | "en";
};
export type PushDelivery = { job: PushJob; device: PushDevice; attempts: number };

/** Private push state never enters the shared workspace or backup subscription lists. */
export const pushRepo = {
  async contactEmail(): Promise<string | null> {
    const row = (await getSqliteDb())
      .prepare("SELECT email FROM app_users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1")
      .get();
    return typeof row?.["email"] === "string" ? row["email"] : null;
  },
  async keys(generate: () => { publicKey: string; privateKey: string }) {
    const db = await getSqliteDb();
    if (!db.prepare("SELECT key FROM app_settings WHERE key = 'push_vapid'").get())
      db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('push_vapid', ?)").run(
        JSON.stringify(generate()),
      );
    const value = String(
      db.prepare("SELECT value FROM app_settings WHERE key = 'push_vapid'").get()?.["value"],
    );
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("publicKey" in parsed) ||
      !("privateKey" in parsed) ||
      typeof parsed.publicKey !== "string" ||
      typeof parsed.privateKey !== "string"
    )
      throw new Error("Invalid stored Web Push keys");
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  },
  async subscribe(
    userId: string,
    sessionHash: string,
    subscription: PushSubscriptionData,
    language: "de" | "en",
  ) {
    const db = await getSqliteDb();
    const existing = db
      .prepare("SELECT id FROM app_push_subscriptions WHERE endpoint = ?")
      .get(subscription.endpoint);
    if (existing) {
      db.prepare("DELETE FROM app_push_deliveries WHERE subscription_id = ?").run(existing["id"]);
      db.prepare("DELETE FROM app_push_subscriptions WHERE id = ?").run(existing["id"]);
    }
    db.prepare(
      "INSERT INTO app_push_subscriptions(id, user_id, session_hash, endpoint, subscription, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      userId,
      sessionHash,
      subscription.endpoint,
      JSON.stringify(subscription),
      language,
      new Date().toISOString(),
    );
  },
  async unsubscribe(userId: string, endpoint: string) {
    const db = await getSqliteDb();
    const device = db
      .prepare("SELECT id FROM app_push_subscriptions WHERE user_id = ? AND endpoint = ?")
      .get(userId, endpoint);
    if (device) await this.removeDevice(String(device["id"]));
  },
  async removeDevice(id: string) {
    const db = await getSqliteDb();
    db.prepare("DELETE FROM app_push_deliveries WHERE subscription_id = ?").run(id);
    db.prepare("DELETE FROM app_push_subscriptions WHERE id = ?").run(id);
  },
  async devices(userId?: string): Promise<PushDevice[]> {
    const now = new Date().toISOString();
    const rows = (await getSqliteDb())
      .prepare(
        `SELECT p.* FROM app_push_subscriptions p
      JOIN app_users u ON u.id = p.user_id
      JOIN app_sessions s ON s.token_hash = p.session_hash AND s.user_id = p.user_id
      WHERE u.role IN ('admin', 'member') AND s.expires_at > ? ${userId ? "AND p.user_id = ?" : ""}`,
      )
      .all(...(userId ? [now, userId] : [now]));
    return rows.map((row) => ({
      id: String(row["id"]),
      userId: String(row["user_id"]),
      subscription: JSON.parse(String(row["subscription"])) as PushSubscriptionData,
      language: row["language"] === "en" ? "en" : "de",
    }));
  },
  async prepare(jobs: PushJob[], now: Date) {
    const db = await getSqliteDb();
    for (const job of jobs) insertPushJob(db, job, now);
    db.prepare(
      `INSERT OR IGNORE INTO app_push_deliveries(job_id, subscription_id, next_attempt)
      SELECT j.id, s.id, j.due_at FROM app_push_jobs j JOIN app_push_subscriptions s
      ON (j.recipient IS NULL OR s.user_id = j.recipient) AND s.created_at <= j.created_at
      WHERE j.expires_at > ?`,
    ).run(now.toISOString());
    db.prepare(
      "DELETE FROM app_push_deliveries WHERE job_id IN (SELECT id FROM app_push_jobs WHERE expires_at < ?)",
    ).run(new Date(now.getTime() - 7 * 86_400_000).toISOString());
    db.prepare("DELETE FROM app_push_jobs WHERE expires_at < ?").run(
      new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    );
    // Logouts, deleted users and expired sessions revoke their subscriptions.
    db.exec(`DELETE FROM app_push_subscriptions WHERE NOT EXISTS (
      SELECT 1 FROM app_users u JOIN app_sessions s ON s.user_id = u.id
      WHERE u.id = app_push_subscriptions.user_id AND s.token_hash = app_push_subscriptions.session_hash
      AND u.role IN ('admin', 'member') AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    db.exec(
      "DELETE FROM app_push_deliveries WHERE subscription_id NOT IN (SELECT id FROM app_push_subscriptions)",
    );
  },
  async claim(now: Date): Promise<PushDelivery | null> {
    const db = await getSqliteDb();
    db.exec("BEGIN IMMEDIATE");
    let transactionOpen = true;
    try {
      const row = db
        .prepare(
          `SELECT j.*, d.subscription_id, d.attempts FROM app_push_deliveries d
        JOIN app_push_jobs j ON j.id = d.job_id WHERE d.sent = 0 AND d.attempts < 8
        AND d.next_attempt <= ? AND (d.lease_until IS NULL OR d.lease_until <= ?)
        AND j.due_at <= ? AND j.expires_at > ? ORDER BY j.due_at LIMIT 1`,
        )
        .get(now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString());
      if (!row) {
        db.exec("COMMIT");
        return null;
      }
      db.prepare(
        "UPDATE app_push_deliveries SET lease_until = ? WHERE job_id = ? AND subscription_id = ?",
      ).run(new Date(now.getTime() + 120_000).toISOString(), row["id"], row["subscription_id"]);
      db.exec("COMMIT");
      transactionOpen = false;
      const device = (await this.devices()).find((item) => item.id === row["subscription_id"]);
      if (!device) {
        await this.finish(String(row["id"]), String(row["subscription_id"]), true, 0, now);
        return null;
      }
      return {
        device,
        attempts: Number(row["attempts"]),
        job: {
          id: String(row["id"]),
          kind: String(row["kind"]) as PushJob["kind"],
          table: String(row["resource_table"]) as PushJob["table"],
          resourceId: String(row["resource_id"]),
          recipient: row["recipient"] ? String(row["recipient"]) : null,
          version: String(row["version"]),
          dueAt: String(row["due_at"]),
          expiresAt: String(row["expires_at"]),
        },
      };
    } catch (error) {
      if (transactionOpen) db.exec("ROLLBACK");
      throw error;
    }
  },
  async finish(jobId: string, deviceId: string, sent: boolean, attempts: number, now: Date) {
    (await getSqliteDb())
      .prepare(
        "UPDATE app_push_deliveries SET sent = ?, attempts = ?, next_attempt = ?, lease_until = NULL WHERE job_id = ? AND subscription_id = ?",
      )
      .run(
        sent ? 1 : 0,
        attempts,
        new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** attempts)).toISOString(),
        jobId,
        deviceId,
      );
  },
};
