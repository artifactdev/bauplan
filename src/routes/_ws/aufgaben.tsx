import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useMutations, useWorkspace } from "@/hooks/use-workspace";
import { isOverdue } from "@/lib/calc";
import { fmtDate } from "@/lib/format";
import { tradeName } from "@/lib/options";
import { PHASES, type Task } from "@/lib/schema";
import { Bar, Empty, PageHeader, Panel, Pill, PRIORITY, TASK_STATUS } from "@/components/app/ui-bits";
import { QuickTask } from "@/components/app/quick-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [groupBy, setGroupBy] = useState<"phase" | "trade" | "status">("phase");
  const [filter, setFilter] = useState<"open" | "all" | "overdue">("open");
  const [dlg, setDlg] = useState<{ id?: string; initial?: Record<string, unknown> } | null>(null);

  const done = ws.tasks.filter((t) => t.status === "erledigt").length;

  const groups = useMemo(() => {
    const list = ws.tasks
      .filter((t) => (filter === "open" ? t.status !== "erledigt" : filter === "overdue" ? isOverdue(t.due_date, t.status === "erledigt") : true))
      .sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
    const keyOf = (t: Task) => (groupBy === "phase" ? (t.phase ? tr(t.phase) : tr("tasks.no_phase")) : groupBy === "trade" ? tradeName(ws, t.trade_id) : TASK_STATUS[t.status]!.label);
    const order = groupBy === "phase" ? [...PHASES, "Ohne Phase"].map((p) => tr(p)) : groupBy === "status" ? ["Offen", "In Arbeit", "Erledigt"].map((p) => tr(p)) : [...ws.trades.map((t) => t.name), "–"];
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
      <PageHeader title={tr("shared.tasks")} subtitle={`${done} von ${ws.tasks.length} erledigt`} actions={<Button size="sm" onClick={() => setDlg({})}><Plus className="h-4 w-4" /> {tr("shared.task")}</Button>} />
      <div className="mb-4"><Bar value={done} max={ws.tasks.length} /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="open">{tr("tasks.open_only")}</SelectItem><SelectItem value="overdue">{tr("tasks.overdue_2")}</SelectItem><SelectItem value="all">{tr("shared.all")}</SelectItem></SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="phase">{tr("tasks.phase")}</SelectItem><SelectItem value="trade">{tr("tasks.trade")}</SelectItem><SelectItem value="status">{tr("tasks.status")}</SelectItem></SelectContent>
        </Select>
      </div>

      <div className="grid gap-4">
        {groups.map(([label, tasks]) => (
          <Panel key={label} title={`${label} (${tasks.length})`}>
            <ul className="divide-y">
              {tasks.map((t) => {
                const isDone = t.status === "erledigt";
                const od = isOverdue(t.due_date, isDone);
                const doc = ws.documents.find((d) => d.id === t.document_id);
                return (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 py-2.5">
                    <Checkbox className="mt-0.5" checked={isDone} aria-label={tr("shared.done")} onCheckedChange={(c) => update.mutate({ table: "tasks", id: t.id, patch: { status: c ? "erledigt" : "offen" } })} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${isDone ? "text-muted-foreground line-through" : "font-medium"}`}>{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {groupBy !== "trade" && t.trade_id && <span>{tradeName(ws, t.trade_id)}</span>}
                        {groupBy !== "status" && <Pill tone={TASK_STATUS[t.status]!.tone}>{TASK_STATUS[t.status]!.label}</Pill>}
                        <Pill tone={PRIORITY[t.priority]!.tone}>{PRIORITY[t.priority]!.label}</Pill>
                        {doc && <span className="inline-flex items-center gap-0.5"><FileText className="h-3 w-3" />{doc.name}</span>}
                      </div>
                      {t.notes && <p className="mt-1 text-xs text-muted-foreground">{t.notes}</p>}
                    </div>
                    <span className={`tabular text-xs ${od ? "font-medium text-destructive" : "text-muted-foreground"}`}>{od ? tr("tasks.overdue") : ""}{fmtDate(t.due_date)}</span>
                    <div className="flex">
                      <Button size="icon" variant="ghost" aria-label={tr("shared.edit")} onClick={() => setDlg({ id: t.id, initial: { ...t } })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={tr("shared.delete")} onClick={() => confirm(tr("tasks.delete_task")) && remove.mutate({ table: "tasks", id: t.id })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
        {!groups.length && <Empty>{tr("tasks.no_tasks_view")}</Empty>}
      </div>
      <QuickTask open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} initial={dlg?.initial} editId={dlg?.id} />
    </>
  );
}
