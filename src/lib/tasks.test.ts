import { describe, expect, it } from "vitest";
import { coversDay } from "./events";
import { parseTaskChecklist, taskCompletionPatch, taskRange, validateTaskDates } from "./tasks";
import { cleanRow } from "./schema";

describe("task completion history", () => {
  const now = new Date("2026-11-17T23:30:00.000Z");
  it("records completion, preserves the original day on edits and clears it on reopening", () => {
    const completed = taskCompletionPatch(
      { status: "erledigt", completed_at: null, completed_on: null },
      { status: "offen" },
      now,
    );
    expect(completed["completed_at"]).toBe(now.toISOString());
    expect(completed["completed_on"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      taskCompletionPatch(
        { status: "erledigt", title: "Edited" },
        completed,
        new Date("2026-12-01"),
      ),
    ).toMatchObject(completed);
    expect(taskCompletionPatch({ status: "offen" }, completed)).toMatchObject({
      completed_at: null,
      completed_on: null,
    });
    expect(
      taskCompletionPatch(
        { status: "erledigt" },
        { status: "offen" },
        new Date("2026-12-01T10:00:00Z"),
      )["completed_at"],
    ).toBe("2026-12-01T10:00:00.000Z");
  });
  it("retains the local offline day across time zones and does not invent legacy dates", () => {
    const local = {
      status: "erledigt",
      completed_at: now.toISOString(),
      completed_on: "2026-11-18",
    };
    expect(taskCompletionPatch(local, { status: "offen" }, new Date("2026-11-25"))).toEqual(local);
    expect(taskCompletionPatch({ status: "erledigt" }, { status: "erledigt" }, now)).toEqual({
      status: "erledigt",
      completed_at: null,
      completed_on: null,
    });
    expect(
      taskCompletionPatch(
        { status: "erledigt", completed_at: null, completed_on: null },
        undefined,
        now,
        true,
      )["completed_on"],
    ).toBeNull();
    expect(() => taskCompletionPatch({ status: "erledigt", completed_on: "2026-02-30" })).toThrow(
      "tasks.invalid_completion_date",
    );
  });
});

describe("task checklists", () => {
  it("supports older tasks with no checklist and normalizes new lists", () => {
    for (const value of [undefined, null, ""]) expect(parseTaskChecklist(value)).toEqual([]);
    const checklist = JSON.stringify([{ id: "one", title: "  Measure room  ", done: false }]);
    expect(cleanRow("tasks", { checklist })).toEqual({
      checklist: JSON.stringify([{ id: "one", title: "Measure room", done: false }]),
    });
  });
  it("rejects malformed entries and duplicate identities", () => {
    for (const value of [
      "invalid",
      "{}",
      JSON.stringify([{ id: "one", title: " ", done: false }]),
      JSON.stringify([{ id: "one", title: "Step", done: "false" }]),
      JSON.stringify([
        { id: "one", title: "Step", done: false },
        { id: "one", title: "Other", done: true },
      ]),
    ])
      expect(() => parseTaskChecklist(value)).toThrow("task-checklist.invalid");
  });
});

describe("task dates", () => {
  it("covers every day from start through due date inclusively", () => {
    const range = taskRange({ start_date: "2026-10-28", due_date: "2026-11-02" });
    expect(range).toEqual({ event_date: "2026-10-28", end_date: "2026-11-02" });
    for (const day of ["2026-10-28", "2026-10-30", "2026-11-02"])
      expect(coversDay(range!, day)).toBe(true);
    for (const day of ["2026-10-27", "2026-11-03"]) expect(coversDay(range!, day)).toBe(false);
  });
  it("keeps due-only tasks on one day and supports start-only and undated tasks", () => {
    expect(taskRange({ due_date: "2026-11-02" })).toEqual({
      event_date: "2026-11-02",
      end_date: "2026-11-02",
    });
    expect(taskRange({ start_date: "2026-11-02", due_date: null })).toEqual({
      event_date: "2026-11-02",
      end_date: "2026-11-02",
    });
    expect(taskRange({ due_date: null })).toBeNull();
  });
  it("rejects reversed and invalid dates, allowing empty dates and same-day tasks", () => {
    expect(() => validateTaskDates({ start_date: "2026-11-02", due_date: "2026-11-01" })).toThrow(
      "tasks.due_before_start",
    );
    for (const date of ["bad", "2026-02-30", "2026-13-01", 123])
      expect(() => validateTaskDates({ start_date: date })).toThrow("tasks.invalid_date");
    for (const row of [
      {},
      { start_date: null, due_date: "" },
      { start_date: "2026-11-02", due_date: "2026-11-02" },
    ])
      expect(() => validateTaskDates(row)).not.toThrow();
  });
});
