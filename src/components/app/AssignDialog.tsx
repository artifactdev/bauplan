import { tr } from "@/i18n";
import { useEffect, useMemo, useState } from "react";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { analyzeDocument, type Extraction } from "@/lib/ocr.functions";
import { ocrText } from "@/lib/ocr-ui";
import { costItemOptions, potOptions, tradeOptions } from "@/lib/options";
import { EXPENSE_CATEGORIES } from "@/lib/schema";
import { EntityDialog, type Field } from "./EntityDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Target = "ausgabe" | "rechnung" | "angebot" | "ablegen";

const TARGETS: { value: Target; label: string; hint: string }[] = [
  { value: "ausgabe", label: tr("Ausgabe"), hint: tr("Kassenzettel oder allgemeine Rechnung – wird vom Budget abgezogen") },
  { value: "rechnung", label: tr("Handwerkerrechnung"), hint: tr("Rechnung zu einem Auftrag / einer Kostenposition") },
  { value: "angebot", label: tr("Angebot"), hint: tr("Kostenvoranschlag zum Vergleichen") },
  { value: "ablegen", label: tr("Nur ablegen"), hint: tr("Plan, Vertrag, Foto, Datenblatt…") },
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
export function AssignDialog({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const { create, update } = useMutations();
  const [loading, setLoading] = useState(false);
  const [ex, setEx] = useState<Extraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("ablegen");
  const doc = ws.documents.find((d) => d.id === documentId);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    setLoading(true);
    setEx(null);
    setError(null);
    analyzeDocument({ data: { documentId } })
      .then((r) => {
        if (cancelled) return;
        if (r.error) setError(ocrText(r.error));
        for (const warning of r.warnings) toast.warning(ocrText(warning));
        if (r.result) {
          setEx(r.result);
          setTarget(targetFor(r.result.doc_type));
        }
      })
      .catch(() => !cancelled && setError(tr("Dokument konnte nicht ausgelesen werden")))
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
    { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
    { name: "cost_item_id", label: tr("Kostenposition"), type: "select", options: costItemOptions(ws) },
  ];
  const fields: Field[] =
    target === "ablegen"
      ? [{ name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) }]
      : [
          { name: "vendor", label: target === "ausgabe" ? tr("Geschäft / Firma") : "Firma", required: target !== "ausgabe" },
          { name: "amount", label: tr("Betrag brutto (€)"), type: "number", required: true },
          { name: "title", label: tr("Beschreibung"), required: true, full: true },
          { name: "date", label: tr("Datum"), type: "date" },
          ...(target === "rechnung" ? [{ name: "due_date", label: tr("Zahlbar bis"), type: "date" as const }] : []),
          ...(target === "ausgabe"
            ? [
                { name: "category", label: tr("Kategorie"), type: "select" as const, required: true, options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: tr(c) })) },
                { name: "status", label: tr("Status"), type: "select" as const, required: true, options: [{ value: "offen", label: tr("Offen") }, { value: "bezahlt", label: tr("Bezahlt") }, { value: "eingereicht", label: tr("Eingereicht") }, { value: "erstattet", label: tr("Erstattet") }] },
              ]
            : []),
          ...common,
          ...(target !== "angebot" ? [{ name: "budget_pot_id", label: tr("Bezahlt aus"), type: "select" as const, options: potOptions(ws) }] : []),
          ...(target === "rechnung" ? [{ name: "paid", label: tr("Bereits bezahlt"), type: "checkbox" as const }] : []),
        ];

  async function submit(raw: Record<string, unknown>) {
    const v = raw as { [k: string]: unknown; trade_id?: unknown; cost_item_id?: unknown; title?: unknown; vendor?: unknown; amount?: unknown; date?: unknown; due_date?: unknown; category?: unknown; status?: unknown; paid?: unknown };
    if (!documentId) return;
    const base = { trade_id: v.trade_id ?? null, cost_item_id: v.cost_item_id ?? null, document_id: documentId };
    if (target === "ausgabe")
      await create.mutateAsync({ table: "expenses", row: { ...base, title: v.title, vendor: v.vendor, amount: v.amount, expense_date: v.date, category: v.category, status: v.status, budget_pot_id: v["budget_pot_id"] ?? null } });
    if (target === "rechnung")
      await create.mutateAsync({ table: "invoices", row: { ...base, contractor: v.vendor, title: v.title, amount: v.amount, invoice_date: v.date, due_date: v.due_date, paid: !!v.paid, budget_pot_id: v["budget_pot_id"] ?? null } });
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
    toast.success(target === "ausgabe" ? tr("Ausgabe erfasst und vom Budget abgezogen") : target === "ablegen" ? tr("Dokument abgelegt") : "Zugeordnet");
  }

  const header = (
    <div className="grid gap-3">
      <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", error ? "border-destructive/40 bg-destructive/5" : "bg-accent/40")}>
        {loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <ScanText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
        <span>
          {loading ? tr("Inhalt wird gelesen…") : error ? `${error}. Du kannst die Angaben selbst eintragen.` : ex ? <>{tr("Erkannt:")} <b className="font-medium">{CATEGORY_FOR[ex.doc_type]}</b>{ex.summary ? ` – ${ex.summary}` : ""} Bitte prüfen.</> : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TARGETS.map((t) => (
          <Button key={t.value} type="button" size="sm" variant={target === t.value ? "default" : "outline"} onClick={() => setTarget(t.value)} title={t.hint}>
            {t.label}
          </Button>
        ))}
      </div>
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
      submitLabel={target === "ablegen" ? "Ablegen" : tr("Übernehmen")}
    />
  );
}
