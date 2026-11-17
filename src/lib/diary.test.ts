import { describe, expect, it } from "vitest";
import {
  groupDiaryEntries,
  nearestDiaryEntry,
  parseDiaryIds,
  parseDiaryWeather,
  serializeDiaryIds,
  validateDiaryEntry,
  diaryDaySuggestions,
  filterDiaryEntries,
  parseDiarySubtaskLinks,
  refreshDiarySuggestions,
} from "./diary";
import type { DiaryEntry, Task } from "./schema";

describe("construction diary validation", () => {
  it("suggests independently completed subtasks, retains manual links and searches inherited task context", () => {
    const task: Task = {
      id: "parent",
      title: "Electrical installation",
      status: "offen",
      priority: "mittel",
      assignee_id: null,
      trade_id: "electrical",
      phase: null,
      due_date: null,
      notes: null,
      cost_item_id: null,
      document_id: null,
      checklist: JSON.stringify([
        { id: "today", title: "Measure cable routes", done: true, completed_on: "2026-11-17" },
        { id: "legacy", title: "Legacy completion", done: true },
        { id: "open", title: "Connect outlets", done: false },
      ]),
    };
    const ws = { tasks: [task], offers: [], expenses: [] };
    const suggestions = diaryDaySuggestions(ws, "2026-11-17");
    expect(suggestions.task_ids).toEqual([]);
    expect(suggestions.subtask_links).toEqual([{ task_id: "parent", subtask_id: "today" }]);
    const manual = { task_id: "parent", subtask_id: "legacy" };
    expect(
      refreshDiarySuggestions(
        [...suggestions.subtask_links, manual],
        suggestions.subtask_links,
        [],
      ),
    ).toEqual([manual]);
    expect(refreshDiarySuggestions([manual], [], [{ ...manual }])).toEqual([manual]);
    const entries: DiaryEntry[] = [
      {
        id: "report",
        title: "Daily report",
        entry_date: "2026-11-17",
        task_ids: null,
        subtask_links: JSON.stringify(suggestions.subtask_links),
        event_ids: null,
        trade_ids: null,
        work_done: null,
        progress: null,
        issues: null,
        weather_snapshot: null,
      },
    ];
    const workspace = { ...ws, diary_entries: entries, diary_media: [], events: [], trades: [] };
    for (const search of ["cable routes", "Electrical installation"]) {
      expect(
        filterDiaryEntries(workspace, { search, from: "", to: "", tradeId: "electrical" }),
      ).toEqual(entries);
    }
    expect(
      filterDiaryEntries(workspace, {
        search: "Connect outlets",
        from: "",
        to: "",
        tradeId: "",
      }),
    ).toEqual([]);
  });

  it("validates paired subtask identities without confusing same-ID items from different tasks", () => {
    const links = [
      { task_id: "first", subtask_id: "step" },
      { task_id: "second", subtask_id: "step" },
    ];
    expect(parseDiarySubtaskLinks(JSON.stringify(links))).toEqual(links);
    for (const value of ["bad", [{ task_id: "parent" }], [links[0], links[0]]])
      expect(() => parseDiarySubtaskLinks(value)).toThrow("diary.invalid_links");
    expect(() => parseDiarySubtaskLinks(Array.from({ length: 101 }, () => links[0]))).toThrow(
      "diary.too_many_links",
    );
  });
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
