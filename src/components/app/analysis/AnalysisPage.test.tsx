import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { Workspace } from "@/lib/schema";
import { AnalysisPage } from "./AnalysisPage";

const ws = {
  projects: [
    { id: "p", name: "Home", total_budget: 1000, address: null, start_date: null, end_date: null },
  ],
  trades: [{ id: "t1", name: "Roof", budget: 0, color: null }],
  cost_items: [{ id: "c1", trade_id: "t1", title: "Tiles", description: null, planned: 400 }],
  contacts: [],
  offers: [],
  invoices: [],
  documents: [],
  tasks: [],
  events: [],
  ideas: [],
  idea_images: [],
  budget_pots: [{ id: "bank", name: "Bank", deducts_from_budget: false, notes: null }],
  funding_entries: [],
  credit_terms: [],
  credit_repayments: [],
  expenses: [
    {
      id: "e1",
      title: "Tiles",
      vendor: "Shop",
      amount: 500,
      expense_date: "2026-01-10",
      category: "Material",
      trade_id: "t1",
      cost_item_id: "c1",
      document_id: null,
      status: "bezahlt",
      notes: null,
      budget_pot_id: "bank",
    },
    {
      id: "e2",
      title: "Nails",
      vendor: null,
      amount: 20,
      expense_date: "2026-02-10",
      category: "Material",
      trade_id: "t1",
      cost_item_id: "c1",
      document_id: "d",
      status: "offen",
      notes: null,
      budget_pot_id: "bank",
      due_date: "2000-01-01",
    },
  ],
} as unknown as Workspace;

vi.mock("@/hooks/use-workspace", () => ({ useWorkspace: () => ({ ws }) }));
vi.mock("@/hooks/use-task-assignees", () => ({ useTaskAssignees: () => ({ data: [] }) }));
vi.mock("@/hooks/use-analysis-views", () => ({
  useAnalysisViews: () => ({
    data: { views: [], defaultId: null },
    isFetched: true,
    canAdd: true,
    saving: false,
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
  }),
}));
vi.mock("@/lib/offline-store", () => ({ getOfflineAccount: () => ({ id: "u1" }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

beforeEach(() => {
  // jsdom has no layout engine; recharts only needs the observer to exist.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("summarizes the project and flags what needs attention", () => {
  render(<AnalysisPage search={{}} onSearchChange={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Analysis" })).toBeInTheDocument();
  expect(screen.getByText(/Expected costs exceed the budget|“Tiles” is/)).toBeInTheDocument();
  expect(screen.getByText(/open expenses are overdue/)).toBeInTheDocument();
  expect(screen.getByText("Expenses without receipt").closest("a")).toHaveTextContent("1");
});

it("offers every chart as an accessible table and keeps the section in the URL state", () => {
  const onSearchChange = vi.fn();
  render(<AnalysisPage search={{ section: "expenses" }} onSearchChange={onSearchChange} />);
  const card = screen.getByRole("heading", { name: "By payment source" }).closest("section")!;
  expect(within(card).getByRole("img")).toHaveAccessibleName(/Bank/);
  fireEvent.click(within(card).getByRole("button", { name: "Show as table" }));
  expect(within(card).getByRole("table")).toHaveTextContent("520.00");

  fireEvent.mouseDown(screen.getByRole("tab", { name: "Budget" }), { button: 0 });
  expect(onSearchChange).toHaveBeenCalledWith(expect.objectContaining({ section: "budget" }));
});

it("hides the credit tab until loan terms exist", () => {
  render(<AnalysisPage search={{ section: "credit" }} onSearchChange={vi.fn()} />);
  expect(screen.queryByRole("tab", { name: "Loan" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Overview", selected: true })).toBeInTheDocument();
});
