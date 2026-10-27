// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { DEFAULT_APPEARANCE } from "@/lib/appearance";
import { DEFAULT_NAVIGATION } from "@/lib/navigation";
import type { Repo, SqliteDb } from "./repo";
import { createBackup, parseBackup, restoreBackup } from "./backup";

const dir = mkdtempSync(join(tmpdir(), "bauplan-backup-"));
const previousDir = process.env["DATA_DIR"];
let repo: Repo;
let db: SqliteDb;

beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  const module = await import("./repo");
  repo = module.sqliteRepo();
  db = await module.getSqliteDb();
});

afterAll(() => {
  if (previousDir === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previousDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("Bauplan backups", () => {
  it("round-trips database data, user accounts and uploaded documents without sessions", async () => {
    const syncGeneration = await repo.getSyncGeneration();
    db.prepare(
      "INSERT INTO app_users (id, email, name, password_hash, role, oidc_sub, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "admin-1",
      "admin@example.test",
      "Admin",
      "pbkdf2-hash",
      "admin",
      null,
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare("INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
      "session-hash",
      "admin-1",
      "2030-01-01T00:00:00.000Z",
    );
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(
      "oidc",
      JSON.stringify({ client_secret: "private-secret" }),
    );
    await repo.writeAppearance("admin-1", { ...DEFAULT_APPEARANCE, palette: "blue" });
    await repo.writeNavigation("admin-1", DEFAULT_NAVIGATION);
    db.prepare("INSERT INTO app_sync_operations (id, user_id, applied_at) VALUES (?, ?, ?)").run(
      "operation-1",
      "admin-1",
      "2026-01-02T00:00:00.000Z",
    );
    const project = await repo.insert("projects", {
      id: "project-1",
      name: "Saved project",
      address: null,
      total_budget: 321000,
      start_date: null,
      end_date: null,
    });
    const storagePath = await repo.putFile(
      "receipt.pdf",
      "application/pdf",
      new Uint8Array([1, 2, 3]),
    );
    await repo.insert("documents", {
      id: "document-1",
      name: "Receipt",
      category: "Invoice",
      storage_path: storagePath,
      mime_type: "application/pdf",
      size: 3,
    });

    const archive = await createBackup(repo);
    const parsed = parseBackup(archive);
    expect(parsed.database.tables.projects).toHaveLength(1);
    expect(parsed.database.users[0]?.["password_hash"]).toBe("pbkdf2-hash");
    expect(parsed.database.appearances).toHaveLength(1);
    expect(parsed.database.navigation).toHaveLength(1);
    expect(parsed.database.syncOperations).toHaveLength(1);
    expect(
      parsed.database.settings.some((setting) => setting["key"] === "workspace_generation"),
    ).toBe(false);
    expect(JSON.stringify(parsed.database)).toContain("private-secret");
    expect(JSON.stringify(parsed.database)).not.toContain("session-hash");
    expect(parsed.files.map((file) => file.name)).toContain(storagePath);

    await repo.insert("projects", {
      id: "project-2",
      name: "Must be replaced",
      total_budget: 1,
    });
    const extraFile = await repo.putFile("extra.txt", "text/plain", new Uint8Array([9]));
    const uploads = join(dir, "uploads");
    const uploadsInode = statSync(uploads).ino;
    await restoreBackup(repo, archive);
    expect(await repo.getSyncGeneration()).not.toBe(syncGeneration);
    // The uploads directory may be a mount point, so restore must swap its contents in place.
    expect(statSync(uploads).ino).toBe(uploadsInode);
    expect(readdirSync(uploads).sort()).toEqual([storagePath]);
    expect(readdirSync(dir).filter((name) => name.includes("backup"))).toEqual([]);

    const workspace = await repo.getAll();
    expect(workspace.projects.map((item) => item.id)).toEqual([project["id"]]);
    expect(workspace.documents).toHaveLength(1);
    expect(await repo.readFile(storagePath)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await repo.readFile(extraFile)).toBeNull();
    expect(db.prepare("SELECT * FROM app_sessions").all()).toEqual([]);
    expect(db.prepare("SELECT value FROM app_settings WHERE key = ?").get("oidc")?.["value"]).toBe(
      JSON.stringify({ client_secret: "private-secret" }),
    );
    expect(db.prepare("SELECT * FROM app_user_appearance").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM app_user_navigation").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM app_sync_operations").all()).toHaveLength(1);
  });

  it("rejects corrupted or unsafe archives before changing the database", async () => {
    const archive = await createBackup(repo);
    const entries = unzipSync(archive);
    const fileName = Object.keys(entries).find((name) => name.startsWith("uploads/"));
    if (!fileName) throw new Error("Expected an uploaded file in the test archive.");
    entries[fileName] = new Uint8Array([4, 5, 6]);
    expect(() => parseBackup(zipSync(entries))).toThrow(/beschädigt/);

    const unsafe = zipSync({
      "backup.json": strToU8("{}"),
      "uploads/../escape": new Uint8Array([1]),
    });
    expect(() => parseBackup(unsafe)).toThrow(/unsicheren Dateipfad/);
    expect((await repo.getAll()).projects.map((item) => item.id)).toEqual(["project-1"]);
  });

  it("rolls back database replacement if inserting restored rows fails", async () => {
    const archive = await createBackup(repo);
    const { database, files } = parseBackup(archive);
    const project = database.tables.projects[0];
    if (!project) throw new Error("Expected a project in the test backup.");
    const invalidDatabase = {
      ...database,
      tables: {
        ...database.tables,
        projects: [project, project],
      },
    };

    await expect(repo.restoreBackup(invalidDatabase, files)).rejects.toThrow();
    expect((await repo.getAll()).projects.map((item) => item.id)).toEqual(["project-1"]);
    expect(await repo.readFile(files[0]!.name)).toEqual(files[0]!.bytes);
    expect(readdirSync(join(dir, "uploads")).sort()).toEqual(files.map((file) => file.name).sort());
  });

  it("does not restore during setup if a user was created after the setup check", async () => {
    const archive = await createBackup(repo);
    const parsed = parseBackup(archive);
    await expect(repo.restoreBackup(parsed.database, parsed.files, true)).rejects.toThrow(
      "Die Einrichtung wurde bereits abgeschlossen.",
    );
    expect((await repo.getAll()).projects.map((item) => item.id)).toEqual(["project-1"]);
  });

  it("restores accounts during setup when the destination has no users", async () => {
    const archive = await createBackup(repo);
    const parsed = parseBackup(archive);
    db.prepare("DELETE FROM app_users").run();

    await repo.restoreBackup(parsed.database, parsed.files, true);

    expect(db.prepare("SELECT email FROM app_users").all()).toEqual([
      { email: "admin@example.test" },
    ]);
    expect((await repo.getAll()).projects.map((item) => item.id)).toEqual(["project-1"]);
  });

  it("does not create a setup admin after backup accounts have been restored", async () => {
    const { createInitialAdmin } = await import("./local-auth");
    await expect(
      createInitialAdmin({
        email: "second-admin@example.test",
        password: "a secure test password",
      }),
    ).rejects.toThrow("Die Einrichtung wurde bereits abgeschlossen.");
    expect(db.prepare("SELECT email FROM app_users ORDER BY email").all()).toHaveLength(1);
  });
});
