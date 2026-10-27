// Secret token for the read-only iCal subscription link.
// Server-only: never import from client code.
import type { CalEvent, Offer, Task } from "@/lib/schema";

export async function getFeedToken(): Promise<string | null> {
  const { getSqliteDb } = await import("@/server/repo");
  const db = await getSqliteDb();
  return (
    (db.prepare("SELECT value FROM app_settings WHERE key = 'ics_token'").get()?.["value"] as
      string | undefined) ?? null
  );
}

export async function setFeedToken(token: string | null) {
  const { getSqliteDb } = await import("@/server/repo");
  const db = await getSqliteDb();
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('ics_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(token);
}

export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare so the token cannot be guessed by timing. */
export function sameToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Reads entries for the feed. Call only after the token was verified. */
export async function feedData(): Promise<{
  events: CalEvent[];
  tasks: Task[];
  offers: Offer[];
  name: string;
}> {
  const { sqliteRepo } = await import("@/server/repo");
  const ws = await sqliteRepo().getAll();
  return {
    events: ws.events,
    tasks: ws.tasks,
    offers: ws.offers,
    name: ws.projects[0]?.name ?? "Bauplan",
  };
}
