// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import {
  calendarBounds,
  calendarEtag,
  calendarObject,
  parseCalendarEvent,
} from "./caldav-calendar";

const dir = mkdtempSync(join(tmpdir(), "bauplan-caldav-"));
const previousDir = process.env["DATA_DIR"];
const previousZone = process.env["CALDAV_TIMEZONE"];
let handle: (typeof import("./caldav"))["handleCaldav"];
let repo: ReturnType<(typeof import("./repo"))["sqliteRepo"]>;
let auth: typeof import("./local-auth");
const root = "/api/caldav/";
const events = `${root}calendars/events/`;
const deadlines = `${root}calendars/deadlines/`;
const password = "Kalender-Pässwort";
const basic = (email = "member@example.test", pw = password) =>
  `Basic ${Buffer.from(`${email}:${pw}`).toString("base64")}`;
const calendar = (properties = "", uid = "appointment-1", title = "Site visit") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261027T120000Z\r\nSUMMARY:${title}\r\n${properties || "DTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z"}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const xmlParser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false });

async function request(
  path: string,
  method: string,
  body?: string,
  headers: Record<string, string> = {},
) {
  return handle(
    new Request(`https://bauplan.example${path}`, {
      method,
      headers: {
        authorization: basic(),
        ...(body ? { "content-type": method === "PUT" ? "text/calendar" : "application/xml" } : {}),
        ...headers,
      },
      ...(body ? { body } : {}),
    }),
  );
}

beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  process.env["CALDAV_TIMEZONE"] = "Europe/Berlin";
  handle = (await import("./caldav")).handleCaldav;
  repo = (await import("./repo")).sqliteRepo();
  auth = await import("./local-auth");
  await auth.createInitialAdmin({ email: "admin@example.test", password });
  await auth.createUser({ email: "member@example.test", password, role: "member" });
  await auth.createUser({ email: "pending@example.test", password, role: "pending" });
  await auth.createUser({ email: "sso@example.test", role: "member", oidc_sub: "sso" });
});

afterAll(() => {
  if (previousDir === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previousDir;
  if (previousZone === undefined) delete process.env["CALDAV_TIMEZONE"];
  else process.env["CALDAV_TIMEZONE"] = previousZone;
  rmSync(dir, { recursive: true, force: true });
});

describe("CalDAV discovery and authentication", () => {
  it("supports well-known discovery and OPTIONS without exposing data", async () => {
    const discovery = await handle(new Request("https://bauplan.example/.well-known/caldav"));
    expect(discovery.status).toBe(308);
    expect(discovery.headers.get("location")).toBe(root);
    const options = await request(root, "OPTIONS");
    expect(options.headers.get("dav")).toContain("calendar-access");
    expect(options.headers.get("allow")).toContain("PROPFIND");
  });

  it("uses existing account passwords, including UTF-8 passwords, and denies unauthorized roles", async () => {
    for (const authorization of [
      "",
      "Basic %%%",
      basic("member@example.test", "wrong"),
      basic("pending@example.test"),
      basic("sso@example.test"),
      basic("missing@example.test"),
    ]) {
      const result = await request(root, "PROPFIND", undefined, { authorization });
      expect(result.status).toBe(401);
      expect(result.headers.get("www-authenticate")).toContain("Basic");
    }
    expect((await request(root, "PROPFIND")).status).toBe(207);
    expect(
      (await request(root, "PROPFIND", undefined, { authorization: basic("admin@example.test") }))
        .status,
    ).toBe(207);
  });

  it("discovers principal, home and both calendars with separate privileges", async () => {
    const principal = await request(
      root,
      "PROPFIND",
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>',
    );
    const text = await principal.text();
    expect(text).toContain(`${root}principal/`);
    expect(text).toContain(`${root}calendars/`);
    expect(xmlParser.parse(text)).toHaveProperty("multistatus.response");
    const home = await request(`${root}calendars/`, "PROPFIND", undefined, { depth: "1" });
    expect(await home.text()).toContain(deadlines);
    const readonly = await request(deadlines, "PROPFIND");
    const readonlyBody = await readonly.text();
    expect(readonlyBody).toContain("<d:read/>");
    expect(readonlyBody).not.toContain("<d:write/>");
    expect((await request(events, "PROPFIND", undefined, { depth: "infinity" })).status).toBe(403);
  });
});

describe("bidirectional appointments", () => {
  it("creates through PUT and exposes the same event to the web app, GET and REPORT", async () => {
    const result = await request(`${events}client-event.ics`, "PUT", calendar(), {
      "if-none-match": "*",
    });
    expect(result.status).toBe(201);
    const event = (await repo.getAll()).events.find((item) => item.id === "client-event");
    expect(event).toMatchObject({
      title: "Site visit",
      event_date: "2026-11-02",
      start_time: "10:00",
      end_time: "11:00",
      caldav_uid: "appointment-1",
    });
    const get = await request(`${events}client-event.ics`, "GET");
    expect(get.status).toBe(200);
    expect(await get.text()).toContain("UID:appointment-1");
    const etag = get.headers.get("etag")!;
    expect(
      (await request(`${events}client-event.ics`, "GET", undefined, { "if-none-match": etag }))
        .status,
    ).toBe(304);
    const report = await request(
      events,
      "REPORT",
      `<c:calendar-multiget xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>${events}client-event.ics</d:href><d:href>${events}missing.ics</d:href></c:calendar-multiget>`,
    );
    const text = await report.text();
    expect(text).toContain("UID:appointment-1");
    expect(text).toContain("404 Not Found");
    expect(text).toContain(etag.replaceAll('"', "&quot;"));
  });

  it("reflects web edits, preserves alarms/location, and protects optimistic concurrency", async () => {
    const path = `${events}preserved.ics`;
    const source = calendar(
      "DTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z\r\nLOCATION:Building site\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM",
      "preserved",
    );
    expect((await request(path, "PUT", source)).status).toBe(201);
    const before = (await request(path, "GET")).headers.get("etag")!;
    await repo.update("events", "preserved", {
      title: "Web edit",
      kind: "arbeit",
      trade_id: "trade",
      notes: "Web notes",
      start_time: "12:00",
      end_time: "13:00",
    });
    const get = await request(path, "GET");
    const after = get.headers.get("etag")!;
    const text = await get.text();
    expect(after).not.toBe(before);
    expect(text).toContain("SUMMARY:Web edit");
    expect(text).toContain("LOCATION:Building site");
    expect(text).toContain("BEGIN:VALARM");
    expect(text).toContain("DTSTART:20261102T110000Z");
    expect((await request(path, "PUT", source, { "if-match": before })).status).toBe(412);
    expect((await request(path, "DELETE", undefined, { "if-match": before })).status).toBe(412);
    expect(
      (
        await request(path, "PUT", calendar(undefined, "preserved", "Apple edit"), {
          "if-match": after,
        })
      ).status,
    ).toBe(204);
    expect((await repo.getAll()).events.find((item) => item.id === "preserved")).toMatchObject({
      title: "Apple edit",
      kind: "arbeit",
      trade_id: "trade",
    });
    expect((await request(path, "DELETE")).status).toBe(204);
    expect((await repo.getAll()).events.some((item) => item.id === "preserved")).toBe(false);
    expect((await request(path, "GET")).status).toBe(404);
  });

  it("rejects duplicate resources and UIDs, UID changes, malformed bodies and recurrence without modifying data", async () => {
    expect(
      (await request(`${events}client-event.ics`, "PUT", calendar(), { "if-none-match": "*" }))
        .status,
    ).toBe(412);
    expect((await request(`${events}duplicate.ics`, "PUT", calendar())).status).toBe(403);
    expect(
      (await request(`${events}client-event.ics`, "PUT", calendar(undefined, "changed-uid")))
        .status,
    ).toBe(409);
    for (const body of [
      "invalid",
      calendar("DTSTART:20261102T090000Z\r\nRRULE:FREQ=DAILY", "recurring"),
      calendar("DTSTART:20261102T090000Z\r\nDTEND:20261102T080000Z", "invalid-range"),
    ]) {
      expect((await request(`${events}invalid.ics`, "PUT", body)).status).toBe(403);
    }
    expect((await repo.getAll()).events.some((item) => item.id === "invalid")).toBe(false);
    expect(
      (await request(`${events}oversized.ics`, "PUT", "x".repeat(512 * 1024 + 1))).status,
    ).toBe(413);
    expect((await request(events, "REPORT", '<!DOCTYPE x [<!ENTITY x "test">]><x/>')).status).toBe(
      400,
    );
  });

  it("changes collection ctags after web creation, modification and deletion", async () => {
    const ctag = async () => {
      const response = await request(events, "PROPFIND");
      return /<cs:getctag>(.*?)<\/cs:getctag>/.exec(await response.text())?.[1];
    };
    const before = await ctag();
    await repo.insert("events", {
      id: "web-created",
      title: "Web appointment",
      event_date: "2026-11-03",
      kind: "termin",
    });
    const created = await ctag();
    expect(created).not.toBe(before);
    expect((await request(`${events}web-created.ics`, "GET")).status).toBe(200);
    await repo.update("events", "web-created", { title: "Changed" });
    expect(await ctag()).not.toBe(created);
    await repo.remove("events", "web-created");
    expect(await ctag()).toBe(before);
  });

  it("filters REPORT by actual instants, not server-local clock values", async () => {
    const report = (start: string, end: string) =>
      request(
        events,
        "REPORT",
        `<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
      );
    expect(await (await report("20261102T093000Z", "20261102T094000Z")).text()).toContain(
      "client-event.ics",
    );
    expect(await (await report("20261102T100000Z", "20261102T103000Z")).text()).not.toContain(
      "client-event.ics",
    );
  });
});

describe("read-only projections and account revocation", () => {
  it("publishes tasks and quote deadlines but never accepts writes to them", async () => {
    await repo.insert("tasks", {
      id: "task-1",
      title: "Call contractor",
      due_date: "2026-11-04",
      status: "offen",
    });
    await repo.insert("offers", {
      id: "offer-1",
      contractor: "Builder",
      valid_until: "2026-11-05",
      status: "received",
    });
    const result = await request(deadlines, "PROPFIND", undefined, { depth: "1" });
    const text = await result.text();
    expect(text).toContain("task-task-1");
    expect(text).toContain("offer-offer-1");
    expect((await request(`${deadlines}task-task-1%40bauplan.ics`, "DELETE")).status).toBe(403);
    expect((await request(`${deadlines}new.ics`, "PUT", calendar())).status).toBe(403);
    expect((await repo.getAll()).tasks).toHaveLength(1);
    await repo.update("tasks", "task-1", { status: "erledigt" });
    expect(
      await (await request(deadlines, "PROPFIND", undefined, { depth: "1" })).text(),
    ).not.toContain("task-task-1");
  });

  it("immediately respects password changes, pending roles and deleted users", async () => {
    const id = await auth.createUser({ email: "revoked@example.test", password, role: "member" });
    const headers = { authorization: basic("revoked@example.test") };
    expect((await request(root, "PROPFIND", undefined, headers)).status).toBe(207);
    await auth.updateUser(id, { password: "new-password" });
    expect((await request(root, "PROPFIND", undefined, headers)).status).toBe(401);
    headers.authorization = basic("revoked@example.test", "new-password");
    await auth.updateUser(id, { role: "pending" });
    expect((await request(root, "PROPFIND", undefined, headers)).status).toBe(401);
    await auth.deleteUser(id);
    expect((await request(root, "PROPFIND", undefined, headers)).status).toBe(401);
  });
});

describe("iCalendar conversion", () => {
  it("handles all-day exclusive ends, multi-day events and durations", () => {
    expect(
      parseCalendarEvent(calendar("DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261105")),
    ).toMatchObject({
      event_date: "2026-11-02",
      end_date: "2026-11-04",
      start_time: null,
    });
    expect(parseCalendarEvent(calendar("DTSTART:20261102T230000Z\r\nDURATION:PT2H"))).toMatchObject(
      {
        event_date: "2026-11-03",
        start_time: "00:00",
        end_date: "2026-11-03",
        end_time: "02:00",
      },
    );
    expect(parseCalendarEvent(calendar("DTSTART;VALUE=DATE:20261102"))).toMatchObject({
      end_date: "2026-11-02",
    });
  });

  it("handles IANA TZIDs, summer/winter offsets and stable round-trips", () => {
    for (const [date, expected] of [
      ["20260702", "10:00"],
      ["20261102", "10:00"],
    ]) {
      const parsed = parseCalendarEvent(
        calendar(
          `DTSTART;TZID=Europe/Berlin:${date}T100000\r\nDTEND;TZID=Europe/Berlin:${date}T110000`,
        ),
      );
      expect(parsed.start_time).toBe(expected);
      const row = { ...parsed, id: "roundtrip" };
      const { caldav_data: _raw, ...fields } = parsed;
      expect(parseCalendarEvent(calendarObject(row))).toMatchObject(fields);
      expect(calendarEtag(row)).toBe(calendarEtag(row));
    }
    const row = {
      ...parseCalendarEvent(calendar()),
      id: "summer",
      caldav_data: null,
      event_date: "2026-07-02",
      end_date: null,
    };
    expect(calendarObject(row)).toContain("DTSTART:20260702T080000Z");
    expect(calendarBounds(calendar("DTSTART:20261102T090000Z\r\nDURATION:PT1H"))).toEqual({
      start: Date.parse("2026-11-02T09:00:00Z"),
      end: Date.parse("2026-11-02T10:00:00Z"),
    });
  });

  it("rejects nonexistent DST wall times instead of shifting them silently", () => {
    expect(() =>
      parseCalendarEvent(calendar("DTSTART;TZID=Europe/Berlin:20260329T023000")),
    ).toThrow("does not exist");
  });

  it("uses the first occurrence of ambiguous times and supports embedded timezone definitions", () => {
    expect(calendarBounds(calendar("DTSTART;TZID=Europe/Berlin:20261025T023000")).start).toBe(
      Date.parse("2026-10-25T00:30:00Z"),
    );
    const source = calendar(
      "DTSTART;TZID=Custom/Building:20261102T100000\r\nDTEND;TZID=Custom/Building:20261102T110000",
    ).replace(
      "BEGIN:VEVENT",
      [
        "BEGIN:VTIMEZONE",
        "TZID:Custom/Building",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0130",
        "TZOFFSETTO:+0130",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
      ].join("\r\n"),
    );
    expect(parseCalendarEvent(source)).toMatchObject({ start_time: "09:30", end_time: "10:30" });
  });

  it.each([
    "DTSTART:20260230T100000Z",
    "DTSTART:20261102T250000Z",
    "DTSTART:20261102T090000Z\r\nDTSTART:20261102T100000Z",
    "DTSTART;VALUE=DATE:20261102\r\nDURATION:PT1H",
    "DTSTART;TZID=Unknown/Timezone:20261102T100000",
    "DTSTART:20261102T100000Z\r\nDURATION:invalid",
  ])("rejects malformed or unrepresentable values: %s", (properties) => {
    expect(() => parseCalendarEvent(calendar(properties))).toThrow();
  });
});
