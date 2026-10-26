import { tr } from "@/i18n";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Pencil, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { contactLabel, contactOptions, tradeName, tradeOptions } from "@/lib/options";
import type { Invoice } from "@/lib/schema";
import { Empty, Panel, Pill } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ALL = "__all";
type State = "offen" | "ueberfaellig" | "bezahlt";
const STATE: Record<State, { label: string; tone: "warning" | "danger" | "success" }> = {
  ueberfaellig: { label: tr("Überfällig"), tone: "danger" },
  offen: { label: tr("Offen"), tone: "warning" },
  bezahlt: { label: tr("Bezahlt"), tone: "success" },
};
export const invoiceState = (i: Pick<Invoice, "paid" | "due_date">, today: string): State =>
  i.paid ? "bezahlt" : i.due_date && i.due_date < today ? "ueberfaellig" : "offen";

type Key = "firm" | "title" | "trade" | "date" | "due" | "amount" | "state";
const COLS: { key: Key; label: string }[] = [
  { key: "firm", label: tr("Firma") }, { key: "title", label: tr("Leistung") }, { key: "trade", label: tr("Gewerk") },
  { key: "date", label: tr("Datum") }, { key: "due", label: tr("Fällig") }, { key: "amount", label: tr("Betrag") }, { key: "state", label: tr("Status") },
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
        {([[tr("Gesamt"), sum(), "neutral"], [tr("Offen"), sum("offen"), "warning"], [tr("Überfällig"), sum("ueberfaellig"), "danger"], [tr("Bezahlt"), sum("bezahlt"), "success"]] as const).map(([l, v, t]) => (
          <Panel key={l} className="p-3 md:p-4">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`font-display text-lg font-semibold tabular ${t === "danger" && v > 0 ? "text-destructive" : ""}`}>{eur(v, true)}</div>
          </Panel>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder={tr("Suchen…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <FilterSelect value={fState} onChange={setFState} all="Alle Status" options={Object.entries(STATE).map(([value, s]) => ({ value, label: s.label }))} />
        <FilterSelect value={fTrade} onChange={setFTrade} all="Alle Gewerke" options={tradeOptions(ws)} />
        <FilterSelect value={fContact} onChange={setFContact} all="Alle Kontakte" options={contactOptions(ws)} />
        {filtered && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setFState(ALL); setFTrade(ALL); setFContact(ALL); }}>{tr("Zurücksetzen")}</Button>}
      </div>
      <Panel>
        <div className="overflow-x-auto">
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
                      <button onClick={() => update.mutate({ table: "invoices", id: i.id, patch: { paid: !i.paid } })} title={tr("Status umschalten")}>
                        <Pill tone={STATE[st].tone}>{STATE[st].label}</Pill>
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {i.document_id && <Button size="icon" variant="ghost" aria-label={tr("PDF öffnen")} onClick={() => openDoc(i.document_id)}><FileText className="h-4 w-4" /></Button>}
                      <Button size="icon" variant="ghost" aria-label={tr("Bearbeiten")} onClick={() => onEdit(i)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={tr("Löschen")} onClick={() => confirm(tr("Rechnung löschen?")) && remove.mutate({ table: "invoices", id: i.id })}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!list.length && <Empty>{ws.invoices.length ? tr("Keine Rechnungen für diese Filter.") : tr("Noch keine Rechnungen.")}</Empty>}
        </div>
      </Panel>
    </>
  );
}
