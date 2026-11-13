import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { EntityDialog, type Field } from "./EntityDialog";
import { QuickTask } from "./quick-actions";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: { trades: [], cost_items: [], documents: [], tasks: [], contacts: [] },
  }),
  useMutations: () => ({
    create: { mutateAsync: mocks.create },
    update: { mutateAsync: mocks.update },
    remove: { mutateAsync: mocks.remove },
  }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useTaskAssignees: () => ({ data: [{ id: "alice", label: "Alice" }], isError: false }),
}));
vi.mock("./ScanBar", () => ({ ScanBar: () => null }));
vi.mock("./AssignDialog", () => ({ AssignDialog: () => null }));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fields: Field[] = [
  { name: "title", label: "Title", required: true },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "due_date", label: "Due", type: "date" },
];

describe("task editor deletion", () => {
  it("offers deletion only for an existing task and leaves a canceled draft intact", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<QuickTask open onOpenChange={onOpenChange} />);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    rerender(<QuickTask open={false} onOpenChange={onOpenChange} />);
    rerender(
      <QuickTask open editId="task" initial={{ title: "Kitchen" }} onOpenChange={onOpenChange} />,
    );
    const deletion = screen.getByRole("button", { name: "Delete" });
    expect(
      Array.from(deletion.parentElement!.querySelectorAll("button")).map(
        (button) => button.textContent,
      ),
    ).toEqual(["Cancel", "Delete", "Speichern"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Unsaved kitchen" },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Unsaved kitchen");
  });

  it("waits for confirmed deletion, blocks competing actions, and never saves the draft", async () => {
    let finish!: () => void;
    mocks.remove.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenChange = vi.fn();
    render(
      <QuickTask open editId="task" initial={{ title: "Kitchen" }} onOpenChange={onOpenChange} />,
    );
    const deletion = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(deletion);
    expect(mocks.remove).toHaveBeenCalledWith({ table: "tasks", id: "task" });
    expect(deletion).toBeDisabled();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    fireEvent.click(deletion);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the editor and draft open with an explicit error when deletion fails", async () => {
    mocks.remove.mockRejectedValue(new Error("Delete failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenChange = vi.fn();
    render(
      <QuickTask open editId="task" initial={{ title: "Kitchen" }} onOpenChange={onOpenChange} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Unsaved kitchen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Delete failed"));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Unsaved kitchen");
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("entry form drafts", () => {
  it("places the task checklist last, after notes", () => {
    render(<QuickTask open editId="task" onOpenChange={vi.fn()} initial={{ title: "Kitchen" }} />);
    const notes = screen.getByRole("textbox", { name: "Notes" });
    const checklist = screen.getByRole("group", { name: "Subtasks" });
    expect(
      notes.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(checklist.closest("form")?.querySelectorAll("fieldset")).toHaveLength(1);
    expect(
      checklist.parentElement?.nextElementSibling?.querySelector('button[type="submit"]'),
    ).not.toBeNull();
  });
  it("saves a task checklist and restores its checked state when reopened", async () => {
    mocks.update.mockResolvedValue(undefined);
    const checklist = JSON.stringify([{ id: "step", title: "Measure wall", done: false }]);
    const props = {
      onOpenChange: vi.fn(),
      editId: "task",
      initial: { title: "Kitchen", checklist, priority: "mittel", status: "offen" },
    };
    const { rerender } = render(<QuickTask {...props} open />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Measure wall" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New subtask" }), {
      target: { value: "Order tiles" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New subtask" }), { key: "Enter" });
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const patch = mocks.update.mock.calls[0]![0].patch;
    expect(JSON.parse(patch.checklist)).toEqual([
      { id: "step", title: "Measure wall", done: true },
      { id: expect.any(String), title: "Order tiles", done: false },
    ]);
    rerender(<QuickTask {...props} open={false} />);
    rerender(<QuickTask {...props} initial={patch} open />);
    expect(screen.getByRole("checkbox", { name: "Measure wall" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Order tiles" })).not.toBeChecked();
  });
  it("preserves user inputs across new initial objects after background/refetch", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const props = { open: true, title: "Entry", fields, onOpenChange: vi.fn(), onSubmit: submit };
    const { rerender } = render(
      <StrictMode>
        <EntityDialog {...props} initial={{ title: "Server title" }} />
      </StrictMode>,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My draft" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep these notes" } });
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-11-05" } });
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.focus(window);
    rerender(
      <StrictMode>
        <EntityDialog {...props} initial={{ title: "Refetched title", notes: "Server notes" }} />
      </StrictMode>,
    );
    expect(screen.getByLabelText("Title")).toHaveValue("My draft");
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep these notes");
    expect(screen.getByLabelText("Due")).toHaveValue("2026-11-05");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        title: "My draft",
        notes: "Keep these notes",
        due_date: "2026-11-05",
      }),
    );
  });

  it("initializes a fresh draft after closing and reopening", () => {
    const props = { title: "Entry", fields, onOpenChange: vi.fn(), onSubmit: vi.fn() };
    const { rerender } = render(<EntityDialog {...props} open initial={{ title: "First" }} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved" } });
    rerender(<EntityDialog {...props} open={false} initial={{ title: "First" }} />);
    rerender(<EntityDialog {...props} open initial={{ title: "Second" }} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Second");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
  });

  it("preserves a new task while its default values and assignee options are recreated", async () => {
    mocks.create.mockResolvedValue({ id: "task" });
    const onOpenChange = vi.fn();
    const { rerender } = render(<QuickTask open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Measure kitchen" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Before ordering" } });
    fireEvent.focus(window);
    rerender(<QuickTask open onOpenChange={onOpenChange} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Measure kitchen");
    expect(screen.getByLabelText("Notes")).toHaveValue("Before ordering");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "tasks",
        row: expect.objectContaining({
          title: "Measure kitchen",
          notes: "Before ordering",
          priority: "mittel",
          status: "offen",
        }),
      }),
    );
  });
});
