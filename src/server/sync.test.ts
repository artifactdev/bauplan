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
  it("validates funding writes and protects sources needed by the funding ledger", async () => {
    await repo.insert("budget_pots", { id: "grandma", name: "Oma", deducts_from_budget: true });
    const row = {
      id: "funding",
      budget_pot_id: "grandma",
      amount: 10000,
      received_date: "2026-01-01",
    };
    await repo.insert("funding_entries", row);
    expect((await repo.getAll()).funding_entries[0]).toMatchObject(row);
    await expect(
      repo.insert("funding_entries", { ...row, id: "invalid", amount: -1 }),
    ).rejects.toThrow("funding.invalid_amount");
    await expect(
      repo.insert("funding_entries", { ...row, id: "invalid", received_date: "2026-02-30" }),
    ).rejects.toThrow("funding.invalid_date");
    await expect(
      repo.insert("funding_entries", { ...row, id: "invalid", budget_pot_id: "missing" }),
    ).rejects.toThrow("funding.invalid_source");
    await expect(repo.update("funding_entries", "funding", { amount: 0 })).rejects.toThrow(
      "funding.invalid_amount",
    );
    await expect(repo.update("funding_entries", "gone", { amount: 100 })).rejects.toThrow(
      "funding.not_found",
    );
    await expect(
      repo.update("budget_pots", "grandma", { deducts_from_budget: false }),
    ).rejects.toThrow("funding.source_in_use");
    await expect(repo.remove("budget_pots", "grandma")).rejects.toThrow("funding.source_in_use");
    await expect(
      repo.applySyncChange("account-1", {
        id: "invalid-funding-operation",
        table: "funding_entries",
        action: "create",
        rowId: "invalid",
        base: null,
        row: { ...row, amount: -100 },
      }),
    ).rejects.toThrow("funding.invalid_amount");
    expect(
      db.prepare("SELECT id FROM app_sync_operations WHERE id = 'invalid-funding-operation'").get(),
    ).toBeUndefined();
    await repo.update("funding_entries", "funding", { amount: 9000 });
    expect((await repo.getAll()).funding_entries[0]?.amount).toBe(9000);
    await repo.remove("funding_entries", "funding");
    await repo.remove("budget_pots", "grandma");
  });
  it("rejects obsolete invoice writes explicitly rather than hiding or double-counting them", async () => {
    await expect(repo.insert("invoices", { amount: 100 })).rejects.toThrow(
      "expenses.legacy_invoice_write",
    );
    await expect(repo.update("invoices", "old", { paid: true })).rejects.toThrow(
      "expenses.legacy_invoice_write",
    );
    await expect(repo.remove("invoices", "old")).rejects.toThrow("expenses.legacy_invoice_write");
    await expect(
      repo.applySyncChange("account-1", {
        id: "old-invoice-operation",
        table: "invoices",
        action: "create",
        rowId: "old",
        base: null,
        row: { amount: 100 },
      }),
    ).rejects.toThrow("expenses.legacy_invoice_write");
    expect((await repo.getAll()).invoices).toEqual([]);
    expect(
      db.prepare("SELECT id FROM app_sync_operations WHERE id = 'old-invoice-operation'").get(),
    ).toBeUndefined();
  });
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
