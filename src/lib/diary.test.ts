import { describe, expect, it } from "vitest";
import {
  groupDiaryEntries,
  nearestDiaryEntry,
  parseDiaryIds,
  parseDiaryWeather,
  serializeDiaryIds,
  validateDiaryEntry,
} from "./diary";
import type { DiaryEntry } from "./schema";

describe("construction diary validation", () => {
  it("normalizes linked IDs and rejects duplicates", () => {
    expect(serializeDiaryIds([" task-a ", "task-b"])).toBe('["task-a","task-b"]');
    expect(() => parseDiaryIds('["task-a","task-a"]')).toThrow("diary.invalid_links");
    expect(() => parseDiaryIds(Array.from({ length: 101 }, (_, index) => `task-${index}`))).toThrow(
      "diary.too_many_links",
    );
  });

  describe("diary time navigation", () => {
    const entries: DiaryEntry[] = ["2026-11-17", "2026-11-13", "2024-02-29"].map((entry_date) => ({
      id: entry_date,
      title: entry_date,
      entry_date,
      task_ids: null,
      event_ids: null,
      trade_ids: null,
      weather_snapshot: null,
      work_done: null,
      progress: null,
      issues: null,
    }));
    it("indexes report months across years without inventing empty periods", () => {
      expect(
        groupDiaryEntries(entries).map(({ month, entries: reports }) => [month, reports.length]),
      ).toEqual([
        ["2026-11", 2],
        ["2024-02", 1],
      ]);
    });
    it("finds the nearest report, prefers the newer report on ties and handles archive boundaries", () => {
      expect(nearestDiaryEntry(entries, "2026-11-17")?.id).toBe("2026-11-17");
      expect(nearestDiaryEntry(entries, "2026-11-15")?.id).toBe("2026-11-17");
      expect(nearestDiaryEntry(entries, "2026-11-14")?.id).toBe("2026-11-13");
      expect(nearestDiaryEntry(entries, "2020-01-01")?.id).toBe("2024-02-29");
      expect(nearestDiaryEntry(entries, "2030-01-01")?.id).toBe("2026-11-17");
      expect(nearestDiaryEntry([], "2026-11-17")).toBeUndefined();
      expect(() => nearestDiaryEntry(entries, "2026-02-30")).toThrow("diary.invalid_date");
    });
  });

  it("validates weather snapshots against the entry date", () => {
    const snapshot = {
      date: "2026-06-17",
      code: 3,
      temperatureMax: 20,
      temperatureMin: 11,
      precipitation: 0,
      latitude: 48,
      longitude: 8,
      fetchedAt: "2026-06-17T10:00:00.000Z",
      source: "archive",
    };
    expect(parseDiaryWeather(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(() =>
      validateDiaryEntry({
        entry_date: "2026-06-18",
        title: "Work report",
        weather_snapshot: JSON.stringify(snapshot),
      }),
    ).toThrow("diary.invalid_weather");
  });
});
