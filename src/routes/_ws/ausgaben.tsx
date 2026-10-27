import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { costItemOptions, docOptions, potName, potOptions, tradeName, tradeOptions } from "@/lib/options";
import { EXPENSE_CATEGORIES, type ExpenseStatus } from "@/lib/schema";
import { Empty, MetricCard, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
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
      { title: tr("expenses.expenses_bauplan") },
      { name: "description", content: tr("expenses.receipts_general_invoices_document") },
      { property: "og:title", content: tr("expenses.expenses_bauplan") },
      { property: "og:description", content: tr("expenses.receipts_invoices_renovation_glance") },
    ],
  }),
  component: ExpensesPage,
});

const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; tone: "neutral" | "warning" | "success" | "info" | "primary" }> = {
  offen: { label: tr("shared.open"), tone: "warning" },
  bezahlt: { label: tr("shared.paid"), tone: "success" },
  eingereicht: { label: tr("shared.submitted"), tone: "info" },
  erstattet: { label: tr("shared.reimbursed"), tone: "primary" },
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
        title={tr("shared.expenses")}
        subtitle={tr("expenses.receipts_general_invoices_deducted")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDlg({ initial: { status: "bezahlt", expense_date: todayISO(), category: "Baumarkt" } })}><Plus className="h-4 w-4" /> {tr("expenses.manual")}</Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> {tr("expenses.upload_receipt")}</Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={tr("shared.total")} value={eur(total, true)} tone="neutral" />
        {(Object.keys(EXPENSE_STATUS) as ExpenseStatus[]).map((st) => (
          <Stat key={st} label={EXPENSE_STATUS[st].label} value={eur(sumBy(st), true)} tone={EXPENSE_STATUS[st].tone} active={status === st} onClick={() => setStatus(status === st ? "all" : st)} />
        ))}
      </div>

      {ws.budget_pots.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {ws.budget_pots.map((p) => (
            <button key={p.id} type="button" onClick={() => setSource(source === p.id ? "all" : p.id)} className={`rounded-full border px-3 py-1 tabular ${source === p.id ? "border-primary bg-primary/10" : "bg-card"}`}>
              {p.name}: <span className="font-medium">{eur(bySource(p.id), true)}</span>
              {!p.deducts_from_budget && <span className="ml-1 text-xs text-muted-foreground">({tr("shared.not_budget")})</span>}
            </button>
          ))}
          {bySource(null) > 0 && <span className="rounded-full border px-3 py-1 text-muted-foreground tabular">{tr("expenses.no_source")}: {eur(bySource(null), true)}</span>}
        </div>
      )}

      <div className="my-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={tr("shared.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("shared.all_statuses")}</SelectItem>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {ws.budget_pots.length > 0 && (
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-44" aria-label={tr("shared.paid_2")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("expenses.all_sources")}</SelectItem>
              {ws.budget_pots.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              <SelectItem value="none">{tr("expenses.no_source")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <Panel>
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("shared.date")}</TableHead><TableHead>{tr("shared.description")}</TableHead><TableHead>{tr("expenses.shop")}</TableHead><TableHead>{tr("shared.category")}</TableHead><TableHead>{tr("shared.trade")}</TableHead><TableHead>{tr("shared.paid_2")}</TableHead><TableHead className="text-right">{tr("shared.amount")}</TableHead><TableHead>{tr("shared.status")}</TableHead><TableHead>{tr("shared.receipt")}</TableHead><TableHead /></TableRow>
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
                      <SelectTrigger className="h-8 w-36" aria-label={tr("expenses.change_status")}><Pill tone={EXPENSE_STATUS[e.status]?.tone}>{EXPENSE_STATUS[e.status]?.label ?? e.status}</Pill></SelectTrigger>
                      <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {e.document_id ? (
                      <Button size="sm" variant="ghost" onClick={() => openDoc(e.document_id)}><FileText className="h-4 w-4" /> {tr("expenses.open")}</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{tr("expenses.no_receipt")}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={() => setDlg({ id: e.id, initial: { ...e } })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={() => confirm(tr("expenses.delete_expense_receipt_stays")) && remove.mutate({ table: "expenses", id: e.id })}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {list.length > 0 && (
              <TableFooter className="tabular">
                <TableRow><TableCell colSpan={6}>{tr("expenses.sum")}</TableCell><TableCell className="text-right">{eur(listTotal, true)}</TableCell><TableCell colSpan={3} /></TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
        <div className="grid gap-3 md:hidden">
          {list.map((e) => (
            <article key={e.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">{e.title}</h3>
                  {e.vendor && <p className="mt-0.5 text-sm text-muted-foreground">{e.vendor}</p>}
                </div>
                <span className="shrink-0 text-right font-semibold tabular">{eur(e.amount, true)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{fmtDate(e.expense_date)}</span>
                {e.category && <span>· {tr(e.category)}</span>}
                {tradeName(ws, e.trade_id) && <span>· {tradeName(ws, e.trade_id)}</span>}
                {potName(ws, e.budget_pot_id) && <span>· {potName(ws, e.budget_pot_id)}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <Select value={e.status} onValueChange={(v) => update.mutate({ table: "expenses", id: e.id, patch: { status: v } })}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex">
                  {e.document_id && <Button size="icon" variant="ghost" aria-label={tr("expenses.open")} onClick={() => openDoc(e.document_id)}><FileText className="h-4 w-4" /></Button>}
                  <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={() => setDlg({ id: e.id, initial: { ...e } })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={() => confirm(tr("expenses.delete_expense_receipt_stays")) && remove.mutate({ table: "expenses", id: e.id })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!list.length && <Empty>{ws.expenses.length ? tr("shared.no_results") : tr("expenses.no_expenses_yet_upload")}</Empty>}
        {list.length > 0 && <div className="mt-3 flex justify-end border-t pt-3 text-sm font-medium tabular md:hidden">{tr("expenses.sum")}: {eur(listTotal, true)}</div>}
      </Panel>

      <QuickUpload open={uploadOpen} onOpenChange={setUploadOpen} initial={{ category: "Beleg", recognize: true }} />
      <EntityDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.id ? tr("expenses.edit_expense") : tr("expenses.new_expense")}
        scan={dlg?.id ? undefined : "expense"}
        fields={[
          { name: "title", label: tr("shared.description"), required: true, full: true },
          { name: "vendor", label: tr("shared.shop_company") },
          { name: "amount", label: tr("shared.gross_amount"), type: "number", required: true },
          { name: "expense_date", label: tr("shared.date"), type: "date" },
          { name: "payment_date", label: tr("shared.payment_date_planned_actual"), type: "date" },
          { name: "category", label: tr("shared.category"), type: "select", options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: tr(c) })) },
          { name: "status", label: tr("shared.status"), type: "select", required: true, options: STATUS_OPTIONS },
          { name: "trade_id", label: tr("shared.trade"), type: "select", options: tradeOptions(ws) },
          { name: "cost_item_id", label: tr("shared.cost_item"), type: "select", options: costItemOptions(ws) },
          { name: "budget_pot_id", label: tr("shared.paid_2"), type: "select", options: potOptions(ws) },
          { name: "document_id", label: tr("shared.receipt"), type: "select", options: docOptions(ws) },
          { name: "notes", label: tr("shared.notes"), type: "textarea" },
        ]}
        initial={dlg?.initial}
        onSubmit={(v) => (dlg?.id ? update.mutateAsync({ table: "expenses", id: dlg.id, patch: v }) : create.mutateAsync({ table: "expenses", row: v }))}
      />
    </>
  );
}

function Stat({ label, value, tone, active, onClick }: { label: string; value: string; tone: "neutral" | "warning" | "success" | "info" | "primary"; active?: boolean; onClick?: () => void }) {
  return <MetricCard label={label} value={value} tone={tone} active={active} onClick={onClick} />;
}
