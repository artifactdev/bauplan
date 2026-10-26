import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { z } from "zod";

type Role = "admin" | "member" | "pending";
export type AuthState = {
  needsSetup: boolean;
  user: { id: string; email: string; name: string | null; role: Role } | null;
  oidc: { enabled: boolean; label: string };
};
export type ManagedUser = { id: string; email: string; name: string | null; role: Role; sso: boolean; created_at: string };

const SESSION = "bp_session";

function secureCookie() {
  const req = getRequest();
  const proto = req?.headers.get("x-forwarded-proto") ?? (req ? new URL(req.url).protocol.replace(":", "") : "http");
  return proto === "https";
}

async function startLocalSession(userId: string) {
  const la = await import("@/server/local-auth");
  const s = await la.createSession(userId);
  setCookie(SESSION, s.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: s.maxAge, secure: secureCookie() });
}

/** Who is signed in, whether first-run setup is needed, and how to log in. Public. */
export const getAuthState = createServerFn().handler(async (): Promise<AuthState> => {
  const la = await import("@/server/local-auth");
  const [count, u, o] = await Promise.all([
    la.countUsers(),
    la.userFromToken(getCookie(SESSION)),
    la.getOidcSettings(),
  ]);
  return {
    needsSetup: count === 0,
    user: u && { id: u.id, email: u.email, name: u.name, role: u.role },
    oidc: { enabled: o.enabled && !!o.issuer && !!o.client_id, label: o.label },
  };
});

const setupSchema = z.object({ name: z.string().max(100).optional(), email: z.string().email(), password: z.string().min(8).max(200) });

/** First-run setup: creates the first admin. Only works while no account exists. */
export const runSetup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => setupSchema.parse(d))
  .handler(async ({ data }) => {
    const la = await import("@/server/local-auth");
    if ((await la.countUsers()) > 0) throw new Error("Die Einrichtung wurde bereits abgeschlossen.");
    const id = await la.createUser({ ...data, role: "admin" });
    await startLocalSession(id);
    return { ok: true };
  });

export const loginLocal = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string(), password: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const la = await import("@/server/local-auth");
    const u = await la.checkPassword(data.email, data.password);
    if (!u) throw new Error("E-Mail oder Passwort falsch");
    await startLocalSession(u.id);
    return { ok: true };
  });

export const logoutLocal = createServerFn({ method: "POST" }).handler(async () => {
  const la = await import("@/server/local-auth");
  await la.destroySession(getCookie(SESSION));
  deleteCookie(SESSION, { path: "/" });
  return { ok: true };
});

/* --------------------------- admin: users --------------------------- */

async function requireAdmin() {
  const la = await import("@/server/local-auth");
  const u = await la.userFromToken(getCookie(SESSION));
  if (u?.role !== "admin") throw new Error("Nur für Admins");
  return { id: u.id };
}

export const listUsers = createServerFn().handler(async (): Promise<ManagedUser[]> => {
  await requireAdmin();
  const la = await import("@/server/local-auth");
  return (await la.listUsers()).map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, sso: !!u.oidc_sub, created_at: u.created_at }));
});

const roleSchema = z.enum(["admin", "member", "pending"]);

export const createManagedUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), name: z.string().max(100).optional(), password: z.string().min(8).max(200), role: z.enum(["admin", "member"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const la = await import("@/server/local-auth");
    await la.createUser(data);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string(), role: roleSchema }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    if (me.id === data.id && data.role !== "admin") throw new Error("Du kannst dir die Admin-Rolle nicht selbst entziehen.");
    await adminGuard(data.id, data.role);
    const la = await import("@/server/local-auth");
    await la.updateUser(data.id, { role: data.role });
    return { ok: true };
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string(), password: z.string().min(8).max(200) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const la = await import("@/server/local-auth");
    await la.updateUser(data.id, { password: data.password });
    return { ok: true };
  });

export const deleteManagedUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    if (me.id === data.id) throw new Error("Du kannst dich nicht selbst löschen.");
    await adminGuard(data.id, null);
    const la = await import("@/server/local-auth");
    await la.deleteUser(data.id);
    return { ok: true };
  });

/* --------------------------- admin: OIDC ---------------------------- */

export type OidcAdminSettings = { enabled: boolean; label: string; issuer: string; client_id: string; has_secret: boolean; public_url: string };

export const getOidcAdmin = createServerFn().handler(async (): Promise<OidcAdminSettings> => {
  await requireAdmin();
  const la = await import("@/server/local-auth");
  const s = await la.getOidcSettings();
  return { enabled: s.enabled, label: s.label, issuer: s.issuer, client_id: s.client_id, has_secret: !!s.client_secret, public_url: s.public_url };
});

export const saveOidcAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      enabled: z.boolean(), label: z.string().min(1).max(60),
      issuer: z.string().max(300).default(""), client_id: z.string().max(300).default(""),
      client_secret: z.string().max(500).optional(), public_url: z.string().max(300).default(""),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const la = await import("@/server/local-auth");
    const cur = await la.getOidcSettings();
    if (data.enabled) await la.discover(data.issuer); // fails loudly on a wrong issuer
    await la.saveOidcSettings({
      enabled: data.enabled, label: data.label, issuer: data.issuer.trim(), client_id: data.client_id.trim(),
      client_secret: data.client_secret ? data.client_secret : cur.client_secret, public_url: data.public_url.trim(),
    });
    return { ok: true };
  });

/* --------------------------- calendar feed --------------------------- */

export const getCalendarFeed = createServerFn().handler(async (): Promise<{ token: string | null }> => {
  await requireAdmin();
  const f = await import("@/server/calendar-feed");
  return { token: await f.getFeedToken() };
});

export const setCalendarFeed = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ action: z.enum(["create", "disable"]) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const f = await import("@/server/calendar-feed");
    const token = data.action === "create" ? f.newToken() : null;
    await f.setFeedToken(token);
    return { token };
  });

/** Current role of a user and number of admins, for the last-admin rule. */
async function adminGuard(id: string, newRole: string | null) {
  const { lastAdminError } = await import("@/server/auth-core");
  const la = await import("@/server/local-auth");
  const current = (await la.listUsers()).find((u) => u.id === id)?.role ?? null;
  const count = await la.adminCount();
  const err = lastAdminError(current, newRole, count);
  if (err) throw new Error(err);
}
