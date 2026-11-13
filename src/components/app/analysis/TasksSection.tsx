import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { tr } from "@/i18n";
import { taskProgress, timelineItems } from "@/lib/analysis";
import type { Task } from "@/lib/schema";
import { fmtDate } from "@/lib/format";
import { Panel } from "@/components/app/ui-bits";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartBox, Legend, MoneyTooltip } from "./charts";
import { ChartCard, DataTable, useLabels, type TableData } from "./shared";
import type { AnalysisContext } from "./types";

type Dimension = "phase" | "trade" | "assignee";
const MAX_TIMELINE_ROWS = 24;

const dayNumber = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);

function Timeline({ ctx }: { ctx: AnalysisContext }) {
  const items = timelineItems(ctx.ws, ctx.filters).slice(0, MAX_TIMELINE_ROWS);
  if (!items.length)
    return <p className="text-sm text-muted-foreground">{tr("analysis.no_data")}</p>;
  const start = Math.min(...items.map((item) => dayNumber(item.start)), dayNumber(ctx.today));
  const end = Math.max(...items.map((item) => dayNumber(item.end)), dayNumber(ctx.today));
  const span = Math.max(end - start, 1);
  const pos = (value: number) => ((value - start) / span) * 100;
  const colors = { task: "var(--chart-1)", event: "var(--chart-3)", deadline: "var(--chart-4)" };
  const kindLabels = {
    task: tr("analysis.kind_task"),
    event: tr("analysis.kind_event"),
    deadline: tr("analysis.kind_deadline"),
  };
  return (
    <div>
      <ul className="grid gap-1.5">
        {items.map((item) => {
          const from = pos(dayNumber(item.start));
          const width = Math.max(pos(dayNumber(item.end)) - from, 1.5);
          return (
            <li
              key={`${item.kind}-${item.id}`}
              className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-2 text-xs sm:grid-cols-[minmax(0,12rem)_1fr]"
            >
              <span
                className={`truncate ${item.done ? "text-muted-foreground line-through" : ""}`}
                title={item.title}
              >
                {item.title}
              </span>
              <span className="relative h-5 rounded bg-muted/60">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-px bg-foreground/40"
                  style={{ left: `${pos(dayNumber(ctx.today))}%` }}
                />
                <span
                  className="absolute inset-y-0.5 rounded"
                  style={{
                    left: `${from}%`,
                    width: `${Math.min(width, 100 - from)}%`,
                    backgroundColor: colors[item.kind],
                    opacity: item.done ? 0.4 : 1,
                  }}
                />
                <span className="sr-only">{`${kindLabels[item.kind]}: ${fmtDate(item.start)} – ${fmtDate(item.end)}`}</span>
              </span>
            </li>
          );
        })}
        <li
          aria-hidden="true"
          className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]"
        >
          <span />
          <span className="relative h-4 text-[10px] text-muted-foreground">
            <span
              className="absolute -translate-x-1/2"
              style={{ left: `${pos(dayNumber(ctx.today))}%` }}
            >
              ▲ {tr("analysis.today")}
            </span>
          </span>
        </li>
      </ul>
      <Legend
        items={[
          { label: kindLabels.task, color: colors.task },
          { label: kindLabels.event, color: colors.event },
          { label: kindLabels.deadline, color: colors.deadline },
        ]}
      />
    </div>
  );
}

export function TasksSection({ ctx }: { ctx: AnalysisContext }) {
  const { ws, tasks, today, assignees } = ctx;
  const labels = useLabels(ws);
  const [dimension, setDimension] = useState<Dimension>("phase");
  const keyOf = (task: Task) =>
    dimension === "phase" ? task.phase : dimension === "trade" ? task.trade_id : task.assignee_id;
  const nameOf = (key: string) =>
    dimension === "phase"
      ? labels.phase(key)
      : dimension === "trade"
        ? labels.trade(key)
        : key === "__none"
          ? tr("analysis.none")
          : (assignees.get(key) ?? tr("tasks.assignee_unavailable"));
  const groups = taskProgress(tasks, keyOf, today).map((group) => ({
    ...group,
    name: nameOf(group.key),
  }));
  const table: TableData = {
    columns: [
      {
        key: "name",
        label:
          dimension === "phase"
            ? tr("analysis.phase")
            : dimension === "trade"
              ? tr("shared.trade")
              : tr("analysis.assignee"),
      },
      { key: "open", label: tr("shared.open"), kind: "int" },
      { key: "progress", label: tr("shared.progress"), kind: "int" },
      { key: "done", label: tr("shared.done"), kind: "int" },
      { key: "overdue", label: tr("shared.overdue"), kind: "int" },
      { key: "total", label: tr("shared.total"), kind: "int" },
    ],
    rows: groups,
  };
  const overdueTasks = tasks
    .filter((task) => task.status !== "erledigt" && task.due_date && task.due_date < today)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const overdueTable: TableData = {
    columns: [
      { key: "due", label: tr("invoices_table.due") },
      { key: "title", label: tr("shared.description") },
      { key: "assignee", label: tr("analysis.assignee") },
      { key: "phase", label: tr("analysis.phase") },
    ],
    rows: overdueTasks.map((task) => ({
      due: fmtDate(task.due_date),
      title: task.title,
      assignee: task.assignee_id ? (assignees.get(task.assignee_id) ?? "–") : "–",
      phase: task.phase ? tr(task.phase) : "–",
    })),
  };
  const dimensionLabels: Record<Dimension, string> = {
    phase: tr("analysis.phase"),
    trade: tr("shared.trade"),
    assignee: tr("analysis.assignee"),
  };
  const palette = { open: "var(--chart-2)", progress: "var(--chart-3)", done: "var(--success)" };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        className="lg:col-span-2"
        title={tr("analysis.task_progress")}
        exportName="aufgaben"
        table={table}
        summary={groups.map((group) => `${group.name}: ${group.done}/${group.total}`).join("; ")}
        controls={
          <Select value={dimension} onValueChange={(value) => setDimension(value as Dimension)}>
            <SelectTrigger className="h-8 w-40" aria-label={tr("analysis.group_by")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(dimensionLabels) as Dimension[]).map((item) => (
                <SelectItem key={item} value={item}>
                  {dimensionLabels[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        chart={
          <div>
            <ChartBox height={Math.max(200, groups.length * 48)}>
              <BarChart data={groups} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={
                    <MoneyTooltip
                      format={(value) => String(value)}
                      names={{
                        open: tr("shared.open"),
                        progress: tr("shared.progress"),
                        done: tr("shared.done"),
                      }}
                    />
                  }
                />
                <Bar isAnimationActive={false} dataKey="done" stackId="t" fill={palette.done} />
                <Bar
                  isAnimationActive={false}
                  dataKey="progress"
                  stackId="t"
                  fill={palette.progress}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="open"
                  stackId="t"
                  fill={palette.open}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ChartBox>
            <Legend
              items={[
                { label: tr("shared.done"), color: palette.done },
                { label: tr("shared.progress"), color: palette.progress },
                { label: tr("shared.open"), color: palette.open },
              ]}
            />
          </div>
        }
      />

      <Panel className="lg:col-span-2" title={tr("analysis.timeline")}>
        <Timeline ctx={ctx} />
      </Panel>

      <Panel className="lg:col-span-2" title={tr("analysis.overdue_tasks")}>
        {overdueTasks.length ? (
          <DataTable data={overdueTable} />
        ) : (
          <p className="text-sm text-muted-foreground">{tr("analysis.no_overdue_tasks")}</p>
        )}
      </Panel>
    </div>
  );
}
