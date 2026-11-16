import { addDays } from "date-fns";
import { z } from "zod";
import { dateKey, localDate } from "./calendar-view";
import type { CalEvent, Task } from "./schema";

export const dependencySchema = z
  .object({
    source: z.enum(["task", "event"]),
    id: z.string().min(1),
    lag_days: z.number().int().nonnegative().max(36500),
  })
  .strict();
export type TaskDependency = z.infer<typeof dependencySchema>;
export const dependencyConsentSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      dependencies: z.string().nullable(),
    })
    .strict(),
);
export type DependencyConsent = z.infer<typeof dependencyConsentSchema>;
export const sourceKey = (source: Pick<TaskDependency, "source" | "id">) =>
  `${source.source}:${source.id}`;

export function parseDependencies(value: unknown): TaskDependency[] {
  if (value == null || value === "") return [];
  try {
    if (typeof value !== "string") throw new Error();
    const dependencies = z.array(dependencySchema).parse(JSON.parse(value));
    if (new Set(dependencies.map(sourceKey)).size !== dependencies.length) throw new Error();
    return dependencies;
  } catch {
    throw new Error("dependencies.invalid");
  }
}

export function validateDependencyGraph(
  tasks: readonly Record<string, unknown>[],
  events: readonly Record<string, unknown>[],
) {
  const taskMap = new Map(tasks.map((task) => [task["id"], task]));
  const eventMap = new Map(events.map((event) => [event["id"], event]));
  const visiting = new Set<unknown>();
  const visited = new Set<unknown>();
  const visit = (task: Record<string, unknown>) => {
    const id = task["id"];
    if (visiting.has(id)) throw new Error("dependencies.cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of parseDependencies(task["dependencies"])) {
      const predecessor = (dependency.source === "task" ? taskMap : eventMap).get(dependency.id);
      if (
        !predecessor ||
        predecessor["project_id"] !== task["project_id"] ||
        (dependency.source === "event" && predecessor["kind"] !== "arbeit")
      )
        throw new Error("dependencies.unavailable");
      if (dependency.source === "task") visit(predecessor);
    }
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach(visit);
}

export function incomingDependencies(
  tasks: readonly Pick<Task, "id" | "dependencies">[],
  source: Pick<TaskDependency, "source" | "id">,
): DependencyConsent {
  return tasks
    .filter((task) =>
      parseDependencies(task.dependencies).some((d) => sourceKey(d) === sourceKey(source)),
    )
    .map((task) => ({ id: task.id, dependencies: task.dependencies ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function sameConsent(a: DependencyConsent, b: DependencyConsent | undefined) {
  return (
    b !== undefined &&
    JSON.stringify(a) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)))
  );
}

export function withoutDependency(value: unknown, source: Pick<TaskDependency, "source" | "id">) {
  return JSON.stringify(parseDependencies(value).filter((d) => sourceKey(d) !== sourceKey(source)));
}

export function prerequisiteState(
  task: Task,
  dependency: TaskDependency,
  tasks: readonly Task[],
  events: readonly CalEvent[],
  today: string,
) {
  const predecessor =
    dependency.source === "task"
      ? tasks.find((row) => row.id === dependency.id)
      : events.find((row) => row.id === dependency.id && row.kind === "arbeit");
  if (!predecessor)
    return { dependency, predecessor, done: false, earliest: null, issue: "unavailable" as const };
  const done =
    "status" in predecessor ? predecessor.status === "erledigt" : !!predecessor.work_completed;
  const end =
    "status" in predecessor ? predecessor.due_date : predecessor.end_date || predecessor.event_date;
  const midnight =
    !("status" in predecessor) && !!predecessor.start_time && predecessor.end_time === "00:00";
  const earliest = end
    ? dateKey(addDays(localDate(end), dependency.lag_days + (midnight ? 0 : 1)))
    : null;
  const issue =
    !earliest || !task.start_date
      ? "incomplete"
      : task.start_date < earliest
        ? "early"
        : !done &&
            task.status !== "erledigt" &&
            (task.status === "in_arbeit" || task.start_date <= today)
          ? "unfinished"
          : null;
  return { dependency, predecessor, done, earliest, issue };
}
