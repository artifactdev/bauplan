import { tr } from "@/i18n";
import { useEffect, useState } from "react";
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
import {
  expenseDocumentLinks,
  expenseLinkDefaults,
  expenseTransition,
  normalizeExpense,
  type ExpenseDocumentLink,
} from "@/lib/expenses";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [links, setLinks] = useState<ExpenseDocumentLink[]>([]);
  const [document, setDocument] = useState("");
  const [role, setRole] = useState<ExpenseDocumentLink["role"]>("invoice");
  useEffect(() => {
    if (!open) return;
    setLinks(expenseDocumentLinks(initial?.["document_links"]));
    setDocument("");
    setRole("invoice");
    // Keep an open draft intact when workspace data refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId]);
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
          label: tr("expenses.payment_status"),
          type: "select",
          required: true,
          options: [
            { value: "offen", label: tr("shared.open") },
            { value: "bezahlt", label: tr("shared.paid") },
          ],
        },
        {
          name: "bank_status",
          label: tr("expenses.bank_status"),
          type: "select",
          required: true,
          options: [
            { value: "nicht_festgelegt", label: tr("expenses.bank_unset") },
            { value: "einzureichen", label: tr("expenses.bank_ready") },
            { value: "eingereicht", label: tr("expenses.bank_submitted") },
            { value: "ausgezahlt", label: tr("expenses.bank_paid_out") },
            { value: "abgelehnt", label: tr("expenses.bank_rejected") },
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
      initial={{ bank_status: "einzureichen", ...initial }}
      extra={
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{tr("expenses.additional_documents")}</div>
          {links.map((link) => (
            <div className="flex items-center gap-2" key={link.document_id}>
              <span className="min-w-0 flex-1 truncate">
                {ws.documents.find((item) => item.id === link.document_id)?.name ??
                  link.document_id}
                {" — "}
                {tr(`expenses.document_${link.role}`)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLinks((current) =>
                    current.filter((item) => item.document_id !== link.document_id),
                  )
                }
              >
                {tr("expenses.remove_document_link")}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Select value={document} onValueChange={setDocument}>
              <SelectTrigger
                className="min-w-40 flex-1"
                aria-label={tr("expenses.select_document")}
              >
                <SelectValue placeholder={tr("expenses.select_document")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ws.documents
                    .filter((item) => !links.some((link) => link.document_id === item.id))
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as ExpenseDocumentLink["role"])}
            >
              <SelectTrigger className="w-44" aria-label={tr("expenses.document_role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(["invoice", "payment", "other"] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {tr(`expenses.document_${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!document}
              onClick={() => {
                setLinks((current) => [...current, { document_id: document, role }]);
                setDocument("");
              }}
            >
              {tr("expenses.add_document_link")}
            </Button>
          </div>
        </div>
      }
      onSubmit={(values) => {
        if (links.some((link) => link.document_id === values["document_id"]))
          throw new Error("expenses.invalid_documents");
        const previous = editId ? ws.expenses.find((expense) => expense.id === editId) : undefined;
        const row = normalizeExpense(
          expenseTransition(
            { ...values, document_links: links.length ? JSON.stringify(links) : null },
            previous,
            ws.budget_pots,
          ),
          ws,
        );
        return editId
          ? update.mutateAsync({ table: "expenses", id: editId, patch: row })
          : create.mutateAsync({ table: "expenses", row });
      }}
    />
  );
}
