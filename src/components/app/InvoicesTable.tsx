import { tr } from "@/i18n";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Pencil, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { contactLabel, contactOptions, tradeName, tradeOptions } from "@/lib/options";
import type { Invoice } from "@/lib/schema";
import { Empty, MetricCard, Panel, Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ALL = "__all";
type State = "offen" | "ueberfaellig" | "bezahlt";
const STATE: Record<State, { label: string; tone: "warning" | "danger" | "success" }> = {
  ueberfaellig: { label: tr("shared.overdue"), tone: "danger" },
  offen: { label: tr("shared.open"), tone: "warning" },
  bezahlt: { label: tr("shared.paid"), tone: "success" },
};
export const invoiceState = (i: Pick<Invoice, "paid" | "due_date">, today: string): State =>
  i.paid ? "bezahlt" : i.due_date && i.due_date < today ? "ueberfaellig" : "offen";

type Key = "firm" | "title" | "trade" | "date" | "due" | "amount" | "state";
const COLS: { key: Key; label: string }[] = [
  { key: "firm", label: tr("shared.company") }, { key: "title", label: tr("shared.service") }, { key: "trade", label: tr("shared.trade") },
  { key: "date", label: tr("shared.date") }, { key: "due", label: tr("invoices_table.due") }, { key: "amount", label: tr("shared.amount") }, { key: "state", label: tr("shared.status") },
];
const cmp = (a: string | number | null, b: string | number | null) =>
  a === b ? 0 : a === null || a === "" ? -1 : b === null || b === "" ? 1 : typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "de");

function FilterSelect({ value, onChange, all, options }: { value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function InvoicesTable({ onEdit, openDoc }: { onEdit: (i: Invoice) => void; openDoc: (docId: string | null) => void }) {
  const { ws } = useWorkspace();
  const { update, remove } = useMutations();
  const today = todayISO();
  const [q, setQ] = useState("");
  const [fState, setFState] = useState(ALL);
  const [fTrade, setFTrade] = useState(ALL);
  const [fContact, setFContact] = useState(ALL);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "due", dir: 1 });

  const who = (i: Invoice) => { const c = ws.contacts.find((x) => x.id === i.contact_id); return c ? contactLabel(c) : i.contractor; };
  const val = (i: Invoice): string | number | null => {
    switch (sort.key) {
      case "firm": return who(i);
      case "title": return i.title;
      case "trade": return i.trade_id ? tradeName(ws, i.trade_id) : null;
      case "date": return i.invoice_date;
      case "due": return i.due_date;
      case "amount": return Number(i.amount);
      case "state": return Object.keys(STATE).indexOf(invoiceState(i, today));
    }
  };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.invoices.filter((i) =>
      (fState === ALL || invoiceState(i, today) === fState) &&
      (fTrade === ALL || i.trade_id === fTrade) &&
      (fContact === ALL || i.contact_id === fContact) &&
      (!s || [i.contractor, i.title, who(i)].some((x) => x?.toLowerCase().includes(s))));
  }, [ws, q, fState, fTrade, fContact, today]);
  const sorted = [...list].sort((a, b) => sort.dir * cmp(val(a), val(b)));

  const sum = (st?: State) => list.filter((i) => !st || invoiceState(i, today) === st).reduce((s, i) => s + Number(i.amount), 0);
  const filtered = q || fState !== ALL || fTrade !== ALL || fContact !== ALL;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([[tr("shared.total"), sum(), "neutral"], [tr("shared.open"), sum("offen"), "warning"], [tr("shared.overdue"), sum("ueberfaellig"), "danger"], [tr("shared.paid"), sum("bezahlt"), "success"]] as const).map(([label, amount, tone]) => (
          <MetricCard key={label} label={label} value={eur(amount, true)} tone={tone} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder={tr("shared.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <FilterSelect value={fState} onChange={setFState} all={tr("shared.all_statuses")} options={Object.entries(STATE).map(([value, s]) => ({ value, label: s.label }))} />
        <FilterSelect value={fTrade} onChange={setFTrade} all={tr("shared.all_trades")} options={tradeOptions(ws)} />
        <FilterSelect value={fContact} onChange={setFContact} all="Alle Kontakte" options={contactOptions(ws)} />
        {filtered && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setFState(ALL); setFTrade(ALL); setFContact(ALL); }}>{tr("shared.reset")}</Button>}
      </div>
      <Panel>
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader><TableRow>
              {COLS.map((c) => (
                <TableHead key={c.key} className={c.key === "amount" ? "text-right" : ""}>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </TableHead>
              ))}<TableHead />
            </TableRow></TableHeader>
            <TableBody className="tabular">
              {sorted.map((i) => {
                const st = invoiceState(i, today);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{who(i)}</TableCell>
                    <TableCell>{i.title ?? "–"}</TableCell>
                    <TableCell className="text-muted-foreground">{tradeName(ws, i.trade_id)}</TableCell>
                    <TableCell>{fmtDate(i.invoice_date)}</TableCell>
                    <TableCell className={st === "ueberfaellig" ? "font-medium text-destructive" : ""}>{fmtDate(i.due_date)}</TableCell>
                    <TableCell className="text-right">{eur(i.amount, true)}</TableCell>
                    <TableCell>
                      <button onClick={() => update.mutate({ table: "invoices", id: i.id, patch: { paid: !i.paid } })} title={tr("invoices_table.toggle_status")}>
                        <Pill tone={STATE[st].tone}>{STATE[st].label}</Pill>
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {i.document_id && <Button size="icon" variant="ghost" aria-label={tr("shared.open_pdf")} onClick={() => openDoc(i.document_id)}><FileText className="h-4 w-4" /></Button>}
                      <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={() => onEdit(i)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={() => confirm(tr("invoices_table.delete_invoice")) && remove.mutate({ table: "invoices", id: i.id })}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-3 md:hidden">
          {sorted.map((i) => {
            const st = invoiceState(i, today);
            return (
              <article key={i.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-medium">{who(i)}</h3>
                    {i.title && <p className="mt-0.5 break-words text-sm text-muted-foreground">{i.title}</p>}
                    {i.trade_id && <p className="mt-0.5 text-xs text-muted-foreground">{tradeName(ws, i.trade_id)}</p>}
                  </div>
                  <span className="shrink-0 text-right font-semibold tabular">{eur(i.amount, true)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{tr("shared.date")}: {fmtDate(i.invoice_date)}</span>
                  <span className={st === "ueberfaellig" ? "font-medium text-destructive" : ""}>{tr("invoices_table.due")}: {fmtDate(i.due_date)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
                  <button className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => update.mutate({ table: "invoices", id: i.id, patch: { paid: !i.paid } })} aria-label={tr("invoices_table.toggle_status")}>
                    <Pill tone={STATE[st].tone}>{STATE[st].label}</Pill>
                  </button>
                  <div className="flex">
                    {i.document_id && <Button size="icon" variant="ghost" aria-label={tr("shared.open_pdf")} onClick={() => openDoc(i.document_id)}><FileText className="h-4 w-4" /></Button>}
                    <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={() => onEdit(i)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={() => confirm(tr("invoices_table.delete_invoice")) && remove.mutate({ table: "invoices", id: i.id })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {!list.length && <Empty>{ws.invoices.length ? tr("invoices_table.no_invoices_match_filters") : tr("invoices_table.no_invoices_yet")}</Empty>}
      </Panel>
    </>
  );
}
