import { isBankPot } from "./calc";
import type { Expense, ExpenseStatus, Offer, Workspace } from "./schema";

/** Prefix legacy IDs to avoid collisions between the formerly separate tables. */
export function legacyInvoiceExpense(invoice: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `invoice-${String(invoice["id"])}`,
    created_at: invoice["created_at"],
    project_id: invoice["project_id"] ?? null,
    title: invoice["title"] || invoice["contractor"] || "",
    vendor: invoice["contractor"] ?? null,
    contact_id: invoice["contact_id"] ?? null,
    offer_id: null,
    amount: invoice["amount"],
    expense_date: invoice["invoice_date"] ?? null,
    due_date: invoice["due_date"] ?? null,
    payment_date: invoice["payment_date"] ?? null,
    category: "Handwerker",
    trade_id: invoice["trade_id"] ?? null,
    cost_item_id: invoice["cost_item_id"] ?? null,
    document_id: invoice["document_id"] ?? null,
    status: invoice["paid"] ? "bezahlt" : "offen",
    budget_pot_id: invoice["budget_pot_id"] ?? null,
    notes: null,
  };
}

export function expenseOfferDefaults(offer: Offer): Record<string, unknown> {
  return {
    contact_id: offer.contact_id,
    vendor: offer.contractor,
    trade_id: offer.trade_id,
    cost_item_id: offer.cost_item_id,
  };
}

export function expenseLinkDefaults(
  field: string,
  value: unknown,
  ws: Workspace,
): Record<string, unknown> {
  if (field === "offer_id") {
    const offer = ws.offers.find((item) => item.id === value);
    return offer ? expenseOfferDefaults(offer) : {};
  }
  if (field === "contact_id") {
    const contact = ws.contacts.find((item) => item.id === value);
    return contact ? { vendor: contact.company || contact.name } : {};
  }
  return {};
}

/** Keep monetary/date fields independent: a partial invoice need not equal its offer. */
export function normalizeExpense(values: Record<string, unknown>, ws: Workspace) {
  const result = { ...values };
  const offerId = values["offer_id"];
  const offer =
    typeof offerId === "string" ? ws.offers.find((item) => item.id === offerId) : undefined;
  if (offer) {
    for (const [key, value] of Object.entries(expenseOfferDefaults(offer)))
      if (result[key] === undefined) result[key] = value;
  }
  const contact = ws.contacts.find((item) => item.id === result["contact_id"]);
  if (contact && !result["vendor"]) result["vendor"] = contact.company || contact.name;
  return result;
}

export function expenseIsOverdue(expense: Pick<Expense, "status" | "due_date">, today: string) {
  return expense.status === "offen" && !!expense.due_date && expense.due_date < today;
}

type SourceFields = { status?: unknown; budget_pot_id?: unknown };

/**
 * Splits a partial amount off an expense (e.g. only part of a hardware-store purchase is
 * reimbursed). The original keeps the remainder, status and source; the new part gets its own
 * status and, when reimbursed, moves to the bank source. Totals stay unchanged.
 * Returns null unless 0 < partAmount < expense amount.
 */
export function splitExpense(
  expense: Expense,
  partAmount: number,
  status: ExpenseStatus,
  title: string,
  ws: Pick<Workspace, "budget_pots">,
) {
  const partCents = Math.round(partAmount * 100);
  const totalCents = Math.round(Number(expense.amount) * 100);
  if (!Number.isFinite(partCents) || partCents <= 0 || partCents >= totalCents) return null;
  const { id: _id, created_at: _createdAt, ...rest } = expense;
  const source =
    reimbursementSource(
      { status, budget_pot_id: expense.budget_pot_id },
      { status: expense.status, budget_pot_id: expense.budget_pot_id },
      ws,
    ) ??
    expense.budget_pot_id ??
    null;
  return {
    remainder: (totalCents - partCents) / 100,
    part: { ...rest, title, amount: partCents / 100, status, budget_pot_id: source },
  };
}

/**
 * Expenses are usually paid from another source first and then submitted to the bank.
 * Only once they are reimbursed do they move to the bank source; "submitted" and
 * "rejected" keep the source they were paid from. Returns the bank source id to move
 * to, or null to keep the current one (also when the user picked a source explicitly).
 */
export function reimbursementSource(
  values: SourceFields,
  initial: SourceFields | undefined,
  ws: Pick<Workspace, "budget_pots">,
) {
  if (values.status !== "erstattet" || initial?.status === "erstattet") return null;
  const current = values.budget_pot_id || null;
  if (current !== (initial?.budget_pot_id || null)) return null;
  const bank = (ws.budget_pots ?? []).find(isBankPot);
  return bank && bank.id !== current ? bank.id : null;
}
