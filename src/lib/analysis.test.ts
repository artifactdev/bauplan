import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  NONE,
  activeFilterCount,
  analysisViewsSchema,
  buildLedger,
  burnDown,
  dataQuality,
  dueBuckets,
  filterLedger,
  offerComparison,
  periodKey,
  periodRange,
  reimbursementFunnel,
  seriesByPeriod,
  taskProgress,
} from "./analysis";
import type { Expense, Offer, Task } from "./schema";

const pots = [
  { id: "bank", name: "Bank", deducts_from_budget: false, notes: null },
  { id: "jerry", name: "Jerry", deducts_from_budget: false, notes: null },
];
const costItems = [
  { id: "roof", trade_id: "t1", title: "Dach", description: null, planned: 100 },
  { id: "buy", trade_id: null, title: "Anschaffung", description: null, planned: 0 },
];
const expense = (patch: Partial<Expense>): Expense => ({
  id: Math.random().toString(),
  title: "x",
  vendor: null,
  amount: 100,
  expense_date: "2026-01-10",
  category: "Material",
  trade_id: "t1",
  cost_item_id: "roof",
  document_id: "doc",
  status: "bezahlt",
  notes: null,
  budget_pot_id: "bank",
  ...patch,
});
const ws = (expenses: Expense[]) => ({
  expenses,
  invoices: [],
  cost_items: costItems,
  budget_pots: pots,
  contacts: [],
});

describe("ledger", () => {
  it("marks what counts toward the budget like the budget math does", () => {
    const ledger = buildLedger(
      ws([
        expense({ id: "bank", cost_item_id: null }),
        expense({ id: "private", budget_pot_id: "jerry" }),
        expense({ id: "special", budget_pot_id: "jerry", cost_item_id: "buy" }),
      ]),
    );
    expect(Object.fromEntries(ledger.map((e) => [e.id, e.countsToBudget]))).toEqual({
      bank: true,
      private: false,
      special: false,
    });
  });

  it("uses the selected date basis and drops undated entries when a range is set", () => {
    const rows = [expense({ id: "a", expense_date: "2026-01-10", payment_date: "2026-02-05" })];
    expect(buildLedger(ws(rows), "payment")[0]?.date).toBe("2026-02-05");
    const undated = buildLedger(ws([expense({ expense_date: null })]));
    expect(filterLedger(undated, DEFAULT_FILTERS)).toHaveLength(1);
    expect(filterLedger(undated, { ...DEFAULT_FILTERS, from: "2026-01-01" })).toHaveLength(0);
  });

  it("filters by dimension, including entries without a value", () => {
    const ledger = buildLedger(
      ws([
        expense({ id: "a" }),
        expense({ id: "b", trade_id: null, budget_pot_id: null }),
        expense({ id: "c", status: "erstattet", category: "Werkzeug" }),
      ]),
    );
    const ids = (patch: Partial<typeof DEFAULT_FILTERS>) =>
      filterLedger(ledger, { ...DEFAULT_FILTERS, ...patch }).map((e) => e.id);
    expect(ids({ tradeIds: [NONE] })).toEqual(["b"]);
    expect(ids({ potIds: [NONE] })).toEqual(["b"]);
    expect(ids({ statuses: ["erstattet"] })).toEqual(["c"]);
    expect(
      ids({ categories: ["Werkzeug", "Material"], from: "2026-01-10", to: "2026-01-10" }),
    ).toHaveLength(3);
    expect(ids({ budgetOnly: true })).toEqual(["a", "b", "c"]);
  });

  it("counts active filters", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        from: "2026-01-01",
        tradeIds: ["t1"],
        budgetOnly: true,
      }),
    ).toBe(3);
  });
});

describe("periods and series", () => {
  it("builds period keys and fills gaps", () => {
    expect(periodKey("2026-11-13", "month")).toBe("2026-11");
    expect(periodKey("2026-11-13", "quarter")).toBe("2026-Q4");
    expect(periodKey("2026-11-15", "week")).toBe("2026-11-09");
    expect(periodRange("2026-01-31", "2026-04-02", "month")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(periodRange("2026-02-01", "2026-12-31", "quarter")).toEqual([
      "2026-Q1",
      "2026-Q2",
      "2026-Q3",
      "2026-Q4",
    ]);
  });

  it("keeps series totals equal to the input and folds small groups into other", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      expense({
        id: `e${index}`,
        amount: 10 + index,
        category: `cat${index}`,
        expense_date: index < 4 ? "2026-01-05" : "2026-03-05",
      }),
    );
    const series = seriesByPeriod(buildLedger(ws(rows)), "month", (entry) => entry.category);
    expect(series.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(series.keys).toHaveLength(7);
    expect(series.keys.at(-1)).toBe("__other");
    const total = series.rows.reduce(
      (sum, row) => sum + series.keys.reduce((s, key) => s + Number(row[key]), 0),
      0,
    );
    expect(total).toBe(rows.reduce((sum, row) => sum + row.amount, 0));
  });

  it("accumulates the burn-down against the budget", () => {
    const ledger = buildLedger(
      ws([
        expense({ amount: 100, expense_date: "2026-01-02" }),
        expense({ amount: 50, expense_date: "2026-03-02", status: "offen" }),
      ]),
    );
    expect(burnDown(ledger, "month", 500)).toEqual([
      { period: "2026-01", spent: 100, paid: 100, budget: 500 },
      { period: "2026-02", spent: 100, paid: 100, budget: 500 },
      { period: "2026-03", spent: 150, paid: 100, budget: 500 },
    ]);
  });
});

describe("expense analysis", () => {
  it("computes the reimbursement rate from decided amounts only", () => {
    const ledger = buildLedger(
      ws([
        expense({ status: "eingereicht", amount: 500 }),
        expense({ status: "erstattet", amount: 300 }),
        expense({ status: "abgelehnt", amount: 100 }),
      ]),
    );
    expect(reimbursementFunnel(ledger)).toMatchObject({
      submitted: 500,
      reimbursed: 300,
      rejected: 100,
      rate: 0.75,
    });
    expect(reimbursementFunnel([]).rate).toBeNull();
  });

  it("buckets open expenses by due date", () => {
    const ledger = buildLedger(
      ws([
        expense({ status: "offen", amount: 1, due_date: "2026-01-01" }),
        expense({ status: "offen", amount: 2, due_date: "2026-01-20" }),
        expense({ status: "offen", amount: 4, due_date: "2026-02-10" }),
        expense({ status: "offen", amount: 8, due_date: "2026-06-01" }),
        expense({ status: "offen", amount: 16, due_date: null }),
        expense({ status: "bezahlt", amount: 32, due_date: "2026-01-01" }),
      ]),
    );
    expect(dueBuckets(ledger, "2026-01-15")).toEqual({
      overdue: 1,
      week: 2,
      month: 4,
      later: 8,
      undated: 16,
    });
  });

  it("reports data quality gaps", () => {
    const ledger = buildLedger(
      ws([
        expense({ id: "ok" }),
        expense({ id: "gap", cost_item_id: null, document_id: null, budget_pot_id: null }),
      ]),
    );
    const quality = dataQuality(ledger, { cost_items: [...costItems], offers: [] });
    expect(quality.noCostItem.map((e) => e.id)).toEqual(["gap"]);
    expect(quality.noReceipt.map((e) => e.id)).toEqual(["gap"]);
    expect(quality.noSource.map((e) => e.id)).toEqual(["gap"]);
    expect(quality.noPlan.map((item) => item.id)).toEqual(["buy"]);
  });
});

describe("offers and tasks", () => {
  const offer = (patch: Partial<Offer>): Offer => ({
    id: Math.random().toString(),
    trade_id: "t1",
    cost_item_id: "roof",
    document_id: null,
    contact_id: null,
    requested_date: null,
    contractor: "c",
    title: null,
    amount: 100,
    offer_date: null,
    status: "received",
    notes: null,
    ...patch,
  });

  it("shows the saving of the accepted quote versus the most expensive one", () => {
    const [row] = offerComparison([
      offer({ amount: 1000, status: "accepted" }),
      offer({ amount: 1400 }),
      offer({ amount: 1200 }),
      offer({ amount: 50, status: "requested" }),
    ]);
    expect(row).toMatchObject({ min: 1000, max: 1400, accepted: 1000, count: 3, saving: 400 });
  });

  it("counts task states and overdue tasks per group", () => {
    const task = (patch: Partial<Task>): Task => ({
      id: Math.random().toString(),
      title: "t",
      assignee_id: null,
      trade_id: null,
      phase: "Planung",
      priority: "mittel",
      status: "offen",
      due_date: null,
      notes: null,
      cost_item_id: null,
      document_id: null,
      ...patch,
    });
    const [group] = taskProgress(
      [
        task({}),
        task({ status: "in_arbeit" }),
        task({ status: "erledigt", due_date: "2026-01-01" }),
        task({ due_date: "2026-01-01" }),
      ],
      (item) => item.phase,
      "2026-02-01",
    );
    expect(group).toMatchObject({
      key: "Planung",
      open: 2,
      progress: 1,
      done: 1,
      overdue: 1,
      total: 4,
    });
  });
});

describe("saved views", () => {
  const view = { id: "v1", name: "Q4", section: "expenses" as const, filters: DEFAULT_FILTERS };
  it("accepts valid views and rejects duplicates, unknown defaults and extra fields", () => {
    expect(analysisViewsSchema.safeParse({ views: [view], defaultId: "v1" }).success).toBe(true);
    expect(analysisViewsSchema.safeParse({ views: [view, view], defaultId: null }).success).toBe(
      false,
    );
    expect(analysisViewsSchema.safeParse({ views: [view], defaultId: "nope" }).success).toBe(false);
    expect(
      analysisViewsSchema.safeParse({ views: [{ ...view, userId: "x" }], defaultId: null }).success,
    ).toBe(false);
    expect(
      analysisViewsSchema.safeParse({ views: [{ ...view, name: "  " }], defaultId: null }).success,
    ).toBe(false);
  });
});
