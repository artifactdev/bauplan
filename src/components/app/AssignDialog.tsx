import { tr } from "@/i18n";
import { useEffect, useMemo, useState } from "react";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { analyzeDocument, type Extraction } from "@/lib/ocr.functions";
import { logOcrResult, ocrText } from "@/lib/ocr-ui";
import { costItemOptions, potOptions, tradeOptions } from "@/lib/options";
import { EXPENSE_CATEGORIES } from "@/lib/schema";
import { EntityDialog, type Field } from "./EntityDialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Target = "ausgabe" | "rechnung" | "angebot" | "ablegen";

const TARGETS: { value: Target; label: string; hint: string }[] = [
  { value: "ausgabe", label: tr("assign_dialog.expense"), hint: tr("assign_dialog.receipt_general_invoice_deducted") },
  { value: "rechnung", label: tr("assign_dialog.contractor_invoice"), hint: tr("assign_dialog.invoice_order_cost_item") },
  { value: "angebot", label: tr("shared.quote"), hint: tr("assign_dialog.estimate_comparison") },
  { value: "ablegen", label: tr("assign_dialog.just_file"), hint: tr("assign_dialog.plan_contract_photo_data") },
];

const CATEGORY_FOR: Record<string, string> = {
  angebot: "Angebot", rechnung: "Rechnung", kassenzettel: "Beleg", vertrag: "Vertrag", plan: "Plan", datenblatt: "Datenblatt", foto: "Foto", sonstiges: "Sonstiges",
};

function targetFor(t: Extraction["doc_type"]): Target {
  if (t === "kassenzettel" || t === "rechnung") return "ausgabe";
  if (t === "angebot") return "angebot";
  return "ablegen";
}

/** Reads a document via local OCR, then lets the user confirm and file it as expense, invoice or offer. */
export function AssignDialog({
  documentId,
  onClose,
  fresh = false,
}: {
  documentId: string | null;
  onClose: () => void;
  /** The document was uploaded just for this step; cancelling asks whether to delete it. */
  fresh?: boolean;
}) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  const [loading, setLoading] = useState(false);
  const [ex, setEx] = useState<Extraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("ablegen");
  const doc = ws.documents.find((d) => d.id === documentId);
  const docName = doc?.name;
  const uploaded = useMemo(
    () => (fresh && documentId ? [{ id: documentId, name: docName ?? documentId }] : undefined),
    [fresh, documentId, docName],
  );

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    setLoading(true);
    setEx(null);
    setError(null);
    analyzeDocument({ data: { documentId } })
      .then((r) => {
        if (cancelled) return;
        logOcrResult(documentId, r);
        if (r.error) setError(ocrText(r.error));
        for (const warning of r.warnings) toast.warning(ocrText(warning));
        if (r.result) {
          setEx(r.result);
          setTarget(targetFor(r.result.doc_type));
        }
      })
      .catch(() => !cancelled && setError(tr("assign_dialog.document_not_read")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const initial = useMemo(() => {
    const trade = ws.trades.find((t) => t.name === ex?.trade);
    return {
      vendor: ex?.vendor ?? null,
      title: ex?.title ?? ex?.summary ?? doc?.name ?? null,
      amount: ex?.amount ?? null,
      date: ex?.date ?? null,
      payment_date: ex?.date ?? null,
      due_date: ex?.due_date ?? null,
      trade_id: trade?.id ?? doc?.trade_id ?? null,
      cost_item_id: doc?.cost_item_id ?? null,
      category: ex?.expense_category && EXPENSE_CATEGORIES.includes(ex.expense_category) ? ex.expense_category : "Sonstiges",
      status: "bezahlt",
      paid: false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex, documentId]);

  const common: Field[] = [
    { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
    { name: "cost_item_id", label: tr("shared.cost_item"), type: "select", options: costItemOptions(ws) },
  ];
  const fields: Field[] =
    target === "ablegen"
      ? [{ name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) }]
      : [
          { name: "vendor", label: target === "ausgabe" ? tr("shared.shop_company") : "Firma", required: target !== "ausgabe" },
          { name: "amount", label: tr("shared.gross_amount"), type: "number", required: true },
          { name: "title", label: tr("shared.description"), required: true, full: true },
          { name: "date", label: tr("shared.date"), type: "date" },
          ...(target !== "angebot" ? [{ name: "payment_date", label: tr("shared.payment_date_planned_actual"), type: "date" as const }] : []),
          ...(target === "rechnung" ? [{ name: "due_date", label: tr("shared.payable"), type: "date" as const }] : []),
          ...(target === "ausgabe"
            ? [
                { name: "category", label: tr("shared.category"), type: "select" as const, required: true, options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: tr(c) })) },
                { name: "status", label: tr("shared.status"), type: "select" as const, required: true, options: [{ value: "offen", label: tr("shared.open") }, { value: "bezahlt", label: tr("shared.paid") }, { value: "eingereicht", label: tr("shared.submitted") }, { value: "erstattet", label: tr("shared.reimbursed") }] },
              ]
            : []),
          ...common,
          ...(target !== "angebot" ? [{ name: "budget_pot_id", label: tr("shared.paid_2"), type: "select" as const, options: potOptions(ws) }] : []),
          ...(target === "rechnung" ? [{ name: "paid", label: tr("assign_dialog.already_paid"), type: "checkbox" as const }] : []),
        ];

  async function submit(raw: Record<string, unknown>) {
    const v = raw as { [k: string]: unknown; trade_id?: unknown; cost_item_id?: unknown; title?: unknown; vendor?: unknown; amount?: unknown; date?: unknown; due_date?: unknown; category?: unknown; status?: unknown; paid?: unknown };
    if (!documentId) return;
    const base = { trade_id: v.trade_id ?? null, cost_item_id: v.cost_item_id ?? null, document_id: documentId };
    if (target === "ausgabe")
      await create.mutateAsync({ table: "expenses", row: { ...base, title: v.title, vendor: v.vendor, amount: v.amount, expense_date: v.date, payment_date: v["payment_date"], category: v.category, status: v.status, budget_pot_id: v["budget_pot_id"] ?? null } });
    if (target === "rechnung")
      await create.mutateAsync({ table: "invoices", row: { ...base, contractor: v.vendor, title: v.title, amount: v.amount, invoice_date: v.date, due_date: v.due_date, payment_date: v["payment_date"], paid: !!v.paid, budget_pot_id: v["budget_pot_id"] ?? null } });
    if (target === "angebot")
      await create.mutateAsync({ table: "offers", row: { ...base, contractor: v.vendor, title: v.title, amount: v.amount, offer_date: v.date, status: "received" } });
    const category = target === "ausgabe" ? (ex?.doc_type === "rechnung" ? "Rechnung" : "Beleg") : target === "rechnung" ? "Rechnung" : target === "angebot" ? "Angebot" : CATEGORY_FOR[ex?.doc_type ?? "sonstiges"];
    await update.mutateAsync({
      table: "documents",
      id: documentId,
      patch: {
        category,
        trade_id: v.trade_id ?? doc?.trade_id ?? null,
        cost_item_id: v.cost_item_id ?? doc?.cost_item_id ?? null,
        ...(ex?.tags.length && !doc?.tags ? { tags: ex.tags.join(", ") } : {}),
        ...(ex?.summary && !doc?.description ? { description: ex.summary } : {}),
      },
    });
    toast.success(target === "ausgabe" ? tr("assign_dialog.expense_recorded_deducted_budget") : target === "ablegen" ? tr("assign_dialog.document_filed") : "Zugeordnet");
  }

  const header = (
    <div className="grid gap-3">
      <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", error ? "border-destructive/40 bg-destructive/5" : "bg-accent/40")}>
        {loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <ScanText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
        <span>
          {loading ? tr("assign_dialog.reading_content") : error ? `${error}. Du kannst die Angaben selbst eintragen.` : ex ? <>{tr("assign_dialog.recognized")} <b className="font-medium">{CATEGORY_FOR[ex.doc_type]}</b>{ex.summary ? ` – ${ex.summary}` : ""} Bitte prüfen.</> : null}
        </span>
      </div>
      <ToggleGroup
        type="single"
        value={target}
        onValueChange={(v) => v && setTarget(v as Target)}
        aria-label={tr("assign_dialog.file_as")}
        className="grid grid-cols-2 items-stretch gap-1 rounded-lg bg-muted p-1 sm:grid-cols-4"
      >
        {TARGETS.map((t) => (
          <ToggleGroupItem
            key={t.value}
            value={t.value}
            title={t.hint}
            className="h-auto min-h-9 min-w-0 whitespace-normal break-words px-2 py-1.5 text-center leading-tight text-muted-foreground hyphens-auto hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{TARGETS.find((t) => t.value === target)?.hint}</p>
    </div>
  );

  return (
    <EntityDialog
      open={!!documentId}
      onOpenChange={(o) => !o && onClose()}
      title={`Zuordnen: ${doc?.name ?? "Dokument"}`}
      header={header}
      fields={loading ? [] : fields}
      initial={initial}
      onSubmit={submit}
      uploaded={uploaded}
      submitLabel={target === "ablegen" ? "Ablegen" : tr("assign_dialog.apply")}
    />
  );
}
