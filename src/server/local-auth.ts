// Self-hosted (SQLite) login: users, sessions, settings, OIDC. Server-only;
// import via dynamic import() inside handlers.
import { getSqliteDb, sqliteRepo } from "./repo";
import { decideOidcLogin, hashPassword, randomToken, sha256, verifyPassword, type Role } from "./auth-core";

export const SESSION_COOKIE = "bp_session";
const SESSION_DAYS = 30;

export type LocalUser = { id: string; email: string; name: string | null; role: Role; oidc_sub: string | null; created_at: string };

const COLS = "id, email, name, role, oidc_sub, created_at";

export async function countUsers() {
  const db = await getSqliteDb();
  return Number(db.prepare("SELECT COUNT(*) AS n FROM app_users").get()?.["n"] ?? 0);
}

export async function listUsers(): Promise<LocalUser[]> {
  return (await getSqliteDb()).prepare(`SELECT ${COLS} FROM app_users ORDER BY created_at`).all() as LocalUser[];
}

export async function createUser(u: { email: string; name?: string | undefined; password?: string | undefined; role: Role; oidc_sub?: string | undefined }) {
  const db = await getSqliteDb();
  const email = u.email.trim().toLowerCase();
  if (db.prepare("SELECT id FROM app_users WHERE email = ?").get(email)) throw new Error("Diese E-Mail ist schon vergeben.");
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO app_users (id, email, name, password_hash, role, oidc_sub, created_at) VALUES (?,?,?,?,?,?,?)").run(
    id, email, u.name ?? null, u.password ? await hashPassword(u.password) : null, u.role, u.oidc_sub ?? null, new Date().toISOString(),
  );
  return id;
}

export async function updateUser(id: string, patch: { role?: Role; password?: string; name?: string }) {
  const db = await getSqliteDb();
  if (patch.role) db.prepare("UPDATE app_users SET role = ? WHERE id = ?").run(patch.role, id);
  if (patch.name !== undefined) db.prepare("UPDATE app_users SET name = ? WHERE id = ?").run(patch.name, id);
  if (patch.password) db.prepare("UPDATE app_users SET password_hash = ? WHERE id = ?").run(await hashPassword(patch.password), id);
}

export async function deleteUser(id: string) {
  const db = await getSqliteDb();
  await sqliteRepo().deleteAppearance(id);
  db.prepare("DELETE FROM app_sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM app_users WHERE id = ?").run(id);
}

export async function adminCount() {
  const db = await getSqliteDb();
  return Number(db.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin'").get()?.["n"] ?? 0);
}

export async function checkPassword(email: string, password: string): Promise<LocalUser | null> {
  const db = await getSqliteDb();
  const row = db.prepare(`SELECT ${COLS}, password_hash FROM app_users WHERE email = ?`).get(email.trim().toLowerCase());
  if (!row || !(await verifyPassword(password, row["password_hash"] as string | null))) return null;
  delete row["password_hash"];
  return row as LocalUser;
}

export async function createSession(userId: string) {
  const db = await getSqliteDb();
  const token = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("DELETE FROM app_sessions WHERE expires_at < ?").run(new Date().toISOString());
  db.prepare("INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?,?,?)").run(await sha256(token), userId, exp);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  (await getSqliteDb()).prepare("DELETE FROM app_sessions WHERE token_hash = ?").run(await sha256(token));
}

export async function userFromToken(token: string | undefined | null): Promise<LocalUser | null> {
  if (!token) return null;
  const db = await getSqliteDb();
  const row = db
    .prepare(`SELECT u.id, u.email, u.name, u.role, u.oidc_sub, u.created_at FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(await sha256(token), new Date().toISOString());
  return (row as LocalUser | undefined) ?? null;
}

export function cookieFrom(header: string | null | undefined, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/* ------------------------------ settings ------------------------------ */

export type OidcSettings = { enabled: boolean; label: string; issuer: string; client_id: string; client_secret: string; public_url: string };

export async function getOidcSettings(): Promise<OidcSettings> {
  const db = await getSqliteDb();
  const raw = db.prepare("SELECT value FROM app_settings WHERE key = 'oidc'").get()?.["value"] as string | undefined;
  const v = raw ? (JSON.parse(raw) as Partial<OidcSettings>) : {};
  return { enabled: false, label: "Mit Pocket ID anmelden", issuer: "", client_id: "", client_secret: "", public_url: "", ...v };
}

export async function saveOidcSettings(s: OidcSettings) {
  const db = await getSqliteDb();
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('oidc', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s));
}

/* -------------------------------- OIDC -------------------------------- */

export async function discover(issuer: string) {
  const res = await fetch(issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration");
  if (!res.ok) throw new Error(`OIDC-Anbieter nicht erreichbar (${res.status})`);
  return (await res.json()) as { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string };
}

export function publicOrigin(req: Request, configured: string) {
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** Finds or creates the local account for an OIDC identity. */
export async function upsertOidcUser(info: { sub: string; email?: string | undefined; email_verified?: boolean | undefined; name?: string | undefined }): Promise<LocalUser> {
  const db = await getSqliteDb();
  const bySub = db.prepare(`SELECT ${COLS} FROM app_users WHERE oidc_sub = ?`).get(info.sub) as LocalUser | undefined;
  const email = (info.email ?? "").trim().toLowerCase();
  const byEmail = email ? (db.prepare(`SELECT ${COLS} FROM app_users WHERE email = ?`).get(email) as LocalUser | undefined) : undefined;
  const d = decideOidcLogin(bySub, byEmail, info.email_verified !== false);
  let id: string;
  if (d.action === "login") id = d.id;
  else if (d.action === "link") {
    db.prepare("UPDATE app_users SET oidc_sub = ? WHERE id = ?").run(info.sub, d.id);
    id = d.id;
  } else {
    const fallback = email && !byEmail ? email : `${info.sub}@oidc.local`;
    id = await createUser({ email: fallback, name: info.name, role: "pending", oidc_sub: info.sub });
  }
  return db.prepare(`SELECT ${COLS} FROM app_users WHERE id = ?`).get(id) as LocalUser;
}
