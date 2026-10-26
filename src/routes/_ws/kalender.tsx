import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { fmtDate, todayISO } from "@/lib/format";
import { tradeName, tradeOptions } from "@/lib/options";
import { Empty, PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { EntityDialog } from "@/components/app/EntityDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { coversDay, eventEnd, rangeError, rangeLabel } from "@/lib/events";

export const Route = createFileRoute("/_ws/kalender")({
  head: () => ({
    meta: [
      { title: tr("Kalender – Bauplan") },
      { name: "description", content: tr("Termine, Fristen, Handwerkereinsätze und fällige Aufgaben im Monats- und Listenblick.") },
      { property: "og:title", content: tr("Kalender – Bauplan") },
      { property: "og:description", content: tr("Termine und Fristen deiner Renovierung im Blick.") },
    ],
  }),
  component: CalendarPage,
});

type Item = { id: string; title: string; date: string; end: string; label: string; start_time: string | null; kind: "termin" | "frist" | "arbeit" | "aufgabe"; trade_id: string | null; isEvent: boolean; done?: boolean };
const KIND: Record<Item["kind"], { label: string; tone: "info" | "danger" | "primary" | "warning"; dot: string }> = {
  termin: { label: tr("Termin"), tone: "info", dot: "bg-info" },
  frist: { label: tr("Frist"), tone: "danger", dot: "bg-destructive" },
  arbeit: { label: tr("Arbeiten"), tone: "primary", dot: "bg-primary" },
  aufgabe: { label: tr("Aufgabe"), tone: "warning", dot: "bg-warning" },
};
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => tr(d));
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"].map((m) => tr(m));
const pad = (n: number) => String(n).padStart(2, "0");

function CalendarPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);

  const items: Item[] = useMemo(
    () =>
      [
        ...ws.events.map((e) => ({ id: e.id, title: e.title, date: e.event_date, end: eventEnd(e), label: rangeLabel(e, fmtDate), start_time: e.start_time, kind: e.kind, trade_id: e.trade_id, isEvent: true })),
        ...ws.tasks.filter((t) => t.due_date).map((t) => ({ id: t.id, title: t.title, date: t.due_date!, end: t.due_date!, label: fmtDate(t.due_date!), start_time: null, kind: "aufgabe" as const, trade_id: t.trade_id, isEvent: false, done: t.status === "erledigt" })),
      ].sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? "")),
    [ws],
  );

  const first = new Date(cursor.y, cursor.m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => {
    const d = i - offset + 1;
    return d >= 1 && d <= days ? `${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}` : null;
  });
  const shift = (n: number) => setCursor((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const upcoming = items.filter((i) => i.end >= today && !i.done);
  const overdue = items.filter((i) => i.date < today && !i.isEvent && !i.done);

  const editEvent = (id: string) => {
    const e = ws.events.find((x) => x.id === id);
    if (e) setDlg({ id, initial: { ...e } });
  };

  const Row = ({ i }: { i: Item }) => (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span className="w-44 tabular text-xs text-muted-foreground">{i.label}</span>
      <Pill tone={KIND[i.kind].tone}>{KIND[i.kind].label}</Pill>
      <span className="min-w-0 flex-1">{i.title}</span>
      <span className="text-xs text-muted-foreground">{tradeName(ws, i.trade_id)}</span>
      {i.isEvent && (
        <span className="flex">
          <Button size="icon" variant="ghost" aria-label={tr("Bearbeiten")} onClick={() => editEvent(i.id)}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" aria-label={tr("Löschen")} onClick={() => confirm(tr("Termin löschen?")) && remove.mutate({ table: "events", id: i.id })}><Trash2 className="h-4 w-4" /></Button>
        </span>
      )}
    </li>
  );

  return (
    <>
      <PageHeader title={tr("Kalender")} actions={<Button size="sm" onClick={() => setDlg({ initial: { kind: "termin", event_date: today } })}><Plus className="h-4 w-4" /> {tr("Termin")}</Button>} />
      <Tabs defaultValue="month">
        <TabsList><TabsTrigger value="month">{tr("Monat")}</TabsTrigger><TabsTrigger value="list">{tr("Liste")}</TabsTrigger></TabsList>
        <TabsContent value="month" className="mt-4">
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <Button size="icon" variant="ghost" aria-label={tr("Vorheriger Monat")} onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
              <h2 className="font-semibold">{MONTHS[cursor.m]} {cursor.y}</h2>
              <Button size="icon" variant="ghost" aria-label={tr("Nächster Monat")} onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
              {WD.map((d) => <div key={d} className="bg-muted px-2 py-1.5 font-medium text-muted-foreground">{d}</div>)}
              {cells.map((d, idx) => {
                const its = d ? items.filter((i) => coversDay({ event_date: i.date, end_date: i.end }, d)) : [];
                return (
                  <div key={idx} className={cn("min-h-16 bg-card p-1 md:min-h-24", !d && "bg-muted/40")}>
                    {d && <div className={cn("mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full tabular", d === today && "bg-primary text-primary-foreground")}>{Number(d.slice(8))}</div>}
                    <div className="grid gap-0.5">
                      {its.slice(0, 3).map((i) => (
                        <button key={i.id} onClick={() => i.isEvent && editEvent(i.id)} className={cn("flex items-center gap-1 truncate rounded px-1 text-left hover:bg-muted", i.done && "line-through opacity-50", !i.isEvent && i.date < today && !i.done && "text-destructive")} title={`${i.title} · ${i.label}`}>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KIND[i.kind].dot)} />
                          <span className="hidden truncate md:inline">{i.date === d && i.start_time ? `${i.start_time} ` : ""}{i.date !== d ? "↳ " : ""}{i.title}</span>
                        </button>
                      ))}
                      {its.length > 3 && <span className="px-1 text-muted-foreground">+{its.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {Object.values(KIND).map((k) => <span key={k.label} className="flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", k.dot)} />{k.label}</span>)}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="list" className="mt-4 grid gap-4">
          {overdue.length > 0 && (
            <Panel title={tr("Überfällig")} className="border-destructive/30"><ul className="divide-y">{overdue.map((i) => <Row key={i.id} i={i} />)}</ul></Panel>
          )}
          <Panel title={tr("Anstehend")}>
            <ul className="divide-y">{upcoming.map((i) => <Row key={i.id} i={i} />)}</ul>
            {!upcoming.length && <Empty>{tr("Nichts geplant.")}</Empty>}
          </Panel>
        </TabsContent>
      </Tabs>
      <EntityDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.id ? tr("Termin bearbeiten") : tr("Neuer Termin")}
        scan={dlg?.id ? undefined : "event"}
        fields={[
          { name: "title", label: tr("Titel"), required: true, full: true },
          { name: "event_date", label: tr("Startdatum"), type: "date", required: true },
          { name: "start_time", label: tr("Startzeit (optional)"), type: "time" },
          { name: "end_date", label: tr("Enddatum (optional)"), type: "date" },
          { name: "end_time", label: tr("Endzeit (optional)"), type: "time" },
          { name: "kind", label: tr("Art"), type: "select", required: true, options: [{ value: "termin", label: tr("Termin") }, { value: "frist", label: tr("Frist") }, { value: "arbeit", label: tr("Arbeiten") }] },
          { name: "trade_id", label: tr("Gewerk"), type: "select", options: tradeOptions(ws) },
          { name: "notes", label: tr("Notizen"), type: "textarea" },
        ]}
        initial={dlg?.initial}
        onSubmit={(v) => {
          const rawErr = rangeError(v as { event_date: string });
          const err = rawErr ? tr(rawErr) : null;
          if (err) { toast.error(err); throw new Error(err); }
          return dlg?.id ? update.mutateAsync({ table: "events", id: dlg.id, patch: v }) : create.mutateAsync({ table: "events", row: v });
        }}
      />
    </>
  );
}
