import {
  BOOL_COLS,
  NUMERIC_COLS,
  TABLE_NAMES,
  TABLES,
  SYNC_OPERATIONS_DDL,
  USER_APPEARANCE_DDL,
  USER_NAVIGATION_DDL,
} from "@/lib/schema";
import type { SqliteDb } from "./repo";

type Migration = { version: number; name: string; up: (db: SqliteDb) => void };

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "local-accounts-and-private-settings",
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT, role TEXT NOT NULL, oidc_sub TEXT UNIQUE, created_at TEXT NOT NULL)",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
      );
      db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");
      db.exec(USER_APPEARANCE_DDL);
      db.exec(USER_NAVIGATION_DDL);
      db.exec(SYNC_OPERATIONS_DDL);
    },
  },
];

function synchronizeWorkspaceSchema(db: SqliteDb) {
  const columnType = (column: string) =>
    NUMERIC_COLS.has(column) ? "REAL" : BOOL_COLS.has(column) ? "INTEGER" : "TEXT";
  for (const table of TABLE_NAMES) {
    const columns = TABLES[table] as readonly string[];
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ${columns.map((column) => `${column} ${columnType(column)}`).join(", ")})`,
    );
    const existing = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String(row["name"])),
    );
    for (const column of columns) {
      if (!existing.has(column))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType(column)}`);
    }
  }
}

/** Additive schema changes and ordered data migrations commit together, before any reads. */
export function migrateDatabase(db: SqliteDb, migrations: readonly Migration[] = MIGRATIONS) {
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()?.["user_version"] ?? 0);
    const latest = migrations.at(-1)?.version ?? 0;
    if (version > latest)
      throw new Error(`Database version ${version} is newer than supported version ${latest}.`);
    let previous = 0;
    for (const migration of migrations) {
      if (!Number.isInteger(migration.version) || migration.version !== previous + 1)
        throw new Error("Database migrations must have consecutive versions starting at 1.");
      previous = migration.version;
    }

    synchronizeWorkspaceSchema(db);
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      console.info(`[database] Migrating to v${migration.version}: ${migration.name}`);
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error("Database migration failed; no changes were committed.", { cause: error });
  }
}
