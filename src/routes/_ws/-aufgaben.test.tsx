import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Route } from "./aufgaben";
import { toast } from "sonner";
import type { Task } from "@/lib/schema";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  checklist: null as string | null,
  secondTask: false,
  priority: "mittel" as Task["priority"],
  status: "offen" as Task["status"],
  dueDate: "2026-10-31" as string | null,
}));
const title = "Photograph furniture and building materials before listing them for sale";
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      tasks: [
        {
          id: "task",
          title: "Photograph furniture and building materials before listing them for sale",
          status: mocks.status,
          priority: mocks.priority,
          phase: "Planung",
          start_date: "2026-10-28",
          due_date: mocks.dueDate,
          assignee_id: "alice",
          document_id: "doc",
          notes: "Include dimensions.",
          checklist: mocks.checklist,
        },
      ].concat(
        mocks.secondTask
          ? [
              {
                id: "second-task",
                title: "Paint walls",
                status: "offen",
                priority: "mittel",
                phase: "Planung",
                start_date: "2026-10-28",
                due_date: "2026-10-31",
                assignee_id: "alice",
                document_id: "doc",
                notes: "",
                checklist: JSON.stringify([
                  { id: "second-step", title: "Choose paint", done: false },
                ]),
              },
            ]
          : [],
      ),
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
  mocks.remove.mockReset();
  mocks.checklist = null;
  mocks.secondTask = false;
  mocks.priority = "mittel";
  mocks.status = "offen";
  mocks.dueDate = "2026-10-31";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T12:00:00"));
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
it("omits row status, priority labels and dates while retaining overdue and detail indicators", () => {
  mount();
  const row = within(screen.getByRole("listitem"));
  expect(row.getByRole("button", { name: title })).toBeVisible();
  expect(row.getByText("Alice")).toBeVisible();
  expect(row.queryByText("Furniture-inventory.pdf")).not.toBeInTheDocument();
  expect(row.queryByText("Include dimensions.")).not.toBeInTheDocument();
  expect(row.getByRole("img", { name: "Has notes" })).toBeVisible();
  expect(row.getByRole("img", { name: "Has linked document" })).toBeVisible();
  expect(row.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(row.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(row.queryByText("Open")).not.toBeInTheDocument();
  expect(row.queryByText("Medium")).not.toBeInTheDocument();
  expect(row.queryByText(/2026/)).not.toBeInTheDocument();
  expect(row.getByText("Overdue")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Group tasks" })).toBeVisible();
});
it("opens task details with direct subtask creation before the editor", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  const detail = within(screen.getByRole("dialog"));
  expect(detail.getByText("Include dimensions.")).toBeVisible();
  expect(detail.getByText("Furniture-inventory.pdf")).toBeVisible();
  expect(detail.getByText("Alice")).toBeVisible();
  expect(detail.getByText("Open")).toBeVisible();
  expect(detail.getByText("Medium")).toBeVisible();
  expect(detail.getByText("28/10/2026")).toBeVisible();
  expect(detail.getByText("Overdue · 31/10/2026")).toBeVisible();
  expect(detail.getByRole("textbox", { name: "New subtask" })).toBeVisible();
  expect(detail.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  fireEvent.click(detail.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Task editor" })).toHaveTextContent("task");
});

it.each([
  ["hoch", "High priority", "text-task-priority-high"],
  ["mittel", "", null],
  ["niedrig", "", null],
] as const)(
  "shows only an accessible priority icon after the title for %s",
  (priority, description, color) => {
    mocks.priority = priority;
    mount();
    const button = screen.getByRole("button", { name: title });
    expect(button).toHaveAccessibleDescription(description);
    const icon = button.querySelector("svg");
    if (color) {
      expect(icon).toHaveClass(color);
      expect(button.firstChild).toHaveTextContent(title);
    } else {
      expect(icon).toBeNull();
    }
  },
);

it("cancels deletion in task details without changing or closing the task", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const detail = within(screen.getByRole("dialog"));
  expect(
    Array.from(detail.getByRole("button", { name: "Delete" }).parentElement!.children).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Close", "Delete", "Edit"]);
  fireEvent.click(detail.getByRole("button", { name: "Delete" }));
  expect(window.confirm).toHaveBeenCalledWith("Delete task?");
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveAccessibleName(title);
});

it("waits for confirmed deletion in details and blocks competing actions", () => {
  mocks.checklist = JSON.stringify([{ id: "step", title: "Measure furniture", done: false }]);
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const detail = within(screen.getByRole("dialog"));
  const deletion = detail.getByRole("button", { name: "Delete" });
  fireEvent.click(deletion);
  expect(mocks.remove).toHaveBeenCalledWith(
    { table: "tasks", id: "task" },
    { onSuccess: expect.any(Function), onSettled: expect.any(Function) },
  );
  expect(deletion).toBeDisabled();
  expect(detail.getAllByRole("button", { name: "Close" })[0]).toBeDisabled();
  expect(detail.getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(detail.getByRole("checkbox", { name: "Measure furniture" })).toBeDisabled();
  fireEvent.click(deletion);
  fireEvent.click(detail.getAllByRole("button", { name: "Close" })[1]!);
  expect(screen.getByRole("dialog")).toHaveAccessibleName(title);
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
  act(() => {
    mocks.remove.mock.calls[0]![1].onSuccess();
    mocks.remove.mock.calls[0]![1].onSettled();
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps details open for retry when deletion fails", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: title }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const detail = within(screen.getByRole("dialog"));
  fireEvent.click(detail.getByRole("button", { name: "Delete" }));
  act(() => mocks.remove.mock.calls[0]![1].onSettled(undefined, new Error("Delete failed")));
  expect(screen.getByRole("dialog")).toHaveAccessibleName(title);
  expect(detail.getByRole("button", { name: "Delete" })).toBeEnabled();
  fireEvent.click(detail.getByRole("button", { name: "Delete" }));
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});

it.each([
  ["offen", "2026-12-31", "Open"],
  ["in_arbeit", null, "In progress"],
  ["erledigt", "2026-10-31", "Done"],
] as const)("does not mark %s tasks overdue with due date %s", (status, dueDate, statusLabel) => {
  mocks.status = status;
  mocks.dueDate = dueDate;
  mount();
  if (status === "erledigt") {
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Status" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "All" }));
  }
  const row = within(screen.getByRole("listitem"));
  expect(row.queryByText("Overdue")).not.toBeInTheDocument();
  expect(row.queryByText(statusLabel)).not.toBeInTheDocument();
  expect(row.queryByText(/2026/)).not.toBeInTheDocument();
  fireEvent.click(row.getByRole("button", { name: title }));
  const detail = within(screen.getByRole("dialog"));
  expect(detail.queryByText(/Overdue/)).not.toBeInTheDocument();
  expect(detail.getByText(statusLabel)).toBeVisible();
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
it("preserves direct completion without row deletion", () => {
  mount();
  fireEvent.click(screen.getByRole("checkbox", { name: `Done: ${title}` }));
  expect(mocks.update).toHaveBeenCalledWith({
    table: "tasks",
    id: "task",
    patch: { status: "erledigt" },
  });
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
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

it("expands each task independently and resets individual choices through the global switch", () => {
  mocks.secondTask = true;
  mocks.checklist = JSON.stringify([{ id: "step", title: "Measure furniture", done: false }]);
  mount();
  const count = within(screen.getAllByRole("listitem")[0]!).getByRole("button", {
    name: "1 of 1 subtasks open",
  });
  expect(count).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(count);
  expect(count).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById(count.getAttribute("aria-controls")!)).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Measure furniture" })).toBeVisible();
  expect(screen.queryByRole("checkbox", { name: "Choose paint" })).not.toBeInTheDocument();
  const toggle = screen.getByRole("switch", { name: "Show subtasks" });
  fireEvent.click(toggle);
  expect(screen.getByRole("checkbox", { name: "Choose paint" })).toBeVisible();
  fireEvent.click(count);
  expect(screen.queryByRole("checkbox", { name: "Measure furniture" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Choose paint" })).toBeVisible();
  fireEvent.click(toggle);
  expect(screen.queryByRole("checkbox", { name: "Choose paint" })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole("checkbox", { name: "Measure furniture" })).toBeVisible();
});

it("retains an unsaved draft across collapse and clears it only after successful creation", () => {
  mocks.checklist = JSON.stringify([{ id: "step", title: "Measure furniture", done: false }]);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New subtask" }), {
    target: { value: "Take photos" },
  });
  const count = screen.getByRole("button", { name: "1 of 1 subtasks open" });
  fireEvent.click(count);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(count);
  const input = screen.getByRole("textbox", { name: "New subtask" });
  expect(input).toHaveValue("Take photos");
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(input).toHaveValue("Take photos");
  expect(toast.success).not.toHaveBeenCalled();
  act(() => mocks.update.mock.calls[0]![1].onSuccess());
  expect(input).toHaveValue("");
  expect(count).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
  expect(input).toHaveFocus();
});

it("keeps temporary creation and its draft available until a save succeeds", () => {
  mount();
  const add = screen.getByRole("button", { name: "Add subtask" });
  fireEvent.click(add);
  fireEvent.change(screen.getByRole("textbox", { name: "New subtask" }), {
    target: { value: "Measure furniture" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("textbox", { name: "New subtask" })).toHaveValue("Measure furniture");
  expect(toast.success).not.toHaveBeenCalled();
  act(() => mocks.update.mock.calls[0]![1].onSuccess());
  expect(add).toHaveFocus();
  fireEvent.click(add);
  expect(screen.getByRole("textbox", { name: "New subtask" })).toHaveValue("");
});
