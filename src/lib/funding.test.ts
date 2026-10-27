import { describe, expect, it } from "vitest";
import { bankFundedPayments, summarize } from "./calc";
import { validateFundingEntry } from "./funding";
import type { BudgetPot, Expense, FundingEntry } from "./schema";

const pots: BudgetPot[] = [
  { id: "bank", name: "Bank", deducts_from_budget: true, notes: null },
  { id: "grandma", name: "Oma", deducts_from_budget: true, notes: null },
  { id: "private", name: "Private", deducts_from_budget: false, notes: null },
];
const funding: FundingEntry = {
  id: "funding",
  budget_pot_id: "grandma",
  amount: 10000,
  received_date: "2026-01-01",
  notes: null,
};
const expense: Expense = {
  id: "expense",
  title: "Work",
  vendor: null,
  amount: 3000,
  status: "bezahlt",
  expense_date: "2026-01-02",
  budget_pot_id: "grandma",
  cost_item_id: "cost",
  trade_id: null,
  document_id: null,
  category: "Material",
  notes: null,
};
const workspace = {
  projects: [
    {
      id: "project",
      name: "Home",
      total_budget: 100000,
      address: null,
      start_date: null,
      end_date: null,
    },
  ],
  cost_items: [{ id: "cost", title: "Work", planned: 0, trade_id: null, description: null }],
  offers: [],
  invoices: [],
  budget_pots: pots,
  expenses: [expense],
  funding_entries: [funding],
};

describe("additional project funding", () => {
  it("adds received funds to the initial bank budget and deducts expenses exactly once", () => {
    const result = summarize(workspace);
    expect(result.bankBudget).toBe(100000);
    expect(result.additionalFunding).toBe(10000);
    expect(result.budget).toBe(110000);
    expect(result.paid).toBe(3000);
    expect(result.expected).toBe(3000);
    expect(result.remaining).toBe(107000);
    expect(result.pots.find((source) => source.id === "grandma")).toMatchObject({
      received: 10000,
      spent: 3000,
      paid: 3000,
      remaining: 7000,
    });
  });

  it("supports multiple incoming payments from the same source, edits and deletion", () => {
    expect(
      summarize({
        ...workspace,
        funding_entries: [funding, { ...funding, id: "second", amount: 500 }],
      }).budget,
    ).toBe(110500);
    expect(
      summarize({ ...workspace, funding_entries: [{ ...funding, amount: 8000 }] }).budget,
    ).toBe(108000);
    expect(summarize({ ...workspace, funding_entries: [] }).budget).toBe(100000);
    expect(summarize({ ...workspace, funding_entries: [] }).paid).toBe(3000);
  });

  it("keeps donation-funded payments out of the selected bank loan drawdowns", () => {
    expect(bankFundedPayments([], workspace.expenses, "bank")).toEqual([]);
    expect(
      bankFundedPayments(
        [],
        [...workspace.expenses, { ...expense, id: "bank-expense", budget_pot_id: "bank" }],
        "bank",
      ),
    ).toEqual([{ amount: 3000, date: "2026-01-02", actual: true }]);
  });

  it("preserves cost-item and payment-source eligibility and counts open spending only as forecast", () => {
    const result = summarize({
      ...workspace,
      expenses: [
        { ...expense, status: "offen" },
        { ...expense, id: "unassigned", cost_item_id: null, amount: 500 },
        { ...expense, id: "private", budget_pot_id: "private", amount: 100 },
      ],
    });
    expect(result.budget).toBe(110000);
    expect(result.remaining).toBe(107000);
    expect(result.paid).toBe(0);
    expect(result.open).toBe(3000);
    expect(result.pots.find((source) => source.id === "grandma")?.remaining).toBe(6500);
  });

  it("supports older workspaces without funding and reports overspent sources", () => {
    expect(
      summarize({
        projects: workspace.projects,
        cost_items: workspace.cost_items,
        offers: [],
        invoices: [],
      }).budget,
    ).toBe(100000);
    expect(
      summarize({ ...workspace, expenses: [{ ...expense, amount: 12000 }] }).pots.find(
        (source) => source.id === "grandma",
      )?.remaining,
    ).toBe(-2000);
  });

  it("validates amount, actual calendar date and a budget-counting payment source", () => {
    expect(() => validateFundingEntry({ ...funding }, pots)).not.toThrow();
    for (const amount of [0, -1, NaN, Infinity, "no amount"])
      expect(() => validateFundingEntry({ ...funding, amount }, pots)).toThrow(
        "funding.invalid_amount",
      );
    for (const received_date of ["", null, "2026-02-30", "2026-13-01", "not a date"])
      expect(() => validateFundingEntry({ ...funding, received_date }, pots)).toThrow(
        "funding.invalid_date",
      );
    for (const budget_pot_id of ["private", "missing", null])
      expect(() => validateFundingEntry({ ...funding, budget_pot_id }, pots)).toThrow(
        "funding.invalid_source",
      );
  });
});
