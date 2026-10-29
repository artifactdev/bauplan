// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { BOOL_COLS, NUMERIC_COLS, PAPERLESS_TABLES, TABLE_NAMES, TABLES } from "@/lib/schema";
import { migrateDatabase } from "./migrations";
import { paperlessRepository } from "./repo";

const databases: DatabaseSync[] = [];
function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("database migrations", () => {
  it("initializes a fresh database with the complete typed schema and version", () => {
    const db = database();
    migrateDatabase(db);
    for (const table of TABLE_NAMES) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      expect(columns.map((column) => column["name"])).toEqual([
        "id",
        "created_at",
        ...TABLES[table],
      ]);
      for (const column of columns.slice(2)) {
        const name = String(column["name"]);
        expect(column["type"]).toBe(
          NUMERIC_COLS.has(name) ? "REAL" : BOOL_COLS.has(name) ? "INTEGER" : "TEXT",
        );
      }
    }
    for (const [table, columns] of Object.entries(PAPERLESS_TABLES)) {
      expect(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column["name"]),
      ).toEqual(columns);
    }
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(9);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'app_%'").all()).toHaveLength(
      17,
    );
  });

  it("upgrades an unversioned installation without losing offers, users, or settings", () => {
    const db = database();
    db.exec(`
      CREATE TABLE offers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, contractor TEXT, amount REAL);
      INSERT INTO offers VALUES ('offer-1', '2026-10-27', 'Roofing', 30392);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO app_settings VALUES ('ics_token', 'preserved');
    `);
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM offers").get()).toMatchObject({
      id: "offer-1",
      contractor: "Roofing",
      amount: 30392,
      valid_until: null,
    });
    expect(
      db.prepare("SELECT value FROM app_settings WHERE key = 'ics_token'").get()?.["value"],
    ).toBe("preserved");
    db.prepare(
      "INSERT INTO app_users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("user-1", "user@example.test", "existing-hash", "admin", "2026-10-27");
    // Simulate an existing pre-versioning installation using the same account tables.
    db.exec("PRAGMA user_version = 0");
    migrateDatabase(db);
    expect(
      db.prepare("SELECT password_hash FROM app_users WHERE id = 'user-1'").get()?.[
        "password_hash"
      ],
    ).toBe("existing-hash");
  });

  it("is idempotent and adds newly introduced columns even to versioned databases", () => {
    const db = database();
    migrateDatabase(db);
    db.exec(
      "INSERT INTO offers (id, created_at, valid_until) VALUES ('offer-1', '2026-10-27', '2026-11-10')",
    );
    db.exec("ALTER TABLE tasks DROP COLUMN assignee_id");
    db.exec("ALTER TABLE tasks DROP COLUMN start_date");
    db.exec(
      "INSERT INTO tasks (id, created_at, title, due_date) VALUES ('task', '2026-10-27', 'Existing', '2026-11-01')",
    );
    migrateDatabase(db);
    migrateDatabase(db);
    expect(db.prepare("SELECT valid_until FROM offers").all()).toEqual([
      { valid_until: "2026-11-10" },
    ]);
    expect(
      db
        .prepare("PRAGMA table_info(tasks)")
        .all()
        .some((column) => column["name"] === "assignee_id"),
    ).toBe(true);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(9);
    expect(db.prepare("SELECT start_date, due_date FROM tasks WHERE id = 'task'").get()).toEqual({
      start_date: null,
      due_date: "2026-11-01",
    });
  });

  it("applies ordered data migrations once", () => {
    const db = database();
    const migrations = [
      {
        version: 1,
        name: "seed",
        up: () =>
          db.exec(
            "INSERT INTO trades (id, created_at, name, budget) VALUES ('trade-1', '2026-10-27', 'Roofing', 100)",
          ),
      },
      { version: 2, name: "backfill", up: () => db.exec("UPDATE trades SET budget = budget + 25") },
    ];
    migrateDatabase(db, migrations);
    migrateDatabase(db, migrations);
    expect(db.prepare("SELECT budget FROM trades").get()?.["budget"]).toBe(125);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(2);
  });

  it("introduces access grants without granting any existing members access", () => {
    const db = database();
    migrateDatabase(db);
    db.exec("DROP TABLE app_paperless_access; PRAGMA user_version=7;");
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM app_paperless_access").all()).toEqual([]);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(9);
  });

  it("upgrades v6 with an empty private auto-import table without enabling imports", () => {
    const db = database();
    migrateDatabase(db);
    db.exec("DROP TABLE app_paperless_auto_import; PRAGMA user_version=6;");
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM app_paperless_auto_import").all()).toEqual([]);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(9);
  });

  it("upgrades v5 Paperless links and preserves their source URL when settings are saved", async () => {
    const db = database();
    migrateDatabase(db);
    db.exec(`
      ALTER TABLE app_paperless_links DROP COLUMN browser_url;
      PRAGMA user_version = 5;
      INSERT INTO app_paperless_config VALUES (1, 'instance', 1, 'http://paperless:8000', 'https://archive.example.test');
      INSERT INTO app_paperless_links VALUES ('doc', 'instance', 42, 'import', '2026-10-28', 'checksum');
      INSERT INTO app_paperless_credentials VALUES ('user', 'instance', 'encrypted-token');
    `);

    migrateDatabase(db);
    migrateDatabase(db);

    expect(db.prepare("SELECT * FROM app_paperless_links").get()).toEqual({
      document_id: "doc",
      instance_id: "instance",
      remote_id: 42,
      direction: "import",
      linked_at: "2026-10-28",
      checksum: "checksum",
      browser_url: "https://archive.example.test",
    });
    const repository = paperlessRepository(async () => db);
    await repository.configure({
      id: 1,
      instance_id: "instance",
      enabled: 1,
      api_url: "http://paperless:8000",
      browser_url: "https://new.example.test",
    });
    expect(db.prepare("SELECT browser_url FROM app_paperless_links").get()?.["browser_url"]).toBe(
      "https://new.example.test",
    );
    expect(await repository.credential("user", "instance")).toBe("encrypted-token");
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(9);
  });

  it("upgrades an empty v5 links table so initial Paperless settings can be saved", async () => {
    const db = database();
    migrateDatabase(db);
    db.exec("ALTER TABLE app_paperless_links DROP COLUMN browser_url; PRAGMA user_version = 5;");
    migrateDatabase(db);
    const repository = paperlessRepository(async () => db);
    await repository.configure({
      id: 1,
      instance_id: "instance",
      enabled: 1,
      api_url: "https://archive.example.test",
      browser_url: "https://archive.example.test",
    });
    expect((await repository.config())?.browser_url).toBe("https://archive.example.test");
  });

  it("does not overwrite historical URLs in an already complete v5 schema", () => {
    const db = database();
    migrateDatabase(db);
    db.exec(`
      PRAGMA user_version = 5;
      INSERT INTO app_paperless_links VALUES ('doc', 'old-instance', 42, 'import', '2026-10-28', 'checksum', 'https://old.example.test');
    `);
    migrateDatabase(db);
    expect(db.prepare("SELECT browser_url FROM app_paperless_links").get()?.["browser_url"]).toBe(
      "https://old.example.test",
    );
  });

  it("rolls back a legacy link upgrade if its original instance URL cannot be recovered", () => {
    const db = database();
    migrateDatabase(db);
    db.exec(`
      ALTER TABLE app_paperless_links DROP COLUMN browser_url;
      PRAGMA user_version = 5;
      INSERT INTO app_paperless_links VALUES ('doc', 'old-instance', 42, 'import', '2026-10-28', 'checksum');
    `);
    expect(() => migrateDatabase(db)).toThrow("Database migration failed");
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(5);
    expect(db.prepare("SELECT remote_id FROM app_paperless_links").get()?.["remote_id"]).toBe(42);
    expect(
      db
        .prepare("PRAGMA table_info(app_paperless_links)")
        .all()
        .map((column) => column["name"]),
    ).not.toContain("browser_url");
  });

  it("adds the funding ledger to v2 without changing the existing initial bank budget", () => {
    const db = database();
    migrateDatabase(db);
    db.exec(`
      DROP TABLE funding_entries;
      PRAGMA user_version = 2;
      INSERT INTO projects (id, created_at, total_budget) VALUES ('project', '2026-01-01', 100000);
    `);
    migrateDatabase(db);
    migrateDatabase(db);
    expect(db.prepare("SELECT total_budget FROM projects").get()?.["total_budget"]).toBe(100000);
    expect(db.prepare("SELECT * FROM funding_entries").all()).toEqual([]);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(9);
  });

  it("moves paid and open invoices into expenses once while preserving their fields", () => {
    const db = database();
    migrateDatabase(db);
    db.exec(`
      PRAGMA user_version = 1;
      ALTER TABLE expenses DROP COLUMN offer_id;
      ALTER TABLE expenses DROP COLUMN contact_id;
      ALTER TABLE expenses DROP COLUMN due_date;
      INSERT INTO expenses (id, created_at, title, amount, status) VALUES ('old-expense', '2026-01-01', 'Tools', 25, 'bezahlt');
      INSERT INTO invoices (id, created_at, title, contractor, amount, invoice_date, due_date, payment_date, paid, trade_id, cost_item_id, document_id, contact_id, budget_pot_id)
        VALUES ('paid', '2026-01-01', 'First installment', 'Roofing', 1000, '2026-01-01', '2026-01-15', '2026-01-12', 1, 'trade', 'cost', 'doc', 'contact', 'bank'),
               ('open', '2026-01-02', NULL, 'Roofing', 2000, '2026-01-02', '2026-01-16', NULL, 0, 'trade', 'cost', NULL, 'contact', 'bank');
    `);
    migrateDatabase(db);
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM invoices").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM expenses").all()).toHaveLength(3);
    expect(db.prepare("SELECT * FROM expenses WHERE id = 'invoice-paid'").get()).toMatchObject({
      title: "First installment",
      vendor: "Roofing",
      amount: 1000,
      expense_date: "2026-01-01",
      due_date: "2026-01-15",
      payment_date: "2026-01-12",
      status: "bezahlt",
      trade_id: "trade",
      cost_item_id: "cost",
      document_id: "doc",
      contact_id: "contact",
      budget_pot_id: "bank",
      offer_id: null,
    });
    expect(db.prepare("SELECT * FROM expenses WHERE id = 'invoice-open'").get()).toMatchObject({
      title: "Roofing",
      status: "offen",
      due_date: "2026-01-16",
      payment_date: null,
    });
  });

  it("rolls back rather than overwriting an expense whose ID collides with a migrated invoice", () => {
    const db = database();
    migrateDatabase(db);
    db.exec(`
      PRAGMA user_version = 1;
      INSERT INTO expenses (id, created_at, amount) VALUES ('invoice-existing', '2026-01-01', 25);
      INSERT INTO invoices (id, created_at, amount) VALUES ('existing', '2026-01-01', 100);
    `);
    expect(() => migrateDatabase(db)).toThrow("Database migration failed");
    expect(db.prepare("SELECT amount FROM expenses").get()?.["amount"]).toBe(25);
    expect(db.prepare("SELECT amount FROM invoices").get()?.["amount"]).toBe(100);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(1);
  });

  it("rolls back schema, data, and version together when a migration fails", () => {
    const db = database();
    db.exec(`
      CREATE TABLE offers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, amount REAL);
      INSERT INTO offers VALUES ('offer-1', '2026-10-27', 30392);
    `);
    expect(() =>
      migrateDatabase(db, [
        {
          version: 1,
          name: "failing",
          up: () => {
            db.exec("UPDATE offers SET amount = 0");
            throw new Error("Backfill failed");
          },
        },
      ]),
    ).toThrow("Database migration failed");
    expect(db.prepare("SELECT amount FROM offers").get()?.["amount"]).toBe(30392);
    expect(
      db
        .prepare("PRAGMA table_info(offers)")
        .all()
        .map((column) => column["name"]),
    ).toEqual(["id", "created_at", "amount"]);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tasks'").get()).toBeUndefined();
    // The failed transaction releases its lock and a corrected migration can run.
    migrateDatabase(db);
  });

  it("rejects database downgrades before changing the schema", () => {
    const db = database();
    db.exec("PRAGMA user_version = 999");
    expect(() => migrateDatabase(db)).toThrow("Database migration failed");
    expect(db.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(999);
  });

  it("rejects out-of-order migration versions", () => {
    const db = database();
    expect(() =>
      migrateDatabase(db, [{ version: 2, name: "missing baseline", up: () => {} }]),
    ).toThrow("Database migration failed");
    expect(db.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
  });
});
