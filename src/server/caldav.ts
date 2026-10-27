import { XMLParser, XMLValidator } from "fast-xml-parser";
import { calendarAccess } from "@/lib/data.functions";
import type { Workspace } from "@/lib/schema";
import { buildIcs } from "@/lib/ics";
import labels from "@/locales/de/caldav.json";
import {
  calendarBounds,
  calendarTimezone,
  calendarObject,
  contentEtag,
  DavError,
  parseCalendarEvent,
} from "./caldav-calendar";

const BASE = "/api/caldav/";
const HOME = `${BASE}calendars/`;
const PRINCIPAL = `${BASE}principal/`;
const MAX_BODY = 512 * 1024;
const DAV = "1, 3, calendar-access";
const ALLOW = "OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE";
const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
const href = (value: string) => `<d:href>${xml(value)}</d:href>`;
type Node = Record<string, unknown>;
type Resource = { href: string; data: string; etag: string };
const record = (value: unknown): Node =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {};
const list = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function response(body: string | null, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: { "cache-control": "no-store", DAV, ...headers },
  });
}

function xmlResponse(body: string, status = 207) {
  return response(`<?xml version="1.0" encoding="utf-8"?>${body}`, status, {
    "content-type": "application/xml; charset=utf-8",
  });
}

function multistatus(items: string[]) {
  return xmlResponse(
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">${items.join("")}</d:multistatus>`,
  );
}

async function bodyText(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    throw new DavError(413, "Request body exceeds 512 KiB.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > MAX_BODY) {
      await reader.cancel();
      throw new DavError(413, "Request body exceeds 512 KiB.");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function parseXml(text: string): Node {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    throw new DavError(400, "Invalid XML; DTDs and entities are not allowed.");
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
    trimValues: true,
  });
  return record(parser.parse(text));
}

function resources(ws: Workspace, collection: string): Resource[] {
  if (collection === "events")
    return ws.events.map((event) => {
      const data = calendarObject(event);
      return {
        href: `${HOME}events/${encodeURIComponent(event.id)}.ics`,
        data,
        etag: contentEtag(data),
      };
    });
  // Use the existing feed derivation; these are projections, never editable appointments.
  const feed = buildIcs([], ws.tasks, "", new Date("2026-01-01T00:00:00Z"), ws.offers);
  return [...feed.matchAll(/BEGIN:VEVENT\r\n[\s\S]*?END:VEVENT/g)].map((match, index) => {
    const event = match[0];
    const uid = /(?:^|\r\n)UID:([^\r\n]+)/.exec(event)?.[1];
    if (!uid) throw new Error(`Missing UID for derived calendar entry ${index}.`);
    const data = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Bauplan//CalDAV//EN\r\n${event}\r\nEND:VCALENDAR\r\n`;
    return {
      href: `${HOME}deadlines/${encodeURIComponent(uid)}.ics`,
      data,
      etag: contentEtag(data),
    };
  });
}

function propertyName(name: string) {
  if (
    [
      "calendar-home-set",
      "calendar-description",
      "calendar-data",
      "supported-calendar-component-set",
      "supported-calendar-data",
      "calendar-user-address-set",
      "max-resource-size",
    ].includes(name)
  )
    return `c:${name}`;
  if (name === "getctag") return `cs:${name}`;
  if (name === "calendar-color" || name === "calendar-order") return `a:${name}`;
  return `d:${name}`;
}

function propertyResponse(
  path: string,
  properties: Record<string, string>,
  requested: Node | null,
  namesOnly = false,
) {
  const wanted = requested
    ? Object.keys(requested).filter((key) => !key.startsWith("@"))
    : Object.keys(properties);
  const found: string[] = [];
  const missing: string[] = [];
  for (const key of wanted) {
    const tag = propertyName(key);
    if (Object.hasOwn(properties, key))
      found.push(namesOnly ? `<${tag}/>` : `<${tag}>${properties[key]}</${tag}>`);
    else missing.push(`<${tag}/>`);
  }
  return `<d:response>${href(path)}${found.length ? `<d:propstat><d:prop>${found.join("")}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` : ""}${missing.length ? `<d:propstat><d:prop>${missing.join("")}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>` : ""}</d:response>`;
}

function resourceResponse(resource: Resource, requested: Node | null) {
  return propertyResponse(
    resource.href,
    {
      getetag: xml(resource.etag),
      getcontenttype: "text/calendar; charset=utf-8",
      resourcetype: "",
      "calendar-data": xml(resource.data),
      getcontentlength: String(new TextEncoder().encode(resource.data).length),
    },
    requested,
  );
}

const missingResponse = (path: string) =>
  `<d:response>${href(path)}<d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;

function collectionProperties(path: string, ws: Workspace, email: string) {
  const calendar = path === `${HOME}events/` || path === `${HOME}deadlines/`;
  const readonly = path === `${HOME}deadlines/`;
  const items = calendar ? resources(ws, readonly ? "deadlines" : "events") : [];
  const props: Record<string, string> = {
    displayname: xml(
      calendar ? (readonly ? labels.deadlines : ws.projects[0]?.name || "Bauplan") : "Bauplan",
    ),
    resourcetype: `<d:collection/>${calendar ? "<c:calendar/>" : path === PRINCIPAL ? "<d:principal/>" : ""}`,
    "current-user-principal": href(PRINCIPAL),
    "principal-URL": href(PRINCIPAL),
    "calendar-home-set": href(HOME),
    "calendar-user-address-set": href(`mailto:${email}`),
    owner: href(PRINCIPAL),
    "current-user-privilege-set": `<d:privilege><d:read/></d:privilege>${readonly || !calendar ? "" : "<d:privilege><d:write/></d:privilege>"}<d:privilege><d:read-current-user-privilege-set/></d:privilege>`,
  };
  if (calendar)
    Object.assign(props, {
      "calendar-description": xml(readonly ? labels.readonly : labels.description),
      "supported-calendar-component-set": '<c:comp name="VEVENT"/>',
      "supported-calendar-data": '<c:calendar-data content-type="text/calendar" version="2.0"/>',
      "supported-report-set": ["calendar-query", "calendar-multiget"]
        .map((name) => `<d:supported-report><d:report><c:${name}/></d:report></d:supported-report>`)
        .join(""),
      getctag: xml(
        contentEtag(
          items
            .map((r) => `${r.href}:${r.etag}`)
            .sort()
            .join("\n"),
        ),
      ),
      "calendar-color": readonly ? "#999999" : "#597354",
      "calendar-order": readonly ? "2" : "1",
      "max-resource-size": String(MAX_BODY),
    });
  return props;
}

function reportFilter(query: Node) {
  const filter = record(query["filter"]);
  const unsupported = (node: unknown): boolean =>
    Object.entries(record(node)).some(
      ([key, value]) =>
        !key.startsWith("@") &&
        ((key !== "comp-filter" && key !== "time-range") ||
          (key === "comp-filter" && list(value).some(unsupported))),
    );
  if (unsupported(filter))
    throw new DavError(
      403,
      "Only VEVENT component and time-range filters are supported.",
      "supported-filter",
    );
  let range: Node | null = null;
  let eventRequested = true;
  const walk = (node: unknown) => {
    const item = record(node);
    const name = item["@_name"];
    if (typeof name === "string" && !["VCALENDAR", "VEVENT"].includes(name)) eventRequested = false;
    if (item["time-range"] !== undefined) range = record(item["time-range"]);
    for (const child of list(item["comp-filter"])) walk(child);
  };
  walk(filter);
  const bounds = range as Node | null;
  const parseBound = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d{8}T\d{6}Z$/.test(value))
      throw new DavError(400, "Time-range bounds must be UTC date-times.");
    const iso = value.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z",
    );
    const number = Date.parse(iso);
    if (!Number.isFinite(number)) throw new DavError(400, "Invalid time-range.");
    return number;
  };
  const start = parseBound(bounds?.["@_start"], -Infinity);
  const end = parseBound(bounds?.["@_end"], Infinity);
  if (start >= end) throw new DavError(400, "Invalid time-range.");
  return { eventRequested, start, end };
}

async function dispatch(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/caldav" || url.pathname === "/.well-known/caldav/")
    return response(null, 308, { location: BASE });
  if (request.method === "OPTIONS") return response(null, 200, { allow: ALLOW });
  const context = await calendarAccess(request.headers.get("authorization"));
  if (!context)
    return response("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Bauplan CalDAV", charset="UTF-8"',
    });
  calendarTimezone();
  const path =
    url.pathname.endsWith("/") || url.pathname.endsWith(".ics") ? url.pathname : `${url.pathname}/`;
  const collectionPaths = [BASE, PRINCIPAL, HOME, `${HOME}events/`, `${HOME}deadlines/`];
  const objectMatch = /^\/api\/caldav\/calendars\/(events|deadlines)\/([^/]+)\.ics$/.exec(path);
  if (!collectionPaths.includes(path) && !objectMatch) throw new DavError(404, "Not found.");
  if (["PUT", "DELETE"].includes(request.method)) {
    if (!objectMatch || objectMatch[1] !== "events")
      throw new DavError(403, "Tasks and quote deadlines are read-only.", "need-privileges");
    let id: string;
    try {
      id = decodeURIComponent(objectMatch[2]!);
    } catch {
      throw new DavError(400, "Invalid resource name.");
    }
    if (!/^[\w.-]{1,160}$/.test(id)) throw new DavError(400, "Invalid resource name.");
    if (
      request.method === "PUT" &&
      !(request.headers.get("content-type") || "").toLowerCase().startsWith("text/calendar")
    )
      throw new DavError(415, "Use Content-Type: text/calendar.");
    const value = request.method === "PUT" ? parseCalendarEvent(await bodyText(request)) : null;
    const result = await context.repo.writeCalendarEvent(id, value, {
      match: request.headers.get("if-match"),
      noneMatch: request.headers.get("if-none-match"),
    });
    // PUT may normalize data. Clients retrieve the canonical object and ETag in the next REPORT/GET.
    return response(null, result.created ? 201 : 204, result.created ? { location: path } : {});
  }
  const ws = await context.repo.getAll();
  if (request.method === "GET" || request.method === "HEAD") {
    if (!objectMatch) throw new DavError(405, "This collection is accessed using CalDAV.");
    const object = resources(ws, objectMatch[1]!).find((item) => item.href === path);
    if (!object) throw new DavError(404, "Not found.");
    if (request.headers.get("if-none-match") === object.etag)
      return response(null, 304, { etag: object.etag });
    return response(request.method === "HEAD" ? null : object.data, 200, {
      "content-type": "text/calendar; charset=utf-8",
      etag: object.etag,
    });
  }
  if (request.method === "PROPFIND") {
    const depth = request.headers.get("depth") || "0";
    if (!["0", "1"].includes(depth))
      throw new DavError(403, "Use Depth: 0 or 1.", "propfind-finite-depth");
    const text = await bodyText(request);
    const document = text ? parseXml(text) : { propfind: { allprop: "" } };
    if (!("propfind" in document)) throw new DavError(400, "Expected PROPFIND.");
    const query = record(document["propfind"]);
    const requested = "prop" in query ? record(query["prop"]) : null;
    const namesOnly = "propname" in query;
    if (objectMatch) {
      const object = resources(ws, objectMatch[1]!).find((item) => item.href === path);
      return multistatus([object ? resourceResponse(object, requested) : missingResponse(path)]);
    }
    const paths = [path];
    if (depth === "1") {
      if (path === BASE) paths.push(PRINCIPAL, HOME);
      if (path === HOME) paths.push(`${HOME}events/`, `${HOME}deadlines/`);
    }
    const responses = paths.map((child) =>
      propertyResponse(
        child,
        collectionProperties(child, ws, context.user.email),
        requested,
        namesOnly,
      ),
    );
    if (depth === "1" && path.startsWith(HOME) && path !== HOME)
      responses.push(
        ...resources(ws, path === `${HOME}events/` ? "events" : "deadlines").map((item) =>
          resourceResponse(item, requested),
        ),
      );
    return multistatus(responses);
  }
  if (request.method === "REPORT") {
    if (path !== `${HOME}events/` && path !== `${HOME}deadlines/`)
      throw new DavError(403, "REPORT requires a calendar collection.", "supported-report");
    const document = parseXml(await bodyText(request));
    const all = resources(ws, path === `${HOME}events/` ? "events" : "deadlines");
    if ("calendar-multiget" in document) {
      const query = record(document["calendar-multiget"]);
      const requested = "prop" in query ? record(query["prop"]) : null;
      return multistatus(
        list(query["href"]).map((value) => {
          if (typeof value !== "string") throw new DavError(400, "Invalid href.");
          let target: URL;
          try {
            target = new URL(value, request.url);
          } catch {
            throw new DavError(400, "Invalid href.");
          }
          const found =
            target.origin === url.origin
              ? all.find((item) => item.href === target.pathname)
              : undefined;
          return found ? resourceResponse(found, requested) : missingResponse(value);
        }),
      );
    }
    if ("calendar-query" in document) {
      const query = record(document["calendar-query"]);
      const requested = "prop" in query ? record(query["prop"]) : null;
      const filter = reportFilter(query);
      const filtered = !filter.eventRequested
        ? []
        : all.filter((item) => {
            if (filter.start === -Infinity && filter.end === Infinity) return true;
            const bounds = calendarBounds(item.data);
            return bounds.start < filter.end && bounds.end > filter.start;
          });
      return multistatus(filtered.map((item) => resourceResponse(item, requested)));
    }
    throw new DavError(403, "Unsupported REPORT.", "supported-report");
  }
  return response("Method not allowed.", 405, { allow: ALLOW });
}

export async function handleCaldav(request: Request) {
  try {
    return await dispatch(request);
  } catch (error) {
    if (!(error instanceof DavError)) {
      console.error("[caldav] Request failed", error);
      return response("Calendar request failed.", 500);
    }
    const condition = error.condition
      ? `<${error.condition === "need-privileges" || error.condition === "propfind-finite-depth" ? "d" : "c"}:${error.condition}/>`
      : "";
    return xmlResponse(
      `<d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${condition}<d:responsedescription>${xml(error.message)}</d:responsedescription></d:error>`,
      error.status,
    );
  }
}
