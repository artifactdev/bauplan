import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Route } from "./aufgaben";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  checklist: null as string | null,
}));
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
          checklist: mocks.checklist,
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
  mocks.checklist = null;
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
it("keeps only the title fixed while long task details and actions scroll", () => {
  mocks.checklist = JSON.stringify(
    Array.from({ length: 60 }, (_, index) => ({
      id: `step-${index}`,
      title: `Subtask ${index + 1}`,
      done: false,
    })),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-hidden", "flex-col");
  const body = within(dialog).getByRole("group", { name: "Subtasks" }).parentElement!;
  expect(body).toHaveClass("min-h-0", "overflow-y-auto", "overscroll-contain");
  expect(within(body).getByRole("checkbox", { name: "Subtask 60" })).toBeInTheDocument();
  expect(body.contains(within(dialog).getByRole("button", { name: "Edit" }))).toBe(true);
  expect(within(body).getByRole("button", { name: "Close" })).toBeVisible();
  expect(body.contains(within(dialog).getByRole("heading", { name: title }))).toBe(false);
  fireEvent.click(within(body).getByRole("checkbox", { name: "Subtask 60" }));
  expect(JSON.parse(mocks.update.mock.calls[0]![0].patch.checklist)[59].done).toBe(true);
});
it("ticks a subtask directly in task details without completing the parent", () => {
  mocks.checklist = JSON.stringify([{ id: "step", title: "Measure furniture", done: false }]);
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  const detail = within(screen.getByRole("dialog"));
  fireEvent.click(detail.getByRole("checkbox", { name: "Measure furniture" }));
  expect(mocks.update).toHaveBeenCalledWith({
    table: "tasks",
    id: "task",
    patch: { checklist: JSON.stringify([{ id: "step", title: "Measure furniture", done: true }]) },
  });
  expect(detail.getByRole("textbox", { name: "New subtask" })).toBeVisible();
});
it("shows a compact open count and toggles indented, checkable subtasks in the list", () => {
  mocks.checklist = JSON.stringify([
    { id: "step", title: "Measure furniture", done: false },
    { id: "photo", title: "Take photos", done: true },
  ]);
  mount();
  expect(screen.getByLabelText("1 of 2 subtasks open")).toHaveTextContent("1/2 open");
  expect(screen.queryByRole("checkbox", { name: "Measure furniture" })).not.toBeInTheDocument();
  const toggle = screen.getByRole("switch", { name: "Show subtasks" });
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Take photos" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Measure furniture" }));
  expect(mocks.update).toHaveBeenCalledWith({
    table: "tasks",
    id: "task",
    patch: {
      checklist: JSON.stringify([
        { id: "step", title: "Measure furniture", done: true },
        { id: "photo", title: "Take photos", done: true },
      ]),
    },
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.queryByRole("checkbox", { name: "Measure furniture" })).not.toBeInTheDocument();
});
it("shows zero open subtasks when all are complete", () => {
  mocks.checklist = JSON.stringify([{ id: "step", title: "Measure furniture", done: true }]);
  mount();
  expect(screen.getByLabelText("0 of 1 subtasks open")).toHaveTextContent("0/1 open");
});
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
it("opens task details with direct subtask creation before the editor", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  const detail = within(screen.getByRole("dialog"));
  expect(detail.getByText("Include dimensions.")).toBeVisible();
  expect(detail.getByText("Alice")).toBeVisible();
  expect(detail.getByRole("textbox", { name: "New subtask" })).toBeVisible();
  expect(detail.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  fireEvent.click(detail.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Task editor" })).toHaveTextContent("task");
});
it("opens the task editor directly through Edit", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("task");
});
it("closes details without changing the task and reopens them", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: title }));
  expect(
    within(screen.getByRole("dialog")).getByRole("textbox", { name: "New subtask" }),
  ).toHaveValue("");
});
it("opens task notification links in details with direct subtask creation", () => {
  window.history.replaceState({}, "", "/aufgaben?eintrag=task");
  mount();
  expect(screen.getByRole("dialog")).toHaveAccessibleName(title);
  expect(
    within(screen.getByRole("dialog")).getByRole("textbox", { name: "New subtask" }),
  ).toBeVisible();
  expect(window.location.search).toBe("");
  window.history.replaceState({}, "", "/");
});
it("opens new tasks directly in the editor", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Task" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Task editor");
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

it("adds the first subtask directly from a collapsed task row without opening an editor", () => {
  mount();
  const add = screen.getByRole("button", { name: "Add subtask" });
  expect(add).toHaveAttribute("title", "Add subtask");
  expect(add).toHaveTextContent("");
  fireEvent.click(add);
  const input = screen.getByRole("textbox", { name: "New subtask" });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Measure furniture" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mocks.update).toHaveBeenCalledWith(
    {
      table: "tasks",
      id: "task",
      patch: { checklist: expect.any(String) },
    },
    { onSuccess: expect.any(Function) },
  );
  expect(JSON.parse(mocks.update.mock.calls[0]![0].patch.checklist)).toEqual([
    { id: expect.any(String), title: "Measure furniture", done: false },
  ]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "New subtask" })).toBeVisible();
  expect(toast.success).not.toHaveBeenCalled();
  act(() => mocks.update.mock.calls[0]![1].onSuccess());
  expect(screen.queryByRole("textbox", { name: "New subtask" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add subtask" })).toBeVisible();
  expect(screen.getByRole("switch", { name: "Show subtasks" })).not.toBeChecked();
  expect(toast.success).toHaveBeenCalledWith("Subtask created successfully.");
});

it("adds to an existing checklist directly from task details and preserves earlier entries", () => {
  const existing = { id: "step", title: "Measure furniture", done: true };
  mocks.checklist = JSON.stringify([existing]);
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  const detail = within(screen.getByRole("dialog"));
  fireEvent.change(detail.getByRole("textbox", { name: "New subtask" }), {
    target: { value: "Take photos" },
  });
  fireEvent.click(detail.getByRole("button", { name: "Add" }));
  expect(JSON.parse(mocks.update.mock.calls[0]![0].patch.checklist)).toEqual([
    existing,
    { id: expect.any(String), title: "Take photos", done: false },
  ]);
});

it("offers direct creation on expanded tasks with no existing subtasks", () => {
  mount();
  fireEvent.click(screen.getByRole("switch", { name: "Show subtasks" }));
  expect(screen.getByRole("textbox", { name: "New subtask" })).toBeVisible();
});

it("keeps subtasks visible after successful creation when the global toggle is on", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
  fireEvent.click(screen.getByRole("switch", { name: "Show subtasks" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New subtask" }), {
    target: { value: "Measure furniture" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  act(() => mocks.update.mock.calls[0]![1].onSuccess());
  expect(screen.getByRole("textbox", { name: "New subtask" })).toBeVisible();
  expect(toast.success).toHaveBeenCalledWith("Subtask created successfully.");
  fireEvent.click(screen.getByRole("switch", { name: "Show subtasks" }));
  expect(screen.queryByRole("textbox", { name: "New subtask" })).not.toBeInTheDocument();
});
