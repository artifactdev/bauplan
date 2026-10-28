import { addDays, format, startOfMonth, startOfWeek } from "date-fns";

export type CalendarView = "day" | "week" | "month" | "year" | "agenda";
export type CalendarItem = {
  id: string;
  title: string;
  date: string;
  end: string;
  label: string;
  start_time: string | null;
  end_time?: string | null;
  kind: "termin" | "frist" | "arbeit" | "aufgabe";
  trade_id: string | null;
  tradeLabel?: string | null;
  source: { type: "event" | "task" | "offer"; id: string };
  done?: boolean;
  deadline?: string | null;
};

export const dateKey = (date: Date) => format(date, "yyyy-MM-dd");
export const localDate = (date: string) => new Date(`${date}T12:00:00`);
export function lastDay(item: CalendarItem) {
  if (!item.start_time) return item.end;
  const end = timedEnd(item, item.start_time);
  return end.minute === 0 ? dateKey(addDays(localDate(end.date), -1)) : end.date;
}

export const isMultiDay = (item: CalendarItem) => lastDay(item) > item.date;

/** Place continuous date ranges in non-overlapping rows, clipped to the visible days. */
export function rangeLayout(items: CalendarItem[], days: string[]) {
  const segments = items
    .flatMap((item) => {
      const start = days.findIndex((day) => onDay(item, day));
      if (start < 0) return [];
      let end = start;
      while (end + 1 < days.length && onDay(item, days[end + 1]!)) end++;
      return [
        {
          item,
          start,
          end,
          row: 0,
          continuesBefore: item.date < days[start]!,
          continuesAfter: lastDay(item) > days[end]!,
        },
      ];
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.item.date.localeCompare(b.item.date));
  const ends: number[] = [];
  for (const segment of segments) {
    let row = ends.findIndex((end) => end < segment.start);
    if (row < 0) row = ends.length;
    segment.row = row;
    ends[row] = segment.end;
  }
  return segments;
}

export function onDay(item: CalendarItem, day: string) {
  if (!item.start_time) return item.date <= day && item.end >= day;
  const end = timedEnd(item, item.start_time);
  return item.date <= day && (day < end.date || (day === end.date && end.minute > 0));
}

export function monthDays(date: Date) {
  const first = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function timedEnd(item: CalendarItem, startTime: string) {
  const end = item.end_time ? minutes(item.end_time) : minutes(startTime) + 60;
  return {
    date: dateKey(addDays(localDate(item.end), Math.floor(end / 1440))),
    minute: end % 1440,
  };
}

/** Split timed entries into day segments and allocate stable columns for overlaps. */
export function timedLayout(items: CalendarItem[], day: string) {
  const segments = items
    .flatMap((item) => {
      if (!item.start_time || !onDay(item, day)) return [];
      const last = timedEnd(item, item.start_time);
      const start = item.date === day ? minutes(item.start_time) : 0;
      const end = last.date === day ? last.minute : 1440;
      if (end <= start) return [];
      // Short appointments still need separate lanes when their visible touch targets overlap.
      const layoutEnd = Math.min(1440, Math.max(start + 10, end));
      return [{ item, start, end, layoutEnd, column: 0, columns: 1 }];
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof segments = [];
  let groupEnd = -1;
  let ends: number[] = [];
  const finish = () =>
    group.forEach((entry) => {
      entry.columns = ends.length;
    });
  for (const segment of segments) {
    if (segment.start >= groupEnd) {
      finish();
      group = [];
      ends = [];
      groupEnd = -1;
    }
    let column = ends.findIndex((end) => end <= segment.start);
    if (column < 0) column = ends.length;
    segment.column = column;
    ends[column] = segment.layoutEnd;
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.layoutEnd);
  }
  finish();
  return segments;
}
