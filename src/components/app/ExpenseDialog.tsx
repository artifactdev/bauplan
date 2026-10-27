import { tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import {
  contactOptions,
  costItemOptions,
  docOptions,
  offerOptions,
  potOptions,
  tradeOptions,
} from "@/lib/options";
import { EXPENSE_CATEGORIES } from "@/lib/schema";
import { expenseLinkDefaults, normalizeExpense } from "@/lib/expenses";
import { EntityDialog } from "./EntityDialog";

export function ExpenseDialog({
  open,
  onOpenChange,
  editId,
  initial,
  initialFile,
  onSaved,
  preserveStatus = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editId?: string | undefined;
  initial?: Record<string, unknown> | undefined;
  initialFile?: File | undefined;
  onSaved?: (() => void) | undefined;
  preserveStatus?: boolean;
}) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? tr("expenses.edit_expense") : tr("expenses.new_expense")}
      scan="expense"
      initialFile={initialFile}
      onSaved={onSaved}
      preserveOnScan={editId || preserveStatus ? ["status"] : []}
      onFieldChange={(field, value) => expenseLinkDefaults(field, value, ws)}
      fields={[
        {
          name: "offer_id",
          label: tr("expenses.linked_offer"),
          type: "select",
          options: offerOptions(ws),
        },
        {
          name: "contact_id",
          label: tr("quotes.contact"),
          type: "select",
          options: contactOptions(ws),
        },
        { name: "title", label: tr("shared.description"), required: true, full: true },
        { name: "vendor", label: tr("shared.shop_company") },
        { name: "amount", label: tr("shared.gross_amount"), type: "number", required: true },
        { name: "expense_date", label: tr("shared.date"), type: "date" },
        { name: "due_date", label: tr("shared.payable"), type: "date" },
        { name: "payment_date", label: tr("shared.payment_date_planned_actual"), type: "date" },
        {
          name: "category",
          label: tr("shared.category"),
          type: "select",
          options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: tr(c) })),
        },
        {
          name: "status",
          label: tr("shared.status"),
          type: "select",
          required: true,
          options: [
            { value: "offen", label: tr("shared.open") },
            { value: "bezahlt", label: tr("shared.paid") },
            { value: "eingereicht", label: tr("shared.submitted") },
            { value: "erstattet", label: tr("shared.reimbursed") },
          ],
        },
        {
          name: "trade_id",
          label: tr("shared.trade"),
          type: "select",
          options: tradeOptions(ws),
        },
        {
          name: "cost_item_id",
          label: tr("shared.cost_item"),
          type: "select",
          options: costItemOptions(ws),
        },
        {
          name: "budget_pot_id",
          label: tr("shared.paid_2"),
          type: "select",
          options: potOptions(ws),
        },
        {
          name: "document_id",
          label: tr("shared.receipt"),
          type: "select",
          options: docOptions(ws),
        },
        { name: "notes", label: tr("shared.notes"), type: "textarea" },
      ]}
      initial={initial}
      onSubmit={(values) =>
        editId
          ? update.mutateAsync({
              table: "expenses",
              id: editId,
              patch: normalizeExpense(values, ws),
            })
          : create.mutateAsync({ table: "expenses", row: normalizeExpense(values, ws) })
      }
    />
  );
}
