// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo } from "./repo";
import type { SyncChange } from "./repo";

const dir = mkdtempSync(join(tmpdir(), "bauplan-sync-"));
const previousDir = process.env["DATA_DIR"];
let repo: Repo;
let db: Awaited<ReturnType<typeof import("./repo").getSqliteDb>>;

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

describe("offline row synchronization", () => {
  it("applies changes once and reports concurrent edits without overwriting", async () => {
    const create: SyncChange = {
      id: "operation-create",
      table: "projects",
      action: "create",
      rowId: "project-1",
      base: null,
      row: {
        id: "project-1",
        created_at: "2026-01-01T00:00:00.000Z",
        name: "Offline project",
        address: null,
        total_budget: 100,
        start_date: null,
        end_date: null,
      },
    };

    expect(await repo.applySyncChange("account-1", create)).toEqual({
      applied: true,
      current: null,
    });
    await repo.applySyncChange("account-1", create);
    expect((await repo.getAll()).projects).toHaveLength(1);

    const base = (await repo.getAll()).projects[0] as unknown as Record<string, unknown>;
    await repo.update("projects", "project-1", { name: "Changed online" });
    const edit: SyncChange = {
      id: "operation-edit",
      table: "projects",
      action: "update",
      rowId: "project-1",
      base,
      row: { ...base, name: "Changed offline" },
    };

    const conflict = await repo.applySyncChange("account-1", edit);
    expect(conflict.applied).toBe(false);
    expect(conflict.current?.["name"]).toBe("Changed online");
    expect((await repo.getAll()).projects[0]?.name).toBe("Changed online");

    const rebased = { ...edit, base: conflict.current };
    expect((await repo.applySyncChange("account-1", rebased)).applied).toBe(true);
    expect((await repo.getAll()).projects[0]?.name).toBe("Changed offline");
  });
});
