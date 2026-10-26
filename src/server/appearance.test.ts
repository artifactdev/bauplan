// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { USER_APPEARANCE_TABLE } from "@/lib/schema";

const dir = mkdtempSync(join(tmpdir(), "bauplan-appearance-"));
const previousDir = process.env["DATA_DIR"];
let repo: ReturnType<typeof import("./repo").sqliteRepo>;
let db: Awaited<ReturnType<typeof import("./repo").getSqliteDb>>;

beforeAll(async () => {
  const legacy = new DatabaseSync(join(dir, "renovierung.db"));
  legacy.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT)");
  legacy
    .prepare("INSERT INTO projects (id, created_at, name) VALUES (?, ?, ?)")
    .run("existing", "2026-01-01", "Keep me");
  legacy.close();
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

describe("Account appearance SQLite persistence", () => {
  it("initializes additively without changing legacy project data", async () => {
    expect((await repo.getAll()).projects[0]?.name).toBe("Keep me");
    expect(await repo.readAppearance("new")).toEqual({ palette: "current", mode: "system" });
    expect(await repo.getAll()).not.toHaveProperty(USER_APPEARANCE_TABLE);
  });
  it("persists and updates only the selected user", async () => {
    await repo.writeAppearance("alice", { palette: "blue", mode: "dark" });
    await repo.writeAppearance("bob", { palette: "violet", mode: "system" });
    await repo.writeAppearance("alice", { palette: "green", mode: "light" });
    expect(await repo.readAppearance("alice")).toEqual({ palette: "green", mode: "light" });
    expect(await repo.readAppearance("bob")).toEqual({ palette: "violet", mode: "system" });
  });
  it("reports invalid stored data instead of pretending a default was saved", async () => {
    db.prepare(`INSERT INTO ${USER_APPEARANCE_TABLE} VALUES (?, ?, ?)`).run(
      "invalid",
      "red",
      "dark",
    );
    await expect(repo.readAppearance("invalid")).rejects.toThrow();
  });
  it("cleans up private preferences through account deletion", async () => {
    const { createUser, deleteUser } = await import("./local-auth");
    const id = await createUser({ email: "delete@example.test", role: "member" });
    await repo.writeAppearance(id, { palette: "blue", mode: "dark" });
    await deleteUser(id);
    expect(
      db.prepare(`SELECT * FROM ${USER_APPEARANCE_TABLE} WHERE user_id = ?`).get(id),
    ).toBeUndefined();
  });
});
