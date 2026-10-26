import { describe, expect, it } from "vitest";
import { coversDay, rangeError } from "./events";

describe("calendar ranges", () => {
  it("without end date the entry is on one day only", () => {
    const e = { event_date: "2026-11-02" };
    expect(coversDay(e, "2026-11-02")).toBe(true);
    expect(coversDay(e, "2026-11-03")).toBe(false);
  });
  it("multi-day entry shows on every day up to the end date", () => {
    const e = { event_date: "2026-11-02", end_date: "2026-11-04" };
    expect(coversDay(e, "2026-11-03")).toBe(true);
    expect(coversDay(e, "2026-11-04")).toBe(true);
    expect(coversDay(e, "2026-11-05")).toBe(false);
  });
  it("end before start is rejected", () => {
    expect(rangeError({ event_date: "2026-11-04", end_date: "2026-11-02" })).not.toBeNull();
    expect(rangeError({ event_date: "2026-11-04", start_time: "10:00", end_time: "09:00" })).not.toBeNull();
    expect(rangeError({ event_date: "2026-11-04", end_date: "2026-11-05", start_time: "10:00", end_time: "09:00" })).toBeNull();
  });
});
