import { tr } from "@/i18n";
import { usePushTarget } from "@/hooks/use-push-target";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, FileText, Plus, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { isOverdue } from "@/lib/calc";
import { tradeName } from "@/lib/options";
import { parseTaskChecklist } from "@/lib/tasks";
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
import { Switch } from "@/components/ui/switch";
import { TaskChecklist } from "@/components/app/TaskChecklist";
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
  const { update } = useMutations();
  const assigneesQuery = useTaskAssignees();
  const assignees = new Map((assigneesQuery.data ?? []).map((user) => [user.id, user.label]));
  const [groupBy, setGroupBy] = useState<"phase" | "trade" | "status">("phase");
  const [filter, setFilter] = useState<"open" | "all" | "overdue">("open");
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Map<string, boolean>>(new Map());
  const [addingSubtasks, setAddingSubtasks] = useState<Set<string>>(new Set());
  const [subtaskDrafts, setSubtaskDrafts] = useState<Map<string, string>>(new Map());
  const subtaskInputs = useRef(new Map<string, HTMLInputElement>());
  const addButtons = useRef(new Map<string, HTMLButtonElement>());
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
    <div className="[&>div:first-child]:mb-4">
      <PageHeader
        title={tr("shared.tasks")}
        subtitle={
          ws.tasks.length
            ? tr("tasks.progress_summary", { done, total: ws.tasks.length })
            : tr("tasks.no_tasks_yet")
        }
        actions={
          <Button size="sm" onClick={() => setDlg({})}>
            <Plus data-icon="inline-start" /> {tr("shared.task")}
          </Button>
        }
      />
      {ws.tasks.length > 0 && (
        <div className="mb-3">
          <Bar value={done} max={ws.tasks.length} />
        </div>
      )}
      {assigneesQuery.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {tr("tasks.assignees_load_failed")}
        </p>
      )}
      {ws.tasks.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger
              className="min-h-11 min-w-0 flex-1 sm:w-40 sm:flex-none"
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
              className="min-h-11 min-w-0 flex-1 sm:w-48 sm:flex-none"
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
          <label
            htmlFor="show-subtasks"
            className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-sm sm:ml-auto sm:w-auto"
          >
            <Switch
              id="show-subtasks"
              checked={showSubtasks}
              disabled={update.isPending}
              onCheckedChange={(checked) => {
                setShowSubtasks(checked);
                setExpandedTasks(new Map());
                setAddingSubtasks(new Set());
              }}
            />
            {tr("tasks.show_subtasks")}
          </label>
        </div>
      )}

      <div className="grid gap-3">
        {groups.map(([label, tasks]) => (
          <Panel
            key={label}
            title={`${label} (${tasks.length})`}
            className="p-3 [--shadow-card:none] md:p-4 [&>div:first-child]:mb-1"
          >
            <ul className="divide-y">
              {tasks.map((t) => {
                const isDone = t.status === "erledigt";
                const od = isOverdue(t.due_date, isDone);
                const doc = ws.documents.find((d) => d.id === t.document_id);
                const subtasks = parseTaskChecklist(t.checklist);
                const openSubtasks = subtasks.filter((item) => !item.done).length;
                const explicitlyExpanded = expandedTasks.get(t.id) ?? showSubtasks;
                const expanded = explicitlyExpanded || addingSubtasks.has(t.id);
                return (
                  <li
                    key={t.id}
                    className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-2 py-1.5"
                  >
                    <label
                      htmlFor={`task-done-${t.id}`}
                      className="flex size-11 cursor-pointer items-center justify-center"
                    >
                      <Checkbox
                        id={`task-done-${t.id}`}
                        className="size-5"
                        checked={isDone}
                        disabled={update.isPending}
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
                    <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-4">
                      <div className="min-w-0">
                        <button
                          type="button"
                          aria-label={t.title}
                          aria-describedby={
                            t.priority === "hoch" ? `task-priority-${t.id}` : undefined
                          }
                          onClick={() => setDetail({ type: "task", id: t.id })}
                          className={cn(
                            "min-h-11 w-full rounded-sm py-2 text-left text-sm font-medium leading-6 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                            isDone && "text-muted-foreground line-through",
                          )}
                        >
                          {t.title}
                          {t.priority === "hoch" && (
                            <CircleAlert
                              aria-hidden="true"
                              className="ml-1.5 inline size-4 align-text-bottom text-task-priority-high"
                            />
                          )}
                        </button>
                        {t.priority === "hoch" && (
                          <span id={`task-priority-${t.id}`} className="sr-only">
                            {tr("tasks.priority_indicator", {
                              priority: PRIORITY[t.priority]!.label,
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 lg:contents">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground lg:col-start-1 lg:row-start-2 [&>span]:max-w-full [&>span]:whitespace-normal [&>span]:[overflow-wrap:anywhere]">
                          {groupBy !== "trade" && t.trade_id && (
                            <span>{tradeName(ws, t.trade_id)}</span>
                          )}
                          {od && <Pill tone="danger">{tr("tasks.overdue_label")}</Pill>}
                          {t.assignee_id && assigneesQuery.isFetched && (
                            <span>
                              {assignees.get(t.assignee_id) ?? tr("tasks.assignee_unavailable")}
                            </span>
                          )}
                          {t.notes && (
                            <span
                              role="img"
                              aria-label={tr("tasks.has_notes")}
                              title={tr("tasks.has_notes")}
                            >
                              <StickyNote className="size-3.5" aria-hidden="true" />
                            </span>
                          )}
                          {doc && (
                            <span
                              role="img"
                              aria-label={tr("tasks.has_document")}
                              title={tr("tasks.has_document")}
                            >
                              <FileText className="size-3.5" aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        <div className="ml-auto flex max-w-full shrink-0 items-center lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
                          {subtasks.length > 0 && (
                            <button
                              type="button"
                              className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                              aria-label={tr("tasks.subtasks_summary", {
                                open: openSubtasks,
                                total: subtasks.length,
                              })}
                              aria-expanded={expanded}
                              aria-controls={`task-subtasks-${t.id}`}
                              title={tr("tasks.subtasks_summary", {
                                open: openSubtasks,
                                total: subtasks.length,
                              })}
                              disabled={update.isPending}
                              onClick={() => {
                                setAddingSubtasks((ids) => {
                                  const next = new Set(ids);
                                  next.delete(t.id);
                                  return next;
                                });
                                setExpandedTasks((ids) => new Map(ids).set(t.id, !expanded));
                              }}
                            >
                              {expanded ? (
                                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                              )}
                              <span className="min-w-0 tabular">
                                {tr("tasks.subtasks_open", {
                                  open: openSubtasks,
                                  total: subtasks.length,
                                })}
                              </span>
                            </button>
                          )}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title={tr("task-checklist.add_subtask")}
                            aria-label={tr("task-checklist.add_subtask")}
                            disabled={update.isPending}
                            ref={(button) => {
                              if (button) addButtons.current.set(t.id, button);
                              else addButtons.current.delete(t.id);
                            }}
                            onClick={() => {
                              setAddingSubtasks((ids) => new Set(ids).add(t.id));
                              subtaskInputs.current.get(t.id)?.focus();
                            }}
                          >
                            <Plus />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div
                      id={`task-subtasks-${t.id}`}
                      hidden={!expanded}
                      className="col-start-2 min-w-0 border-l pl-3 pt-2"
                    >
                      {expanded && (
                        <TaskChecklist
                          value={t.checklist}
                          editable={false}
                          addable
                          autoFocus={addingSubtasks.has(t.id)}
                          compact
                          draft={subtaskDrafts.get(t.id) ?? ""}
                          onDraftChange={(draft) =>
                            setSubtaskDrafts((drafts) => new Map(drafts).set(t.id, draft))
                          }
                          inputRef={(input) => {
                            if (input) subtaskInputs.current.set(t.id, input);
                            else subtaskInputs.current.delete(t.id);
                          }}
                          disabled={update.isPending}
                          onChange={(checklist) => {
                            const change = {
                              table: "tasks" as const,
                              id: t.id,
                              patch: { checklist },
                            };
                            if (parseTaskChecklist(checklist).length <= subtasks.length) {
                              update.mutate(change);
                              return;
                            }
                            update.mutate(change, {
                              onSuccess: () => {
                                setSubtaskDrafts((drafts) => {
                                  const next = new Map(drafts);
                                  next.delete(t.id);
                                  return next;
                                });
                                setAddingSubtasks((ids) => {
                                  const next = new Set(ids);
                                  next.delete(t.id);
                                  return next;
                                });
                                if (!explicitlyExpanded) addButtons.current.get(t.id)?.focus();
                                toast.success(tr("task-checklist.created"));
                              },
                            });
                          }}
                        />
                      )}
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
                  <Plus data-icon="inline-start" /> {tr("tasks.create_first_task")}
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
    </div>
  );
}
