import ICAL from "ical.js";
import { createHash } from "node:crypto";
import type { CalEvent } from "@/lib/schema";

export class DavError extends Error {
  constructor(
    public status: number,
    message: string,
    public condition = "",
  ) {
    super(message);
  }
}

export function calendarTimezone() {
  const zone = process.env["CALDAV_TIMEZONE"] || "Europe/Berlin";
  // Fail explicitly for an invalid deployment setting.
  new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  return zone;
}

const pad = (n: number) => String(n).padStart(2, "0");

function localParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

/** Resolve a wall-clock value without depending on the host's local timezone. */
function wallInstant(wall: string, zone: string) {
  const target = Date.parse(`${wall}Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wall)
    throw new DavError(403, "Invalid calendar date or time.", "valid-calendar-data");
  // Sample both sides of a DST transition; ambiguous times use the first occurrence (RFC 5545).
  const candidates = [-864e5, 0, 864e5]
    .map((delta) => {
      const sample = target + delta;
      const offset = Date.parse(`${localParts(new Date(sample), zone)}Z`) - sample;
      return target - offset;
    })
    .filter((candidate) => localParts(new Date(candidate), zone) === wall);
  if (candidates.length) return new Date(Math.min(...candidates));
  throw new DavError(403, "The local time does not exist in this timezone.", "valid-calendar-data");
}

function readCalendar(text: string) {
  try {
    const root = new ICAL.Component(ICAL.parse(text));
    if (root.name !== "vcalendar" || root.getAllSubcomponents("vevent").length !== 1)
      throw new Error("Expected one VEVENT.");
    if (root.getAllSubcomponents().some((c) => !["vevent", "vtimezone"].includes(c.name)))
      throw new Error("Only events and timezone definitions are supported.");
    return root;
  } catch (error) {
    throw new DavError(
      403,
      `Invalid iCalendar: ${error instanceof Error ? error.message : "parse error"}`,
      "valid-calendar-data",
    );
  }
}

type EventTime = { date: string; time: string | null; instant: number };

function eventTime(root: ICAL.Component, event: ICAL.Component, name: string): EventTime {
  const property = event.getFirstProperty(name);
  const raw: unknown = property?.toJSON()[3];
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z?)?$/.test(raw))
    throw new DavError(403, `Missing or invalid ${name}.`, "valid-calendar-data");
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(/Z$/, "");
  const date = new Date(`${normalized}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== normalized)
    throw new DavError(403, `Invalid ${name}.`, "valid-calendar-data");
  const value = property?.getFirstValue();
  if (!(value instanceof ICAL.Time))
    throw new DavError(403, `Missing or invalid ${name}.`, "valid-calendar-data");
  const wall = value.toString();
  if (value.isDate) return { date: wall, time: null, instant: Date.parse(`${wall}T00:00:00Z`) };
  const tzid = property?.getParameter("tzid");
  let instant: Date;
  if (value.zone === ICAL.Timezone.utcTimezone) {
    instant = value.toJSDate();
  } else if (typeof tzid === "string") {
    const definition = root
      .getAllSubcomponents("vtimezone")
      .find((c) => c.getFirstPropertyValue("tzid") === tzid);
    if (definition) {
      const time = value.clone();
      time.zone = new ICAL.Timezone({ component: definition, tzid });
      instant = time.toJSDate();
    } else {
      try {
        instant = wallInstant(wall, tzid);
      } catch (error) {
        if (error instanceof DavError) throw error;
        throw new DavError(403, "Unknown timezone; include VTIMEZONE.", "valid-calendar-data");
      }
    }
  } else {
    instant = wallInstant(wall, calendarTimezone());
  }
  const local = localParts(instant, calendarTimezone());
  return { date: local.slice(0, 10), time: local.slice(11, 16), instant: instant.getTime() };
}

const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

function parseEvent(text: string): Omit<CalEvent, "id"> {
  const root = readCalendar(text);
  const event = root.getFirstSubcomponent("vevent")!;
  for (const name of ["uid", "summary", "dtstart", "dtend", "duration"]) {
    if (event.getAllProperties(name).length > 1)
      throw new DavError(403, `Duplicate ${name}.`, "valid-calendar-data");
  }
  if (["rrule", "rdate", "exdate", "recurrence-id"].some((key) => event.hasProperty(key)))
    throw new DavError(
      403,
      "Recurring appointments are not supported. Save a single appointment.",
      "valid-calendar-data",
    );
  const uid = event.getFirstPropertyValue("uid");
  const title = event.getFirstPropertyValue("summary");
  if (
    typeof uid !== "string" ||
    !uid ||
    uid.length > 1024 ||
    typeof title !== "string" ||
    !title.trim()
  )
    throw new DavError(403, "UID and a non-empty SUMMARY are required.", "valid-calendar-data");
  const start = eventTime(root, event, "dtstart");
  const explicitEnd = event.hasProperty("dtend") ? eventTime(root, event, "dtend") : null;
  const duration = event.getFirstPropertyValue("duration");
  if (duration && explicitEnd)
    throw new DavError(403, "DTEND and DURATION are mutually exclusive.", "valid-calendar-data");
  const end: EventTime =
    explicitEnd ??
    (() => {
      const seconds =
        duration instanceof ICAL.Duration ? duration.toSeconds() : start.time ? 3600 : 86400;
      if (!start.time && seconds % 86400 !== 0)
        throw new DavError(
          403,
          "All-day durations must contain whole days.",
          "valid-calendar-data",
        );
      const instant = start.instant + seconds * 1000;
      const local = start.time
        ? localParts(new Date(instant), calendarTimezone())
        : new Date(instant).toISOString();
      return { date: local.slice(0, 10), time: start.time ? local.slice(11, 16) : null, instant };
    })();
  if ((start.time === null) !== (end.time === null) || end.instant <= start.instant)
    throw new DavError(
      403,
      "The end must be after the start with the same value type.",
      "valid-calendar-data",
    );
  return {
    title,
    event_date: start.date,
    start_time: start.time,
    end_date: start.time ? end.date : shiftDay(end.date, -1),
    end_time: end.time,
    notes: String(event.getFirstPropertyValue("description") ?? "") || null,
    kind: "termin",
    trade_id: null,
    caldav_uid: uid,
    caldav_data: root.toString(),
  };
}

export function parseCalendarEvent(text: string): Omit<CalEvent, "id"> {
  try {
    return parseEvent(text);
  } catch (error) {
    if (error instanceof DavError) throw error;
    // ICAL hydrates property values lazily, so malformed values can throw after parsing.
    throw new DavError(
      403,
      `Invalid iCalendar property: ${error instanceof Error ? error.message : "parse error"}`,
      "valid-calendar-data",
    );
  }
}

function setTime(event: ICAL.Component, key: string, date: string, time: string | null) {
  event.removeAllProperties(key);
  const value = time
    ? ICAL.Time.fromJSDate(wallInstant(`${date}T${time.slice(0, 5)}:00`, calendarTimezone()), true)
    : ICAL.Time.fromDateString(date);
  event.addPropertyWithValue(key, value);
}

/** Keep client-only properties (e.g. location and alarms) when the web app edits an event. */
export function calendarObject(row: CalEvent) {
  const root = row.caldav_data ? readCalendar(row.caldav_data) : new ICAL.Component("vcalendar");
  root.updatePropertyWithValue("version", "2.0");
  root.updatePropertyWithValue("prodid", "-//Bauplan//CalDAV//EN");
  root.removeAllProperties("method");
  let event = root.getFirstSubcomponent("vevent");
  if (!event) {
    event = new ICAL.Component("vevent");
    root.addSubcomponent(event);
    event.addPropertyWithValue(
      "dtstamp",
      ICAL.Time.fromJSDate(new Date(row.created_at || "2026-01-01T00:00:00Z"), true),
    );
  }
  event.updatePropertyWithValue("uid", row.caldav_uid || `${row.id}@bauplan`);
  event.updatePropertyWithValue("summary", row.title);
  if (row.notes) event.updatePropertyWithValue("description", row.notes);
  else event.removeAllProperties("description");
  const old = row.caldav_data ? parseCalendarEvent(row.caldav_data) : null;
  if (
    !old ||
    old.event_date !== row.event_date ||
    old.start_time !== row.start_time ||
    (old.end_date || old.event_date) !== (row.end_date || row.event_date) ||
    old.end_time !== row.end_time
  ) {
    event.removeAllProperties("duration");
    setTime(event, "dtstart", row.event_date, row.start_time);
    let endDate = row.end_date || row.event_date;
    let endTime = row.end_time;
    if (row.start_time && !endTime) {
      const minutes =
        Number(row.start_time.slice(0, 2)) * 60 + Number(row.start_time.slice(3, 5)) + 60;
      endTime = `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
      if (minutes >= 1440) endDate = shiftDay(endDate, 1);
    }
    setTime(
      event,
      "dtend",
      row.start_time ? endDate : shiftDay(endDate, 1),
      row.start_time ? endTime : null,
    );
  }
  return root.toString() + "\r\n";
}

export function contentEtag(text: string) {
  return `"${createHash("sha256").update(text).digest("hex")}"`;
}

export function calendarEtag(row: CalEvent) {
  return contentEtag(calendarObject(row));
}

export function calendarBounds(text: string) {
  const root = readCalendar(text);
  const event = root.getFirstSubcomponent("vevent")!;
  const instant = (name: string) => {
    const time = eventTime(root, event, name);
    return time.time === null
      ? wallInstant(`${time.date}T00:00:00`, calendarTimezone()).getTime()
      : time.instant;
  };
  const start = instant("dtstart");
  if (event.hasProperty("dtend")) return { start, end: instant("dtend") };
  const parsed = parseCalendarEvent(text);
  if (parsed.start_time) {
    const duration = event.getFirstPropertyValue("duration");
    const seconds = duration instanceof ICAL.Duration ? duration.toSeconds() : 3600;
    return { start, end: start + seconds * 1000 };
  }
  const endDate = shiftDay(parsed.end_date!, 1);
  return {
    start,
    end: wallInstant(`${endDate}T${parsed.end_time || "00:00"}:00`, calendarTimezone()).getTime(),
  };
}

export type DavConditions = { match: string | null; noneMatch: string | null };

export function checkConditions(etag: string | null, conditions: DavConditions) {
  const includes = (header: string, value: string) =>
    header.split(",").some((part) => part.trim() === value);
  if (
    conditions.match &&
    (!etag || !(conditions.match === "*" || includes(conditions.match, etag)))
  )
    throw new DavError(412, "The appointment changed. Refresh before saving.");
  if (
    conditions.noneMatch &&
    etag &&
    (conditions.noneMatch === "*" || includes(conditions.noneMatch, etag))
  )
    throw new DavError(412, "The resource already exists.");
}
