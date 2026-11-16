import { describe, expect, it } from "vitest";
import {
  incomingDependencies,
  parseDependencies,
  prerequisiteState,
  validateDependencyGraph,
  withoutDependency,
} from "./task-dependencies";
import type { CalEvent, Task } from "./schema";

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  project_id: "p",
  title: id,
  status: "offen",
  priority: "mittel",
  assignee_id: null,
  trade_id: null,
  phase: null,
  due_date: "2026-11-20",
  start_date: "2026-11-16",
  cost_item_id: null,
  document_id: null,
  notes: null,
  ...patch,
});
const event = (patch: Partial<CalEvent> = {}): CalEvent => ({
  id: "work",
  project_id: "p",
  title: "Electrical work",
  kind: "arbeit",
  event_date: "2026-11-16",
  end_date: "2026-11-18",
  start_time: null,
  end_time: null,
  trade_id: null,
  notes: null,
  ...patch,
});
const link = (source: "task" | "event", id: string, lag_days = 0) => ({ source, id, lag_days });

describe("task prerequisites", () => {
  it("accepts missing legacy values and distinguishes task and event IDs", () => {
    expect(parseDependencies(undefined)).toEqual([]);
    const links = [link("task", "same"), link("event", "same")];
    expect(parseDependencies(JSON.stringify(links))).toEqual(links);
    expect(() => parseDependencies(JSON.stringify([links[0], links[0]]))).toThrow(
      "dependencies.invalid",
    );
    expect(() => parseDependencies(JSON.stringify([link("task", "a", -1)]))).toThrow(
      "dependencies.invalid",
    );
    expect(() => parseDependencies(JSON.stringify([link("task", "a", 1.5)]))).toThrow(
      "dependencies.invalid",
    );
  });
  it("rejects transitive cycles, unavailable sources and non-work events", () => {
    const a = task("a", { dependencies: JSON.stringify([link("task", "b")]) });
    const b = task("b", { dependencies: JSON.stringify([link("task", "a")]) });
    expect(() => validateDependencyGraph([a, b], [])).toThrow("dependencies.cycle");
    expect(() => validateDependencyGraph([a], [])).toThrow("dependencies.unavailable");
    const withWork = task("a", { dependencies: JSON.stringify([link("event", "work")]) });
    expect(() => validateDependencyGraph([withWork], [event({ kind: "termin" })])).toThrow(
      "dependencies.unavailable",
    );
    expect(() => validateDependencyGraph([withWork], [event({ project_id: "other" })])).toThrow(
      "dependencies.unavailable",
    );
    expect(() => validateDependencyGraph([withWork], [event()])).not.toThrow();
  });
  it("applies inclusive task ends and calendar-day waiting periods", () => {
    const predecessor = task("a", { due_date: "2026-11-20", status: "erledigt" });
    const successor = task("b", { start_date: "2026-11-23" });
    const state = prerequisiteState(
      successor,
      link("task", "a", 2),
      [predecessor],
      [],
      "2026-11-16",
    );
    expect(state).toMatchObject({ earliest: "2026-11-23", issue: null, done: true });
    expect(
      prerequisiteState(
        task("b", { start_date: "2026-11-22" }),
        link("task", "a", 2),
        [predecessor],
        [],
        "2026-11-16",
      ).issue,
    ).toBe("early");
  });
  it("never treats elapsed work dates as completion and distinguishes missing dates", () => {
    const successor = task("b", { start_date: "2026-11-19" });
    const state = prerequisiteState(successor, link("event", "work"), [], [event()], "2026-11-21");
    expect(state).toMatchObject({ earliest: "2026-11-19", done: false, issue: "unfinished" });
    expect(
      prerequisiteState(
        successor,
        link("event", "work"),
        [],
        [event({ work_completed: true })],
        "2026-11-21",
      ).issue,
    ).toBeNull();
    expect(
      prerequisiteState(
        task("b", { start_date: null }),
        link("event", "work"),
        [],
        [event()],
        "2026-11-21",
      ).issue,
    ).toBe("incomplete");
  });
  it("handles exclusive timed midnight ends without a timezone shift", () => {
    expect(
      prerequisiteState(
        task("b", { start_date: "2026-11-18" }),
        link("event", "work"),
        [],
        [event({ start_time: "08:00", end_time: "00:00", work_completed: true })],
        "2026-11-16",
      ),
    ).toMatchObject({ earliest: "2026-11-18", issue: null });
  });
  it("removes only matching typed links and produces stable deletion consent", () => {
    const links = [link("task", "same"), link("event", "same", 3)];
    const value = JSON.stringify(links);
    const rows = [task("b", { dependencies: value }), task("a", { dependencies: value })];
    expect(incomingDependencies(rows, link("event", "same")).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(parseDependencies(withoutDependency(value, link("event", "same")))).toEqual([links[0]]);
  });
});
