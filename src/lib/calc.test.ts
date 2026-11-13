import { describe, expect, it } from "vitest";
import {
  annuityPayment,
  creditTimeline,
  installmentCount,
  suggestedInstallment,
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

  it("keeps a planned amount when invoices are only partial and no offer exists", () => {
    expect(expectedCost(5000, 0, 1200)).toBe(5000);
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

  it("counts Bank expenses even without a cost item or a budget-enabled source", () => {
    const s = summarize({
      ...base,
      cost_items: [],
      offers: [],
      invoices: [],
      expenses: [
        {
          id: "bank-expense",
          title: "Haus + Grundstück",
          vendor: null,
          amount: 220000,
          expense_date: null,
          category: "Sonstiges",
          trade_id: null,
          cost_item_id: null,
          document_id: null,
          status: "bezahlt",
          notes: null,
          budget_pot_id: "bank",
        },
      ],
      budget_pots: [{ id: "bank", name: "Bank", deducts_from_budget: false, notes: null }],
    });

    expect(s.expected).toBe(220000);
    expect(s.budgetExpected).toBe(220000);
    expect(s.invoiced).toBe(220000);
    expect(s.paid).toBe(220000);
    expect(s.remaining).toBe(-210000);
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

  it("includes private Anschaffung and Rückbau expenses in dashboard costs but not budget spending", () => {
    const s = summarize({
      ...base,
      cost_items: [
        { id: "acquisition", trade_id: null, title: "Anschaffung", description: null, planned: 0 },
        { id: "demolition", trade_id: null, title: "Rückbau", description: null, planned: 0 },
      ],
      offers: [],
      invoices: [],
      expenses: [
        { ...exp(200, "bezahlt"), cost_item_id: "acquisition", budget_pot_id: "priv" },
        { ...exp(100, "offen"), cost_item_id: "demolition", budget_pot_id: "priv" },
      ],
      budget_pots: [{ id: "priv", name: "Privat", deducts_from_budget: false, notes: null }],
    });

    expect(s.expected).toBe(300);
    expect(s.budgetExpected).toBe(0);
    expect(s.remaining).toBe(10000);
    expect(s.expensesTotal).toBe(300);
    expect(s.paid).toBe(200);
  });

  it("subtracts the private acquisition amount from the budget forecast without double-counting its offer", () => {
    const s = summarize({
      ...base,
      projects: [
        {
          id: "p",
          name: "x",
          address: null,
          total_budget: 361000,
          start_date: null,
          end_date: null,
        },
      ],
      cost_items: [
        { id: "acquisition", trade_id: null, title: "Anschaffung", description: null, planned: 0 },
      ],
      offers: [
        {
          id: "purchase-offer",
          trade_id: null,
          cost_item_id: "acquisition",
          document_id: null,
          contact_id: null,
          requested_date: null,
          contractor: "Verkäufer",
          title: "Hauskauf",
          amount: 220000,
          offer_date: null,
          status: "accepted",
          notes: null,
        },
      ],
      invoices: [],
      expenses: [
        { ...exp(201000, "bezahlt"), cost_item_id: "acquisition", budget_pot_id: "bank" },
        { ...exp(19000, "bezahlt"), cost_item_id: "acquisition", budget_pot_id: "priv" },
      ],
      budget_pots: [
        { id: "bank", name: "Bank", deducts_from_budget: false, notes: null },
        { id: "priv", name: "Privat", deducts_from_budget: false, notes: null },
      ],
    });

    expect(s.expected).toBe(220000);
    expect(s.budgetExpected).toBe(201000);
    expect(s.budgetPaid).toBe(201000);
    expect(s.remaining).toBe(160000);
  });

  it("splits the budget forecast into paid and still-to-pay without exceeding it", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Baumarkt", description: null, planned: 0 }],
      offers: [],
      invoices: [],
      expenses: [exp(120, "bezahlt"), exp(80, "offen")],
    });
    expect(s.budgetExpected).toBe(200);
    expect(s.budgetPaid).toBe(120);
    expect(s.items[0]?.budgetPaid).toBe(120);
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
    { id: "bank", name: "Bank", deducts_from_budget: false, notes: null },
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

  describe("real-world loan (30/360, interest-only until the first installment)", () => {
    const loan = {
      ...terms,
      total_credit: 361000,
      annual_rate: 4.1,
      commitment_rate: 0.2,
      interest_free_start: null,
      interest_free_end: null,
      repayment_start: null,
      commitment_free_end: null,
      day_basis: 30 as const,
      first_installment_date: "2028-02-07",
      commitment_start: "2028-02-07",
      monthly_installment: 1759.88,
      repayment_count: 354,
    };
    const draws = [{ amount: 201000, date: "2026-10-30", actual: true }];
    // the rest is drawn long after the repayment start, so commitment fees run
    const late = { ...loan, assumed_full_draw_date: "2029-01-01" };
    const month = (result: ReturnType<typeof calculateCreditCosts>, key: string) =>
      result!.months.find((row) => row.month === key)!;

    it("charges one twelfth of the annual interest every month", () => {
      const result = calculateCreditCosts(loan, draws, [], "2026-11-13");
      expect(month(result, "2026-12").plannedInterest).toBeCloseTo(686.75, 2);
      expect(month(result, "2027-02").plannedInterest).toBeCloseTo(686.75, 2);
      expect(month(result, "2027-12").plannedPayment).toBeCloseTo(686.75, 2);
      expect(month(result, "2027-12").plannedRepayment).toBe(0);
    });

    it("does not charge the part-month of the first drawdown; the first full month costs 686.75", () => {
      const result = calculateCreditCosts(loan, draws, [], "2026-11-13")!;
      expect(month(result, "2026-10").plannedInterest).toBe(0);
      expect(month(result, "2026-10").actualInterest).toBe(0);
      expect(month(result, "2026-11").plannedInterest).toBeCloseTo(686.75, 2);
      expect(month(result, "2026-11").plannedPayment).toBeCloseTo(686.75, 2);
    });

    it("lets a drawdown mid-month start costing interest in the following month", () => {
      const result = calculateCreditCosts(
        loan,
        [...draws, { amount: 10000, date: "2026-12-10", actual: false }],
        [],
        "2026-11-13",
      )!;
      expect(month(result, "2026-12").plannedInterest).toBeCloseTo(686.75, 2);
      expect(month(result, "2027-01").plannedInterest).toBeCloseTo((211000 * 4.1) / 1200, 2);
    });

    it("pays the installment from the first installment date and reports the repayment part", () => {
      const result = calculateCreditCosts(late, draws, [], "2026-11-13");
      const march = month(result, "2028-03");
      expect(march.plannedPayment).toBeCloseTo(1759.88, 2);
      expect(march.plannedRepayment).toBeGreaterThan(1000);
      expect(march.plannedRepayment).toBeLessThan(1100);
      expect(march.plannedBalance).toBeLessThan(201000);
      expect(march.plannedCommitment).toBeCloseTo(320, 1);
      expect(result!.balanceAtRepaymentStart).toBeCloseTo(201000, 2);
    });

    it("stops commitment fees once the rest is assumed to be drawn", () => {
      const result = calculateCreditCosts(
        { ...loan, assumed_full_draw_date: "2027-06-15" },
        draws,
        [],
        "2026-11-13",
      );
      expect(month(result, "2028-03").plannedCommitment).toBe(0);
      expect(result!.balanceAtRepaymentStart).toBeCloseTo(361000, 2);
      expect(month(result, "2027-12").plannedInterest).toBeCloseTo((361000 * 4.1) / 1200, 2);
      // the assumption never changes what has actually been drawn
      expect(month(result, "2027-12").actualBalance).toBe(0);
      expect(result!.actualBalance).toBe(201000);
    });

    it("pays the full monthly interest in the month before the first installment", () => {
      const result = calculateCreditCosts(loan, draws, [], "2026-11-13")!;
      expect(month(result, "2028-01").plannedPayment).toBeCloseTo(686.75, 2);
      expect(month(result, "2028-02").plannedPayment).toBeCloseTo(1759.88, 2);
    });

    it("builds one timeline: actual before this month, forecast from this month on", () => {
      const result = calculateCreditCosts(loan, draws, [], "2026-11-13")!;
      const rows = creditTimeline(result, "2026-11-13", "2028-02-07");
      const row = (key: string) => rows.find((entry) => entry.month === key)!;
      expect(row("2026-10")).toMatchObject({ kind: "actual", repayment: null, draws: 201000 });
      expect(row("2026-11").kind).toBe("forecast");
      expect(row("2027-06")).toMatchObject({ payment: expect.closeTo(686.75, 2), repayment: 0 });
      expect(row("2028-02")).toMatchObject({
        repaymentStart: true,
        payment: expect.closeTo(1759.88, 2),
      });
      expect(row("2028-03").total).toBeCloseTo(1759.88, 2);
      expect(rows.filter((entry) => entry.repaymentStart)).toHaveLength(1);
    });

    it("assumes the rest is drawn when repayment starts if no date is given", () => {
      const result = calculateCreditCosts(loan, draws, [], "2026-11-13")!;
      const feb = month(result, "2028-02");
      const march = month(result, "2028-03");
      // no commitment fees, and the installment is the whole monthly burden (interest + repayment)
      expect(feb.plannedCommitment).toBe(0);
      expect(march.plannedCommitment).toBe(0);
      expect(feb.plannedPayment).toBeCloseTo(1759.88, 2);
      expect(march.plannedPayment).toBeCloseTo(1759.88, 2);
      expect(result!.balanceAtRepaymentStart).toBeCloseTo(361000, 2);
      // interest on the full loan is 1,232.58 per month, the rest of the installment repays principal
      expect(month(result, "2028-03").plannedInterest).toBeGreaterThan(1225);
      expect(month(result, "2028-03").plannedInterest).toBeLessThan((361000 * 4.1) / 1200);
      // standard annuity split from the first installment on: 1,759.88 - 361,000 x 4.1 % / 12
      expect(feb.plannedRepayment).toBeCloseTo(1759.88 - (361000 * 4.1) / 1200, 2);
      expect(march.plannedRepayment).toBeGreaterThan(526);
      expect(march.plannedRepayment).toBeLessThan(530);
    });

    it("ignores an assumed draw date in the past", () => {
      const result = calculateCreditCosts(
        { ...loan, assumed_full_draw_date: "2026-01-01" },
        draws,
        [],
        "2026-11-13",
      );
      expect(month(result, "2028-03").plannedCommitment).toBeCloseTo(320, 1);
    });
  });

  describe("with scheduled installments", () => {
    const contract = {
      ...terms,
      total_credit: 10000,
      annual_rate: 3.65,
      commitment_rate: 1,
      interest_free_start: null,
      interest_free_end: null,
      repayment_start: null,
      commitment_free_end: null,
      first_installment_date: "2026-03-01",
      commitment_start: "2026-03-01",
      monthly_installment: 500,
      repayment_count: 6,
      // the rest stays undrawn for the whole term
      assumed_full_draw_date: "2030-01-01",
    };
    const draws = [{ amount: 6000, date: "2026-01-01", actual: true }];

    it("does not charge commitment fees on principal that was already repaid", () => {
      const result = calculateCreditCosts(contract, draws, [], "2026-01-15")!;
      const fee = (month: string) =>
        result.months.find((row) => row.month === month)!.plannedCommitment;
      // 4,000 stays undrawn at 1 % per month; repaying the drawn 6,000 must not increase it.
      expect(fee("2026-03")).toBeCloseTo(40, 1);
      expect(fee("2026-06")).toBeCloseTo(40, 1);
    });

    it("lets the first installment repay principal even after a long drawdown phase", () => {
      const result = calculateCreditCosts(contract, draws, [], "2026-01-15")!;
      // Only the interest of the month before the first installment offsets it:
      // 6,000 * 3.65 % / 12 = 18.25, so 500 - 18.25 of principal is repaid on 2026-03-01.
      const march = result.months.find((row) => row.month === "2026-03")!;
      expect(march.plannedBalance).toBeCloseTo(6000 - (500 - 0.6 * 28), 0);
    });
  });
});

describe("loan form helpers", () => {
  it("derives the bank installment and number of installments from the contract data", () => {
    expect(suggestedInstallment(361000, 4.1, 1.75)).toBe(1759.88);
    expect(installmentCount(361000, 4.1, 1759.88)).toBe(354);
    expect(installmentCount(12000, 0, 1000)).toBe(12);
  });

  it("rejects data that cannot produce a schedule", () => {
    expect(suggestedInstallment(0, 4.1, 1.75)).toBeNull();
    expect(suggestedInstallment(1000, 0, 0)).toBeNull();
    expect(installmentCount(361000, 4.1, 1000)).toBeNull();
    expect(installmentCount(361000, 4.1, 0)).toBeNull();
  });
});
