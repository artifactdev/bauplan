import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Route } from "./aufgaben";

const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn() }));
const title = "Photograph furniture and building materials before listing them for sale";
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      tasks: [
        {
          id: "task",
          title: "Photograph furniture and building materials before listing them for sale",
          status: "offen",
          priority: "mittel",
          phase: "Planung",
          start_date: "2026-10-28",
          due_date: "2026-10-31",
          assignee_id: "alice",
          document_id: "doc",
          notes: "Include dimensions.",
        },
      ],
      trades: [],
      documents: [{ id: "doc", name: "Furniture-inventory.pdf" }],
    },
  }),
  useMutations: () => ({ update: { mutate: mocks.update }, remove: { mutate: mocks.remove } }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useTaskAssignees: () => ({ data: [{ id: "alice", label: "Alice" }], isFetched: true }),
}));
vi.mock("@/components/app/quick-actions", () => ({
  QuickTask: ({ open, editId }: { open: boolean; editId?: string }) =>
    open ? (
      <div role="dialog" aria-label="Task editor">
        {editId}
      </div>
    ) : null,
}));
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing tasks page");
  render(<Page />);
}
it("keeps the complete title, metadata, range and controls available", () => {
  mount();
  const row = within(screen.getByRole("listitem"));
  expect(row.getByRole("button", { name: title })).toBeVisible();
  expect(row.getByText("Alice")).toBeVisible();
  expect(row.getByText("Furniture-inventory.pdf")).toBeVisible();
  expect(row.getByText("Include dimensions.")).toBeVisible();
  expect(row.getByText(/28.*31/)).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Group tasks" })).toBeVisible();
});
it.each([title, "Edit"])("opens the task editor through %s", (name) => {
  mount();
  fireEvent.click(screen.getByRole("button", { name }));
  expect(screen.getByRole("dialog")).toHaveTextContent("task");
});
it("preserves completion and confirmed deletion", () => {
  mount();
  fireEvent.click(screen.getByRole("checkbox", { name: `Done: ${title}` }));
  expect(mocks.update).toHaveBeenCalledWith({
    table: "tasks",
    id: "task",
    patch: { status: "erledigt" },
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(mocks.remove).toHaveBeenCalledWith({ table: "tasks", id: "task" });
});
