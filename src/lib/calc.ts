import type { BudgetPot, Expense, Invoice, Workspace } from "./schema";
import { todayISO } from "./format";

export type ItemSummary = {
  id: string;
  title: string;
  trade_id: string | null;
  planned: number;
  committed: number; // accepted offers
  invoiced: number; // all invoices
  paid: number; // paid invoices
  expected: number; // best estimate of final cost, no double counting
};

/**
 * Expected cost per item = the most concrete figure known:
 * invoices if they exceed the accepted offer, otherwise the accepted offer,
 * otherwise the planned amount. Offers and invoices for the same item are
 * never added together.
 */
export function expectedCost(planned: number, committed: number, invoiced: number) {
  if (invoiced > 0 || committed > 0) return Math.max(committed, invoiced);
  return planned;
}

/** Expenses (receipts, general bills) always count as spent money. Only status "offen" is unpaid. */
const expPaid = (e: Expense) => e.status !== "offen";

export type PotSummary = BudgetPot & { spent: number; paid: number };

/** Totals per payment source (expenses + invoices). */
export function summarizePots(pots: BudgetPot[], expenses: Expense[], invoices: Invoice[]): PotSummary[] {
  return pots.map((p) => {
    const ex = expenses.filter((e) => e.budget_pot_id === p.id);
    const inv = invoices.filter((i) => i.budget_pot_id === p.id);
    const spent = ex.reduce((s, e) => s + Number(e.amount), 0) + inv.reduce((s, i) => s + Number(i.amount), 0);
    const paid = ex.filter(expPaid).reduce((s, e) => s + Number(e.amount), 0) + inv.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount), 0);
    return { ...p, spent, paid };
  });
}

/** True when an item counts against the total budget: no source, or a source flagged deducts_from_budget. */
export function countsTowardBudget(potId: string | null | undefined, pots: BudgetPot[]) {
  if (!potId) return true;
  const p = pots.find((x) => x.id === potId);
  return !p || p.deducts_from_budget;
}

export function summarize(wsIn: Pick<Workspace, "cost_items" | "offers" | "invoices" | "trades" | "projects"> & { expenses?: Expense[]; budget_pots?: BudgetPot[] }) {
  // Only money from sources that deduct from the total budget counts below.
  const potList = wsIn.budget_pots ?? [];
  const ws = { ...wsIn, invoices: wsIn.invoices.filter((i) => countsTowardBudget(i.budget_pot_id, potList)) };
  const allExpenses = wsIn.expenses ?? [];
  const expenses = allExpenses.filter((e) => countsTowardBudget(e.budget_pot_id, potList));
  const pots = summarizePots(potList, allExpenses, wsIn.invoices);
  const items: ItemSummary[] = ws.cost_items.map((c) => {
    const committed = ws.offers.filter((o) => o.cost_item_id === c.id && o.status === "accepted").reduce((s, o) => s + Number(o.amount), 0);
    const inv = ws.invoices.filter((i) => i.cost_item_id === c.id);
    const ex = expenses.filter((e) => e.cost_item_id === c.id);
    const invoiced = inv.reduce((s, i) => s + Number(i.amount), 0) + ex.reduce((s, e) => s + Number(e.amount), 0);
    const paid = inv.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount), 0) + ex.filter(expPaid).reduce((s, e) => s + Number(e.amount), 0);
    const planned = Number(c.planned);
    return { id: c.id, title: c.title, trade_id: c.trade_id, planned, committed, invoiced, paid, expected: expectedCost(planned, committed, invoiced) };
  });
  // Unlinked offers/invoices still count, attributed to their trade.
  const looseCommitted = ws.offers.filter((o) => !o.cost_item_id && o.status === "accepted");
  const looseInvoices = ws.invoices.filter((i) => !i.cost_item_id);
  const looseExp = expenses.filter((e) => !e.cost_item_id);
  const looseE = looseExp.reduce((s, e) => s + Number(e.amount), 0);
  const looseEP = looseExp.filter(expPaid).reduce((s, e) => s + Number(e.amount), 0);
  const sum = (k: keyof ItemSummary) => items.reduce((s, i) => s + (i[k] as number), 0);
  const looseC = looseCommitted.reduce((s, o) => s + Number(o.amount), 0);
  const looseI = looseInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const looseP = looseInvoices.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount), 0);

  const budget = Number(ws.projects[0]?.total_budget ?? 0);
  const planned = sum("planned");
  const committed = sum("committed") + looseC;
  const invoiced = sum("invoiced") + looseI + looseE;
  const paid = sum("paid") + looseP + looseEP;
  const expected = sum("expected") + Math.max(looseC, looseI) + looseE;
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const reimbursed = expenses.filter((e) => e.status === "erstattet").reduce((s, e) => s + Number(e.amount), 0);

  const trades = ws.trades.map((t) => {
    const ti = items.filter((i) => i.trade_id === t.id);
    const lc = looseCommitted.filter((o) => o.trade_id === t.id).reduce((s, o) => s + Number(o.amount), 0);
    const li = looseInvoices.filter((i) => i.trade_id === t.id).reduce((s, i) => s + Number(i.amount), 0);
    const te = looseExp.filter((e) => e.trade_id === t.id);
    const le = te.reduce((s, e) => s + Number(e.amount), 0);
    const exp = ti.reduce((s, i) => s + i.expected, 0) + Math.max(lc, li) + le;
    return {
      ...t,
      planned: ti.reduce((s, i) => s + i.planned, 0),
      committed: ti.reduce((s, i) => s + i.committed, 0) + lc,
      paid: ti.reduce((s, i) => s + i.paid, 0) + te.filter(expPaid).reduce((s, e) => s + Number(e.amount), 0),
      expected: exp,
      deviation: exp - Number(t.budget),
    };
  });

  return { items, trades, budget, planned, committed, invoiced, paid, open: invoiced - paid, expected, remaining: budget - expected, expensesTotal, reimbursed, pots };
}

export function isOverdue(due: string | null, done: boolean, today = todayISO()) {
  return !!due && !done && due < today;
}
