// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportBackupResponse } from "./export";

const mocks = vi.hoisted(() => ({
  userFromToken: vi.fn(),
  createBackup: vi.fn(),
  sqliteRepo: vi.fn(() => ({})),
}));

vi.mock("@/server/local-auth", () => ({
  SESSION_COOKIE: "session",
  cookieFrom: () => "token",
  userFromToken: mocks.userFromToken,
}));
vi.mock("@/server/backup", () => ({ createBackup: mocks.createBackup }));
vi.mock("@/server/repo", () => ({ sqliteRepo: mocks.sqliteRepo }));

describe("backup export endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFromToken.mockResolvedValue({ role: "admin" });
    mocks.createBackup.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("only lets administrators export and selects the requested backup type", async () => {
    mocks.userFromToken.mockResolvedValueOnce(null).mockResolvedValueOnce({ role: "member" });
    expect(
      (await exportBackupResponse(new Request("http://localhost/api/backup/export"))).status,
    ).toBe(401);
    expect(
      (await exportBackupResponse(new Request("http://localhost/api/backup/export"))).status,
    ).toBe(403);
    const full = await exportBackupResponse(new Request("http://localhost/api/backup/export"));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("application/zip");
    expect(mocks.createBackup).toHaveBeenLastCalledWith({}, true);
    const database = await exportBackupResponse(
      new Request("http://localhost/api/backup/export?mode=database"),
    );
    expect(database.status).toBe(200);
    expect(mocks.createBackup).toHaveBeenLastCalledWith({}, false);
    expect(
      (await exportBackupResponse(new Request("http://localhost/api/backup/export?mode=invalid")))
        .status,
    ).toBe(400);
  });

  it("returns translatable known errors and hides unexpected error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.createBackup.mockRejectedValueOnce(
        new Error("Das Backup ist größer als die erlaubten 512 MB."),
      );
      const known = await exportBackupResponse(new Request("http://localhost/api/backup/export"));
      expect(known.status).toBe(500);
      expect(await known.json()).toEqual({ error: "shared.backup_exceeds_512_mb_limit" });
      mocks.createBackup.mockRejectedValueOnce(new Error("sensitive filesystem detail"));
      const unknown = await exportBackupResponse(new Request("http://localhost/api/backup/export"));
      expect(await unknown.json()).toEqual({ error: "settings.backup_export_failed" });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});
