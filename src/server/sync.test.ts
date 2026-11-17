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
  it("records completion transitions and preserves the offline completion day on later replay", async () => {
    await repo.insert("projects", { id: "completion-project", name: "Diary completion" });
    await repo.insert(
      "tasks",
      { id: "completion-task", title: "Wiring", status: "offen" },
      undefined,
      "completion-project",
    );
    const previous = (await repo.getAll("completion-project")).tasks[0]!;
    const completed = {
      ...previous,
      status: "erledigt",
      completed_at: "2026-11-17T23:30:00.000Z",
      completed_on: "2026-11-18",
    };
    expect(
      await repo.applySyncChange(
        "account-1",
        {
          id: "completion-operation",
          table: "tasks",
          action: "update",
          rowId: previous.id,
          base: { ...previous },
          row: completed,
        },
        "completion-project",
      ),
    ).toMatchObject({ applied: true });
    expect((await repo.getAll("completion-project")).tasks[0]).toMatchObject(completed);
    await repo.update(
      "tasks",
      previous.id,
      { status: "erledigt", title: "Edited" },
      undefined,
      "completion-project",
    );
    expect((await repo.getAll("completion-project")).tasks[0]?.completed_on).toBe("2026-11-18");
    await repo.update("tasks", previous.id, { status: "offen" }, undefined, "completion-project");
    expect((await repo.getAll("completion-project")).tasks[0]?.completed_on).toBeNull();
    await repo.update(
      "tasks",
      previous.id,
      { status: "erledigt" },
      undefined,
      "completion-project",
    );
    expect((await repo.getAll("completion-project")).tasks[0]?.completed_at).toBeTruthy();
    await repo.remove("tasks", previous.id, "completion-project");
    await repo.remove("projects", "completion-project");
  });
  it("validates funding writes and protects sources needed by the funding ledger", async () => {
    await repo.insert("projects", { id: "funding-project", name: "Funding project" });
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
      repo.applySyncChange(
        "account-1",
        {
          id: "invalid-funding-operation",
          table: "funding_entries",
          action: "create",
          rowId: "invalid",
          base: null,
          row: { ...row, amount: -100, project_id: "funding-project" },
        },
        "funding-project",
      ),
    ).rejects.toThrow("funding.invalid_amount");
    expect(
      db.prepare("SELECT id FROM app_sync_operations WHERE id = 'invalid-funding-operation'").get(),
    ).toBeUndefined();
    await repo.update("funding_entries", "funding", { amount: 9000 });
    expect((await repo.getAll()).funding_entries[0]?.amount).toBe(9000);
    await repo.remove("funding_entries", "funding");
    await repo.remove("budget_pots", "grandma");
  });
  it("isolates workspace rows and rejects cross-project references and mutations", async () => {
    await repo.insert("projects", { id: "project-a", name: "Project A" });
    await repo.insert("projects", { id: "project-b", name: "Project B" });
    await repo.insert(
      "trades",
      { id: "trade-a", name: "Roofing", budget: 100 },
      undefined,
      "project-a",
    );
    await repo.insert(
      "trades",
      { id: "trade-b", name: "Electrical", budget: 200 },
      undefined,
      "project-b",
    );
    await repo.insert(
      "cost_items",
      { id: "cost-a", trade_id: "trade-a", title: "Roof", planned: 50 },
      undefined,
      "project-a",
    );

    expect((await repo.getAll("project-a")).trades.map((row) => row.id)).toEqual(["trade-a"]);
    expect((await repo.getAll("project-b")).trades.map((row) => row.id)).toEqual(["trade-b"]);
    await expect(
      repo.insert(
        "cost_items",
        { id: "cross-cost", trade_id: "trade-b", title: "Wrong project", planned: 10 },
        undefined,
        "project-a",
      ),
    ).rejects.toThrow("projects.related_record_not_in_project");
    await expect(
      repo.update("trades", "trade-b", { name: "Moved" }, undefined, "project-a"),
    ).rejects.toThrow("projects.row_not_in_project");
    await expect(repo.remove("trades", "trade-b", "project-a")).rejects.toThrow(
      "projects.row_not_in_project",
    );
    await expect(repo.getAll("missing-project")).rejects.toThrow("projects.not_found");
  });
  it("keeps all diary links within the same project and cleans deleted financial references", async () => {
    await repo.insert("projects", { id: "diary-project-a", name: "Diary A" });
    await repo.insert("projects", { id: "diary-project-b", name: "Diary B" });
    await repo.insert("trades", { id: "diary-trade-a", name: "A" }, undefined, "diary-project-a");
    await repo.insert("trades", { id: "diary-trade-b", name: "B" }, undefined, "diary-project-b");
    await repo.insert("tasks", { id: "diary-task-a", title: "A" }, undefined, "diary-project-a");
    for (const suffix of ["a", "b"]) {
      await repo.insert(
        "offers",
        {
          id: `diary-offer-${suffix}`,
          title: "Quote",
          contractor: "Workshop",
          amount: 2430,
          status: "received",
          offer_date: "2026-06-17",
        },
        undefined,
        `diary-project-${suffix}`,
      );
      await repo.insert(
        "expenses",
        {
          id: `diary-payment-${suffix}`,
          title: "Paid materials",
          amount: 340.5,
          status: "bezahlt",
          bank_status: "nicht_festgelegt",
          payment_date: "2026-06-17",
        },
        undefined,
        `diary-project-${suffix}`,
      );
    }
    await repo.insert(
      "events",
      { id: "diary-event-a", title: "A", event_date: "2026-06-17" },
      undefined,
      "diary-project-a",
    );
    const entry = {
      entry_date: "2026-06-17",
      title: "Daily report",
      task_ids: '["diary-task-a"]',
      event_ids: '["diary-event-a"]',
      trade_ids: '["diary-trade-a"]',
      offer_ids: '["diary-offer-a"]',
      payment_ids: '["diary-payment-a"]',
    };
    await repo.insert(
      "diary_entries",
      { id: "diary-entry-a", ...entry },
      undefined,
      "diary-project-a",
    );
    await expect(
      repo.insert(
        "diary_entries",
        { id: "diary-entry-cross-trade", ...entry, trade_ids: '["diary-trade-b"]' },
        undefined,
        "diary-project-a",
      ),
    ).rejects.toThrow("projects.related_record_not_in_project");
    await expect(
      repo.update(
        "diary_entries",
        "diary-entry-a",
        { event_ids: '["diary-event-b"]' },
        undefined,
        "diary-project-a",
      ),
    ).rejects.toThrow("projects.related_record_not_in_project");
    for (const patch of [
      { offer_ids: '["diary-offer-b"]' },
      { payment_ids: '["diary-payment-b"]' },
    ])
      await expect(
        repo.update("diary_entries", "diary-entry-a", patch, undefined, "diary-project-a"),
      ).rejects.toThrow("projects.related_record_not_in_project");
    await repo.remove("offers", "diary-offer-a", "diary-project-a");
    await repo.remove("expenses", "diary-payment-a", "diary-project-a");
    const updated = (await repo.getAll("diary-project-a")).diary_entries.find(
      (item) => item.id === "diary-entry-a",
    );
    expect(updated).toMatchObject({ offer_ids: "[]", payment_ids: "[]" });
  });
  it("validates paired subtask references and removes deleted subtasks without affecting retained links", async () => {
    const checklist = JSON.stringify([
      { id: "shared", title: "Measure room", done: false },
      { id: "keep", title: "Photograph routes", done: false },
    ]);
    for (const suffix of ["a", "b"]) {
      await repo.insert("projects", { id: `subtasks-${suffix}`, name: suffix });
      await repo.insert(
        "tasks",
        {
          id: `subtask-parent-${suffix}`,
          title: "Open parent",
          status: "offen",
          checklist,
        },
        undefined,
        `subtasks-${suffix}`,
      );
    }
    const links = [
      { task_id: "subtask-parent-a", subtask_id: "shared" },
      { task_id: "subtask-parent-a", subtask_id: "keep" },
    ];
    await repo.insert(
      "diary_entries",
      {
        id: "subtask-report",
        title: "Work report",
        entry_date: "2026-11-17",
        subtask_links: JSON.stringify(links),
      },
      undefined,
      "subtasks-a",
    );
    for (const [link, error] of [
      [
        { task_id: "subtask-parent-b", subtask_id: "shared" },
        "projects.related_record_not_in_project",
      ],
      [{ task_id: "subtask-parent-a", subtask_id: "missing" }, "diary.invalid_links"],
    ] as const) {
      await expect(
        repo.update(
          "diary_entries",
          "subtask-report",
          {
            subtask_links: JSON.stringify([link]),
          },
          undefined,
          "subtasks-a",
        ),
      ).rejects.toThrow(error);
    }
    await repo.update(
      "tasks",
      "subtask-parent-a",
      {
        checklist: JSON.stringify([{ id: "keep", title: "Photograph routes", done: true }]),
      },
      undefined,
      "subtasks-a",
    );
    let workspace = await repo.getAll("subtasks-a");
    expect(JSON.parse(workspace.diary_entries[0]!.subtask_links!)).toEqual([links[1]]);
    expect(JSON.parse(workspace.tasks[0]!.checklist!)[0].completed_on).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    await repo.remove("tasks", "subtask-parent-a", "subtasks-a");
    workspace = await repo.getAll("subtasks-a");
    expect(workspace.diary_entries[0]!.subtask_links).toBe("[]");
  });
  it("accepts queued diary edits from before optional diary link columns existed", async () => {
    await repo.insert("projects", { id: "legacy-diary-project", name: "Legacy diary" });
    await repo.insert(
      "diary_entries",
      {
        id: "legacy-diary-entry",
        title: "Original",
        entry_date: "2026-06-17",
      },
      undefined,
      "legacy-diary-project",
    );
    const base = { ...(await repo.getAll("legacy-diary-project")).diary_entries[0]! };
    delete base.offer_ids;
    delete base.payment_ids;
    delete base.subtask_links;
    const result = await repo.applySyncChange(
      "account-1",
      {
        id: "legacy-diary-edit",
        table: "diary_entries",
        action: "update",
        rowId: "legacy-diary-entry",
        base,
        row: { ...base, title: "Edited offline" },
      },
      "legacy-diary-project",
    );
    expect(result.applied).toBe(true);
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
    expect((await repo.getAll()).projects.some((project) => project.id === "project-1")).toBe(true);

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
  it("migrates queued legacy expenses without changing their accounting source", async () => {
    const projectId = "legacy-expense-project";
    await repo.insert("projects", { id: projectId, name: "Legacy expenses" });
    await repo.insert(
      "budget_pots",
      { id: "legacy-private", name: "Private", deducts_from_budget: true },
      undefined,
      projectId,
    );
    const create: SyncChange = {
      id: "legacy-expense-create",
      table: "expenses",
      action: "create",
      rowId: "legacy-offline",
      base: null,
      row: {
        id: "legacy-offline",
        project_id: projectId,
        title: "Offline receipt",
        amount: 25,
        status: "erstattet",
        budget_pot_id: "legacy-private",
      },
    };
    expect((await repo.applySyncChange("account-1", create, projectId)).applied).toBe(true);
    const created = (await repo.getAll(projectId)).expenses[0]!;
    expect(created).toMatchObject({
      status: "bezahlt",
      bank_status: "ausgezahlt",
      budget_pot_id: "legacy-private",
    });

    await repo.insert(
      "expenses",
      {
        id: "legacy-existing",
        title: "Original",
        amount: 50,
        status: "offen",
        budget_pot_id: "legacy-private",
      },
      undefined,
      projectId,
    );
    const existing = (await repo.getAll(projectId)).expenses.find(
      (row) => row.id === "legacy-existing",
    )!;
    const { bank_status: _bankStatus, document_links: _documentLinks, ...base } = existing;
    const edit: SyncChange = {
      id: "legacy-expense-edit",
      table: "expenses",
      action: "update",
      rowId: existing.id,
      base,
      row: { ...base, title: "Offline edit", status: "abgelehnt" },
    };
    expect((await repo.applySyncChange("account-1", edit, projectId)).applied).toBe(true);
    expect(
      (await repo.getAll(projectId)).expenses.find((row) => row.id === existing.id),
    ).toMatchObject({
      title: "Offline edit",
      status: "bezahlt",
      bank_status: "abgelehnt",
      budget_pot_id: "legacy-private",
    });

    await repo.update("expenses", existing.id, { title: "Online edit" }, undefined, projectId);
    const conflict = await repo.applySyncChange(
      "account-1",
      { ...edit, id: "legacy-expense-conflict" },
      projectId,
    );
    expect(conflict).toMatchObject({ applied: false, current: { title: "Online edit" } });
    expect(
      (
        await repo.applySyncChange(
          "account-1",
          { ...edit, id: "legacy-expense-rebased", base: conflict.current },
          projectId,
        )
      ).applied,
    ).toBe(true);
    expect(
      (await repo.getAll(projectId)).expenses.find((row) => row.id === existing.id),
    ).toMatchObject({
      title: "Offline edit",
      status: "bezahlt",
      bank_status: "abgelehnt",
      budget_pot_id: "legacy-private",
    });
  });
});
