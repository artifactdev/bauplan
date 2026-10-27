import { describe, expect, it } from "vitest";
import { buildIcs, eventLines } from "./ics";
import type { Task } from "./schema";

const base = {
  id: "e1",
  title: "Estrich",
  notes: null,
  kind: "arbeit" as const,
  start_time: null,
  end_time: null,
  end_date: null,
};

describe("ics feed", () => {
  it("exports task ranges including the due day, and keeps single-date tasks", () => {
    const task: Task = {
      id: "task",
      title: "Work",
      assignee_id: null,
      trade_id: null,
      phase: null,
      priority: "mittel",
      status: "offen",
      start_date: "2026-10-28",
      due_date: "2026-11-02",
      notes: null,
      cost_item_id: null,
      document_id: null,
    };
    const feed = buildIcs([], [task], "Project");
    expect(feed).toContain("DTSTART;VALUE=DATE:20261028");
    expect(feed).toContain("DTEND;VALUE=DATE:20261103");
    expect(buildIcs([], [{ ...task, start_date: null }], "Project")).toContain(
      "DTSTART;VALUE=DATE:20261102",
    );
    expect(buildIcs([], [{ ...task, due_date: null }], "Project")).toContain(
      "DTEND;VALUE=DATE:20261029",
    );
    expect(buildIcs([], [{ ...task, status: "erledigt" }], "Project")).not.toContain(
      "BEGIN:VEVENT",
    );
  });
  it("all-day multi-day entry ends the day after the last day", () => {
    const l = eventLines({ ...base, event_date: "2026-11-02", end_date: "2026-11-04" }, "X");
    expect(l).toContain("DTSTART;VALUE=DATE:20261102");
    expect(l).toContain("DTEND;VALUE=DATE:20261105");
  });

  it("timed entry without end time lasts one hour", () => {
    const l = eventLines({ ...base, event_date: "2026-11-02", start_time: "08:30" }, "X");
    expect(l).toContain("DTSTART:20261102T083000");
    expect(l).toContain("DTEND:20261102T093000");
  });

  it("timed multi-day entry uses end date and end time", () => {
    const l = eventLines(
      {
        ...base,
        event_date: "2026-11-02",
        start_time: "08:00",
        end_date: "2026-11-04",
        end_time: "16:00",
      },
      "X",
    );
    expect(l).toContain("DTEND:20261104T160000");
  });
});
