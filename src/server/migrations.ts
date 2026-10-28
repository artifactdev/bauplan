import {
  BOOL_COLS,
  NUMERIC_COLS,
  TABLE_NAMES,
  TABLES,
  SYNC_OPERATIONS_DDL,
  USER_APPEARANCE_DDL,
  USER_NAVIGATION_DDL,
  PUSH_DDL,
  PAPERLESS_DDL,
  PAPERLESS_AUTO_IMPORT_DDL,
  PAPERLESS_ACCESS_DDL,
} from "@/lib/schema";
import type { SqliteDb } from "./repo";
import { legacyInvoiceExpense } from "@/lib/expenses";

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
  {
    version: 2,
    name: "unify-invoices-and-expenses",
    up(db) {
      for (const invoice of db.prepare("SELECT * FROM invoices").all()) {
        const expense = legacyInvoiceExpense(invoice);
        const keys = Object.keys(expense);
        db.prepare(
          `INSERT INTO expenses (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        ).run(...keys.map((key) => toSqlValue(expense[key])));
      }
      db.exec("DELETE FROM invoices");
    },
  },
  {
    version: 3,
    name: "additional-funding-ledger",
    // The shared schema creates the ledger; versioning prevents older builds from ignoring it.
    up() {},
  },
  {
    version: 4,
    name: "web-push-notifications",
    up(db) {
      db.exec(PUSH_DDL);
    },
  },
  {
    version: 5,
    name: "paperless-private-connector",
    up(db) {
      db.exec(PAPERLESS_DDL);
    },
  },
  {
    version: 6,
    name: "paperless-link-browser-url",
    up(db) {
      const columns = db.prepare("PRAGMA table_info(app_paperless_links)").all();
      if (columns.some((column) => column["name"] === "browser_url")) return;
      if (
        db
          .prepare(
            `
          SELECT document_id FROM app_paperless_links AS link
          WHERE NOT EXISTS (
            SELECT 1 FROM app_paperless_config AS config
            WHERE config.instance_id = link.instance_id AND length(trim(config.browser_url)) > 0
          ) LIMIT 1
        `,
          )
          .get()
      )
        throw new Error("Cannot recover the browser URL for a legacy Paperless link.");
      db.exec(`
        ALTER TABLE app_paperless_links ADD COLUMN browser_url TEXT NOT NULL DEFAULT '';
        UPDATE app_paperless_links SET browser_url = (
          SELECT browser_url FROM app_paperless_config
          WHERE app_paperless_config.instance_id = app_paperless_links.instance_id
        );
      `);
    },
  },
  {
    version: 7,
    name: "paperless-tag-auto-import",
    up(db) {
      db.exec(PAPERLESS_AUTO_IMPORT_DDL);
    },
  },
  {
    version: 8,
    name: "paperless-per-user-access",
    up(db) {
      db.exec(PAPERLESS_ACCESS_DDL);
    },
  },
];

function toSqlValue(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value == null) return null;
  throw new Error("Unsupported invoice migration value.");
}

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
