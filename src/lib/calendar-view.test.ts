import { describe, expect, it } from "vitest";
import {
  localDate,
  dateKey,
  monthDays,
  onDay,
  timedLayout,
  rangeLayout,
  isMultiDay,
  type CalendarItem,
} from "./calendar-view";

const item = (id: string, start_time: string, end_time: string): CalendarItem => ({
  id,
  title: id,
  date: "2026-10-28",
  end: "2026-10-28",
  label: id,
  start_time,
  end_time,
  kind: "termin",
  trade_id: null,
  source: { type: "event", id },
});
describe("calendar presentation", () => {
  it("clips continuous bars at week boundaries and keeps overlapping ranges in separate rows", () => {
    const days = Array.from(
      { length: 7 },
      (_, index) => `2026-10-${String(26 + index).padStart(2, "0")}`,
    );
    days[6] = "2026-11-01";
    const ranges = rangeLayout(
      [
        { ...item("long", "", ""), date: "2026-10-25", end: "2026-11-03" },
        { ...item("short", "", ""), date: "2026-10-27", end: "2026-10-29" },
        { ...item("later", "", ""), date: "2026-10-30", end: "2026-10-31" },
      ],
      days,
    );
    expect(
      ranges.map(({ start, end, row, continuesBefore, continuesAfter }) => ({
        start,
        end,
        row,
        continuesBefore,
        continuesAfter,
      })),
    ).toEqual([
      { start: 0, end: 6, row: 0, continuesBefore: true, continuesAfter: true },
      { start: 1, end: 3, row: 1, continuesBefore: false, continuesAfter: false },
      { start: 4, end: 5, row: 1, continuesBefore: false, continuesAfter: false },
    ]);
  });
  it("classifies overnight defaults but not an exclusive midnight boundary as multi-day", () => {
    expect(isMultiDay({ ...item("late", "23:30", ""), end_time: null })).toBe(true);
    const midnight = { ...item("midnight", "23:00", "00:00"), end: "2026-10-29" };
    expect(isMultiDay(midnight)).toBe(false);
    expect(rangeLayout([midnight], ["2026-10-28", "2026-10-29"])[0]).toMatchObject({
      start: 0,
      end: 0,
    });
  });
  it("uses a stable Monday-first six-week month grid across year boundaries", () => {
    const days = monthDays(localDate("2026-01-15"));
    expect(days).toHaveLength(42);
    expect(dateKey(days[0]!)).toBe("2025-12-29");
    expect(dateKey(days[41]!)).toBe("2026-02-08");
  });
  it("keeps all-day ranges inclusive", () => {
    expect(
      onDay({ ...item("a", "", ""), date: "2026-10-27", end: "2026-10-30" }, "2026-10-30"),
    ).toBe(true);
    expect(onDay(item("a", "", ""), "2026-10-29")).toBe(false);
  });
  it("allocates separate lanes for overlaps and resets them for later events", () => {
    const layout = timedLayout(
      [
        item("a", "09:00", "11:00"),
        item("b", "10:00", "12:00"),
        item("c", "10:30", "11:30"),
        item("d", "12:00", "13:00"),
      ],
      "2026-10-28",
    );
    expect(layout.map(({ column, columns }) => [column, columns])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [0, 1],
    ]);
  });
  it("clips multi-day timed events and gives entries without an end time one hour", () => {
    const multi = { ...item("multi", "15:00", "10:30"), end: "2026-10-30" };
    expect(timedLayout([multi], "2026-10-28")[0]).toMatchObject({ start: 900, end: 1440 });
    expect(timedLayout([multi], "2026-10-29")[0]).toMatchObject({ start: 0, end: 1440 });
    expect(timedLayout([multi], "2026-10-30")[0]).toMatchObject({ start: 0, end: 630 });
    expect(
      timedLayout([{ ...item("one", "08:30", ""), end_time: null }], "2026-10-28")[0],
    ).toMatchObject({ start: 510, end: 570 });
  });
  it("uses the original start hour for a multi-day entry's default end time", () => {
    const multi = { ...item("multi", "15:30", ""), end_time: null, end: "2026-10-30" };
    expect(timedLayout([multi], "2026-10-30")[0]).toMatchObject({ start: 0, end: 990 });
  });
  it("rolls a default one-hour appointment over midnight without losing its final segment", () => {
    const late = { ...item("late", "23:30", ""), end_time: null };
    expect(timedLayout([late], "2026-10-28")[0]).toMatchObject({ start: 1410, end: 1440 });
    expect(onDay(late, "2026-10-29")).toBe(true);
    expect(timedLayout([late], "2026-10-29")[0]).toMatchObject({ start: 0, end: 30 });
  });
  it("does not render a phantom segment on an exclusive midnight end date", () => {
    const midnight = { ...item("midnight", "23:00", "00:00"), end: "2026-10-29" };
    expect(onDay(midnight, "2026-10-29")).toBe(false);
    expect(timedLayout([midnight], "2026-10-29")).toEqual([]);
    expect(timedLayout([midnight], "2026-10-28")[0]).toMatchObject({ start: 1380, end: 1440 });
  });
  it("keeps neighboring short appointments' minimum visible heights in separate lanes", () => {
    expect(
      timedLayout([item("a", "09:00", "09:05"), item("b", "09:05", "09:10")], "2026-10-28").map(
        ({ column, columns }) => [column, columns],
      ),
    ).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });
});
