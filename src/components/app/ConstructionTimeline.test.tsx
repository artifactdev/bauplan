import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { Workspace } from "@/lib/schema";
import type { CalendarItem } from "@/lib/calendar-view";
import { ConstructionTimeline } from "./ConstructionTimeline";
import { TaskPrerequisites } from "./TaskPrerequisites";

const mocks = vi.hoisted(() => ({ ws: {} as Workspace }));
vi.mock("@/hooks/use-workspace", () => ({ useWorkspace: () => ({ ws: mocks.ws }) }));
const links = JSON.stringify([{ source: "event", id: "work", lag_days: 2 }]);
beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.ws = {
    projects: [],
    trades: [{ id: "trade", name: "Electrical", color: "#215caa", budget: 0 }],
    tasks: [
      {
        id: "task",
        title: "Close walls",
        status: "offen",
        priority: "mittel",
        assignee_id: null,
        trade_id: "trade",
        phase: null,
        start_date: "2026-11-18",
        due_date: "2026-11-20",
        notes: null,
        cost_item_id: null,
        document_id: null,
        dependencies: links,
      },
      {
        id: "undated",
        title: "Plan painting",
        status: "offen",
        priority: "mittel",
        assignee_id: null,
        trade_id: null,
        phase: null,
        start_date: null,
        due_date: null,
        notes: null,
        cost_item_id: null,
        document_id: null,
      },
    ],
    events: [
      {
        id: "work",
        title: "Rough-in",
        event_date: "2026-11-16",
        end_date: "2026-11-18",
        start_time: null,
        end_time: null,
        kind: "arbeit",
        trade_id: "trade",
        notes: null,
      },
    ],
    cost_items: [],
    offers: [],
    invoices: [],
    documents: [],
    expenses: [],
    ideas: [],
    idea_images: [],
    contacts: [],
    budget_pots: [],
    funding_entries: [],
    credit_terms: [],
    credit_repayments: [],
  };
});
afterEach(cleanup);
const items: CalendarItem[] = [
  {
    id: "work",
    title: "Rough-in",
    date: "2026-11-16",
    end: "2026-11-18",
    label: "16–18 Nov",
    start_time: null,
    kind: "arbeit",
    trade_id: "trade",
    source: { type: "event", id: "work" },
  },
  {
    id: "task",
    title: "Close walls",
    date: "2026-11-18",
    end: "2026-11-20",
    label: "18–20 Nov",
    start_time: null,
    kind: "aufgabe",
    trade_id: "trade",
    source: { type: "task", id: "task" },
  },
  {
    id: "appointment",
    title: "Site visit",
    date: "2026-11-17",
    end: "2026-11-17",
    label: "17 Nov",
    start_time: null,
    kind: "termin",
    trade_id: null,
    source: { type: "event", id: "appointment" },
  },
];
describe("construction timeline", () => {
  it("shows work/task ranges, warnings and undated tasks without ordinary appointments", () => {
    const onOpen = vi.fn();
    render(
      <ConstructionTimeline
        items={items}
        planning={mocks.ws}
        selected="2026-11-16"
        weeks={4}
        onWeeksChange={vi.fn()}
        onOpen={onOpen}
      />,
    );
    expect(screen.queryByText("Site visit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show links: Close walls/ }));
    expect(screen.getByText(/Planned too early: earliest start 21\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Not yet completed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Plan painting" }));
    expect(onOpen).toHaveBeenCalledWith({ type: "task", id: "undated" });
    const region = screen.getByRole("region", { name: "Construction timeline" });
    fireEvent.click(within(region).getByRole("button", { name: /Close walls · 18/ }));
    expect(onOpen).toHaveBeenCalledWith({ type: "task", id: "task" });
  });
  it("changes the zoom without rescheduling and filters unassigned activities", () => {
    const change = vi.fn();
    render(
      <ConstructionTimeline
        items={items}
        planning={mocks.ws}
        selected="2026-11-16"
        weeks={4}
        onWeeksChange={change}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Construction timeline range"), {
      target: { value: "12" },
    });
    expect(change).toHaveBeenCalledWith(12);
    fireEvent.change(screen.getByLabelText("Trade"), { target: { value: "trade" } });
    expect(screen.queryByText("Plan painting")).not.toBeInTheDocument();
  });
  it("shows the full bar title on keyboard focus", async () => {
    render(
      <ConstructionTimeline
        items={items}
        planning={mocks.ws}
        selected="2026-11-16"
        weeks={4}
        onWeeksChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const bar = screen.getByRole("button", { name: /Rough-in · 16/ });
    fireEvent.focus(bar);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Rough-in");
  });
  it("edits typed work prerequisites and retains invalid lag drafts without crashing", () => {
    const onChange = vi.fn();
    render(<TaskPrerequisites value={links} taskId="task" onChange={onChange} />);
    const lag = screen.getByLabelText("Waiting period after Rough-in (calendar days)");
    fireEvent.change(lag, { target: { value: "-1" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(lag).toBeInvalid();
    fireEvent.change(lag, { target: { value: "3" } });
    expect(JSON.parse(onChange.mock.calls[0]![0])).toEqual([
      { source: "event", id: "work", lag_days: 3 },
    ]);
    expect(screen.queryByRole("button", { name: /Close walls/ })).not.toBeInTheDocument();
  });
});
