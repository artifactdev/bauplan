import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { getAuthState } from "@/lib/auth.functions";
import {
  createRow,
  deleteRow,
  getWorkspace,
  syncWorkspaceChanges,
  updateRow,
  uploadDocument,
} from "@/lib/data.functions";
import {
  applyChange,
  clearOfflineAccount,
  getOfflineAccount,
  loadSnapshot,
  persistChange,
  persistUpload,
  saveSnapshot,
  signalOfflineQueueChange,
  OFFLINE_QUEUE_CHANGE_EVENT,
  type OfflineChange,
} from "@/lib/offline-store";
import { BOOL_COLS, cleanRow, TABLES, type TableName, type Workspace } from "@/lib/schema";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/limits";

const EMPTY: Workspace = {
  projects: [],
  trades: [],
  cost_items: [],
  offers: [],
  invoices: [],
  documents: [],
  tasks: [],
  events: [],
  expenses: [],
  ideas: [],
  contacts: [],
  budget_pots: [],
  credit_terms: [],
  credit_repayments: [],
};

export function useWorkspace() {
  const userId = getOfflineAccount()?.id;
  const q = useQuery<Workspace>({
    queryKey: ["ws", userId],
    queryFn: async () => {
      if (!userId) throw new Error(tr("offline.no_account_available_offline"));
      if (!navigator.onLine) {
        const cached = await loadSnapshot(userId);
        if (!cached)
          throw new Error(tr("offline.saved_workspace_unavailable_offline"));
        return cached;
      }
      const workspace = await mergePendingWorkspace(userId, (await getWorkspace()) as Workspace);
      await saveSnapshot(userId, workspace);
      return workspace;
    },
    enabled: !!userId,
  });
  return { ...q, ws: q.data ?? EMPTY };
}

export function useMutations() {
  const qc = useQueryClient();
  const userId = getOfflineAccount()?.id;
  const key = ["ws", userId];
  const done = () => {
    signalOfflineQueueChange();
    return qc.invalidateQueries({ queryKey: ["ws"] });
  };
  const onError = (e: Error) => toast.error(tr(e.message));

  const create = useMutation({
    mutationFn: async (v: { table: TableName; row: Record<string, unknown> }) => {
      if (navigator.onLine) return createRow({ data: v });
      const account = requireAccount(userId);
      const current = await readCachedWorkspace(qc, key, account.id);
      const rowId = typeof v.row["id"] === "string" ? v.row["id"] : crypto.randomUUID();
      const row = completeRow(v.table, {
        ...v.row,
        id: rowId,
        created_at: new Date().toISOString(),
      });
      const change: OfflineChange = {
        id: crypto.randomUUID(),
        userId: account.id,
        sequence: 0,
        table: v.table,
        action: "create",
        rowId,
        base: null,
        row,
        syncGeneration: account.syncGeneration,
      };
      const next = applyChange(current, change);
      await persistChange(account.id, next, change);
      qc.setQueryData(key, next);
      return { id: rowId };
    },
    onSuccess: done,
    onError,
  });

  const update = useMutation({
    mutationFn: async (v: { table: TableName; id: string; patch: Record<string, unknown> }) => {
      if (navigator.onLine) return updateRow({ data: v });
      const account = requireAccount(userId);
      const current = await readCachedWorkspace(qc, key, account.id);
      const base = findRow(current, v.table, v.id);
      const row = { ...base, ...cleanRow(v.table, v.patch) };
      const change: OfflineChange = {
        id: crypto.randomUUID(),
        userId: account.id,
        sequence: 0,
        table: v.table,
        action: "update",
        rowId: v.id,
        base,
        row,
        syncGeneration: account.syncGeneration,
      };
      const next = applyChange(current, change);
      await persistChange(account.id, next, change);
      qc.setQueryData(key, next);
      return { ok: true };
    },
    onSuccess: done,
    onError,
  });

  const remove = useMutation({
    mutationFn: async (v: { table: TableName; id: string }) => {
      if (navigator.onLine) return deleteRow({ data: v });
      const account = requireAccount(userId);
      const current = await readCachedWorkspace(qc, key, account.id);
      const base = findRow(current, v.table, v.id);
      const change: OfflineChange = {
        id: crypto.randomUUID(),
        userId: account.id,
        sequence: 0,
        table: v.table,
        action: "delete",
        rowId: v.id,
        base,
        row: null,
        syncGeneration: account.syncGeneration,
      };
      const next = applyChange(current, change);
      await persistChange(account.id, next, change);
      qc.setQueryData(key, next);
      return { ok: true };
    },
    onSuccess: done,
    onError,
  });

  const upload = useMutation({
    mutationFn: async (v: { file: File; meta: Record<string, unknown> }) => {
      if (v.file.size > MAX_UPLOAD_BYTES) throw new Error(tr("offline.file_too_large", { max: MAX_UPLOAD_MB }));
      if (navigator.onLine) {
        const fd = new FormData();
        fd.append("file", v.file);
        fd.append("meta", JSON.stringify(v.meta));
        return uploadDocument({ data: fd });
      }
      const account = requireAccount(userId);
      const current = await readCachedWorkspace(qc, key, account.id);
      const id = crypto.randomUUID();
      const meta = cleanRow("documents", {
        ...v.meta,
        name: v.file.name,
        category: v.meta["category"] ?? "Sonstiges",
        storage_path: `offline:${id}`,
        mime_type: v.file.type || "application/octet-stream",
        size: v.file.size,
      });
      const documentRow = completeRow("documents", {
        ...meta,
        id,
        created_at: new Date().toISOString(),
      });
      const next = applyChange(current, {
        id,
        userId: account.id,
        sequence: 0,
        table: "documents",
        action: "create",
        rowId: id,
        base: null,
        row: documentRow,
      });
      await persistUpload(account.id, next, {
        id,
        userId: account.id,
        file: v.file,
        name: v.file.name,
        mime: v.file.type || "application/octet-stream",
        meta: documentRow,
        syncGeneration: account.syncGeneration,
      });
      qc.setQueryData(key, next);
      return { id };
    },
    onSuccess: done,
    onError,
  });

  return { create, update, remove, upload };
}

function requireAccount(userId: string | undefined) {
  const account = getOfflineAccount();
  if (!userId || !account || account.id !== userId)
    throw new Error(tr("offline.no_account_available_offline"));
  return account;
}

async function readCachedWorkspace(
  qc: ReturnType<typeof useQueryClient>,
  key: QueryKey,
  userId: string,
): Promise<Workspace> {
  const cached = qc.getQueryData<Workspace>(key) ?? (await loadSnapshot(userId));
  if (!cached) throw new Error(tr("offline.saved_workspace_unavailable_offline"));
  return cached;
}

function completeRow(table: TableName, value: Record<string, unknown>) {
  const columns = Object.fromEntries(
    (TABLES[table] as readonly string[]).map((column) => [
      column,
      value[column] ?? (BOOL_COLS.has(column) ? false : null),
    ]),
  );
  return {
    id: value["id"],
    created_at: value["created_at"],
    ...cleanRow(table, { ...columns, ...value }),
  };
}

function findRow(workspace: Workspace, table: TableName, id: string) {
  const row = (workspace[table] as unknown as Record<string, unknown>[]).find(
    (item) => item["id"] === id,
  );
  if (!row) throw new Error(tr("offline.item_unavailable_offline_workspace"));
  return row;
}

export function useOfflineSync(userId: string) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState<OfflineChange[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [changes, uploads] = await Promise.all([
      import("@/lib/offline-store").then((store) => store.listChanges(userId)),
      import("@/lib/offline-store").then((store) => store.listUploads(userId)),
    ]);
    setPending(changes.length + uploads.length);
    setConflicts(changes.filter((change) => change.conflict !== undefined));
  }, [userId]);

  const sync = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const auth = await getAuthState();
      const user = auth.user;
      if (!user || user.id !== userId || (user.role !== "admin" && user.role !== "member")) {
        clearOfflineAccount();
        window.location.href = "/auth";
        throw new Error(
          tr(
            "offline.session_no_longer_active",
          ),
        );
      }
      const store = await import("@/lib/offline-store");
      const uploads = await store.listUploads(userId);
      const uploadedDocuments = new Map<string, { storage_path: string; created_at: string }>();
      for (const upload of uploads) {
        const form = new FormData();
        form.append("file", new File([upload.file], upload.name, { type: upload.mime }));
        form.append("meta", JSON.stringify(upload.meta));
        form.append("syncGeneration", upload.syncGeneration ?? "");
        const result = await uploadDocument({ data: form });
        uploadedDocuments.set(upload.id, {
          storage_path: result.storage_path,
          created_at: result.created_at,
        });
        await store.removeUpload(upload.id);
      }
      const changes = await store.listChanges(userId);
      const waiting = changes.filter((change) => change.conflict === undefined);
      for (const change of waiting) {
        const uploadedDocument = uploadedDocuments.get(change.rowId);
        if (change.table === "documents" && uploadedDocument) {
          const { conflict: _conflict, ...withoutConflict } = change;
          const rebased = {
            ...withoutConflict,
            base: change.base ? { ...change.base, ...uploadedDocument } : null,
            row: change.row ? { ...change.row, ...uploadedDocument } : null,
          };
          await store.saveChange(rebased);
          Object.assign(change, rebased);
        }
        const [result] = await syncWorkspaceChanges({
          data: {
            changes: [
              {
                id: change.id,
                table: change.table,
                action: change.action,
                rowId: change.rowId,
                base: change.base,
                row: change.row,
                syncGeneration: change.syncGeneration ?? null,
              },
            ],
          },
        });
        if (result?.applied) await store.removeChange(change.id);
        else {
          await store.saveChange({ ...change, conflict: result?.current ?? null });
          break;
        }
      }
      await qc.invalidateQueries({ queryKey: ["ws", userId] });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? tr(error.message)
          : tr("offline.offline_synchronization_failed"),
      );
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      try {
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? tr(error.message)
            : tr("offline.not_load_offline_status"),
        );
      }
    }
  }, [qc, refresh, userId]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_QUEUE_CHANGE_EVENT, refresh);
    void refresh();
    if (navigator.onLine) void sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, refresh);
    };
  }, [refresh, sync]);

  const resolveConflict = async (keepLocal: boolean) => {
    const conflict = conflicts[0];
    if (!conflict) return;
    const store = await import("@/lib/offline-store");
    if (keepLocal) {
      const { conflict: _conflict, ...rebased } = conflict;
      if (conflict.action === "delete" && conflict.conflict === null) {
        await store.removeChange(conflict.id);
      } else {
        const action =
          conflict.action === "create" && conflict.conflict !== null
            ? "update"
            : conflict.action === "update" && conflict.conflict === null
              ? "create"
              : conflict.action;
        await store.saveChange({
          ...rebased,
          action,
          base: conflict.conflict ?? null,
        });
      }
    } else {
      await store.removeChange(conflict.id);
      const current = await loadSnapshot(userId);
      if (current) {
        const serverRow = conflict.conflict ?? null;
        const localRows = current[conflict.table] as unknown as { id: string }[];
        const serverChange: OfflineChange = {
          id: crypto.randomUUID(),
          userId,
          sequence: 0,
          table: conflict.table,
          action:
            serverRow === null
              ? "delete"
              : localRows.some((row) => row.id === conflict.rowId)
                ? "update"
                : "create",
          rowId: conflict.rowId,
          base: null,
          row: serverRow,
          syncGeneration: getOfflineAccount()?.syncGeneration,
        };
        const restored = applyChange(current, serverChange);
        const workspace = await mergePendingWorkspace(userId, restored);
        await saveSnapshot(userId, workspace);
        qc.setQueryData(["ws", userId], workspace);
      }
    }
    await refresh();
    if (keepLocal) await sync();
    else await qc.invalidateQueries({ queryKey: ["ws", userId] });
  };

  return { online, pending, conflicts, syncing, sync, resolveConflict };
}

async function mergePendingWorkspace(userId: string, workspace: Workspace) {
  const store = await import("@/lib/offline-store");
  const [uploads, changes] = await Promise.all([
    store.listUploads(userId),
    store.listChanges(userId),
  ]);
  let merged = workspace;
  for (const upload of uploads) {
    if (merged.documents.some((document) => document.id === upload.id)) continue;
    merged = applyChange(merged, {
      id: upload.id,
      userId,
      sequence: 0,
      table: "documents",
      action: "create",
      rowId: upload.id,
      base: null,
      row: upload.meta,
    });
  }
  return changes.reduce((current, change) => applyChange(current, change), merged);
}
