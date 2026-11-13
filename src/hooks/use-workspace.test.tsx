import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { getAuthState } from "@/lib/auth.functions";
import { EntityDialog } from "@/components/app/EntityDialog";
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
  clearAccountData,
  clearOfflineAccount,
  listChanges,
  listUploads,
  loadSnapshot,
  persistChange,
  persistUpload,
  saveSnapshot,
  saveChange,
  setOfflineAccount,
} from "@/lib/offline-store";
import type { Workspace } from "@/lib/schema";
import { useMutations, useOfflineSync, useWorkspace } from "./use-workspace";
import { getActiveProjectId, setActiveProjectId } from "./use-project-selection";

vi.mock("@/lib/data.functions", () => ({
  createRow: vi.fn(),
  updateRow: vi.fn(),
  deleteRow: vi.fn(),
  uploadDocument: vi.fn(),
  getWorkspace: vi.fn(),
  getProjects: vi.fn(),
  syncWorkspaceChanges: vi.fn(),
}));
vi.mock("@/lib/auth.functions", () => ({ getAuthState: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/app/ScanBar", () => ({ ScanBar: () => null }));
vi.mock("@/lib/offline-store", async (original) => ({
  ...(await original<typeof import("@/lib/offline-store")>()),
  persistChange: vi.fn(),
}));

const userId = "offline-mutations-test";
const empty: Workspace = {
  projects: [
    {
      id: "project-test",
      name: "Test project",
      address: null,
      total_budget: 0,
      start_date: null,
      end_date: null,
    },
  ],
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
let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  const store = await vi.importActual<typeof import("@/lib/offline-store")>("@/lib/offline-store");
  vi.mocked(persistChange).mockImplementation(store.persistChange);
  setOfflineAccount({ id: userId, email: "offline@example.test", name: "Test", role: "member" });
  setActiveProjectId(userId, "project-test");
  await saveSnapshot(userId, structuredClone(empty), "project-test");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["ws", userId, "project-test"], structuredClone(empty));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  onlineManager.setOnline(false);
});
afterEach(async () => {
  cleanup();
  client.clear();
  await clearAccountData(userId);
  setActiveProjectId(userId, null);
  clearOfflineAccount();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe("offline mutation completion", () => {
  it("persists task dates offline and rejects partial changes that reverse the range", async () => {
    const { result } = renderHook(useMutations, { wrapper: Wrapper });
    let id = "";
    await act(async () => {
      ({ id } = await result.current.create.mutateAsync({
        table: "tasks",
        row: { title: "Multi-day", start_date: "2026-11-02", due_date: "2026-11-04" },
      }));
    });
    expect((await loadSnapshot(userId, "project-test"))?.tasks[0]).toMatchObject({
      start_date: "2026-11-02",
      due_date: "2026-11-04",
    });
    await act(async () => {
      await expect(
        result.current.update.mutateAsync({
          table: "tasks",
          id,
          patch: { due_date: "2026-11-01" },
        }),
      ).rejects.toThrow("tasks.due_before_start");
    });
    expect(await listChanges(userId)).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith("The due date must not be before the start date.");
    expect((await loadSnapshot(userId, "project-test"))?.tasks[0]?.due_date).toBe("2026-11-04");
  });
  it("persists a new entry and completes even when React Query is offline", async () => {
    const { result } = renderHook(
      () => ({ mutations: useMutations(), workspace: useWorkspace() }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutations.create.mutateAsync({
        table: "tasks",
        row: { title: "Offline task" },
      });
    });
    expect(result.current.mutations.create.isPaused).toBe(false);
    await waitFor(() => expect(result.current.mutations.create.isSuccess).toBe(true));
    expect((await listChanges(userId))[0]?.row?.["title"]).toBe("Offline task");
    expect((await listChanges(userId))[0]).toMatchObject({
      projectId: "project-test",
      row: { project_id: "project-test" },
    });
    expect((await loadSnapshot(userId, "project-test"))?.tasks[0]?.title).toBe("Offline task");
    expect(result.current.workspace.ws.tasks[0]?.title).toBe("Offline task");
    expect(createRow).not.toHaveBeenCalled();
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("sync automatically"));
  });

  it("completes queued updates, deletions and file uploads without a server", async () => {
    const { result } = renderHook(useMutations, { wrapper: Wrapper });
    let id = "";
    await act(async () => {
      ({ id } = await result.current.create.mutateAsync({
        table: "tasks",
        row: { title: "Original" },
      }));
      await result.current.update.mutateAsync({ table: "tasks", id, patch: { title: "Changed" } });
      await result.current.remove.mutateAsync({ table: "tasks", id });
      await result.current.upload.mutateAsync({
        file: new File(["pdf"], "test.pdf", { type: "application/pdf" }),
        meta: {},
      });
    });
    expect((await listChanges(userId)).map((change) => change.action)).toEqual([
      "create",
      "update",
      "delete",
    ]);
    expect(await listUploads(userId)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledTimes(4);
    expect(updateRow).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  function Form() {
    const [open, setOpen] = useState(true);
    const { create } = useMutations();
    return (
      <EntityDialog
        open={open}
        onOpenChange={setOpen}
        title="New task"
        fields={[{ name: "title", label: "Title" }]}
        onSubmit={(row) => create.mutateAsync({ table: "tasks", row })}
      />
    );
  }

  it("closes the save modal after durable local storage and shows the queued-success toast", async () => {
    render(<Form />, { wrapper: Wrapper });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Local task" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await listChanges(userId)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("keeps the modal open and never reports success if local persistence fails", async () => {
    vi.mocked(persistChange).mockRejectedValue(new Error("Local storage full"));
    render(<Form />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Local storage full"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(await listChanges(userId)).toHaveLength(0);
  });

  it("preserves online saving without an offline-success toast", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    onlineManager.setOnline(true);
    vi.mocked(createRow).mockResolvedValue({ id: "server-id" });
    const { result } = renderHook(useMutations, { wrapper: Wrapper });
    await act(async () => {
      expect(
        await result.current.create.mutateAsync({ table: "tasks", row: { title: "Online" } }),
      ).toEqual({ id: "server-id" });
    });
    expect(createRow).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
    expect(await listChanges(userId)).toHaveLength(0);
  });

  it("selects a newly created online project", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    onlineManager.setOnline(true);
    vi.mocked(createRow).mockResolvedValue({ id: "project-new" });
    const { result } = renderHook(useMutations, { wrapper: Wrapper });
    await act(async () => {
      await result.current.create.mutateAsync({
        table: "projects",
        row: { name: "New project", total_budget: 50000 },
      });
    });
    expect(getActiveProjectId(userId)).toBe("project-new");
    expect(createRow).toHaveBeenCalledWith({
      data: { table: "projects", row: { name: "New project", total_budget: 50000 } },
    });
  });

  it("creates an isolated project while offline and keeps it selected", async () => {
    const existingWorkspace = {
      ...structuredClone(empty),
      tasks: [{ id: "existing-task", project_id: "project-test", title: "Existing task" }],
    } as Workspace;
    await saveSnapshot(userId, existingWorkspace, "project-test");
    client.setQueryData(["ws", userId, "project-test"], existingWorkspace);
    const { result } = renderHook(
      () => ({ mutations: useMutations(), workspace: useWorkspace() }),
      { wrapper: Wrapper },
    );
    let projectId = "";
    await act(async () => {
      ({ id: projectId } = await result.current.mutations.create.mutateAsync({
        table: "projects",
        row: { name: "Offline project", total_budget: 75000 },
      }));
    });
    expect(getActiveProjectId(userId)).toBe(projectId);
    expect(result.current.workspace.projects.map((project) => project.id)).toEqual([
      "project-test",
      projectId,
    ]);
    expect(result.current.workspace.ws.projects.map((project) => project.id)).toEqual([
      projectId,
      "project-test",
    ]);
    expect((await loadSnapshot(userId, projectId))?.tasks).toEqual([]);
    expect((await listChanges(userId))[0]).toMatchObject({
      table: "projects",
      projectId: null,
      row: { id: projectId, name: "Offline project" },
    });
  });

  it("syncs a queued project before uploading files assigned to it", async () => {
    setOfflineAccount({
      id: userId,
      email: "offline@example.test",
      name: "Test",
      role: "member",
      syncGeneration: "generation",
    });
    await saveChange({
      id: "project-change",
      userId,
      sequence: 1,
      table: "projects",
      action: "create",
      rowId: "project-new",
      projectId: null,
      base: null,
      row: { id: "project-new", name: "Offline project" },
      syncGeneration: "generation",
    });
    await persistUpload(
      userId,
      { ...structuredClone(empty), projects: [] },
      {
        id: "upload-new",
        userId,
        file: new Blob(["pdf"], { type: "application/pdf" }),
        name: "plan.pdf",
        mime: "application/pdf",
        meta: { project_id: "project-new" },
        projectId: "project-new",
        syncGeneration: "generation",
      },
    );
    const order: string[] = [];
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    onlineManager.setOnline(true);
    vi.mocked(getAuthState).mockResolvedValue({
      needsSetup: false,
      user: {
        id: userId,
        email: "offline@example.test",
        name: "Test",
        role: "member",
      },
      oidc: { enabled: false, label: "" },
    });
    vi.mocked(getProjects).mockResolvedValue(empty.projects);
    vi.mocked(syncWorkspaceChanges).mockImplementation(async () => {
      order.push("projects");
      return [{ id: "project-change", applied: true, current: null }];
    });
    vi.mocked(uploadDocument).mockImplementation(async () => {
      order.push("upload");
      return { id: "upload-new", storage_path: "documents/plan.pdf", created_at: "2026-01-01" };
    });

    renderHook(() => useOfflineSync(userId), { wrapper: Wrapper });
    await waitFor(async () => {
      expect(await listChanges(userId)).toHaveLength(0);
      expect(await listUploads(userId)).toHaveLength(0);
    });
    expect(order).toEqual(["projects", "upload"]);
  });
});
