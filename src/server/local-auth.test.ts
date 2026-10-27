// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "bauplan-auth-"));
const previousDir = process.env["DATA_DIR"];
let la: typeof import("./local-auth");

beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  la = await import("./local-auth");
});

afterAll(() => {
  if (previousDir === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previousDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("own password change", () => {
  it("requires the current password and ends other sessions", async () => {
    const id = await la.createInitialAdmin({ email: "admin@example.test", password: "old-password" });
    const current = await la.createSession(id);
    const other = await la.createSession(id);

    await expect(la.changeOwnPassword(id, "wrong", "new-password", current.token)).rejects.toThrow(
      "Das aktuelle Passwort ist falsch.",
    );
    await la.changeOwnPassword(id, "old-password", "new-password", current.token);

    expect(await la.checkPassword("admin@example.test", "old-password")).toBeNull();
    expect((await la.checkPassword("admin@example.test", "new-password"))?.id).toBe(id);
    expect((await la.userFromToken(current.token))?.id).toBe(id);
    expect(await la.userFromToken(other.token)).toBeNull();
  });

  it("lets OIDC-only accounts set a first local password", async () => {
    const id = await la.createUser({ email: "sso@example.test", role: "member", oidc_sub: "sso" });
    expect(await la.hasPassword(id)).toBe(false);
    await la.changeOwnPassword(id, "", "first-password", undefined);
    expect((await la.checkPassword("sso@example.test", "first-password"))?.id).toBe(id);
  });
});

describe("OIDC account matching", () => {
  it("links by e-mail even if the provider does not mark it verified", async () => {
    const id = await la.createUser({ email: "member@example.test", password: "password1", role: "member" });
    const user = await la.upsertOidcUser({ sub: "sub-1", email: "Member@Example.test", email_verified: false });
    expect(user.id).toBe(id);
    expect(user.oidc_sub).toBe("sub-1");
  });

  it("relinks to a new subject and replaces an earlier pending duplicate", async () => {
    const id = (await la.listUsers()).find((u) => u.email === "member@example.test")!.id;
    const duplicate = await la.createUser({ email: "sub-2@oidc.local", role: "pending", oidc_sub: "sub-2" });
    const user = await la.upsertOidcUser({ sub: "sub-2", email: "member@example.test" });
    expect(user.id).toBe(id);
    expect(user.oidc_sub).toBe("sub-2");
    expect((await la.listUsers()).some((u) => u.id === duplicate)).toBe(false);
  });

  it("creates a pending account for unknown people", async () => {
    const user = await la.upsertOidcUser({ sub: "sub-3", email: "new@example.test" });
    expect(user.role).toBe("pending");
    expect(user.email).toBe("new@example.test");
  });
});
