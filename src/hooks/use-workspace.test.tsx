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
import { EntityDialog } from "@/components/app/EntityDialog";
import {
  createRow,
  deleteRow,
  getWorkspace,
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
  setOfflineAccount,
} from "@/lib/offline-store";
import type { Workspace } from "@/lib/schema";
import { useMutations, useWorkspace } from "./use-workspace";

vi.mock("@/lib/data.functions", () => ({
  createRow: vi.fn(),
  updateRow: vi.fn(),
  deleteRow: vi.fn(),
  uploadDocument: vi.fn(),
  getWorkspace: vi.fn(),
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
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["ws", userId], structuredClone(empty));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  onlineManager.setOnline(false);
});
afterEach(async () => {
  cleanup();
  client.clear();
  await clearAccountData(userId);
  clearOfflineAccount();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe("offline mutation completion", () => {
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
    expect((await loadSnapshot(userId))?.tasks[0]?.title).toBe("Offline task");
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
});
