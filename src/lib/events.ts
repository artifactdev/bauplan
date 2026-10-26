/** Multi-day calendar entries: end date and times are optional. */
export type EventRange = { event_date: string; end_date?: string | null; start_time?: string | null; end_time?: string | null };

export function eventEnd(e: EventRange) {
  return e.end_date && e.end_date > e.event_date ? e.end_date : e.event_date;
}

export function coversDay(e: EventRange, day: string) {
  return day >= e.event_date && day <= eventEnd(e);
}

/** Returns an error message, or null when the range is valid. */
export function rangeError(e: EventRange): string | null {
  if (e.end_date && e.end_date < e.event_date) return "Das Enddatum liegt vor dem Startdatum.";
  const sameDay = !e.end_date || e.end_date === e.event_date;
  if (sameDay && e.start_time && e.end_time && e.end_time < e.start_time) return "Die Endzeit liegt vor der Startzeit.";
  return null;
}

export function rangeLabel(e: EventRange, fmt: (d: string) => string) {
  const s = fmt(e.event_date) + (e.start_time ? ` ${e.start_time}` : "");
  const multi = eventEnd(e) !== e.event_date;
  if (multi) return `${s} – ${fmt(eventEnd(e))}${e.end_time ? ` ${e.end_time}` : ""}`;
  return e.end_time ? `${s}–${e.end_time}` : s;
}
