import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { todayISO } from "@/lib/format";
import { Route } from "./kalender";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  date: "",
  start: null as string | null,
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      events: [
        {
          id: "same-id",
          title: "Site visit",
          event_date: mocks.date,
          end_date: null,
          start_time: null,
          end_time: null,
          kind: "termin",
          trade_id: null,
          notes: "Event notes",
        },
      ],
      tasks: [
        {
          id: "same-id",
          title: "Remove panels",
          due_date: mocks.date,
          start_date: mocks.start,
          status: "offen",
          priority: "hoch",
          phase: "Rückbau",
          assignee_id: null,
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          notes: "Task notes",
        },
      ],
      offers: [
        {
          id: "offer-with-hyphens",
          contractor: "Roofing",
          title: "Roof",
          status: "received",
          valid_until: mocks.date,
          amount: 1000,
          offer_date: mocks.date,
          requested_date: null,
          contact_id: null,
          cost_item_id: null,
          trade_id: null,
          document_id: null,
          notes: "Quote notes",
        },
      ],
      contacts: [],
      trades: [],
      cost_items: [],
      documents: [],
    },
  }),
  useMutations: () => ({
    update: { mutateAsync: mocks.update },
    create: { mutateAsync: mocks.create },
    remove: { mutate: mocks.remove },
  }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useTaskAssignees: () => ({ data: [], isError: false }),
}));
vi.mock("@/components/app/ScanBar", () => ({ ScanBar: () => null }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  mocks.date = todayISO();
  mocks.start = null;
  mocks.update.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderCalendar() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing calendar component");
  render(<Page />);
}

describe("calendar source dialogs", () => {
  it("shows a multi-day task as continuous weekly bars and edits its start date", async () => {
    const month = todayISO().slice(0, 7);
    mocks.start = `${month}-10`;
    mocks.date = `${month}-12`;
    renderCalendar();
    const bars = screen.getAllByRole("button", { name: /Remove panels/ });
    expect(
      bars.reduce(
        (days, bar) => days + Number(bar.parentElement!.style.gridColumn.split("span ")[1]),
        0,
      ),
    ).toBe(3);
    fireEvent.click(bars[0]!);
    expect(screen.getByLabelText("Start date")).toHaveValue(mocks.start);
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: `${month}-09` } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        table: "tasks",
        id: "same-id",
        patch: expect.objectContaining({ start_date: `${month}-09`, due_date: mocks.date }),
      }),
    );
  });
  it("does not mark an ongoing multi-day task as overdue before its due date", () => {
    const today = new Date(`${todayISO()}T12:00:00Z`);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 2);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 2);
    mocks.start = start.toISOString().slice(0, 10);
    mocks.date = end.toISOString().slice(0, 10);
    renderCalendar();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Agenda" }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole("heading", { name: "Overdue" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove panels/ })).toBeInTheDocument();
  });
  it("deletes an appointment from its modal after confirmation and closes on success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.remove.mockImplementation((_values, options) => options?.onSuccess());
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: /Site visit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith(
      { table: "events", id: "same-id" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the appointment when deletion is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: /Site visit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  for (const view of ["month", "list"] as const) {
    it(`opens and updates the actual task in the ${view} view`, async () => {
      renderCalendar();
      if (view === "list")
        fireEvent.mouseDown(screen.getByRole("tab", { name: "Agenda" }), {
          button: 0,
          ctrlKey: false,
        });
      fireEvent.click(await screen.findByRole("button", { name: /Remove panels/ }));
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Edit task");
      expect(screen.getByLabelText("Title")).toHaveValue("Remove panels");
      expect(screen.getByLabelText("Notes")).toHaveValue("Task notes");
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Panels removed" } });
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith({
          table: "tasks",
          id: "same-id",
          patch: expect.objectContaining({ title: "Panels removed", due_date: mocks.date }),
        }),
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it(`opens and updates the linked quote deadline in the ${view} view`, async () => {
      renderCalendar();
      if (view === "list")
        fireEvent.mouseDown(screen.getByRole("tab", { name: "Agenda" }), {
          button: 0,
          ctrlKey: false,
        });
      fireEvent.click(await screen.findByRole("button", { name: /Roofing.*Roof/ }));
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Edit quote");
      expect(screen.getByLabelText("Valid until")).toHaveValue(mocks.date);
      fireEvent.change(screen.getByLabelText(/gross amount/i), { target: { value: "1200" } });
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith({
          table: "offers",
          id: "offer-with-hyphens",
          patch: expect.objectContaining({ amount: "1200", contractor: "Roofing" }),
        }),
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it(`opens the original appointment in the ${view} view even when a task has the same ID`, async () => {
      renderCalendar();
      if (view === "list")
        fireEvent.mouseDown(screen.getByRole("tab", { name: "Agenda" }), {
          button: 0,
          ctrlKey: false,
        });
      fireEvent.click(await screen.findByRole("button", { name: /Site visit/ }));
      expect(screen.getByLabelText("Title")).toHaveValue("Site visit");
      expect(screen.getByLabelText("Notes")).toHaveValue("Event notes");
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith({
          table: "events",
          id: "same-id",
          patch: expect.objectContaining({ title: "Site visit" }),
        }),
      );
    });
  }
});
