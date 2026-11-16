// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo } from "./repo";
import { incomingDependencies } from "@/lib/task-dependencies";
import { calendarEtag } from "./caldav-calendar";

const dir = mkdtempSync(join(tmpdir(), "bauplan-dependencies-"));
const previous = process.env["DATA_DIR"];
let repo: Repo;
beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  const module = await import("./repo");
  repo = module.sqliteRepo();
  await repo.insert("projects", { id: "p", name: "Test" });
});
afterAll(() => {
  if (previous === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previous;
  rmSync(dir, { recursive: true, force: true });
});
const deps = (source: "task" | "event", id: string) =>
  JSON.stringify([{ source, id, lag_days: 2 }]);
const createTask = (id: string, dependencies?: string) =>
  repo.insert(
    "tasks",
    {
      id,
      title: id,
      priority: "mittel",
      status: "offen",
      dependencies: dependencies ?? null,
    },
    undefined,
    "p",
  );

describe("persisted construction prerequisites", () => {
  it("replays legacy task snapshots lacking the new nullable dependency column", async () => {
    await createTask("legacy");
    const row = (await repo.getAll("p")).tasks.find((task) => task.id === "legacy")!;
    const { dependencies: _dependencies, ...base } = row;
    const result = await repo.applySyncChange(
      "u",
      {
        id: "legacy-sync",
        table: "tasks",
        action: "update",
        rowId: row.id,
        base,
        row: { ...base, title: "Updated legacy task" },
      },
      "p",
    );
    expect(result.applied).toBe(true);
    expect((await repo.getAll("p")).tasks.find((task) => task.id === "legacy")?.title).toBe(
      "Updated legacy task",
    );
  });
  it("validates sources and cycles on create/update and preserves completion", async () => {
    await repo.insert(
      "events",
      {
        id: "work",
        title: "Electrical",
        kind: "arbeit",
        event_date: "2026-11-16",
        work_completed: true,
      },
      undefined,
      "p",
    );
    await createTask("a", deps("event", "work"));
    await createTask("b", deps("task", "a"));
    await expect(
      repo.update("tasks", "a", { dependencies: deps("task", "b") }, undefined, "p"),
    ).rejects.toThrow("dependencies.cycle");
    await expect(createTask("missing", deps("task", "missing-source"))).rejects.toThrow(
      "dependencies.unavailable",
    );
    await expect(repo.update("events", "work", { kind: "termin" }, undefined, "p")).rejects.toThrow(
      "dependencies.kind_in_use",
    );
    const ws = await repo.getAll("p");
    expect(ws.events.find((event) => event.id === "work")?.work_completed).toBe(true);
    expect(ws.tasks.find((task) => task.id === "a")?.dependencies).toBe(deps("event", "work"));
  });
  it("guards CalDAV deletion and preserves app metadata on external edit", async () => {
    const current = (await repo.getAll("p")).events.find((event) => event.id === "work")!;
    await expect(
      repo.writeCalendarEvent("work", null, { match: null, noneMatch: null }, "p"),
    ).rejects.toThrow("prerequisite");
    await repo.writeCalendarEvent(
      "work",
      {
        ...current,
        title: "Updated externally",
        kind: "termin",
        work_completed: false,
        caldav_uid: "work@bauplan",
      },
      { match: calendarEtag(current), noneMatch: null },
      "p",
    );
    expect((await repo.getAll("p")).events.find((event) => event.id === "work")).toMatchObject({
      kind: "arbeit",
      work_completed: true,
      title: "Updated externally",
    });
  });
  it("requires current consent and removes incoming links atomically", async () => {
    await expect(repo.remove("events", "work", "p")).rejects.toThrow("dependencies.consent");
    const consent = incomingDependencies((await repo.getAll("p")).tasks, {
      source: "event",
      id: "work",
    });
    await createTask("c", deps("event", "work"));
    await expect(repo.remove("events", "work", "p", consent)).rejects.toThrow(
      "dependencies.changed",
    );
    const ws = await repo.getAll("p");
    await repo.remove(
      "events",
      "work",
      "p",
      incomingDependencies(ws.tasks, { source: "event", id: "work" }),
    );
    const next = await repo.getAll("p");
    expect(next.events.find((event) => event.id === "work")).toBeUndefined();
    expect(next.tasks.find((task) => task.id === "a")?.dependencies).toBe("[]");
    expect(next.tasks.find((task) => task.id === "b")?.dependencies).toBe(deps("task", "a"));
  });
  it("retains stale offline deletion as a conflict instead of removing new links", async () => {
    const base = (await repo.getAll("p")).tasks.find((task) => task.id === "c")!;
    await createTask("d", deps("task", "c"));
    const result = await repo.applySyncChange(
      "u",
      {
        id: "sync-delete-c",
        table: "tasks",
        action: "delete",
        rowId: "c",
        base,
        row: null,
        dependencyConsent: [],
      },
      "p",
    );
    expect(result.applied).toBe(false);
    expect((await repo.getAll("p")).tasks.some((task) => task.id === "c")).toBe(true);
  });
  it("rejects invalid restored dependency graphs before touching live data", async () => {
    const { database } = await repo.exportBackup();
    database.tables.tasks.push({
      id: "bad",
      project_id: "p",
      dependencies: deps("event", "absent"),
    });
    await expect(repo.restoreBackup(database, [])).rejects.toThrow("dependencies.unavailable");
    expect((await repo.getAll("p")).tasks.some((task) => task.id === "d")).toBe(true);
  });
});
