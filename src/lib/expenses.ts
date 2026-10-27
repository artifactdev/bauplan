import type { Expense, Offer, Workspace } from "./schema";

/** Prefix legacy IDs to avoid collisions between the formerly separate tables. */
export function legacyInvoiceExpense(invoice: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `invoice-${String(invoice["id"])}`,
    created_at: invoice["created_at"],
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
