import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  applyChange,
  clearAccountData,
  clearOfflineAccount,
  getOfflineAccount,
  listChanges,
  listUploads,
  loadSnapshot,
  persistChange,
  persistUpload,
  saveSnapshot,
  setOfflineAccount,
  type OfflineChange,
} from "./offline-store";
import type { Workspace } from "./schema";

const emptyWorkspace: Workspace = {
  projects: [],
  trades: [],
  cost_items: [],
  offers: [],
  invoices: [],
  documents: [],
  tasks: [],
  events: [],
  ideas: [],
  contacts: [],
  expenses: [],
  budget_pots: [],
  credit_terms: [],
  credit_repayments: [],
};

describe("account-scoped offline storage", () => {
  it("keeps snapshots and queued data separate, and clears only the signed-out account", async () => {
    await createVersionOneDatabase();
    setOfflineAccount({ id: "account-a", email: "a@example.test", name: "A", role: "member" });
    expect(getOfflineAccount()?.id).toBe("account-a");
    const change: OfflineChange = {
      id: "change-z",
      userId: "account-a",
      sequence: 0,
      table: "projects",
      action: "create",
      rowId: "project-a",
      base: null,
      row: { id: "project-a", name: "Offline project" },
    };
    const updated = applyChange(emptyWorkspace, change);
    const followup: OfflineChange = {
      ...change,
      id: "change-a",
      action: "update",
      base: change.row,
      row: { ...change.row, name: "Updated offline project" },
    };
    await Promise.all([
      persistChange("account-a", updated, change),
      saveSnapshot("account-b", emptyWorkspace),
      persistUpload("account-a", updated, {
        id: "upload-a",
        userId: "account-a",
        file: new Blob(["document"]),
        name: "document.txt",
        mime: "text/plain",
        meta: { id: "upload-a" },
      }),
    ]);
    await persistChange("account-a", applyChange(updated, followup), followup);

    expect((await loadSnapshot("account-a"))?.projects).toHaveLength(1);
    expect((await loadSnapshot("account-b"))?.projects).toHaveLength(0);
    expect(await listChanges("account-b")).toHaveLength(0);
    expect(await listUploads("account-b")).toHaveLength(0);
    expect((await listChanges("account-a")).map((item) => item.id)).toEqual([
      "change-z",
      "change-a",
    ]);
    expect((await listChanges("legacy-account"))[0]?.sequence).toBe(1);

    await clearAccountData("account-a");

    expect(await loadSnapshot("account-a")).toBeUndefined();
    expect(await listChanges("account-a")).toHaveLength(0);
    expect(await listUploads("account-a")).toHaveLength(0);
    expect(await loadSnapshot("account-b")).toBeDefined();
    await clearAccountData("legacy-account");
    clearOfflineAccount();
    expect(getOfflineAccount()).toBeNull();
  });
});

async function createVersionOneDatabase() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bauplan-offline", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("snapshots");
      const changes = database.createObjectStore("changes", { keyPath: "id" });
      changes.createIndex("userId", "userId");
      const uploads = database.createObjectStore("uploads", { keyPath: "id" });
      uploads.createIndex("userId", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction("changes", "readwrite");
  tx.objectStore("changes").put({
    id: "legacy-change",
    userId: "legacy-account",
    table: "projects",
    action: "create",
    rowId: "legacy-project",
    base: null,
    row: { id: "legacy-project", name: "Legacy change" },
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
