import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { EntityDialog, type Field } from "./EntityDialog";
import { QuickTask } from "./quick-actions";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: { trades: [], cost_items: [], documents: [], tasks: [], contacts: [] },
  }),
  useMutations: () => ({
    create: { mutateAsync: mocks.create },
    update: { mutateAsync: mocks.update },
    remove: {},
  }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useTaskAssignees: () => ({ data: [{ id: "alice", label: "Alice" }], isError: false }),
}));
vi.mock("./ScanBar", () => ({ ScanBar: () => null }));
vi.mock("./AssignDialog", () => ({ AssignDialog: () => null }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

const fields: Field[] = [
  { name: "title", label: "Title", required: true },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "due_date", label: "Due", type: "date" },
];

describe("entry form drafts", () => {
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
