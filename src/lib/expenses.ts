import { isBankPot } from "./calc";
import { z } from "zod";
import type {
  BankSubmissionStatus,
  BudgetPot,
  Expense,
  ExpenseStatus,
  Offer,
  Workspace,
} from "./schema";

const expenseDocumentLinksSchema = z
  .array(
    z.object({
      document_id: z.string().min(1),
      role: z.enum(["invoice", "payment", "other"]),
    }),
  )
  .max(100)
  .superRefine((links, context) => {
    if (new Set(links.map((link) => link.document_id)).size !== links.length)
      context.addIssue({ code: "custom", message: "Duplicate expense document" });
  });

export type ExpenseDocumentLink = z.infer<typeof expenseDocumentLinksSchema>[number];

export function expenseDocumentLinks(value: unknown): ExpenseDocumentLink[] {
  if (value == null || value === "") return [];
  if (typeof value !== "string") throw new Error("expenses.invalid_documents");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("expenses.invalid_documents");
  }
  const result = expenseDocumentLinksSchema.safeParse(parsed);
  if (!result.success) throw new Error("expenses.invalid_documents");
  return result.data;
}

export function expenseDocuments(expense: Pick<Expense, "document_id" | "document_links">) {
  const extra = expenseDocumentLinks(expense.document_links);
  if (expense.document_id && extra.some((link) => link.document_id === expense.document_id))
    throw new Error("expenses.invalid_documents");
  return [
    ...(expense.document_id
      ? [{ document_id: expense.document_id, role: "invoice" as const }]
      : []),
    ...extra,
  ];
}

/** Preserve the old accounting interpretation when separating payment and bank status. */
export function migrateExpenseStatus(status: ExpenseStatus): {
  status: "offen" | "bezahlt";
  bank_status: BankSubmissionStatus;
} {
  switch (status) {
    case "offen":
      return { status: "offen", bank_status: "einzureichen" };
    case "bezahlt":
      return { status: "bezahlt", bank_status: "einzureichen" };
    case "eingereicht":
      return { status: "bezahlt", bank_status: "eingereicht" };
    case "erstattet":
      return { status: "bezahlt", bank_status: "ausgezahlt" };
    case "abgelehnt":
      return { status: "bezahlt", bank_status: "abgelehnt" };
    default:
      throw new Error("expenses.invalid_payment_status");
  }
}

export function normalizeLegacyExpense(expense: Expense): Expense {
  return expense.bank_status ? expense : { ...expense, ...migrateExpenseStatus(expense.status) };
}

export function expenseTransition(
  changes: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  pots: BudgetPot[],
  preserveLegacySource = false,
) {
  const patch = { ...changes };
  const bankStatus = patch["bank_status"] ?? previous?.["bank_status"] ?? "einzureichen";
  if (
    bankStatus !== "nicht_festgelegt" &&
    bankStatus !== "einzureichen" &&
    bankStatus !== "eingereicht" &&
    bankStatus !== "ausgezahlt" &&
    bankStatus !== "abgelehnt"
  )
    throw new Error("expenses.invalid_bank_status");
  if (!previous || "bank_status" in patch) patch["bank_status"] = bankStatus;
  const paymentStatus = patch["status"] ?? previous?.["status"];
  if (paymentStatus !== "offen" && paymentStatus !== "bezahlt")
    throw new Error("expenses.invalid_payment_status");
  if (!preserveLegacySource && bankStatus !== previous?.["bank_status"]) {
    if (bankStatus === "ausgezahlt") {
      const bank = pots.find(isBankPot);
      if (!bank) throw new Error("expenses.bank_source_required");
      patch["status"] = "bezahlt";
      patch["budget_pot_id"] = bank.id;
    } else if (bankStatus === "abgelehnt") {
      const sourceId = patch["budget_pot_id"] ?? previous?.["budget_pot_id"];
      const source = pots.find((pot) => pot.id === sourceId);
      if (!source || isBankPot(source)) throw new Error("expenses.private_source_required");
    }
  }
  return patch;
}

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

/**
 * Splits a partial amount off an expense (e.g. only part of a hardware-store purchase is
 * reimbursed). The original keeps the remainder, status and source; the new part gets its own
 * status and, when reimbursed, moves to the bank source. Totals stay unchanged.
 * Returns null unless 0 < partAmount < expense amount.
 */
export function splitExpense(
  expense: Expense,
  partAmount: number,
  status: BankSubmissionStatus,
  title: string,
  ws: Pick<Workspace, "budget_pots">,
  sourceId: string | null = expense.budget_pot_id ?? null,
) {
  const partCents = Math.round(partAmount * 100);
  const totalCents = Math.round(Number(expense.amount) * 100);
  if (!Number.isFinite(partCents) || partCents <= 0 || partCents >= totalCents) return null;
  const { id: _id, created_at: _createdAt, ...rest } = expense;
  const patch = expenseTransition(
    { bank_status: status, budget_pot_id: sourceId },
    expense,
    ws.budget_pots,
  );
  return {
    remainder: (totalCents - partCents) / 100,
    part: { ...rest, title, amount: partCents / 100, ...patch },
  };
}
