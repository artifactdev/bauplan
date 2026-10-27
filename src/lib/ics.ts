// Builds an iCalendar (.ics) feed from calendar entries and tasks with a due date.
import type { CalEvent, Offer, Task } from "./schema";
import { offerDeadlines } from "./offer-deadlines";
import { taskRange } from "./tasks";

const KIND: Record<string, string> = { termin: "Termin", frist: "Frist", arbeit: "Arbeiten" };

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const d8 = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const hm = (t: string) => t.slice(0, 5).replace(":", "") + "00";
const nextDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** Fold lines longer than 75 octets-ish (characters is good enough here). */
const fold = (l: string) => (l.length <= 74 ? l : l.match(/.{1,74}/g)!.join("\r\n "));

export function eventLines(
  e: Pick<
    CalEvent,
    "id" | "title" | "event_date" | "end_date" | "start_time" | "end_time" | "kind" | "notes"
  >,
  stamp: string,
): string[] {
  const end = e.end_date && e.end_date > e.event_date ? e.end_date : e.event_date;
  const out = [
    "BEGIN:VEVENT",
    `UID:${e.id}@bauplan`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${esc(e.title)}`,
  ];
  if (e.start_time) {
    out.push(`DTSTART:${d8(e.event_date)}T${hm(e.start_time)}`);
    // Without an end time a timed entry lasts one hour.
    const et =
      e.end_time ??
      `${String((Number(e.start_time.slice(0, 2)) + 1) % 24).padStart(2, "0")}:${e.start_time.slice(3, 5)}`;
    const endDate = !e.end_time && Number(e.start_time.slice(0, 2)) === 23 ? nextDay(end) : end;
    out.push(`DTEND:${d8(endDate)}T${hm(et)}`);
  } else {
    // All-day: DTEND is exclusive, so the day after the last day.
    out.push(`DTSTART;VALUE=DATE:${d8(e.event_date)}`, `DTEND;VALUE=DATE:${d8(nextDay(end))}`);
  }
  out.push(`CATEGORIES:${KIND[e.kind] ?? "Termin"}`);
  if (e.notes) out.push(`DESCRIPTION:${esc(e.notes)}`);
  out.push("END:VEVENT");
  return out;
}

export function buildIcs(
  events: CalEvent[],
  tasks: Task[],
  name: string,
  now = new Date(),
  offers: Offer[] = [],
): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bauplan//Kalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const e of [...events, ...offerDeadlines(offers)]) lines.push(...eventLines(e, stamp));
  for (const t of tasks) {
    const range = taskRange(t);
    if (!range || t.status === "erledigt") continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@bauplan`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${esc(`Aufgabe: ${t.title}`)}`,
      `DTSTART;VALUE=DATE:${d8(range.event_date)}`,
      `DTEND;VALUE=DATE:${d8(nextDay(range.end_date))}`,
      "CATEGORIES:Aufgabe",
    );
    if (t.notes) lines.push(`DESCRIPTION:${esc(t.notes)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
