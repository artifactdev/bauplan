import { tr } from "@/i18n";
import { usePushTarget } from "@/hooks/use-push-target";
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
import { offerDeadlines } from "@/lib/offer-deadlines";
import { QuickTask } from "@/components/app/quick-actions";
import { OfferDialog } from "@/components/app/OfferDialog";

export const Route = createFileRoute("/_ws/kalender")({
  head: () => ({
    meta: [
      { title: tr("calendar.calendar_bauplan") },
      { name: "description", content: tr("calendar.appointments_deadlines_contractor_visits") },
      { property: "og:title", content: tr("calendar.calendar_bauplan") },
      { property: "og:description", content: tr("calendar.keep_track_renovation_s") },
    ],
  }),
  component: CalendarPage,
});

type Item = {
  id: string;
  title: string;
  date: string;
  end: string;
  label: string;
  start_time: string | null;
  kind: "termin" | "frist" | "arbeit" | "aufgabe";
  trade_id: string | null;
  source: { type: "event" | "task" | "offer"; id: string };
  done?: boolean;
};
const KIND: Record<
  Item["kind"],
  { label: string; tone: "info" | "danger" | "primary" | "warning"; dot: string }
> = {
  termin: { label: tr("shared.appointment"), tone: "info", dot: "bg-info" },
  frist: { label: tr("shared.deadline"), tone: "danger", dot: "bg-destructive" },
  arbeit: { label: tr("shared.work"), tone: "primary", dot: "bg-primary" },
  aufgabe: { label: tr("shared.task"), tone: "warning", dot: "bg-warning" },
};
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => tr(d));
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
].map((m) => tr(m));
const pad = (n: number) => String(n).padStart(2, "0");

function CalendarPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({
    y: Number(today.slice(0, 4)),
    m: Number(today.slice(5, 7)) - 1,
  }));
  const [view, setView] = useState<"month" | "list">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
      ? "list"
      : "month",
  );
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("aktion") === "neu"
      ? { initial: { kind: "termin", event_date: today } }
      : null,
  );
  const [taskDlg, setTaskDlg] = useState<{ id: string; initial: Record<string, unknown> } | null>(
    null,
  );
  const [offerDlg, setOfferDlg] = useState<{ id: string; initial: Record<string, unknown> } | null>(
    null,
  );

  usePushTarget(ws.events, (event) => {
    setDlg({ id: event.id, initial: { ...event } });
    setCursor({ y: Number(event.event_date.slice(0, 4)), m: Number(event.event_date.slice(5, 7)) - 1 });
  });
  const items: Item[] = useMemo(
    () =>
      [
        ...ws.events.map((e) => ({
          id: e.id,
          title: e.title,
          date: e.event_date,
          end: eventEnd(e),
          label: rangeLabel(e, fmtDate),
          start_time: e.start_time,
          kind: e.kind,
          trade_id: e.trade_id,
          source: { type: "event" as const, id: e.id },
        })),
        ...ws.tasks
          .filter((t) => t.due_date)
          .map((t) => ({
            id: t.id,
            title: t.title,
            date: t.due_date!,
            end: t.due_date!,
            label: fmtDate(t.due_date!),
            start_time: null,
            kind: "aufgabe" as const,
            trade_id: t.trade_id,
            source: { type: "task" as const, id: t.id },
            done: t.status === "erledigt",
          })),
        ...offerDeadlines(ws.offers).map((e) => ({
          id: e.id,
          title: e.title,
          date: e.event_date,
          end: e.event_date,
          label: fmtDate(e.event_date),
          start_time: null,
          kind: e.kind,
          trade_id: e.trade_id,
          source: { type: "offer" as const, id: e.offer_id },
        })),
      ].sort(
        (a, b) =>
          a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""),
      ),
    [ws],
  );

  const first = new Date(cursor.y, cursor.m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => {
    const d = i - offset + 1;
    return d >= 1 && d <= days ? `${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}` : null;
  });
  const shift = (n: number) =>
    setCursor((c) => {
      const d = new Date(c.y, c.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const upcoming = items.filter((i) => i.end >= today && !i.done);
  const overdue = items.filter((i) => i.date < today && i.source.type !== "event" && !i.done);

  const editEvent = (id: string) => {
    const e = ws.events.find((x) => x.id === id);
    if (e) setDlg({ id, initial: { ...e } });
  };
  const openItem = (item: Item) => {
    const { type, id } = item.source;
    if (type === "event") return editEvent(id);
    if (type === "task") {
      const task = ws.tasks.find((record) => record.id === id);
      if (task) setTaskDlg({ id, initial: { ...task } });
    } else {
      const offer = ws.offers.find((record) => record.id === id);
      if (offer) setOfferDlg({ id, initial: { ...offer } });
    }
  };

  const Row = ({ i }: { i: Item }) => (
    <li className="flex flex-wrap items-center gap-2 py-3 text-sm sm:gap-3">
      <span className="w-full tabular text-xs text-muted-foreground sm:w-44">{i.label}</span>
      <Pill tone={KIND[i.kind].tone}>{KIND[i.kind].label}</Pill>
      <button
        type="button"
        className="min-w-0 flex-1 break-words text-left hover:underline"
        onClick={() => openItem(i)}
      >
        {i.title}
      </button>
      {i.trade_id && (
        <span className="w-full text-xs text-muted-foreground sm:w-auto">
          {tradeName(ws, i.trade_id)}
        </span>
      )}
      {i.source.type === "event" && (
        <span className="flex">
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("shared.edit")}
            onClick={() => editEvent(i.id)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("shared.delete")}
            onClick={() =>
              confirm(tr("calendar.delete_appointment")) &&
              remove.mutate({ table: "events", id: i.id })
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </span>
      )}
    </li>
  );

  return (
    <>
      <PageHeader
        title={tr("shared.calendar")}
        actions={
          <Button
            size="sm"
            onClick={() => setDlg({ initial: { kind: "termin", event_date: today } })}
          >
            <Plus className="h-4 w-4" /> {tr("shared.appointment")}
          </Button>
        }
      />
      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList>
          <TabsTrigger value="month">{tr("shared.month_2")}</TabsTrigger>
          <TabsTrigger value="list">{tr("calendar.list")}</TabsTrigger>
        </TabsList>
        <TabsContent value="month" className="mt-4">
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr("calendar.previous_month")}
                onClick={() => shift(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="font-semibold">
                {MONTHS[cursor.m]} {cursor.y}
              </h2>
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr("calendar.next_month")}
                onClick={() => shift(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
              {WD.map((d) => (
                <div key={d} className="bg-muted px-2 py-1.5 font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
              {cells.map((d, idx) => {
                const its = d
                  ? items.filter((i) => coversDay({ event_date: i.date, end_date: i.end }, d))
                  : [];
                return (
                  <div
                    key={idx}
                    className={cn("min-h-16 bg-card p-1 md:min-h-24", !d && "bg-muted/40")}
                  >
                    {d && (
                      <div
                        className={cn(
                          "mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full tabular",
                          d === today && "bg-primary text-primary-foreground",
                        )}
                      >
                        {Number(d.slice(8))}
                      </div>
                    )}
                    <div className="grid gap-0.5">
                      {its.slice(0, 3).map((i) => (
                        <button
                          key={`${i.source.type}-${i.id}`}
                          onClick={() => openItem(i)}
                          aria-label={`${i.title} · ${i.label}`}
                          className={cn(
                            "flex items-center gap-1 truncate rounded px-1 text-left hover:bg-muted",
                            i.done && "line-through opacity-50",
                            i.source.type !== "event" &&
                              i.date < today &&
                              !i.done &&
                              "text-destructive",
                          )}
                          title={`${i.title} · ${i.label}`}
                        >
                          <span
                            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KIND[i.kind].dot)}
                          />
                          <span className="hidden truncate md:inline">
                            {i.date === d && i.start_time ? `${i.start_time} ` : ""}
                            {i.date !== d ? "↳ " : ""}
                            {i.title}
                          </span>
                        </button>
                      ))}
                      {its.length > 3 && (
                        <span className="px-1 text-muted-foreground">+{its.length - 3}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {Object.values(KIND).map((k) => (
                <span key={k.label} className="flex items-center gap-1">
                  <span className={cn("h-2 w-2 rounded-full", k.dot)} />
                  {k.label}
                </span>
              ))}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="list" className="mt-4 grid gap-4">
          {overdue.length > 0 && (
            <Panel title={tr("shared.overdue")} className="border-destructive/30">
              <ul className="divide-y">
                {overdue.map((i) => (
                  <Row key={`${i.source.type}-${i.id}`} i={i} />
                ))}
              </ul>
            </Panel>
          )}
          <Panel title={tr("calendar.upcoming")}>
            <ul className="divide-y">
              {upcoming.map((i) => (
                <Row key={`${i.source.type}-${i.id}`} i={i} />
              ))}
            </ul>
            {!upcoming.length && <Empty>{tr("calendar.nothing_planned")}</Empty>}
          </Panel>
        </TabsContent>
      </Tabs>
      <QuickTask
        open={!!taskDlg}
        onOpenChange={(open) => !open && setTaskDlg(null)}
        editId={taskDlg?.id}
        initial={taskDlg?.initial}
      />
      <OfferDialog
        open={!!offerDlg}
        onOpenChange={(open) => !open && setOfferDlg(null)}
        editId={offerDlg?.id}
        initial={offerDlg?.initial}
      />
      <EntityDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.id ? tr("calendar.edit_appointment") : tr("calendar.new_appointment")}
        scan={dlg?.id ? undefined : "event"}
        fields={[
          { name: "title", label: tr("shared.title"), required: true, full: true },
          { name: "event_date", label: tr("calendar.start_date"), type: "date", required: true },
          { name: "start_time", label: tr("calendar.start_time_optional"), type: "time" },
          { name: "end_date", label: tr("calendar.end_date_optional"), type: "date" },
          { name: "end_time", label: tr("calendar.end_time_optional"), type: "time" },
          {
            name: "kind",
            label: tr("calendar.type"),
            type: "select",
            required: true,
            options: [
              { value: "termin", label: tr("shared.appointment") },
              { value: "frist", label: tr("shared.deadline") },
              { value: "arbeit", label: tr("shared.work") },
            ],
          },
          {
            name: "trade_id",
            label: tr("shared.trade"),
            type: "select",
            options: tradeOptions(ws),
          },
          { name: "notes", label: tr("shared.notes"), type: "textarea" },
        ]}
        initial={dlg?.initial}
        extra={
          dlg?.id ? (
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (dlg.id && confirm(tr("calendar.delete_appointment")))
                  remove.mutate({ table: "events", id: dlg.id }, { onSuccess: () => setDlg(null) });
              }}
            >
              <Trash2 data-icon="inline-start" />
              {tr("shared.delete")}
            </Button>
          ) : undefined
        }
        onSubmit={(v) => {
          const rawErr = rangeError(v as { event_date: string });
          const err = rawErr ? tr(rawErr) : null;
          if (err) {
            toast.error(err);
            throw new Error(err);
          }
          return dlg?.id
            ? update.mutateAsync({ table: "events", id: dlg.id, patch: v })
            : create.mutateAsync({ table: "events", row: v });
        }}
      />
    </>
  );
}
