import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { costItemOptions, docOptions, potName, potOptions, tradeName, tradeOptions } from "@/lib/options";
import { EXPENSE_CATEGORIES, type ExpenseStatus } from "@/lib/schema";
import { Empty, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { EntityDialog } from "@/components/app/EntityDialog";
import { QuickUpload } from "@/components/app/quick-actions";
import { resolveFileUrl } from "@/components/app/doc-open";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_ws/ausgaben")({
  head: () => ({
    meta: [
      { title: tr("Ausgaben – Bauplan") },
      { name: "description", content: tr("Kassenzettel und allgemeine Rechnungen mit Beleg, Status bezahlt, eingereicht oder erstattet.") },
      { property: "og:title", content: tr("Ausgaben – Bauplan") },
      { property: "og:description", content: tr("Kassenzettel und Rechnungen deiner Renovierung im Überblick.") },
    ],
  }),
  component: ExpensesPage,
});

const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; tone: "neutral" | "warning" | "success" | "info" | "primary" }> = {
  offen: { label: tr("Offen"), tone: "warning" },
  bezahlt: { label: tr("Bezahlt"), tone: "success" },
  eingereicht: { label: tr("Eingereicht"), tone: "info" },
  erstattet: { label: tr("Erstattet"), tone: "primary" },
};
const STATUS_OPTIONS = Object.entries(EXPENSE_STATUS).map(([value, s]) => ({ value, label: s.label }));

function ExpensesPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | ExpenseStatus>("all");
  const [source, setSource] = useState<string>("all");
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.expenses
      .filter((e) => status === "all" || e.status === status)
      .filter((e) => source === "all" || (source === "none" ? !e.budget_pot_id : e.budget_pot_id === source))
      .filter((e) => !s || [e.title, e.vendor, e.category, tradeName(ws, e.trade_id)].join(" ").toLowerCase().includes(s))
      .sort((a, b) => (b.expense_date ?? "").localeCompare(a.expense_date ?? ""));
  }, [ws, q, status, source]);
  const bySource = (id: string | null) => ws.expenses.filter((e) => (id ? e.budget_pot_id === id : !e.budget_pot_id)).reduce((a, e) => a + Number(e.amount), 0);

  const sumBy = (st: ExpenseStatus) => ws.expenses.filter((e) => e.status === st).reduce((a, e) => a + Number(e.amount), 0);
  const total = ws.expenses.reduce((a, e) => a + Number(e.amount), 0);
  const listTotal = list.reduce((a, e) => a + Number(e.amount), 0);

  const openDoc = async (docId: string | null) => {
    const d = ws.documents.find((x) => x.id === docId);
    const url = await resolveFileUrl(d?.storage_path ?? null);
    if (url) window.open(url, "_blank");
  };

  return (
    <>
      <PageHeader
        title={tr("Ausgaben")}
        subtitle={tr("Kassenzettel und allgemeine Rechnungen – je nach Zahlungsquelle vom Budget abgezogen.")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDlg({ initial: { status: "bezahlt", expense_date: todayISO(), category: "Baumarkt" } })}><Plus className="h-4 w-4" /> {tr("Manuell")}</Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> {tr("Beleg hochladen")}</Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={tr("Gesamt")} value={eur(total, true)} />
        {(Object.keys(EXPENSE_STATUS) as ExpenseStatus[]).map((st) => (
          <Stat key={st} label={EXPENSE_STATUS[st].label} value={eur(sumBy(st), true)} active={status === st} onClick={() => setStatus(status === st ? "all" : st)} />
        ))}
      </div>

      {ws.budget_pots.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {ws.budget_pots.map((p) => (
            <button key={p.id} type="button" onClick={() => setSource(source === p.id ? "all" : p.id)} className={`rounded-full border px-3 py-1 tabular ${source === p.id ? "border-primary bg-primary/10" : "bg-card"}`}>
              {p.name}: <span className="font-medium">{eur(bySource(p.id), true)}</span>
              {!p.deducts_from_budget && <span className="ml-1 text-xs text-muted-foreground">({tr("nicht vom Budget")})</span>}
            </button>
          ))}
          {bySource(null) > 0 && <span className="rounded-full border px-3 py-1 text-muted-foreground tabular">{tr("Ohne Quelle")}: {eur(bySource(null), true)}</span>}
        </div>
      )}

      <div className="my-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={tr("Suchen…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("Alle Status")}</SelectItem>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {ws.budget_pots.length > 0 && (
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-44" aria-label={tr("Bezahlt aus")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("Alle Quellen")}</SelectItem>
              {ws.budget_pots.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              <SelectItem value="none">{tr("Ohne Quelle")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("Datum")}</TableHead><TableHead>{tr("Beschreibung")}</TableHead><TableHead>{tr("Geschäft")}</TableHead><TableHead>{tr("Kategorie")}</TableHead><TableHead>{tr("Gewerk")}</TableHead><TableHead>{tr("Bezahlt aus")}</TableHead><TableHead className="text-right">{tr("Betrag")}</TableHead><TableHead>{tr("Status")}</TableHead><TableHead>{tr("Beleg")}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody className="tabular">
              {list.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(e.expense_date)}</TableCell>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell>{e.vendor ?? "–"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.category ? tr(e.category) : "–"}</TableCell>
                  <TableCell className="text-muted-foreground">{tradeName(ws, e.trade_id)}</TableCell>
                  <TableCell>{potName(ws, e.budget_pot_id) ?? "–"}</TableCell>
                  <TableCell className="text-right">{eur(e.amount, true)}</TableCell>
                  <TableCell>
                    <Select value={e.status} onValueChange={(v) => update.mutate({ table: "expenses", id: e.id, patch: { status: v } })}>
                      <SelectTrigger className="h-8 w-36" aria-label={tr("Status ändern")}><Pill tone={EXPENSE_STATUS[e.status]?.tone}>{EXPENSE_STATUS[e.status]?.label ?? e.status}</Pill></SelectTrigger>
                      <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {e.document_id ? (
                      <Button size="sm" variant="ghost" onClick={() => openDoc(e.document_id)}><FileText className="h-4 w-4" /> {tr("Öffnen")}</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{tr("kein Beleg")}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" aria-label={tr("Bearbeiten")} onClick={() => setDlg({ id: e.id, initial: { ...e } })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={tr("Löschen")} onClick={() => confirm(tr("Ausgabe löschen? Der Beleg bleibt unter Dokumente.")) && remove.mutate({ table: "expenses", id: e.id })}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {list.length > 0 && (
              <TableFooter className="tabular">
                <TableRow><TableCell colSpan={6}>{tr("Summe")}</TableCell><TableCell className="text-right">{eur(listTotal, true)}</TableCell><TableCell colSpan={3} /></TableRow>
              </TableFooter>
            )}
          </Table>
          {!list.length && <Empty>{ws.expenses.length ? tr("Keine Treffer.") : tr("Noch keine Ausgaben – lade einen Kassenzettel hoch, er wird automatisch erkannt.")}</Empty>}
        </div>
      </Panel>

      <QuickUpload open={uploadOpen} onOpenChange={setUploadOpen} initial={{ category: "Beleg", recognize: true }} />
      <EntityDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.id ? tr("Ausgabe bearbeiten") : tr("Neue Ausgabe")}
        scan={dlg?.id ? undefined : "expense"}
        fields={[
          { name: "title", label: tr("Beschreibung"), required: true, full: true },
          { name: "vendor", label: tr("Geschäft / Firma") },
          { name: "amount", label: tr("Betrag brutto (€)"), type: "number", required: true },
          { name: "expense_date", label: tr("Datum"), type: "date" },
          { name: "payment_date", label: tr("Zahlungsdatum (Plan / Ist)"), type: "date" },
          { name: "category", label: tr("Kategorie"), type: "select", options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: tr(c) })) },
          { name: "status", label: tr("Status"), type: "select", required: true, options: STATUS_OPTIONS },
          { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
          { name: "cost_item_id", label: tr("Kostenposition"), type: "select", options: costItemOptions(ws) },
          { name: "budget_pot_id", label: tr("Bezahlt aus"), type: "select", options: potOptions(ws) },
          { name: "document_id", label: tr("Beleg"), type: "select", options: docOptions(ws) },
          { name: "notes", label: tr("Notizen"), type: "textarea" },
        ]}
        initial={dlg?.initial}
        onSubmit={(v) => (dlg?.id ? update.mutateAsync({ table: "expenses", id: dlg.id, patch: v }) : create.mutateAsync({ table: "expenses", row: v }))}
      />
    </>
  );
}

function Stat({ label, value, active, onClick }: { label: string; value: string; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`rounded-xl border bg-card p-4 text-left shadow-card transition-colors ${active ? "border-primary ring-1 ring-primary" : ""} ${onClick ? "hover:border-primary/50" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular">{value}</div>
    </button>
  );
}
