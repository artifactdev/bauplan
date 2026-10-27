import { describe, expect, it } from "vitest";
import {
  annuityPayment,
  bankFundedPayments,
  calculateCreditCosts,
  expectedCost,
  isOverdue,
  summarize,
} from "./calc";

const base = {
  trades: [],
  projects: [
    { id: "p", name: "x", address: null, total_budget: 10000, start_date: null, end_date: null },
  ],
};

describe("budget calculation", () => {
  it("uses planned amount when nothing is committed or invoiced", () => {
    expect(expectedCost(5000, 0, 0)).toBe(5000);
  });

  it("does not add accepted offer and invoice for the same item", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Bad", description: null, planned: 4000 }],
      offers: [
        {
          id: "o",
          trade_id: null,
          cost_item_id: "c",
          document_id: null,
          contact_id: null,
          requested_date: null,
          contractor: "A",
          title: null,
          amount: 4500,
          offer_date: null,
          status: "accepted",
          notes: null,
        },
      ],
      invoices: [
        {
          id: "i",
          trade_id: null,
          cost_item_id: "c",
          document_id: null,
          contact_id: null,
          contractor: "A",
          title: null,
          amount: 4500,
          invoice_date: null,
          due_date: null,
          paid: true,
        },
      ],
    });
    expect(s.expected).toBe(4500);
    expect(s.remaining).toBe(5500);
    expect(s.paid).toBe(4500);
  });

  it("ignores rejected offers", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Bad", description: null, planned: 4000 }],
      offers: [
        {
          id: "o",
          trade_id: null,
          cost_item_id: "c",
          document_id: null,
          contact_id: null,
          requested_date: null,
          contractor: "A",
          title: null,
          amount: 9000,
          offer_date: null,
          status: "rejected",
          notes: null,
        },
      ],
      invoices: [],
    });
    expect(s.expected).toBe(4000);
    expect(s.committed).toBe(0);
  });

  it("does not count requested offers as committed", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Bad", description: null, planned: 4000 }],
      offers: [
        {
          id: "o",
          trade_id: null,
          cost_item_id: "c",
          document_id: null,
          contact_id: null,
          requested_date: "2026-10-01",
          contractor: "A",
          title: null,
          amount: 0,
          offer_date: null,
          status: "requested",
          notes: null,
        },
      ],
      invoices: [],
    });
    expect(s.committed).toBe(0);
    expect(s.expected).toBe(4000);
  });

  it("uses accepted offers as planned costs when no separate plan was entered", () => {
    const offer = {
      id: "roof-offer",
      trade_id: "roof",
      cost_item_id: "roof-item",
      document_id: null,
      contact_id: null,
      requested_date: null,
      contractor: "Dachdecker",
      title: null,
      amount: 30392,
      offer_date: null,
      status: "accepted" as const,
      notes: null,
    };
    const s = summarize({
      ...base,
      cost_items: [
        { id: "roof-item", trade_id: "roof", title: "Dach", description: null, planned: 0 },
      ],
      offers: [offer],
      invoices: [],
    });

    expect(s.committed).toBe(30392);
    expect(s.planned).toBe(30392);
    expect(s.expected).toBe(30392);
  });

  it("keeps an explicitly entered plan when an accepted offer exists", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Dach", description: null, planned: 35000 }],
      offers: [
        {
          id: "o",
          trade_id: null,
          cost_item_id: "c",
          document_id: null,
          contact_id: null,
          requested_date: null,
          contractor: "Dachdecker",
          title: null,
          amount: 30392,
          offer_date: null,
          status: "accepted",
          notes: null,
        },
      ],
      invoices: [],
    });

    expect(s.planned).toBe(35000);
    expect(s.expected).toBe(30392);
  });

  it("counts budget transactions only when they are assigned to a cost item", () => {
    const s = summarize({
      ...base,
      cost_items: [],
      offers: [
        {
          id: "orphan-offer",
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          contact_id: null,
          requested_date: null,
          contractor: "Dachdecker",
          title: null,
          amount: 300,
          offer_date: null,
          status: "accepted",
          notes: null,
        },
      ],
      invoices: [],
      expenses: [
        {
          id: "orphan-expense",
          title: "Material",
          vendor: null,
          amount: 120,
          expense_date: null,
          category: null,
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          status: "bezahlt",
          notes: null,
        },
      ],
    });

    expect(s.expected).toBe(0);
    expect(s.planned).toBe(0);
    expect(s.committed).toBe(0);
    expect(s.invoiced).toBe(0);
    expect(s.paid).toBe(0);
  });
});

describe("expenses", () => {
  const exp = (amount: number, status: "offen" | "bezahlt" | "eingereicht" | "erstattet") => ({
    id: String(Math.random()),
    title: "Baumarkt",
    vendor: null,
    amount,
    expense_date: null,
    category: null,
    trade_id: null,
    cost_item_id: "c",
    document_id: null,
    status,
    notes: null,
  });
  it("deducts receipts from the remaining budget", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Baumarkt", description: null, planned: 0 }],
      offers: [],
      invoices: [],
      expenses: [exp(120, "bezahlt"), exp(80, "offen")],
    });
    expect(s.expected).toBe(200);
    expect(s.remaining).toBe(9800);
    expect(s.paid).toBe(120);
  });
  it("reimbursed expenses still count as spent", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Baumarkt", description: null, planned: 0 }],
      offers: [],
      invoices: [],
      expenses: [exp(50, "erstattet")],
    });
    expect(s.remaining).toBe(9950);
    expect(s.reimbursed).toBe(50);
  });
});

describe("overdue", () => {
  it("flags open tasks past due date", () => {
    expect(isOverdue("2026-01-01", false, "2026-02-01")).toBe(true);
    expect(isOverdue("2026-01-01", true, "2026-02-01")).toBe(false);
  });
});

describe("payment sources", () => {
  const base = {
    cost_items: [],
    offers: [],
    projects: [
      { id: "p", name: "P", address: null, total_budget: 1000, start_date: null, end_date: null },
    ],
  };
  const pots = [
    { id: "bank", name: "Bank", deducts_from_budget: true, notes: null },
    { id: "priv", name: "Privat", deducts_from_budget: false, notes: null },
  ];
  const exp = (amount: number, budget_pot_id: string | null) => ({
    id: String(amount),
    title: "x",
    vendor: null,
    amount,
    expense_date: null,
    category: "Werkzeug",
    trade_id: null,
    cost_item_id: "c",
    document_id: null,
    status: "bezahlt" as const,
    notes: null,
    budget_pot_id,
  });

  it("Privat expenses are not deducted from the total budget, Bank and unassigned ones are", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Werkzeug", description: null, planned: 0 }],
      invoices: [],
      expenses: [exp(100, "priv"), exp(50, "bank"), exp(20, null)],
      budget_pots: pots,
    });
    expect(s.expected).toBe(70);
    expect(s.remaining).toBe(930);
    expect(s.pots.find((p) => p.id === "priv")!.spent).toBe(100);
  });

  it("a paid invoice from Privat does not count as paid from the budget", () => {
    const inv = {
      id: "i",
      trade_id: null,
      cost_item_id: "c",
      document_id: null,
      contact_id: null,
      contractor: "A",
      title: null,
      amount: 200,
      invoice_date: null,
      due_date: null,
      paid: true,
      budget_pot_id: "priv",
    };
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Werkzeug", description: null, planned: 0 }],
      invoices: [inv],
      expenses: [],
      budget_pots: pots,
    });
    expect(s.paid).toBe(0);
    expect(s.pots.find((p) => p.id === "priv")!.paid).toBe(200);
  });
});

describe("credit interest", () => {
  const terms = {
    id: "loan",
    budget_pot_id: "bank",
    total_credit: 10000,
    annual_rate: 36.5,
    interest_free_start: "2026-01-01",
    interest_free_end: "2026-01-31",
    repayment_start: "2026-02-01",
    commitment_rate: 1,
    commitment_free_end: "2026-01-01",
    repayment_months: 12,
    day_basis: 365 as const,
  };

  it("calculates daily actual and forecast interest from bank-funded payments and repayments", () => {
    const result = calculateCreditCosts(
      terms,
      [
        { amount: 1000, date: "2026-01-01", actual: true },
        { amount: 2000, date: "2026-01-16", actual: false },
      ],
      [{ id: "r", amount: 500, repayment_date: "2026-01-17", notes: null }],
      "2026-01-31",
    );
    expect(result?.actualInterest).toBeCloseTo(23.5, 8);
    expect(result?.plannedInterest).toBeCloseTo(55.5, 8);
    expect(result?.actualCommitment).toBeCloseTo(2775 / 31, 8);
    expect(result?.plannedCommitment).toBeCloseTo(2455 / 31, 8);
    expect(result?.actualBalance).toBe(500);
    expect(result?.plannedBalance).toBe(2500);
    expect(result?.months).toHaveLength(1);
    expect(result?.months[0]?.actualCumulative).toBeCloseTo(
      result!.actualInterest + result!.actualCommitment,
      8,
    );
  });

  it("uses the selected bank source and payment dates for invoices and expenses", () => {
    const payments = bankFundedPayments(
      [
        {
          id: "paid",
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          contact_id: null,
          contractor: "A",
          title: null,
          amount: 100,
          invoice_date: "2026-01-01",
          due_date: "2026-01-20",
          paid: true,
          payment_date: "2026-01-04",
          budget_pot_id: "bank",
        },
        {
          id: "open",
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          contact_id: null,
          contractor: "A",
          title: null,
          amount: 200,
          invoice_date: "2026-01-01",
          due_date: "2026-01-20",
          paid: false,
          payment_date: null,
          budget_pot_id: "bank",
        },
        {
          id: "private",
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          contact_id: null,
          contractor: "A",
          title: null,
          amount: 300,
          invoice_date: "2026-01-01",
          due_date: null,
          paid: true,
          budget_pot_id: "private",
        },
      ],
      [
        {
          id: "expense",
          title: "x",
          vendor: null,
          amount: 50,
          expense_date: "2026-01-02",
          payment_date: "2026-01-03",
          category: null,
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          status: "bezahlt",
          notes: null,
          budget_pot_id: "bank",
        },
      ],
      "bank",
    );
    expect(payments).toEqual([
      { amount: 100, date: "2026-01-04", actual: true },
      { amount: 200, date: "2026-01-20", actual: false },
      { amount: 50, date: "2026-01-03", actual: true },
    ]);
  });

  it("calculates an annuity for zero interest", () => {
    expect(annuityPayment(12000, 0, 12)).toBe(1000);
  });

  it("allows repayment to start on the last interest-free date", () => {
    const result = calculateCreditCosts(
      { ...terms, interest_free_end: "2026-01-31", repayment_start: "2026-01-31" },
      [{ amount: 1000, date: "2026-01-01", actual: true }],
      [],
      "2026-01-31",
    );
    expect(result).not.toBeNull();
    expect(result?.months.map((month) => month.month)).toContain("2026-01");
    expect(result?.plannedInterest).toBeCloseTo(30, 8);
  });

  it("uses the single full-drawdown date as the first scheduled installment date", () => {
    const result = calculateCreditCosts(
      {
        ...terms,
        interest_free_start: null,
        interest_free_end: null,
        repayment_start: null,
        commitment_free_end: null,
        first_installment_date: "2026-02-01",
        commitment_start: "2026-02-01",
        monthly_installment: 900,
        repayment_count: 2,
      },
      [
        { amount: 1000, date: "2026-01-01", actual: true },
        { amount: 2000, date: "2026-02-01", actual: false },
      ],
      [],
      "2026-01-31",
    );
    expect(result).not.toBeNull();
    expect(result?.months.find((month) => month.month === "2026-01")?.plannedInterest).toBeCloseTo(
      31,
      8,
    );
    expect(result?.months.find((month) => month.month === "2026-02")?.plannedDraws).toBe(2000);
    expect(result?.plannedBalance).toBeLessThan(3000);
    expect(result?.annuity).toBe(900);
  });
});
