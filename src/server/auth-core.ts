// Pure auth helpers (WebCrypto only) – shared by both storage modes and tested.

const ITER = 210_000;
const enc = new TextEncoder();

function hex(b: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function unhex(s: string) {
  return new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
}

async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(await pbkdf2(password, salt, ITER))}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [kind, iter, salt, hash] = stored.split("$");
  if (kind !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = hex(await pbkdf2(password, unhex(salt), Number(iter)));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export async function pkceChallenge(verifier: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type Role = "admin" | "member" | "pending";
type Known = { id: string; role: Role; oidc_sub: string | null } | undefined;

/**
 * Decides what an OIDC login does. Existing accounts are matched by subject
 * first, then by e-mail (and linked, replacing an older subject). The provider
 * is trusted for e-mail addresses because it is configured by the admin.
 * Unknown people get a pending account that an admin must approve before they
 * can see any data.
 */
export function decideOidcLogin(bySub: Known, byEmail: Known):
  | { action: "login"; id: string }
  | { action: "link"; id: string; replaces?: string }
  | { action: "create-pending" } {
  // A pending duplicate from an earlier unmatched login gives way to the real account.
  if (bySub && byEmail && bySub.id !== byEmail.id && bySub.role === "pending")
    return { action: "link", id: byEmail.id, replaces: bySub.id };
  if (bySub) return { action: "login", id: bySub.id };
  if (byEmail) return { action: "link", id: byEmail.id };
  return { action: "create-pending" };
}

export function canAccessData(role: Role | null | undefined) {
  return role === "admin" || role === "member";
}

/** Error when a change would leave no admin (newRole null = delete), else null. */
export function lastAdminError(currentRole: string | null | undefined, newRole: string | null, adminCount: number): string | null {
  if (currentRole !== "admin" || newRole === "admin" || adminCount > 1) return null;
  return newRole === null
    ? "Der letzte Admin kann nicht gelöscht werden. Ernenne zuerst eine andere Person zum Admin."
    : "Der letzte Admin kann seine Rolle nicht verlieren. Ernenne zuerst eine andere Person zum Admin.";
}
