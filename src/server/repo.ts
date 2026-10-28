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
} from "@/lib/schema";
import { TABLES } from "@/lib/schema";
import type { PushJob, PushSubscriptionData } from "@/lib/push";
import type { PaperlessExportMetadata, PaperlessJobState } from "@/lib/paperless";
import { PaperlessError } from "./paperless-client";
import { calendarEtag, checkConditions, DavError, type DavConditions } from "./caldav-calendar";
import { appearanceSchema, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";
import { USER_NAVIGATION_TABLE } from "@/lib/schema";
import { migrateDatabase } from "./migrations";
import { validateFundingEntry } from "@/lib/funding";
import { validateTaskDates } from "@/lib/tasks";
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
  ): Promise<{ created: boolean; etag: string | null }>;
  readNavigation(userId: string): Promise<NavigationPreferences>;
  writeNavigation(userId: string, value: NavigationPreferences): Promise<void>;
  deleteNavigation(userId: string): Promise<void>;
  getAll(): Promise<Workspace>;
  getSyncGeneration(): Promise<string>;
  exportBackup(maxBytes?: number): Promise<{ database: BackupDatabase; files: BackupFile[] }>;
  restoreBackup(
    database: BackupDatabase,
    files: BackupFile[],
    requireNoUsers?: boolean,
  ): Promise<void>;
  insert(
    table: TableName,
    row: Record<string, unknown>,
    actorId?: string,
  ): Promise<Record<string, unknown>>;
  update(
    table: TableName,
    id: string,
    patch: Record<string, unknown>,
    actorId?: string,
  ): Promise<void>;
  remove(table: TableName, id: string): Promise<void>;
  putFile(name: string, mime: string, bytes: Uint8Array): Promise<string>;
  fileUrl(path: string): Promise<string>;
  deleteFile(path: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array | null>;
  readOcrSettings(): Promise<string | null>;
  writeOcrSettings(value: string | null): Promise<void>;
  readAppearance(userId: string): Promise<Appearance>;
  writeAppearance(userId: string, value: Appearance): Promise<void>;
  deleteAppearance(userId: string): Promise<void>;
  applySyncChange(
    userId: string,
    change: SyncChange,
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
};

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
  return db;
}

/** Shared SQLite handle (also used by the self-hosted login in local-auth.ts). */
export function getSqliteDb(): Promise<SqliteDb> {
  return (dbPromise ??= openDb());
}

export function sqliteRepo(): Repo {
  const db = () => (dbPromise ??= openDb());
  return {
    async writeCalendarEvent(id, value, conditions) {
      const d = await db();
      d.exec("BEGIN IMMEDIATE");
      try {
        const raw = d.prepare("SELECT * FROM events WHERE id = ?").get(id);
        const current = raw ? (normalize(raw) as CalEvent) : null;
        checkConditions(current ? calendarEtag(current) : null, conditions);
        if (!value) {
          if (!current) throw new DavError(404, "Appointment not found.");
          d.prepare("DELETE FROM events WHERE id = ?").run(id);
          d.exec("COMMIT");
          return { created: false, etag: null };
        }
        if (current && (current.caldav_uid || `${id}@bauplan`) !== value.caldav_uid)
          throw new DavError(409, "An appointment's UID cannot change.", "no-uid-conflict");
        if (
          d
            .prepare(
              "SELECT id FROM events WHERE COALESCE(caldav_uid, id || '@bauplan') = ? AND id != ?",
            )
            .get(value.caldav_uid, id)
        )
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
          created_at: current?.created_at || new Date().toISOString(),
        };
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
    async applySyncChange(userId, change) {
      if (change.table === "invoices") throw new Error("expenses.legacy_invoice_write");
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
        const raw = d.prepare(`SELECT * FROM ${change.table} WHERE id = ?`).get(change.rowId);
        const current = raw ? serializeRow(normalize(raw)) : null;
        if (!sameRecord(current, change.base)) {
          d.exec("ROLLBACK");
          return { applied: false, current };
        }
        if (change.action === "delete") {
          await this.remove(change.table, change.rowId);
        } else if (change.action === "create") {
          if (!change.row) throw new Error("Sync create requires a row");
          await this.insert(
            change.table,
            {
              ...cleanRow(change.table, change.row),
              id: change.rowId,
              created_at: change.row["created_at"],
            },
            userId,
          );
        } else {
          if (!change.row) throw new Error("Sync update requires a row");
          await this.update(change.table, change.rowId, cleanRow(change.table, change.row), userId);
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
    async getAll() {
      const d = await db();
      const out = {} as Record<string, unknown[]>;
      for (const t of TABLE_NAMES)
        out[t] = d.prepare(`SELECT * FROM ${t} ORDER BY created_at`).all().map(normalize);
      return out as unknown as Workspace;
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
    async exportBackup(maxBytes = Number.POSITIVE_INFINITY) {
      const d = await db();
      const path = await nodeImport<typeof import("node:path")>("node:" + "path");
      const fs = await nodeImport<typeof import("node:fs/promises")>("node:" + "fs/promises");
      const tables = {} as BackupDatabase["tables"];
      for (const table of TABLE_NAMES)
        tables[table] = d.prepare(`SELECT * FROM ${table} ORDER BY created_at, id`).all();
      const directory = uploadsDir(path);
      const files: BackupFile[] = [];
      let totalBytes = 0;
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(".bauplan-restore-")) continue;
        if (!entry.isFile())
          throw new Error("Das Upload-Verzeichnis enthält einen ungültigen Eintrag.");
        const filePath = path.join(directory, entry.name);
        const fileStat = await fs.stat(filePath);
        totalBytes += fileStat.size;
        if (totalBytes > maxBytes) throw new Error("Die Uploads überschreiten die Backup-Größe.");
        files.push({
          name: entry.name,
          bytes: new Uint8Array(await fs.readFile(filePath)),
        });
      }
      return {
        database: {
          tables,
          users: d.prepare("SELECT * FROM app_users ORDER BY id").all(),
          settings: d
            .prepare("SELECT * FROM app_settings WHERE key != ? ORDER BY key")
            .all(SYNC_GENERATION_SETTING),
          appearances: d.prepare(`SELECT * FROM ${USER_APPEARANCE_TABLE} ORDER BY user_id`).all(),
          navigation: d.prepare(`SELECT * FROM ${USER_NAVIGATION_TABLE} ORDER BY user_id`).all(),
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
    async restoreBackup(database, files, requireNoUsers = false) {
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
          if (
            !file.name ||
            file.name === "." ||
            file.name === ".." ||
            file.name !== path.basename(file.name) ||
            file.name.includes("/") ||
            file.name.includes("\\")
          )
            throw new Error("Das Backup enthält einen unsicheren Dateipfad.");
          await fs.writeFile(path.join(stagedUploads, file.name), file.bytes, { flag: "wx" });
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

        for (const name of await fs.readdir(liveDirectory)) {
          if (name === stageName) continue;
          await fs.rename(path.join(liveDirectory, name), path.join(previousUploads, name));
          movedOld.push(name);
        }
        for (const name of await fs.readdir(stagedUploads)) {
          await fs.rename(path.join(stagedUploads, name), path.join(liveDirectory, name));
          movedNew.push(name);
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
            await fs.rm(path.join(liveDirectory, name), { force: true });
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
    },
    async insert(table, row, actorId) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      if (table === "tasks") validateTaskDates(row);
      if (table === "funding_entries") validateFundingEntry(row, fundingSources(d));
      const id = (row["id"] as string) || crypto.randomUUID();
      const full = { ...row, id, created_at: row["created_at"] ?? new Date().toISOString() };
      const keys = Object.keys(full);
      if (table === "tasks" && actorId) d.exec("SAVEPOINT task_notification");
      try {
        d.prepare(
          `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ).run(...keys.map((k) => toSql((full as Record<string, unknown>)[k])));
        if (table === "tasks" && actorId) {
          queueAssignment(d, null, full, actorId);
          d.exec("RELEASE task_notification");
        }
        return full;
      } catch (error) {
        if (table === "tasks" && actorId)
          d.exec("ROLLBACK TO task_notification; RELEASE task_notification");
        throw error;
      }
    },
    async update(table, id, patch, actorId) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      if (table === "tasks") {
        const existing = d.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
        validateTaskDates({ ...existing, ...patch });
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
      if (table === "tasks" && actorId) d.exec("SAVEPOINT task_notification");
      try {
        const previous =
          table === "tasks" && actorId
            ? d.prepare("SELECT * FROM tasks WHERE id = ?").get(id)
            : undefined;
        d.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
          ...keys.map((k) => toSql(patch[k])),
          id,
        );
        if (table === "tasks" && actorId) {
          if (previous) queueAssignment(d, previous, { ...previous, ...patch }, actorId);
          d.exec("RELEASE task_notification");
        }
      } catch (error) {
        if (table === "tasks" && actorId)
          d.exec("ROLLBACK TO task_notification; RELEASE task_notification");
        throw error;
      }
    },
    async remove(table, id) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      if (
        table === "budget_pots" &&
        d.prepare("SELECT id FROM funding_entries WHERE budget_pot_id = ? LIMIT 1").get(id)
      )
        throw new Error("funding.source_in_use");
      d.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    },
    async putFile(name, _mime, bytes) {
      const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
      const path = await nodeImport<typeof import("node:path")>("node:" + "path");
      await db();
      const rel = `${crypto.randomUUID()}-${safeName(name)}`;
      fs.writeFileSync(path.join(uploadsDir(path), rel), bytes);
      return rel;
    },
    async fileUrl(p) {
      return `/api/files/${encodeURIComponent(p)}`;
    },
    async deleteFile(p) {
      const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
      const path = await nodeImport<typeof import("node:path")>("node:" + "path");
      try {
        fs.unlinkSync(path.join(uploadsDir(path), path.basename(p)));
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
          throw error;
      }
    },
    readFile: (p) => readSqliteFile(p),
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

export async function readSqliteFile(p: string): Promise<Uint8Array | null> {
  const fs = await nodeImport<typeof import("node:fs")>("node:" + "fs");
  const path = await nodeImport<typeof import("node:path")>("node:" + "path");
  const full = path.join(uploadsDir(path), path.basename(p));
  return fs.existsSync(full) ? new Uint8Array(fs.readFileSync(full)) : null;
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
          const file = path.join(uploadsDir(path), path.basename(candidate["storage_path"]));
          if (!fs.existsSync(file)) {
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
        const row = {
          ...cleanRow("documents", document),
          id: link.document_id,
          created_at: link.linked_at,
        };
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
