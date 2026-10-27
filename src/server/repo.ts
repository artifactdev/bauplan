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
} from "@/lib/schema";
import { appearanceSchema, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";
import { USER_NAVIGATION_TABLE } from "@/lib/schema";
import { migrateDatabase } from "./migrations";
import {
  parseNavigation,
  navigationSchema,
  DEFAULT_NAVIGATION,
  type NavigationPreferences,
} from "@/lib/navigation";

export interface Repo {
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
  insert(table: TableName, row: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(table: TableName, id: string, patch: Record<string, unknown>): Promise<void>;
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
          await this.insert(change.table, {
            ...cleanRow(change.table, change.row),
            id: change.rowId,
            created_at: change.row["created_at"],
          });
        } else {
          if (!change.row) throw new Error("Sync update requires a row");
          await this.update(change.table, change.rowId, cleanRow(change.table, change.row));
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

        for (const table of TABLE_NAMES) d.prepare(`DELETE FROM ${table}`).run();
        d.prepare("DELETE FROM app_users").run();
        d.prepare("DELETE FROM app_settings").run();
        d.prepare(`DELETE FROM ${USER_APPEARANCE_TABLE}`).run();
        d.prepare(`DELETE FROM ${USER_NAVIGATION_TABLE}`).run();
        d.prepare("DELETE FROM app_sync_operations").run();
        d.prepare("DELETE FROM app_sessions").run();

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
    async insert(table, row) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      const id = (row["id"] as string) || crypto.randomUUID();
      const full = { ...row, id, created_at: row["created_at"] ?? new Date().toISOString() };
      const keys = Object.keys(full);
      d.prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ).run(...keys.map((k) => toSql((full as Record<string, unknown>)[k])));
      return full;
    },
    async update(table, id, patch) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      const d = await db();
      const keys = Object.keys(patch);
      if (!keys.length) return;
      d.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
        ...keys.map((k) => toSql(patch[k])),
        id,
      );
    },
    async remove(table, id) {
      if (table === "invoices") throw new Error("expenses.legacy_invoice_write");
      (await db()).prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
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
      } catch {
        /* already gone */
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

/* ------------------------------- helpers ------------------------------- */

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
