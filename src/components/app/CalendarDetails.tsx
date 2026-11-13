import { useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { tr } from "@/i18n";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { TaskChecklist } from "./TaskChecklist";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { fmtDate, eur } from "@/lib/format";
import { rangeLabel } from "@/lib/events";
import { tradeName } from "@/lib/options";
import { isOverdue } from "@/lib/calc";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "@/lib/calendar-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OFFER_STATUS, PRIORITY, TASK_STATUS } from "./ui-bits";

export type CalendarSource = CalendarItem["source"];

export function CalendarDetails({
  source,
  onClose,
  onEdit,
}: {
  source: CalendarSource | null;
  onClose: () => void;
  onEdit: (source: CalendarSource) => void;
}) {
  const { ws } = useWorkspace();
  const { update, remove } = useMutations();
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const task = source?.type === "task" ? ws.tasks.find((row) => row.id === source.id) : undefined;
  const assignees = useTaskAssignees();
  const fields: { label: string; value: ReactNode }[] = [];
  let title = "";
  let notes: string | null = null;
  const add = (label: string, value: ReactNode) => {
    if (value != null && value !== "") fields.push({ label: tr(label), value });
  };
  if (source?.type === "event") {
    const event = ws.events.find((row) => row.id === source.id);
    if (event) {
      title = event.title;
      notes = event.notes;
      add(
        "calendar.type",
        tr(
          { termin: "shared.appointment", frist: "shared.deadline", arbeit: "shared.work" }[
            event.kind
          ],
        ),
      );
      add("shared.date", rangeLabel(event, fmtDate));
      if (event.trade_id) add("shared.trade", tradeName(ws, event.trade_id));
    }
  } else if (source?.type === "task") {
    const task = ws.tasks.find((row) => row.id === source.id);
    if (task) {
      title = task.title;
      notes = task.notes;
      add("shared.status", TASK_STATUS[task.status]!.label);
      add("quick_actions.priority", PRIORITY[task.priority]!.label);
      if (task.start_date) add("calendar.start_date", fmtDate(task.start_date));
      if (task.due_date) {
        const overdue = isOverdue(task.due_date, task.status === "erledigt");
        add(
          "quick_actions.due",
          <span className={cn(overdue && "font-medium text-destructive")}>
            {overdue && tr("tasks.overdue")}
            {fmtDate(task.due_date)}
          </span>,
        );
      }
      if (task.phase) add("tasks.phase", tr(task.phase));
      if (task.trade_id) add("shared.trade", tradeName(ws, task.trade_id));
      if (task.assignee_id) {
        add("tasks.assignee", assignees.data?.find((user) => user.id === task.assignee_id)?.label);
      }
      if (task.cost_item_id)
        add("shared.cost_item", ws.cost_items.find((row) => row.id === task.cost_item_id)?.title);
      if (task.document_id)
        add("shared.document", ws.documents.find((row) => row.id === task.document_id)?.name);
    }
  } else if (source?.type === "offer") {
    const offer = ws.offers.find((row) => row.id === source.id);
    if (offer) {
      title = [offer.contractor, offer.title].filter(Boolean).join(" – ");
      notes = offer.notes;
      add("shared.status", OFFER_STATUS[offer.status]!.label);
      if (offer.valid_until) add("quotes.valid_until", fmtDate(offer.valid_until));
      add("shared.amount", eur(offer.amount));
      if (offer.offer_date) add("quotes.quote_date", fmtDate(offer.offer_date));
      if (offer.trade_id) add("shared.trade", tradeName(ws, offer.trade_id));
      if (offer.cost_item_id)
        add("shared.cost_item", ws.cost_items.find((row) => row.id === offer.cost_item_id)?.title);
      if (offer.contact_id)
        add("quotes.contact", ws.contacts.find((row) => row.id === offer.contact_id)?.name);
      if (offer.document_id)
        add("shared.document", ws.documents.find((row) => row.id === offer.document_id)?.name);
    }
  }
  return (
    <Dialog
      open={!!source && !!title}
      onOpenChange={(open) => !open && !deletingRef.current && onClose()}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="pr-6 leading-snug [overflow-wrap:anywhere]">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-1">
          <dl className="grid gap-4 sm:grid-cols-2">
            {fields.map(({ label, value }) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
            {notes && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">{tr("shared.notes")}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                  {notes}
                </dd>
              </div>
            )}
          </dl>
          {task && (
            <TaskChecklist
              key={task.id}
              value={task.checklist}
              editable={false}
              addable
              disabled={update.isPending || deleting}
              onChange={(checklist) =>
                update.mutate({ table: "tasks", id: task.id, patch: { checklist } })
              }
            />
          )}
          {source?.type === "task" && assignees.isError && (
            <p role="alert" className="text-sm text-destructive">
              {tr("tasks.assignees_load_failed")}
            </p>
          )}
          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => !deletingRef.current && onClose()}
            >
              {tr("shared.close")}
            </Button>
            {task && (
              <Button
                type="button"
                variant="destructive"
                disabled={deleting || update.isPending}
                onClick={() => {
                  if (deletingRef.current || !confirm(tr("tasks.delete_task"))) return;
                  deletingRef.current = true;
                  setDeleting(true);
                  remove.mutate(
                    { table: "tasks", id: task.id },
                    {
                      onSuccess: onClose,
                      onSettled: () => {
                        deletingRef.current = false;
                        setDeleting(false);
                      },
                    },
                  );
                }}
              >
                {tr("shared.delete")}
              </Button>
            )}
            <Button
              disabled={deleting}
              onClick={() => source && !deletingRef.current && onEdit(source)}
            >
              <Pencil data-icon="inline-start" />
              {tr("shared.edit")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
