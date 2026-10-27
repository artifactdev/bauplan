import { describe, expect, it } from "vitest";
import { coversDay } from "./events";
import { taskRange, validateTaskDates } from "./tasks";

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
