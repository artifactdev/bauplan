import { describe, expect, it } from "vitest";
import { eventLines } from "./ics";

const base = { id: "e1", title: "Estrich", notes: null, kind: "arbeit" as const, start_time: null, end_time: null, end_date: null };

describe("ics feed", () => {
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
    const l = eventLines({ ...base, event_date: "2026-11-02", start_time: "08:00", end_date: "2026-11-04", end_time: "16:00" }, "X");
    expect(l).toContain("DTEND:20261104T160000");
  });
});
