import { tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { contactOptions, costItemOptions, docOptions, tradeOptions } from "@/lib/options";
import { EntityDialog, type Field } from "./EntityDialog";
import { OFFER_STATUS } from "./ui-bits";
import type { Workspace } from "@/lib/schema";

const offerFields = (ws: Workspace): Field[] => [
  { name: "contact_id", label: tr("quotes.contact"), type: "select", options: contactOptions(ws) },
  { name: "contractor", label: tr("quotes.company_no_contact") },
  { name: "title", label: tr("shared.service") },
  { name: "amount", label: tr("shared.gross_amount"), type: "number" },
  { name: "requested_date", label: tr("quotes.requested"), type: "date" },
  { name: "offer_date", label: tr("quotes.quote_date"), type: "date" },
  { name: "valid_until", label: tr("quotes.valid_until"), type: "date" },
  { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
  {
    name: "cost_item_id",
    label: tr("shared.cost_item"),
    type: "select",
    options: costItemOptions(ws),
  },
  {
    name: "status",
    label: tr("shared.status"),
    type: "select",
    required: true,
    options: Object.entries(OFFER_STATUS).map(([value, status]) => ({
      value,
      label: status.label,
    })),
  },
  {
    name: "document_id",
    label: tr("quotes.pdf_document"),
    type: "select",
    options: docOptions(ws),
  },
  { name: "notes", label: tr("shared.notes"), type: "textarea" },
];

export function OfferDialog({
  open,
  onOpenChange,
  editId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editId?: string | undefined;
  initial?: Record<string, unknown> | undefined;
}) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? tr("quotes.edit_quote") : tr("quotes.new_quote")}
      fields={offerFields(ws)}
      scan="offer"
      initial={initial}
      onSubmit={(values) => {
        const row = { ...values };
        const contact = ws.contacts.find((item) => item.id === row["contact_id"]);
        if (contact && !String(row["contractor"] ?? "").trim())
          row["contractor"] = contact.company ?? contact.name;
        if (!String(row["contractor"] ?? "").trim())
          throw new Error(tr("quotes.enter_contact_company"));
        if (row["amount"] === "" || row["amount"] == null) row["amount"] = 0;
        return editId
          ? update.mutateAsync({ table: "offers", id: editId, patch: row })
          : create.mutateAsync({ table: "offers", row });
      }}
    />
  );
}
