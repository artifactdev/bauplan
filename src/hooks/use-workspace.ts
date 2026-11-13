import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { getAuthState } from "@/lib/auth.functions";
import {
  createRow,
  deleteRow,
  getProjects,
  getWorkspace,
  syncWorkspaceChanges,
  updateRow,
  uploadDocument,
} from "@/lib/data.functions";
import {
  applyChange,
  clearOfflineAccount,
  getOfflineAccount,
  loadProjectListSnapshot,
  loadSnapshot,
  persistChange,
  persistUpload,
  saveSnapshot,
  signalOfflineQueueChange,
  OFFLINE_QUEUE_CHANGE_EVENT,
  type OfflineChange,
} from "@/lib/offline-store";
import {
  BOOL_COLS,
  cleanRow,
  TABLES,
  type Project,
  type TableName,
  type Workspace,
} from "@/lib/schema";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/limits";
import { validateTaskDates } from "@/lib/tasks";
import { setActiveProjectId, useActiveProjectId } from "./use-project-selection";

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
  idea_images: [],
  contacts: [],
  budget_pots: [],
  funding_entries: [],
  credit_terms: [],
  credit_repayments: [],
};

export function useWorkspace() {
  const userId = getOfflineAccount()?.id;
  const activeProjectId = useActiveProjectId(userId);
  const projectsQuery = useQuery<Project[]>({
    queryKey: ["projects", userId],
    queryFn: async () => {
      if (!userId) throw new Error(tr("offline.no_account_available_offline"));
      if (!navigator.onLine) {
        const projects = await loadProjectListSnapshot(userId);
        if (!projects) throw new Error(tr("offline.saved_workspace_unavailable_offline"));
        return projects;
      }
      return getProjects();
    },
    enabled: !!userId,
  });
  useEffect(() => {
    const projects = projectsQuery.data;
    if (!projects || projects.some((project) => project.id === activeProjectId)) return;
    setActiveProjectId(userId, projects[0]?.id ?? null);
  }, [activeProjectId, projectsQuery.data, userId]);
  const q = useQuery<Workspace>({
    queryKey: ["ws", userId, activeProjectId],
    queryFn: async () => {
      if (!userId) throw new Error(tr("offline.no_account_available_offline"));
      if (!activeProjectId) return EMPTY;
      if (!navigator.onLine) {
        const cached = await loadSnapshot(userId, activeProjectId);
        if (!cached) throw new Error(tr("offline.saved_workspace_unavailable_offline"));
        return cached;
      }
      const workspace = await mergePendingWorkspace(
        userId,
        (await getWorkspace({ data: { projectId: activeProjectId } })) as Workspace,
        activeProjectId,
      );
      await saveSnapshot(userId, workspace, activeProjectId);
      return workspace;
    },
    enabled: !!userId && !!activeProjectId,
  });
  const projectWorkspace = q.data ?? EMPTY;
  const activeProject = projectWorkspace.projects.find((project) => project.id === activeProjectId);
  const ws = activeProject
    ? {
        ...projectWorkspace,
        projects: [
          activeProject,
          ...projectWorkspace.projects.filter((project) => project.id !== activeProject.id),
        ],
      }
    : projectWorkspace;
  return {
    ...q,
    isLoading: projectsQuery.isLoading || (!!activeProjectId && q.isLoading),
    isError: projectsQuery.isError || q.isError,
    error: projectsQuery.error ?? q.error,
    refetch: projectsQuery.isError ? projectsQuery.refetch : q.refetch,
    projects: projectsQuery.data ?? [],
    projectId: activeProjectId,
    ws,
  };
}

export function useMutations() {
  const qc = useQueryClient();
  const userId = getOfflineAccount()?.id;
  const activeProjectId = useActiveProjectId(userId);
  const key = ["ws", userId, activeProjectId];
  const done = (result: unknown) => {
    signalOfflineQueueChange();
    const queued =
      typeof result === "object" && result !== null && "queued" in result && result.queued === true;
    if (queued) {
      toast.success(tr("offline.saved_for_sync"));
      return qc.invalidateQueries({ queryKey: ["ws"], refetchType: "none" });
    }
    return qc.invalidateQueries({ queryKey: ["ws"] });
  };
  const onError = (e: Error) => toast.error(tr(e.message));

  const create = useMutation({
    networkMode: "always",
    mutationFn: async (v: { table: TableName; row: Record<string, unknown> }) => {
      if (v.table === "tasks") validateTaskDates(v.row);
      if (v.table !== "projects" && !activeProjectId)
        throw new Error(tr("offline.no_active_project"));
      if (navigator.onLine)
        return createRow({
          data: {
            ...v,
            ...(v.table === "projects" ? {} : { projectId: activeProjectId }),
          },
        });
      const account = requireAccount(userId);
      const current =
        v.table === "projects"
          ? (qc.getQueryData<Workspace>(key) ??
            (await loadSnapshot(account.id, activeProjectId ?? undefined)) ??
            EMPTY)
          : await readCachedWorkspace(qc, key, account.id);
      const rowId = typeof v.row["id"] === "string" ? v.row["id"] : crypto.randomUUID();
      const projectId = v.table === "projects" ? undefined : activeProjectId!;
      const snapshotProjectId = projectId ?? rowId;
      const row = completeRow(v.table, {
        ...v.row,
        id: rowId,
        ...(projectId ? { project_id: projectId } : {}),
        created_at: new Date().toISOString(),
      });
      const project = v.table === "projects" ? toProject(row) : null;
      const change: OfflineChange = {
        id: crypto.randomUUID(),
        userId: account.id,
        sequence: 0,
        table: v.table,
        action: "create",
        rowId,
        projectId: projectId ?? null,
        base: null,
        row,
        syncGeneration: account.syncGeneration,
      };
      const next = project
        ? { ...EMPTY, projects: [...current.projects, project] }
        : applyChange(current, change);
      await persistChange(account.id, next, change, snapshotProjectId);
      if (project) {
        qc.setQueryData<Project[]>(["projects", account.id], next.projects);
        qc.setQueryData(["ws", account.id, rowId], next);
      } else {
        qc.setQueryData(key, next);
      }
      return { id: rowId, queued: true };
    },
    onSuccess: (result, variables) => {
      if (
        variables.table === "projects" &&
        typeof result === "object" &&
        result !== null &&
        "id" in result &&
        typeof result.id === "string"
      ) {
        setActiveProjectId(userId, result.id);
        void qc.invalidateQueries({ queryKey: ["projects", userId] });
      }
      done(result);
    },
    onError,
  });

  const update = useMutation({
    networkMode: "always",
    mutationFn: async (v: { table: TableName; id: string; patch: Record<string, unknown> }) => {
      if (v.table !== "projects" && !activeProjectId)
        throw new Error(tr("offline.no_active_project"));
      if (navigator.onLine)
        return updateRow({
          data: {
            ...v,
            ...(v.table === "projects" ? {} : { projectId: activeProjectId }),
          },
        });
      const account = requireAccount(userId);
      const current = await readCachedWorkspace(qc, key, account.id);
      const base = findRow(current, v.table, v.id);
      const row = { ...base, ...cleanRow(v.table, v.patch) };
      if (v.table === "tasks") validateTaskDates(row);
      const change: OfflineChange = {
        id: crypto.randomUUID(),
        userId: account.id,
        sequence: 0,
        table: v.table,
        action: "update",
        rowId: v.id,
        projectId: v.table === "projects" ? null : activeProjectId,
        base,
        row,
        syncGeneration: account.syncGeneration,
      };
      const next = applyChange(current, change);
      await persistChange(account.id, next, change, activeProjectId ?? v.id);
      qc.setQueryData(key, next);
      return { ok: true, queued: true };
    },
    onSuccess: (result, variables) => {
      if (variables.table === "projects")
        void qc.invalidateQueries({ queryKey: ["projects", userId] });
      done(result);
    },
    onError,
  });

  const remove = useMutation({
    networkMode: "always",
    mutationFn: async (v: { table: TableName; id: string }) => {
      if (v.table !== "projects" && !activeProjectId)
        throw new Error(tr("offline.no_active_project"));
      if (navigator.onLine)
        return deleteRow({
          data: {
            ...v,
            ...(v.table === "projects" ? {} : { projectId: activeProjectId }),
          },
        });
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
        projectId: v.table === "projects" ? null : activeProjectId,
        base,
        row: null,
        syncGeneration: account.syncGeneration,
      };
      const next = applyChange(current, change);
      await persistChange(account.id, next, change, activeProjectId ?? v.id);
      qc.setQueryData(key, next);
      return { ok: true, queued: true };
    },
    onSuccess: done,
    onError,
  });

  const upload = useMutation({
    networkMode: "always",
    mutationFn: async (v: { file: File; meta: Record<string, unknown> }) => {
      if (v.file.size > MAX_UPLOAD_BYTES)
        throw new Error(tr("offline.file_too_large", { max: MAX_UPLOAD_MB }));
      if (!activeProjectId) throw new Error(tr("offline.no_active_project"));
      if (navigator.onLine) {
        const fd = new FormData();
        fd.append("file", v.file);
        fd.append("meta", JSON.stringify(v.meta));
        fd.append("projectId", activeProjectId);
        return uploadDocument({ data: fd });
      }
      const account = requireAccount(userId);
      const current = await readCachedWorkspace(qc, key, account.id);
      const id = crypto.randomUUID();
      const table = typeof v.meta["idea_id"] === "string" ? "idea_images" : "documents";
      const meta = cleanRow(table, {
        ...v.meta,
        project_id: activeProjectId,
        name: v.file.name,
        category: v.meta["category"] ?? "Sonstiges",
        storage_path: `offline:${id}`,
        mime_type: v.file.type || "application/octet-stream",
        size: v.file.size,
      });
      const documentRow = completeRow(table, {
        ...meta,
        id,
        created_at: new Date().toISOString(),
      });
      const next = applyChange(current, {
        id,
        userId: account.id,
        sequence: 0,
        table,
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
        projectId: activeProjectId,
        syncGeneration: account.syncGeneration,
      });
      qc.setQueryData(key, next);
      return { id, queued: true };
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
  const cached =
    qc.getQueryData<Workspace>(key) ?? (await loadSnapshot(userId, key[2] as string | undefined));
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

function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row["id"]),
    name: String(row["name"] ?? ""),
    address: typeof row["address"] === "string" ? row["address"] : null,
    total_budget: Number(row["total_budget"] ?? 0),
    start_date: typeof row["start_date"] === "string" ? row["start_date"] : null,
    end_date: typeof row["end_date"] === "string" ? row["end_date"] : null,
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
  const activeProjectId = useActiveProjectId(userId);
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
        throw new Error(tr("offline.session_no_longer_active"));
      }
      const store = await import("@/lib/offline-store");
      const projects = await getProjects();
      const legacyProjectId = projects[0]?.id;
      const queuedProjects = (await store.listChanges(userId)).filter(
        (change) => change.table === "projects" && change.conflict === undefined,
      );
      for (const change of queuedProjects) {
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
                projectId: change.projectId ?? null,
                syncGeneration: change.syncGeneration ?? null,
              },
            ],
          },
        });
        if (result?.applied) await store.removeChange(change.id);
        else {
          await store.saveChange({ ...change, conflict: result?.current ?? null });
          return;
        }
      }
      const uploads = await store.listUploads(userId);
      const uploadedDocuments = new Map<string, { storage_path: string; created_at: string }>();
      for (const upload of uploads) {
        const projectId =
          upload.projectId ??
          (typeof upload.meta["project_id"] === "string"
            ? upload.meta["project_id"]
            : legacyProjectId);
        if (!projectId) throw new Error(tr("offline.no_active_project"));
        if (!upload.projectId) {
          upload.projectId = projectId;
          upload.meta = { ...upload.meta, project_id: projectId };
          await store.saveUpload(upload);
        }
        const form = new FormData();
        form.append("file", new File([upload.file], upload.name, { type: upload.mime }));
        form.append("meta", JSON.stringify(upload.meta));
        form.append("syncGeneration", upload.syncGeneration ?? "");
        form.append("projectId", projectId);
        const result = await uploadDocument({ data: form });
        uploadedDocuments.set(upload.id, {
          storage_path: result.storage_path,
          created_at: result.created_at,
        });
        await store.removeUpload(upload.id);
      }
      const changes = (await store.listChanges(userId)).filter(
        (change) => change.table !== "projects",
      );
      const waiting = changes.filter((change) => change.conflict === undefined);
      for (const change of waiting) {
        if (change.table !== "projects" && !change.projectId) {
          const projectId =
            (typeof change.row?.["project_id"] === "string" ? change.row["project_id"] : null) ??
            (typeof change.base?.["project_id"] === "string" ? change.base["project_id"] : null) ??
            legacyProjectId;
          if (!projectId) throw new Error(tr("offline.no_active_project"));
          change.projectId = projectId;
          if (change.row) change.row.project_id = projectId;
          await store.saveChange(change);
        }
        const uploadedDocument = uploadedDocuments.get(change.rowId);
        if ((change.table === "documents" || change.table === "idea_images") && uploadedDocument) {
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
                projectId: change.projectId ?? null,
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
      await qc.invalidateQueries({ queryKey: ["projects", userId] });
      await qc.invalidateQueries({ queryKey: ["ws", userId] });
    } catch (error) {
      toast.error(
        error instanceof Error ? tr(error.message) : tr("offline.offline_synchronization_failed"),
      );
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      try {
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? tr(error.message) : tr("offline.not_load_offline_status"),
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
    const snapshotProjectId =
      conflict.projectId ?? (conflict.table === "projects" ? conflict.rowId : activeProjectId);
    if (!snapshotProjectId) throw new Error(tr("offline.no_active_project"));
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
      const current = await loadSnapshot(userId, snapshotProjectId ?? undefined);
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
          projectId: conflict.projectId ?? null,
          base: null,
          row: serverRow,
          syncGeneration: getOfflineAccount()?.syncGeneration,
        };
        const restored = applyChange(current, serverChange);
        const workspace = await mergePendingWorkspace(
          userId,
          restored,
          snapshotProjectId ?? undefined,
        );
        await saveSnapshot(userId, workspace, snapshotProjectId ?? undefined);
        qc.setQueryData(["ws", userId, snapshotProjectId], workspace);
      }
    }
    await refresh();
    if (keepLocal) await sync();
    else await qc.invalidateQueries({ queryKey: ["ws", userId] });
  };

  return { online, pending, conflicts, syncing, sync, resolveConflict };
}

async function mergePendingWorkspace(userId: string, workspace: Workspace, projectId: string) {
  const store = await import("@/lib/offline-store");
  const [uploads, changes] = await Promise.all([
    store.listUploads(userId),
    store.listChanges(userId),
  ]);
  let merged = workspace;
  for (const upload of uploads) {
    const uploadProjectId =
      upload.projectId ??
      (typeof upload.meta["project_id"] === "string" ? upload.meta["project_id"] : null);
    if (uploadProjectId && uploadProjectId !== projectId) continue;
    const table = typeof upload.meta["idea_id"] === "string" ? "idea_images" : "documents";
    if (merged[table].some((row) => row.id === upload.id)) continue;
    merged = applyChange(merged, {
      id: upload.id,
      userId,
      sequence: 0,
      table,
      action: "create",
      rowId: upload.id,
      base: null,
      row: upload.meta,
    });
  }
  return changes.reduce((current, change) => {
    if (change.table !== "projects" && change.projectId !== projectId) return current;
    return applyChange(current, change);
  }, merged);
}
