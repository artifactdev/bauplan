import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { DiaryEntry, DiaryMedia, Task, Trade, Offer, Expense } from "@/lib/schema";
import { DiaryPage } from "./DiaryPage";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  entries: [] as DiaryEntry[],
  tasks: [] as Task[],
  trades: [] as Trade[],
  media: [] as DiaryMedia[],
  offers: [] as Offer[],
  expenses: [] as Expense[],
  pdf: vi.fn(),
  gallery: vi.fn(),
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      projects: [{ id: "project", name: "Demo" }],
      tasks: mocks.tasks,
      events: [],
      trades: mocks.trades,
      diary_entries: mocks.entries,
      diary_media: mocks.media,
      offers: mocks.offers,
      expenses: mocks.expenses,
    },
    projectId: "project",
    isLoading: false,
  }),
  useMutations: () => ({
    create: { mutateAsync: mocks.create, isPending: false },
    update: { mutateAsync: mocks.update, isPending: false },
    remove: { mutateAsync: mocks.remove },
    diaryMediaUpload: { mutateAsync: mocks.upload, isPending: false },
  }),
}));
vi.mock("@/lib/data.functions", () => ({ getDiaryWeather: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/app/doc-open", () => ({
  useFileUrl: (path: string | null) => (path ? `blob:${path}` : null),
}));
vi.mock("./ImageGallery", () => ({
  ImageGallery: (props: unknown) => {
    mocks.gallery(props);
    return null;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/diary-pdf", () => ({ downloadDiaryPdf: mocks.pdf }));

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.entries = [];
  mocks.tasks = [];
  mocks.trades = [];
  mocks.media = [];
  mocks.offers = [];
  mocks.expenses = [];
  mocks.pdf.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "created-entry", queued: true });
  mocks.update.mockResolvedValue(undefined);
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function task(id: string, date: string | null, trade: string | null = null): Task {
  return {
    id,
    title: id,
    status: date ? "erledigt" : "offen",
    completed_on: date,
    trade_id: trade,
    assignee_id: null,
    phase: null,
    priority: "mittel",
    due_date: null,
    notes: null,
    cost_item_id: null,
    document_id: null,
  };
}
function report(id: string, date: string, patch: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id,
    title: id,
    entry_date: date,
    work_done: null,
    progress: null,
    issues: null,
    weather_snapshot: null,
    task_ids: null,
    event_ids: null,
    trade_ids: null,
    ...patch,
  };
}
function offer(id: string, date: string | null): Offer {
  return {
    id,
    title: id,
    contractor: "Electrical workshop",
    amount: 2430,
    offer_date: date,
    requested_date: null,
    trade_id: null,
    cost_item_id: null,
    document_id: null,
    contact_id: null,
    status: "received",
    notes: null,
  };
}
function payment(id: string, date: string | null): Expense {
  return {
    id,
    title: id,
    vendor: "Materials workshop",
    amount: 340.5,
    expense_date: "2020-01-01",
    payment_date: date,
    category: null,
    trade_id: null,
    cost_item_id: null,
    document_id: null,
    status: "bezahlt",
    bank_status: "nicht_festgelegt",
    notes: null,
  };
}
function entryAction(action: "Edit entry" | "Delete entry", title = "Existing report") {
  fireEvent.pointerDown(screen.getByRole("button", { name: `Actions for ${title}` }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

function openReport() {
  fireEvent.click(screen.getByRole("button", { name: "New entry" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Electrical rough-in" } });
  fireEvent.change(screen.getByLabelText("Work completed"), {
    target: { value: "Documented cable routes" },
  });
}

async function continueToMedia() {
  fireEvent.click(screen.getByRole("button", { name: "Save and continue to photos" }));
  await screen.findByRole("button", { name: "Finish without media" });
}

describe("diary entry wizard", () => {
  it("preselects subtasks of open parents by their own day and preserves manually selected legacy items", async () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const today = now.toISOString().slice(0, 10);
    mocks.tasks = [
      {
        ...task("Open parent", null),
        checklist: JSON.stringify([
          { id: "today", title: "Routes measured", done: true, completed_on: today },
          { id: "other", title: "Earlier work", done: true, completed_on: "2020-01-01" },
          { id: "legacy", title: "Undated work", done: true },
        ]),
      },
    ];
    render(<DiaryPage />);
    openReport();
    fireEvent.click(screen.getByText("Subtasks", { selector: "summary" }));
    expect(screen.getByRole("checkbox", { name: /Open parent: Routes measured/ })).toHaveAttribute(
      "data-state",
      "checked",
    );
    const legacy = screen.getByRole("checkbox", { name: /Open parent: Undated work/ });
    expect(legacy).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(legacy);
    fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
      target: { value: "2020-01-01" },
    });
    expect(screen.getByRole("checkbox", { name: /Open parent: Routes measured/ })).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(screen.getByRole("checkbox", { name: /Open parent: Earlier work/ })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(legacy).toHaveAttribute("data-state", "checked");
    await continueToMedia();
    const row = mocks.create.mock.calls[0]![0].row;
    expect(row.task_ids).toEqual([]);
    expect(row.subtask_links).toEqual([
      { task_id: "Open parent", subtask_id: "legacy" },
      { task_id: "Open parent", subtask_id: "other" },
    ]);
  });

  it("groups subtasks by parent and finds all of a parent's subtasks by its title", () => {
    mocks.tasks = [
      {
        ...task("Bathroom renovation", null),
        checklist: JSON.stringify([{ id: "valve", title: "Replace valve", done: false }]),
      },
      {
        ...task("Kitchen wiring", null),
        checklist: JSON.stringify([{ id: "outlet", title: "Check outlet", done: false }]),
      },
    ];
    render(<DiaryPage />);
    openReport();
    fireEvent.click(screen.getByText("Subtasks", { selector: "summary" }));

    expect(screen.getByRole("group", { name: "Bathroom renovation" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: /Subtasks/ }), {
      target: { value: "Bathroom renovation" },
    });

    expect(
      screen.getByRole("checkbox", { name: "Bathroom renovation: Replace valve" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "Kitchen wiring: Check outlet" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the subtask picker visible when current tasks have no subtasks", () => {
    mocks.tasks = [task("Open parent", null)];
    render(<DiaryPage />);
    openReport();

    fireEvent.click(screen.getByText("Subtasks", { selector: "summary" }));
    expect(screen.getByText("The current tasks have no subtasks.")).toBeVisible();
  });

  it("opens the clicked photo in the shared gallery with only photos from the same diary entry", () => {
    mocks.entries = [report("Existing report", "2026-11-17")];
    mocks.media = [
      {
        id: "a",
        diary_entry_id: "Existing report",
        name: "First.jpg",
        storage_path: "first.jpg",
        mime_type: "image/jpeg",
        size: 12,
      },
      {
        id: "video",
        diary_entry_id: "Existing report",
        name: "Clip.webm",
        storage_path: "clip.webm",
        mime_type: "video/webm",
        size: 12,
      },
      {
        id: "b",
        diary_entry_id: "Existing report",
        name: "Second.jpg",
        storage_path: "second.jpg",
        mime_type: "image/jpeg",
        size: 12,
      },
      {
        id: "other",
        diary_entry_id: "Another report",
        name: "Other.jpg",
        storage_path: "other.jpg",
        mime_type: "image/jpeg",
        size: 12,
      },
    ];
    render(<DiaryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Existing report" }));
    fireEvent.click(screen.getByRole("button", { name: "Open full-size photo: Second.jpg" }));
    expect(mocks.gallery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Existing report",
        startIndex: 1,
        open: true,
        images: [
          { id: "a", path: "first.jpg", name: "First.jpg" },
          { id: "b", path: "second.jpg", name: "Second.jpg" },
        ],
      }),
    );
  });
  it("preselects dated offers and paid expenses, preserves manual links and refreshes only automatic links on date changes", async () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const today = now.toISOString().slice(0, 10);
    mocks.offers = [offer("Today's offer", today), offer("Manual offer", "2020-01-01")];
    mocks.expenses = [
      payment("Today's payment", today),
      payment("Other payment", "2020-01-02"),
      { ...payment("Unpaid", today), status: "offen" },
      payment("Undated", null),
    ];
    render(<DiaryPage />);
    openReport();
    fireEvent.click(screen.getByText("Offers", { selector: "summary" }));
    fireEvent.click(screen.getByText("Payments", { selector: "summary" }));
    expect(screen.getByRole("checkbox", { name: /Today's offer/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Today's payment/ })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /Unpaid/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Undated/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Today's offer/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Manual offer/ }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2020-01-02" } });
    expect(screen.getByRole("checkbox", { name: /Today's payment/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Other payment/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Manual offer/ })).toBeChecked();
    await continueToMedia();
    expect(mocks.create).toHaveBeenCalledWith({
      table: "diary_entries",
      row: expect.objectContaining({ offer_ids: ["Manual offer"], payment_ids: ["Other payment"] }),
    });
  });

  it("only adds daily subtask and financial suggestions to an existing report on explicit request", async () => {
    mocks.offers = [offer("Quote", "2026-11-17")];
    mocks.expenses = [payment("Payment", "2026-11-17")];
    mocks.entries = [report("Existing report", "2026-11-17")];
    mocks.tasks = [
      {
        ...task("Open parent", null),
        checklist: JSON.stringify([
          { id: "step", title: "Measured routes", done: true, completed_on: "2026-11-17" },
        ]),
      },
    ];
    render(<DiaryPage />);
    entryAction("Edit entry");
    fireEvent.click(screen.getByText("Offers", { selector: "summary" }));
    expect(screen.getByRole("checkbox", { name: /Quote/ })).not.toBeChecked();
    fireEvent.click(screen.getByText("Subtasks", { selector: "summary" }));
    expect(
      screen.getByRole("checkbox", { name: /Open parent: Measured routes/ }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add daily suggestions" }));
    expect(screen.getByRole("checkbox", { name: /Quote/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Open parent: Measured routes/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        table: "diary_entries",
        id: "Existing report",
        patch: expect.objectContaining({
          offer_ids: ["Quote"],
          payment_ids: ["Payment"],
          subtask_links: [{ task_id: "Open parent", subtask_id: "step" }],
        }),
      }),
    );
  });

  it("opens report creation as a modal and restores focus to its action after Escape", async () => {
    render(<DiaryPage />);
    const trigger = screen.getByRole("button", { name: "New entry" });
    openReport();
    expect(screen.getByRole("dialog", { name: "New entry" })).toContainElement(
      screen.getByLabelText("Title"),
    );
    expect(screen.getByRole("heading", { name: "Write report" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("explains oversized daily preselections and permits saving after reducing them to the link limit", async () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const today = now.toISOString().slice(0, 10);
    mocks.tasks = [
      ...Array.from({ length: 101 }, (_, index) => task(`Completed ${index}`, today)),
      task("Manual", null),
    ];
    render(<DiaryPage />);
    openReport();
    expect(screen.getByRole("alert")).toHaveTextContent("Each category allows up to 100 links.");
    expect(screen.getByRole("button", { name: "Save and continue to photos" })).toBeDisabled();
    fireEvent.click(screen.getByText("Tasks", { selector: "summary" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Completed 100/ }));
    expect(screen.getByRole("checkbox", { name: "Manual" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await continueToMedia();
    expect(mocks.create.mock.lastCall?.[0].row.task_ids).toHaveLength(100);
  });

  it("preselects tasks by actual completion day, allows deselection and retains manual links on date changes", async () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const today = now.toISOString().slice(0, 10);
    mocks.tasks = [task("Today", today), task("Other day", "2020-01-02"), task("Manual", null)];
    render(<DiaryPage />);
    openReport();
    fireEvent.click(screen.getByText("Tasks", { selector: "summary" }));
    const completed = screen.getByRole("checkbox", { name: /Today/ });
    expect(completed).toBeChecked();
    fireEvent.click(completed);
    fireEvent.click(screen.getByRole("checkbox", { name: "Manual" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2020-01-02" } });
    expect(screen.getByRole("checkbox", { name: /Other day/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Manual" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Today" })).not.toBeChecked();
    await continueToMedia();
    expect(mocks.create).toHaveBeenCalledWith({
      table: "diary_entries",
      row: expect.objectContaining({ task_ids: ["Manual", "Other day"] }),
    });
  });

  it("saves before exposing uploads and can finish without media, including queued entries", async () => {
    render(<DiaryPage />);
    openReport();
    expect(screen.queryByLabelText("Photos and videos")).not.toBeInTheDocument();
    await continueToMedia();
    expect(mocks.create).toHaveBeenCalledWith({
      table: "diary_entries",
      row: expect.objectContaining({
        title: "Electrical rough-in",
        work_done: "Documented cable routes",
      }),
    });

    expect(screen.getByRole("status")).toHaveTextContent("Report saved – media is optional.");
    expect(screen.getByRole("heading", { name: "Add photos and videos" })).toHaveFocus();
    expect(screen.getByLabelText("Photos and videos")).toBeEnabled();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish without media" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("retains the report on create failure and allows retry", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Cannot save"));
    render(<DiaryPage />);
    openReport();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue to photos" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Title")).toHaveValue("Electrical rough-in");
    expect(screen.queryByLabelText("Photos and videos")).not.toBeInTheDocument();
    await continueToMedia();
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("updates the same entry when returning to the report and keeps failed changes editable", async () => {
    render(<DiaryPage />);
    openReport();
    await continueToMedia();
    fireEvent.click(screen.getByRole("button", { name: "Back to report" }));
    expect(screen.getByLabelText("Work completed")).toHaveValue("Documented cable routes");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated report" } });
    mocks.update.mockRejectedValueOnce(new Error("Cannot update"));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue to photos" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Title")).toHaveValue("Updated report");
    expect(screen.queryByLabelText("Photos and videos")).not.toBeInTheDocument();
    await continueToMedia();
    expect(mocks.update).toHaveBeenLastCalledWith({
      table: "diary_entries",
      id: "created-entry",
      patch: expect.objectContaining({ title: "Updated report" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish without media" }));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the saved report when closing the media step and starts a fresh wizard next time", async () => {
    render(<DiaryPage />);
    openReport();
    await continueToMedia();
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.queryByLabelText("Photos and videos")).not.toBeInTheDocument();
  });

  it("uploads to the saved entry, blocks navigation during the entire batch and permits retry on failure", async () => {
    let finishUpload!: () => void;
    mocks.upload.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishUpload = resolve)),
    );
    mocks.upload.mockRejectedValueOnce(new Error("Upload failed"));
    render(<DiaryPage />);
    openReport();
    await continueToMedia();
    const first = new File(["photo"], "first.png", { type: "image/png" });
    const second = new File(["photo"], "second.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Photos and videos"), {
      target: { files: [first, second] },
    });
    expect(mocks.upload).toHaveBeenCalledWith({ file: first, diaryEntryId: "created-entry" });
    for (const name of ["Finish without media", "Back to report", "Close form"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New entry", hidden: true })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "New entry" })).toBeInTheDocument();
    await act(async () => finishUpload());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Finish without media" })).toBeEnabled(),
    );
    expect(mocks.upload).toHaveBeenLastCalledWith({ file: second, diaryEntryId: "created-entry" });
    expect(screen.getByRole("status")).toHaveTextContent("Report saved");
    mocks.upload.mockResolvedValueOnce(undefined);
    fireEvent.change(screen.getByLabelText("Photos and videos"), {
      target: { files: [second] },
    });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
  });

  it("edits existing entries without a wizard and exposes media immediately", async () => {
    mocks.entries = [
      {
        id: "existing",
        title: "Existing report",
        entry_date: "2026-11-17",
        work_done: "Installed wiring",
        progress: null,
        issues: null,
        weather_snapshot: null,
        task_ids: null,
        event_ids: null,
        trade_ids: null,
      },
    ];
    render(<DiaryPage />);
    entryAction("Edit entry");
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toContainElement(
      screen.getByLabelText("Title"),
    );
    expect(screen.getByRole("heading", { name: "Edit entry" })).toHaveFocus();
    expect(screen.getByLabelText("Date")).not.toHaveFocus();
    expect(screen.getByLabelText("Title")).toHaveValue("Existing report");
    expect(screen.getByLabelText("Photos and videos")).toBeEnabled();
    expect(screen.queryByText("Write report")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        table: "diary_entries",
        id: "existing",
        patch: expect.objectContaining({ title: "Existing report" }),
      }),
    );
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions for Existing report" })).toHaveFocus(),
    );
  });
});

describe("diary entry details", () => {
  it("opens the report from its title or summary and restores focus on close", async () => {
    mocks.entries = [
      report("Existing report", "2026-11-17", {
        work_done: "Installed wiring",
        progress: "Drywall work can start next.",
        issues: "One outlet still needs review.",
      }),
    ];
    render(<DiaryPage />);

    const trigger = screen.getByRole("button", { name: "Existing report" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Existing report" });
    expect(dialog).toHaveTextContent("Installed wiring");
    expect(dialog).toHaveTextContent("Drywall work can start next.");
    expect(dialog).toHaveTextContent("One outlet still needs review.");
    expect(dialog.querySelector(".overflow-y-auto")).toHaveClass("overscroll-contain");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(screen.getByText("Installed wiring"));
    expect(screen.getByRole("dialog", { name: "Existing report" })).toHaveTextContent(
      "Installed wiring",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("diary delete confirmations", () => {
  it("does not delete an entry until confirmed and retains the confirmation on failure", async () => {
    mocks.entries = [report("Existing report", "2026-11-17")];
    render(<DiaryPage />);
    entryAction("Delete entry");
    expect(screen.getByRole("alertdialog", { name: "Delete entry?" })).toHaveTextContent(
      "Existing report",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    entryAction("Delete entry");
    mocks.remove.mockRejectedValueOnce(new Error("Cannot delete"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
    mocks.remove.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.remove).toHaveBeenLastCalledWith({
      table: "diary_entries",
      id: "Existing report",
    });
  });

  it("also requires confirmation before deleting an attachment", async () => {
    mocks.entries = [report("Existing report", "2026-11-17")];
    mocks.media = [
      {
        id: "photo",
        diary_entry_id: "Existing report",
        name: "Site.jpg",
        mime_type: "image/jpeg",
        storage_path: "photo",
        size: 10,
      },
    ];
    render(<DiaryPage />);
    entryAction("Edit entry");
    fireEvent.click(screen.getByRole("button", { name: /Remove Site.jpg/ }));
    expect(screen.getByRole("alertdialog", { name: "Delete attachment?" })).toHaveTextContent(
      "Site.jpg",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ table: "diary_media", id: "photo" }),
    );
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toBeInTheDocument();
  });
});

describe("diary timeline and exports", () => {
  const archive = () =>
    Array.from({ length: 1200 }, (_, index) =>
      report(
        `Archive report ${index}`,
        new Date(Date.UTC(2026, 10, 17 - index)).toISOString().slice(0, 10),
      ),
    );

  it("renders a long archive in batches and exports every matching report, not only the visible batch", async () => {
    mocks.entries = archive();
    render(<DiaryPage />);
    expect(screen.getAllByRole("article")).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Load older reports" }));
    expect(screen.getAllByRole("article")).toHaveLength(80);
    expect(screen.getByRole("button", { name: "Archive report 40" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Entire diary as PDF" }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.pdf.mock.calls[0]![2]).toHaveLength(1200);
  });

  it("jumps directly to distant months by keyboard without rendering intervening reports and resets the range for filters", () => {
    mocks.entries = archive();
    render(<DiaryPage />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Time navigation" }), { key: "End" });
    expect(screen.getByRole("button", { name: "Archive report 1199" })).toBeInTheDocument();
    expect(screen.getAllByRole("article").length).toBeLessThanOrEqual(40);
    expect(screen.queryByRole("button", { name: "Archive report 0" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load newer reports" }));
    expect(screen.getAllByRole("article").length).toBeGreaterThan(40);
    fireEvent.change(screen.getByLabelText("Search", { exact: true }), {
      target: { value: "Archive report 0" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Archive report 0" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search", { exact: true }), { target: { value: "" } });
    expect(screen.getAllByRole("article")).toHaveLength(40);
    expect(screen.getByRole("button", { name: "Archive report 0" })).toBeInTheDocument();
  });

  it("jumps to the nearest date within the active filters, including reports outside the first batch", async () => {
    mocks.entries = archive();
    render(<DiaryPage />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Jump to date" }));
    fireEvent.change(screen.getByLabelText("Jump to date", { selector: "input" }), {
      target: { value: "2020-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show report" }));
    const oldest = mocks.entries.filter((entry) => entry.entry_date >= "2025-01-01").at(-1)!;
    await waitFor(() => expect(screen.getByRole("button", { name: oldest.title })).toHaveFocus());
    expect(screen.getByLabelText("From")).toHaveValue("2025-01-01");
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });
  it("searches financial suppliers and filters by the trade of linked offers", () => {
    mocks.offers = [{ ...offer("Wiring quote", "2026-11-17"), trade_id: "electrical" }];
    mocks.trades = [{ id: "electrical", name: "Electrical", budget: 0, color: null }];
    mocks.entries = [
      report("Financial report", "2026-11-17", { offer_ids: '["Wiring quote"]' }),
      report("Unrelated", "2026-11-17"),
    ];
    render(<DiaryPage />);
    fireEvent.change(screen.getByLabelText("Search", { exact: true }), {
      target: { value: "Electrical workshop" },
    });
    fireEvent.change(screen.getByLabelText("Filter by trade"), { target: { value: "electrical" } });
    expect(screen.queryByRole("button", { name: "Unrelated" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Financial report" }));
    expect(screen.getByText("Wiring quote", { selector: "span" })).toBeInTheDocument();
  });
  it("combines text, inclusive date and linked-trade filters, then resets the timeline", () => {
    mocks.trades = [{ id: "electrical", name: "Electrical", budget: 0, color: null }];
    mocks.tasks = [task("Wiring", null, "electrical")];
    mocks.entries = [
      report("Recent", "2026-11-17", { task_ids: '["Wiring"]', work_done: "Kitchen wiring" }),
      report("Older", "2026-10-12", { work_done: "Kitchen painting" }),
    ];
    render(<DiaryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(screen.getByRole("dialog", { name: "Recent" })).toHaveTextContent("Kitchen wiring");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByLabelText("Search", { exact: true }), {
      target: { value: "Kitchen" },
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-17" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-17" } });
    fireEvent.change(screen.getByLabelText("Filter by trade"), { target: { value: "electrical" } });
    expect(screen.queryByRole("button", { name: "Older" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recent" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search", { exact: true }), {
      target: { value: "Missing" },
    });
    expect(screen.getByText(/No matching reports/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByRole("button", { name: "Older" })).toBeInTheDocument();
  });
  it("exports the whole diary independently of filters and can separately export only matches", async () => {
    mocks.entries = [report("Selected", "2026-11-17"), report("Excluded", "2026-10-12")];
    render(<DiaryPage />);
    fireEvent.change(screen.getByLabelText("Search", { exact: true }), {
      target: { value: "Selected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entire diary as PDF" }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    expect(mocks.pdf.mock.calls[0]![2]).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Filtered reports as PDF" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Filtered reports as PDF" }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(2));
    expect(mocks.pdf.mock.calls[1]![2]).toEqual([mocks.entries[0]]);
  });
});
