import { describe, expect, it } from "vitest";
import { bankFundedPayments, summarize } from "./calc";
import {
  expenseIsOverdue,
  expenseLinkDefaults,
  legacyInvoiceExpense,
  normalizeExpense,
  reimbursementSource,
  splitExpense,
} from "./expenses";
import type { Expense, Offer, Workspace } from "./schema";

const offer: Offer = {
  id: "offer",
  contractor: "Roofing",
  title: "Roof",
  amount: 4500,
  status: "accepted",
  contact_id: "contact",
  cost_item_id: "cost",
  trade_id: "trade",
  document_id: "quote-document",
  requested_date: null,
  offer_date: "2026-01-01",
  notes: null,
};
const expense: Expense = {
  id: "expense",
  title: "First installment",
  vendor: "Roofing",
  contact_id: "contact",
  offer_id: "offer",
  trade_id: "trade",
  cost_item_id: "cost",
  amount: 1000,
  status: "bezahlt",
  expense_date: "2026-01-01",
  due_date: "2026-01-15",
  payment_date: "2026-01-12",
  budget_pot_id: "bank",
  category: "Handwerker",
  document_id: "receipt",
  notes: null,
};
const workspace: Workspace = {
  projects: [
    {
      id: "project",
      name: "Home",
      total_budget: 10000,
      address: null,
      start_date: null,
      end_date: null,
    },
  ],
  cost_items: [{ id: "cost", trade_id: "trade", title: "Roof", planned: 4000, description: null }],
  contacts: [
    {
      id: "contact",
      name: "Roofer",
      company: "Roofing",
      trade_id: "trade",
      phone: null,
      email: null,
      address: null,
      website: null,
      notes: null,
    },
  ],
  offers: [offer],
  expenses: [expense],
  invoices: [],
  trades: [],
  documents: [],
  tasks: [],
  events: [],
  ideas: [],
  idea_images: [],
  budget_pots: [],
  funding_entries: [],
  credit_terms: [],
  credit_repayments: [],
};

describe("unified expenses", () => {
  it("converts an invoice without guessing an offer or losing accounting fields", () => {
    expect(
      legacyInvoiceExpense({
        id: "old",
        created_at: "2026-01-01",
        contractor: "Roofing",
        title: null,
        contact_id: "contact",
        amount: 1000,
        invoice_date: "2026-01-01",
        due_date: "2026-01-15",
        paid: false,
        budget_pot_id: "bank",
        document_id: "receipt",
        cost_item_id: "cost",
        trade_id: "trade",
      }),
    ).toEqual({
      ...expense,
      id: "invoice-old",
      created_at: "2026-01-01",
      title: "Roofing",
      offer_id: null,
      status: "offen",
      payment_date: null,
    });
  });

  it("prefills offer assignments, never the invoice amount, dates, title, or document", () => {
    expect(expenseLinkDefaults("offer_id", "offer", workspace)).toEqual({
      contact_id: "contact",
      vendor: "Roofing",
      trade_id: "trade",
      cost_item_id: "cost",
    });
    expect(expenseLinkDefaults("contact_id", "contact", workspace)).toEqual({ vendor: "Roofing" });
    expect(expenseLinkDefaults("offer_id", null, workspace)).toEqual({});
  });

  it("preserves explicit overrides and cleared links when normalizing", () => {
    expect(
      normalizeExpense(
        { offer_id: "offer", contact_id: null, vendor: "Other", cost_item_id: null, amount: 250 },
        workspace,
      ),
    ).toMatchObject({ contact_id: null, vendor: "Other", cost_item_id: null, amount: 250 });
  });

  it("counts partial invoices once and never adds them to the linked accepted offer", () => {
    const result = summarize({
      ...workspace,
      expenses: [expense, { ...expense, id: "second", amount: 2000, status: "offen" }],
    });
    expect(result.invoiced).toBe(3000);
    expect(result.paid).toBe(1000);
    expect(result.open).toBe(2000);
    expect(result.expected).toBe(4500);
    expect(result.remaining).toBe(5500);
    expect(summarize({ ...workspace, expenses: [{ ...expense, amount: 5000 }] }).expected).toBe(
      5000,
    );
  });

  it("uses the due date only for open expense forecasts, preserving migrated invoice timing", () => {
    expect(
      bankFundedPayments(
        [],
        [
          { ...expense, status: "offen", payment_date: null },
          { ...expense, id: "paid", payment_date: null },
          { ...expense, id: "planned", status: "offen", payment_date: "2026-01-20" },
        ],
        "bank",
      ),
    ).toEqual([
      { amount: 1000, date: "2026-01-15", actual: false },
      { amount: 1000, date: "2026-01-01", actual: true },
      { amount: 1000, date: "2026-01-20", actual: false },
    ]);
  });

  it("marks only open expenses with a past due date as overdue", () => {
    expect(expenseIsOverdue({ status: "offen", due_date: "2026-01-15" }, "2026-01-16")).toBe(true);
    expect(expenseIsOverdue({ status: "offen", due_date: "2026-01-16" }, "2026-01-16")).toBe(false);
    expect(expenseIsOverdue({ status: "offen", due_date: null }, "2026-01-16")).toBe(false);
    for (const status of ["bezahlt", "eingereicht", "erstattet", "abgelehnt"] as const)
      expect(expenseIsOverdue({ status, due_date: "2026-01-15" }, "2026-01-16")).toBe(false);
  });

  const pots = {
    budget_pots: [
      { id: "bank", name: "Bank", deducts_from_budget: false, notes: null },
      { id: "jerry", name: "Jerry", deducts_from_budget: false, notes: null },
    ],
  };

  it("moves an expense to the bank source only when it becomes reimbursed", () => {
    const paidByJerry = { status: "eingereicht", budget_pot_id: "jerry" };
    expect(
      reimbursementSource({ status: "erstattet", budget_pot_id: "jerry" }, paidByJerry, pots),
    ).toBe("bank");
    for (const status of ["eingereicht", "abgelehnt", "bezahlt"])
      expect(reimbursementSource({ status, budget_pot_id: "jerry" }, paidByJerry, pots)).toBeNull();
    // an explicitly chosen source, an already reimbursed expense or no bank source keep the source
    expect(
      reimbursementSource({ status: "erstattet", budget_pot_id: "bank" }, paidByJerry, pots),
    ).toBeNull();
    expect(
      reimbursementSource(
        { status: "erstattet", budget_pot_id: "jerry" },
        { status: "erstattet", budget_pot_id: "jerry" },
        pots,
      ),
    ).toBeNull();
    expect(
      reimbursementSource({ status: "erstattet", budget_pot_id: "jerry" }, paidByJerry, {
        budget_pots: [pots.budget_pots[1]!],
      }),
    ).toBeNull();
  });

  it("keeps submitted and rejected expenses off the bank until they are reimbursed", () => {
    const withStatus = (status: Expense["status"], potId: string): Expense => ({
      ...expense,
      status,
      budget_pot_id: potId,
    });
    expect(bankFundedPayments([], [withStatus("abgelehnt", "jerry")], "bank")).toEqual([]);
    expect(bankFundedPayments([], [withStatus("eingereicht", "jerry")], "bank")).toEqual([]);
    expect(bankFundedPayments([], [withStatus("erstattet", "bank")], "bank")).toHaveLength(1);
    const s = summarize({
      ...workspace,
      expenses: [withStatus("abgelehnt", "jerry")],
      ...pots,
    });
    expect(s.pots.find((pot) => pot.id === "jerry")?.paid).toBe(1000);
    expect(s.pots.find((pot) => pot.id === "bank")?.spent).toBe(0);
  });

  it("splits a partially reimbursed expense without changing the total", () => {
    const eingereicht: Expense = { ...expense, amount: 300.1, budget_pot_id: "jerry" };
    const split = splitExpense(eingereicht, 120.05, "erstattet", "Part", pots)!;
    expect(split.remainder).toBe(180.05);
    expect(split.part).toMatchObject({
      title: "Part",
      amount: 120.05,
      status: "erstattet",
      budget_pot_id: "bank",
      cost_item_id: eingereicht.cost_item_id,
      document_id: eingereicht.document_id,
    });
    expect(split.part).not.toHaveProperty("id");

    const submitted = splitExpense(eingereicht, 50, "eingereicht", "Part", pots)!;
    expect(submitted.part).toMatchObject({ budget_pot_id: "jerry" });

    for (const amount of [0, -5, 300.1, 400, Number.NaN])
      expect(splitExpense(eingereicht, amount, "erstattet", "Part", pots)).toBeNull();

    const s = summarize({
      ...workspace,
      expenses: [
        { ...eingereicht, amount: split.remainder },
        { ...(split.part as Expense), id: "p" },
      ],
      ...pots,
    });
    expect(s.pots.find((pot) => pot.id === "jerry")?.spent).toBe(180.05);
    expect(s.pots.find((pot) => pot.id === "bank")?.spent).toBe(120.05);
  });
});
