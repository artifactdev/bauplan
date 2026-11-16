import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Plus, X } from "lucide-react";
import { useWorkspace } from "@/hooks/use-workspace";
import { fmtDate, todayISO } from "@/lib/format";
import {
  parseDependencies,
  prerequisiteState,
  sourceKey,
  validateDependencyGraph,
  type TaskDependency,
} from "@/lib/task-dependencies";
import type { Task } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function TaskPrerequisites({
  value,
  onChange,
  taskId,
  disabled,
}: {
  value: string | null;
  onChange: (value: string) => void;
  taskId?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const { t } = useTranslation("construction");
  const { ws } = useWorkspace();
  const [search, setSearch] = useState("");
  const [lagDrafts, setLagDrafts] = useState<Record<string, string>>({});
  const dependencies = parseDependencies(value);
  const sources = [
    ...ws.tasks
      .filter((task) => task.id !== taskId)
      .map((task) => ({
        source: "task" as const,
        id: task.id,
        title: task.title,
        trade_id: task.trade_id,
        date: task.start_date || task.due_date,
      })),
    ...(ws.events ?? [])
      .filter((event) => event.kind === "arbeit")
      .map((event) => ({
        source: "event" as const,
        id: event.id,
        title: event.title,
        trade_id: event.trade_id,
        date: event.event_date,
      })),
  ];
  const update = (next: TaskDependency[]) => onChange(JSON.stringify(next));
  const canAdd = (source: (typeof sources)[number]) => {
    if (dependencies.some((d) => sourceKey(d) === sourceKey(source))) return false;
    if (!taskId) return true;
    try {
      validateDependencyGraph(
        ws.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                dependencies: JSON.stringify([
                  ...dependencies,
                  { source: source.source, id: source.id, lag_days: 0 },
                ]),
              }
            : task,
        ),
        ws.events ?? [],
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "dependencies.cycle" || error.message === "dependencies.unavailable")
      )
        return false;
      throw error;
    }
  };
  const candidates = sources.filter(
    (source) =>
      canAdd(source) &&
      `${source.title} ${ws.trades.find((trade) => trade.id === source.trade_id)?.name ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{t("prerequisites")}</legend>
      {dependencies.map((dependency) => {
        const source = sources.find((source) => sourceKey(source) === sourceKey(dependency));
        const title = source?.title ?? t("unavailable");
        const id = `dependency-lag-${sourceKey(dependency)}`;
        return (
          <div
            key={sourceKey(dependency)}
            className="flex flex-wrap items-center gap-2 rounded-md border p-2"
          >
            <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
              {title}
              <span className="block text-xs text-muted-foreground">
                {t(dependency.source === "event" ? "work" : "task")}
              </span>
            </span>
            <div className="flex items-center gap-2">
              <Label htmlFor={id}>{t("lagLabel")}</Label>
              <Input
                id={id}
                aria-label={t("lag", { title })}
                type="number"
                required
                min={0}
                max={36500}
                step={1}
                className="w-20"
                value={lagDrafts[sourceKey(dependency)] ?? dependency.lag_days}
                onChange={(event) => {
                  const value = event.target.value;
                  setLagDrafts((drafts) => ({ ...drafts, [sourceKey(dependency)]: value }));
                  const number = Number(value);
                  if (value !== "" && Number.isInteger(number) && number >= 0 && number <= 36500)
                    update(
                      dependencies.map((d) =>
                        sourceKey(d) === sourceKey(dependency) ? { ...d, lag_days: number } : d,
                      ),
                    );
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("remove", { title })}
                onClick={() => {
                  setLagDrafts((drafts) => {
                    const next = { ...drafts };
                    delete next[sourceKey(dependency)];
                    return next;
                  });
                  update(dependencies.filter((d) => sourceKey(d) !== sourceKey(dependency)));
                }}
              >
                <X />
              </Button>
            </div>
          </div>
        );
      })}
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={search}
        onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto">
        {candidates.map((source) => (
          <li key={sourceKey(source)}>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
              onClick={() => {
                update([...dependencies, { source: source.source, id: source.id, lag_days: 0 }]);
                setSearch("");
              }}
            >
              <Plus data-icon="inline-start" />
              <span>
                {source.title}
                <span className="block text-xs text-muted-foreground">
                  {t(source.source === "event" ? "work" : "task")}
                  {source.trade_id &&
                    ` · ${ws.trades.find((trade) => trade.id === source.trade_id)?.name ?? ""}`}
                  {source.date && ` · ${fmtDate(source.date)}`}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {!candidates.length && <p className="text-sm text-muted-foreground">{t("noMatches")}</p>}
      <p className="text-xs text-muted-foreground">{t("plannedHint")}</p>
    </fieldset>
  );
}

export function PrerequisiteList({
  task,
  onOpen,
}: {
  task: Task;
  onOpen?: ((source: { type: "task" | "event"; id: string }) => void) | undefined;
}) {
  const { t } = useTranslation("construction");
  const { ws } = useWorkspace();
  const states = parseDependencies(task.dependencies).map((dependency) =>
    prerequisiteState(task, dependency, ws.tasks, ws.events ?? [], todayISO()),
  );
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("prerequisites")}</h3>
      {!states.length && <p className="text-sm text-muted-foreground">{t("noPrerequisites")}</p>}
      <ul className="flex flex-col gap-3">
        {states.map((state) => (
          <li key={sourceKey(state.dependency)} className="text-sm">
            {onOpen && state.predecessor ? (
              <Button
                type="button"
                variant="link"
                className="h-auto min-h-11 whitespace-normal p-0 text-left"
                onClick={() => onOpen({ type: state.dependency.source, id: state.dependency.id })}
              >
                <Link2 data-icon="inline-start" /> {state.predecessor.title}
              </Button>
            ) : (
              <span className="font-medium">{state.predecessor?.title ?? t("unavailable")}</span>
            )}
            <p className="text-xs text-muted-foreground">
              {t(state.done ? "done" : "open")} ·{" "}
              {t("lagValue", { count: state.dependency.lag_days })}
            </p>
            <p
              className={cn(
                "mt-1 text-xs",
                state.issue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {t(state.issue ?? "ready", { date: state.earliest ? fmtDate(state.earliest) : "" })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
