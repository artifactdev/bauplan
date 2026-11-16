import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { addDays, differenceInCalendarDays, getISOWeek, startOfWeek } from "date-fns";
import { Check, CircleAlert, Link2, Plus } from "lucide-react";
import { dateKey, lastDay, localDate, rangeLayout, type CalendarItem } from "@/lib/calendar-view";
import { fmtDate, todayISO } from "@/lib/format";
import {
  incomingDependencies,
  parseDependencies,
  prerequisiteState,
  sourceKey,
} from "@/lib/task-dependencies";
import type { Workspace } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PrerequisiteList } from "./TaskPrerequisites";

type Planning = Pick<Workspace, "tasks" | "events" | "trades">;
type Row = { trade: Planning["trades"][number] | null; item?: CalendarItem };
const rowHeight = 76;
const groupHeight = 36;
const dayWidth = 36;

export function ConstructionTimeline({
  items,
  planning,
  selected,
  weeks,
  onWeeksChange,
  onOpen,
  onCreateTask,
  onCreateWork,
}: {
  items: CalendarItem[];
  planning: Planning;
  selected: string;
  weeks: 4 | 12;
  onWeeksChange: (weeks: 4 | 12) => void;
  onOpen: (source: CalendarItem["source"]) => void;
  onCreateTask?: (() => void) | undefined;
  onCreateWork?: (() => void) | undefined;
}) {
  const { t } = useTranslation("construction");
  const [trade, setTrade] = useState("");
  const [completed, setCompleted] = useState(true);
  const [linked, setLinked] = useState<CalendarItem["source"] | null>(null);
  const today = todayISO();
  const first = startOfWeek(localDate(selected), { weekStartsOn: 1 });
  const days = Array.from({ length: weeks * 7 }, (_, index) => dateKey(addDays(first, index)));
  const work = items.filter(
    (item) =>
      (item.source.type === "task" || item.kind === "arbeit") &&
      (!trade || item.trade_id === trade) &&
      (completed || !item.done),
  );
  const visible = rangeLayout(work, days).map((segment) => segment.item);
  const groupItems = (group: Planning["trades"][number] | null) =>
    visible.filter((item) =>
      group
        ? item.trade_id === group.id
        : !planning.trades.some((trade) => trade.id === item.trade_id),
    );
  const groups = [...planning.trades, null]
    .filter((group) =>
      visible.some((item) =>
        group
          ? item.trade_id === group.id
          : !planning.trades.some((trade) => trade.id === item.trade_id),
      ),
    )
    .sort((a, b) => {
      const firstDate = (group: typeof a) =>
        groupItems(group)
          .map((item) => item.date)
          .sort()[0] ?? "";
      return firstDate(a).localeCompare(firstDate(b));
    });
  const rows: Row[] = groups.flatMap((group) => [
    { trade: group },
    ...visible
      .filter((item) =>
        group
          ? item.trade_id === group.id
          : !planning.trades.some((trade) => trade.id === item.trade_id),
      )
      .map((item) => ({ trade: group, item })),
  ]);
  const rowOffset = (index: number) =>
    rows.slice(0, index).reduce((height, row) => height + (row.item ? rowHeight : groupHeight), 0);
  const selectedTask =
    linked?.type === "task" ? planning.tasks.find((task) => task.id === linked.id) : undefined;
  const edges = planning.tasks
    .flatMap((task) =>
      parseDependencies(task.dependencies).map((dependency) => ({
        from: sourceKey(dependency),
        to: `task:${task.id}`,
      })),
    )
    .filter(
      (edge) =>
        linked &&
        (edge.from ===
          sourceKey({ source: linked.type === "offer" ? "task" : linked.type, id: linked.id }) ||
          edge.to === `${linked.type}:${linked.id}`),
    );
  const related = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const bounds = (item: CalendarItem) => ({
    start: Math.max(0, differenceInCalendarDays(localDate(item.date), first)),
    end: Math.min(days.length, differenceInCalendarDays(localDate(lastDay(item)), first) + 1),
  });
  const undated = planning.tasks.filter(
    (task) =>
      !task.start_date &&
      !task.due_date &&
      (!trade || task.trade_id === trade) &&
      (completed || task.status !== "erledigt"),
  );
  const dependents =
    linked && linked.type !== "offer"
      ? incomingDependencies(planning.tasks, { source: linked.type, id: linked.id })
      : [];
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only">{t("range")}</span>
          <select
            className="min-h-11 rounded-md border bg-background px-2"
            value={weeks}
            onChange={(event) => onWeeksChange(event.target.value === "12" ? 12 : 4)}
          >
            <option value={4}>{t("weeks4")}</option>
            <option value={12}>{t("weeks12")}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only">{t("trade")}</span>
          <select
            className="min-h-11 max-w-44 rounded-md border bg-background px-2"
            value={trade}
            onChange={(event) => setTrade(event.target.value)}
          >
            <option value="">{t("allTrades")}</option>
            {planning.trades.map((trade) => (
              <option key={trade.id} value={trade.id}>
                {trade.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox checked={completed} onCheckedChange={(value) => setCompleted(value === true)} />{" "}
          {t("showCompleted")}
        </label>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {onCreateTask && (
            <Button size="sm" variant="outline" onClick={onCreateTask}>
              <Plus data-icon="inline-start" />
              {t("newTask")}
            </Button>
          )}
          {onCreateWork && (
            <Button size="sm" onClick={onCreateWork}>
              <Plus data-icon="inline-start" />
              {t("newWork")}
            </Button>
          )}
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("parallelHint")}</p>
          <TooltipProvider>
            <div
              className="construction-scroll max-h-[65dvh] overflow-auto"
              role="region"
              aria-label={t("title")}
              tabIndex={0}
            >
              <div
                className="construction-board"
                style={{ "--construction-width": `${days.length * dayWidth}px` } as CSSProperties}
              >
                <div className="construction-header sticky top-0 flex bg-card">
                  <div className="construction-label flex shrink-0 items-center border-b p-3 text-sm font-medium">
                    {t("trade")}
                  </div>
                  <div className="shrink-0">
                    <div className="flex">
                      {Array.from({ length: weeks }, (_, index) => (
                        <div
                          key={index}
                          className="border-b border-l p-2 text-xs font-medium"
                          style={{ width: dayWidth * 7 }}
                        >
                          {t("week", { number: getISOWeek(addDays(first, index * 7)) })} ·{" "}
                          {fmtDate(days[index * 7])}
                        </div>
                      ))}
                    </div>
                    <div className="flex">
                      {days.map((day) => (
                        <div
                          key={day}
                          style={{ width: dayWidth }}
                          className={cn(
                            "border-b border-l py-2 text-center text-xs",
                            localDate(day).getDay() % 6 === 0 && "bg-muted",
                            day === today && "bg-accent font-bold",
                          )}
                          aria-label={
                            day === today ? `${t("today")} ${fmtDate(day)}` : fmtDate(day)
                          }
                        >
                          {localDate(day).getDate()}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="relative">
                  {rows.map((row) => {
                    const item = row.item;
                    const task =
                      item?.source.type === "task"
                        ? planning.tasks.find((task) => task.id === item.id)
                        : undefined;
                    const states = task
                      ? parseDependencies(task.dependencies).map((d) =>
                          prerequisiteState(task, d, planning.tasks, planning.events, today),
                        )
                      : [];
                    const warning = states.find((state) => state.issue);
                    const position = item ? bounds(item) : null;
                    return (
                      <div
                        key={
                          item
                            ? `${item.source.type}:${item.id}`
                            : `trade:${row.trade?.id ?? "none"}`
                        }
                        className={cn("flex border-b", !item && "bg-muted")}
                        style={{ height: item ? rowHeight : groupHeight }}
                      >
                        <div className="construction-label flex shrink-0 items-center gap-2 border-r bg-card px-2">
                          {!item ? (
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                              {row.trade && (
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ background: row.trade.color ?? undefined }}
                                />
                              )}
                              {row.trade?.name ?? t("unassigned")}
                            </h3>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="min-h-11 min-w-0 flex-1 rounded text-left text-xs focus-visible:outline-2 focus-visible:outline-ring"
                                onClick={() => onOpen(item.source)}
                              >
                                {item.title}
                                {warning && (
                                  <span className="block text-destructive">
                                    {t(`${warning.issue}Short`)}
                                  </span>
                                )}
                                {item.done && (
                                  <span className="block text-muted-foreground">{t("done")}</span>
                                )}
                              </button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={t("selectLinks", { title: item.title })}
                                aria-pressed={
                                  linked?.type === item.source.type && linked.id === item.id
                                }
                                onClick={() => setLinked(item.source)}
                              >
                                <Link2 />
                              </Button>
                            </>
                          )}
                        </div>
                        <div
                          className="relative shrink-0"
                          style={{ width: days.length * dayWidth }}
                        >
                          <div className="pointer-events-none absolute inset-0 flex">
                            {days.map((day) => (
                              <div
                                key={day}
                                style={{ width: dayWidth }}
                                className={cn(
                                  "h-full shrink-0 border-l",
                                  localDate(day).getDay() % 6 === 0 && "bg-muted/50",
                                  day === today && "border-l-2 border-l-primary",
                                )}
                              />
                            ))}
                          </div>
                          {item && position && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onOpen(item.source)}
                                  aria-label={`${item.title} · ${item.label}${warning ? ` · ${t(warning.issue!, { date: warning.earliest ? fmtDate(warning.earliest) : "" })}` : ""}`}
                                  data-construction-bar
                                  data-continues-before={item.date < days[0]! || undefined}
                                  data-continues-after={
                                    lastDay(item) > days[days.length - 1]! || undefined
                                  }
                                  className={cn(
                                    "construction-bar absolute top-3 flex h-12 items-center gap-2 rounded-md border bg-accent px-2 text-left text-xs text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring",
                                    item.source.type === "event" && "bg-info-subtle text-info",
                                    warning && "border-destructive",
                                    item.done && "opacity-60",
                                    related.has(`${item.source.type}:${item.id}`) &&
                                      "ring-2 ring-primary",
                                  )}
                                  style={{
                                    left: position.start * dayWidth + 3,
                                    width: Math.max(
                                      30,
                                      (position.end - position.start) * dayWidth - 6,
                                    ),
                                  }}
                                >
                                  {warning ? (
                                    <CircleAlert className="size-4 shrink-0" />
                                  ) : item.done ? (
                                    <Check className="size-4 shrink-0" />
                                  ) : states.length > 0 ? (
                                    <Link2 className="size-4 shrink-0" />
                                  ) : null}
                                  <span className="truncate">
                                    {item.title}
                                    {task && (!task.start_date || !task.due_date) && (
                                      <span className="block text-[10px]">{t("singleDate")}</span>
                                    )}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-72 whitespace-normal break-words">
                                {item.title}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <svg
                    className="construction-links pointer-events-none absolute top-0 overflow-visible text-primary"
                    aria-hidden="true"
                    width={days.length * dayWidth}
                    height={rowOffset(rows.length)}
                  >
                    {edges.map((edge) => {
                      const from = rows.findIndex(
                        (row) => row.item && `${row.item.source.type}:${row.item.id}` === edge.from,
                      );
                      const to = rows.findIndex(
                        (row) => row.item && `${row.item.source.type}:${row.item.id}` === edge.to,
                      );
                      if (from < 0 || to < 0) return null;
                      const x1 = bounds(rows[from]!.item!).end * dayWidth - 3;
                      const x2 = bounds(rows[to]!.item!).start * dayWidth + 15;
                      const y1 = rowOffset(from) + 36;
                      const y2 = rowOffset(to) + 12;
                      return (
                        <g
                          key={`${edge.from}-${edge.to}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d={`M ${x1} ${y1} H ${x1 + 10} V ${y2 - 6} H ${x2} V ${y2}`} />
                          <path d={`M ${x2 - 4} ${y2 - 5} L ${x2} ${y2} L ${x2 + 4} ${y2 - 5}`} />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </TooltipProvider>
          {linked && (
            <div className="flex flex-col gap-3 border-t bg-muted p-3" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  {selectedTask?.title ??
                    planning.events.find((event) => event.id === linked.id)?.title}
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setLinked(null)}>
                  {t("clearLinks")}
                </Button>
              </div>
              {selectedTask && (
                <PrerequisiteList task={selectedTask} onOpen={(source) => onOpen(source)} />
              )}
              {dependents.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium">{t("dependents")}</h4>
                  {dependents.map((link) => (
                    <Button
                      key={link.id}
                      variant="link"
                      className="h-auto min-h-11 whitespace-normal"
                      onClick={() => onOpen({ type: "task", id: link.id })}
                    >
                      {planning.tasks.find((task) => task.id === link.id)?.title}
                    </Button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("outside")}</p>
            </div>
          )}
        </div>
      </div>
      {!visible.length && <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>}
      {undated.length > 0 && (
        <section className="border-t p-3">
          <h3 className="mb-2 text-sm font-semibold">{t("unscheduled")}</h3>
          <div className="flex flex-wrap gap-2">
            {undated.map((task) => (
              <Button
                key={task.id}
                variant="outline"
                onClick={() => onOpen({ type: "task", id: task.id })}
              >
                {task.title}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
