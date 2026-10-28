import { tr } from "@/i18n";
import { usePushTarget } from "@/hooks/use-push-target";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { fmtDate, todayISO } from "@/lib/format";
import { tradeName, tradeOptions } from "@/lib/options";
import { PageHeader } from "@/components/app/ui-bits";
import { EntityDialog } from "@/components/app/EntityDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { eventEnd, rangeError, rangeLabel } from "@/lib/events";
import { offerDeadlines } from "@/lib/offer-deadlines";
import { QuickTask } from "@/components/app/quick-actions";
import { OfferDialog } from "@/components/app/OfferDialog";
import { taskRange } from "@/lib/tasks";
import { CalendarViews } from "@/components/app/CalendarViews";
import type { CalendarItem } from "@/lib/calendar-view";

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

function CalendarPage() {
  const { ws } = useWorkspace();
  const { create, update, remove } = useMutations();
  const today = todayISO();
  const [selected, setSelected] = useState(today);
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
    setSelected(event.event_date);
  });
  const items: CalendarItem[] = useMemo(
    () =>
      [
        ...ws.events.map((e) => ({
          id: e.id,
          title: e.title,
          date: e.event_date,
          end: eventEnd(e),
          label: rangeLabel(e, fmtDate),
          start_time: e.start_time,
          end_time: e.end_time,
          kind: e.kind,
          trade_id: e.trade_id,
          tradeLabel: e.trade_id ? tradeName(ws, e.trade_id) : null,
          source: { type: "event" as const, id: e.id },
        })),
        ...ws.tasks.flatMap((t) => {
          const range = taskRange(t);
          if (!range) return [];
          return [
            {
              id: t.id,
              title: t.title,
              date: range.event_date,
              end: range.end_date,
              label: rangeLabel(range, fmtDate),
              start_time: null,
              kind: "aufgabe" as const,
              trade_id: t.trade_id,
              tradeLabel: t.trade_id ? tradeName(ws, t.trade_id) : null,
              source: { type: "task" as const, id: t.id },
              done: t.status === "erledigt",
              deadline: t.due_date,
            },
          ];
        }),
        ...offerDeadlines(ws.offers).map((e) => ({
          id: e.id,
          title: e.title,
          date: e.event_date,
          end: e.event_date,
          label: fmtDate(e.event_date),
          start_time: null,
          kind: e.kind,
          trade_id: e.trade_id,
          tradeLabel: e.trade_id ? tradeName(ws, e.trade_id) : null,
          source: { type: "offer" as const, id: e.offer_id },
          deadline: e.event_date,
        })),
      ].sort(
        (a, b) =>
          a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""),
      ),
    [ws],
  );

  const editEvent = (id: string) => {
    const e = ws.events.find((x) => x.id === id);
    if (e) setDlg({ id, initial: { ...e } });
  };
  const openItem = (item: CalendarItem) => {
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
      <CalendarViews
        items={items}
        selected={selected}
        onSelect={setSelected}
        onOpen={openItem}
        onCreate={(date, time) =>
          setDlg({ initial: { kind: "termin", event_date: date, start_time: time ?? null } })
        }
      />
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
