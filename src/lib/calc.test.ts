import { describe, expect, it } from "vitest";
import { expectedCost, isOverdue, summarize } from "./calc";

const base = { trades: [], projects: [{ id: "p", name: "x", address: null, total_budget: 10000, start_date: null, end_date: null }] };

describe("budget calculation", () => {
  it("uses planned amount when nothing is committed or invoiced", () => {
    expect(expectedCost(5000, 0, 0)).toBe(5000);
  });

  it("does not add accepted offer and invoice for the same item", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Bad", description: null, planned: 4000 }],
      offers: [{ id: "o", trade_id: null, cost_item_id: "c", document_id: null, contact_id: null, requested_date: null, contractor: "A", title: null, amount: 4500, offer_date: null, status: "accepted", notes: null }],
      invoices: [{ id: "i", trade_id: null, cost_item_id: "c", document_id: null, contact_id: null, contractor: "A", title: null, amount: 4500, invoice_date: null, due_date: null, paid: true }],
    });
    expect(s.expected).toBe(4500);
    expect(s.remaining).toBe(5500);
    expect(s.paid).toBe(4500);
  });

  it("ignores rejected offers", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Bad", description: null, planned: 4000 }],
      offers: [{ id: "o", trade_id: null, cost_item_id: "c", document_id: null, contact_id: null, requested_date: null, contractor: "A", title: null, amount: 9000, offer_date: null, status: "rejected", notes: null }],
      invoices: [],
    });
    expect(s.expected).toBe(4000);
    expect(s.committed).toBe(0);
  });

  it("does not count requested offers as committed", () => {
    const s = summarize({
      ...base,
      cost_items: [{ id: "c", trade_id: null, title: "Bad", description: null, planned: 4000 }],
      offers: [{ id: "o", trade_id: null, cost_item_id: "c", document_id: null, contact_id: null, requested_date: "2026-10-01", contractor: "A", title: null, amount: 0, offer_date: null, status: "requested", notes: null }],
      invoices: [],
    });
    expect(s.committed).toBe(0);
    expect(s.expected).toBe(4000);
  });
});

describe("expenses", () => {
  const exp = (amount: number, status: "offen" | "bezahlt" | "eingereicht" | "erstattet") => ({ id: String(Math.random()), title: "Baumarkt", vendor: null, amount, expense_date: null, category: null, trade_id: null, cost_item_id: null, document_id: null, status, notes: null });
  it("deducts receipts from the remaining budget", () => {
    const s = summarize({ ...base, cost_items: [], offers: [], invoices: [], expenses: [exp(120, "bezahlt"), exp(80, "offen")] });
    expect(s.expected).toBe(200);
    expect(s.remaining).toBe(9800);
    expect(s.paid).toBe(120);
  });
  it("reimbursed expenses still count as spent", () => {
    const s = summarize({ ...base, cost_items: [], offers: [], invoices: [], expenses: [exp(50, "erstattet")] });
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
  const base = { cost_items: [], offers: [], trades: [], projects: [{ id: "p", name: "P", address: null, total_budget: 1000, start_date: null, end_date: null }] };
  const pots = [{ id: "bank", name: "Bank", deducts_from_budget: true, notes: null }, { id: "priv", name: "Privat", deducts_from_budget: false, notes: null }];
  const exp = (amount: number, budget_pot_id: string | null) => ({ id: String(amount), title: "x", vendor: null, amount, expense_date: null, category: "Werkzeug", trade_id: null, cost_item_id: null, document_id: null, status: "bezahlt" as const, notes: null, budget_pot_id });

  it("Privat expenses are not deducted from the total budget, Bank and unassigned ones are", () => {
    const s = summarize({ ...base, invoices: [], expenses: [exp(100, "priv"), exp(50, "bank"), exp(20, null)], budget_pots: pots });
    expect(s.expected).toBe(70);
    expect(s.remaining).toBe(930);
    expect(s.pots.find((p) => p.id === "priv")!.spent).toBe(100);
  });

  it("a paid invoice from Privat does not count as paid from the budget", () => {
    const inv = { id: "i", trade_id: null, cost_item_id: null, document_id: null, contact_id: null, contractor: "A", title: null, amount: 200, invoice_date: null, due_date: null, paid: true, budget_pot_id: "priv" };
    const s = summarize({ ...base, invoices: [inv], expenses: [], budget_pots: pots });
    expect(s.paid).toBe(0);
    expect(s.pots.find((p) => p.id === "priv")!.paid).toBe(200);
  });
});
