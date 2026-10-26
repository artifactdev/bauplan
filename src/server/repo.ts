// Server-only storage adapters. Import this module only via dynamic import()
// inside server function handlers.
import { BOOL_COLS, NUMERIC_COLS, TABLE_NAMES, TABLES, USER_APPEARANCE_DDL, USER_APPEARANCE_TABLE, type TableName, type Workspace } from "@/lib/schema";
import { appearanceSchema, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";
import { USER_NAVIGATION_DDL, USER_NAVIGATION_TABLE } from "@/lib/schema";
import { navigationSchema, DEFAULT_NAVIGATION, type NavigationPreferences } from "@/lib/navigation";

export interface Repo {
  readNavigation(userId: string): Promise<NavigationPreferences>;
  writeNavigation(userId: string, value: NavigationPreferences): Promise<void>;
  deleteNavigation(userId: string): Promise<void>;
  getAll(): Promise<Workspace>;
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
}

// Uses Node's built-in node:sqlite (Node >= 22.5). Computed dynamic imports
// keep Node-only modules out of browser-side module graphs.

export type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[]; run(...p: unknown[]): unknown; get(...p: unknown[]): Record<string, unknown> | undefined };
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
  const { DatabaseSync } = await nodeImport<{ DatabaseSync: new (f: string) => SqliteDb }>("node:" + "sqlite");
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(uploadsDir(path), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir(), "renovierung.db"));
  for (const t of TABLE_NAMES) {
    const cols = (TABLES[t] as readonly string[])
      .map((c) => `${c} ${NUMERIC_COLS.has(c) ? "REAL" : BOOL_COLS.has(c) ? "INTEGER" : "TEXT"}`)
      .join(", ");
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ${cols})`);
    // Add columns introduced after the table was first created.
    const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => String(r["name"])));
    for (const c of TABLES[t] as readonly string[]) {
      if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${NUMERIC_COLS.has(c) ? "REAL" : BOOL_COLS.has(c) ? "INTEGER" : "TEXT"}`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT, role TEXT NOT NULL, oidc_sub TEXT UNIQUE, created_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(USER_APPEARANCE_DDL);
  db.exec(USER_NAVIGATION_DDL);
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
      const row = (await db()).prepare(`SELECT preferences FROM ${USER_NAVIGATION_TABLE} WHERE user_id = ?`).get(userId);
      return row ? navigationSchema.parse(JSON.parse(String(row["preferences"]))) : navigationSchema.parse(DEFAULT_NAVIGATION);
    },
    async writeNavigation(userId, value) {
      const valid = navigationSchema.parse(value);
      (await db()).prepare(`INSERT INTO ${USER_NAVIGATION_TABLE} (user_id, preferences) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences`).run(userId, JSON.stringify(valid));
    },
    async deleteNavigation(userId) {
      (await db()).prepare(`DELETE FROM ${USER_NAVIGATION_TABLE} WHERE user_id = ?`).run(userId);
    },
    async readAppearance(userId) {
      const row = (await db()).prepare(`SELECT palette, mode FROM ${USER_APPEARANCE_TABLE} WHERE user_id = ?`).get(userId);
      return row ? appearanceSchema.parse(row) : { ...DEFAULT_APPEARANCE };
    },
    async writeAppearance(userId, value) {
      const valid = appearanceSchema.parse(value);
      (await db()).prepare(`INSERT INTO ${USER_APPEARANCE_TABLE} (user_id, palette, mode) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET palette = excluded.palette, mode = excluded.mode`).run(userId, valid.palette, valid.mode);
    },
    async deleteAppearance(userId) {
      (await db()).prepare(`DELETE FROM ${USER_APPEARANCE_TABLE} WHERE user_id = ?`).run(userId);
    },
    async getAll() {
      const d = await db();
      const out = {} as Record<string, unknown[]>;
      for (const t of TABLE_NAMES) out[t] = d.prepare(`SELECT * FROM ${t} ORDER BY created_at`).all().map(normalize);
      return out as unknown as Workspace;
    },
    async insert(table, row) {
      const d = await db();
      const id = (row["id"] as string) || crypto.randomUUID();
      const full = { ...row, id, created_at: new Date().toISOString() };
      const keys = Object.keys(full);
      d.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => toSql((full as Record<string, unknown>)[k])));
      return full;
    },
    async update(table, id, patch) {
      const d = await db();
      const keys = Object.keys(patch);
      if (!keys.length) return;
      d.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => toSql(patch[k])), id);
    },
    async remove(table, id) {
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
      const row = (await db()).prepare("SELECT value FROM app_settings WHERE key = ?").get("ocr_config");
      return row ? String(row["value"]) : null;
    },
    async writeOcrSettings(value) {
      const d = await db();
      if (value === null) d.prepare("DELETE FROM app_settings WHERE key = ?").run("ocr_config");
      else d.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("ocr_config", value);
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

function safeName(n: string) {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}
