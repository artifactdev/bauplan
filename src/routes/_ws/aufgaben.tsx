import { tr } from "@/i18n";
import { usePushTarget } from "@/hooks/use-push-target";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { isOverdue } from "@/lib/calc";
import { fmtDate } from "@/lib/format";
import { tradeName } from "@/lib/options";
import { taskRange } from "@/lib/tasks";
import { rangeLabel } from "@/lib/events";
import { cn } from "@/lib/utils";
import { PHASES, type Task } from "@/lib/schema";
import {
  Bar,
  Empty,
  PageHeader,
  Panel,
  Pill,
  PRIORITY,
  TASK_STATUS,
} from "@/components/app/ui-bits";
import { QuickTask } from "@/components/app/quick-actions";
import { CalendarDetails, type CalendarSource } from "@/components/app/CalendarDetails";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_ws/aufgaben")({
  head: () => ({
    meta: [
      { title: tr("tasks.tasks_bauplan") },
      { name: "description", content: tr("tasks.plan_prioritize_tick_off") },
      { property: "og:title", content: tr("tasks.tasks_bauplan") },
      { property: "og:description", content: tr("tasks.plan_tick_off_renovation") },
    ],
  }),
  component: TasksPage,
});

const PRIO_ORDER = { hoch: 0, mittel: 1, niedrig: 2 } as const;

function TasksPage() {
  const { ws } = useWorkspace();
  const { update, remove } = useMutations();
  const assigneesQuery = useTaskAssignees();
  const assignees = new Map((assigneesQuery.data ?? []).map((user) => [user.id, user.label]));
  const [groupBy, setGroupBy] = useState<"phase" | "trade" | "status">("phase");
  const [filter, setFilter] = useState<"open" | "all" | "overdue">("open");
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("aktion") === "neu"
      ? {}
      : null,
  );

  const [detail, setDetail] = useState<CalendarSource | null>(null);
  usePushTarget(ws.tasks, (task) => setDetail({ type: "task", id: task.id }));
  const done = ws.tasks.filter((t) => t.status === "erledigt").length;

  const groups = useMemo(() => {
    const list = ws.tasks
      .filter((t) =>
        filter === "open"
          ? t.status !== "erledigt"
          : filter === "overdue"
            ? isOverdue(t.due_date, t.status === "erledigt")
            : true,
      )
      .sort(
        (a, b) =>
          PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
          (a.due_date ?? "9").localeCompare(b.due_date ?? "9"),
      );
    const keyOf = (t: Task) =>
      groupBy === "phase"
        ? t.phase
          ? tr(t.phase)
          : tr("tasks.no_phase")
        : groupBy === "trade"
          ? tradeName(ws, t.trade_id)
          : TASK_STATUS[t.status]!.label;
    const order =
      groupBy === "phase"
        ? [...PHASES, "Ohne Phase"].map((p) => tr(p))
        : groupBy === "status"
          ? ["Offen", "In Arbeit", "Erledigt"].map((p) => tr(p))
          : [...ws.trades.map((t) => t.name), "–"];
    const m = new Map<string, Task[]>();
    for (const t of list) {
      const k = keyOf(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [ws, groupBy, filter]);

  return (
    <>
      <PageHeader
        title={tr("shared.tasks")}
        subtitle={
          ws.tasks.length
            ? tr("tasks.progress_summary", { done, total: ws.tasks.length })
            : tr("tasks.no_tasks_yet")
        }
        actions={
          <Button size="sm" onClick={() => setDlg({})}>
            <Plus className="h-4 w-4" /> {tr("shared.task")}
          </Button>
        }
      />
      {ws.tasks.length > 0 && (
        <div className="mb-4">
          <Bar value={done} max={ws.tasks.length} />
        </div>
      )}
      {assigneesQuery.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {tr("tasks.assignees_load_failed")}
        </p>
      )}
      {ws.tasks.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger
              className="min-w-0 flex-1 sm:w-40 sm:flex-none"
              aria-label={tr("shared.status")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{tr("tasks.open_only")}</SelectItem>
              <SelectItem value="overdue">{tr("tasks.overdue_2")}</SelectItem>
              <SelectItem value="all">{tr("shared.all")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
            <SelectTrigger
              className="min-w-0 flex-1 sm:w-48 sm:flex-none"
              aria-label={tr("tasks.group_by")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="phase">{tr("tasks.phase")}</SelectItem>
              <SelectItem value="trade">{tr("tasks.trade")}</SelectItem>
              <SelectItem value="status">{tr("tasks.status")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4">
        {groups.map(([label, tasks]) => (
          <Panel key={label} title={`${label} (${tasks.length})`}>
            <ul className="divide-y">
              {tasks.map((t) => {
                const isDone = t.status === "erledigt";
                const od = isOverdue(t.due_date, isDone);
                const range = taskRange(t);
                const doc = ws.documents.find((d) => d.id === t.document_id);
                return (
                  <li
                    key={t.id}
                    className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-2 gap-y-2 py-4 sm:gap-x-3"
                  >
                    <label
                      htmlFor={`task-done-${t.id}`}
                      className="flex size-11 cursor-pointer items-center justify-center"
                    >
                      <Checkbox
                        id={`task-done-${t.id}`}
                        className="size-5"
                        checked={isDone}
                        aria-label={`${tr("shared.done")}: ${t.title}`}
                        onCheckedChange={(c) =>
                          update.mutate({
                            table: "tasks",
                            id: t.id,
                            patch: { status: c ? "erledigt" : "offen" },
                          })
                        }
                      />
                    </label>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setDetail({ type: "task", id: t.id })}
                        className={cn(
                          "min-h-11 w-full rounded-sm py-2 text-left text-sm font-medium leading-6 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          isDone && "text-muted-foreground line-through",
                        )}
                      >
                        {t.title}
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground [&>span]:max-w-full [&>span]:whitespace-normal [&>span]:[overflow-wrap:anywhere]">
                        {groupBy !== "trade" && t.trade_id && (
                          <span>{tradeName(ws, t.trade_id)}</span>
                        )}
                        {groupBy !== "status" && (
                          <Pill tone={TASK_STATUS[t.status]!.tone}>
                            {TASK_STATUS[t.status]!.label}
                          </Pill>
                        )}
                        <Pill tone={PRIORITY[t.priority]!.tone}>{PRIORITY[t.priority]!.label}</Pill>
                        {t.assignee_id && assigneesQuery.isFetched && (
                          <Pill tone="primary">
                            {assignees.get(t.assignee_id) ?? tr("tasks.assignee_unavailable")}
                          </Pill>
                        )}
                        {doc && (
                          <span className="inline-flex min-w-0 items-start gap-1">
                            <FileText className="mt-0.5 size-3 shrink-0" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">{doc.name}</span>
                          </span>
                        )}
                      </div>
                      {t.notes && (
                        <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          {t.notes}
                        </p>
                      )}
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 sm:col-span-1 sm:col-start-2">
                      {range && (
                        <span
                          className={cn(
                            "min-w-0 tabular text-xs leading-5",
                            od ? "font-medium text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {od ? tr("tasks.overdue") : ""}
                          {rangeLabel(range, fmtDate)}
                        </span>
                      )}
                      <div className="ml-auto flex shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={tr("shared.edit")}
                          onClick={() => setDlg({ id: t.id, initial: { ...t } })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={tr("shared.delete")}
                          onClick={() =>
                            confirm(tr("tasks.delete_task")) &&
                            remove.mutate({ table: "tasks", id: t.id })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
        {!groups.length && (
          <Empty>
            {ws.tasks.length ? (
              tr("tasks.no_tasks_view")
            ) : (
              <div className="grid justify-items-center gap-3">
                <span>{tr("tasks.no_tasks_yet")}</span>
                <Button size="sm" onClick={() => setDlg({})}>
                  <Plus className="h-4 w-4" /> {tr("tasks.create_first_task")}
                </Button>
              </div>
            )}
          </Empty>
        )}
      </div>
      {detail && (
        <CalendarDetails
          source={detail}
          onClose={() => setDetail(null)}
          onEdit={({ id }) => {
            const task = ws.tasks.find((row) => row.id === id);
            if (task) {
              setDetail(null);
              setDlg({ id, initial: { ...task } });
            }
          }}
        />
      )}
      <QuickTask
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        initial={dlg?.initial}
        editId={dlg?.id}
      />
    </>
  );
}
