import { describe, expect, it } from "vitest";
import { canAccessData, decideOidcLogin, hashPassword, verifyPassword } from "./auth-core";

describe("passwords", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const h = await hashPassword("geheim123");
    expect(await verifyPassword("geheim123", h)).toBe(true);
    expect(await verifyPassword("geheim124", h)).toBe(false);
  });
});

describe("OIDC login", () => {
  const member = { id: "u1", role: "member" as const, oidc_sub: null };
  it("unknown person gets a pending account", () => {
    expect(decideOidcLogin(undefined, undefined, true)).toEqual({ action: "create-pending" });
  });
  it("unverified e-mail is never linked to an existing account", () => {
    expect(decideOidcLogin(undefined, member, false)).toEqual({ action: "create-pending" });
  });
  it("verified e-mail links to the existing account", () => {
    expect(decideOidcLogin(undefined, member, true)).toEqual({ action: "link", id: "u1" });
  });
});

describe("data access", () => {
  it("pending users see no data, members and admins do", () => {
    expect(canAccessData("pending")).toBe(false);
    expect(canAccessData(null)).toBe(false);
    expect(canAccessData("member")).toBe(true);
    expect(canAccessData("admin")).toBe(true);
  });
});

import { lastAdminError } from "./auth-core";
describe("last admin protection", () => {
  it("blocks demoting the only admin", () => expect(lastAdminError("admin", "member", 1)).not.toBeNull());
  it("blocks deleting the only admin", () => expect(lastAdminError("admin", null, 1)).not.toBeNull());
  it("allows demoting when another admin exists", () => expect(lastAdminError("admin", "member", 2)).toBeNull());
  it("allows changing non-admins", () => expect(lastAdminError("member", null, 1)).toBeNull());
});
