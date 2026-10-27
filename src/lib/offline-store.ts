import { openDB, type IDBPDatabase } from "idb";
import type { TableName, Workspace } from "./schema";

const DB_NAME = "bauplan-offline";
const DB_VERSION = 2;
const ACCOUNT_KEY = "bauplan.offline.account";
const LOGOUT_KEY = "bauplan.offline.logout";
export const OFFLINE_QUEUE_CHANGE_EVENT = "bauplan:offline-queue-change";

export type OfflineChange = {
  id: string;
  userId: string;
  sequence: number;
  table: TableName;
  action: "create" | "update" | "delete";
  rowId: string;
  base: Record<string, unknown> | null;
  row: Record<string, unknown> | null;
  syncGeneration?: string | undefined;
  conflict?: Record<string, unknown> | null;
};

export type PendingUpload = {
  id: string;
  userId: string;
  file: Blob;
  name: string;
  mime: string;
  meta: Record<string, unknown>;
  syncGeneration?: string | undefined;
};

type OfflineDb = {
  snapshots: { key: string; value: Workspace };
  changes: OfflineChange;
  uploads: PendingUpload;
};

let dbPromise: Promise<IDBPDatabase<OfflineDb>> | undefined;

function database() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
        const changes = db.objectStoreNames.contains("changes")
          ? transaction.objectStore("changes")
          : db.createObjectStore("changes", { keyPath: "id" });
        if (!changes.indexNames.contains("userId")) changes.createIndex("userId", "userId");
        const uploads = db.objectStoreNames.contains("uploads")
          ? transaction.objectStore("uploads")
          : db.createObjectStore("uploads", { keyPath: "id" });
        if (!uploads.indexNames.contains("userId")) uploads.createIndex("userId", "userId");
        if (!db.objectStoreNames.contains("metadata")) db.createObjectStore("metadata");
        if (oldVersion < 2) {
          const sequenceByUser = new Map<string, number>();
          void changes.getAll().then((previousChanges) => {
            for (const change of previousChanges) {
              const nextSequence = (sequenceByUser.get(change.userId) ?? 0) + 1;
              const sequence =
                typeof change.sequence === "number"
                  ? Math.max(nextSequence, change.sequence)
                  : nextSequence;
              sequenceByUser.set(change.userId, sequence);
              if (typeof change.sequence !== "number") changes.put({ ...change, sequence });
            }
            for (const [userId, sequence] of sequenceByUser)
              transaction.objectStore("metadata").put(sequence, userId);
          });
        }
      },
    });
  }
  return dbPromise;
}

export type OfflineAccount = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  syncGeneration?: string | undefined;
};

export function setOfflineAccount(account: OfflineAccount) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function getOfflineAccount(): OfflineAccount | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(ACCOUNT_KEY);
  if (!value) return null;
  try {
    const account = JSON.parse(value) as OfflineAccount;
    if (
      typeof account.id !== "string" ||
      typeof account.email !== "string" ||
      (account.name !== null && typeof account.name !== "string") ||
      !["admin", "member"].includes(account.role)
    )
      return null;
    return account;
  } catch {
    return null;
  }
}

export function clearOfflineAccount() {
  localStorage.removeItem(ACCOUNT_KEY);
}

export function signalOfflineQueueChange() {
  window.dispatchEvent(new Event(OFFLINE_QUEUE_CHANGE_EVENT));
}

export function requestOfflineLogout() {
  localStorage.setItem(LOGOUT_KEY, "1");
}

export function hasPendingOfflineLogout() {
  return localStorage.getItem(LOGOUT_KEY) === "1";
}

export function clearPendingOfflineLogout() {
  localStorage.removeItem(LOGOUT_KEY);
}

export async function saveSnapshot(userId: string, workspace: Workspace) {
  await (await database()).put("snapshots", structuredClone(workspace), userId);
}

export async function loadSnapshot(userId: string) {
  const snapshot = await (await database()).get("snapshots", userId);
  return snapshot ? { ...snapshot, funding_entries: snapshot.funding_entries ?? [] } : undefined;
}

export async function saveChange(change: OfflineChange) {
  await (await database()).put("changes", change);
}

export async function persistChange(userId: string, workspace: Workspace, change: OfflineChange) {
  const db = await database();
  const tx = db.transaction(["snapshots", "changes", "metadata"], "readwrite");
  const sequence = Number((await tx.objectStore("metadata").get(userId)) ?? 0) + 1;
  await Promise.all([
    tx.objectStore("snapshots").put(structuredClone(workspace), userId),
    tx.objectStore("changes").put({ ...change, sequence }),
    tx.objectStore("metadata").put(sequence, userId),
  ]);
  await tx.done;
}

export async function persistUpload(userId: string, workspace: Workspace, upload: PendingUpload) {
  const db = await database();
  const tx = db.transaction(["snapshots", "uploads"], "readwrite");
  await Promise.all([
    tx.objectStore("snapshots").put(structuredClone(workspace), userId),
    tx.objectStore("uploads").put(upload),
  ]);
  await tx.done;
}

export async function listChanges(userId: string) {
  return (await database())
    .getAllFromIndex("changes", "userId", userId)
    .then((changes) => changes.sort((left, right) => left.sequence - right.sequence));
}

export async function removeChange(id: string) {
  await (await database()).delete("changes", id);
}

export async function saveUpload(upload: PendingUpload) {
  await (await database()).put("uploads", upload);
}

export async function listUploads(userId: string) {
  return (await database()).getAllFromIndex("uploads", "userId", userId);
}

export async function removeUpload(id: string) {
  await (await database()).delete("uploads", id);
}

export async function clearAccountData(userId: string) {
  const db = await database();
  const tx = db.transaction(["snapshots", "changes", "uploads", "metadata"], "readwrite");
  await Promise.all([
    tx.objectStore("snapshots").delete(userId),
    tx.objectStore("metadata").delete(userId),
    tx
      .objectStore("changes")
      .index("userId")
      .openCursor(IDBKeyRange.only(userId))
      .then(async (cursor) => {
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      }),
    tx
      .objectStore("uploads")
      .index("userId")
      .openCursor(IDBKeyRange.only(userId))
      .then(async (cursor) => {
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      }),
  ]);
  await tx.done;
}

export function applyChange(workspace: Workspace, change: OfflineChange): Workspace {
  const copy = structuredClone(workspace);
  const rows = copy[change.table] as unknown as Record<string, unknown>[];
  const index = rows.findIndex((item) => item["id"] === change.rowId);
  if (change.action === "delete") {
    if (index !== -1) rows.splice(index, 1);
  } else if (index === -1 && change.row) {
    rows.push(change.row);
  } else if (index !== -1 && change.row) {
    rows[index] = change.row;
  }
  return copy;
}
