// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { pushConfiguration, runPushCycle, testPush } from "./push";
import { pushRepo, sqliteRepo, getSqliteDb } from "./repo";

vi.mock("web-push", async (original) => {
  const module = await original<{ default: typeof import("web-push") }>();
  return {
    ...module,
    default: {
      ...module.default,
      sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "bauplan-push-"));
const previous = { data: process.env["DATA_DIR"] };
const repo = sqliteRepo();
let db: Awaited<ReturnType<typeof getSqliteDb>>;
const subscription = (id: string) => ({
  endpoint: `https://web.push.apple.com/${id}`,
  keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
});
beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  db = await getSqliteDb();
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T07:00:00Z"));
  db.exec(
    "DELETE FROM app_push_deliveries; DELETE FROM app_push_jobs; DELETE FROM app_push_subscriptions; DELETE FROM tasks; DELETE FROM offers; DELETE FROM expenses; DELETE FROM events; DELETE FROM app_users; DELETE FROM app_sessions; DELETE FROM app_sync_operations;",
  );
  for (const [id, role] of [
    ["alice", "admin"],
    ["bob", "member"],
    ["pending", "pending"],
  ]) {
    db.prepare("INSERT INTO app_users(id,email,role,created_at) VALUES (?,?,?,?)").run(
      id,
      `${id}@example.org`,
      role,
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)").run(
      id,
      id,
      "2027-01-01T00:00:00Z",
    );
    await pushRepo.subscribe(id!, id!, subscription(id!), "en");
  }
});
afterEach(() => vi.useRealTimers());
afterAll(() => {
  if (previous.data === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previous.data;
  rmSync(dir, { recursive: true, force: true });
});
const sent = () => vi.mocked(webpush.sendNotification);

describe("persistent Web Push delivery", () => {
  it("uses the admin email automatically and preserves keys when the contact changes", async () => {
    const configuration = await pushConfiguration();
    expect(configuration?.subject).toBe("mailto:alice@example.org");
    await testPush("bob", subscription("bob").endpoint);
    expect(sent()).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        vapidDetails: expect.objectContaining({ subject: "mailto:alice@example.org" }),
      }),
    );
    db.prepare("UPDATE app_users SET email = ? WHERE id = 'alice'").run("admin@example.org");
    expect(await pushConfiguration()).toEqual({
      ...configuration,
      subject: "mailto:admin@example.org",
    });
  });
  it("selects the oldest admin deterministically and follows role changes", async () => {
    db.prepare("UPDATE app_users SET role = 'admin' WHERE id = 'bob'").run();
    expect((await pushConfiguration())?.subject).toBe("mailto:alice@example.org");
    db.prepare("UPDATE app_users SET created_at = '2025-01-01T00:00:00Z' WHERE id = 'bob'").run();
    expect((await pushConfiguration())?.subject).toBe("mailto:bob@example.org");
    db.prepare("UPDATE app_users SET role = 'member' WHERE id = 'bob'").run();
    expect((await pushConfiguration())?.subject).toBe("mailto:alice@example.org");
  });
  it("does not configure delivery without a valid admin contact", async () => {
    db.prepare("UPDATE app_users SET email = 'invalid' WHERE id = 'alice'").run();
    expect(await pushConfiguration()).toBeNull();
    db.prepare("UPDATE app_users SET role = 'member' WHERE id = 'alice'").run();
    expect(await pushConfiguration()).toBeNull();
    await runPushCycle();
    expect(sent()).not.toHaveBeenCalled();
  });
  it("rolls task creation back if its assignment notification cannot be persisted", async () => {
    db.exec(
      "CREATE TRIGGER reject_push BEFORE INSERT ON app_push_jobs BEGIN SELECT RAISE(FAIL, 'push disk error'); END;",
    );
    try {
      await expect(
        repo.insert("tasks", { id: "rollback", assignee_id: "bob", status: "offen" }, "alice"),
      ).rejects.toThrow("push disk error");
      expect(db.prepare("SELECT id FROM tasks WHERE id = 'rollback'").get()).toBeUndefined();
    } finally {
      db.exec("DROP TRIGGER reject_push");
    }
  });
  it("does not enqueue a conflicted offline assignment", async () => {
    await repo.insert("tasks", { id: "conflict", title: "Current", assignee_id: "alice" });
    expect(
      await repo.applySyncChange("alice", {
        id: "conflict-op",
        table: "tasks",
        action: "update",
        rowId: "conflict",
        base: { title: "Old" },
        row: { assignee_id: "bob" },
      }),
    ).toMatchObject({ applied: false });
    expect(db.prepare("SELECT * FROM app_push_jobs").all()).toHaveLength(0);
  });
  it("notifies only the new assignee and never repeats an unchanged or self-assignment", async () => {
    await repo.insert(
      "tasks",
      { id: "task", title: "Sensitive title", assignee_id: "bob", status: "offen" },
      "alice",
    );
    await runPushCycle();
    expect(sent()).toHaveBeenCalledOnce();
    expect(sent().mock.calls[0]?.[0].endpoint).toBe(subscription("bob").endpoint);
    expect(sent().mock.calls[0]?.[1]).not.toContain("Sensitive title");
    expect(JSON.parse(String(sent().mock.calls[0]?.[1])).url).toBe("/aufgaben?eintrag=task");
    await repo.update("tasks", "task", { title: "Updated" }, "alice");
    await runPushCycle();
    await repo.update("tasks", "task", { assignee_id: "alice" }, "alice");
    await runPushCycle();
    expect(sent()).toHaveBeenCalledOnce();
  });
  it("queues sync assignments atomically and ignores retries of the same offline operation", async () => {
    const change = {
      id: "op",
      table: "tasks" as const,
      action: "create" as const,
      rowId: "offline-task",
      base: null,
      row: { title: "Offline", assignee_id: "bob", status: "offen" },
    };
    expect(await repo.applySyncChange("alice", change)).toMatchObject({ applied: true });
    expect(await repo.applySyncChange("alice", change)).toMatchObject({ applied: true });
    expect(db.prepare("SELECT * FROM app_push_jobs").all()).toHaveLength(1);
    await runPushCycle();
    expect(sent()).toHaveBeenCalledOnce();
  });
  it("skips obsolete assignments and completed tasks", async () => {
    await repo.insert("tasks", { id: "task", assignee_id: "bob", status: "offen" }, "alice");
    await repo.update("tasks", "task", { status: "erledigt" }, "alice");
    await runPushCycle();
    expect(sent()).not.toHaveBeenCalled();
  });
  it("sends a deadline once to each approved subscribed user and skips paid/rejected rows", async () => {
    await repo.insert("offers", { id: "open", status: "received", valid_until: "2026-10-30" });
    await repo.insert("offers", { id: "rejected", status: "rejected", valid_until: "2026-10-30" });
    await repo.insert("expenses", { id: "paid", status: "bezahlt", due_date: "2026-10-30" });
    vi.setSystemTime(new Date("2026-10-27T08:00:00Z"));
    await runPushCycle();
    await runPushCycle();
    expect(sent()).toHaveBeenCalledTimes(2);
    expect(
      sent()
        .mock.calls.map((call) => call[0].endpoint)
        .sort(),
    ).toEqual([subscription("alice").endpoint, subscription("bob").endpoint]);
  });
  it("retries transient failures but removes expired subscriptions", async () => {
    await repo.insert("tasks", { id: "task", assignee_id: "bob", status: "offen" }, "alice");
    sent().mockRejectedValueOnce(new Error("network"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runPushCycle();
    expect(sent()).toHaveBeenCalledOnce();
    await runPushCycle();
    expect(sent()).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date("2026-10-27T07:02:00Z"));
    sent().mockRejectedValueOnce(
      new webpush.WebPushError("gone", 410, {}, "", subscription("bob").endpoint),
    );
    await runPushCycle();
    expect(sent()).toHaveBeenCalledTimes(2);
    expect(await pushRepo.devices("bob")).toHaveLength(0);
    log.mockRestore();
  });
  it("stops delivery after logout and rejects a different user's test endpoint", async () => {
    await expect(testPush("alice", subscription("bob").endpoint)).rejects.toThrow(
      "push.device_missing",
    );
    await repo.insert("tasks", { id: "task", assignee_id: "bob", status: "offen" }, "alice");
    db.prepare("DELETE FROM app_sessions WHERE user_id = 'bob'").run();
    await runPushCycle();
    expect(sent()).not.toHaveBeenCalled();
    expect(await pushRepo.devices("bob")).toHaveLength(0);
  });
  it("claims a delivery with a lease so another worker cannot send it concurrently", async () => {
    await repo.insert("tasks", { id: "task", assignee_id: "bob", status: "offen" }, "alice");
    await pushRepo.prepare([], new Date());
    const first = await pushRepo.claim(new Date());
    expect(first?.device.userId).toBe("bob");
    expect(await pushRepo.claim(new Date())).toBeNull();
    vi.setSystemTime(new Date("2026-10-27T07:03:00Z"));
    expect((await pushRepo.claim(new Date()))?.job.id).toBe(first?.job.id);
  });
});
